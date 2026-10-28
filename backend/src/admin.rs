use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tracing::{info, warn};

use crate::crawler::CrawlerStatus;
use crate::AppState;

static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(1000);

/// Bounded session lifetime: 4 hours
const SESSION_TTL: Duration = Duration::from_secs(4 * 3600);

/// Maximum failed login attempts before lockout
pub const MAX_FAILED_ATTEMPTS: u32 = 5;

/// Lockout duration after exceeding MAX_FAILED_ATTEMPTS: 15 minutes
pub const LOCKOUT_DURATION: Duration = Duration::from_secs(15 * 60);

/// Constant-time string comparison using SHA-256 and subtle::ConstantTimeEq
/// to prevent timing attacks across varied string lengths.
pub fn constant_time_eq_str(a: &str, b: &str) -> bool {
    let hash_a = Sha256::digest(a.as_bytes());
    let hash_b = Sha256::digest(b.as_bytes());
    hash_a.as_slice().ct_eq(hash_b.as_slice()).into()
}

/// Extract client IP address from proxy headers (Cloudflare, reverse proxies)
pub fn extract_client_ip(headers: &HeaderMap) -> String {
    if let Some(val) = headers.get("cf-connecting-ip") {
        if let Ok(s) = val.to_str() {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    if let Some(val) = headers.get("x-real-ip") {
        if let Ok(s) = val.to_str() {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    if let Some(val) = headers.get("x-forwarded-for") {
        if let Ok(s) = val.to_str() {
            if let Some(first) = s.split(',').next() {
                let trimmed = first.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }
    "unknown".to_string()
}

fn generate_secure_token() -> String {
    let mut bytes = [0u8; 32];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        if f.read_exact(&mut bytes).is_ok() {
            let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
            return format!("adm_{}", hex);
        }
    }
    // Fallback mixing timestamp, pid, counter
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let seq = TOKEN_COUNTER.fetch_add(1, Ordering::SeqCst);
    let mix = now ^ ((pid as u128) << 64) ^ (seq as u128);
    format!("adm_{:032x}", mix)
}

#[derive(Clone)]
pub struct AdminService {
    admin_password: Option<String>,
    sessions: Arc<RwLock<HashMap<String, Instant>>>,
    failed_attempts: Arc<RwLock<HashMap<String, (u32, Instant)>>>,
}

impl Default for AdminService {
    fn default() -> Self {
        Self::new()
    }
}

impl AdminService {
    /// Validates password strength: at least 8 characters, disallows trivial defaults.
    pub fn is_strong_password(pass: &str) -> bool {
        let trimmed = pass.trim();
        if trimmed.len() < 8 {
            return false;
        }
        let lower = trimmed.to_lowercase();
        let weak_list = [
            "password",
            "12345678",
            "123456789",
            "admin123",
            "administrator",
            "root1234",
        ];
        if weak_list.contains(&lower.as_str()) {
            return false;
        }
        true
    }

    pub fn from_env() -> Result<Self, String> {
        let pass = std::env::var("ADMIN_PASSWORD")
            .map_err(|_| "ADMIN_PASSWORD environment variable is not set".to_string())?;
        let trimmed = pass.trim();
        if !Self::is_strong_password(trimmed) {
            return Err("ADMIN_PASSWORD is too weak (must be at least 8 characters and not a trivial dictionary word)".to_string());
        }
        Ok(Self::with_password(trimmed))
    }

    pub fn new() -> Self {
        match Self::from_env() {
            Ok(s) => s,
            Err(e) => {
                warn!("⚠️ AdminService: {}. Failing securely: admin authentication is disabled.", e);
                Self {
                    admin_password: None,
                    sessions: Arc::new(RwLock::new(HashMap::new())),
                    failed_attempts: Arc::new(RwLock::new(HashMap::new())),
                }
            }
        }
    }

    pub fn with_password(password: impl Into<String>) -> Self {
        let pass = password.into();
        let trimmed = pass.trim();
        let admin_password = if Self::is_strong_password(trimmed) {
            Some(trimmed.to_string())
        } else {
            warn!("⚠️ Weak password provided to AdminService::with_password; failing securely.");
            None
        };
        Self {
            admin_password,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            failed_attempts: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn verify_password(&self, password: &str) -> bool {
        match &self.admin_password {
            Some(admin_pw) if !admin_pw.is_empty() && !password.is_empty() => {
                constant_time_eq_str(admin_pw, password)
            }
            _ => false,
        }
    }

    pub fn is_login_rate_limited(&self, client_id: &str) -> bool {
        let attempts = self.failed_attempts.read().unwrap();
        if let Some(&(count, last_attempt)) = attempts.get(client_id) {
            if count >= MAX_FAILED_ATTEMPTS {
                if last_attempt.elapsed() < LOCKOUT_DURATION {
                    return true;
                }
            }
        }
        false
    }

    pub fn record_failed_attempt(&self, client_id: &str) -> u32 {
        let mut attempts = self.failed_attempts.write().unwrap();
        let now = Instant::now();
        attempts.retain(|_, (_, time)| time.elapsed() < LOCKOUT_DURATION);
        let entry = attempts.entry(client_id.to_string()).or_insert((0, now));
        if entry.1.elapsed() >= LOCKOUT_DURATION {
            entry.0 = 0;
        }
        entry.0 += 1;
        entry.1 = now;
        entry.0
    }

    pub fn reset_failed_attempts(&self, client_id: &str) {
        let mut attempts = self.failed_attempts.write().unwrap();
        attempts.remove(client_id);
    }

    pub fn create_session(&self) -> String {
        let token = generate_secure_token();
        let expires_at = Instant::now() + SESSION_TTL;

        let mut sessions = self.sessions.write().unwrap();
        let now = Instant::now();
        sessions.retain(|_, &mut exp| exp > now);
        sessions.insert(token.clone(), expires_at);
        token
    }

    pub fn invalidate_session(&self, token: &str) -> bool {
        let mut sessions = self.sessions.write().unwrap();
        let token = token.trim();
        let key_to_remove = sessions
            .keys()
            .find(|k| constant_time_eq_str(k, token))
            .cloned();
        if let Some(k) = key_to_remove {
            sessions.remove(&k).is_some()
        } else {
            false
        }
    }

    pub fn is_authenticated(&self, headers: &HeaderMap) -> bool {
        // 1. Check X-Admin-Key
        if let Some(key_header) = headers.get("X-Admin-Key") {
            if let Ok(key) = key_header.to_str() {
                if let Some(ref admin_pw) = self.admin_password {
                    if !admin_pw.is_empty() && constant_time_eq_str(admin_pw, key) {
                        return true;
                    }
                }
            }
        }

        // 2. Check Authorization: Bearer <token>
        if let Some(auth_header) = headers.get(axum::http::header::AUTHORIZATION) {
            if let Ok(auth_str) = auth_header.to_str() {
                if let Some(token) = auth_str.strip_prefix("Bearer ") {
                    let token = token.trim();
                    let now = Instant::now();
                    let sessions = self.sessions.read().unwrap();
                    for (valid_token, &expires_at) in sessions.iter() {
                        if constant_time_eq_str(valid_token, token) {
                            if expires_at > now {
                                return true;
                            }
                            break;
                        }
                    }
                }
            }
        }

        false
    }
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    pub message: String,
}

pub async fn admin_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Response {
    let client_ip = extract_client_ip(&headers);
    if state.admin.is_login_rate_limited(&client_ip) {
        warn!("🚫 Admin login throttled: too many failed attempts for client {}", client_ip);
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(axum::http::header::RETRY_AFTER, "900")],
            Json(LoginResponse {
                success: false,
                token: None,
                message: "Quá nhiều lần thử đăng nhập thất bại. Vui lòng thử lại sau 15 phút.".to_string(),
            }),
        )
            .into_response();
    }

    if state.admin.verify_password(&payload.password) {
        state.admin.reset_failed_attempts(&client_ip);
        let token = state.admin.create_session();
        info!("🔑 Admin login successful. Token created.");
        (
            StatusCode::OK,
            Json(LoginResponse {
                success: true,
                token: Some(token),
                message: "Login successful".to_string(),
            }),
        )
            .into_response()
    } else {
        let attempts = state.admin.record_failed_attempt(&client_ip);
        warn!("🚫 Admin login failed: invalid password attempt ({}/{} attempts) from client {}", attempts, MAX_FAILED_ATTEMPTS, client_ip);
        (
            StatusCode::UNAUTHORIZED,
            Json(LoginResponse {
                success: false,
                token: None,
                message: "Invalid admin password".to_string(),
            }),
        )
            .into_response()
    }
}

pub async fn admin_logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Some(auth_header) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                state.admin.invalidate_session(token);
            }
        }
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "message": "Logged out successfully"
        })),
    )
        .into_response()
}

fn require_auth(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    if state.admin.is_authenticated(headers) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "success": false,
                "error": "Unauthorized: invalid or missing admin token or X-Admin-Key"
            })),
        )
            .into_response())
    }
}

#[derive(Debug, Serialize)]
pub struct DiskUsage {
    pub playlists_bytes: u64,
    pub database_bytes: u64,
    pub total_bytes: u64,
    pub human_readable: String,
}

#[derive(Debug, Serialize)]
pub struct AdminStatsResponse {
    pub success: bool,
    pub total_movies: i64,
    pub total_series: i64,
    pub total_single: i64,
    pub total_items: i64,
    pub cached_playlists_count: usize,
    pub cached_m3u8_count: usize,
    pub crawler_is_running: bool,
    pub crawler_progress_percent: f64,
    pub crawler_processed: usize,
    pub crawler_total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crawler_current_movie: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crawler_last_run: Option<String>,
    pub crawler_last_status: String,
    pub crawler_status: CrawlerStatus,
    pub disk_usage: DiskUsage,
}

pub async fn admin_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp;
    }

    let (total_items, total_movies, total_series) = state
        .db
        .get_stats()
        .unwrap_or((0, 0, 0));

    let base_dir = state.playlist_cache.base_dir();
    let playlists_bytes = dir_size(&base_dir);
    let cached_playlists_count = count_cached_playlists(&base_dir);

    let database_bytes = find_db_size();
    let total_bytes = playlists_bytes + database_bytes;

    let crawler_status = state.crawler.get_status();

    let stats = AdminStatsResponse {
        success: true,
        total_movies: total_items,
        total_series,
        total_single: total_movies,
        total_items,
        cached_playlists_count,
        cached_m3u8_count: cached_playlists_count,
        crawler_is_running: crawler_status.is_running,
        crawler_progress_percent: crawler_status.percent,
        crawler_processed: crawler_status.current_index,
        crawler_total: if crawler_status.total_discovered > 0 {
            crawler_status.total_discovered
        } else {
            total_items as usize
        },
        crawler_current_movie: crawler_status.current_slug.clone(),
        crawler_last_run: crawler_status.last_run.clone(),
        crawler_last_status: crawler_status.last_status.clone(),
        crawler_status,
        disk_usage: DiskUsage {
            playlists_bytes,
            database_bytes,
            total_bytes,
            human_readable: format_bytes(total_bytes),
        },
    };

    (StatusCode::OK, Json(stats)).into_response()
}

pub async fn admin_crawler_start(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp;
    }

    let triggered = state.crawler.trigger_mode("full");

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": triggered,
            "mode": "full",
            "message": if triggered {
                "Đã kích hoạt quét toàn bộ 3,211 phim thành công"
            } else {
                "Crawler đang chạy"
            }
        })),
    )
        .into_response()
}

pub async fn admin_crawler_update(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp;
    }

    let triggered = state.crawler.trigger_mode("latest");

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": triggered,
            "mode": "latest",
            "message": if triggered {
                "Đang quét cập nhật các phim mới"
            } else {
                "Crawler đang chạy"
            }
        })),
    )
        .into_response()
}

pub async fn admin_crawler_warmup(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp;
    }

    let triggered = state.crawler.trigger_mode("prewarm");

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": triggered,
            "mode": "prewarm",
            "message": if triggered {
                "Đang làm nóng cache M3U8 cho các phim thịnh hành nhất"
            } else {
                "Crawler đang chạy"
            }
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize, Default)]
pub struct TriggerRequest {
    pub mode: Option<String>,
}

pub async fn admin_crawler_trigger(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<TriggerRequest>>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp;
    }

    let mode = payload
        .and_then(|p| p.mode.clone())
        .unwrap_or_else(|| "latest".to_string());

    let valid_modes = ["full", "latest", "prewarm", "force"];
    let mode_str = if valid_modes.contains(&mode.as_str()) {
        mode.as_str()
    } else {
        "latest"
    };

    let triggered = state.crawler.trigger_mode(mode_str);

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": triggered,
            "mode": mode_str,
            "message": if triggered {
                format!("Crawler started in '{}' mode", mode_str)
            } else {
                "Crawler is already currently running".to_string()
            }
        })),
    )
        .into_response()
}

pub async fn admin_crawler_stop(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp;
    }

    state.crawler.stop();

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "message": "Crawler stop signal sent successfully"
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize, Default)]
pub struct ClearCacheRequest {
    pub slug: Option<String>,
}

pub async fn admin_cache_clear(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<ClearCacheRequest>>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp;
    }

    let base_dir = state.playlist_cache.base_dir();
    let target_slug = payload.and_then(|p| p.slug.clone()).filter(|s| !s.trim().is_empty());

    if let Some(slug) = target_slug {
        if !crate::playlist_cache::is_safe_filename(&slug) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "success": false,
                    "error": "Invalid slug format"
                })),
            )
                .into_response();
        }

        let slug_dir = base_dir.join(&slug);
        let exists = slug_dir.exists();
        if exists {
            if let Err(e) = std::fs::remove_dir_all(&slug_dir) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": format!("Failed to delete playlist cache for '{}': {}", slug, e)
                    })),
                )
                    .into_response();
            }
        }

        (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "cleared_slug": slug,
                "message": if exists {
                    "Cache directory for slug deleted successfully"
                } else {
                    "Cache directory for slug did not exist"
                }
            })),
        )
            .into_response()
    } else {
        // Clear all playlists in base_dir
        let mut count = 0;
        if base_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&base_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let _ = std::fs::remove_dir_all(&path);
                        count += 1;
                    } else if path.is_file() {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }

        (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "cleared_slug": null,
                "directories_removed": count,
                "message": format!("All cached playlists cleared ({} directories removed)", count)
            })),
        )
            .into_response()
    }
}

pub async fn admin_cache_clear_slug(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(slug): axum::extract::Path<String>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp;
    }

    if !crate::playlist_cache::is_safe_filename(&slug) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "success": false,
                "error": "Invalid slug format"
            })),
        )
            .into_response();
    }

    let base_dir = state.playlist_cache.base_dir();
    let slug_dir = base_dir.join(&slug);
    let exists = slug_dir.exists();
    if exists {
        if let Err(e) = std::fs::remove_dir_all(&slug_dir) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to delete playlist cache for '{}': {}", slug, e)
                })),
            )
                .into_response();
        }
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "cleared_slug": slug,
            "message": format!("Đã xóa cache M3U8 cho phim: {}", slug)
        })),
    )
        .into_response()
}

fn dir_size(path: &Path) -> u64 {
    let mut size = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Ok(meta) = p.metadata() {
                    size += meta.len();
                }
            } else if p.is_dir() {
                size += dir_size(&p);
            }
        }
    }
    size
}

fn count_cached_playlists(base_dir: &Path) -> usize {
    if let Ok(entries) = std::fs::read_dir(base_dir) {
        entries.flatten().filter(|e| e.path().is_dir()).count()
    } else {
        0
    }
}

fn find_db_size() -> u64 {
    let candidates = [
        PathBuf::from("movies.db"),
        PathBuf::from("data/movies.db"),
        PathBuf::from("../movies.db"),
        PathBuf::from("/app/movies.db"),
    ];

    for path in &candidates {
        if path.exists() {
            if let Ok(meta) = path.metadata() {
                return meta.len();
            }
        }
    }
    0
}

fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn test_admin_auth_service() {
        let admin = AdminService::with_password("my-secret-pw");
        assert!(admin.verify_password("my-secret-pw"));
        assert!(!admin.verify_password("wrong-pw"));

        // Old aliases must all be rejected
        assert!(!admin.verify_password("admin"));
        assert!(!admin.verify_password("film4k2026"));
        assert!(!admin.verify_password("film4k@admin2026"));

        let token = admin.create_session();
        assert!(token.starts_with("adm_"));

        // Test Bearer header auth
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
        );
        assert!(admin.is_authenticated(&headers));

        // Test logout/invalidation
        assert!(admin.invalidate_session(&token));
        assert!(!admin.is_authenticated(&headers));

        // Test wrong token
        let mut bad_headers = HeaderMap::new();
        bad_headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer bad_token_123"),
        );
        assert!(!admin.is_authenticated(&bad_headers));

        // Test X-Admin-Key header auth
        let mut key_headers = HeaderMap::new();
        key_headers.insert("X-Admin-Key", HeaderValue::from_static("my-secret-pw"));
        assert!(admin.is_authenticated(&key_headers));

        let mut bad_key_headers = HeaderMap::new();
        bad_key_headers.insert("X-Admin-Key", HeaderValue::from_static("wrong-key"));
        assert!(!admin.is_authenticated(&bad_key_headers));
    }

    #[test]
    fn test_admin_from_env() {
        std::env::remove_var("ADMIN_PASSWORD");
        assert!(AdminService::from_env().is_err());

        std::env::set_var("ADMIN_PASSWORD", "   ");
        assert!(AdminService::from_env().is_err());

        // Weak passwords must fail
        std::env::set_var("ADMIN_PASSWORD", "admin123");
        assert!(AdminService::from_env().is_err());
        std::env::set_var("ADMIN_PASSWORD", "short");
        assert!(AdminService::from_env().is_err());

        std::env::set_var("ADMIN_PASSWORD", "super_secret_env_password");
        let admin = AdminService::from_env().unwrap();
        assert!(admin.verify_password("super_secret_env_password"));
        std::env::remove_var("ADMIN_PASSWORD");
    }

    #[test]
    fn test_admin_rate_limiting_and_strength() {
        assert!(AdminService::is_strong_password("a_strong_password_123"));
        assert!(!AdminService::is_strong_password("12345678"));
        assert!(!AdminService::is_strong_password("password"));
        assert!(!AdminService::is_strong_password("short"));

        let admin = AdminService::with_password("my-secret-pw");
        let client_ip = "192.168.1.100";
        assert!(!admin.is_login_rate_limited(client_ip));

        for i in 1..=4 {
            assert_eq!(admin.record_failed_attempt(client_ip), i);
            assert!(!admin.is_login_rate_limited(client_ip));
        }

        // 5th attempt triggers lockout
        assert_eq!(admin.record_failed_attempt(client_ip), 5);
        assert!(admin.is_login_rate_limited(client_ip));

        // Reset clears lockout
        admin.reset_failed_attempts(client_ip);
        assert!(!admin.is_login_rate_limited(client_ip));
    }

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(1024), "1.00 KB");
        assert_eq!(format_bytes(1024 * 1024), "1.00 MB");
        assert_eq!(format_bytes(1024 * 1024 * 1024 * 2), "2.00 GB");
    }
}
