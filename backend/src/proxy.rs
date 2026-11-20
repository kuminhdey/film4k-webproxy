use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use futures_util::StreamExt;
use regex::Regex;
use reqwest::Client;
use serde::Deserialize;
use std::error::Error as StdError;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tracing::{error, info, warn};
use url::Url;

use crate::AppState;

static URI_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"URI="([^"]+)""#).expect("valid URI regex"));

/// Maximum allowed playlist body size (5 MB) to prevent resource exhaustion
pub const MAX_PLAYLIST_BYTES: usize = 5 * 1024 * 1024;

/// Maximum allowed stream chunk body size (50 MB)
pub const MAX_STREAM_BYTES: u64 = 50 * 1024 * 1024;

/// Maximum allowed image size (10 MB)
pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
/// Maximum allowed upstream title JSON response size (2 MB)
pub const MAX_TITLE_JSON_BYTES: usize = 2 * 1024 * 1024;
/// Maximum allowed upstream XML sitemap response size (10 MB)
pub const MAX_SITEMAP_XML_BYTES: usize = 10 * 1024 * 1024;

/// Custom DNS resolver enforcing non-private/non-loopback/non-link-local IP checks on every lookup.
/// Preserves HTTP/2 multiplexing and TLS keep-alive connection pooling while preventing DNS rebinding.
#[derive(Debug, Clone, Default)]
pub struct SafeDnsResolver;

impl reqwest::dns::Resolve for SafeDnsResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            if let Some(ip) = parse_ip_literal(&host) {
                if is_blocked_ip(ip) {
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "Access to internal host is denied",
                    )) as Box<dyn StdError + Send + Sync>);
                }
                if !is_explicitly_allowlisted_ip(&ip, &host) {
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "Access to IP literal is not permitted by proxy policy",
                    )) as Box<dyn StdError + Send + Sync>);
                }
                let iter: reqwest::dns::Addrs = Box::new(std::iter::once(SocketAddr::new(ip, 443)));
                return Ok(iter);
            }

            let addrs = tokio::net::lookup_host((host.as_str(), 443))
                .await
                .map_err(|_| {
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "Failed to resolve host via DNS",
                    )) as Box<dyn StdError + Send + Sync>
                })?;

            let mut valid = Vec::new();
            for addr in addrs {
                if is_blocked_ip(addr.ip()) {
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "Access to internal host is denied",
                    )) as Box<dyn StdError + Send + Sync>);
                }
                valid.push(addr);
            }

            if valid.is_empty() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "No DNS addresses resolved for host",
                )) as Box<dyn StdError + Send + Sync>);
            }

            let iter: reqwest::dns::Addrs = Box::new(valid.into_iter());
            Ok(iter)
        })
    }
}

pub fn build_safe_http_client(timeout_secs: u64) -> Client {
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .pool_idle_timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none());

    if let Ok(proxy_val) = std::env::var("UPSTREAM_PROXY_URL") {
        let trimmed = proxy_val.trim();
        if !trimmed.is_empty() {
            if let Ok(proxy) = reqwest::Proxy::all(trimmed) {
                builder = builder.proxy(proxy);
            } else {
                warn!("Invalid UPSTREAM_PROXY_URL provided, falling back to direct safe client");
                builder = builder.dns_resolver(Arc::new(SafeDnsResolver)).no_proxy();
            }
        } else {
            builder = builder.dns_resolver(Arc::new(SafeDnsResolver)).no_proxy();
        }
    } else {
        builder = builder.dns_resolver(Arc::new(SafeDnsResolver)).no_proxy();
    }

    builder.build().unwrap_or_else(|_| Client::new())
}

static SHARED_SAFE_CLIENT: LazyLock<Client> = LazyLock::new(|| build_safe_http_client(15));

pub fn shared_safe_http_client() -> &'static Client {
    &SHARED_SAFE_CLIENT
}

fn classify_reqwest_error(err: &reqwest::Error) -> (StatusCode, &'static str) {
    let mut current: Option<&(dyn StdError + 'static)> = Some(err);
    while let Some(cause) = current {
        let msg = cause.to_string();
        if msg.contains("Access to internal host is denied") {
            return (StatusCode::FORBIDDEN, "Access to internal host is denied");
        }
        if msg.contains("Access to IP literal is not permitted by proxy policy") {
            return (
                StatusCode::FORBIDDEN,
                "Access to IP literal is not permitted by proxy policy",
            );
        }
        if msg.contains("No DNS addresses resolved for host") {
            return (StatusCode::FORBIDDEN, "No DNS addresses resolved for host");
        }
        if msg.contains("Failed to resolve host via DNS") {
            return (StatusCode::FORBIDDEN, "Failed to resolve host via DNS");
        }
        current = cause.source();
    }
    (
        StatusCode::BAD_GATEWAY,
        "Failed to connect to upstream service",
    )
}

/// Read response body chunk-by-chunk with a strict maximum byte limit.
/// Fails closed with 413 Payload Too Large if Content-Length exceeds max_bytes or if chunked stream exceeds max_bytes,
/// preventing infinite chunked streams from exhausting memory.
pub async fn read_body_with_cap(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, (StatusCode, &'static str)> {
    if let Some(cl) = response.content_length() {
        if cl > max_bytes as u64 {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "Response payload exceeds maximum allowed size",
            ));
        }
    }

    let mut buf = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| {
        warn!("Error reading body chunk from upstream: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            "Failed reading response chunk from upstream",
        )
    })? {
        if chunk.len() > max_bytes.saturating_sub(buf.len()) {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "Response payload exceeds maximum allowed size",
            ));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// Rate limit map to debounce stream token refresh per stream key (max 1 refresh per 60s per key)
static REFRESH_RATE_LIMIT: LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>,
> = LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

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
];

/// Check if a Content-Type header contains disallowed active or executable MIME types
pub fn is_disallowed_stream_mime(content_type: &str) -> bool {
    let ct = content_type.to_lowercase();
    ct.contains("text/html")
        || ct.contains("application/xhtml+xml")
        || ct.contains("image/svg+xml")
        || ct.contains("application/xml")
        || ct.contains("text/xml")
        || ct.contains("application/javascript")
        || ct.contains("text/javascript")
        || ct.contains("application/x-javascript")
        || ct.contains("text/x-component")
        || (ct.contains("application/json") && !ct.contains("dash"))
}

/// Check if a Content-Type is an allowed raster image MIME type
pub fn is_allowed_image_mime(content_type: &str) -> bool {
    let ct = content_type.to_lowercase();
    ct.starts_with("image/jpeg")
        || ct.starts_with("image/jpg")
        || ct.starts_with("image/png")
        || ct.starts_with("image/webp")
        || ct.starts_with("image/avif")
        || ct.starts_with("image/gif")
}

/// Add baseline security headers (nosniff, CSP sandbox, frame-ancestors none, X-Frame-Options DENY)
pub fn add_security_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'; sandbox"),
    );
    headers.insert(
        header::HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
}

#[derive(Debug, Deserialize, Default)]
pub struct ProxyQuery {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub keep_cdn: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub ep: Option<i32>,
    #[serde(default)]
    pub season: Option<i32>,
    #[serde(default)]
    pub server: Option<usize>,
}

/// Check if an IP address belongs to internal, private, loopback, or link-local ranges.
pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            let o = ipv4.octets();
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || ipv4.is_broadcast()
                || o[0] == 0
                || ipv4.is_multicast()
                || (o[0] == 100 && (o[1] & 0xc0) == 64)
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)
                || (o[0] == 192 && o[1] == 0 && o[2] == 2)
                || (o[0] == 198 && o[1] == 51 && o[2] == 100)
                || (o[0] == 203 && o[1] == 0 && o[2] == 113)
                || (o[0] == 198 && (o[1] & 0xfe) == 18)
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
            (seg[0] & 0xfe00) == 0xfc00
                || (seg[0] & 0xffc0) == 0xfe80
                || (seg[0] == 0x2001 && seg[1] == 0x0db8)
        }
    }
}

/// Parse an IP literal from a host string, handling IPv4 and bracketed IPv6.
pub fn parse_ip_literal(host: &str) -> Option<IpAddr> {
    let trimmed = host.trim().trim_start_matches('[').trim_end_matches(']');
    trimmed.parse::<IpAddr>().ok()
}

/// Check if an IP literal is explicitly allowlisted by exact policy.
pub fn is_explicitly_allowlisted_ip(ip: &IpAddr, raw_host: &str) -> bool {
    if is_blocked_ip(*ip) {
        return false;
    }
    let ip_str = ip.to_string();
    let host_clean = raw_host.trim().trim_start_matches('[').trim_end_matches(']');

    for allowed in ALLOWED_DOMAINS {
        if *allowed == ip_str || *allowed == host_clean {
            return true;
        }
    }

    if let Ok(extra) = std::env::var("ALLOWED_PROXY_ORIGINS") {
        for origin in extra.split(',') {
            let o = origin.trim();
            if !o.is_empty() && (o == ip_str || o == host_clean) {
                return true;
            }
        }
    }

    false
}

/// Check if a host belongs to permitted upstream origins.
pub fn is_allowed_origin(host: &str) -> bool {
    let host_lower = host.to_lowercase();
    let host_trimmed = host_lower.trim_end_matches('.');

    if let Some(ip) = parse_ip_literal(host_trimmed) {
        return is_explicitly_allowlisted_ip(&ip, host_trimmed);
    }

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
            "token",
            "sig",
            "signature",
            "x-signature",
            "x-expires",
            "expires",
            "key",
            "auth",
            "lk3s",
            "secret",
            "pass",
            "password",
            "api_key",
        ];
        let pairs: Vec<(String, String)> = parsed
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        if !pairs.is_empty() {
            let mut new_pairs = Vec::new();
            for (k, v) in pairs {
                let k_lower = k.to_lowercase();
                if sensitive_params
                    .iter()
                    .any(|&s| k_lower == s || k_lower.contains(s))
                {
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

    let host_str = match parsed.host_str() {
        Some(h) => h,
        None => return Err("URL missing valid host"),
    };

    let host_lower = host_str.to_lowercase();
    if host_lower == "localhost" {
        return Err("Access to internal host is denied");
    }

    if let Some(ip) = parse_ip_literal(&host_lower) {
        if is_blocked_ip(ip) {
            return Err("Access to internal host is denied");
        }
        if !is_explicitly_allowlisted_ip(&ip, &host_lower) {
            return Err("Access to IP literal is not permitted by proxy policy");
        }
        return Ok(parsed);
    }

    if parsed.scheme() != "https" {
        return Err("Only https scheme is supported");
    }

    if let Some(port) = parsed.port() {
        if port != 443 {
            return Err("Access to internal host is denied");
        }
    }

    if !is_allowed_origin(&host_lower) {
        return Err("Access to host is not permitted by proxy policy");
    }

    Ok(parsed)
}

/// Resolve host and validate against blocked IP ranges. Fails closed if resolution fails.
pub async fn resolve_and_validate_host(host: &str, port: u16) -> Result<SocketAddr, &'static str> {
    if let Some(ip) = parse_ip_literal(host) {
        if is_blocked_ip(ip) {
            return Err("Access to internal host is denied");
        }
        if !is_explicitly_allowlisted_ip(&ip, host) {
            return Err("Access to IP literal is not permitted by proxy policy");
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
pub fn validate_redirect_target(url: &Url) -> Result<(), &'static str> {
    let host = url.host_str().ok_or("Missing host in redirect")?;
    let host_lower = host.to_lowercase();
    if host_lower == "localhost" {
        return Err("Access to localhost is denied");
    }
    if let Some(ip) = parse_ip_literal(&host_lower) {
        if is_blocked_ip(ip) {
            return Err("Access to internal IP is denied");
        }
        if !is_explicitly_allowlisted_ip(&ip, &host_lower) {
            return Err("Access to IP literal is not permitted by proxy policy");
        }
        return Ok(());
    }
    if url.scheme() != "https" {
        return Err("Forbidden scheme in redirect");
    }
    if let Some(p) = url.port() {
        if p != 443 {
            return Err("Forbidden port in redirect");
        }
    }
    if !is_allowed_origin(&host_lower) {
        return Err("Host not permitted in redirect");
    }
    let port = url.port_or_known_default().unwrap_or(443);
    match format!("{}:{}", host, port).to_socket_addrs() {
        Ok(addrs) => {
            let mut has_addr = false;
            for addr in addrs {
                has_addr = true;
                if is_blocked_ip(addr.ip()) {
                    return Err("Redirect resolved to blocked internal IP");
                }
            }
            if !has_addr {
                return Err("Redirect DNS returned no addresses");
            }
        }
        Err(_) => {
            return Err("Failed to resolve redirect host via DNS");
        }
    }
    Ok(())
}

/// Extract the raw upstream target URL from legacy (`https://secret.dangducminh.io.vn/?url=...`)
/// or local (`/api/proxy/stream?url=...` / `/?url=...`) proxy wrappers accurately using URL parsing.
pub fn extract_raw_url_from_proxy(url_str: &str) -> String {
    let mut current = url_str.trim().to_string();
    for _ in 0..3 {
        let parsed = if current.starts_with('/') {
            Url::parse(&format!("http://localhost{}", current)).ok()
        } else {
            Url::parse(&current).ok()
        };

        let Some(p) = parsed else {
            break;
        };

        let host_lower = p.host_str().unwrap_or("").to_ascii_lowercase();
        let is_legacy_wrapper = host_lower == "secret.dangducminh.io.vn";
        let is_local_proxy_path = p.path().contains("/proxy/stream") || p.path() == "/";

        if is_legacy_wrapper || is_local_proxy_path {
            if let Some((_, v)) = p.query_pairs().find(|(k, v)| k == "url" && !v.trim().is_empty()) {
                let unwrapped = v.trim().to_string();
                if is_legacy_wrapper
                    || p.path().contains("/proxy/stream")
                    || unwrapped.starts_with("https://")
                    || unwrapped.starts_with("http://")
                    || unwrapped.starts_with("/api/hls/")
                {
                    current = unwrapped;
                    continue;
                }
            }
        }
        break;
    }
    current
}

/// Unwrap legacy proxy wrappers and expand root-relative `/api/hls/...` paths to full upstream HTTPS URLs.
pub fn normalize_upstream_hls_url(url_str: &str) -> String {
    let unwrapped = extract_raw_url_from_proxy(url_str);
    if unwrapped.starts_with("/api/hls/") || unwrapped.starts_with("/api/subs/") {
        let api_base =
            std::env::var("FIML4K_API_BASE").unwrap_or_else(|_| "https://fiml4k.fun".to_string());
        format!("{}{}", api_base.trim_end_matches('/'), unwrapped)
    } else {
        unwrapped
    }
}

/// Build a clean local (or configured public) proxy stream URL without hardcoded personal domains.
pub fn build_proxy_stream_url(raw_hls: &str) -> String {
    let clean_hls = normalize_upstream_hls_url(raw_hls);
    let base = std::env::var("PUBLIC_PROXY_BASE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "/api/proxy/stream".to_string());
    let sep = if base.contains('?') { "&" } else { "?" };
    format!(
        "{}{}url={}",
        base.trim_end_matches('&').trim_end_matches('?'),
        sep,
        urlencoding::encode(&clean_hls)
    )
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

/// Identify direct CDN segment media URLs loaded directly by the player client when `keep_cdn` is enabled.
pub fn is_cdn_segment(url: &str) -> bool {
    let lower = url.to_lowercase();
    if lower.contains(".m3u8") {
        return false;
    }
    if lower.contains(".image") {
        return true;
    }
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
    rewrite_m3u8_with_context(content, source_url, proxy_base, keep_cdn, None, None, None, None)
}

#[allow(clippy::too_many_arguments)]
pub fn rewrite_m3u8_with_context(
    content: &str,
    source_url: &Url,
    proxy_base: &str,
    keep_cdn: bool,
    slug: Option<&str>,
    season: Option<i32>,
    ep: Option<i32>,
    server: Option<usize>,
) -> String {
    let append_ctx = |proxy_url: &mut String, target: &str| {
        if keep_cdn {
            proxy_url.push_str("&keep_cdn=1");
        }
        if target.to_ascii_lowercase().contains(".m3u8") {
            if let Some(s) = slug.filter(|s| !s.is_empty()) {
                proxy_url.push_str("&slug=");
                proxy_url.push_str(&urlencoding::encode(s));
            }
            if let Some(se) = season.filter(|&se| se > 0) {
                proxy_url.push_str(&format!("&season={}", se));
            }
            if let Some(e) = ep.filter(|&e| e > 0) {
                proxy_url.push_str(&format!("&ep={}", e));
            }
            if let Some(srv) = server.filter(|&srv| srv > 0) {
                proxy_url.push_str(&format!("&server={}", srv));
            }
        }
    };

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
                        append_ctx(&mut proxy_url, &full);
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
                append_ctx(&mut proxy_url, &full);
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
    add_security_headers(headers_mut);
    resp
}

/// Fetch fresh HLS stream URL from upstream fiml4k.fun API for a given movie slug using shared safe client
pub async fn fetch_upstream_title_hls(slug: &str) -> Option<String> {
    fetch_upstream_title_hls_with_client(shared_safe_http_client(), slug).await
}

/// Fetch fresh HLS stream URL from upstream fiml4k.fun API for a given movie slug with provided HTTP client
pub async fn fetch_upstream_title_hls_with_client(client: &Client, slug: &str) -> Option<String> {
    fetch_upstream_title_hls_with_episode(client, slug, None).await
}

pub async fn fetch_upstream_title_hls_for_season_episode(
    slug: &str,
    episode: i32,
    season: Option<i32>,
) -> Option<String> {
    fetch_upstream_title_hls_with_season_episode_server(
        shared_safe_http_client(),
        slug,
        Some(episode),
        season,
        None,
    )
    .await
}

pub async fn fetch_upstream_title_hls_for_season_episode_server(
    slug: &str,
    episode: Option<i32>,
    season: Option<i32>,
    server: Option<usize>,
) -> Option<String> {
    fetch_upstream_title_hls_with_season_episode_server(
        shared_safe_http_client(),
        slug,
        episode,
        season,
        server,
    )
    .await
}

pub async fn fetch_upstream_title_hls_for_episode(slug: &str, episode: i32) -> Option<String> {
    fetch_upstream_title_hls_for_season_episode(slug, episode, None).await
}

async fn fetch_upstream_title_hls_with_episode(
    client: &Client,
    slug: &str,
    episode: Option<i32>,
) -> Option<String> {
    fetch_upstream_title_hls_with_season_episode_server(client, slug, episode, None, None).await
}

pub async fn fetch_upstream_title_hls_with_season_episode_server(
    client: &Client,
    slug: &str,
    episode: Option<i32>,
    season: Option<i32>,
    server: Option<usize>,
) -> Option<String> {
    let primary_base =
        std::env::var("FIML4K_API_BASE").unwrap_or_else(|_| "https://fiml4k.fun".to_string());
    let candidate_bases = [primary_base, "https://film4k.net".to_string()];

    let mut json_val: Option<serde_json::Value> = None;
    let mut active_base = "https://fiml4k.fun".to_string();

    for base in &candidate_bases {
        let trimmed_base = base.trim_end_matches('/');
        let title_api_url = format!("{}/api/title/{}", trimmed_base, slug);
        let Ok(title_url) = is_valid_remote_url(&title_api_url) else {
            warn!(
                "Outbound host validation rejected upstream title API URL: {}",
                title_api_url
            );
            continue;
        };

        let referer = format!("{}/", trimmed_base);
        let (resp, _) =
            match fetch_stream_with_client_and_referer(client, &title_url, None, 3, Some(&referer))
                .await
            {
                Ok(r) => r,
                Err((code, msg)) => {
                    warn!(
                        "Failed to fetch upstream title API for slug {} (status: {}, {}): {}",
                        slug,
                        code,
                        msg,
                        redact_url_secrets(&title_api_url)
                    );
                    continue;
                }
            };

        if !resp.status().is_success() {
            warn!(
                "Upstream title API returned status {} for slug {}",
                resp.status(),
                slug
            );
            continue;
        }

        if let Ok(json_bytes) = read_body_with_cap(resp, MAX_TITLE_JSON_BYTES).await {
            if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&json_bytes) {
                active_base = trimmed_base.to_string();
                json_val = Some(parsed);
                break;
            }
        }
    }

    let json_val = json_val?;
    let hls_path = title_hls_url_with_season_server(&json_val, episode, season, server)?;

    let full_hls = if hls_path.starts_with('/') {
        format!("{}{}", active_base, hls_path)
    } else {
        extract_raw_url_from_proxy(hls_path)
    };

    if is_valid_remote_url(&full_hls).is_err() {
        warn!(
            "Outbound host validation rejected extracted upstream HLS URL for slug {}",
            slug
        );
        return None;
    }

    Some(full_hls)
}

#[allow(dead_code)]
fn title_hls_url(value: &serde_json::Value, episode: Option<i32>) -> Option<&str> {
    title_hls_url_with_season(value, episode, None)
}

fn title_hls_url_with_season(
    value: &serde_json::Value,
    episode: Option<i32>,
    season: Option<i32>,
) -> Option<&str> {
    title_hls_url_with_season_server(value, episode, season, None)
}

fn pick_source_at(ep_or_root: &serde_json::Value, server: Option<usize>) -> Option<&str> {
    let idx = server.unwrap_or(0);
    if let Some(sources) = ep_or_root.get("sources").and_then(|v| v.as_array()) {
        if let Some(s) = sources
            .get(idx)
            .or_else(|| sources.first())
            .and_then(|source| {
                source
                    .get("url")
                    .or_else(|| source.get("hlsUrl"))
                    .and_then(|u| u.as_str())
            })
            .filter(|u| !u.trim().is_empty())
        {
            return Some(s);
        }
    }
    if let Some(servers) = ep_or_root.get("servers").and_then(|v| v.as_array()) {
        if let Some(s) = servers
            .get(idx)
            .or_else(|| servers.first())
            .and_then(|source| {
                source
                    .get("hlsUrl")
                    .or_else(|| source.get("hls_url"))
                    .or_else(|| source.get("url"))
                    .and_then(|u| u.as_str())
            })
            .filter(|u| !u.trim().is_empty())
        {
            return Some(s);
        }
    }
    None
}

fn title_hls_url_with_season_server(
    value: &serde_json::Value,
    episode: Option<i32>,
    season: Option<i32>,
    server: Option<usize>,
) -> Option<&str> {
    let media_type = value
        .get("movie")
        .and_then(|m| m.get("mediaType").or_else(|| m.get("type")))
        .and_then(|t| t.as_str())
        .unwrap_or("");
    let ep_array_opt = value.get("episodes").and_then(|v| v.as_array());
    let has_episodes = ep_array_opt.is_some_and(|arr| !arr.is_empty());

    if let Some(wanted) = episode {
        if has_episodes {
            let ep_array = ep_array_opt?;
            let matched_ep = if let Some(s) = season {
                ep_array
                    .iter()
                    .find(|ep| {
                        let ep_season =
                            ep.get("season").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
                        let number = ep
                            .get("episode")
                            .or_else(|| ep.get("episodeNumber"))
                            .and_then(|v| v.as_i64())
                            .unwrap_or(1) as i32;
                        ep_season == s && number == wanted
                    })
                    .or_else(|| {
                        if (1..=ep_array.len()).contains(&(wanted as usize)) {
                            let candidate = &ep_array[wanted as usize - 1];
                            let ep_season = candidate
                                .get("season")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(1) as i32;
                            if ep_season == s {
                                Some(candidate)
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    })
            } else {
                let has_multi = ep_array
                    .iter()
                    .any(|ep| ep.get("season").and_then(|v| v.as_i64()).unwrap_or(1) > 1);
                if has_multi && (1..=ep_array.len()).contains(&(wanted as usize)) {
                    let candidate = &ep_array[wanted as usize - 1];
                    let number = candidate
                        .get("episode")
                        .or_else(|| candidate.get("episodeNumber"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(1) as i32;
                    if number != wanted {
                        Some(candidate)
                    } else {
                        ep_array.iter().find(|ep| {
                            let num = ep
                                .get("episode")
                                .or_else(|| ep.get("episodeNumber"))
                                .and_then(|v| v.as_i64())
                                .unwrap_or(1) as i32;
                            num == wanted
                        })
                    }
                } else {
                    ep_array.iter().find(|ep| {
                        let num = ep
                            .get("episode")
                            .or_else(|| ep.get("episodeNumber"))
                            .and_then(|v| v.as_i64())
                            .unwrap_or(1) as i32;
                        num == wanted
                    })
                }
            };

            if let Some(ep) = matched_ep {
                return pick_source_at(ep, server);
            }
            return None;
        }

        // Single movies have `episodes: []` in upstream `/api/title/:slug` while storing `movie.hlsUrl`.
        // Only fall through when episode == 1 and season <= 1 for non-TV titles; never fall back for episode > 1!
        if wanted != 1 || season.unwrap_or(1) > 1 || media_type.eq_ignore_ascii_case("tv") {
            return None;
        }
    }

    value
        .get("movie")
        .and_then(|m| m.get("hlsUrl"))
        .and_then(|h| h.as_str())
        .filter(|u| !u.trim().is_empty())
        .or_else(|| {
            ep_array_opt
                .and_then(|arr| arr.first())
                .and_then(|ep| pick_source_at(ep, server))
        })
        .or_else(|| pick_source_at(value, server))
}

/// Perform an HTTP GET request reusing a shared `SafeDnsResolver`-backed `reqwest::Client`
/// with manual fail-closed redirect validation.
pub async fn fetch_stream_with_client(
    client: &Client,
    target_url: &Url,
    range: Option<&HeaderValue>,
    max_hops: usize,
) -> Result<(reqwest::Response, Url), (StatusCode, &'static str)> {
    fetch_stream_with_client_and_referer(client, target_url, range, max_hops, None).await
}

pub async fn fetch_stream_with_referer(
    target_url: &Url,
    range: Option<&HeaderValue>,
    max_hops: usize,
    referer_override: Option<&str>,
) -> Result<(reqwest::Response, Url), (StatusCode, &'static str)> {
    fetch_stream_with_client_and_referer(
        shared_safe_http_client(),
        target_url,
        range,
        max_hops,
        referer_override,
    )
    .await
}

pub async fn fetch_stream_with_client_and_referer(
    client: &Client,
    target_url: &Url,
    range: Option<&HeaderValue>,
    max_hops: usize,
    referer_override: Option<&str>,
) -> Result<(reqwest::Response, Url), (StatusCode, &'static str)> {
    let mut current_url = target_url.clone();
    let mut hops = 0;

    loop {
        is_valid_remote_url(current_url.as_str()).map_err(|err| (StatusCode::FORBIDDEN, err))?;

        let host = current_url
            .host_str()
            .ok_or((StatusCode::BAD_REQUEST, "Missing host in URL"))?;

        let mut req = client.get(current_url.as_str());
        if let Some(r) = range {
            req = req.header(header::RANGE, r);
        }
        let referer = referer_override
            .map(str::to_owned)
            .unwrap_or_else(|| format!("https://{}/", host));
        req = req
            .header(header::REFERER, referer)
            .header(
                header::USER_AGENT,
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
            )
            .header(header::ACCEPT, "*/*");

        let resp = req.send().await.map_err(|err| {
            let (status, reason) = classify_reqwest_error(&err);
            if status == StatusCode::BAD_GATEWAY {
                let redacted = redact_url_secrets(current_url.as_str());
                error!("Upstream fetch error for {}", redacted);
            }
            (status, reason)
        })?;

        if resp.status().is_redirection() {
            if hops >= max_hops {
                return Err((StatusCode::BAD_GATEWAY, "Too many redirects"));
            }
            hops += 1;

            let loc = resp
                .headers()
                .get(header::LOCATION)
                .and_then(|l| l.to_str().ok())
                .ok_or((
                    StatusCode::BAD_GATEWAY,
                    "Missing or invalid redirect Location header",
                ))?;

            let next_url = current_url
                .join(loc)
                .map_err(|_| (StatusCode::BAD_GATEWAY, "Invalid redirect destination URL"))?;

            is_valid_remote_url(next_url.as_str()).map_err(|err| (StatusCode::FORBIDDEN, err))?;

            current_url = next_url;
            continue;
        }

        return Ok((resp, current_url));
    }
}

/// Perform an HTTP GET request with DNS validation and manual fail-closed redirect following
pub async fn fetch_pinned_stream(
    target_url: &Url,
    range: Option<&HeaderValue>,
    max_hops: usize,
) -> Result<(reqwest::Response, Url), (StatusCode, &'static str)> {
    fetch_stream_with_client(shared_safe_http_client(), target_url, range, max_hops).await
}

fn parse_context_from_referer(
    referer: &str,
) -> (Option<String>, Option<i32>, Option<i32>, Option<usize>) {
    let mut slug = None;
    let mut ep = None;
    let mut season = None;
    let mut server = None;

    for prefix in ["/watch/", "/xem-phim/", "/movie/", "/phim/"] {
        if let Some(pos) = referer.find(prefix) {
            let rest = &referer[pos + prefix.len()..];
            let path_part = rest.split('?').next().unwrap_or(rest).split('#').next().unwrap_or("");
            let mut segs = path_part.split('/').filter(|s| !s.is_empty());
            if let Some(s) = segs.next() {
                slug = Some(s.to_string());
                if (prefix == "/watch/" || prefix == "/xem-phim/") && ep.is_none() {
                    if let Some(ep_seg) = segs.next() {
                        let cleaned = ep_seg
                            .strip_prefix("tap-")
                            .or_else(|| ep_seg.strip_prefix("ep-"))
                            .unwrap_or(ep_seg);
                        if let Ok(parsed_ep) = cleaned.parse::<i32>() {
                            if parsed_ep > 0 {
                                ep = Some(parsed_ep);
                            }
                        }
                    }
                }
                break;
            }
        }
    }

    if let Ok(parsed_ref) = Url::parse(referer) {
        for (k, v) in parsed_ref.query_pairs() {
            match k.as_ref() {
                "ep" if ep.is_none() => {
                    if let Ok(n) = v.parse::<i32>() {
                        if n > 0 {
                            ep = Some(n);
                        }
                    }
                }
                "season" if season.is_none() => {
                    if let Ok(n) = v.parse::<i32>() {
                        if n > 0 {
                            season = Some(n);
                        }
                    }
                }
                "server" if server.is_none() => {
                    if let Ok(n) = v.parse::<usize>() {
                        server = Some(n);
                    }
                }
                _ => {}
            }
        }
    }

    (slug, season, ep, server)
}

pub async fn handle_stream_proxy(
    State(state): State<AppState>,
    Query(query): Query<ProxyQuery>,
    headers: HeaderMap,
) -> Response {
    let raw_input = query.url.trim();
    if raw_input.is_empty() {
        return (StatusCode::BAD_REQUEST, "Missing 'url' query parameter").into_response();
    }

    let unwrapped_target = normalize_upstream_hls_url(raw_input);
    let target_str = unwrapped_target.as_str();

    let parsed_url = match is_valid_remote_url(target_str) {
        Ok(u) => u,
        Err(err) => return (StatusCode::FORBIDDEN, err).into_response(),
    };

    let keep_cdn = query
        .keep_cdn
        .as_deref()
        .map(|v| v == "1" || v == "true")
        .unwrap_or(true);

    let (ref_slug, ref_season, ref_ep, ref_server) = headers
        .get(header::REFERER)
        .and_then(|v| v.to_str().ok())
        .map(parse_context_from_referer)
        .unwrap_or((None, None, None, None));

    let mut detected_slug = query.slug.clone().or(ref_slug);
    let mut detected_season = query.season.or(ref_season);
    let mut detected_ep = query.ep.or(ref_ep);
    let detected_server = query.server.or(ref_server);

    if detected_slug.is_none() || detected_ep.is_none() {
        let lookup_db = state.db.clone();
        let lookup_url = target_str.to_string();
        if let Ok(Some((db_slug, db_season, db_ep))) = state
            .db
            .run_read_blocking(move || Ok(lookup_db.find_stream_context_by_url(&lookup_url)))
            .await
        {
            if detected_slug.is_none() {
                detected_slug = Some(db_slug);
            }
            if detected_season.is_none() {
                detected_season = db_season;
            }
            if detected_ep.is_none() {
                detected_ep = db_ep;
            }
        }
    }

    let upstream_referer = if parsed_url
        .host_str()
        .is_some_and(|h| h.ends_with("fiml4k.fun") || h.ends_with("film4k.net"))
    {
        Some("https://fiml4k.fun/")
    } else {
        None
    };

    let (upstream_resp, final_url) = match fetch_stream_with_client_and_referer(
        &state.http_client,
        &parsed_url,
        headers.get(header::RANGE),
        5,
        upstream_referer,
    )
    .await
    {
        Ok(res) => res,
        Err((code, msg)) => return (code, msg).into_response(),
    };

    let status = upstream_resp.status();
    let content_type = upstream_resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if is_disallowed_stream_mime(&content_type) {
        warn!(
            "Upstream stream returned disallowed active MIME type: '{}'",
            content_type
        );
        let mut resp =
            (StatusCode::BAD_GATEWAY, "Upstream returned disallowed media type").into_response();
        add_security_headers(resp.headers_mut());
        return resp;
    }

    let is_m3u8 = final_url.path().ends_with(".m3u8")
        || content_type.contains("mpegurl")
        || content_type.contains("application/x-mpegURL")
        || content_type.contains("vnd.apple.mpegurl");
    let is_recoverable_status = matches!(
        status,
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND | StatusCode::GONE
    );

    if is_m3u8 || is_recoverable_status {
        if let Some(cl) = upstream_resp.content_length() {
            if cl > MAX_PLAYLIST_BYTES as u64 {
                let mut resp = (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Playlist response exceeds maximum allowed size",
                )
                    .into_response();
                add_security_headers(resp.headers_mut());
                return resp;
            }
        }
        match read_body_with_cap(upstream_resp, MAX_PLAYLIST_BYTES).await {
            Ok(bytes) => {
                let body_text = String::from_utf8_lossy(&bytes).to_string();
                let is_expired = is_recoverable_status
                    || body_text.contains("Invalid or expired token")
                    || body_text.contains("expired token");

                if is_expired {
                    let redacted_target = redact_url_secrets(target_str);
                    warn!(
                        "Upstream stream token expired (status: {}, slug: {:?}, season: {:?}, ep: {:?}, server: {:?}, url: {}). Refreshing...",
                        status,
                        detected_slug,
                        detected_season,
                        detected_ep,
                        detected_server,
                        redacted_target
                    );
                    if let Some(ref slug) = detected_slug {
                        let check_db = state.db.clone();
                        let slug_owned = slug.clone();
                        let movie_opt = state
                            .db
                            .run_read_blocking(move || check_db.get_movie_by_slug(&slug_owned))
                            .await
                            .ok()
                            .flatten();

                        if let Some(movie) = movie_opt {
                            // Never guess Episode 1 if a multi-episode TV series has no episode context
                            let can_refresh =
                                !(movie.movie_type == "tv" && !movie.episodes.is_empty() && detected_ep.is_none());

                            if can_refresh {
                                let rate_key = format!(
                                    "{}:{:?}:{:?}:{:?}",
                                    slug, detected_season, detected_ep, detected_server
                                );
                                let should_refresh = {
                                    let mut map = REFRESH_RATE_LIMIT
                                        .lock()
                                        .unwrap_or_else(|e| e.into_inner());
                                    let now = std::time::Instant::now();
                                    map.retain(|_, ts| now.duration_since(*ts) < Duration::from_secs(60));
                                    if map.contains_key(&rate_key) {
                                        false
                                    } else {
                                        if map.len() >= 4096 {
                                            map.clear();
                                        }
                                        map.insert(rate_key, now);
                                        true
                                    }
                                };

                                if should_refresh {
                                    if let Some(fresh_hls) =
                                        fetch_upstream_title_hls_with_season_episode_server(
                                            &state.http_client,
                                            slug,
                                            detected_ep,
                                            detected_season,
                                            detected_server,
                                        )
                                        .await
                                    {
                                        if fresh_hls != target_str {
                                            if let Ok(fresh_url) = is_valid_remote_url(&fresh_hls) {
                                                info!(
                                                    "Retrieved fresh stream token in memory for slug '{}' (season: {:?}, ep: {:?}, server: {:?})",
                                                    slug, detected_season, detected_ep, detected_server
                                                );
                                                if let Ok((retry_resp, final_fresh_url)) =
                                                    fetch_stream_with_client_and_referer(
                                                        &state.http_client,
                                                        &fresh_url,
                                                        headers.get(header::RANGE),
                                                        5,
                                                        Some("https://fiml4k.fun/"),
                                                    )
                                                    .await
                                                {
                                                    if retry_resp.status().is_success() {
                                                        if let Ok(fresh_bytes) =
                                                            read_body_with_cap(retry_resp, MAX_PLAYLIST_BYTES)
                                                                .await
                                                        {
                                                            let fresh_body =
                                                                String::from_utf8_lossy(&fresh_bytes)
                                                                    .to_string();
                                                            let rewritten = rewrite_m3u8_with_context(
                                                                &fresh_body,
                                                                &final_fresh_url,
                                                                "/api/proxy/stream",
                                                                keep_cdn,
                                                                Some(slug.as_str()),
                                                                detected_season,
                                                                detected_ep,
                                                                detected_server,
                                                            );
                                                            return create_m3u8_response(rewritten);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    warn!("Debounced stream refresh for slug {}", slug);
                                }
                            }
                        }
                    }

                    if !status.is_success() {
                        let mut resp = (status, body_text).into_response();
                        add_security_headers(resp.headers_mut());
                        return resp;
                    }
                }

                if is_m3u8 && status.is_success() {
                    let rewritten = rewrite_m3u8_with_context(
                        &body_text,
                        &final_url,
                        "/api/proxy/stream",
                        keep_cdn,
                        detected_slug.as_deref(),
                        detected_season,
                        detected_ep,
                        detected_server,
                    );
                    return create_m3u8_response(rewritten);
                } else if !status.is_success() {
                    let mut resp = (status, body_text).into_response();
                    add_security_headers(resp.headers_mut());
                    return resp;
                }

                let rewritten = rewrite_m3u8_with_context(
                    &body_text,
                    &final_url,
                    "/api/proxy/stream",
                    keep_cdn,
                    detected_slug.as_deref(),
                    detected_season,
                    detected_ep,
                    detected_server,
                );
                create_m3u8_response(rewritten)
            }
            Err((status, message)) => {
                let mut resp = (status, message).into_response();
                add_security_headers(resp.headers_mut());
                resp
            }
        }
    } else {
        if let Some(cl) = upstream_resp.content_length() {
            if cl > MAX_STREAM_BYTES {
                let mut resp = (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Stream segment exceeds maximum allowed size (50MB)",
                )
                    .into_response();
                add_security_headers(resp.headers_mut());
                return resp;
            }
        }

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
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
            .header("X-Content-Type-Options", "nosniff")
            .header(
                "Content-Security-Policy",
                "default-src 'none'; frame-ancestors 'none'; sandbox",
            )
            .header("X-Frame-Options", "DENY");

        let stream = capped_stream(upstream_resp.bytes_stream(), MAX_STREAM_BYTES);
        resp_builder
            .body(Body::from_stream(stream))
            .unwrap_or_else(|_| {
                let mut err_resp =
                    (StatusCode::INTERNAL_SERVER_ERROR, "Stream error").into_response();
                add_security_headers(err_resp.headers_mut());
                err_resp
            })
    }
}

fn capped_stream<S, E>(
    stream: S,
    max_bytes: u64,
) -> impl futures_util::Stream<Item = Result<Bytes, std::io::Error>>
where
    S: futures_util::Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    futures_util::stream::try_unfold((stream, 0u64), move |(mut stream, mut total)| async move {
        match stream.next().await {
            Some(Ok(chunk)) => {
                if chunk.len() as u64 > max_bytes.saturating_sub(total) {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "upstream stream exceeds configured byte limit",
                    ));
                }
                total += chunk.len() as u64;
                Ok(Some((chunk, (stream, total))))
            }
            Some(Err(error)) => Err(std::io::Error::other(error.to_string())),
            None => Ok(None),
        }
    })
}

#[derive(Debug, Deserialize)]
pub struct ImageProxyQuery {
    pub url: String,
}

pub async fn handle_image_proxy(
    State(state): State<AppState>,
    Query(query): Query<ImageProxyQuery>,
) -> Response {
    let target_str = query.url.trim();
    if target_str.is_empty() {
        let mut r = (StatusCode::BAD_REQUEST, "Missing 'url' query parameter").into_response();
        add_security_headers(r.headers_mut());
        return r;
    }

    let parsed_url = match is_valid_remote_url(target_str) {
        Ok(u) => u,
        Err(err) => {
            let mut r = (StatusCode::FORBIDDEN, err).into_response();
            add_security_headers(r.headers_mut());
            return r;
        }
    };

    let host = match parsed_url.host_str() {
        Some(h) => h,
        None => {
            let mut r = (StatusCode::BAD_REQUEST, "Missing host in image URL").into_response();
            add_security_headers(r.headers_mut());
            return r;
        }
    };

    let (resp, _) = match fetch_stream_with_client_and_referer(
        &state.http_client,
        &parsed_url,
        None,
        3,
        Some(&format!("https://{}/", host)),
    )
    .await
    {
        Ok(r) => r,
        Err((status, msg)) => {
            let mut r = (status, msg).into_response();
            add_security_headers(r.headers_mut());
            return r;
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let mut r = (status, "Image upstream returned error").into_response();
        add_security_headers(r.headers_mut());
        return r;
    }

    if let Some(cl) = resp.content_length() {
        if cl > MAX_IMAGE_BYTES as u64 {
            let mut r = (
                StatusCode::PAYLOAD_TOO_LARGE,
                "Image exceeds maximum allowed size (10MB)",
            )
                .into_response();
            add_security_headers(r.headers_mut());
            return r;
        }
    }

    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !is_allowed_image_mime(&content_type) {
        warn!(
            "Image proxy rejected disallowed MIME type: '{}'",
            content_type
        );
        let mut r = (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Disallowed image media type (only raster images supported)",
        )
            .into_response();
        add_security_headers(r.headers_mut());
        return r;
    }

    let bytes = match read_body_with_cap(resp, MAX_IMAGE_BYTES).await {
        Ok(b) => b,
        Err((status, message)) => {
            let mut r = (status, message).into_response();
            add_security_headers(r.headers_mut());
            return r;
        }
    };

    let mut response = Response::new(Body::from(bytes));
    let headers_mut = response.headers_mut();
    if let Ok(ct_val) = HeaderValue::from_str(&content_type) {
        headers_mut.insert(header::CONTENT_TYPE, ct_val);
    } else {
        headers_mut.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/jpeg"));
    }
    headers_mut.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400, stale-while-revalidate=43200"),
    );
    headers_mut.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    add_security_headers(headers_mut);
    response
}

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
        assert!(is_valid_remote_url("https://fiml4k.fun/api/hls/test/master.m3u8").is_ok());
        assert!(is_valid_remote_url("https://v16m-default.akamaicdn.net/test.png").is_ok());
        assert_eq!(
            is_valid_remote_url("http://fiml4k.fun/api/hls/test/master.m3u8").unwrap_err(),
            "Only https scheme is supported"
        );
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

        assert!(is_valid_remote_url("http://[::1]/status").is_err());
        assert!(is_valid_remote_url("http://[fe80::1]/status").is_err());
        assert!(is_valid_remote_url("http://[fc00::1]/status").is_err());
        assert!(is_valid_remote_url("http://[::ffff:127.0.0.1]/status").is_err());

        assert!(is_valid_remote_url("https://film4k.net:22/master.m3u8").is_err());
        assert!(is_valid_remote_url("https://film4k.net:8080/master.m3u8").is_err());

        assert!(is_valid_remote_url("https://evil-attacker.com/unpermitted.m3u8").is_err());
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

        assert!(rewritten.contains(
            r#"URI="/api/proxy/stream?url=https%3A%2F%2Ffilm4k.net%2Fapi%2Fhls%2Faudio%2Feng.m3u8&keep_cdn=1""#
        ));
        assert!(rewritten.contains(
            "/api/proxy/stream?url=https%3A%2F%2Ffilm4k.net%2Fapi%2Fhls%2Fvideo%2F4k.m3u8&keep_cdn=1"
        ));
        assert!(rewritten.contains("https://v16m-default.akamaicdn.net/chunk01.image"));
        assert!(rewritten.contains(
            "/api/proxy/stream?url=https%3A%2F%2Ffilm4k.net%2Fapi%2Fhls%2Fsegment02.ts&keep_cdn=1"
        ));
    }

    #[test]
    fn test_rewrite_m3u8_force_proxy_all() {
        let sample_m3u8 = r#"#EXTM3U
#EXTINF:6.0,
https://v16m-default.akamaicdn.net/chunk01.image
"#;
        let base_url = Url::parse("https://film4k.net/api/hls/master.m3u8").unwrap();
        let rewritten = rewrite_m3u8(sample_m3u8, &base_url, "/api/proxy/stream", false);

        assert!(rewritten.contains(
            "/api/proxy/stream?url=https%3A%2F%2Fv16m-default.akamaicdn.net%2Fchunk01.image"
        ));
    }

    #[test]
    fn test_reject_all_unallowlisted_ip_literals() {
        let err1 = is_valid_remote_url("https://1.1.1.1/master.m3u8").unwrap_err();
        assert_eq!(err1, "Access to IP literal is not permitted by proxy policy");

        let err2 = is_valid_remote_url("https://8.8.8.8/chunk.ts").unwrap_err();
        assert_eq!(err2, "Access to IP literal is not permitted by proxy policy");

        let err3 = is_valid_remote_url("https://[2606:4700:4700::1111]/master.m3u8").unwrap_err();
        assert_eq!(err3, "Access to IP literal is not permitted by proxy policy");

        let err4 = is_valid_remote_url("https://127.0.0.1:8090/status").unwrap_err();
        assert_eq!(err4, "Access to internal host is denied");

        let err5 = is_valid_remote_url("https://192.168.1.1/admin").unwrap_err();
        assert_eq!(err5, "Access to internal host is denied");

        let err6 = is_valid_remote_url("https://[::1]/status").unwrap_err();
        assert_eq!(err6, "Access to internal host is denied");
    }

    #[test]
    fn test_validate_redirect_target_rejects_ip_literals() {
        let u1 = Url::parse("https://1.1.1.1/sub.m3u8").unwrap();
        assert_eq!(
            validate_redirect_target(&u1).unwrap_err(),
            "Access to IP literal is not permitted by proxy policy"
        );

        let u2 = Url::parse("https://127.0.0.1/sub.m3u8").unwrap();
        assert_eq!(
            validate_redirect_target(&u2).unwrap_err(),
            "Access to internal IP is denied"
        );

        let u3 = Url::parse("https://[2606:4700:4700::1111]/sub.m3u8").unwrap();
        assert_eq!(
            validate_redirect_target(&u3).unwrap_err(),
            "Access to IP literal is not permitted by proxy policy"
        );

        let u4 = Url::parse("https://evil.com/sub.m3u8").unwrap();
        assert_eq!(
            validate_redirect_target(&u4).unwrap_err(),
            "Host not permitted in redirect"
        );

        let u_valid = Url::parse("https://film4k.net/api/hls/sub.m3u8").unwrap();
        assert!(validate_redirect_target(&u_valid).is_ok());

        let u_http = Url::parse("http://film4k.net/api/hls/sub.m3u8").unwrap();
        assert_eq!(
            validate_redirect_target(&u_http).unwrap_err(),
            "Forbidden scheme in redirect"
        );
    }

    #[test]
    fn test_extract_raw_url_from_proxy_and_legacy_wrapper() {
        let proxied = "/api/proxy/stream?url=https%3A%2F%2Ffilm4k.net%2Fvideo.m3u8&keep_cdn=1";
        assert_eq!(
            extract_raw_url_from_proxy(proxied),
            "https://film4k.net/video.m3u8"
        );

        let full_proxied =
            "https://mysite.com/api/proxy/stream?url=https%3A%2F%2Ffilm4k.net%2Fvideo.m3u8";
        assert_eq!(
            extract_raw_url_from_proxy(full_proxied),
            "https://film4k.net/video.m3u8"
        );

        let legacy_wrapped =
            "https://secret.dangducminh.io.vn/?url=https%3A%2F%2Ffiml4k.fun%2Fapi%2Fhls%2FTOKEN%2Fmaster.m3u8";
        assert_eq!(
            extract_raw_url_from_proxy(legacy_wrapped),
            "https://fiml4k.fun/api/hls/TOKEN/master.m3u8"
        );

        let root_query_wrapped =
            "/?url=https%3A%2F%2Ffiml4k.fun%2Fapi%2Fhls%2FTOKEN%2Fmaster.m3u8";
        assert_eq!(
            extract_raw_url_from_proxy(root_query_wrapped),
            "https://fiml4k.fun/api/hls/TOKEN/master.m3u8"
        );

        let direct = "https://film4k.net/direct.m3u8";
        assert_eq!(extract_raw_url_from_proxy(direct), direct);
    }

    #[tokio::test]
    async fn test_resolve_and_validate_host_fails_closed_on_dns_failure() {
        let res = resolve_and_validate_host("nonexistent-domain-xyz-12345.com", 443).await;
        assert_eq!(res.unwrap_err(), "Failed to resolve host via DNS");
    }

    #[test]
    fn test_mime_validation() {
        assert!(is_disallowed_stream_mime("text/html"));
        assert!(is_disallowed_stream_mime("text/html; charset=utf-8"));
        assert!(is_disallowed_stream_mime("image/svg+xml"));
        assert!(is_disallowed_stream_mime("application/javascript"));
        assert!(is_disallowed_stream_mime("application/xml"));
        assert!(is_disallowed_stream_mime("text/xml"));
        assert!(!is_disallowed_stream_mime("application/vnd.apple.mpegurl"));
        assert!(!is_disallowed_stream_mime("application/x-mpegURL"));
        assert!(!is_disallowed_stream_mime("video/mp4"));
        assert!(!is_disallowed_stream_mime("video/mp2t"));
        assert!(!is_disallowed_stream_mime("application/octet-stream"));

        assert!(is_allowed_image_mime("image/jpeg"));
        assert!(is_allowed_image_mime("image/png"));
        assert!(is_allowed_image_mime("image/webp"));
        assert!(is_allowed_image_mime("image/avif"));
        assert!(is_allowed_image_mime("image/gif"));
        assert!(!is_allowed_image_mime("image/svg+xml"));
        assert!(!is_allowed_image_mime("text/html"));
        assert!(!is_allowed_image_mime("application/javascript"));
    }

    #[test]
    fn title_refresh_selects_requested_episode_and_fails_closed_if_missing() {
        let title = serde_json::json!({
            "episodes": [
                {"episode": 1, "sources": [{"url": "/api/hls/ep1/master.m3u8"}]},
                {"episode": 2, "sources": [{"url": "/api/hls/ep2/master.m3u8"}]}
            ]
        });
        assert_eq!(
            title_hls_url(&title, Some(2)),
            Some("/api/hls/ep2/master.m3u8")
        );
        assert_eq!(title_hls_url(&title, Some(3)), None);
        assert_eq!(title_hls_url(&title, None), Some("/api/hls/ep1/master.m3u8"));

        // Single movie with empty episodes array resolves movie.hlsUrl for ep 1 / None, fails closed for ep 2
        let single_title = serde_json::json!({
            "movie": {
                "mediaType": "movie",
                "hlsUrl": "/api/hls/single_movie_fresh/master.m3u8"
            },
            "episodes": []
        });
        assert_eq!(
            title_hls_url(&single_title, Some(1)),
            Some("/api/hls/single_movie_fresh/master.m3u8")
        );
        assert_eq!(
            title_hls_url(&single_title, None),
            Some("/api/hls/single_movie_fresh/master.m3u8")
        );
        assert_eq!(title_hls_url(&single_title, Some(2)), None);
    }

    #[test]
    fn test_title_hls_url_with_season_resolution() {
        let title = serde_json::json!({
            "episodes": [
                {"season": 1, "episode": 5, "sources": [{"url": "/api/hls/s1e5/master.m3u8"}]},
                {"season": 2, "episode": 1, "sources": [{"url": "/api/hls/s2e1/master.m3u8"}]},
                {"season": 2, "episode": 5, "sources": [{"url": "/api/hls/s2e5/master.m3u8"}]}
            ]
        });
        assert_eq!(
            title_hls_url_with_season(&title, Some(1), Some(2)),
            Some("/api/hls/s2e1/master.m3u8")
        );
        assert_eq!(
            title_hls_url_with_season(&title, Some(5), Some(1)),
            Some("/api/hls/s1e5/master.m3u8")
        );
        assert_eq!(
            title_hls_url_with_season(&title, Some(5), Some(2)),
            Some("/api/hls/s2e5/master.m3u8")
        );
        assert_eq!(
            title_hls_url_with_season(&title, Some(2), Some(2)),
            Some("/api/hls/s2e1/master.m3u8")
        );
        assert_eq!(
            title_hls_url_with_season(&title, Some(2), None),
            Some("/api/hls/s2e1/master.m3u8")
        );
    }

    #[tokio::test]
    async fn capped_stream_rejects_unknown_length_over_limit_without_buffering() {
        let chunks = futures_util::stream::iter(vec![
            Ok::<_, std::io::Error>(Bytes::from_static(b"1234")),
            Ok::<_, std::io::Error>(Bytes::from_static(b"5678")),
        ]);
        let collected = capped_stream(chunks, 6).collect::<Vec<_>>().await;
        assert_eq!(collected.len(), 2);
        assert_eq!(collected[0].as_ref().unwrap(), &Bytes::from_static(b"1234"));
        assert_eq!(
            collected[1].as_ref().unwrap_err().kind(),
            std::io::ErrorKind::InvalidData
        );
    }
}
