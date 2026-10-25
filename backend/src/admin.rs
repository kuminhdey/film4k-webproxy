use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use tracing::{info, warn};

use crate::crawler::CrawlerStatus;
use crate::AppState;

static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(1000);

#[derive(Clone)]
pub struct AdminService {
    admin_password: String,
    sessions: Arc<RwLock<HashSet<String>>>,
}

impl Default for AdminService {
    fn default() -> Self {
        Self::new()
    }
}

impl AdminService {
    pub fn new() -> Self {
        let admin_password = std::env::var("ADMIN_PASSWORD")
            .unwrap_or_else(|_| "film4k@admin2026".to_string());
        Self {
            admin_password,
            sessions: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    pub fn with_password(password: impl Into<String>) -> Self {
        Self {
            admin_password: password.into(),
            sessions: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    pub fn verify_password(&self, password: &str) -> bool {
        self.admin_password == password
    }

    pub fn create_session(&self) -> String {
        let now_nano = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let seq = TOKEN_COUNTER.fetch_add(1, Ordering::SeqCst);
        let token = format!("adm_{:x}_{:x}", now_nano, seq);

        let mut sessions = self.sessions.write().unwrap();
        sessions.insert(token.clone());
        token
    }

    pub fn is_authenticated(&self, headers: &HeaderMap) -> bool {
        // 1. Check X-Admin-Key
        if let Some(key_header) = headers.get("X-Admin-Key") {
            if let Ok(key) = key_header.to_str() {
                if key == self.admin_password {
                    return true;
                }
            }
        }

        // 2. Check Authorization: Bearer <token>
        if let Some(auth_header) = headers.get(axum::http::header::AUTHORIZATION) {
            if let Ok(auth_str) = auth_header.to_str() {
                if let Some(token) = auth_str.strip_prefix("Bearer ") {
                    let sessions = self.sessions.read().unwrap();
                    if sessions.contains(token.trim()) {
                        return true;
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
    Json(payload): Json<LoginRequest>,
) -> Response {
    if state.admin.verify_password(&payload.password) {
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
        warn!("🚫 Admin login failed: invalid password attempt");
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
    pub total_items: i64,
    pub cached_playlists_count: usize,
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

    let stats = AdminStatsResponse {
        success: true,
        total_movies,
        total_series,
        total_items,
        cached_playlists_count,
        crawler_status: state.crawler.get_status(),
        disk_usage: DiskUsage {
            playlists_bytes,
            database_bytes,
            total_bytes,
            human_readable: format_bytes(total_bytes),
        },
    };

    (StatusCode::OK, Json(stats)).into_response()
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

        let token = admin.create_session();
        assert!(token.starts_with("adm_"));

        // Test Bearer header auth
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
        );
        assert!(admin.is_authenticated(&headers));

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
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(1024), "1.00 KB");
        assert_eq!(format_bytes(1024 * 1024), "1.00 MB");
        assert_eq!(format_bytes(1024 * 1024 * 1024 * 2), "2.00 GB");
    }
}
