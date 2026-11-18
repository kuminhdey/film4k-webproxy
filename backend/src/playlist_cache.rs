use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use regex::Regex;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, RwLock};
use std::time::{Duration, Instant};
use tracing::{error, info, warn};
use url::Url;

use crate::{
    db::Database,
    proxy::{
        add_security_headers, fetch_stream_with_referer,
        fetch_upstream_title_hls_for_season_episode_server, is_cdn_segment, is_valid_remote_url,
        normalize_upstream_hls_url, read_body_with_cap, resolve_relative_url, urlencoding,
        MAX_PLAYLIST_BYTES,
    },
    AppState,
};

static URI_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"URI="([^"]+)""#).expect("valid URI regex"));
static EXPIRES_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)(?:^|[?&;,=\"'\s])(?:x-expires|expires)=([0-9]{1,13})"#)
        .expect("valid expires regex")
});

const MAX_CHILD_PLAYLISTS: usize = 32;
const SUB_PLAYLIST_CONCURRENCY: usize = 4;
const REFRESH_COOLDOWN_SECS: u64 = 60;
const MAX_REFRESH_COOLDOWN_KEYS: usize = 2048;
const MAX_MEMORY_CACHE_ENTRIES: usize = 512;

#[derive(Debug, Deserialize, Default, Clone)]
pub struct StreamParams {
    #[serde(default)]
    pub refresh: Option<String>,
    #[serde(default)]
    pub ep: Option<i32>,
    #[serde(default)]
    pub season: Option<i32>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub server: Option<usize>,
}

impl StreamParams {
    pub fn is_refresh(&self) -> bool {
        self.refresh
            .as_deref()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    }
}

pub fn is_safe_filename(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
}

pub fn extract_filename(uri: &str) -> String {
    let clean = uri.split('?').next().unwrap_or(uri);
    clean.rsplit('/').next().unwrap_or(clean).to_string()
}

fn strip_numeric_suffix<'a>(input: &'a str, prefix: &str) -> Option<&'a str> {
    let idx = input.rfind(prefix)?;
    let digits = &input[idx + prefix.len()..];
    if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
        Some(&input[..idx])
    } else {
        None
    }
}

/// Extract the canonical movie slug from a playlist cache directory name
/// (e.g. `friends_s2_ep25_srv2` -> `friends`, `interstellar` -> `interstellar`).
pub fn extract_base_slug_from_cache_dir(dir_name: &str) -> &str {
    let mut base = dir_name;
    if let Some(stripped) = strip_numeric_suffix(base, "_srv") {
        base = stripped;
    }
    if let Some(stripped) = strip_numeric_suffix(base, "_ep") {
        base = stripped;
    }
    if let Some(stripped) = strip_numeric_suffix(base, "_s") {
        base = stripped;
    }
    base
}

pub fn slug_matches_cache_dir_name(dir_name: &str, slug: &str) -> bool {
    extract_base_slug_from_cache_dir(dir_name) == slug
}

/// Collect all movie slugs that currently have a cached `master.m3u8` on disk.
pub fn cached_slugs_set(base_dir: &Path) -> HashSet<String> {
    let mut slugs = HashSet::new();
    let Ok(entries) = std::fs::read_dir(base_dir) else {
        return slugs;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("master.m3u8").is_file() {
            let dir_name = entry.file_name();
            let dir_str = dir_name.to_string_lossy();
            slugs.insert(extract_base_slug_from_cache_dir(&dir_str).to_string());
        }
    }
    slugs
}

pub const MAX_CACHE_AGE_SECS: u64 = 4 * 3600;

pub fn extract_expiration_timestamp(content: &str, stream_url: &str) -> Option<u64> {
    fn decode_once(input: &str) -> String {
        let bytes = input.as_bytes();
        let mut output = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] == b'%' && index + 2 < bytes.len() {
                let digit = |byte: u8| (byte as char).to_digit(16).map(|value| value as u8);
                if let (Some(high), Some(low)) =
                    (digit(bytes[index + 1]), digit(bytes[index + 2]))
                {
                    output.push((high << 4) | low);
                    index += 3;
                    continue;
                }
            }
            output.push(bytes[index]);
            index += 1;
        }
        String::from_utf8_lossy(&output).into_owned()
    }

    let mut text = format!("{stream_url}\n{content}");
    let mut earliest = None;
    for _ in 0..3 {
        for captures in EXPIRES_REGEX.captures_iter(&text) {
            if let Ok(timestamp) = captures[1].parse::<u64>() {
                earliest =
                    Some(earliest.map_or(timestamp, |current: u64| current.min(timestamp)));
            }
        }
        let decoded = decode_once(&text);
        if decoded == text {
            break;
        }
        text = decoded;
    }
    earliest
}

#[derive(Clone, Debug)]
pub struct PlaylistCache {
    base_dir: PathBuf,
    cache: Arc<RwLock<HashMap<String, (String, Instant)>>>,
    refresh_cooldowns: Arc<Mutex<HashMap<String, Instant>>>,
}

pub type PlaylistCacheService = PlaylistCache;

impl Default for PlaylistCache {
    fn default() -> Self {
        let path = std::env::var("PLAYLISTS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/playlists"));
        Self::new(path)
    }
}

impl PlaylistCache {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
            cache: Arc::new(RwLock::new(HashMap::new())),
            refresh_cooldowns: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_memory(&self, key: &str) -> Option<String> {
        let guard = self.cache.read().unwrap_or_else(|e| e.into_inner());
        guard.get(key).map(|(v, _)| v.clone())
    }

    pub fn set_memory(&self, key: String, value: String) {
        let mut guard = self.cache.write().unwrap_or_else(|e| e.into_inner());
        if !guard.contains_key(&key) && guard.len() >= MAX_MEMORY_CACHE_ENTRIES {
            if let Some(oldest) = guard
                .iter()
                .min_by_key(|(_, (_, ts))| *ts)
                .map(|(k, _)| k.clone())
            {
                guard.remove(&oldest);
            }
        }
        guard.insert(key, (value, Instant::now()));
    }

    pub fn prune_memory_cache(&self, max_age: Duration) {
        let mut guard = self.cache.write().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        guard.retain(|_, (_, time)| now.duration_since(*time) < max_age);
    }

    fn allow_forced_refresh(&self, refresh_key: &str) -> bool {
        let mut guard = self
            .refresh_cooldowns
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        guard.retain(|_, ts| now.duration_since(*ts) < Duration::from_secs(REFRESH_COOLDOWN_SECS));
        if guard.contains_key(refresh_key) {
            return false;
        }
        if guard.len() >= MAX_REFRESH_COOLDOWN_KEYS {
            guard.clear();
        }
        guard.insert(refresh_key.to_string(), now);
        true
    }

    /// Scan `base_dir` on a blocking thread and delete expired playlist cache directories.
    pub async fn cleanup_expired_disk_cache(&self) -> usize {
        let base_dir = self.base_dir.clone();
        tokio::task::spawn_blocking(move || cleanup_expired_dirs_sync(&base_dir))
            .await
            .unwrap_or(0)
    }

    pub fn start_cleanup_task(&self, db: Database) {
        let service = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(3600));
            loop {
                interval.tick().await;
                let cleanup_db = db.clone();
                match db
                    .run_blocking(move || cleanup_db.cleanup_expired_playlist_cache())
                    .await
                {
                    Ok(deleted) => {
                        if deleted > 0 {
                            info!(
                                "🧹 Purged {} expired playlist cache entries from SQLite",
                                deleted
                            );
                        }
                    }
                    Err(e) => {
                        warn!("Failed to cleanup expired playlist cache from SQLite: {}", e);
                    }
                }
                let removed_dirs = service.cleanup_expired_disk_cache().await;
                if removed_dirs > 0 {
                    info!(
                        "🧹 Purged {} expired playlist cache directories from disk",
                        removed_dirs
                    );
                }
                service.prune_memory_cache(Duration::from_secs(MAX_CACHE_AGE_SECS));
            }
        });
    }

    pub fn base_dir(&self) -> PathBuf {
        self.base_dir.clone()
    }

    pub fn cache_slug_dir_with_season_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        season: Option<i32>,
        server: Option<usize>,
    ) -> PathBuf {
        let srv_suffix = match server {
            Some(s) if s > 0 => format!("_srv{}", s),
            _ => String::new(),
        };
        match (season, ep) {
            (Some(s), Some(e)) if s > 1 => self
                .base_dir
                .join(format!("{}_s{}_ep{}{}", slug, s, e, srv_suffix)),
            (Some(s), None) if s > 1 => self
                .base_dir
                .join(format!("{}_s{}_ep1{}", slug, s, srv_suffix)),
            (_, Some(e)) if e > 1 => self
                .base_dir
                .join(format!("{}_ep{}{}", slug, e, srv_suffix)),
            _ => {
                if srv_suffix.is_empty() {
                    self.base_dir.join(slug)
                } else {
                    self.base_dir.join(format!("{}{}", slug, srv_suffix))
                }
            }
        }
    }

    pub fn cache_slug_dir_with_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        server: Option<usize>,
    ) -> PathBuf {
        self.cache_slug_dir_with_season_server(slug, ep, None, server)
    }

    pub fn cache_slug_dir(&self, slug: &str, ep: Option<i32>) -> PathBuf {
        self.cache_slug_dir_with_server(slug, ep, None)
    }

    pub fn slug_dir(&self, slug: &str) -> PathBuf {
        self.cache_slug_dir_with_server(slug, None, None)
    }

    pub fn master_path(&self, slug: &str) -> PathBuf {
        self.master_path_for_ep_server(slug, None, None)
    }

    pub fn master_path_for_ep(&self, slug: &str, ep: Option<i32>) -> PathBuf {
        self.master_path_for_ep_server(slug, ep, None)
    }

    pub fn master_path_for_ep_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        server: Option<usize>,
    ) -> PathBuf {
        self.cache_slug_dir_with_server(slug, ep, server)
            .join("master.m3u8")
    }

    pub fn master_path_for_season_ep_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        season: Option<i32>,
        server: Option<usize>,
    ) -> PathBuf {
        self.cache_slug_dir_with_season_server(slug, ep, season, server)
            .join("master.m3u8")
    }

    pub fn file_path(&self, slug: &str, file: &str) -> PathBuf {
        self.file_path_for_ep_server(slug, None, None, file)
    }

    pub fn file_path_for_ep(&self, slug: &str, ep: Option<i32>, file: &str) -> PathBuf {
        self.file_path_for_ep_server(slug, ep, None, file)
    }

    pub fn file_path_for_ep_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        server: Option<usize>,
        file: &str,
    ) -> PathBuf {
        self.cache_slug_dir_with_server(slug, ep, server).join(file)
    }

    pub fn file_path_for_season_ep_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        season: Option<i32>,
        server: Option<usize>,
        file: &str,
    ) -> PathBuf {
        self.cache_slug_dir_with_season_server(slug, ep, season, server)
            .join(file)
    }

    pub fn cache_count(&self) -> usize {
        std::fs::read_dir(&self.base_dir)
            .map(|entries| entries.filter_map(Result::ok).count())
            .unwrap_or(0)
    }

    /// Delete all cached playlist directories belonging to `slug` (`{slug}`, `{slug}_ep*`, `{slug}_s*`, `{slug}_srv*`).
    pub async fn clear_slug_all(&self, slug: &str) -> std::io::Result<usize> {
        let base_dir = self.base_dir.clone();
        let slug_owned = slug.to_string();
        tokio::task::spawn_blocking(move || {
            if !base_dir.exists() {
                return Ok(0);
            }
            let mut removed = 0usize;
            for entry in std::fs::read_dir(&base_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    let name = entry.file_name();
                    if slug_matches_cache_dir_name(&name.to_string_lossy(), &slug_owned) {
                        std::fs::remove_dir_all(&path)?;
                        removed += 1;
                    }
                }
            }
            Ok(removed)
        })
        .await
        .map_err(std::io::Error::other)?
    }

    pub async fn clear_slug(&self, slug: &str) -> std::io::Result<()> {
        let _ = self.clear_slug_all(slug).await?;
        Ok(())
    }

    pub async fn prewarm_hot_movies(&self, slugs: &[String], db: &Database) {
        if slugs.is_empty() {
            return;
        }
        info!(
            "🚀 [Prewarm] Starting zero-delay HLS prewarming for {} hot movies...",
            slugs.len()
        );
        let semaphore = Arc::new(tokio::sync::Semaphore::new(3));
        let mut join_set = tokio::task::JoinSet::new();

        for slug in slugs {
            let slug_clone = slug.clone();
            let cache = self.clone();
            let db_clone = db.clone();
            let sem = semaphore.clone();

            join_set.spawn(async move {
                let _permit = match sem.acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => return,
                };
                info!("⚡ [Prewarm] Prewarming HLS playlist for '{}'...", slug_clone);
                let _ = cache.get_master(&slug_clone, false, Some(&db_clone)).await;
            });
        }

        while join_set.join_next().await.is_some() {}
        info!("✅ [Prewarm] Completed zero-delay HLS prewarming.");
    }

    pub async fn get_master(
        &self,
        slug: &str,
        refresh: bool,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.get_master_for_episode(slug, None, refresh, db).await
    }

    pub async fn get_master_for_episode(
        &self,
        slug: &str,
        ep: Option<i32>,
        refresh: bool,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.get_master_for_episode_server(slug, ep, None, refresh, db)
            .await
    }

    pub async fn get_master_for_episode_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        server: Option<usize>,
        refresh: bool,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.get_master_for_season_episode_server(slug, ep, None, server, refresh, db)
            .await
    }

    pub async fn get_master_for_season_episode_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        season: Option<i32>,
        server: Option<usize>,
        refresh: bool,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        let master_file = self.master_path_for_season_ep_server(slug, ep, season, server);
        let slug_dir = self.cache_slug_dir_with_season_server(slug, ep, season, server);

        let effective_refresh = if refresh {
            let key = format!("{}:{:?}:{:?}:{:?}", slug, season, ep, server);
            if self.allow_forced_refresh(&key) {
                true
            } else {
                warn!("Debounced ?refresh=1 request for key '{}'", key);
                false
            }
        } else {
            false
        };

        if !effective_refresh && master_file.exists() {
            let meta_path = slug_dir.join(".metadata.json");
            let mut is_expired = false;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);

            if meta_path.exists() {
                match tokio::fs::read_to_string(&meta_path).await {
                    Ok(meta_str) => match serde_json::from_str::<serde_json::Value>(&meta_str) {
                        Ok(meta_json) => {
                            let cached_at = meta_json
                                .get("cached_at")
                                .and_then(|v| v.as_u64())
                                .or_else(|| {
                                    master_file.metadata().ok().and_then(|m| {
                                        m.modified()
                                            .ok()
                                            .and_then(|t| {
                                                t.duration_since(std::time::UNIX_EPOCH).ok()
                                            })
                                            .map(|d| d.as_secs())
                                    })
                                })
                                .unwrap_or(0);
                            if let Some(exp) = meta_json.get("expires_at").and_then(|v| v.as_u64())
                            {
                                let bounded_exp =
                                    exp.min(cached_at.saturating_add(MAX_CACHE_AGE_SECS));
                                if now >= bounded_exp.saturating_sub(60) {
                                    is_expired = true;
                                    warn!(
                                        "Cached master playlist for '{:?}' expired. Re-fetching...",
                                        slug
                                    );
                                }
                            } else if now >= cached_at.saturating_add(MAX_CACHE_AGE_SECS) {
                                is_expired = true;
                                warn!(
                                    "Cached master playlist for '{:?}' with null expires_at exceeded max TTL (cached_at: {}). Re-fetching...",
                                    slug, cached_at
                                );
                            }
                        }
                        Err(err) => {
                            warn!(
                                "Corrupted .metadata.json for '{:?}': {}. Re-fetching...",
                                slug, err
                            );
                            is_expired = true;
                        }
                    },
                    Err(err) => {
                        warn!(
                            "Failed to read .metadata.json for '{:?}': {}. Re-fetching...",
                            slug, err
                        );
                        is_expired = true;
                    }
                }
            } else if let Ok(content) = tokio::fs::read_to_string(&master_file).await {
                let mut detected_exp = extract_expiration_timestamp(&content, "");
                if detected_exp.is_none() {
                    if let Ok(mut entries) = tokio::fs::read_dir(&slug_dir).await {
                        while let Ok(Some(entry)) = entries.next_entry().await {
                            let fname = entry.file_name().to_string_lossy().to_string();
                            if fname.ends_with(".m3u8") && fname != "master.m3u8" {
                                if let Ok(sub_content) =
                                    tokio::fs::read_to_string(entry.path()).await
                                {
                                    if let Some(exp) =
                                        extract_expiration_timestamp(&sub_content, "")
                                    {
                                        if detected_exp.is_none() || detected_exp > Some(exp) {
                                            detected_exp = Some(exp);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if let Some(exp) = detected_exp {
                    let cached_at = master_file
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let bounded_exp = exp.min(cached_at.saturating_add(MAX_CACHE_AGE_SECS));
                    if now >= bounded_exp.saturating_sub(60) {
                        is_expired = true;
                        warn!(
                            "Legacy cached playlist for '{:?}' expired. Re-fetching...",
                            slug
                        );
                    } else {
                        let meta_json = serde_json::json!({
                            "cached_at": cached_at,
                            "expires_at": bounded_exp,
                            "source_url": ""
                        });
                        let _ = tokio::fs::write(&meta_path, meta_json.to_string()).await;
                    }
                } else if let Ok(fs_meta) = tokio::fs::metadata(&master_file).await {
                    if let Ok(modified) = fs_meta.modified() {
                        let mtime_secs = modified
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        if now >= mtime_secs.saturating_add(MAX_CACHE_AGE_SECS) {
                            is_expired = true;
                            warn!(
                                "Legacy cached master playlist for '{:?}' is older than 4h (mtime: {}). Re-fetching...",
                                slug, mtime_secs
                            );
                        } else {
                            let meta_json = serde_json::json!({
                                "cached_at": mtime_secs,
                                "expires_at": mtime_secs + MAX_CACHE_AGE_SECS,
                                "source_url": ""
                            });
                            let _ = tokio::fs::write(&meta_path, meta_json.to_string()).await;
                        }
                    }
                }
            }

            if !is_expired {
                if let Ok(content) = tokio::fs::read_to_string(&master_file).await {
                    if content.trim().starts_with("#EXTM3U") {
                        return Ok(content);
                    }
                }
            }
            warn!(
                "Cached master.m3u8 for slug '{}' (ep: {:?}, season: {:?}, server: {:?}) is stale or corrupt. Re-crawling...",
                slug, ep, season, server
            );
        }

        self.crawl_and_cache_for_season_episode_server(slug, ep, season, server, db)
            .await
    }

    pub async fn get_file(
        &self,
        slug: &str,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.get_file_for_episode_server(slug, None, None, file, db)
            .await
    }

    pub async fn get_file_for_episode(
        &self,
        slug: &str,
        ep: Option<i32>,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.get_file_for_episode_server(slug, ep, None, file, db)
            .await
    }

    pub async fn get_file_for_episode_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        server: Option<usize>,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.get_file_for_season_episode_server(slug, ep, None, server, file, db)
            .await
    }

    pub async fn get_file_for_season_episode_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        season: Option<i32>,
        server: Option<usize>,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        let file_path = self.file_path_for_season_ep_server(slug, ep, season, server, file);

        if file_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&file_path).await {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }

        let sub_file = self
            .cache_slug_dir_with_season_server(slug, ep, season, server)
            .join("sub")
            .join(file);
        if sub_file.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&sub_file).await {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }

        if file.ends_with(".vtt") {
            return self
                .get_sub_for_season_episode_server_with_db(slug, ep, season, server, file, db)
                .await;
        }

        info!(
            "Sub-playlist file '{}' not found on disk for slug '{}' (ep: {:?}, season: {:?}, server: {:?}). Attempting self-healing crawl...",
            file, slug, ep, season, server
        );
        let _ = self
            .crawl_and_cache_for_season_episode_server(slug, ep, season, server, db)
            .await;

        if file_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&file_path).await {
                return Ok(content);
            }
        }

        Err((
            StatusCode::NOT_FOUND,
            format!("Playlist file '{}' for slug '{}' not found", file, slug),
        ))
    }

    pub async fn get_sub_for_episode(
        &self,
        slug: &str,
        ep: Option<i32>,
        file: &str,
    ) -> Result<String, (StatusCode, String)> {
        self.get_sub_for_episode_server(slug, ep, None, file).await
    }

    pub async fn get_sub_for_episode_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        server: Option<usize>,
        file: &str,
    ) -> Result<String, (StatusCode, String)> {
        self.get_sub_for_season_episode_server(slug, ep, None, server, file)
            .await
    }

    pub async fn get_sub_for_season_episode_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        season: Option<i32>,
        server: Option<usize>,
        file: &str,
    ) -> Result<String, (StatusCode, String)> {
        self.get_sub_for_season_episode_server_with_db(slug, ep, season, server, file, None)
            .await
    }

    pub async fn get_sub_for_season_episode_server_with_db(
        &self,
        slug: &str,
        ep: Option<i32>,
        season: Option<i32>,
        server: Option<usize>,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        if !is_safe_filename(file) {
            return Err((
                StatusCode::BAD_REQUEST,
                "Invalid subtitle filename".to_string(),
            ));
        }

        let slug_dir = self.cache_slug_dir_with_season_server(slug, ep, season, server);
        let sub_dir = slug_dir.join("sub");
        let sub_file = sub_dir.join(file);
        let direct_file = slug_dir.join(file);

        // 1. Serve immediately if already cached on disk
        if sub_file.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&sub_file).await {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }
        if direct_file.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&direct_file).await {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }

        // 2. Verify (slug, season, ep, server) exists in SQLite BEFORE creating directories or fetching upstream
        if let Some(database) = db {
            let db_clone = database.clone();
            let slug_owned = slug.to_string();
            let movie_opt = database
                .run_read_blocking(move || db_clone.get_movie_by_slug(&slug_owned))
                .await
                .map_err(|_| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Internal database error".to_string(),
                    )
                })?;

            let Some(movie) = movie_opt else {
                return Err((
                    StatusCode::NOT_FOUND,
                    format!("Movie '{}' not found", slug),
                ));
            };

            let wanted_ep = ep.unwrap_or(1);
            let wanted_season = season.unwrap_or(1);
            let wanted_server = server.unwrap_or(0);

            if wanted_ep > 1 || wanted_season > 1 || !movie.episodes.is_empty() {
                let matched_ep = match_movie_episode(&movie, season, wanted_ep);
                if (wanted_ep > 1 || wanted_season > 1) && matched_ep.is_none() {
                    return Err((
                        StatusCode::NOT_FOUND,
                        format!(
                            "Episode {} (season {}) for slug '{}' is not available",
                            wanted_ep, wanted_season, slug
                        ),
                    ));
                }
                if wanted_server > 0 {
                    let has_srv = matched_ep.is_some_and(|e| {
                        wanted_server < e.sources.len() || wanted_server < e.servers.len()
                    }) || wanted_server < movie.servers.len();
                    if !has_srv {
                        return Err((
                            StatusCode::NOT_FOUND,
                            format!("Server {} for slug '{}' is not available", wanted_server, slug),
                        ));
                    }
                }
            } else if wanted_server > 0 && wanted_server >= movie.servers.len() {
                return Err((
                    StatusCode::NOT_FOUND,
                    format!("Server {} for slug '{}' is not available", wanted_server, slug),
                ));
            }
        }

        // 3. Fetch upstream https://fiml4k.fun/api/subs/<filename> with outbound host validation
        let upstream_url = format!("https://fiml4k.fun/api/subs/{}", file);
        let parsed_url = is_valid_remote_url(&upstream_url).map_err(|e| {
            (
                StatusCode::FORBIDDEN,
                format!("Subtitle URL rejected by outbound policy: {}", e),
            )
        })?;

        let (resp, _) =
            fetch_stream_with_referer(&parsed_url, None, 3, Some("https://fiml4k.fun/"))
                .await
                .map_err(|(code, message)| (code, message.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            return Err((
                status,
                format!("Upstream subtitle request failed with status: {}", status),
            ));
        }

        let content = read_body_with_cap(resp, MAX_PLAYLIST_BYTES)
            .await
            .map_err(|(code, message)| (code, message.to_string()))
            .and_then(|body| {
                String::from_utf8(body)
                    .map_err(|_| (StatusCode::BAD_GATEWAY, "Invalid UTF-8 subtitle".to_string()))
            })?;

        // 4. Cache to disk
        if let Err(e) = tokio::fs::create_dir_all(&sub_dir).await {
            warn!("Failed to create sub directory {:?}: {}", sub_dir, e);
        }
        if let Err(e) = tokio::fs::write(&sub_file, &content).await {
            warn!("Failed to cache subtitle file {:?}: {}", sub_file, e);
        }

        info!(
            "Fetched and cached subtitle '{}' for slug '{}' (ep: {:?}, season: {:?}, server: {:?})",
            file, slug, ep, season, server
        );
        Ok(content)
    }

    pub async fn crawl_and_cache(
        &self,
        slug: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.crawl_and_cache_for_episode_server(slug, None, None, db)
            .await
    }

    pub async fn crawl_and_cache_for_episode(
        &self,
        slug: &str,
        ep_num: Option<i32>,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.crawl_and_cache_for_episode_server(slug, ep_num, None, db)
            .await
    }

    pub async fn crawl_and_cache_for_episode_server(
        &self,
        slug: &str,
        ep_num: Option<i32>,
        server: Option<usize>,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.crawl_and_cache_for_season_episode_server(slug, ep_num, None, server, db)
            .await
    }

    pub async fn crawl_and_cache_for_season_episode_server(
        &self,
        slug: &str,
        ep_num: Option<i32>,
        season: Option<i32>,
        server: Option<usize>,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        info!(
            "Crawling upstream playlists for slug '{}' (ep: {:?}, season: {:?}, server: {:?})...",
            slug, ep_num, season, server
        );

        let requested_server = server.unwrap_or(0);
        let wanted_ep = ep_num.unwrap_or(1);
        let has_season_spec = season.unwrap_or(1) > 1;

        let movie_opt = if let Some(database) = db {
            let db_clone = database.clone();
            let slug_owned = slug.to_string();
            database
                .run_read_blocking(move || db_clone.get_movie_by_slug(&slug_owned))
                .await
                .ok()
                .flatten()
        } else {
            None
        };

        let not_available_msg = || {
            if requested_server == 0 {
                if let Some(s) = season.filter(|s| *s > 1) {
                    format!(
                        "Episode {} (season {}) for slug '{}' is not available",
                        wanted_ep, s, slug
                    )
                } else {
                    format!("Episode {} for slug '{}' is not available", wanted_ep, slug)
                }
            } else if let Some(s) = season.filter(|s| *s > 1) {
                format!(
                    "Episode {}, season {}, server {} for slug '{}' is not available",
                    wanted_ep, s, requested_server, slug
                )
            } else {
                format!(
                    "Episode {}, server {} for slug '{}' is not available",
                    wanted_ep, requested_server, slug
                )
            }
        };

        if db.is_some() && movie_opt.is_none() {
            if requested_server > 0 || wanted_ep > 1 || has_season_spec {
                return Err((StatusCode::NOT_FOUND, not_available_msg()));
            }
            return Err((
                StatusCode::NOT_FOUND,
                format!("No HLS stream URL available for slug '{}'", slug),
            ));
        }

        let db_source = movie_opt.as_ref().and_then(|movie| {
            if let Some(episode) = match_movie_episode(movie, season, wanted_ep) {
                episode
                    .sources
                    .get(requested_server)
                    .map(|source| normalize_upstream_hls_url(&source.hls_url))
                    .filter(|u| !u.trim().is_empty())
                    .or_else(|| {
                        episode
                            .servers
                            .get(requested_server)
                            .map(|source| normalize_upstream_hls_url(&source.hls_url))
                            .filter(|u| !u.trim().is_empty())
                    })
            } else if movie.episodes.is_empty() && wanted_ep == 1 && !has_season_spec {
                movie
                    .servers
                    .get(requested_server)
                    .map(|srv| normalize_upstream_hls_url(&srv.hls_url))
                    .filter(|u| !u.trim().is_empty())
                    .or_else(|| {
                        if requested_server == 0 {
                            movie
                                .get_primary_hls_url()
                                .map(|u| normalize_upstream_hls_url(&u))
                        } else {
                            None
                        }
                    })
            } else {
                None
            }
        });

        let mut master_hls_url = if requested_server > 0 || wanted_ep > 1 || has_season_spec {
            db_source.ok_or_else(|| (StatusCode::NOT_FOUND, not_available_msg()))?
        } else {
            match fetch_upstream_title_hls_for_season_episode_server(
                slug,
                Some(wanted_ep),
                season,
                server,
            )
            .await
            {
                Some(url) => normalize_upstream_hls_url(&url),
                None => db_source
                    .or_else(|| {
                        movie_opt
                            .as_ref()
                            .and_then(|m| m.get_primary_hls_url())
                            .map(|u| normalize_upstream_hls_url(&u))
                    })
                    .ok_or_else(|| {
                        (
                            StatusCode::NOT_FOUND,
                            format!("No HLS stream URL available for slug '{}'", slug),
                        )
                    })?,
            }
        };

        let master_url_parsed = is_valid_remote_url(&master_hls_url).map_err(|e| {
            (
                StatusCode::FORBIDDEN,
                format!("Master HLS URL rejected by outbound policy: {}", e),
            )
        })?;

        let (mut master_resp, mut final_master_url) =
            fetch_stream_with_referer(&master_url_parsed, None, 3, Some("https://fiml4k.fun/"))
                .await
                .map_err(|(code, message)| (code, message.to_string()))?;

        // Refresh expired 403 / 404 / 410 stream tokens for BOTH single movies and multi-episode series
        if matches!(
            master_resp.status(),
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND | StatusCode::GONE
        ) {
            let fresh_url = fetch_upstream_title_hls_for_season_episode_server(
                slug,
                Some(wanted_ep),
                season,
                server,
            )
            .await
            .map(|u| normalize_upstream_hls_url(&u))
            .ok_or_else(|| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "Could not refresh stream token for slug '{}' (ep {}, season {:?}, server {:?})",
                        slug, wanted_ep, season, server
                    ),
                )
            })?;
            let fresh_parsed = is_valid_remote_url(&fresh_url).map_err(|e| {
                (
                    StatusCode::FORBIDDEN,
                    format!("Refreshed stream URL rejected by outbound policy: {}", e),
                )
            })?;
            master_hls_url = fresh_url;
            (master_resp, final_master_url) =
                fetch_stream_with_referer(&fresh_parsed, None, 3, Some("https://fiml4k.fun/"))
                    .await
                    .map_err(|(code, message)| (code, message.to_string()))?;
        }

        if !master_resp.status().is_success() {
            return Err((
                StatusCode::BAD_GATEWAY,
                format!(
                    "Upstream master playlist returned status {}",
                    master_resp.status()
                ),
            ));
        }

        let master_body = read_body_with_cap(master_resp, MAX_PLAYLIST_BYTES)
            .await
            .map_err(|(code, message)| (code, message.to_string()))
            .and_then(|body| {
                String::from_utf8(body)
                    .map_err(|_| (StatusCode::BAD_GATEWAY, "Invalid UTF-8 playlist".to_string()))
            })?;

        if !master_body.trim().starts_with("#EXTM3U") {
            return Err((
                StatusCode::BAD_GATEWAY,
                "Upstream master response is not a valid M3U8 playlist".to_string(),
            ));
        }

        let (rewritten_master, sub_playlists) = parse_master_and_extract_subs_for_season_server(
            &master_body,
            &final_master_url,
            season,
            server,
        );

        let slug_dir = self.cache_slug_dir_with_season_server(slug, ep_num, season, server);
        tokio::fs::create_dir_all(&slug_dir).await.map_err(|e| {
            error!("Failed to create playlist directory {:?}: {}", slug_dir, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to initialize playlist cache directory".to_string(),
            )
        })?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut expires_at = extract_expiration_timestamp(&master_body, &master_hls_url);
        if let Some(final_expiry) = extract_expiration_timestamp("", final_master_url.as_str()) {
            expires_at = Some(expires_at.map_or(final_expiry, |expiry| expiry.min(final_expiry)));
        }

        // Download child playlists with filename validation and bounded concurrency
        let sub_sem = Arc::new(tokio::sync::Semaphore::new(SUB_PLAYLIST_CONCURRENCY));
        let mut join_set = tokio::task::JoinSet::new();
        for (filename, sub_url) in sub_playlists.into_iter().take(MAX_CHILD_PLAYLISTS) {
            if !is_safe_filename(&filename)
                || filename == ".metadata.json"
                || filename == "master.m3u8"
            {
                warn!(
                    "Rejected unsafe child playlist filename '{}' for slug '{}'",
                    filename, slug
                );
                return Err((
                    StatusCode::BAD_GATEWAY,
                    "Upstream master playlist contained invalid child filename".to_string(),
                ));
            }
            let file_dest = slug_dir.join(&filename);
            let sem = sub_sem.clone();
            join_set.spawn(async move {
                let _permit = sem.acquire_owned().await.ok()?;
                let parsed_sub = is_valid_remote_url(&sub_url).ok()?;
                let (resp, final_sub_url) = fetch_stream_with_referer(
                    &parsed_sub,
                    None,
                    3,
                    Some("https://fiml4k.fun/"),
                )
                .await
                .ok()?;
                if !resp.status().is_success() {
                    return None;
                }
                let sub_body =
                    String::from_utf8(read_body_with_cap(resp, MAX_PLAYLIST_BYTES).await.ok()?)
                        .ok()?;
                if !sub_body.trim().starts_with("#EXTM3U") {
                    return None;
                }
                let sub_exp = extract_expiration_timestamp(&sub_body, &sub_url);
                let sub_exp = match extract_expiration_timestamp("", final_sub_url.as_str()) {
                    Some(final_expiry) => {
                        Some(sub_exp.map_or(final_expiry, |expiry| expiry.min(final_expiry)))
                    }
                    None => sub_exp,
                };
                let processed =
                    process_sub_playlist_for_season_server(&sub_body, &final_sub_url, season, server);
                tokio::fs::write(&file_dest, processed).await.ok()?;
                Some(sub_exp)
            });
        }

        let mut all_subs_ok = true;
        while let Some(res) = join_set.join_next().await {
            match res {
                Ok(Some(Some(exp))) => {
                    if expires_at.is_none() || expires_at > Some(exp) {
                        expires_at = Some(exp);
                    }
                }
                Ok(Some(None)) => {}
                _ => all_subs_ok = false,
            }
        }
        if !all_subs_ok {
            return Err((
                StatusCode::BAD_GATEWAY,
                "Failed to fetch or store child playlist".to_string(),
            ));
        }

        expires_at = Some(
            expires_at
                .unwrap_or(now.saturating_add(MAX_CACHE_AGE_SECS))
                .min(now.saturating_add(MAX_CACHE_AGE_SECS)),
        );
        let meta_json = serde_json::json!({
            "cached_at": now,
            "expires_at": expires_at,
            "source_url": master_hls_url
        });
        let _ = tokio::fs::write(slug_dir.join(".metadata.json"), meta_json.to_string()).await;

        let master_dest = self.master_path_for_season_ep_server(slug, ep_num, season, server);
        tokio::fs::write(&master_dest, &rewritten_master)
            .await
            .map_err(|e| {
                error!("Failed to write master playlist {:?}: {}", master_dest, e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to store master playlist".to_string(),
                )
            })?;

        info!(
            "Cached all playlists for slug '{}' (ep: {:?}, season: {:?}, server: {:?}) to {:?}",
            slug, ep_num, season, server, slug_dir
        );
        Ok(rewritten_master)
    }
}

fn match_movie_episode(
    movie: &crate::models::Movie,
    season: Option<i32>,
    wanted: i32,
) -> Option<&crate::models::Episode> {
    match season {
        Some(s) => movie
            .episodes
            .iter()
            .find(|ep| ep.season == s && ep.episode == wanted)
            .or_else(|| {
                if wanted > 0 && (wanted as usize) <= movie.episodes.len() {
                    let cand = &movie.episodes[wanted as usize - 1];
                    if cand.season == s {
                        Some(cand)
                    } else {
                        None
                    }
                } else {
                    None
                }
            }),
        None => {
            let has_multi = movie.episodes.iter().any(|ep| ep.season > 1);
            if has_multi && wanted > 0 && (wanted as usize) <= movie.episodes.len() {
                let cand = &movie.episodes[wanted as usize - 1];
                if cand.episode != wanted {
                    Some(cand)
                } else {
                    movie.episodes.iter().find(|ep| ep.episode == wanted)
                }
            } else {
                movie.episodes.iter().find(|ep| ep.episode == wanted)
            }
        }
    }
}

fn cleanup_expired_dirs_sync(base_dir: &Path) -> usize {
    if !base_dir.exists() {
        return 0;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let Ok(entries) = std::fs::read_dir(base_dir) else {
        return 0;
    };

    let mut removed = 0usize;
    for entry in entries.flatten() {
        let dir_path = entry.path();
        if !dir_path.is_dir() {
            continue;
        }

        let meta_path = dir_path.join(".metadata.json");
        let master_path = dir_path.join("master.m3u8");
        let is_expired = if meta_path.is_file() {
            match std::fs::read_to_string(&meta_path)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            {
                Some(meta) => {
                    let cached_at = meta.get("cached_at").and_then(|v| v.as_u64()).unwrap_or(0);
                    let exp = meta
                        .get("expires_at")
                        .and_then(|v| v.as_u64())
                        .unwrap_or_else(|| cached_at.saturating_add(MAX_CACHE_AGE_SECS))
                        .min(cached_at.saturating_add(MAX_CACHE_AGE_SECS));
                    now >= exp
                }
                None => true,
            }
        } else {
            let ref_path = if master_path.exists() {
                &master_path
            } else {
                &dir_path
            };
            ref_path
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| now >= d.as_secs().saturating_add(MAX_CACHE_AGE_SECS))
                .unwrap_or(false)
        };

        if is_expired && std::fs::remove_dir_all(&dir_path).is_ok() {
            removed += 1;
        }
    }
    removed
}

pub fn parse_master_and_extract_subs(
    content: &str,
    master_url: &Url,
) -> (String, Vec<(String, String)>) {
    parse_master_and_extract_subs_for_server(content, master_url, None)
}

#[allow(dead_code)]
fn local_playlist_name(filename: &str, server: Option<usize>) -> String {
    local_playlist_name_with_season(filename, None, server)
}

fn local_playlist_name_with_season(
    filename: &str,
    season: Option<i32>,
    server: Option<usize>,
) -> String {
    let has_season = season.is_some() && season.unwrap_or(1) > 1;
    let has_server = server.is_some() && server.unwrap_or(0) > 0;
    match (has_season, has_server) {
        (true, true) => format!(
            "{}?season={}&server={}",
            filename,
            season.unwrap_or(1),
            server.unwrap_or(0)
        ),
        (true, false) => format!("{}?season={}", filename, season.unwrap_or(1)),
        (false, true) => format!("{}?server={}", filename, server.unwrap_or(0)),
        (false, false) => filename.to_owned(),
    }
}

pub fn parse_master_and_extract_subs_for_server(
    content: &str,
    master_url: &Url,
    server: Option<usize>,
) -> (String, Vec<(String, String)>) {
    parse_master_and_extract_subs_for_season_server(content, master_url, None, server)
}

pub fn parse_master_and_extract_subs_for_season_server(
    content: &str,
    master_url: &Url,
    season: Option<i32>,
    server: Option<usize>,
) -> (String, Vec<(String, String)>) {
    let mut lines = Vec::new();
    let mut sub_playlists = Vec::new();
    let mut is_stream_inf = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            lines.push(line.to_string());
            continue;
        }

        if trimmed.starts_with("#EXT-X-STREAM-INF:") {
            is_stream_inf = true;
            lines.push(line.to_string());
            continue;
        }

        if is_stream_inf && !trimmed.starts_with('#') {
            is_stream_inf = false;
            let filename = extract_filename(trimmed);
            if is_safe_filename(&filename) && filename != ".metadata.json" && filename != "master.m3u8" {
                let full_url = resolve_relative_url(master_url, trimmed);
                sub_playlists.push((filename.clone(), full_url));
                lines.push(local_playlist_name_with_season(&filename, season, server));
            }
            continue;
        }

        if trimmed.starts_with('#') && trimmed.contains("URI=\"") {
            let rewritten_line = URI_REGEX.replace_all(line, |caps: &regex::Captures| {
                let sub_uri = &caps[1];
                let filename = extract_filename(sub_uri);
                if is_safe_filename(&filename)
                    && filename != ".metadata.json"
                    && filename != "master.m3u8"
                {
                    let full_url = resolve_relative_url(master_url, sub_uri);
                    sub_playlists.push((filename.clone(), full_url));
                    format!(
                        "URI=\"{}\"",
                        local_playlist_name_with_season(&filename, season, server)
                    )
                } else {
                    caps[0].to_string()
                }
            });
            lines.push(rewritten_line.to_string());
            continue;
        }

        lines.push(line.to_string());
    }

    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for (name, url) in sub_playlists {
        if seen.insert(name.clone()) {
            deduped.push((name, url));
        }
    }

    (lines.join("\n"), deduped)
}

pub fn process_sub_playlist(content: &str, sub_url: &Url) -> String {
    process_sub_playlist_for_server(content, sub_url, None)
}

pub fn process_sub_playlist_for_server(
    content: &str,
    sub_url: &Url,
    server: Option<usize>,
) -> String {
    process_sub_playlist_for_season_server(content, sub_url, None, server)
}

pub fn process_sub_playlist_for_season_server(
    content: &str,
    sub_url: &Url,
    season: Option<i32>,
    server: Option<usize>,
) -> String {
    let mut new_lines = Vec::new();
    for line in content.lines() {
        let stripped = line.trim();
        if stripped.is_empty() {
            new_lines.push(line.to_string());
            continue;
        }

        if stripped.starts_with('#') {
            if stripped.contains("URI=\"") {
                let rewritten = URI_REGEX.replace_all(line, |caps: &regex::Captures| {
                    let map_uri = &caps[1];
                    let clean = map_uri.split('?').next().unwrap_or(map_uri);
                    if clean.to_lowercase().ends_with(".vtt") {
                        let filename = extract_filename(map_uri);
                        if is_safe_filename(&filename) {
                            format!(
                                "URI=\"{}\"",
                                local_playlist_name_with_season(
                                    &format!("sub/{}", filename),
                                    season,
                                    server
                                )
                            )
                        } else {
                            caps[0].to_string()
                        }
                    } else if is_cdn_segment(map_uri) {
                        format!("URI=\"{}\"", map_uri)
                    } else {
                        let full = resolve_relative_url(sub_url, map_uri);
                        if is_cdn_segment(&full) {
                            format!("URI=\"{}\"", full)
                        } else {
                            format!(
                                "URI=\"/api/proxy/stream?url={}\"",
                                urlencoding::encode(&full)
                            )
                        }
                    }
                });
                new_lines.push(rewritten.to_string());
            } else {
                new_lines.push(line.to_string());
            }
        } else {
            let clean = stripped.split('?').next().unwrap_or(stripped);
            if clean.to_lowercase().ends_with(".vtt") {
                let filename = extract_filename(stripped);
                if is_safe_filename(&filename) {
                    new_lines.push(local_playlist_name_with_season(
                        &format!("sub/{}", filename),
                        season,
                        server,
                    ));
                }
            } else if is_cdn_segment(stripped) {
                new_lines.push(stripped.to_string());
            } else {
                let full = resolve_relative_url(sub_url, stripped);
                if is_cdn_segment(&full) {
                    new_lines.push(full);
                } else {
                    new_lines.push(format!(
                        "/api/proxy/stream?url={}",
                        urlencoding::encode(&full)
                    ));
                }
            }
        }
    }
    new_lines.join("\n")
}

/// Preserve `?ep=<ep>` on relative child playlist and subtitle URIs when `ep > 1` is passed via query string
/// on `/api/stream/:slug/master.m3u8?ep=2` (where `ep` is not embedded in the path).
fn append_ep_query_to_relative_playlist(content: &str, ep: Option<i32>) -> String {
    let Some(ep_val) = ep.filter(|&e| e > 1) else {
        return content.to_string();
    };

    let append_ep = |uri: &str| -> String {
        if uri.starts_with("http://")
            || uri.starts_with("https://")
            || uri.starts_with('/')
            || uri.contains("ep=")
        {
            uri.to_string()
        } else if uri.contains('?') {
            format!("{}&ep={}", uri, ep_val)
        } else {
            format!("{}?ep={}", uri, ep_val)
        }
    };

    content
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                line.to_string()
            } else if trimmed.starts_with('#') {
                if trimmed.contains("URI=\"") {
                    URI_REGEX
                        .replace_all(line, |caps: &regex::Captures| {
                            format!("URI=\"{}\"", append_ep(&caps[1]))
                        })
                        .to_string()
                } else {
                    line.to_string()
                }
            } else {
                append_ep(trimmed)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub async fn handle_stream_master(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Query(params): Query<StreamParams>,
) -> Response {
    if !is_safe_filename(&slug) {
        return (StatusCode::BAD_REQUEST, "Invalid slug parameter").into_response();
    }

    match state
        .playlist_cache
        .get_master_for_season_episode_server(
            &slug,
            params.ep,
            params.season,
            params.server,
            params.is_refresh(),
            Some(&state.db),
        )
        .await
    {
        Ok(content) => {
            let adjusted = append_ep_query_to_relative_playlist(&content, params.ep);
            create_playlist_response(adjusted, "application/vnd.apple.mpegurl; charset=utf-8")
        }
        Err((code, msg)) => (code, msg).into_response(),
    }
}

pub async fn handle_stream_master_ep(
    State(state): State<AppState>,
    AxumPath((slug, ep)): AxumPath<(String, i32)>,
    Query(params): Query<StreamParams>,
) -> Response {
    if !is_safe_filename(&slug) || ep <= 0 {
        return (StatusCode::BAD_REQUEST, "Invalid slug or episode parameter").into_response();
    }

    match state
        .playlist_cache
        .get_master_for_season_episode_server(
            &slug,
            Some(ep),
            params.season,
            params.server,
            params.is_refresh(),
            Some(&state.db),
        )
        .await
    {
        Ok(content) => {
            create_playlist_response(content, "application/vnd.apple.mpegurl; charset=utf-8")
        }
        Err((code, msg)) => (code, msg).into_response(),
    }
}

pub async fn handle_stream_file(
    State(state): State<AppState>,
    AxumPath((slug, file)): AxumPath<(String, String)>,
    Query(params): Query<StreamParams>,
) -> Response {
    if !is_safe_filename(&slug) || !is_safe_filename(&file) {
        return (StatusCode::BAD_REQUEST, "Invalid slug or file parameter").into_response();
    }

    if file == "master.m3u8" {
        return handle_stream_master(State(state), AxumPath(slug), Query(params)).await;
    }

    let content_type = if file.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl; charset=utf-8"
    } else if file.ends_with(".vtt") {
        "text/vtt; charset=utf-8"
    } else {
        "application/octet-stream"
    };

    match state
        .playlist_cache
        .get_file_for_season_episode_server(
            &slug,
            params.ep,
            params.season,
            params.server,
            &file,
            Some(&state.db),
        )
        .await
    {
        Ok(content) => {
            let body = if file.ends_with(".m3u8") {
                append_ep_query_to_relative_playlist(&content, params.ep)
            } else {
                content
            };
            create_playlist_response(body, content_type)
        }
        Err((code, msg)) => (code, msg).into_response(),
    }
}

pub async fn handle_stream_file_ep(
    State(state): State<AppState>,
    AxumPath((slug, ep, file)): AxumPath<(String, i32, String)>,
    Query(params): Query<StreamParams>,
) -> Response {
    if !is_safe_filename(&slug) || !is_safe_filename(&file) || ep <= 0 {
        return (
            StatusCode::BAD_REQUEST,
            "Invalid slug, episode, or file parameter",
        )
            .into_response();
    }

    if file == "master.m3u8" {
        return handle_stream_master_ep(State(state), AxumPath((slug, ep)), Query(params)).await;
    }

    let content_type = if file.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl; charset=utf-8"
    } else if file.ends_with(".vtt") {
        "text/vtt; charset=utf-8"
    } else {
        "application/octet-stream"
    };

    match state
        .playlist_cache
        .get_file_for_season_episode_server(
            &slug,
            Some(ep),
            params.season,
            params.server,
            &file,
            Some(&state.db),
        )
        .await
    {
        Ok(content) => create_playlist_response(content, content_type),
        Err((code, msg)) => (code, msg).into_response(),
    }
}

pub async fn handle_stream_sub(
    State(state): State<AppState>,
    AxumPath((slug, file)): AxumPath<(String, String)>,
    Query(params): Query<StreamParams>,
) -> Response {
    if !is_safe_filename(&slug) || !is_safe_filename(&file) {
        return (StatusCode::BAD_REQUEST, "Invalid slug or file parameter").into_response();
    }

    match state
        .playlist_cache
        .get_sub_for_season_episode_server_with_db(
            &slug,
            params.ep,
            params.season,
            params.server,
            &file,
            Some(&state.db),
        )
        .await
    {
        Ok(content) => create_playlist_response(content, "text/vtt; charset=utf-8"),
        Err((code, msg)) => (code, msg).into_response(),
    }
}

pub async fn handle_stream_sub_ep(
    State(state): State<AppState>,
    AxumPath((slug, ep, file)): AxumPath<(String, i32, String)>,
    Query(params): Query<StreamParams>,
) -> Response {
    if !is_safe_filename(&slug) || !is_safe_filename(&file) || ep <= 0 {
        return (
            StatusCode::BAD_REQUEST,
            "Invalid slug, episode, or file parameter",
        )
            .into_response();
    }

    match state
        .playlist_cache
        .get_sub_for_season_episode_server_with_db(
            &slug,
            Some(ep),
            params.season,
            params.server,
            &file,
            Some(&state.db),
        )
        .await
    {
        Ok(content) => create_playlist_response(content, "text/vtt; charset=utf-8"),
        Err((code, msg)) => (code, msg).into_response(),
    }
}

pub fn create_playlist_response(content: String, content_type: &'static str) -> Response {
    let mut resp = Response::new(Body::from(content));
    let headers_mut = resp.headers_mut();
    headers_mut.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type),
    );
    headers_mut.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers_mut.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers_mut.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("*"),
    );
    headers_mut.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );
    add_security_headers(headers_mut);
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_filename_and_base_slug() {
        assert_eq!(extract_filename("v0.m3u8"), "v0.m3u8");
        assert_eq!(extract_filename("/api/hls/TOKEN/a0.m3u8"), "a0.m3u8");
        assert_eq!(
            extract_filename("/api/hls/TOKEN/a0.m3u8?token=123"),
            "a0.m3u8"
        );
        assert_eq!(extract_filename("https://domain.com/hls/sub.vtt"), "sub.vtt");

        assert_eq!(extract_base_slug_from_cache_dir("interstellar"), "interstellar");
        assert_eq!(
            extract_base_slug_from_cache_dir("breaking-bad_ep2"),
            "breaking-bad"
        );
        assert_eq!(
            extract_base_slug_from_cache_dir("breaking-bad_ep2_srv1"),
            "breaking-bad"
        );
        assert_eq!(
            extract_base_slug_from_cache_dir("friends_s2_ep25_srv2"),
            "friends"
        );
        assert!(!slug_matches_cache_dir_name("dune-part-two", "dune"));
        assert!(slug_matches_cache_dir_name("dune_ep2", "dune"));
    }

    #[test]
    fn test_is_safe_filename() {
        assert!(is_safe_filename("master.m3u8"));
        assert!(is_safe_filename("light-to-the-night"));
        assert!(is_safe_filename("v0.m3u8"));
        assert!(is_safe_filename("a0.m3u8"));
        assert!(is_safe_filename("sub_01.vtt"));

        assert!(!is_safe_filename(""));
        assert!(!is_safe_filename("../etc/passwd"));
        assert!(!is_safe_filename("dir/file.m3u8"));
        assert!(!is_safe_filename("dir\\file.m3u8"));
    }

    #[test]
    fn test_parse_master_rewriting_and_unsafe_child_rejection() {
        let master = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Chi",URI="/api/hls/TOKEN123/a0.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="Vi",URI="/api/hls/TOKEN123/s0.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
/api/hls/TOKEN123/v.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
/api/hls/TOKEN123/.metadata.json
"#;
        let base_url = Url::parse("https://fiml4k.fun/api/hls/TOKEN123/master.m3u8").unwrap();
        let (rewritten, subs) = parse_master_and_extract_subs(master, &base_url);

        assert!(rewritten.contains(r#"URI="a0.m3u8""#));
        assert!(rewritten.contains(r#"URI="s0.m3u8""#));
        assert!(rewritten.contains("\nv.m3u8"));
        assert!(!rewritten.contains(".metadata.json"));

        assert_eq!(subs.len(), 3);
        assert_eq!(subs[0].0, "a0.m3u8");
        assert_eq!(subs[0].1, "https://fiml4k.fun/api/hls/TOKEN123/a0.m3u8");
        assert_eq!(subs[1].0, "s0.m3u8");
        assert_eq!(subs[2].0, "v.m3u8");

        let (server_master, _) =
            parse_master_and_extract_subs_for_server(master, &base_url, Some(2));
        assert!(server_master.contains(r#"URI="a0.m3u8?server=2""#));
        assert!(server_master.contains("\nv.m3u8?server=2"));
    }

    #[test]
    fn test_process_sub_playlist_preserves_bytedance_cdn_and_proxies_non_cdn() {
        let sub = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI="https://p19-ad-site-sign-sg.tiktokcdn.com/map.image?x-expires=1824367135"
#EXT-X-KEY:METHOD=AES-128,URI="/api/hls/TOKEN/enc.key"
#EXTINF:24.56,
https://p16-ad-site-sign-sg.tiktokcdn.com/chunk01.image?lk3s=6d71dd51&x-expires=1824366813
#EXTINF:10.0,
relative_segment.ts
"#;
        let sub_url = Url::parse("https://fiml4k.fun/api/hls/TOKEN/v.m3u8").unwrap();
        let processed = process_sub_playlist(sub, &sub_url);

        assert!(processed.contains(
            "https://p19-ad-site-sign-sg.tiktokcdn.com/map.image?x-expires=1824367135"
        ));
        assert!(processed.contains(
            "https://p16-ad-site-sign-sg.tiktokcdn.com/chunk01.image?lk3s=6d71dd51&x-expires=1824366813"
        ));
        assert!(processed.contains(
            r#"URI="/api/proxy/stream?url=https%3A%2F%2Ffiml4k.fun%2Fapi%2Fhls%2FTOKEN%2Fenc.key""#
        ));
        assert!(processed.contains(
            "/api/proxy/stream?url=https%3A%2F%2Ffiml4k.fun%2Fapi%2Fhls%2FTOKEN%2Frelative_segment.ts"
        ));
    }

    #[test]
    fn test_cache_slug_dir_isolation() {
        let cache = PlaylistCache::new("/tmp/test_cache");
        assert_eq!(
            cache.cache_slug_dir("breaking-bad", None),
            PathBuf::from("/tmp/test_cache/breaking-bad")
        );
        assert_eq!(
            cache.cache_slug_dir("breaking-bad", Some(1)),
            PathBuf::from("/tmp/test_cache/breaking-bad")
        );
        assert_eq!(
            cache.cache_slug_dir("breaking-bad", Some(2)),
            PathBuf::from("/tmp/test_cache/breaking-bad_ep2")
        );
        assert_eq!(
            cache.master_path_for_ep("breaking-bad", Some(2)),
            PathBuf::from("/tmp/test_cache/breaking-bad_ep2/master.m3u8")
        );
        assert_eq!(
            cache.file_path_for_ep("breaking-bad", Some(2), "v0.m3u8"),
            PathBuf::from("/tmp/test_cache/breaking-bad_ep2/v0.m3u8")
        );
        assert_eq!(
            cache.cache_slug_dir_with_server("breaking-bad", None, Some(0)),
            PathBuf::from("/tmp/test_cache/breaking-bad")
        );
        assert_eq!(
            cache.cache_slug_dir_with_server("breaking-bad", None, Some(1)),
            PathBuf::from("/tmp/test_cache/breaking-bad_srv1")
        );
        assert_eq!(
            cache.cache_slug_dir_with_server("breaking-bad", Some(2), Some(1)),
            PathBuf::from("/tmp/test_cache/breaking-bad_ep2_srv1")
        );
        assert_eq!(
            cache.master_path_for_ep_server("breaking-bad", Some(2), Some(1)),
            PathBuf::from("/tmp/test_cache/breaking-bad_ep2_srv1/master.m3u8")
        );
        assert_eq!(
            cache.cache_slug_dir_with_season_server("friends", Some(5), Some(1), None),
            PathBuf::from("/tmp/test_cache/friends_ep5")
        );
        assert_eq!(
            cache.cache_slug_dir_with_season_server("friends", Some(1), Some(2), None),
            PathBuf::from("/tmp/test_cache/friends_s2_ep1")
        );
        assert_eq!(
            cache.cache_slug_dir_with_season_server("friends", Some(25), Some(2), None),
            PathBuf::from("/tmp/test_cache/friends_s2_ep25")
        );
        assert_eq!(
            cache.master_path_for_season_ep_server("friends", Some(25), Some(2), None),
            PathBuf::from("/tmp/test_cache/friends_s2_ep25/master.m3u8")
        );
        assert_eq!(
            cache.file_path_for_season_ep_server("friends", Some(25), Some(2), None, "v0.m3u8"),
            PathBuf::from("/tmp/test_cache/friends_s2_ep25/v0.m3u8")
        );
        assert_eq!(
            cache.cache_slug_dir_with_season_server("friends", Some(25), Some(2), Some(2)),
            PathBuf::from("/tmp/test_cache/friends_s2_ep25_srv2")
        );
    }

    #[test]
    fn test_parse_master_and_process_sub_with_season() {
        let master = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="Vi",URI="/api/hls/TOKEN123/s0.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
/api/hls/TOKEN123/v0.m3u8
"#;
        let base_url = Url::parse("https://fiml4k.fun/api/hls/TOKEN123/master.m3u8").unwrap();

        let (season2_master, _) =
            parse_master_and_extract_subs_for_season_server(master, &base_url, Some(2), None);
        assert!(season2_master.contains(r#"URI="s0.m3u8?season=2""#));
        assert!(season2_master.contains("\nv0.m3u8?season=2"));

        let (season2_srv1_master, _) =
            parse_master_and_extract_subs_for_season_server(master, &base_url, Some(2), Some(1));
        assert!(season2_srv1_master.contains(r#"URI="s0.m3u8?season=2&server=1""#));
        assert!(season2_srv1_master.contains("\nv0.m3u8?season=2&server=1"));

        let (season1_master, _) =
            parse_master_and_extract_subs_for_season_server(master, &base_url, Some(1), None);
        assert!(season1_master.contains(r#"URI="s0.m3u8""#));
        assert!(season1_master.contains("\nv0.m3u8"));

        let sub = r#"#EXTM3U
#EXTINF:30.0,
vietnamese_sub.vtt
"#;
        let sub_url = Url::parse("https://fiml4k.fun/api/hls/TOKEN123/s0.m3u8").unwrap();
        let processed = process_sub_playlist_for_season_server(sub, &sub_url, Some(2), None);
        assert!(processed.contains("sub/vietnamese_sub.vtt?season=2"));
    }

    #[test]
    fn test_extract_expiration_timestamp() {
        let url_with_exp = "https://film4k.net/api/hls/master.m3u8?x-expires=1789000000";
        assert_eq!(extract_expiration_timestamp("", url_with_exp), Some(1789000000));

        let url_with_alt_exp = "https://film4k.net/api/hls/master.m3u8?expires=1789111111";
        assert_eq!(
            extract_expiration_timestamp("", url_with_alt_exp),
            Some(1789111111)
        );

        let m3u8_body =
            "#EXTM3U\n#EXTINF:10.0,\nhttps://cdn.example.com/seg.ts?x-expires=1789222222&key=val\n";
        assert_eq!(
            extract_expiration_timestamp(m3u8_body, "https://film4k.net/master.m3u8"),
            Some(1789222222)
        );

        let m3u8_body_alt =
            "#EXTM3U\n#EXTINF:10.0,\nhttps://cdn.example.com/seg.ts?expires=1789333333&key=val\n";
        assert_eq!(
            extract_expiration_timestamp(m3u8_body_alt, "https://film4k.net/master.m3u8"),
            Some(1789333333)
        );

        let m3u8_quoted =
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://cdn.example.com/key?expires=1789444444&id=1\"\n";
        assert_eq!(
            extract_expiration_timestamp(m3u8_quoted, "https://film4k.net/master.m3u8"),
            Some(1789444444)
        );

        let duplicate = "https://film4k.net/master.m3u8?expires=1789444444&expires=1789000001";
        assert_eq!(extract_expiration_timestamp("", duplicate), Some(1789000001));
        let encoded = "#EXT-X-MAP:URI=\"https://film4k.net/map.mp4?next=1%26x-expires%3D1789000002\"";
        assert_eq!(extract_expiration_timestamp(encoded, duplicate), Some(1789000001));
        assert_eq!(extract_expiration_timestamp(encoded, ""), Some(1789000002));
        let double_encoded = "https://film4k.net/x?next=x%252Dexpires%253D1789000003";
        assert_eq!(
            extract_expiration_timestamp("", double_encoded),
            Some(1789000003)
        );

        let no_exp = "https://film4k.net/api/hls/master.m3u8";
        assert_eq!(extract_expiration_timestamp("#EXTM3U\n", no_exp), None);
    }

    #[tokio::test]
    async fn test_episode_greater_than_one_never_falls_back_to_episode_one() {
        let db = Database::new_in_memory().unwrap();
        let cache = PlaylistCache::new("/tmp/test_cache_never_fallback");

        let res = cache
            .crawl_and_cache_for_episode("breaking-bad", Some(99), Some(&db))
            .await;

        assert!(res.is_err());
        let (status, msg) = res.unwrap_err();
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(msg, "Episode 99 for slug 'breaking-bad' is not available");
    }

    #[tokio::test]
    async fn test_legacy_cache_without_metadata_backfill_and_expiry() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_cache_legacy_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cache = PlaylistCache::new(&temp_dir);
        let slug = "test-movie";
        let slug_dir = cache.cache_slug_dir(slug, None);
        tokio::fs::create_dir_all(&slug_dir).await.unwrap();

        let future_exp = 2100000000u64;
        let master_content = format!(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhttps://cdn.example.com/v0.m3u8?x-expires={}\n",
            future_exp
        );
        tokio::fs::write(cache.master_path(slug), &master_content)
            .await
            .unwrap();

        let meta_path = slug_dir.join(".metadata.json");
        assert!(!meta_path.exists());

        let result = cache.get_master(slug, false, None).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), master_content);

        assert!(meta_path.exists());
        let meta_str = tokio::fs::read_to_string(&meta_path).await.unwrap();
        let meta_json: serde_json::Value = serde_json::from_str(&meta_str).unwrap();
        let expires_at = meta_json.get("expires_at").and_then(|v| v.as_u64()).unwrap();
        assert!(expires_at < future_exp);
        assert!(
            expires_at
                <= meta_json
                    .get("cached_at")
                    .and_then(|v| v.as_u64())
                    .unwrap()
                    + MAX_CACHE_AGE_SECS
        );

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_existing_metadata_null_expires_at_ttl_expiry_and_disk_cleanup() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_cache_null_exp_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cache = PlaylistCache::new(&temp_dir);
        let slug = "null-exp-movie";
        let slug_dir = cache.cache_slug_dir(slug, None);
        tokio::fs::create_dir_all(&slug_dir).await.unwrap();

        let master_content = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nv0.m3u8\n";
        tokio::fs::write(cache.master_path(slug), master_content)
            .await
            .unwrap();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let fresh_meta = serde_json::json!({
            "cached_at": now.saturating_sub(1800),
            "expires_at": serde_json::Value::Null,
            "source_url": "https://fiml4k.fun/api/stream.m3u8"
        });
        let meta_path = slug_dir.join(".metadata.json");
        tokio::fs::write(&meta_path, fresh_meta.to_string())
            .await
            .unwrap();

        let fresh_res = cache.get_master(slug, false, None).await;
        assert!(fresh_res.is_ok());
        assert_eq!(fresh_res.unwrap(), master_content);

        let expired_meta = serde_json::json!({
            "cached_at": now.saturating_sub(5 * 3600),
            "expires_at": serde_json::Value::Null,
            "source_url": "https://fiml4k.fun/api/stream.m3u8"
        });
        tokio::fs::write(&meta_path, expired_meta.to_string())
            .await
            .unwrap();

        let expired_res = cache.get_master(slug, false, None).await;
        assert!(expired_res.is_err());

        // Disk cleanup evicts expired directory
        let removed = cache.cleanup_expired_disk_cache().await;
        assert_eq!(removed, 1);
        assert!(!slug_dir.exists());

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[test]
    fn test_process_sub_playlist_rewrites_vtt_subtitles() {
        let sub = r#"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:30
#EXTINF:30.000,
https://fiml4k.fun/api/subs/vietnamese_123.vtt
#EXTINF:30.000,
/api/subs/english_456.vtt?token=xyz
#EXTINF:30.000,
relative_789.vtt
#EXT-X-MAP:URI="https://fiml4k.fun/api/subs/map_sub.vtt"
"#;
        let sub_url = Url::parse("https://fiml4k.fun/api/hls/TOKEN/s0.m3u8").unwrap();
        let processed = process_sub_playlist(sub, &sub_url);

        assert!(processed.contains("sub/vietnamese_123.vtt"));
        assert!(processed.contains("sub/english_456.vtt"));
        assert!(processed.contains("sub/relative_789.vtt"));
        assert!(processed.contains(r#"URI="sub/map_sub.vtt""#));
    }

    #[tokio::test]
    async fn test_get_sub_for_episode_cached_disk_and_non_db_rejection() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_cache_sub_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cache = PlaylistCache::new(&temp_dir);
        let slug = "my-movie";

        let sub_dir = cache.cache_slug_dir(slug, None).join("sub");
        tokio::fs::create_dir_all(&sub_dir).await.unwrap();
        let vtt_content = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello World\n";
        tokio::fs::write(sub_dir.join("sub_vi.vtt"), vtt_content)
            .await
            .unwrap();

        let res = cache.get_sub_for_episode(slug, None, "sub_vi.vtt").await;
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), vtt_content);

        let ep2_sub_dir = cache.cache_slug_dir(slug, Some(2)).join("sub");
        tokio::fs::create_dir_all(&ep2_sub_dir).await.unwrap();
        let ep2_vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nEpisode 2 Sub\n";
        tokio::fs::write(ep2_sub_dir.join("ep2_sub.vtt"), ep2_vtt)
            .await
            .unwrap();

        let res_ep2 = cache
            .get_sub_for_episode(slug, Some(2), "ep2_sub.vtt")
            .await;
        assert!(res_ep2.is_ok());
        assert_eq!(res_ep2.unwrap(), ep2_vtt);

        // Non-existent movie in DB fails closed with 404 before creating cache directories
        let db = Database::new_in_memory().unwrap();
        let miss = cache
            .get_sub_for_season_episode_server_with_db(
                "missing-slug",
                Some(5),
                Some(2),
                Some(3),
                "sub_vi.vtt",
                Some(&db),
            )
            .await;
        assert_eq!(miss.unwrap_err().0, StatusCode::NOT_FOUND);
        assert!(
            !cache
                .cache_slug_dir_with_season_server("missing-slug", Some(5), Some(2), Some(3))
                .exists()
        );

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }
}
