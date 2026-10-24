use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db::Database;
use crate::models::Movie;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlerStatus {
    pub is_running: bool,
    pub last_run: Option<String>,
    pub last_status: String,
    pub movies_crawled_last_run: usize,
    pub total_movies_in_db: i64,
}

#[derive(Clone)]
pub struct CrawlerService {
    db: Database,
    status: Arc<Mutex<CrawlerStatus>>,
}

impl CrawlerService {
    pub fn new(db: Database) -> Self {
        let total = db.get_movies(None, None, None, 1, 0).map(|(_, count)| count).unwrap_or(0);
        Self {
            db,
            status: Arc::new(Mutex::new(CrawlerStatus {
                is_running: false,
                last_run: None,
                last_status: "Initialized".to_string(),
                movies_crawled_last_run: 0,
                total_movies_in_db: total,
            })),
        }
    }

    pub fn get_status(&self) -> CrawlerStatus {
        let mut status = self.status.lock().unwrap().clone();
        if let Ok((_, count)) = self.db.get_movies(None, None, None, 1, 0) {
            status.total_movies_in_db = count;
        }
        status
    }

    pub fn trigger_sync(&self) -> bool {
        let mut status = self.status.lock().unwrap();
        if status.is_running {
            return false;
        }
        status.is_running = true;
        status.last_status = "Running crawl sync".to_string();
        drop(status);

        let service = self.clone();
        tokio::spawn(async move {
            service.run_crawl_cycle().await;
        });

        true
    }

    pub fn start_background_schedule(&self, interval_hours: u64) {
        let service = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(interval_hours * 3600));
            // First tick finishes immediately, wait for next scheduled cycle
            interval.tick().await;

            loop {
                interval.tick().await;
                info!("⏰ Scheduled crawler tick triggered");
                service.run_crawl_cycle().await;
            }
        });
    }

    async fn run_crawl_cycle(&self) {
        info!("🚀 Crawler cycle started...");
        let start_time = SystemTime::now();

        // 1. Check if master database exists
        let json_paths = [
            "/Users/kuminhdey/Downloads/webproxy/film4k_master_database.json",
            "film4k_master_database.json",
        ];

        let mut imported_total = 0;
        for path_str in &json_paths {
            let path = std::path::Path::new(path_str);
            if path.exists() {
                if let Ok(content) = tokio::fs::read_to_string(path).await {
                    match serde_json::from_str::<Vec<Movie>>(&content) {
                        Ok(movies) => {
                            info!("Importing {} movies from {:?}", movies.len(), path);
                            for m in movies {
                                match self.db.upsert_movie(&m) {
                                    Ok(_) => imported_total += 1,
                                    Err(e) => tracing::warn!("Failed to upsert movie {}: {}", m.slug, e),
                                }
                            }
                        }
                        Err(e) => tracing::error!("Failed to parse JSON {:?}: {}", path, e),
                    }
                }
            }
        }

        let duration_secs = start_time.elapsed().map(|d| d.as_secs()).unwrap_or(0);
        let now_str = chrono::Utc::now().to_rfc3339();

        let mut status = self.status.lock().unwrap();
        status.is_running = false;
        status.last_run = Some(now_str);
        status.movies_crawled_last_run = imported_total;
        status.last_status = format!("Completed successfully in {}s. Processed {} movies.", duration_secs, imported_total);
        info!("✅ Crawler cycle finished: {}", status.last_status);
    }
}

// Minimal chrono helper or fallback
mod chrono {
    pub struct Utc;
    impl Utc {
        pub fn now() -> DateTime {
            DateTime
        }
    }
    pub struct DateTime;
    impl DateTime {
        pub fn to_rfc3339(&self) -> String {
            let now = std::time::SystemTime::now();
            let duration = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
            format!("UTC timestamp: {}s", duration.as_secs())
        }
    }
}
