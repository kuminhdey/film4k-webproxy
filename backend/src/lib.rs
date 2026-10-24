pub mod crawler;
pub mod db;
pub mod models;
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

use crate::crawler::CrawlerService;
use crate::db::Database;
use crate::models::{MoviesQuery, MoviesResponse};
use crate::proxy::handle_stream_proxy;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub crawler: CrawlerService,
}

pub fn create_app(state: AppState) -> Router {
    let api_routes = Router::new()
        .route("/health", get(health_check))
        .route("/movies", get(list_movies))
        .route("/movies/:slug", get(get_movie))
        .route("/proxy/stream", get(handle_stream_proxy))
        .route("/crawler/status", get(get_crawler_status))
        .route("/crawler/trigger", post(trigger_crawler))
        .with_state(state.clone());

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
        .fallback_service(serve_dir)
        .layer(cors)
}

pub async fn health_check() -> &'static str {
    "OK"
}

pub async fn root_handler(
    Query(query): Query<proxy::ProxyQuery>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if !query.url.trim().is_empty() {
        return handle_stream_proxy(Query(query), headers).await;
    }
    axum::response::Html(
        "<h1>🎬 Film4k Proxy Backend Running</h1><p>Frontend SPA will serve here once built.</p>"
    ).into_response()
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
