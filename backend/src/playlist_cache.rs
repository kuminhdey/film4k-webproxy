use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use regex::Regex;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, RwLock};
use std::time::{Duration, Instant};
use tracing::{error, info, warn};
use url::Url;

use crate::{
    db::Database,
    proxy::{
        add_security_headers, fetch_upstream_title_hls, is_cdn_segment, is_valid_remote_url,
        read_body_with_cap, redact_url_secrets, resolve_and_validate_host, resolve_relative_url,
        MAX_PLAYLIST_BYTES,
    },
    AppState,
};

static URI_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"URI="([^"]+)""#).unwrap());
static EXPIRES_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)(?:^|[?&;,=\"'\s])(?:x-expires|expires)=([0-9]{1,13})"#).unwrap()
});

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
        && name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
}

pub fn extract_filename(uri: &str) -> String {
    let clean = uri.split('?').next().unwrap_or(uri);
    clean.rsplit('/').next().unwrap_or(clean).to_string()
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
                if let (Some(high), Some(low)) = (digit(bytes[index + 1]), digit(bytes[index + 2])) {
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
                earliest = Some(earliest.map_or(timestamp, |current: u64| current.min(timestamp)));
            }
        }
        let decoded = decode_once(&text);
        if decoded == text { break; }
        text = decoded;
    }
    earliest
}

#[derive(Clone, Debug)]
pub struct PlaylistCache {
    base_dir: PathBuf,
    cache: Arc<RwLock<HashMap<String, (String, Instant)>>>,
}

pub type PlaylistCacheService = PlaylistCache;

impl Default for PlaylistCache {
    fn default() -> Self {
        let path = std::env::var("PLAYLISTS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/playlists"));
        Self {
            base_dir: path,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl PlaylistCache {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn get_memory(&self, key: &str) -> Option<String> {
        let guard = self.cache.read().ok()?;
        guard.get(key).map(|(v, _)| v.clone())
    }

    pub fn set_memory(&self, key: String, value: String) {
        if let Ok(mut guard) = self.cache.write() {
            guard.insert(key, (value, Instant::now()));
        }
    }

    pub fn prune_memory_cache(&self, max_age: Duration) {
        if let Ok(mut guard) = self.cache.write() {
            let now = Instant::now();
            guard.retain(|_, (_, time)| now.duration_since(*time) < max_age);
        }
    }

    pub fn start_cleanup_task(&self, db: Database) {
        let service = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(3600));
            loop {
                interval.tick().await;
                match db.cleanup_expired_playlist_cache() {
                    Ok(deleted) => {
                        if deleted > 0 {
                            info!("🧹 Purged {} expired playlist cache entries from SQLite", deleted);
                        }
                    }
                    Err(e) => {
                        warn!("Failed to cleanup expired playlist cache from SQLite: {}", e);
                    }
                }
                service.prune_memory_cache(Duration::from_secs(24 * 3600));
            }
        });
    }

    pub fn base_dir(&self) -> PathBuf {
        self.base_dir.clone()
    }

    pub fn cache_slug_dir_with_server(&self, slug: &str, ep: Option<i32>, server: Option<usize>) -> PathBuf {
        let srv_suffix = match server {
            Some(s) if s > 0 => format!("_srv{}", s),
            _ => String::new(),
        };
        match ep {
            Some(e) if e > 1 => self.base_dir.join(format!("{}_ep{}{}", slug, e, srv_suffix)),
            _ => {
                if srv_suffix.is_empty() {
                    self.base_dir.join(slug)
                } else {
                    self.base_dir.join(format!("{}{}", slug, srv_suffix))
                }
            }
        }
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

    pub fn master_path_for_ep_server(&self, slug: &str, ep: Option<i32>, server: Option<usize>) -> PathBuf {
        self.cache_slug_dir_with_server(slug, ep, server).join("master.m3u8")
    }

    pub fn file_path(&self, slug: &str, file: &str) -> PathBuf {
        self.file_path_for_ep_server(slug, None, None, file)
    }

    pub fn file_path_for_ep(&self, slug: &str, ep: Option<i32>, file: &str) -> PathBuf {
        self.file_path_for_ep_server(slug, ep, None, file)
    }

    pub fn file_path_for_ep_server(&self, slug: &str, ep: Option<i32>, server: Option<usize>, file: &str) -> PathBuf {
        self.cache_slug_dir_with_server(slug, ep, server).join(file)
    }

    pub fn cache_count(&self) -> usize {
        std::fs::read_dir(&self.base_dir)
            .map(|entries| entries.filter_map(Result::ok).count())
            .unwrap_or(0)
    }

    pub async fn clear_slug(&self, slug: &str) -> std::io::Result<()> {
        let dir = self.slug_dir(slug);
        if dir.exists() {
            tokio::fs::remove_dir_all(dir).await
        } else {
            Ok(())
        }
    }

    pub async fn prewarm_hot_movies(&self, slugs: &[String], db: &Database) {
        if slugs.is_empty() {
            return;
        }
        info!("🚀 [Prewarm] Starting zero-delay HLS prewarming for {} hot movies...", slugs.len());
        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(3));
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
        self.get_master_for_episode_server(slug, ep, None, refresh, db).await
    }

    pub async fn get_master_for_episode_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        server: Option<usize>,
        refresh: bool,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        let master_file = self.master_path_for_ep_server(slug, ep, server);
        let slug_dir = self.cache_slug_dir_with_server(slug, ep, server);

        if !refresh && master_file.exists() {
            // Check signed URL expiration via metadata or file inspection
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
                                        m.modified().ok()
                                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                            .map(|d| d.as_secs())
                                    })
                                })
                                .unwrap_or(0);
                            if let Some(exp) = meta_json.get("expires_at").and_then(|v| v.as_u64()) {
                                let bounded_exp = exp.min(cached_at.saturating_add(MAX_CACHE_AGE_SECS));
                                if now >= bounded_exp.saturating_sub(60) {
                                    is_expired = true;
                                    warn!("Cached master playlist for '{:?}' expired. Re-fetching...", slug);
                                }
                            } else {
                                // expires_at is null, missing, or invalid: apply bounded TTL
                                if now >= cached_at.saturating_add(MAX_CACHE_AGE_SECS) {
                                    is_expired = true;
                                    warn!("Cached master playlist for '{:?}' with null expires_at exceeded max TTL (cached_at: {}). Re-fetching...", slug, cached_at);
                                }
                            }
                        }
                        Err(err) => {
                            // Corrupted metadata: fail closed
                            warn!("Corrupted .metadata.json for '{:?}': {}. Re-fetching...", slug, err);
                            is_expired = true;
                        }
                    },
                    Err(err) => {
                        // Unreadable metadata: fail closed
                        warn!("Failed to read .metadata.json for '{:?}': {}. Re-fetching...", slug, err);
                        is_expired = true;
                    }
                }
            } else {
                // Existing cache without .metadata.json
                if let Ok(content) = tokio::fs::read_to_string(&master_file).await {
                    let mut detected_exp = extract_expiration_timestamp(&content, "");
                    if detected_exp.is_none() {
                        if let Ok(mut entries) = tokio::fs::read_dir(&slug_dir).await {
                            while let Ok(Some(entry)) = entries.next_entry().await {
                                let fname = entry.file_name().to_string_lossy().to_string();
                                if fname.ends_with(".m3u8") && fname != "master.m3u8" {
                                    if let Ok(sub_content) = tokio::fs::read_to_string(entry.path()).await {
                                        if let Some(exp) = extract_expiration_timestamp(&sub_content, "") {
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
                        let cached_at = master_file.metadata().ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        let bounded_exp = exp.min(cached_at.saturating_add(MAX_CACHE_AGE_SECS));
                        if now >= bounded_exp.saturating_sub(60) {
                            is_expired = true;
                            warn!("Legacy cached playlist for '{:?}' expired. Re-fetching...", slug);
                        } else {
                            // Backfill metadata with detected timestamp
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
                                warn!("Legacy cached master playlist for '{:?}' is older than 4h (mtime: {}). Re-fetching...", slug, mtime_secs);
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
            }

            if !is_expired {
                if let Ok(content) = tokio::fs::read_to_string(&master_file).await {
                    if content.trim().starts_with("#EXTM3U") {
                        return Ok(content);
                    }
                }
            }
            warn!(
                "Cached master.m3u8 for slug '{}' (ep: {:?}, server: {:?}) is stale or corrupt. Re-crawling...",
                slug, ep, server
            );
        }

        self.crawl_and_cache_for_episode_server(slug, ep, server, db).await
    }

    pub async fn get_file(
        &self,
        slug: &str,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.get_file_for_episode_server(slug, None, None, file, db).await
    }

    pub async fn get_file_for_episode(
        &self,
        slug: &str,
        ep: Option<i32>,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.get_file_for_episode_server(slug, ep, None, file, db).await
    }

    pub async fn get_file_for_episode_server(
        &self,
        slug: &str,
        ep: Option<i32>,
        server: Option<usize>,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        let file_path = self.file_path_for_ep_server(slug, ep, server, file);

        if file_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&file_path).await {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }

        // Also check if cached in sub/ directory
        let sub_file = self.cache_slug_dir_with_server(slug, ep, server).join("sub").join(file);
        if sub_file.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&sub_file).await {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }

        // If file is a .vtt subtitle, fetch upstream via subtitle proxy
        if file.ends_with(".vtt") {
            return self.get_sub_for_episode_server(slug, ep, server, file).await;
        }

        // Self-healing: if file is not found, attempt crawl
        info!(
            "Sub-playlist file '{}' not found on disk for slug '{}' (ep: {:?}, server: {:?}). Attempting self-healing crawl...",
            file, slug, ep, server
        );
        let _ = self.crawl_and_cache_for_episode_server(slug, ep, server, db).await;

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
        let slug_dir = self.cache_slug_dir_with_server(slug, ep, server);
        let sub_dir = slug_dir.join("sub");
        let sub_file = sub_dir.join(file);
        let direct_file = slug_dir.join(file);

        // 1. Check if already cached on disk
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

        // 2. Fetch upstream https://fiml4k.fun/api/subs/<filename> with SSRF check and DNS pinning
        let upstream_url = format!("https://fiml4k.fun/api/subs/{}", file);
        let parsed_url = is_valid_remote_url(&upstream_url).map_err(|e| {
            (
                StatusCode::FORBIDDEN,
                format!("Subtitle URL rejected by SSRF security policy: {}", e),
            )
        })?;

        let host = parsed_url.host_str().unwrap_or("fiml4k.fun");
        let port = parsed_url.port_or_known_default().unwrap_or(443);
        let resolved_addr = resolve_and_validate_host(host, port).await.map_err(|e| {
            (
                StatusCode::FORBIDDEN,
                format!("Subtitle host DNS resolution failed or blocked: {}", e),
            )
        })?;

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .resolve(host, resolved_addr)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default();

        let resp = client
            .get(parsed_url.as_str())
            .header(header::REFERER, "https://fiml4k.fun/")
            .header(
                header::USER_AGENT,
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
            )
            .send()
            .await
            .map_err(|_| {
                let redacted = redact_url_secrets(&upstream_url);
                (
                    StatusCode::BAD_GATEWAY,
                    format!("Failed to fetch upstream subtitle from {}", redacted),
                )
            })?;

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
            .and_then(|body| String::from_utf8(body).map_err(|_| {
                (StatusCode::BAD_GATEWAY, "Invalid UTF-8 subtitle".to_string())
            }))?;

        // 3. Cache to disk
        if let Err(e) = tokio::fs::create_dir_all(&sub_dir).await {
            warn!("Failed to create sub directory {:?}: {}", sub_dir, e);
        }
        if let Err(e) = tokio::fs::write(&sub_file, &content).await {
            warn!("Failed to cache subtitle file {:?}: {}", sub_file, e);
        }

        info!(
            "Successfully fetched and cached subtitle '{}' for slug '{}' (ep: {:?}, server: {:?})",
            file, slug, ep, server
        );
        Ok(content)
    }

    pub async fn crawl_and_cache(
        &self,
        slug: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.crawl_and_cache_for_episode_server(slug, None, None, db).await
    }

    pub async fn crawl_and_cache_for_episode(
        &self,
        slug: &str,
        ep_num: Option<i32>,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.crawl_and_cache_for_episode_server(slug, ep_num, None, db).await
    }

    pub async fn crawl_and_cache_for_episode_server(
        &self,
        slug: &str,
        ep_num: Option<i32>,
        server: Option<usize>,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        info!("Crawling upstream playlists for slug '{}' (ep: {:?}, server: {:?})...", slug, ep_num, server);

        // An explicit episode/server never falls back to another source.
        let requested_server = server.unwrap_or(0);
        let db_source = db
            .and_then(|database| database.get_movie_by_slug(slug).ok().flatten())
            .and_then(|movie| {
                let episode = movie.episodes.iter().find(|ep| ep.episode == ep_num.unwrap_or(1))?;
                episode.sources.get(requested_server)
                    .filter(|source| !source.hls_url.trim().is_empty())
                    .map(|source| source.hls_url.clone())
                    .or_else(|| episode.servers.get(requested_server)
                        .filter(|source| !source.hls_url.trim().is_empty())
                        .map(|source| source.hls_url.clone()))
            });
        let master_hls_url = if requested_server > 0 || ep_num.unwrap_or(1) > 1 {
            db_source.ok_or_else(|| (StatusCode::NOT_FOUND,
                if requested_server == 0 {
                    format!("Episode {} for slug '{}' is not available", ep_num.unwrap_or(1), slug)
                } else {
                    format!("Episode {}, server {} for slug '{}' is not available", ep_num.unwrap_or(1), requested_server, slug)
                }))?
        } else {
            match fetch_upstream_title_hls(slug).await {
                Some(url) => url,
                None => db_source.or_else(|| db.and_then(|database|
                    database.get_movie_by_slug(slug).ok().flatten()
                        .and_then(|movie| movie.stream)
                        .and_then(|stream| stream.as_str().map(str::to_owned)
                            .or_else(|| stream.get("hlsUrl").and_then(|url| url.as_str()).map(str::to_owned)))))
                    .ok_or_else(|| (StatusCode::NOT_FOUND,
                        format!("No HLS stream URL available for slug '{}'", slug)))?,
            }
        };

        // SSRF check on master_hls_url
        let master_url_parsed = is_valid_remote_url(&master_hls_url).map_err(|e| {
            (
                StatusCode::FORBIDDEN,
                format!("Master HLS URL rejected by SSRF security policy: {}", e),
            )
        })?;

        let host = master_url_parsed.host_str().ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "Master HLS URL missing host".to_string(),
            )
        })?;
        let port = master_url_parsed.port_or_known_default().unwrap_or(443);
        let resolved_addr = resolve_and_validate_host(host, port).await.map_err(|e| {
            (
                StatusCode::FORBIDDEN,
                format!("Master HLS host DNS resolution failed or blocked: {}", e),
            )
        })?;

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .resolve(host, resolved_addr)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to build pinned HTTP client: {}", e),
                )
            })?;

        let master_resp = client
            .get(master_url_parsed.as_str())
            .header(header::REFERER, "https://fiml4k.fun/")
            .header(
                header::USER_AGENT,
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
            )
            .send()
            .await
            .map_err(|_| {
                let redacted = redact_url_secrets(&master_hls_url);
                error!("Failed to fetch upstream master playlist for {}", redacted);
                (
                    StatusCode::BAD_GATEWAY,
                    "Failed to connect to upstream master playlist".to_string(),
                )
            })?;

        if !master_resp.status().is_success() {
            return Err((
                StatusCode::BAD_GATEWAY,
                format!("Upstream master playlist returned status {}", master_resp.status()),
            ));
        }

        let master_body = read_body_with_cap(master_resp, MAX_PLAYLIST_BYTES)
            .await
            .map_err(|(code, message)| (code, message.to_string()))
            .and_then(|body| String::from_utf8(body).map_err(|_| {
                (StatusCode::BAD_GATEWAY, "Invalid UTF-8 playlist".to_string())
            }))?;

        if !master_body.trim().starts_with("#EXTM3U") {
            return Err((
                StatusCode::BAD_GATEWAY,
                "Upstream master response is not a valid M3U8 playlist".to_string(),
            ));
        }

        // Parse and rewrite master, extract sub-playlists
        let (rewritten_master, sub_playlists) =
            parse_master_and_extract_subs_for_server(&master_body, &master_url_parsed, server);

        // Ensure local directory exists for this episode & server
        let slug_dir = self.cache_slug_dir_with_server(slug, ep_num, server);
        tokio::fs::create_dir_all(&slug_dir).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create playlist directory: {}", e),
            )
        })?;

        // Extract expiration timestamp
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut expires_at = extract_expiration_timestamp(&master_body, &master_hls_url);

        // Download all sub-playlists in parallel with SSRF validation and DNS pinning
        let mut join_set = tokio::task::JoinSet::new();
        for (filename, sub_url) in sub_playlists {
            let file_dest = slug_dir.join(&filename);
            join_set.spawn(async move {
                if let Ok(parsed_sub) = is_valid_remote_url(&sub_url) {
                    if let Some(sub_host) = parsed_sub.host_str() {
                        let sub_port = parsed_sub.port_or_known_default().unwrap_or(443);
                        if let Ok(sub_addr) = resolve_and_validate_host(sub_host, sub_port).await {
                            if let Ok(sub_client) = Client::builder()
                                .timeout(Duration::from_secs(15))
                                .resolve(sub_host, sub_addr)
                                .no_proxy()
                                .redirect(reqwest::redirect::Policy::none())
                                .build()
                            {
                                if let Ok(resp) = sub_client
                                    .get(parsed_sub.as_str())
                                    .header(header::REFERER, "https://fiml4k.fun/")
                                    .header(
                                        header::USER_AGENT,
                                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
                                    )
                                    .send()
                                    .await
                                {
                                    if resp.status().is_success() {
                                        if let Ok(sub_body) = read_body_with_cap(resp, MAX_PLAYLIST_BYTES).await {
                                            let Ok(sub_body) = String::from_utf8(sub_body) else { return None; };
                                            let sub_exp = extract_expiration_timestamp(&sub_body, &sub_url);
                                            let processed = process_sub_playlist_for_server(&sub_body, &parsed_sub, server);
                                            if tokio::fs::write(&file_dest, processed).await.is_ok() {
                                                return Some(sub_exp);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                None
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
            return Err((StatusCode::BAD_GATEWAY, "Failed to fetch or store child playlist".to_string()));
        }

        // Save metadata for expiration tracking
        expires_at = Some(expires_at.unwrap_or(now.saturating_add(MAX_CACHE_AGE_SECS))
            .min(now.saturating_add(MAX_CACHE_AGE_SECS)));
        let meta_json = serde_json::json!({
            "cached_at": now,
            "expires_at": expires_at,
            "source_url": master_hls_url
        });
        let _ = tokio::fs::write(slug_dir.join(".metadata.json"), meta_json.to_string()).await;

        // Save rewritten master.m3u8
        let master_dest = self.master_path_for_ep_server(slug, ep_num, server);
        tokio::fs::write(&master_dest, &rewritten_master)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to write master playlist: {}", e),
                )
            })?;

        info!(
            "Successfully cached all playlists for slug '{}' (ep: {:?}, server: {:?}) to {:?}",
            slug, ep_num, server, slug_dir
        );
        Ok(rewritten_master)
    }
}

pub fn parse_master_and_extract_subs(
    content: &str,
    master_url: &Url,
) -> (String, Vec<(String, String)>) {
    parse_master_and_extract_subs_for_server(content, master_url, None)
}

fn local_playlist_name(filename: &str, server: Option<usize>) -> String {
    match server.filter(|index| *index > 0) {
        Some(index) => format!("{}?server={}", filename, index),
        None => filename.to_owned(),
    }
}

pub fn parse_master_and_extract_subs_for_server(
    content: &str,
    master_url: &Url,
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
            let full_url = resolve_relative_url(master_url, trimmed);
            sub_playlists.push((filename.clone(), full_url));
            lines.push(local_playlist_name(&filename, server));
            continue;
        }

        if trimmed.starts_with('#') && trimmed.contains("URI=\"") {
            let rewritten_line = URI_REGEX.replace_all(line, |caps: &regex::Captures| {
                let sub_uri = &caps[1];
                let filename = extract_filename(sub_uri);
                let full_url = resolve_relative_url(master_url, sub_uri);
                sub_playlists.push((filename.clone(), full_url));
                format!("URI=\"{}\"", local_playlist_name(&filename, server))
            });
            lines.push(rewritten_line.to_string());
            continue;
        }

        lines.push(line.to_string());
    }

    // Deduplicate sub_playlists by filename
    let mut deduped = Vec::new();
    let mut seen = std::collections::HashSet::new();
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

pub fn process_sub_playlist_for_server(content: &str, sub_url: &Url, server: Option<usize>) -> String {
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
                        format!("URI=\"{}\"", local_playlist_name(&format!("sub/{}", filename), server))
                    } else if is_cdn_segment(map_uri) {
                        format!("URI=\"{}\"", map_uri)
                    } else {
                        let full = resolve_relative_url(sub_url, map_uri);
                        format!("URI=\"{}\"", full)
                    }
                });
                new_lines.push(rewritten.to_string());
            } else {
                new_lines.push(line.to_string());
            }
        } else {
            // Segment line: rewrite .vtt subtitle URLs to relative sub/<filename>
            let clean = stripped.split('?').next().unwrap_or(stripped);
            if clean.to_lowercase().ends_with(".vtt") {
                let filename = extract_filename(stripped);
                new_lines.push(local_playlist_name(&format!("sub/{}", filename), server));
            } else if is_cdn_segment(stripped) {
                new_lines.push(stripped.to_string());
            } else {
                let full = resolve_relative_url(sub_url, stripped);
                new_lines.push(full);
            }
        }
    }
    new_lines.join("\n")
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
        .get_master_for_episode_server(
            &slug,
            params.ep,
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
        .get_master_for_episode_server(
            &slug,
            Some(ep),
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
        .get_file_for_episode_server(&slug, params.ep, params.server, &file, Some(&state.db))
        .await
    {
        Ok(content) => create_playlist_response(content, content_type),
        Err((code, msg)) => (code, msg).into_response(),
    }
}

pub async fn handle_stream_file_ep(
    State(state): State<AppState>,
    AxumPath((slug, ep, file)): AxumPath<(String, i32, String)>,
    Query(params): Query<StreamParams>,
) -> Response {
    if !is_safe_filename(&slug) || !is_safe_filename(&file) || ep <= 0 {
        return (StatusCode::BAD_REQUEST, "Invalid slug, episode, or file parameter").into_response();
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
        .get_file_for_episode_server(&slug, Some(ep), params.server, &file, Some(&state.db))
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
        .get_sub_for_episode_server(&slug, params.ep, params.server, &file)
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
        return (StatusCode::BAD_REQUEST, "Invalid slug, episode, or file parameter").into_response();
    }

    match state
        .playlist_cache
        .get_sub_for_episode_server(&slug, Some(ep), params.server, &file)
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
    fn test_extract_filename() {
        assert_eq!(extract_filename("v0.m3u8"), "v0.m3u8");
        assert_eq!(extract_filename("/api/hls/TOKEN/a0.m3u8"), "a0.m3u8");
        assert_eq!(extract_filename("/api/hls/TOKEN/a0.m3u8?token=123"), "a0.m3u8");
        assert_eq!(extract_filename("https://domain.com/hls/sub.vtt"), "sub.vtt");
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
    fn test_parse_master_rewriting() {
        let master = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Chi",URI="/api/hls/TOKEN123/a0.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="Vi",URI="/api/hls/TOKEN123/s0.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
/api/hls/TOKEN123/v.m3u8
"#;
        let base_url = Url::parse("https://fiml4k.fun/api/hls/TOKEN123/master.m3u8").unwrap();
        let (rewritten, subs) = parse_master_and_extract_subs(master, &base_url);

        assert!(rewritten.contains(r#"URI="a0.m3u8""#));
        assert!(rewritten.contains(r#"URI="s0.m3u8""#));
        assert!(rewritten.contains("\nv.m3u8"));

        assert_eq!(subs.len(), 3);
        assert_eq!(subs[0].0, "a0.m3u8");
        assert_eq!(subs[0].1, "https://fiml4k.fun/api/hls/TOKEN123/a0.m3u8");
        assert_eq!(subs[1].0, "s0.m3u8");
        assert_eq!(subs[2].0, "v.m3u8");

        let (server_master, _) = parse_master_and_extract_subs_for_server(master, &base_url, Some(2));
        assert!(server_master.contains(r#"URI="a0.m3u8?server=2""#));
        assert!(server_master.contains("\nv.m3u8?server=2"));
    }

    #[test]
    fn test_process_sub_playlist_preserves_bytedance_cdn() {
        let sub = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI="https://p19-ad-site-sign-sg.tiktokcdn.com/map.image?x-expires=1824367135"
#EXTINF:24.56,
https://p16-ad-site-sign-sg.tiktokcdn.com/chunk01.image?lk3s=6d71dd51&x-expires=1824366813
#EXTINF:10.0,
relative_segment.ts
"#;
        let sub_url = Url::parse("https://fiml4k.fun/api/hls/TOKEN/v.m3u8").unwrap();
        let processed = process_sub_playlist(sub, &sub_url);

        // ByteDance CDN URLs are preserved exactly as direct links
        assert!(processed.contains("https://p19-ad-site-sign-sg.tiktokcdn.com/map.image?x-expires=1824367135"));
        assert!(processed.contains("https://p16-ad-site-sign-sg.tiktokcdn.com/chunk01.image?lk3s=6d71dd51&x-expires=1824366813"));
        // Relative segment resolved to full url
        assert!(processed.contains("https://fiml4k.fun/api/hls/TOKEN/relative_segment.ts"));
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

        // Server-isolated cache dirs
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
    }

    #[test]
    fn test_extract_expiration_timestamp() {
        let url_with_exp = "https://film4k.net/api/hls/master.m3u8?x-expires=1789000000";
        assert_eq!(
            extract_expiration_timestamp("", url_with_exp),
            Some(1789000000)
        );

        let url_with_alt_exp = "https://film4k.net/api/hls/master.m3u8?expires=1789111111";
        assert_eq!(
            extract_expiration_timestamp("", url_with_alt_exp),
            Some(1789111111)
        );

        let m3u8_body = "#EXTM3U\n#EXTINF:10.0,\nhttps://cdn.example.com/seg.ts?x-expires=1789222222&key=val\n";
        assert_eq!(
            extract_expiration_timestamp(m3u8_body, "https://film4k.net/master.m3u8"),
            Some(1789222222)
        );

        let m3u8_body_alt = "#EXTM3U\n#EXTINF:10.0,\nhttps://cdn.example.com/seg.ts?expires=1789333333&key=val\n";
        assert_eq!(
            extract_expiration_timestamp(m3u8_body_alt, "https://film4k.net/master.m3u8"),
            Some(1789333333)
        );

        let m3u8_quoted = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://cdn.example.com/key?expires=1789444444&id=1\"\n";
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
        assert_eq!(extract_expiration_timestamp("", double_encoded), Some(1789000003));

        let no_exp = "https://film4k.net/api/hls/master.m3u8";
        assert_eq!(extract_expiration_timestamp("#EXTM3U\n", no_exp), None);
    }

    #[tokio::test]
    async fn test_episode_greater_than_one_never_falls_back_to_episode_one() {
        let db = Database::new_in_memory().unwrap();
        let cache = PlaylistCache::new("/tmp/test_cache_never_fallback");

        // breaking-bad is not in db yet, or has no episode 99
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
        let temp_dir = std::env::temp_dir().join(format!("test_cache_legacy_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let cache = PlaylistCache::new(&temp_dir);
        let slug = "test-movie";
        let slug_dir = cache.cache_slug_dir(slug, None);
        tokio::fs::create_dir_all(&slug_dir).await.unwrap();

        // 1. Valid future playlist without .metadata.json
        let future_exp = 2100000000u64; // Far in the future
        let master_content = format!(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhttps://cdn.example.com/v0.m3u8?x-expires={}\n",
            future_exp
        );
        tokio::fs::write(cache.master_path(slug), &master_content).await.unwrap();

        // Ensure .metadata.json does NOT exist initially
        let meta_path = slug_dir.join(".metadata.json");
        assert!(!meta_path.exists());

        // get_master should succeed and backfill .metadata.json
        let result = cache.get_master(slug, false, None).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), master_content);

        // Verify .metadata.json was backfilled
        assert!(meta_path.exists());
        let meta_str = tokio::fs::read_to_string(&meta_path).await.unwrap();
        let meta_json: serde_json::Value = serde_json::from_str(&meta_str).unwrap();
        let expires_at = meta_json.get("expires_at").and_then(|v| v.as_u64()).unwrap();
        assert!(expires_at < future_exp);
        assert!(expires_at <= meta_json.get("cached_at").and_then(|v| v.as_u64()).unwrap() + MAX_CACHE_AGE_SECS);

        // Clean up
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_existing_metadata_null_expires_at_ttl_expiry() {
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

        // 1. Fresh cache with null expires_at (cached 30 mins ago)
        let fresh_meta = serde_json::json!({
            "cached_at": now.saturating_sub(1800),
            "expires_at": serde_json::Value::Null,
            "source_url": "https://fiml4k.fun/api/stream.m3u8"
        });
        let meta_path = slug_dir.join(".metadata.json");
        tokio::fs::write(&meta_path, fresh_meta.to_string())
            .await
            .unwrap();

        // Fresh cache should be returned directly
        let fresh_res = cache.get_master(slug, false, None).await;
        assert!(fresh_res.is_ok());
        assert_eq!(fresh_res.unwrap(), master_content);

        // 2. Expired cache with null expires_at (cached 5 hours ago > MAX_CACHE_AGE_SECS of 4 hours)
        let expired_meta = serde_json::json!({
            "cached_at": now.saturating_sub(5 * 3600),
            "expires_at": serde_json::Value::Null,
            "source_url": "https://fiml4k.fun/api/stream.m3u8"
        });
        tokio::fs::write(&meta_path, expired_meta.to_string())
            .await
            .unwrap();

        // Expired cache should trigger re-fetch and fail offline (NOT return stale master)
        let expired_res = cache.get_master(slug, false, None).await;
        assert!(expired_res.is_err());

        // 3. Corrupted .metadata.json fails closed (triggers re-fetch instead of serving stale)
        tokio::fs::write(&meta_path, "{ broken json ...")
            .await
            .unwrap();
        let corrupted_res = cache.get_master(slug, false, None).await;
        assert!(corrupted_res.is_err());

        // Clean up
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
    async fn test_get_sub_for_episode_cached_disk() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_cache_sub_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cache = PlaylistCache::new(&temp_dir);
        let slug = "my-movie";

        // Setup movie sub cache in sub/ directory
        let sub_dir = cache.cache_slug_dir(slug, None).join("sub");
        tokio::fs::create_dir_all(&sub_dir).await.unwrap();
        let vtt_content = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello World\n";
        tokio::fs::write(sub_dir.join("sub_vi.vtt"), vtt_content)
            .await
            .unwrap();

        // 1. Fetch movie subtitle (None ep)
        let res = cache.get_sub_for_episode(slug, None, "sub_vi.vtt").await;
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), vtt_content);

        // 2. Setup episode 2 sub cache
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

        // Clean up
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }
}
