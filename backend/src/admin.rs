use axum::{
    body::Body,
    extract::{ConnectInfo, Path as AxumPath, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;
use tracing::{error, info, warn};

use crate::crawler::CrawlerStatus;
use crate::models::{AdminMovieItem, AdminMoviesResponse, Movie, MoviesQuery};
use crate::playlist_cache::cached_slugs_set;
use crate::AppState;

/// Bounded session lifetime: 4 hours
const SESSION_TTL: Duration = Duration::from_secs(4 * 3600);
const SESSION_COOKIE_NAME: &str = "bofilm_admin_session";
const MAX_ACTIVE_SESSIONS: usize = 64;

/// Maximum failed login attempts before lockout for single IP
pub const MAX_FAILED_ATTEMPTS: u32 = 5;

/// Lockout duration after exceeding MAX_FAILED_ATTEMPTS: 15 minutes
pub const LOCKOUT_DURATION: Duration = Duration::from_secs(15 * 60);
pub const MAX_FAILED_ATTEMPT_CLIENTS: usize = 4096;

/// Trust only explicitly configured reverse proxy peers.
pub fn is_trusted_peer(ip: &IpAddr) -> bool {
    let trusted_list = std::env::var("TRUSTED_PROXIES").unwrap_or_default();
    for entry in trusted_list.split(',') {
        let trimmed = entry.trim();
        if let Ok(trusted_ip) = trimmed.parse::<IpAddr>() {
            if &trusted_ip == ip {
                return true;
            }
        }
    }
    false
}

/// Constant-time string comparison using SHA-256 and subtle::ConstantTimeEq
pub fn constant_time_eq_str(a: &str, b: &str) -> bool {
    let hash_a = Sha256::digest(a.as_bytes());
    let hash_b = Sha256::digest(b.as_bytes());
    hash_a.as_slice().ct_eq(hash_b.as_slice()).into()
}

fn sha256_token_key(token: &str) -> [u8; 32] {
    let digest = Sha256::digest(token.as_bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

/// Extract client IP address from socket peer or validated proxy headers.
pub fn extract_client_ip(headers: &HeaderMap, peer_addr: Option<SocketAddr>) -> String {
    if let Some(peer) = peer_addr {
        let peer_ip = peer.ip();
        if is_trusted_peer(&peer_ip) {
            if let Some(val) = headers.get("x-real-ip") {
                if let Ok(s) = val.to_str() {
                    let trimmed = s.trim();
                    if let Ok(parsed) = trimmed.parse::<IpAddr>() {
                        return parsed.to_string();
                    }
                }
            }
        }
        return peer_ip.to_string();
    }

    "unknown".to_string()
}

/// Generate a 256-bit random session token from OS CSPRNG, failing closed if unavailable.
fn generate_secure_token() -> Result<String, &'static str> {
    let mut bytes = [0u8; 32];
    #[cfg(unix)]
    {
        use std::io::Read;
        let mut f = std::fs::File::open("/dev/urandom")
            .map_err(|_| "OS CSPRNG (/dev/urandom) is unavailable")?;
        f.read_exact(&mut bytes)
            .map_err(|_| "Failed to read 32 bytes from OS CSPRNG")?;
    }
    #[cfg(not(unix))]
    {
        return Err("OS CSPRNG is unsupported on this platform");
    }

    let mut hex = String::with_capacity(68);
    hex.push_str("adm_");
    for b in &bytes {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    Ok(hex)
}

fn extract_cookie_token(headers: &HeaderMap) -> Option<String> {
    for val in headers.get_all(header::COOKIE) {
        let Ok(cookie_str) = val.to_str() else {
            continue;
        };
        for part in cookie_str.split(';') {
            let trimmed = part.trim();
            if let Some(raw_val) = trimmed.strip_prefix(&format!("{}=", SESSION_COOKIE_NAME)) {
                let tok = raw_val.trim();
                if !tok.is_empty() {
                    return Some(tok.to_string());
                }
            }
        }
    }
    None
}

fn should_use_secure_cookie(headers: &HeaderMap) -> bool {
    if std::env::var("COOKIE_SECURE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        return true;
    }
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|p| p.trim().eq_ignore_ascii_case("https"))
}

fn build_session_cookie_header(token: &str, max_age_secs: u64, secure: bool) -> String {
    let secure_attr = if secure { "; Secure" } else { "" };
    format!(
        "{}={}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age={}{}",
        SESSION_COOKIE_NAME, token, max_age_secs, secure_attr
    )
}

#[derive(Clone)]
pub struct AdminService {
    admin_password: Option<String>,
    sessions: Arc<RwLock<HashMap<[u8; 32], Instant>>>,
    failed_attempts: Arc<RwLock<HashMap<String, (u32, Instant)>>>,
}

impl Default for AdminService {
    fn default() -> Self {
        Self::new()
    }
}

impl AdminService {
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
                warn!(
                    "AdminService: {}. Failing securely: admin authentication is disabled.",
                    e
                );
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
            warn!("Weak password provided to AdminService::with_password; failing securely.");
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
        let attempts = self
            .failed_attempts
            .read()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(&(count, last_attempt)) = attempts.get(client_id) {
            if count >= MAX_FAILED_ATTEMPTS && last_attempt.elapsed() < LOCKOUT_DURATION {
                return true;
            }
        }
        false
    }

    pub fn record_failed_attempt(&self, client_id: &str) -> u32 {
        let now = Instant::now();
        let mut attempts = self
            .failed_attempts
            .write()
            .unwrap_or_else(|e| e.into_inner());
        attempts.retain(|_, (_, time)| time.elapsed() < LOCKOUT_DURATION);
        if !attempts.contains_key(client_id) && attempts.len() >= MAX_FAILED_ATTEMPT_CLIENTS {
            if let Some(oldest) = attempts
                .iter()
                .min_by_key(|(_, (_, time))| *time)
                .map(|(id, _)| id.clone())
            {
                attempts.remove(&oldest);
            }
        }
        let entry = attempts.entry(client_id.to_string()).or_insert((0, now));
        if entry.1.elapsed() >= LOCKOUT_DURATION {
            entry.0 = 0;
        }
        entry.0 += 1;
        entry.1 = now;
        entry.0
    }

    pub fn reset_failed_attempts(&self, client_id: &str) {
        let mut attempts = self
            .failed_attempts
            .write()
            .unwrap_or_else(|e| e.into_inner());
        attempts.remove(client_id);
    }

    pub fn try_create_session(&self) -> Result<String, &'static str> {
        let token = generate_secure_token()?;
        let token_key = sha256_token_key(&token);
        let now = Instant::now();
        let expires_at = now + SESSION_TTL;

        let mut sessions = self.sessions.write().unwrap_or_else(|e| e.into_inner());
        sessions.retain(|_, &mut exp| exp > now);
        if sessions.len() >= MAX_ACTIVE_SESSIONS {
            if let Some(oldest_key) = sessions
                .iter()
                .min_by_key(|(_, &exp)| exp)
                .map(|(k, _)| *k)
            {
                sessions.remove(&oldest_key);
            }
        }
        sessions.insert(token_key, expires_at);
        Ok(token)
    }

    pub fn create_session(&self) -> String {
        self.try_create_session()
            .expect("OS CSPRNG must be available for admin session creation")
    }

    pub fn invalidate_session(&self, token: &str) -> bool {
        let token = token.trim();
        if token.is_empty() {
            return false;
        }
        let token_key = sha256_token_key(token);
        let mut sessions = self.sessions.write().unwrap_or_else(|e| e.into_inner());
        sessions.remove(&token_key).is_some()
    }

    fn verify_session_token(&self, token: &str) -> bool {
        let token = token.trim();
        if token.is_empty() {
            return false;
        }
        let token_key = sha256_token_key(token);
        let now = Instant::now();
        let sessions = self.sessions.read().unwrap_or_else(|e| e.into_inner());
        sessions
            .get(&token_key)
            .is_some_and(|&expires_at| expires_at > now)
    }

    pub fn is_authenticated(&self, headers: &HeaderMap) -> bool {
        if let Some(auth_header) = headers.get(header::AUTHORIZATION) {
            if let Ok(auth_str) = auth_header.to_str() {
                if let Some(token) = auth_str.strip_prefix("Bearer ") {
                    if self.verify_session_token(token) {
                        return true;
                    }
                }
            }
        }

        if let Some(cookie_token) = extract_cookie_token(headers) {
            if self.verify_session_token(&cookie_token) {
                return true;
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
    peer_info: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Response {
    let client_ip = extract_client_ip(&headers, peer_info.map(|ci| ci.0));
    if state.admin.is_login_rate_limited(&client_ip) {
        warn!(
            "Admin login throttled: too many failed attempts for client {}",
            client_ip
        );
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, "900")],
            Json(LoginResponse {
                success: false,
                token: None,
                message: "Quá nhiều lần thử đăng nhập thất bại. Vui lòng thử lại sau 15 phút."
                    .to_string(),
            }),
        )
            .into_response();
    }

    if state.admin.verify_password(&payload.password) {
        state.admin.reset_failed_attempts(&client_ip);
        let token = match state.admin.try_create_session() {
            Ok(t) => t,
            Err(e) => {
                error!("Failed to generate admin session token: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(LoginResponse {
                        success: false,
                        token: None,
                        message: "Internal authentication service error".to_string(),
                    }),
                )
                    .into_response();
            }
        };
        info!("Admin login successful. Session created.");
        let cookie_val = build_session_cookie_header(
            &token,
            SESSION_TTL.as_secs(),
            should_use_secure_cookie(&headers),
        );
        let mut resp = (
            StatusCode::OK,
            Json(LoginResponse {
                success: true,
                token: Some(token),
                message: "Login successful".to_string(),
            }),
        )
            .into_response();
        if let Ok(hv) = HeaderValue::from_str(&cookie_val) {
            resp.headers_mut().insert(header::SET_COOKIE, hv);
        }
        resp
    } else {
        let attempts = state.admin.record_failed_attempt(&client_ip);
        warn!(
            "Admin login failed: invalid password attempt ({}/{} attempts) from client {}",
            attempts, MAX_FAILED_ATTEMPTS, client_ip
        );
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

pub async fn admin_logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(auth_header) = headers.get(header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                state.admin.invalidate_session(token);
            }
        }
    }
    if let Some(cookie_token) = extract_cookie_token(&headers) {
        state.admin.invalidate_session(&cookie_token);
    }

    let clear_cookie = build_session_cookie_header("", 0, should_use_secure_cookie(&headers));
    let mut resp = (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "message": "Logged out successfully"
        })),
    )
        .into_response();
    if let Ok(hv) = HeaderValue::from_str(&clear_cookie) {
        resp.headers_mut().insert(header::SET_COOKIE, hv);
    }
    resp
}

fn unauthorized_response() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "success": false,
            "error": "Unauthorized: invalid or missing admin session token"
        })),
    )
        .into_response()
}

fn require_auth(state: &AppState, headers: &HeaderMap) -> Result<(), Box<Response>> {
    if state.admin.is_authenticated(headers) {
        Ok(())
    } else {
        Err(Box::new(unauthorized_response()))
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
    pub catalog_rows: i64,
    pub detail_rows: i64,
    pub total_source_movies: Option<i64>,
    pub remaining_movies: Option<i64>,
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

pub async fn admin_stats(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
    }

    let db = state.db.clone();
    let base_dir = state.playlist_cache.base_dir();
    let crawler = state.crawler.clone();
    let configured_db_path = state.db.db_path().map(Path::to_path_buf);

    let stats_res = tokio::task::spawn_blocking(move || {
        let (total_items, total_movies, total_series) = db.get_stats().unwrap_or((0, 0, 0));
        let detail_rows = db.get_detail_movie_count().unwrap_or(0);
        let playlists_bytes = dir_size(&base_dir);
        let cached_playlists_count = count_cached_playlists(&base_dir);
        let database_bytes = find_db_size(configured_db_path.as_deref());
        let total_bytes = playlists_bytes + database_bytes;
        let crawler_status = crawler.get_status();

        AdminStatsResponse {
            success: true,
            total_movies: total_items,
            total_series,
            total_single: total_movies,
            total_items,
            catalog_rows: total_items,
            detail_rows,
            total_source_movies: None,
            remaining_movies: None,
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
        }
    })
    .await;

    match stats_res {
        Ok(stats) => (StatusCode::OK, Json(stats)).into_response(),
        Err(e) => {
            error!("Failed computing admin stats: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"success": false, "error": "Failed to compute admin stats"})),
            )
                .into_response()
        }
    }
}

pub async fn admin_movies(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MoviesQuery>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
    }
    let limit = query.limit.unwrap_or(24).clamp(1, 100);
    let offset = query.offset.unwrap_or_else(|| {
        query
            .page
            .map(|page| page.max(1).saturating_sub(1).saturating_mul(limit))
            .unwrap_or(0)
    });

    let db = state.db.clone();
    let base_dir = state.playlist_cache.base_dir();
    let query_clone = query.clone();
    let res = state
        .db
        .run_read_blocking(move || {
            let (summaries, total) = db.get_movies_filtered(&query_clone)?;
            let cached_slugs = cached_slugs_set(&base_dir);
            let items: Vec<AdminMovieItem> = summaries
                .into_iter()
                .map(|summary| {
                    let has_cached_m3u8 = cached_slugs.contains(&summary.slug);
                    AdminMovieItem {
                        summary,
                        has_cached_m3u8,
                    }
                })
                .collect();
            Ok((items, total))
        })
        .await;

    match res {
        Ok((movies, total)) => (
            StatusCode::OK,
            Json(AdminMoviesResponse {
                movies,
                total,
                limit: limit as i64,
                offset: offset as i64,
            }),
        )
            .into_response(),
        Err(err) => {
            error!("Database error in admin_movies: {}", err);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"success": false, "error": "Failed to query movies"})),
            )
                .into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum AdminGenresField {
    List(Vec<String>),
    Csv(String),
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct AdminMovieCrudRequest {
    pub slug: Option<String>,
    pub title_vi: Option<String>,
    pub title_en: Option<String>,
    #[serde(alias = "type")]
    pub movie_type: Option<String>,
    pub year: Option<i32>,
    pub quality: Option<String>,
    pub score: Option<f64>,
    pub country: Option<String>,
    pub genres: Option<AdminGenresField>,
    pub poster: Option<String>,
    pub backdrop: Option<String>,
    pub overview: Option<String>,
    #[serde(alias = "totalEpisodes")]
    pub total_episodes: Option<i32>,
    pub stream: Option<serde_json::Value>,
}

pub fn is_valid_movie_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 200
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn clean_opt_str(opt: Option<String>) -> Option<String> {
    opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn validate_optional_asset_url(field_name: &str, value: &Option<String>) -> Result<(), String> {
    if let Some(ref url_str) = value {
        let lower = url_str.to_ascii_lowercase();
        if !(lower.starts_with("https://")
            || lower.starts_with("http://")
            || url_str.starts_with('/'))
        {
            return Err(format!(
                "Invalid {} URL: must start with https://, http://, or /",
                field_name
            ));
        }
    }
    Ok(())
}

fn build_movie_from_crud_request(
    req: AdminMovieCrudRequest,
    fallback_slug: Option<&str>,
) -> Result<Movie, String> {
    let raw_slug = req
        .slug
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(fallback_slug)
        .unwrap_or("")
        .to_string();

    if !is_valid_movie_slug(&raw_slug) {
        return Err("Invalid slug: must match ^[a-z0-9-]+$".to_string());
    }

    let movie_type = match req
        .movie_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("movie")
    {
        "movie" | "single" | "phim-le" => "movie".to_string(),
        "tv" | "series" | "phim-bo" => "tv".to_string(),
        _ => return Err("Invalid movie_type: must be 'movie' or 'tv'".to_string()),
    };

    if let Some(y) = req.year {
        if !(1888..=2100).contains(&y) {
            return Err("Invalid year: must be between 1888 and 2100".to_string());
        }
    }
    if let Some(sc) = req.score {
        if !sc.is_finite() || !(0.0..=10.0).contains(&sc) {
            return Err("Invalid score: must be between 0.0 and 10.0".to_string());
        }
    }
    if let Some(te) = req.total_episodes {
        if te < 0 {
            return Err("Invalid total_episodes: must be non-negative".to_string());
        }
    }

    let genres = match req.genres {
        Some(AdminGenresField::List(list)) => list
            .into_iter()
            .map(|g| g.trim().to_string())
            .filter(|g| !g.is_empty())
            .collect(),
        Some(AdminGenresField::Csv(csv)) => csv
            .split(',')
            .map(|g| g.trim().to_string())
            .filter(|g| !g.is_empty())
            .collect(),
        None => Vec::new(),
    };

    let poster = clean_opt_str(req.poster);
    let backdrop = clean_opt_str(req.backdrop);
    validate_optional_asset_url("poster", &poster)?;
    validate_optional_asset_url("backdrop", &backdrop)?;

    let stream_str = match req.stream {
        Some(serde_json::Value::String(s)) => clean_opt_str(Some(s)),
        Some(serde_json::Value::Object(obj)) => obj
            .get("hlsUrl")
            .or_else(|| obj.get("proxyStreamUrl"))
            .and_then(|v| v.as_str())
            .and_then(|s| clean_opt_str(Some(s.to_string()))),
        _ => None,
    };
    validate_optional_asset_url("stream", &stream_str)?;

    let title_vi = clean_opt_str(req.title_vi);
    let title_en = clean_opt_str(req.title_en);
    if title_vi.is_none() && title_en.is_none() {
        return Err("At least one of title_vi or title_en is required".to_string());
    }

    Ok(Movie {
        id: None,
        slug: raw_slug,
        movie_type,
        title_vi,
        title_en,
        year: req.year,
        quality: clean_opt_str(req.quality),
        score: req.score,
        genres,
        country: clean_opt_str(req.country),
        poster,
        backdrop,
        overview: clean_opt_str(req.overview),
        total_episodes: req.total_episodes,
        stream: stream_str.map(serde_json::Value::String),
        episodes: Vec::new(),
        servers: Vec::new(),
        subtitles: Vec::new(),
        audio_tracks: Vec::new(),
    })
}

pub async fn admin_create_movie(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminMovieCrudRequest>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
    }

    let movie = match build_movie_from_crud_request(payload, None) {
        Ok(m) => m,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "success": false, "error": msg })),
            )
                .into_response();
        }
    };

    let db = state.db.clone();
    match state
        .db
        .run_blocking(move || db.admin_save_movie(None, &movie))
        .await
    {
        Ok(saved_slug) => {
            state.crawler.clear_home_cache();
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": true,
                    "slug": saved_slug
                })),
            )
                .into_response()
        }
        Err(err) => {
            error!("Error creating movie via Admin CRUD: {}", err);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "success": false,
                    "error": "Failed to save movie"
                })),
            )
                .into_response()
        }
    }
}

pub async fn admin_update_movie(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(path_slug): AxumPath<String>,
    Json(payload): Json<AdminMovieCrudRequest>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
    }

    if !is_valid_movie_slug(&path_slug) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "success": false,
                "error": "Invalid slug format"
            })),
        )
            .into_response();
    }

    let movie = match build_movie_from_crud_request(payload, Some(&path_slug)) {
        Ok(m) => m,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "success": false, "error": msg })),
            )
                .into_response();
        }
    };

    let db = state.db.clone();
    let existing_slug = path_slug.clone();
    match state
        .db
        .run_blocking(move || db.admin_save_movie(Some(&existing_slug), &movie))
        .await
    {
        Ok(saved_slug) => {
            state.crawler.clear_home_cache();
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": true,
                    "slug": saved_slug
                })),
            )
                .into_response()
        }
        Err(err) => {
            let msg = err.to_string();
            if msg.contains("already exists") {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({
                        "success": false,
                        "error": "Target slug already exists"
                    })),
                )
                    .into_response();
            }
            error!("Error updating movie '{}' via Admin CRUD: {}", path_slug, err);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "success": false,
                    "error": "Failed to update movie"
                })),
            )
                .into_response()
        }
    }
}

pub async fn admin_delete_movie(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(slug): AxumPath<String>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
    }

    if !is_valid_movie_slug(&slug) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "success": false,
                "error": "Invalid slug format"
            })),
        )
            .into_response();
    }

    let db = state.db.clone();
    let slug_owned = slug.clone();
    match state
        .db
        .run_blocking(move || db.delete_movie_by_slug(&slug_owned))
        .await
    {
        Ok(true) => {
            let _ = state.playlist_cache.clear_slug_all(&slug).await;
            state.crawler.clear_home_cache();
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": true,
                    "deleted": slug
                })),
            )
                .into_response()
        }
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "success": false,
                "error": "Movie not found"
            })),
        )
            .into_response(),
        Err(err) => {
            error!("Error deleting movie '{}' via Admin CRUD: {}", slug, err);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "success": false,
                    "error": "Failed to delete movie"
                })),
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct AdminLogInput {
    level: String,
    message: String,
}

#[derive(Deserialize)]
pub struct AdminLogsQuery {
    after_id: Option<i64>,
    before_id: Option<i64>,
    limit: Option<i64>,
}

pub async fn admin_log_write(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<AdminLogInput>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
    }
    let level = input.level;
    if !matches!(level.as_str(), "info" | "warn" | "error" | "success")
        || input.message.trim().is_empty()
        || input.message.chars().count() > 2000
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid log entry"})),
        )
            .into_response();
    }
    let db = state.db.clone();
    let message = input.message.trim().to_string();
    match state
        .db
        .run_blocking(move || db.insert_admin_log(&level, &message))
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to persist log entry"})),
        )
            .into_response(),
    }
}

pub async fn admin_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AdminLogsQuery>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
    }
    let db = state.db.clone();
    match state
        .db
        .run_read_blocking(move || {
            db.get_admin_logs(query.after_id, query.before_id, query.limit.unwrap_or(100))
        })
        .await
    {
        Ok((rows, has_more)) => {
            let logs: Vec<_> = rows
                .into_iter()
                .map(|(id, timestamp, level, message)| {
                    serde_json::json!({"id": id, "timestamp": timestamp, "level": level, "message": message})
                })
                .collect();
            (
                StatusCode::OK,
                Json(serde_json::json!({"logs": logs, "has_more": has_more})),
            )
                .into_response()
        }
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to read admin logs"})),
        )
            .into_response(),
    }
}

pub async fn admin_logs_export(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
    }
    let db = state.db.clone();
    match state
        .db
        .run_read_blocking(move || db.get_all_admin_logs())
        .await
    {
        Ok(rows) => {
            let text = rows
                .into_iter()
                .map(|(id, timestamp, level, message)| {
                    serde_json::json!({"id": id, "timestamp": timestamp, "level": level, "message": message})
                        .to_string()
                })
                .collect::<Vec<_>>()
                .join("\n");
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/x-ndjson; charset=utf-8")
                .header(
                    "content-disposition",
                    "attachment; filename=admin-task-logs.jsonl",
                )
                .body(Body::from(text))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to export admin logs"})),
        )
            .into_response(),
    }
}

pub async fn admin_crawler_start(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
    }

    let triggered = state.crawler.trigger_mode("full");

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": triggered,
            "mode": "full",
            "message": if triggered {
                "Đã kích hoạt quét toàn bộ danh sách phim"
            } else {
                "Crawler đang chạy"
            }
        })),
    )
        .into_response()
}

pub async fn admin_crawler_update(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
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

pub async fn admin_crawler_warmup(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
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
        return *resp;
    }

    let mode = match payload.and_then(|p| p.mode.clone()) {
        Some(m) if !m.trim().is_empty() => m.trim().to_string(),
        _ => "latest".to_string(),
    };

    let valid_modes = ["full", "latest", "prewarm", "force"];
    if !valid_modes.contains(&mode.as_str()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "success": false,
                "error": "Unsupported crawler mode"
            })),
        )
            .into_response();
    }

    let triggered = state.crawler.trigger_mode(&mode);

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": triggered,
            "mode": mode,
            "message": if triggered {
                format!("Crawler started in '{}' mode", mode)
            } else {
                "Crawler is already currently running".to_string()
            }
        })),
    )
        .into_response()
}

pub async fn admin_crawler_stop(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
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
        return *resp;
    }

    let target_slug = payload
        .and_then(|p| p.slug.clone())
        .filter(|s| !s.trim().is_empty());

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

        match state.playlist_cache.clear_slug_all(&slug).await {
            Ok(removed) => (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": true,
                    "cleared_slug": slug,
                    "directories_removed": removed,
                    "message": if removed > 0 {
                        "Cache directory for slug deleted successfully"
                    } else {
                        "Cache directory for slug did not exist"
                    }
                })),
            )
                .into_response(),
            Err(e) => {
                error!("Failed to delete playlist cache for '{}': {}", slug, e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": "Failed to clear playlist cache"
                    })),
                )
                    .into_response()
            }
        }
    } else {
        let base_dir = state.playlist_cache.base_dir();
        let clear_res = tokio::task::spawn_blocking(move || -> std::io::Result<usize> {
            let mut count = 0;
            if base_dir.exists() {
                for entry in std::fs::read_dir(&base_dir)?.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        std::fs::remove_dir_all(&path)?;
                        count += 1;
                    } else if path.is_file() {
                        std::fs::remove_file(&path)?;
                    }
                }
            }
            Ok(count)
        })
        .await;

        match clear_res {
            Ok(Ok(count)) => (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": true,
                    "cleared_slug": null,
                    "directories_removed": count,
                    "message": format!("All cached playlists cleared ({} directories removed)", count)
                })),
            )
                .into_response(),
            Ok(Err(e)) => {
                error!("Failed clearing playlist cache directory: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": "Failed to clear playlist cache"
                    })),
                )
                    .into_response()
            }
            Err(e) => {
                error!("Blocking task error clearing playlist cache: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": "Failed to clear playlist cache"
                    })),
                )
                    .into_response()
            }
        }
    }
}

pub async fn admin_cache_clear_slug(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(slug): AxumPath<String>,
) -> Response {
    if let Err(resp) = require_auth(&state, &headers) {
        return *resp;
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

    match state.playlist_cache.clear_slug_all(&slug).await {
        Ok(removed) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "cleared_slug": slug,
                "directories_removed": removed,
                "message": format!("Đã xóa cache M3U8 cho phim: {}", slug)
            })),
        )
            .into_response(),
        Err(e) => {
            error!("Failed to delete playlist cache for '{}': {}", slug, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "success": false,
                    "error": "Failed to clear playlist cache"
                })),
            )
                .into_response()
        }
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

fn sqlite_file_and_wal_size(path: &Path) -> Option<u64> {
    if !path.is_file() {
        return None;
    }
    let main_bytes = path.metadata().ok()?.len();
    let wal_path = PathBuf::from(format!("{}-wal", path.display()));
    let wal_bytes = wal_path.metadata().map(|m| m.len()).unwrap_or(0);
    Some(main_bytes.saturating_add(wal_bytes))
}

pub fn find_db_size(configured_path: Option<&Path>) -> u64 {
    if let Ok(env_db) = std::env::var("DATABASE_PATH") {
        let trimmed = env_db.trim();
        if !trimmed.is_empty() {
            if let Some(bytes) = sqlite_file_and_wal_size(Path::new(trimmed)) {
                return bytes;
            }
        }
    }

    if let Some(p) = configured_path {
        if let Some(bytes) = sqlite_file_and_wal_size(p) {
            return bytes;
        }
    }

    let candidates = [
        PathBuf::from("movies.db"),
        PathBuf::from("data/movies.db"),
        PathBuf::from("/app/data/movies.db"),
        PathBuf::from("../movies.db"),
        PathBuf::from("/app/movies.db"),
    ];

    for path in &candidates {
        if let Some(bytes) = sqlite_file_and_wal_size(path) {
            return bytes;
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

    #[test]
    fn test_admin_auth_service_bearer_and_cookie() {
        let admin = AdminService::with_password("my-secret-pw");
        assert!(admin.verify_password("my-secret-pw"));
        assert!(!admin.verify_password("wrong-pw"));

        assert!(!admin.verify_password("admin"));
        assert!(!admin.verify_password("film4k2026"));
        assert!(!admin.verify_password("film4k@admin2026"));

        let token = admin.create_session();
        assert!(token.starts_with("adm_"));
        assert_eq!(token.len(), 68);

        // 1. Bearer header auth
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
        );
        assert!(admin.is_authenticated(&headers));

        // 2. HttpOnly Cookie auth
        let mut cookie_headers = HeaderMap::new();
        cookie_headers.insert(
            header::COOKIE,
            HeaderValue::from_str(&format!("other=1; {}={}", SESSION_COOKIE_NAME, token)).unwrap(),
        );
        assert!(admin.is_authenticated(&cookie_headers));

        // 3. Logout/invalidation clears both
        assert!(admin.invalidate_session(&token));
        assert!(!admin.is_authenticated(&headers));
        assert!(!admin.is_authenticated(&cookie_headers));

        // 4. Wrong token rejected
        let mut bad_headers = HeaderMap::new();
        bad_headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer bad_token_123"),
        );
        assert!(!admin.is_authenticated(&bad_headers));

        // 5. Legacy static X-Admin-Key rejected
        let mut key_headers = HeaderMap::new();
        key_headers.insert("X-Admin-Key", HeaderValue::from_static("my-secret-pw"));
        assert!(!admin.is_authenticated(&key_headers));
    }

    #[test]
    fn test_admin_from_env() {
        std::env::remove_var("ADMIN_PASSWORD");
        assert!(AdminService::from_env().is_err());

        std::env::set_var("ADMIN_PASSWORD", "   ");
        assert!(AdminService::from_env().is_err());

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

        assert_eq!(admin.record_failed_attempt(client_ip), 5);
        assert!(admin.is_login_rate_limited(client_ip));

        admin.reset_failed_attempts(client_ip);
        assert!(!admin.is_login_rate_limited(client_ip));
    }

    #[test]
    fn failed_attempt_tracking_is_bounded_and_evicts_oldest_client() {
        let admin = AdminService::with_password("my-secret-pw");
        for index in 0..MAX_FAILED_ATTEMPT_CLIENTS {
            admin.record_failed_attempt(&format!("client-{index}"));
        }
        assert_eq!(
            admin.failed_attempts.read().unwrap().len(),
            MAX_FAILED_ATTEMPT_CLIENTS
        );
        admin.record_failed_attempt("new-client");
        let attempts = admin.failed_attempts.read().unwrap();
        assert_eq!(attempts.len(), MAX_FAILED_ATTEMPT_CLIENTS);
        assert!(!attempts.contains_key("client-0"));
        assert!(attempts.contains_key("new-client"));
    }

    #[test]
    fn test_find_db_size_includes_wal() {
        let tmp = std::env::temp_dir().join(format!(
            "test_db_size_{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let wal = PathBuf::from(format!("{}-wal", tmp.display()));
        std::fs::write(&tmp, vec![0u8; 1024]).unwrap();
        std::fs::write(&wal, vec![0u8; 512]).unwrap();
        assert_eq!(find_db_size(Some(&tmp)), 1536);
        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_file(&wal);
    }

    #[test]
    fn test_format_bytes_and_slug_validation() {
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(1024), "1.00 KB");
        assert_eq!(format_bytes(1024 * 1024), "1.00 MB");
        assert_eq!(format_bytes(1024 * 1024 * 1024 * 2), "2.00 GB");

        assert!(is_valid_movie_slug("spider-man-brand-new-day-2026"));
        assert!(!is_valid_movie_slug(""));
        assert!(!is_valid_movie_slug("Bad_Slug"));
        assert!(!is_valid_movie_slug("../traversal"));
    }

    #[test]
    fn test_extract_client_ip_production_topology() {
        std::env::set_var("TRUSTED_PROXIES", "172.21.0.1");

        let gateway_peer: SocketAddr = "172.21.0.1:45678".parse().unwrap();
        let untrusted_peer: SocketAddr = "198.51.100.55:12345".parse().unwrap();

        let mut headers = HeaderMap::new();
        headers.insert("cf-connecting-ip", HeaderValue::from_static("8.8.8.8"));
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("1.1.1.1, 9.9.9.9"),
        );
        headers.insert("x-real-ip", HeaderValue::from_static("203.0.113.10"));

        let ip = extract_client_ip(&headers, Some(gateway_peer));
        assert_eq!(ip, "203.0.113.10");

        let mut spoof_only = HeaderMap::new();
        spoof_only.insert("cf-connecting-ip", HeaderValue::from_static("8.8.8.8"));
        spoof_only.insert("x-forwarded-for", HeaderValue::from_static("1.1.1.1"));
        let ip = extract_client_ip(&spoof_only, Some(gateway_peer));
        assert_eq!(ip, "172.21.0.1");

        let mut direct_headers = HeaderMap::new();
        direct_headers.insert("x-real-ip", HeaderValue::from_static("10.0.0.1"));
        direct_headers.insert("cf-connecting-ip", HeaderValue::from_static("10.0.0.2"));
        let ip = extract_client_ip(&direct_headers, Some(untrusted_peer));
        assert_eq!(ip, "198.51.100.55");
        let loopback_peer: SocketAddr = "127.0.0.1:12345".parse().unwrap();
        assert_eq!(
            extract_client_ip(&direct_headers, Some(loopback_peer)),
            "127.0.0.1"
        );

        let ip_none = extract_client_ip(&headers, None);
        assert_eq!(ip_none, "unknown");

        let mut client1_headers = HeaderMap::new();
        client1_headers.insert("x-real-ip", HeaderValue::from_static("198.51.100.1"));
        let client1_ip = extract_client_ip(&client1_headers, Some(gateway_peer));

        let mut client2_headers = HeaderMap::new();
        client2_headers.insert("x-real-ip", HeaderValue::from_static("198.51.100.2"));
        let client2_ip = extract_client_ip(&client2_headers, Some(gateway_peer));

        assert_eq!(client1_ip, "198.51.100.1");
        assert_eq!(client2_ip, "198.51.100.2");

        let admin = AdminService::with_password("my-secret-pw");
        for _ in 0..5 {
            admin.record_failed_attempt(&client1_ip);
        }
        assert!(admin.is_login_rate_limited(&client1_ip));
        assert!(!admin.is_login_rate_limited(&client2_ip));
        std::env::remove_var("TRUSTED_PROXIES");
    }
}
