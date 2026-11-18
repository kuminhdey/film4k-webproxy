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
    let mut seed_paths = Vec::new();
    if let Ok(env_seed) = std::env::var("SEED_JSON_PATH") {
        if !env_seed.trim().is_empty() {
            seed_paths.push(env_seed);
        }
    }
    seed_paths.extend([
        "/app/film4k_master_database.json".to_string(),
        "film4k_master_database.json".to_string(),
        "../film4k_master_database.json".to_string(),
    ]);
    for seed_path in &seed_paths {
        if std::path::Path::new(seed_path).exists() {
            let count = db.seed_from_file(seed_path)?;
            if count > 0 {
                info!("🌱 Seeded {} movies from {}", count, seed_path);
                break;
            }
        }
    }

    // 3. Initialize Admin Service (required secret)
    let admin = webproxy_backend::AdminService::from_env()
        .map_err(|e| anyhow::anyhow!("Configuration error: {}", e))?;
    info!("🔒 Admin service initialized with required secret.");

    // 4. Initialize Playlist Cache & Crawler Service
    let playlist_cache = webproxy_backend::PlaylistCacheService::default();
    playlist_cache.start_cleanup_task(db.clone());
    let mut crawler = CrawlerService::new(db.clone());
    crawler.set_playlist_cache(playlist_cache.clone());
    crawler.start_background_schedule(1); // Hourly homepage sync & crawl (every 1 hour)
    crawler.check_and_trigger_initial_sync(); // Initial crawl on startup if cache is empty or stale

    let state = AppState::new(db, crawler)
        .with_playlist_cache(playlist_cache)
        .with_admin(admin);
    let app = create_app(state);

    let host: std::net::IpAddr = std::env::var("HOST")
        .ok()
        .and_then(|h| h.trim().parse().ok())
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8090);

    let addr = SocketAddr::from((host, port));
    info!("🚀 Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
