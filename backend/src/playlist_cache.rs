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

#[derive(Debug, Deserialize, Default)]
pub struct StreamParams {
    #[serde(default)]
    pub refresh: Option<String>,
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

    pub fn slug_dir(&self, slug: &str) -> PathBuf {
        self.base_dir.join(slug)
    }

    pub fn master_path(&self, slug: &str) -> PathBuf {
        self.slug_dir(slug).join("master.m3u8")
    }

    pub fn file_path(&self, slug: &str, file: &str) -> PathBuf {
        self.slug_dir(slug).join(file)
    }

    pub async fn get_master(
        &self,
        slug: &str,
        refresh: bool,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        let master_file = self.master_path(slug);

        if !refresh && master_file.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&master_file).await {
                if content.trim().starts_with("#EXTM3U") {
                    return Ok(content);
                }
            }
            warn!(
                "Cached master.m3u8 for slug '{}' is empty or corrupt. Self-healing re-crawl...",
                slug
            );
        }

        self.crawl_and_cache(slug, db).await
    }

    pub async fn get_file(
        &self,
        slug: &str,
        file: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        let file_path = self.file_path(slug, file);

        if file_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&file_path).await {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }

        // Self-healing: if file is not found, attempt crawl
        info!(
            "Sub-playlist file '{}' not found on disk for slug '{}'. Attempting self-healing crawl...",
            file, slug
        );
        let _ = self.crawl_and_cache(slug, db).await;

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

    pub async fn crawl_and_cache(
        &self,
        slug: &str,
        db: Option<&Database>,
    ) -> Result<String, (StatusCode, String)> {
        info!("Crawling upstream playlists for slug '{}'...", slug);

        // 1. Get fresh upstream master HLS URL from API or DB fallback
        let master_hls_url = match fetch_upstream_title_hls(slug).await {
            Some(url) => url,
            None => {
                if let Some(db) = db {
                    if let Ok(Some(movie)) = db.get_movie_by_slug(slug) {
                        if let Some(ep) = movie.episodes.first() {
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

        // Ensure local directory exists
        let slug_dir = self.slug_dir(slug);
        tokio::fs::create_dir_all(&slug_dir).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create playlist directory: {}", e),
            )
        })?;

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
                                let processed = process_sub_playlist(&sub_body, &parsed_sub_url);
                                let _ = tokio::fs::write(&file_dest, processed).await;
                            }
                        }
                    }
                }
            });
        }

        while join_set.join_next().await.is_some() {}

        // Save rewritten master.m3u8
        let master_dest = self.master_path(slug);
        tokio::fs::write(&master_dest, &rewritten_master)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to write master playlist: {}", e),
                )
            })?;

        info!(
            "Successfully cached all playlists for slug '{}' to {:?}",
            slug, slug_dir
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
                    if is_cdn_segment(map_uri) {
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
            // Segment line: Keep direct ByteDance CDN chunk intact
            if is_cdn_segment(stripped) {
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
        .get_master(&slug, params.is_refresh(), Some(&state.db))
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
        .get_file(&slug, &file, Some(&state.db))
        .await
    {
        Ok(content) => create_playlist_response(content, content_type),
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
}
