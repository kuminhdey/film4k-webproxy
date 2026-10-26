use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use regex::Regex;
use reqwest::Client;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::LazyLock;
use tracing::{error, info, warn};
use url::Url;

use crate::{
    db::Database,
    proxy::{fetch_upstream_title_hls, is_cdn_segment, resolve_relative_url},
    AppState,
};

static URI_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"URI="([^"]+)""#).unwrap());

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
    if let Ok(u) = Url::parse(stream_url) {
        for (k, v) in u.query_pairs() {
            if k == "x-expires" || k == "expires" {
                if let Ok(ts) = v.parse::<u64>() {
                    return Some(ts);
                }
            }
        }
    }
    for line in content.lines() {
        if let Some(pos) = line.find("x-expires=") {
            let rest = &line[pos + 10..];
            let val_str = rest
                .split('&')
                .next()
                .unwrap_or(rest)
                .split('"')
                .next()
                .unwrap_or(rest)
                .split('\'')
                .next()
                .unwrap_or(rest);
            if let Ok(ts) = val_str.parse::<u64>() {
                return Some(ts);
            }
        } else if let Some(pos) = line.find("expires=") {
            let rest = &line[pos + 8..];
            let val_str = rest
                .split('&')
                .next()
                .unwrap_or(rest)
                .split('"')
                .next()
                .unwrap_or(rest)
                .split('\'')
                .next()
                .unwrap_or(rest);
            if let Ok(ts) = val_str.parse::<u64>() {
                return Some(ts);
            }
        }
    }
    None
}

#[derive(Clone, Debug)]
pub struct PlaylistCache {
    base_dir: PathBuf,
}

pub type PlaylistCacheService = PlaylistCache;

impl Default for PlaylistCache {
    fn default() -> Self {
        let path = std::env::var("PLAYLISTS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/playlists"));
        Self { base_dir: path }
    }
}

impl PlaylistCache {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    pub fn base_dir(&self) -> PathBuf {
        self.base_dir.clone()
    }

    pub fn cache_slug_dir(&self, slug: &str, ep: Option<i32>) -> PathBuf {
        match ep {
            Some(e) if e > 1 => self.base_dir.join(format!("{}_ep{}", slug, e)),
            _ => self.base_dir.join(slug),
        }
    }

    pub fn slug_dir(&self, slug: &str) -> PathBuf {
        self.cache_slug_dir(slug, None)
    }

    pub fn master_path(&self, slug: &str) -> PathBuf {
        self.master_path_for_ep(slug, None)
    }

    pub fn master_path_for_ep(&self, slug: &str, ep: Option<i32>) -> PathBuf {
        self.cache_slug_dir(slug, ep).join("master.m3u8")
    }

    pub fn file_path(&self, slug: &str, file: &str) -> PathBuf {
        self.file_path_for_ep(slug, None, file)
    }

    pub fn file_path_for_ep(&self, slug: &str, ep: Option<i32>, file: &str) -> PathBuf {
        self.cache_slug_dir(slug, ep).join(file)
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
        let master_file = self.master_path_for_ep(slug, ep);
        let slug_dir = self.cache_slug_dir(slug, ep);

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
                            if let Some(exp) = meta_json.get("expires_at").and_then(|v| v.as_u64()) {
                                if now >= exp.saturating_sub(60) {
                                    is_expired = true;
                                    warn!("Cached master playlist for '{:?}' expired at {}. Re-fetching...", slug, exp);
                                }
                            } else {
                                // expires_at is null, missing, or invalid: apply bounded TTL
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
                        if now >= exp.saturating_sub(60) {
                            is_expired = true;
                            warn!("Legacy cached playlist for '{:?}' has expired timestamp {}. Re-fetching...", slug, exp);
                        } else {
                            // Backfill metadata with detected timestamp
                            let meta_json = serde_json::json!({
                                "cached_at": now,
                                "expires_at": exp,
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
                "Cached master.m3u8 for slug '{}' (ep: {:?}) is stale or corrupt. Re-crawling...",
                slug, ep
            );
        }

        self.crawl_and_cache_for_episode(slug, ep, db).await
    }

    pub async fn get_file(
        &self,
        slug: &str,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.get_file_for_episode(slug, None, file, db).await
    }

    pub async fn get_file_for_episode(
        &self,
        slug: &str,
        ep: Option<i32>,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        let file_path = self.file_path_for_ep(slug, ep, file);

        if file_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&file_path).await {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }

        // Also check if cached in sub/ directory
        let sub_file = self.cache_slug_dir(slug, ep).join("sub").join(file);
        if sub_file.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&sub_file).await {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }

        // If file is a .vtt subtitle, fetch upstream via subtitle proxy
        if file.ends_with(".vtt") {
            return self.get_sub_for_episode(slug, ep, file).await;
        }

        // Self-healing: if file is not found, attempt crawl
        info!(
            "Sub-playlist file '{}' not found on disk for slug '{}' (ep: {:?}). Attempting self-healing crawl...",
            file, slug, ep
        );
        let _ = self.crawl_and_cache_for_episode(slug, ep, db).await;

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
        let slug_dir = self.cache_slug_dir(slug, ep);
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

        // 2. Fetch upstream https://fiml4k.fun/api/subs/<filename> with Referer: https://fiml4k.fun/
        let upstream_url = format!("https://fiml4k.fun/api/subs/{}", file);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();

        let resp = client
            .get(&upstream_url)
            .header(header::REFERER, "https://fiml4k.fun/")
            .header(
                header::USER_AGENT,
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
            )
            .send()
            .await
            .map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!("Failed to fetch upstream subtitle from {}: {}", upstream_url, e),
                )
            })?;

        let status = resp.status();
        if !status.is_success() {
            return Err((
                status,
                format!("Upstream subtitle request failed with status: {}", status),
            ));
        }

        let content = resp.text().await.map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to read upstream subtitle body: {}", e),
            )
        })?;

        // 3. Cache to disk
        if let Err(e) = tokio::fs::create_dir_all(&sub_dir).await {
            warn!("Failed to create sub directory {:?}: {}", sub_dir, e);
        }
        if let Err(e) = tokio::fs::write(&sub_file, &content).await {
            warn!("Failed to cache subtitle file {:?}: {}", sub_file, e);
        }

        info!(
            "Successfully fetched and cached subtitle '{}' for slug '{}' (ep: {:?})",
            file, slug, ep
        );
        Ok(content)
    }

    pub async fn crawl_and_cache(
        &self,
        slug: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        self.crawl_and_cache_for_episode(slug, None, db).await
    }

    pub async fn crawl_and_cache_for_episode(
        &self,
        slug: &str,
        ep_num: Option<i32>,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        info!("Crawling upstream playlists for slug '{}' (ep: {:?})...", slug, ep_num);

        // 1. Get fresh upstream master HLS URL from API or DB fallback
        let master_hls_url = match ep_num {
            Some(e_num) if e_num > 1 => {
                let ep_source = if let Some(db) = db {
                    if let Ok(Some(movie)) = db.get_movie_by_slug(slug) {
                        let target_ep = movie.episodes.iter().find(|e| e.episode == e_num);
                        if let Some(ep) = target_ep {
                            if let Some(src) = ep.sources.iter().find(|s| !s.hls_url.trim().is_empty()) {
                                Some(src.hls_url.clone())
                            } else if let Some(srv) = ep.servers.iter().find(|s| !s.hls_url.trim().is_empty()) {
                                Some(srv.hls_url.clone())
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

                // When ep_num > 1 has no matching source, return a clear unavailable error.
                // NEVER fall back to title API or episode 1.
                match ep_source {
                    Some(url) => url,
                    None => {
                        return Err((
                            StatusCode::NOT_FOUND,
                            format!("Episode {} for slug '{}' is not available", e_num, slug),
                        ));
                    }
                }
            }
            _ => match fetch_upstream_title_hls(slug).await {
                Some(url) => url,
                None => {
                    if let Some(db) = db {
                        if let Ok(Some(movie)) = db.get_movie_by_slug(slug) {
                            let target_ep = movie.episodes.first();
                            if let Some(ep) = target_ep {
                                if let Some(src) = ep.sources.first() {
                                    if !src.hls_url.trim().is_empty() {
                                        src.hls_url.clone()
                                    } else {
                                        return Err((
                                            StatusCode::NOT_FOUND,
                                            format!("No HLS stream URL available for slug '{}'", slug),
                                        ));
                                    }
                                } else {
                                    return Err((
                                        StatusCode::NOT_FOUND,
                                        format!("No stream sources available for slug '{}'", slug),
                                    ));
                                }
                            } else if let Some(ref stream_val) = movie.stream {
                                if let Some(s) = stream_val.as_str() {
                                    s.to_string()
                                } else if let Some(s) = stream_val.get("hlsUrl").and_then(|u| u.as_str()) {
                                    s.to_string()
                                } else {
                                    return Err((
                                        StatusCode::NOT_FOUND,
                                        format!("No stream available for slug '{}'", slug),
                                    ));
                                }
                            } else {
                                return Err((
                                    StatusCode::NOT_FOUND,
                                    format!("No stream available for slug '{}'", slug),
                                ));
                            }
                        } else {
                            return Err((
                                StatusCode::NOT_FOUND,
                                format!("Movie with slug '{}' not found upstream or in database", slug),
                            ));
                        }
                    } else {
                        return Err((
                            StatusCode::NOT_FOUND,
                            format!("Failed to retrieve upstream HLS URL for slug '{}'", slug),
                        ));
                    }
                }
            },
        };

        let master_url_parsed = Url::parse(&master_hls_url).map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Invalid master HLS URL '{}': {}", master_hls_url, e),
            )
        })?;

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();

        let master_resp = client
            .get(master_url_parsed.as_str())
            .header(header::REFERER, "https://fiml4k.fun/")
            .header(
                header::USER_AGENT,
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
            )
            .send()
            .await
            .map_err(|e| {
                error!("Failed to fetch upstream master playlist for {}: {}", slug, e);
                (
                    StatusCode::BAD_GATEWAY,
                    format!("Failed to connect to upstream master playlist: {}", e),
                )
            })?;

        if !master_resp.status().is_success() {
            return Err((
                StatusCode::BAD_GATEWAY,
                format!("Upstream master playlist returned status {}", master_resp.status()),
            ));
        }

        let master_body = master_resp.text().await.map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to read upstream master playlist body: {}", e),
            )
        })?;

        if !master_body.trim().starts_with("#EXTM3U") {
            return Err((
                StatusCode::BAD_GATEWAY,
                "Upstream master response is not a valid M3U8 playlist".to_string(),
            ));
        }

        // Parse and rewrite master, extract sub-playlists
        let (rewritten_master, sub_playlists) =
            parse_master_and_extract_subs(&master_body, &master_url_parsed);

        // Ensure local directory exists for this episode
        let slug_dir = self.cache_slug_dir(slug, ep_num);
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

        // Download all sub-playlists in parallel
        let mut join_set = tokio::task::JoinSet::new();
        for (filename, sub_url) in sub_playlists {
            let file_dest = slug_dir.join(&filename);
            let client = client.clone();
            join_set.spawn(async move {
                if let Ok(resp) = client
                    .get(&sub_url)
                    .header(header::REFERER, "https://fiml4k.fun/")
                    .header(
                        header::USER_AGENT,
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
                    )
                    .send()
                    .await
                {
                    if resp.status().is_success() {
                        if let Ok(sub_body) = resp.text().await {
                            if let Ok(parsed_sub_url) = Url::parse(&sub_url) {
                                let sub_exp = extract_expiration_timestamp(&sub_body, &sub_url);
                                let processed = process_sub_playlist(&sub_body, &parsed_sub_url);
                                let _ = tokio::fs::write(&file_dest, processed).await;
                                return sub_exp;
                            }
                        }
                    }
                }
                None
            });
        }

        while let Some(res) = join_set.join_next().await {
            if let Ok(Some(exp)) = res {
                if expires_at.is_none() || expires_at > Some(exp) {
                    expires_at = Some(exp);
                }
            }
        }

        // Save metadata for expiration tracking
        let meta_json = serde_json::json!({
            "cached_at": now,
            "expires_at": expires_at,
            "source_url": master_hls_url
        });
        let _ = tokio::fs::write(slug_dir.join(".metadata.json"), meta_json.to_string()).await;

        // Save rewritten master.m3u8
        let master_dest = self.master_path_for_ep(slug, ep_num);
        tokio::fs::write(&master_dest, &rewritten_master)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to write master playlist: {}", e),
                )
            })?;

        info!(
            "Successfully cached all playlists for slug '{}' (ep: {:?}) to {:?}",
            slug, ep_num, slug_dir
        );
        Ok(rewritten_master)
    }
}

pub fn parse_master_and_extract_subs(
    content: &str,
    master_url: &Url,
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
            lines.push(filename);
            continue;
        }

        if trimmed.starts_with('#') && trimmed.contains("URI=\"") {
            let rewritten_line = URI_REGEX.replace_all(line, |caps: &regex::Captures| {
                let sub_uri = &caps[1];
                let filename = extract_filename(sub_uri);
                let full_url = resolve_relative_url(master_url, sub_uri);
                sub_playlists.push((filename.clone(), full_url));
                format!("URI=\"{}\"", filename)
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
                        format!("URI=\"sub/{}\"", filename)
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
                new_lines.push(format!("sub/{}", filename));
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
        .get_master_for_episode(&slug, params.ep, params.is_refresh(), Some(&state.db))
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
        .get_master_for_episode(&slug, Some(ep), params.is_refresh(), Some(&state.db))
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
        .get_file_for_episode(&slug, params.ep, &file, Some(&state.db))
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
        .get_file_for_episode(&slug, Some(ep), &file, Some(&state.db))
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
        .get_sub_for_episode(&slug, params.ep, &file)
        .await
    {
        Ok(content) => create_playlist_response(content, "text/vtt; charset=utf-8"),
        Err((code, msg)) => (code, msg).into_response(),
    }
}

pub async fn handle_stream_sub_ep(
    State(state): State<AppState>,
    AxumPath((slug, ep, file)): AxumPath<(String, i32, String)>,
    Query(_params): Query<StreamParams>,
) -> Response {
    if !is_safe_filename(&slug) || !is_safe_filename(&file) || ep <= 0 {
        return (StatusCode::BAD_REQUEST, "Invalid slug, episode, or file parameter").into_response();
    }

    match state
        .playlist_cache
        .get_sub_for_episode(&slug, Some(ep), &file)
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
        assert_eq!(meta_json.get("expires_at").and_then(|v| v.as_u64()), Some(future_exp));

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
