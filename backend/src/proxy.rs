use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use regex::Regex;
use reqwest::Client;
use serde::Deserialize;
use std::sync::LazyLock;
use tracing::{error, info, warn};
use url::Url;

use crate::AppState;

static URI_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"URI="([^"]+)""#).unwrap());

#[derive(Debug, Deserialize)]
pub struct ProxyQuery {
    pub url: String,
    #[serde(default)]
    pub keep_cdn: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
}

pub fn is_valid_remote_url(target: &str) -> Result<Url, &'static str> {
    let parsed = Url::parse(target).map_err(|_| "Invalid URL format")?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http and https schemes are supported"),
    }

    if let Some(host_str) = parsed.host_str() {
        let host_lower = host_str.to_lowercase();
        // SSRF protection
        if host_lower == "localhost"
            || host_lower.starts_with("127.")
            || host_lower.starts_with("10.")
            || host_lower.starts_with("192.168.")
            || host_lower.starts_with("172.16.")
            || host_lower.starts_with("172.17.")
            || host_lower.starts_with("172.18.")
            || host_lower.starts_with("172.19.")
            || host_lower.starts_with("172.20.")
            || host_lower.starts_with("169.254.")
            || host_lower == "0.0.0.0"
            || host_lower == "::1"
        {
            return Err("Access to internal host is denied");
        }
    } else {
        return Err("URL missing valid host");
    }

    Ok(parsed)
}

pub fn resolve_relative_url(base: &Url, rel: &str) -> String {
    if rel.starts_with("http://") || rel.starts_with("https://") {
        return rel.to_string();
    }
    match base.join(rel) {
        Ok(resolved) => resolved.to_string(),
        Err(_) => rel.to_string(),
    }
}

/// Helper to identify direct CDN segment media URLs that should be loaded directly
/// by the player client instead of routed through the Axum proxy when keep_cdn is enabled.
/// Matches .image chunks or domains containing 'cdn.' or 'cdn-'.
pub fn is_cdn_segment(url: &str) -> bool {
    let lower = url.to_lowercase();
    // Playlists (.m3u8) must always be rewritten/proxied so inner streams stay valid
    if lower.contains(".m3u8") {
        return false;
    }
    // Direct image-encoded video segments (.image)
    if lower.contains(".image") {
        return true;
    }
    // Direct CDN edge domains containing "cdn." or "cdn-"
    if let Ok(parsed) = Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            let host_lower = host.to_lowercase();
            if host_lower.contains("cdn.") || host_lower.contains("cdn-") {
                return true;
            }
        }
    }
    false
}

pub fn rewrite_m3u8(content: &str, source_url: &Url, proxy_base: &str, keep_cdn: bool) -> String {
    let mut new_lines = Vec::new();

    for line in content.lines() {
        let stripped = line.trim();
        if stripped.is_empty() {
            new_lines.push(line.to_string());
            continue;
        }

        if stripped.starts_with('#') {
            if line.contains("URI=\"") {
                let rewritten = URI_REGEX.replace_all(line, |caps: &regex::Captures| {
                    let rel_uri = &caps[1];
                    let full = resolve_relative_url(source_url, rel_uri);
                    if keep_cdn && is_cdn_segment(&full) {
                        format!("URI=\"{}\"", full)
                    } else {
                        let encoded = urlencoding::encode(&full);
                        let mut proxy_url = format!("{}?url={}", proxy_base, encoded);
                        if keep_cdn {
                            proxy_url.push_str("&keep_cdn=1");
                        }
                        format!("URI=\"{}\"", proxy_url)
                    }
                });
                new_lines.push(rewritten.to_string());
            } else {
                new_lines.push(line.to_string());
            }
        } else {
            let full = resolve_relative_url(source_url, stripped);
            if keep_cdn && is_cdn_segment(&full) {
                new_lines.push(full);
            } else {
                let encoded = urlencoding::encode(&full);
                let mut proxy_url = format!("{}?url={}", proxy_base, encoded);
                if keep_cdn {
                    proxy_url.push_str("&keep_cdn=1");
                }
                new_lines.push(proxy_url);
            }
        }
    }

    new_lines.join("\n")
}

pub fn create_m3u8_response(rewritten: String) -> Response {
    let mut resp = Response::new(Body::from(rewritten));
    let headers_mut = resp.headers_mut();
    headers_mut.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/vnd.apple.mpegurl; charset=utf-8"),
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

/// Fetch fresh HLS stream URL from upstream fiml4k.fun API for a given movie slug
pub async fn fetch_upstream_title_hls(slug: &str) -> Option<String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    let api_base = std::env::var("FIML4K_API_BASE").unwrap_or_else(|_| "https://fiml4k.fun".to_string());
    let title_api_url = format!("{}/api/title/{}", api_base.trim_end_matches('/'), slug);

    let resp = client
        .get(&title_api_url)
        .header(header::REFERER, "https://film4k.net/")
        .header(
            header::USER_AGENT,
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        )
        .header(header::ACCEPT, "application/json, text/plain, */*")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        warn!("Upstream title API returned status {} for slug {}", resp.status(), slug);
        return None;
    }

    let json_val: serde_json::Value = resp.json().await.ok()?;
    let hls_path = json_val
        .get("movie")
        .and_then(|m| m.get("hlsUrl"))
        .and_then(|h| h.as_str())?;

    let full_hls = if hls_path.starts_with('/') {
        format!("https://fiml4k.fun{}", hls_path)
    } else {
        hls_path.to_string()
    };

    Some(full_hls)
}

pub async fn handle_stream_proxy(
    State(state): State<AppState>,
    Query(query): Query<ProxyQuery>,
    headers: HeaderMap,
) -> Response {
    let target_str = query.url.trim();
    if target_str.is_empty() {
        return (StatusCode::BAD_REQUEST, "Missing 'url' query parameter").into_response();
    }

    let parsed_url = match is_valid_remote_url(target_str) {
        Ok(u) => u,
        Err(err) => return (StatusCode::FORBIDDEN, err).into_response(),
    };

    let keep_cdn = query
        .keep_cdn
        .as_deref()
        .map(|v| v == "1" || v == "true")
        .unwrap_or(true); // Default to keep_cdn=true for high speed direct CDN

    let detected_slug: Option<String> = query.slug.clone().or_else(|| {
        // 1. From Referer header: e.g. /watch/{slug} or /movie/{slug}
        if let Some(ref_val) = headers.get(header::REFERER).and_then(|v| v.to_str().ok()) {
            if let Some(pos) = ref_val.find("/watch/") {
                let rest = &ref_val[pos + 7..];
                let slug_candidate = rest.split('/').next().unwrap_or(rest).split('?').next().unwrap_or("");
                if !slug_candidate.is_empty() {
                    return Some(slug_candidate.to_string());
                }
            } else if let Some(pos) = ref_val.find("/movie/") {
                let rest = &ref_val[pos + 7..];
                let slug_candidate = rest.split('/').next().unwrap_or(rest).split('?').next().unwrap_or("");
                if !slug_candidate.is_empty() {
                    return Some(slug_candidate.to_string());
                }
            }
        }
        // 2. From Database search by token / stream URL
        state.db.find_slug_by_stream_url(target_str)
    });

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    let mut req = client.get(parsed_url.as_str());

    // Forward range header if present for byte seeking
    if let Some(range) = headers.get(header::RANGE) {
        req = req.header(header::RANGE, range);
    }

    // Set browser headers
    let referer = if let Some(host) = parsed_url.host_str() {
        format!("https://{}/", host)
    } else {
        "https://film4k.net/".to_string()
    };

    req = req
        .header(header::REFERER, referer)
        .header(
            header::USER_AGENT,
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        )
        .header(header::ACCEPT, "*/*");

    let upstream_resp = match req.send().await {
        Ok(res) => res,
        Err(err) => {
            error!("Upstream fetch error for {}: {}", target_str, err);
            return (
                StatusCode::BAD_GATEWAY,
                format!("Failed to connect to upstream: {}", err),
            )
                .into_response();
        }
    };

    let status = upstream_resp.status();
    let content_type = upstream_resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let is_m3u8 = parsed_url.path().ends_with(".m3u8")
        || content_type.contains("mpegurl")
        || content_type.contains("application/x-mpegURL")
        || content_type.contains("vnd.apple.mpegurl");

    if is_m3u8 || status == StatusCode::FORBIDDEN {
        match upstream_resp.text().await {
            Ok(body_text) => {
                let is_expired = status == StatusCode::FORBIDDEN
                    || body_text.contains("Invalid or expired token")
                    || body_text.contains("expired token");

                if is_expired {
                    warn!(
                        "Upstream stream token expired (status: {}, slug: {:?}, url: {}). Auto-refreshing...",
                        status, detected_slug, target_str
                    );
                    if let Some(ref slug) = detected_slug {
                        if let Some(fresh_hls) = fetch_upstream_title_hls(slug).await {
                            if fresh_hls != target_str {
                                info!(
                                    "Successfully retrieved fresh stream token for {}: {} -> {}",
                                    slug, target_str, fresh_hls
                                );
                                let _ = state.db.update_movie_stream(slug, &fresh_hls);

                                if let Ok(fresh_url) = Url::parse(&fresh_hls) {
                                    let retry_req = client
                                        .get(fresh_url.as_str())
                                        .header(header::REFERER, "https://film4k.net/")
                                        .header(
                                            header::USER_AGENT,
                                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
                                        )
                                        .header(header::ACCEPT, "*/*");

                                    if let Ok(retry_resp) = retry_req.send().await {
                                        if retry_resp.status().is_success() {
                                            if let Ok(fresh_body) = retry_resp.text().await {
                                                let rewritten = rewrite_m3u8(
                                                    &fresh_body,
                                                    &fresh_url,
                                                    "/api/proxy/stream",
                                                    keep_cdn,
                                                );
                                                return create_m3u8_response(rewritten);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if status == StatusCode::FORBIDDEN {
                        return (StatusCode::FORBIDDEN, body_text).into_response();
                    }
                }

                if is_m3u8 && status.is_success() {
                    let rewritten = rewrite_m3u8(&body_text, &parsed_url, "/api/proxy/stream", keep_cdn);
                    return create_m3u8_response(rewritten);
                } else if !status.is_success() {
                    return (status, body_text).into_response();
                }

                let rewritten = rewrite_m3u8(&body_text, &parsed_url, "/api/proxy/stream", keep_cdn);
                create_m3u8_response(rewritten)
            }
            Err(err) => {
                error!("Failed to read m3u8 upstream body: {}", err);
                (StatusCode::BAD_GATEWAY, "Failed reading playlist body").into_response()
            }
        }
    } else {
        // Binary chunk stream (video/audio chunk)
        let mut resp_builder = Response::builder().status(status);

        if let Some(ct) = upstream_resp.headers().get(header::CONTENT_TYPE) {
            resp_builder = resp_builder.header(header::CONTENT_TYPE, ct);
        }
        if let Some(cl) = upstream_resp.headers().get(header::CONTENT_LENGTH) {
            resp_builder = resp_builder.header(header::CONTENT_LENGTH, cl);
        }
        if let Some(cr) = upstream_resp.headers().get(header::CONTENT_RANGE) {
            resp_builder = resp_builder.header(header::CONTENT_RANGE, cr);
        }
        resp_builder = resp_builder
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*");

        let stream = upstream_resp.bytes_stream();
        resp_builder
            .body(Body::from_stream(stream))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Stream error").into_response())
    }
}

// Module for simple urlencoding
pub mod urlencoding {
    pub fn encode(data: &str) -> String {
        url::form_urlencoded::byte_serialize(data.as_bytes()).collect()
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_remote_urls() {
        assert!(is_valid_remote_url("https://film4k.net/api/hls/master.m3u8").is_ok());
        assert!(is_valid_remote_url("http://fiml4k.fun/api/hls/test/master.m3u8").is_ok());
        assert!(is_valid_remote_url("https://v16m-default.akamaicdn.net/test.png").is_ok());
    }

    #[test]
    fn test_ssrf_prevention() {
        assert!(is_valid_remote_url("http://localhost:8090").is_err());
        assert!(is_valid_remote_url("http://127.0.0.1:8090").is_err());
        assert!(is_valid_remote_url("http://10.0.0.1/secret").is_err());
        assert!(is_valid_remote_url("http://192.168.1.1/router").is_err());
        assert!(is_valid_remote_url("http://172.16.0.1/admin").is_err());
        assert!(is_valid_remote_url("http://169.254.169.254/metadata").is_err());
        assert!(is_valid_remote_url("file:///etc/passwd").is_err());
        assert!(is_valid_remote_url("ftp://example.com/test").is_err());
    }

    #[test]
    fn test_rewrite_m3u8_keep_cdn() {
        let sample_m3u8 = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="audio/eng.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=3840x2160
video/4k.m3u8
#EXTINF:6.000000,
https://v16m-default.akamaicdn.net/chunk01.image
#EXTINF:6.000000,
segment02.ts
"#;
        let base_url = Url::parse("https://film4k.net/api/hls/master.m3u8").unwrap();
        let rewritten = rewrite_m3u8(sample_m3u8, &base_url, "/api/proxy/stream", true);

        // 1. Audio URI should be proxied
        assert!(rewritten.contains(r#"URI="/api/proxy/stream?url=https%3A%2F%2Ffilm4k.net%2Fapi%2Fhls%2Faudio%2Feng.m3u8&keep_cdn=1""#));

        // 2. Child playlist 4k.m3u8 should be proxied
        assert!(rewritten.contains("/api/proxy/stream?url=https%3A%2F%2Ffilm4k.net%2Fapi%2Fhls%2Fvideo%2F4k.m3u8&keep_cdn=1"));

        // 3. Direct CDN segment chunk should be KEPT DIRECT!
        assert!(rewritten.contains("https://v16m-default.akamaicdn.net/chunk01.image"));

        // 4. Non-CDN relative segment should be proxied
        assert!(rewritten.contains("/api/proxy/stream?url=https%3A%2F%2Ffilm4k.net%2Fapi%2Fhls%2Fsegment02.ts&keep_cdn=1"));
    }

    #[test]
    fn test_rewrite_m3u8_force_proxy_all() {
        let sample_m3u8 = r#"#EXTM3U
#EXTINF:6.0,
https://v16m-default.akamaicdn.net/chunk01.image
"#;
        let base_url = Url::parse("https://film4k.net/api/hls/master.m3u8").unwrap();
        let rewritten = rewrite_m3u8(sample_m3u8, &base_url, "/api/proxy/stream", false);

        // When keep_cdn=false, even CDN chunks must go through proxy
        assert!(rewritten.contains("/api/proxy/stream?url=https%3A%2F%2Fv16m-default.akamaicdn.net%2Fchunk01.image"));
    }
}
