pub mod admin;
pub mod crawler;
pub mod db;
pub mod models;
pub mod playlist_cache;
pub mod proxy;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use std::path::PathBuf;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::error;

pub use admin::AdminService;
pub use playlist_cache::{
    handle_stream_file, handle_stream_file_ep, handle_stream_master, handle_stream_master_ep,
    handle_stream_sub, handle_stream_sub_ep,
    PlaylistCache, PlaylistCacheService, StreamParams,
};
use crate::crawler::CrawlerService;
use crate::db::Database;
use crate::models::{MoviesQuery, MoviesResponse};
use crate::proxy::handle_stream_proxy;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub crawler: CrawlerService,
    pub playlist_cache: PlaylistCacheService,
    pub admin: AdminService,
    pub http_client: reqwest::Client,
}

impl AppState {
    pub fn new(db: Database, crawler: CrawlerService) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            db,
            crawler,
            playlist_cache: PlaylistCacheService::default(),
            admin: AdminService::new(),
            http_client,
        }
    }

    pub fn with_playlist_cache(mut self, playlist_cache: PlaylistCacheService) -> Self {
        self.playlist_cache = playlist_cache;
        self
    }

    pub fn with_admin(mut self, admin: AdminService) -> Self {
        self.admin = admin;
        self
    }

    pub fn with_http_client(mut self, client: reqwest::Client) -> Self {
        self.http_client = client;
        self
    }
}

pub fn create_app(state: AppState) -> Router {
    let api_routes = Router::new()
        .route("/health", get(health_check))
        .route("/health/live", get(health_live_handler))
        .route("/health/ready", get(health_ready_handler))
        .route("/home", get(get_home))
        .route("/movies", get(list_movies))
        .route("/movies/by-slugs", get(get_movies_by_slugs_handler))
        .route("/movies/:slug", get(get_movie))
        .route("/movies/:slug/recommendations", get(get_movie_recommendations))
        .route("/movies/:slug/related", get(get_movie_recommendations))
        .route("/search/suggest", get(search_suggest))
        .route("/proxy/stream", get(handle_stream_proxy))
        .route("/proxy/image", get(proxy::handle_image_proxy))
        .route("/stream/:slug/master.m3u8", get(handle_stream_master))
        .route("/stream/:slug/ep/:ep/master.m3u8", get(handle_stream_master_ep))
        .route("/stream/:slug/ep/:ep/sub/:file", get(handle_stream_sub_ep))
        .route("/stream/:slug/ep/:ep/:file", get(handle_stream_file_ep))
        .route("/stream/:slug/sub/:file", get(handle_stream_sub))
        .route("/stream/:slug/:file", get(handle_stream_file))
        .route("/crawler/status", get(get_crawler_status))
        .route("/admin/login", post(admin::admin_login))
        .route("/admin/logout", post(admin::admin_logout))
        .route("/admin/stats", get(admin::admin_stats))
        .route("/admin/crawler/start", post(admin::admin_crawler_start))
        .route("/admin/crawler/update", post(admin::admin_crawler_update))
        .route("/admin/crawler/warmup", post(admin::admin_crawler_warmup))
        .route("/admin/crawler/trigger", post(admin::admin_crawler_trigger))
        .route("/admin/crawler/stop", post(admin::admin_crawler_stop))
        .route("/admin/cache/clear", post(admin::admin_cache_clear))
        .route("/admin/cache/clear/:slug", post(admin::admin_cache_clear_slug));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut dist_dirs = vec![
        PathBuf::from("../frontend/dist"),
        PathBuf::from("frontend/dist"),
        PathBuf::from("dist"),
        PathBuf::from("/app/frontend/dist"),
        PathBuf::from("/Users/kuminhdey/Downloads/webproxy/frontend/dist"),
    ];
    if let Ok(static_env) = std::env::var("STATIC_DIR") {
        dist_dirs.insert(0, PathBuf::from(static_env));
    }

    let mut frontend_dist = PathBuf::from("../frontend/dist");
    for candidate in &dist_dirs {
        if candidate.exists() {
            frontend_dist = candidate.clone();
            break;
        }
    }

    let index_file = frontend_dist.join("index.html");
    let serve_dir = ServeDir::new(&frontend_dist)
        .not_found_service(ServeFile::new(index_file));

    Router::new()
        .nest("/api", api_routes)
        .route("/health", get(health_check))
        .route("/health/live", get(health_live_handler))
        .route("/health/ready", get(health_ready_handler))
        .route("/proxy/image", get(proxy::handle_image_proxy))
        .route("/stream/:slug/master.m3u8", get(handle_stream_master))
        .route("/stream/:slug/ep/:ep/master.m3u8", get(handle_stream_master_ep))
        .route("/stream/:slug/ep/:ep/sub/:file", get(handle_stream_sub_ep))
        .route("/stream/:slug/ep/:ep/:file", get(handle_stream_file_ep))
        .route("/stream/:slug/sub/:file", get(handle_stream_sub))
        .route("/stream/:slug/:file", get(handle_stream_file))
        .route("/", get(root_handler))
        .route("/movie/:slug", get(spa_page_handler))
        .route("/movie/:slug/*rest", get(spa_page_handler))
        .route("/watch/:slug", get(spa_page_handler))
        .route("/watch/:slug/:ep", get(spa_page_handler))
        .route("/phim/:slug", get(spa_page_handler))
        .route("/phim/:slug/*rest", get(spa_page_handler))
        .route("/xem-phim/:slug", get(spa_page_handler))
        .route("/xem-phim/:slug/:ep", get(spa_page_handler))
        .route("/danh-sach/:slug", get(spa_page_handler))
        .route("/the-loai/:slug", get(spa_page_handler))
        .route("/quoc-gia/:slug", get(spa_page_handler))
        .route("/nam-phat-hanh/:year", get(spa_page_handler))
        .route("/tim-kiem", get(spa_page_handler))
        .route("/yeu-thich", get(spa_page_handler))
        .route("/lich-su", get(spa_page_handler))
        .route("/explore", get(spa_page_handler))
        .route("/genres", get(spa_page_handler))
        .route("/television", get(spa_page_handler))
        .route("/sports", get(spa_page_handler))
        .route("/mylist", get(spa_page_handler))
        .route("/admin", get(spa_page_handler))
        .route("/admin/*rest", get(spa_page_handler))
        .fallback_service(serve_dir)
        .layer(cors)
        .with_state(state)
}

#[derive(Debug, serde::Deserialize, Default)]
#[serde(default)]
pub struct RootQuery {
    pub url: Option<String>,
    pub keep_cdn: Option<String>,
    pub slug: Option<String>,
}

pub async fn health_live_handler() -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        StatusCode::OK,
        axum::Json(serde_json::json!({
            "status": "alive"
        })),
    )
}

pub async fn health_ready_handler(
    State(state): State<AppState>,
) -> (StatusCode, axum::Json<serde_json::Value>) {
    let build_commit = option_env!("BUILD_COMMIT").unwrap_or("unknown");
    let assets_ready = build_commit == "unknown"
        || std::path::Path::new("frontend/dist/index.html").is_file();
    match state.db.check_health() {
        Ok((migration_count, is_healthy)) if is_healthy && assets_ready => (
            StatusCode::OK,
            axum::Json(serde_json::json!({
                "status": "ready",
                "ready": true,
                "migrations_applied": migration_count,
                "commit": build_commit
            })),
        ),
        Ok((migration_count, _)) => (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({
                "status": "unhealthy",
                "ready": false,
                "reason": "Database schema or static assets unavailable",
                "migrations_applied": migration_count
            })),
        ),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({
                "status": "unhealthy",
                "ready": false,
                "reason": "Database unavailable"
            })),
        ),
    }
}

pub async fn health_check(State(state): State<AppState>) -> Response {
    match state.db.check_health() {
        Ok((_, is_healthy))
            if is_healthy
                && (option_env!("BUILD_COMMIT").is_none()
                    || std::path::Path::new("frontend/dist/index.html").is_file()) =>
        {
            (StatusCode::OK, "OK").into_response()
        }
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Degraded: Database unhealthy",
        )
            .into_response(),
    }
}

pub async fn spa_page_handler() -> axum::response::Response {
    let dist_dirs = [
        PathBuf::from("/app/frontend/dist"),
        PathBuf::from("../frontend/dist"),
        PathBuf::from("frontend/dist"),
        PathBuf::from("dist"),
        PathBuf::from("/Users/kuminhdey/Downloads/webproxy/frontend/dist"),
    ];
    for dir in &dist_dirs {
        let index = dir.join("index.html");
        if let Ok(content) = tokio::fs::read_to_string(&index).await {
            return (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
                content,
            ).into_response();
        }
    }

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
        "<h1>🎬 Film4k Cinema</h1><p>Frontend SPA will serve here once built.</p>",
    ).into_response()
}

pub async fn root_handler(
    State(state): State<AppState>,
    Query(query): Query<RootQuery>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    if let Some(ref url) = query.url {
        if !url.trim().is_empty() {
            let proxy_query = proxy::ProxyQuery {
                url: url.clone(),
                keep_cdn: query.keep_cdn.clone(),
                slug: query.slug.clone(),
            };
            return handle_stream_proxy(State(state), Query(proxy_query), headers).await.into_response();
        }
    }

    spa_page_handler().await
}

pub async fn list_movies(
    State(state): State<AppState>,
    Query(query): Query<MoviesQuery>,
) -> Result<Json<MoviesResponse>, (StatusCode, String)> {
    let limit = query.limit.unwrap_or(24).clamp(1, 100);
    let offset = query.offset.unwrap_or_else(|| {
        if let Some(p) = query.page {
            (p.max(1) - 1) * limit
        } else {
            0
        }
    });

    match state.db.get_movies_filtered(&query) {
        Ok((movies, total)) => Ok(Json(MoviesResponse {
            movies,
            total,
            limit: limit as i64,
            offset: offset as i64,
        })),
        Err(err) => {
            error!("Database error in list_movies: {}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to query movies: {}", err),
            ))
        }
    }
}

pub async fn search_suggest(
    State(state): State<AppState>,
    Query(query): Query<models::SearchSuggestQuery>,
) -> Json<models::SearchSuggestResponse> {
    let q = query.q.unwrap_or_default();
    let results = state.db.search_suggest(&q, 6).unwrap_or_default();
    Json(models::SearchSuggestResponse { results })
}

pub async fn get_movies_by_slugs_handler(
    State(state): State<AppState>,
    Query(query): Query<models::BySlugsQuery>,
) -> Json<models::BySlugsResponse> {
    let slugs_str = query.slugs.unwrap_or_default();
    let slugs: Vec<String> = slugs_str
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if slugs.is_empty() {
        return Json(models::BySlugsResponse { movies: Vec::new() });
    }

    match state.db.get_movies_by_slugs(&slugs) {
        Ok(movies) => Json(models::BySlugsResponse { movies }),
        Err(err) => {
            error!("Database error in get_movies_by_slugs_handler: {}", err);
            Json(models::BySlugsResponse { movies: Vec::new() })
        }
    }
}

pub async fn get_movie_recommendations(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Json<models::RecommendationsResponse> {
    let recommendations = state.db.get_recommendations(&slug, 12).unwrap_or_default();
    Json(models::RecommendationsResponse { recommendations })
}

pub async fn get_movie(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<models::Movie>, (StatusCode, String)> {
    match state.db.get_movie_by_slug(&slug) {
        Ok(Some(movie)) => Ok(Json(movie)),
        Ok(None) => Err((StatusCode::NOT_FOUND, format!("Movie not found: {}", slug))),
        Err(err) => {
            error!("Database error in get_movie: {}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {}", err),
            ))
        }
    }
}


pub async fn get_home(State(state): State<AppState>) -> Json<models::HomeResponse> {
    Json(state.crawler.get_home())
}

pub async fn get_crawler_status(State(state): State<AppState>) -> Json<crawler::CrawlerStatus> {
    Json(state.crawler.get_status())
}

pub async fn trigger_crawler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let triggered = state.crawler.trigger_sync();
    Json(serde_json::json!({
        "success": triggered,
        "message": if triggered { "Crawler sync triggered in background" } else { "Crawler is already running" }
    }))
}
