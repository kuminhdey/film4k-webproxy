use std::net::SocketAddr;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use webproxy_backend::{
    crawler::CrawlerService,
    create_app,
    db::Database,
    AppState,
};

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
        "/app/film4k_master_database.json",
        "film4k_master_database.json",
        "../film4k_master_database.json",
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

    // 3. Initialize Playlist Cache & Crawler Service
    let playlist_cache = webproxy_backend::PlaylistCacheService::default();
    let mut crawler = CrawlerService::new(db.clone());
    crawler.set_playlist_cache(playlist_cache.clone());
    crawler.start_background_schedule(6); // Run every 6 hours

    let state = AppState::new(db, crawler).with_playlist_cache(playlist_cache);
    let app = create_app(state);

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
