pub mod admin;
pub mod crawler;
pub mod db;
pub mod models;
pub mod playlist_cache;
pub mod proxy;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use std::path::PathBuf;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::error;

pub use admin::AdminService;
pub use playlist_cache::{
    handle_stream_file, handle_stream_master, PlaylistCache, PlaylistCacheService, StreamParams,
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
}

impl AppState {
    pub fn new(db: Database, crawler: CrawlerService) -> Self {
        Self {
            db,
            crawler,
            playlist_cache: PlaylistCacheService::default(),
            admin: AdminService::new(),
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
}

pub fn create_app(state: AppState) -> Router {
    let api_routes = Router::new()
        .route("/health", get(health_check))
        .route("/movies", get(list_movies))
        .route("/movies/:slug", get(get_movie))
        .route("/proxy/stream", get(handle_stream_proxy))
        .route("/stream/:slug/master.m3u8", get(handle_stream_master))
        .route("/stream/:slug/:file", get(handle_stream_file))
        .route("/crawler/status", get(get_crawler_status))
        .route("/crawler/trigger", post(trigger_crawler))
        .route("/admin/login", post(admin::admin_login))
        .route("/admin/stats", get(admin::admin_stats))
        .route("/admin/crawler/trigger", post(admin::admin_crawler_trigger))
        .route("/admin/crawler/stop", post(admin::admin_crawler_stop))
        .route("/admin/cache/clear", post(admin::admin_cache_clear));

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
        .route("/", get(root_handler))
        .route("/movie/:slug", get(spa_page_handler))
        .route("/movie/:slug/*rest", get(spa_page_handler))
        .route("/watch/:slug", get(spa_page_handler))
        .route("/watch/:slug/:ep", get(spa_page_handler))
        .route("/explore", get(spa_page_handler))
        .route("/genres", get(spa_page_handler))
        .route("/television", get(spa_page_handler))
        .route("/sports", get(spa_page_handler))
        .route("/mylist", get(spa_page_handler))
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

pub async fn health_check() -> &'static str {
    "OK"
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
    let offset = query.offset.unwrap_or(0).max(0);

    match state.db.get_movies(
        query.search.as_deref(),
        query.genre.as_deref(),
        query.movie_type.as_deref(),
        limit,
        offset,
    ) {
        Ok((movies, total)) => Ok(Json(MoviesResponse {
            movies,
            total,
            limit,
            offset,
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
