use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use regex::Regex;
use reqwest::Client;
use serde::Deserialize;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::LazyLock;
use std::time::Duration;
use tracing::{error, info, warn};
use url::Url;

use crate::AppState;

static URI_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"URI="([^"]+)""#).unwrap());

/// Maximum allowed playlist body size (5 MB) to prevent resource exhaustion
pub const MAX_PLAYLIST_BYTES: usize = 5 * 1024 * 1024;

/// Permitted upstream origins for video streaming and metadata
pub const ALLOWED_DOMAINS: &[&str] = &[
    "film4k.net",
    "fiml4k.fun",
    "tiktokcdn.com",
    "akamaicdn.net",
    "byteoversea.com",
    "ibytedtos.com",
    "ibyteimg.com",
    "tmdb.org",
    "example.com",
];

#[derive(Debug, Deserialize)]
pub struct ProxyQuery {
    pub url: String,
    #[serde(default)]
    pub keep_cdn: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
}

/// Check if an IP address belongs to internal, private, loopback, or link-local ranges.
pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            let o = ipv4.octets();
            // Loopback (127.0.0.0/8)
            ipv4.is_loopback()
            // Private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
            || ipv4.is_private()
            // Link-local (169.254.0.0/16)
            || ipv4.is_link_local()
            // Broadcast (255.255.255.255)
            || ipv4.is_broadcast()
            // Unspecified / 0.0.0.0/8
            || o[0] == 0
            // Multicast (224.0.0.0/4)
            || ipv4.is_multicast()
            // Shared address space / CGNAT (100.64.0.0/10)
            || (o[0] == 100 && (o[1] & 0xc0) == 64)
            // IETF assignments (192.0.0.0/24)
            || (o[0] == 192 && o[1] == 0 && o[2] == 0)
            // Documentation (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24)
            || (o[0] == 192 && o[1] == 0 && o[2] == 2)
            || (o[0] == 198 && o[1] == 51 && o[2] == 100)
            || (o[0] == 203 && o[1] == 0 && o[2] == 113)
            // Benchmarking (198.18.0.0/15)
            || (o[0] == 198 && (o[1] & 0xfe) == 18)
            // Reserved for future use (240.0.0.0/4)
            || o[0] >= 240
        }
        IpAddr::V6(ipv6) => {
            if ipv6.is_loopback() || ipv6.is_unspecified() || ipv6.is_multicast() {
                return true;
            }
            if let Some(mapped) = ipv6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(mapped));
            }
            let seg = ipv6.segments();
            // Unique local (fc00::/7)
            (seg[0] & 0xfe00) == 0xfc00
            // Link-local unicast (fe80::/10)
            || (seg[0] & 0xffc0) == 0xfe80
            // Documentation (2001:db8::/32)
            || (seg[0] == 0x2001 && seg[1] == 0x0db8)
        }
    }
}

/// Check if a host belongs to permitted upstream origins.
pub fn is_allowed_origin(host: &str) -> bool {
    let host_lower = host.to_lowercase();
    let host_trimmed = host_lower.trim_end_matches('.');

    for allowed in ALLOWED_DOMAINS {
        if host_trimmed == *allowed || host_trimmed.ends_with(&format!(".{}", allowed)) {
            return true;
        }
    }

    if let Ok(extra) = std::env::var("ALLOWED_PROXY_ORIGINS") {
        for origin in extra.split(',') {
            let o = origin.trim().to_lowercase();
            if !o.is_empty() && (host_trimmed == o || host_trimmed.ends_with(&format!(".{}", o))) {
                return true;
            }
        }
    }

    false
}

/// Redact tokens, signatures, and credentials from URLs for safe logging and error reporting.
pub fn redact_url_secrets(raw_url: &str) -> String {
    if let Ok(mut parsed) = Url::parse(raw_url) {
        let sensitive_params = [
            "token", "sig", "signature", "x-signature", "x-expires", "expires",
            "key", "auth", "lk3s", "secret", "pass", "password", "api_key",
        ];
        let pairs: Vec<(String, String)> = parsed
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        if !pairs.is_empty() {
            let mut new_pairs = Vec::new();
            for (k, v) in pairs {
                let k_lower = k.to_lowercase();
                if sensitive_params.iter().any(|&s| k_lower == s || k_lower.contains(s)) {
                    new_pairs.push((k, "[REDACTED]".to_string()));
                } else {
                    new_pairs.push((k, v));
                }
            }
            parsed.set_query(None);
            let mut serializer = url::form_urlencoded::Serializer::new(String::new());
            for (k, v) in new_pairs {
                serializer.append_pair(&k, &v);
            }
            parsed.set_query(Some(&serializer.finish()));
        }

        let path = parsed.path().to_string();
        if path.contains("/api/hls/") {
            let parts: Vec<&str> = path.split('/').collect();
            if parts.len() >= 5 && parts[1] == "api" && parts[2] == "hls" {
                let mut redacted_parts = parts;
                redacted_parts[3] = "[REDACTED]";
                parsed.set_path(&redacted_parts.join("/"));
            }
        }

        parsed.to_string()
    } else {
        "[REDACTED_URL]".to_string()
    }
}

pub fn is_valid_remote_url(target: &str) -> Result<Url, &'static str> {
    if target.len() > 4096 {
        return Err("URL exceeds maximum length");
    }

    let parsed = Url::parse(target).map_err(|_| "Invalid URL format")?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http and https schemes are supported"),
    }

    // Check port: standard http/https ports only
    if let Some(port) = parsed.port() {
        if port != 80 && port != 443 {
            return Err("Access to internal host is denied");
        }
    }

    let host_str = match parsed.host_str() {
        Some(h) => h,
        None => return Err("URL missing valid host"),
    };

    let host_lower = host_str.to_lowercase();
    if host_lower == "localhost" {
        return Err("Access to internal host is denied");
    }

    if let Ok(ip) = host_lower.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("Access to internal host is denied");
        }
        return Ok(parsed);
    }

    if !is_allowed_origin(&host_lower) {
        return Err("Access to host is not permitted by proxy policy");
    }

    Ok(parsed)
}

/// Resolve host and validate against blocked IP ranges.
pub async fn resolve_and_validate_host(host: &str, port: u16) -> Result<SocketAddr, &'static str> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("Access to internal host is denied");
        }
        return Ok(SocketAddr::new(ip, port));
    }

    let addr_str = format!("{}:{}", host, port);
    let addrs = tokio::net::lookup_host(&addr_str)
        .await
        .map_err(|_| "Failed to resolve host via DNS")?;

    let mut first_valid = None;
    for addr in addrs {
        if is_blocked_ip(addr.ip()) {
            return Err("Access to internal host is denied");
        }
        if first_valid.is_none() {
            first_valid = Some(addr);
        }
    }

    first_valid.ok_or("No DNS addresses resolved for host")
}

/// Validate redirect destinations synchronously
pub fn validate_redirect_target(url: &Url) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("Forbidden scheme in redirect".to_string()),
    }
    if let Some(p) = url.port() {
        if p != 80 && p != 443 {
            return Err("Forbidden port in redirect".to_string());
        }
    }
    let host = url.host_str().ok_or("Missing host in redirect")?;
    if host.eq_ignore_ascii_case("localhost") {
        return Err("Access to localhost is denied".to_string());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("Access to internal IP is denied".to_string());
        }
        return Ok(());
    }
    if !is_allowed_origin(host) {
        return Err(format!("Host '{}' not permitted in redirect", host));
    }
    let port = url.port_or_known_default().unwrap_or(443);
    if let Ok(addrs) = format!("{}:{}", host, port).to_socket_addrs() {
        for addr in addrs {
            if is_blocked_ip(addr.ip()) {
                return Err("Redirect resolved to blocked internal IP".to_string());
            }
        }
    }
    Ok(())
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
        .and_then(|h| h.as_str())
        .or_else(|| {
            json_val
                .get("episodes")
                .and_then(|e| e.as_array())
                .and_then(|arr| arr.first())
                .and_then(|ep| ep.get("sources"))
                .and_then(|s| s.as_array())
                .and_then(|arr| arr.first())
                .and_then(|src| src.get("url"))
                .and_then(|u| u.as_str())
        })
        .or_else(|| {
            json_val
                .get("sources")
                .and_then(|s| s.as_array())
                .and_then(|arr| arr.first())
                .and_then(|src| src.get("url"))
                .and_then(|u| u.as_str())
        })?;

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

    let port = parsed_url.port_or_known_default().unwrap_or(443);
    let host = parsed_url.host_str().unwrap_or("");
    let resolved_addr = match resolve_and_validate_host(host, port).await {
        Ok(addr) => addr,
        Err(err) => return (StatusCode::FORBIDDEN, err).into_response(),
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .resolve(host, resolved_addr)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("Too many redirects");
            }
            if let Err(e) = validate_redirect_target(attempt.url()) {
                return attempt.error(e);
            }
            attempt.follow()
        }))
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
            let redacted = redact_url_secrets(target_str);
            error!("Upstream fetch error for {}: {}", redacted, err);
            return (
                StatusCode::BAD_GATEWAY,
                "Failed to connect to upstream service",
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
        if let Some(cl) = upstream_resp.content_length() {
            if cl > MAX_PLAYLIST_BYTES as u64 {
                return (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Playlist response exceeds maximum allowed size",
                )
                    .into_response();
            }
        }
        match upstream_resp.bytes().await {
            Ok(bytes) => {
                if bytes.len() > MAX_PLAYLIST_BYTES {
                    return (
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "Playlist response exceeds maximum allowed size",
                    )
                        .into_response();
                }
                let body_text = String::from_utf8_lossy(&bytes).to_string();
                let is_expired = status == StatusCode::FORBIDDEN
                    || body_text.contains("Invalid or expired token")
                    || body_text.contains("expired token");

                if is_expired {
                    let redacted_target = redact_url_secrets(target_str);
                    warn!(
                        "Upstream stream token expired (status: {}, slug: {:?}, url: {}). Auto-refreshing...",
                        status, detected_slug, redacted_target
                    );
                    if let Some(ref slug) = detected_slug {
                        if let Some(fresh_hls) = fetch_upstream_title_hls(slug).await {
                            if fresh_hls != target_str {
                                info!(
                                    "Successfully retrieved fresh stream token for {}: {} -> {}",
                                    slug, redacted_target, redact_url_secrets(&fresh_hls)
                                );
                                let _ = state.db.update_movie_stream(slug, &fresh_hls);

                                if let Ok(fresh_url) = is_valid_remote_url(&fresh_hls) {
                                    let fresh_port = fresh_url.port_or_known_default().unwrap_or(443);
                                    let fresh_host = fresh_url.host_str().unwrap_or("");
                                    if let Ok(fresh_addr) = resolve_and_validate_host(fresh_host, fresh_port).await {
                                        let fresh_client = Client::builder()
                                            .timeout(Duration::from_secs(15))
                                            .resolve(fresh_host, fresh_addr)
                                            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                                                if attempt.previous().len() >= 5 {
                                                    return attempt.error("Too many redirects");
                                                }
                                                if let Err(e) = validate_redirect_target(attempt.url()) {
                                                    return attempt.error(e);
                                                }
                                                attempt.follow()
                                            }))
                                            .build()
                                            .unwrap_or_default();

                                        let retry_req = fresh_client
                                            .get(fresh_url.as_str())
                                            .header(header::REFERER, "https://film4k.net/")
                                            .header(
                                                header::USER_AGENT,
                                                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
                                            )
                                            .header(header::ACCEPT, "*/*");

                                        if let Ok(retry_resp) = retry_req.send().await {
                                            if retry_resp.status().is_success() {
                                                if let Ok(fresh_bytes) = retry_resp.bytes().await {
                                                    if fresh_bytes.len() <= MAX_PLAYLIST_BYTES {
                                                        let fresh_body = String::from_utf8_lossy(&fresh_bytes).to_string();
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

        // IPv6 loopback, link-local, unique-local, mapped
        assert!(is_valid_remote_url("http://[::1]/status").is_err());
        assert!(is_valid_remote_url("http://[fe80::1]/status").is_err());
        assert!(is_valid_remote_url("http://[fc00::1]/status").is_err());
        assert!(is_valid_remote_url("http://[::ffff:127.0.0.1]/status").is_err());

        // Non-standard port
        assert!(is_valid_remote_url("https://film4k.net:22/master.m3u8").is_err());
        assert!(is_valid_remote_url("https://film4k.net:8080/master.m3u8").is_err());

        // Unpermitted upstream domain
        assert!(is_valid_remote_url("https://evil-attacker.com/exploit.m3u8").is_err());
    }

    #[test]
    fn test_redact_url_secrets() {
        let sensitive = "https://fiml4k.fun/api/hls/SECRET_TOKEN_XYZ/master.m3u8?lk3s=6d71dd51&x-expires=1824366813&x-signature=super_secret_sig&keep_cdn=1";
        let redacted = redact_url_secrets(sensitive);
        assert!(!redacted.contains("SECRET_TOKEN_XYZ"));
        assert!(!redacted.contains("6d71dd51"));
        assert!(!redacted.contains("super_secret_sig"));
        assert!(redacted.contains("[REDACTED]"));
        assert!(redacted.contains("keep_cdn=1"));
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
