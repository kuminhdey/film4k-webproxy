mod crawler;
mod db;
mod models;
mod proxy;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::crawler::CrawlerService;
use crate::db::Database;
use crate::models::{MoviesQuery, MoviesResponse};
use crate::proxy::handle_stream_proxy;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub crawler: CrawlerService,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "webproxy_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("🎬 Starting Film4k WebProxy Backend (Axum)...");

    // 1. Initialize SQLite Database
    let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "movies.db".to_string());
    let db = Database::new(&db_path)?;
    info!("📦 Connected to SQLite database at {}", db_path);

    // 2. Seed initial movies
    let seed_paths = [
        "../film4k_master_database.json",
        "film4k_master_database.json",
        "/Users/kuminhdey/Downloads/webproxy/film4k_master_database.json",
    ];
    for seed_path in &seed_paths {
        if std::path::Path::new(seed_path).exists() {
            if let Ok(count) = db.seed_from_file(seed_path) {
                if count > 0 {
                    info!("🌱 Seeded {} movies from {}", count, seed_path);
                    break;
                }
            }
        }
    }

    // 3. Initialize Crawler Service
    let crawler = CrawlerService::new(db.clone());
    crawler.start_background_schedule(6); // Run every 6 hours

    let state = AppState { db, crawler };

    // 4. CORS configuration
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // 5. Setup Routes
    let api_routes = Router::new()
        .route("/health", get(health_check))
        .route("/movies", get(list_movies))
        .route("/movies/:slug", get(get_movie))
        .route("/proxy/stream", get(handle_stream_proxy))
        .route("/crawler/status", get(get_crawler_status))
        .route("/crawler/trigger", post(trigger_crawler))
        .with_state(state.clone());

    // Resolve frontend dist directory
    let dist_dirs = [
        PathBuf::from("../frontend/dist"),
        PathBuf::from("frontend/dist"),
        PathBuf::from("dist"),
        PathBuf::from("/Users/kuminhdey/Downloads/webproxy/frontend/dist"),
    ];

    let mut frontend_dist = PathBuf::from("../frontend/dist");
    for candidate in &dist_dirs {
        if candidate.exists() {
            frontend_dist = candidate.clone();
            break;
        }
    }

    let index_file = frontend_dist.join("index.html");
    info!("🌐 Serving frontend SPA from {:?} (index: {:?})", frontend_dist, index_file);

    let serve_dir = ServeDir::new(&frontend_dist)
        .not_found_service(ServeFile::new(index_file));

    let app = Router::new()
        .nest("/api", api_routes)
        // Also support root /?url=... for backwards compatibility with earlier tests
        .route("/", get(root_handler))
        .fallback_service(serve_dir)
        .layer(cors);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8090);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("🚀 Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> &'static str {
    "OK"
}

// Root handler that checks if `?url=` parameter is present for stream proxying,
// otherwise returns SPA or API notice.
async fn root_handler(
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

async fn list_movies(
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

async fn get_movie(
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

async fn get_crawler_status(State(state): State<AppState>) -> Json<crawler::CrawlerStatus> {
    Json(state.crawler.get_status())
}

async fn trigger_crawler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let triggered = state.crawler.trigger_sync();
    Json(serde_json::json!({
        "success": triggered,
        "message": if triggered { "Crawler sync triggered in background" } else { "Crawler is already running" }
    }))
}
