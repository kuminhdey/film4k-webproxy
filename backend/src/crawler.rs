use regex::Regex;
use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tracing::{info, warn};

use crate::db::Database;
use crate::models::{Episode, Movie, ServerSource, Source};
use crate::playlist_cache::PlaylistCacheService;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlerStatus {
    pub is_running: bool,
    pub mode: String, // "idle", "full", "latest", "prewarm"
    pub total_discovered: usize,
    pub current_index: usize,
    pub current_slug: Option<String>,
    pub percent: f64,
    pub movies_updated: usize,
    pub errors_count: usize,
    pub recent_logs: Vec<String>,
    pub last_run: Option<String>,
    pub last_status: String,
    pub total_movies_in_db: i64,
}

#[derive(Clone)]
pub struct CrawlerService {
    db: Database,
    playlist_cache: Option<PlaylistCacheService>,
    status: Arc<Mutex<CrawlerStatus>>,
    logs: Arc<Mutex<VecDeque<String>>>,
    stop_requested: Arc<AtomicBool>,
}

impl CrawlerService {
    pub fn new(db: Database) -> Self {
        let total = db
            .get_movies(None, None, None, 1, 0)
            .map(|(_, count)| count)
            .unwrap_or(0);

        Self {
            db,
            playlist_cache: None,
            status: Arc::new(Mutex::new(CrawlerStatus {
                is_running: false,
                mode: "idle".to_string(),
                total_discovered: 0,
                current_index: 0,
                current_slug: None,
                percent: 0.0,
                movies_updated: 0,
                errors_count: 0,
                recent_logs: Vec::new(),
                last_run: None,
                last_status: "Initialized".to_string(),
                total_movies_in_db: total,
            })),
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(60))),
            stop_requested: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn with_playlist_cache(mut self, cache: PlaylistCacheService) -> Self {
        self.playlist_cache = Some(cache);
        self
    }

    pub fn set_playlist_cache(&mut self, cache: PlaylistCacheService) {
        self.playlist_cache = Some(cache);
    }

    pub fn add_log(&self, msg: impl Into<String>) {
        let text = msg.into();
        info!("{}", text);
        let mut logs = self.logs.lock().unwrap();
        logs.push_back(text);
        while logs.len() > 50 {
            logs.pop_front();
        }
    }

    pub fn get_status(&self) -> CrawlerStatus {
        let mut status = self.status.lock().unwrap().clone();
        if let Ok((_, count)) = self.db.get_movies(None, None, None, 1, 0) {
            status.total_movies_in_db = count;
        }
        status.recent_logs = self.logs.lock().unwrap().iter().cloned().collect();
        status
    }

    pub fn stop(&self) {
        self.stop_requested.store(true, Ordering::SeqCst);
        self.add_log("🛑 Stop signal sent to Crawler. Gracefully halting...".to_string());
    }

    pub fn trigger_sync(&self) -> bool {
        self.trigger_mode("latest")
    }

    pub fn trigger_mode(&self, mode: &str) -> bool {
        let mut status = self.status.lock().unwrap();
        if status.is_running {
            return false;
        }
        status.is_running = true;
        status.mode = mode.to_string();
        status.current_index = 0;
        status.current_slug = None;
        status.percent = 0.0;
        status.movies_updated = 0;
        status.errors_count = 0;
        status.last_status = format!("Started crawler in mode: {}", mode);
        drop(status);

        self.stop_requested.store(false, Ordering::SeqCst);
        self.add_log(format!("🚀 Crawler triggered in mode: '{}'", mode));

        let service = self.clone();
        let mode_owned = mode.to_string();
        tokio::spawn(async move {
            service.run_crawl_mode(&mode_owned).await;
        });

        true
    }

    pub fn start_background_schedule(&self, interval_hours: u64) {
        let service = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(interval_hours * 3600));
            // First tick finishes immediately, wait for next cycle
            interval.tick().await;

            loop {
                interval.tick().await;
                info!("⏰ Scheduled crawler tick triggered (every {}h)", interval_hours);
                service.add_log(format!("⏰ Scheduled sync triggered (mode: latest, interval: {}h)", interval_hours));
                service.run_crawl_mode("latest").await;
            }
        });
    }

    pub async fn fetch_sitemap_slugs(&self) -> anyhow::Result<Vec<String>> {
        let sitemap_url = std::env::var("SITEMAP_URL")
            .unwrap_or_else(|_| "https://fiml4k.fun/sitemap-page.xml?p=1".to_string());

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;

        let resp = client
            .get(&sitemap_url)
            .header(header::USER_AGENT, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .send()
            .await?;

        if !resp.status().is_success() {
            anyhow::bail!("Sitemap request failed with status {}", resp.status());
        }

        let xml = resp.text().await?;
        let slugs = parse_sitemap_slugs(&xml);
        Ok(slugs)
    }

    pub async fn run_crawl_mode(&self, mode: &str) {
        let start_time = Instant::now();
        self.add_log(format!("📑 Fetching sitemap for mode '{}'...", mode));

        // 1. Fetch sitemap slugs
        let slugs = match self.fetch_sitemap_slugs().await {
            Ok(s) => {
                let count = s.len();
                self.add_log(format!("✅ Sitemap loaded: discovered {} movie URLs", count));
                {
                    let mut st = self.status.lock().unwrap();
                    st.total_discovered = count;
                }
                s
            }
            Err(e) => {
                self.add_log(format!("⚠️ Failed to fetch sitemap: {}. Checking local database files...", e));
                // Fallback to local master database if sitemap is unreachable
                self.run_fallback_json_import().await;
                let mut st = self.status.lock().unwrap();
                st.is_running = false;
                st.mode = "idle".to_string();
                st.last_status = format!("Completed fallback json import in {:.1}s", start_time.elapsed().as_secs_f64());
                return;
            }
        };

        let target_slugs: Vec<String> = match mode {
            "latest" => slugs.into_iter().take(100).collect(),
            _ => slugs,
        };

        let total_targets = target_slugs.len();
        {
            let mut st = self.status.lock().unwrap();
            st.total_discovered = total_targets;
        }

        self.add_log(format!("⚡ Processing {} targets with concurrency = 5 (mode: {})...", total_targets, mode));

        let semaphore = Arc::new(tokio::sync::Semaphore::new(5));
        let mut join_set = tokio::task::JoinSet::new();

        for (idx, slug) in target_slugs.into_iter().enumerate() {
            if self.stop_requested.load(Ordering::SeqCst) {
                self.add_log("🛑 Stop signal received. Halting crawl loop gracefully.".to_string());
                break;
            }

            {
                let mut st = self.status.lock().unwrap();
                st.current_index = idx + 1;
                st.current_slug = Some(slug.clone());
                if total_targets > 0 {
                    st.percent = ((idx + 1) as f64 / total_targets as f64 * 100.0).min(100.0);
                }
            }

            let permit = match semaphore.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => break,
            };

            let service = self.clone();
            let slug_clone = slug.clone();
            let mode_clone = mode.to_string();

            join_set.spawn(async move {
                let _permit = permit;
                service.process_single_slug(&slug_clone, &mode_clone).await
            });

            // Keep JoinSet bounded to avoid memory build up
            if join_set.len() >= 15 {
                if let Some(res) = join_set.join_next().await {
                    if let Ok((updated, error)) = res {
                        let mut st = self.status.lock().unwrap();
                        if updated { st.movies_updated += 1; }
                        if error { st.errors_count += 1; }
                    }
                }
            }
        }

        while let Some(res) = join_set.join_next().await {
            if let Ok((updated, error)) = res {
                let mut st = self.status.lock().unwrap();
                if updated { st.movies_updated += 1; }
                if error { st.errors_count += 1; }
            }
        }

        let elapsed = start_time.elapsed().as_secs();
        let now_str = chrono_simple_now();

        let mut st = self.status.lock().unwrap();
        st.is_running = false;
        st.mode = "idle".to_string();
        st.last_run = Some(now_str);
        st.last_status = format!(
            "Finished in {}s. Updated: {}, Errors: {}, Discovered: {}",
            elapsed, st.movies_updated, st.errors_count, st.total_discovered
        );
        self.add_log(format!("🏁 {}", st.last_status));
    }

    pub async fn process_single_slug(&self, slug: &str, mode: &str) -> (bool, bool) {
        // Skip if movie already exists with full details and not in prewarm or force mode
        if mode != "prewarm" && mode != "force" {
            if let Ok(Some(existing)) = self.db.get_movie_by_slug(slug) {
                let is_full = if existing.movie_type == "tv" {
                    !existing.episodes.is_empty()
                } else {
                    existing.stream.is_some() || (!existing.episodes.is_empty() && !existing.episodes[0].sources.is_empty())
                };

                if is_full {
                    return (false, false);
                }
            }
        }

        match self.fetch_and_upsert_movie(slug, mode).await {
            Ok(updated) => (updated, false),
            Err(e) => {
                warn!("Error crawling slug '{}': {}", slug, e);
                (false, true)
            }
        }
    }

    pub async fn fetch_and_upsert_movie(&self, slug: &str, mode: &str) -> anyhow::Result<bool> {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()?;

        let api_base = std::env::var("FIML4K_API_BASE").unwrap_or_else(|_| "https://fiml4k.fun".to_string());
        let title_url = format!("{}/api/title/{}", api_base.trim_end_matches('/'), slug);

        let resp = client
            .get(&title_url)
            .header(header::REFERER, "https://film4k.net/")
            .header(header::USER_AGENT, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .header(header::ACCEPT, "application/json, text/plain, */*")
            .send()
            .await?;

        if !resp.status().is_success() {
            anyhow::bail!("API returned status {}", resp.status());
        }

        let val: serde_json::Value = resp.json().await?;
        if let Some(movie) = parse_title_json_to_movie(slug, &val) {
            self.db.upsert_movie(&movie)?;

            // If mode is prewarm, also cache m3u8 playlists to disk
            if mode == "prewarm" {
                if let Some(ref cache) = self.playlist_cache {
                    let _ = cache.crawl_and_cache(slug, Some(&self.db)).await;
                }
            }

            Ok(true)
        } else {
            anyhow::bail!("Failed to parse title JSON for slug '{}'", slug);
        }
    }

    async fn run_fallback_json_import(&self) {
        let json_paths = [
            "/app/film4k_master_database.json",
            "film4k_master_database.json",
            "../film4k_master_database.json",
            "/Users/kuminhdey/Downloads/webproxy/film4k_master_database.json",
        ];

        let mut imported = 0;
        for path_str in &json_paths {
            let path = std::path::Path::new(path_str);
            if path.exists() {
                if let Ok(content) = tokio::fs::read_to_string(path).await {
                    if let Ok(movies) = serde_json::from_str::<Vec<Movie>>(&content) {
                        for m in movies {
                            if self.db.upsert_movie(&m).is_ok() {
                                imported += 1;
                            }
                        }
                    }
                }
            }
        }
        self.add_log(format!("📦 Seeded/Imported {} movies from local JSON", imported));
    }
}

pub fn parse_sitemap_slugs(xml: &str) -> Vec<String> {
    let mut slugs = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let re = Regex::new(r#"<loc>[^<]*/movie/([^<]+)</loc>"#).unwrap();
    for cap in re.captures_iter(xml) {
        let slug = cap[1].trim().trim_end_matches('/').to_string();
        if !slug.is_empty() && seen.insert(slug.clone()) {
            slugs.push(slug);
        }
    }
    slugs
}

pub fn parse_title_json_to_movie(slug: &str, val: &serde_json::Value) -> Option<Movie> {
    let m = val.get("movie")?;
    let media_type = m
        .get("mediaType")
        .and_then(|t| t.as_str())
        .unwrap_or("movie")
        .to_string();
    let is_tv = media_type == "tv";

    let title_vi = m
        .get("title")
        .and_then(|t| t.get("vi").or_else(|| t.get("en")))
        .and_then(|v| v.as_str())
        .or_else(|| m.get("title").and_then(|t| t.as_str()))
        .unwrap_or(slug)
        .to_string();

    let title_en = m
        .get("title")
        .and_then(|t| t.get("en"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let year = m.get("year").and_then(|y| y.as_i64()).map(|y| y as i32);
    let quality = m
        .get("maxRes")
        .or_else(|| m.get("quality"))
        .and_then(|q| q.as_str())
        .map(|s| s.to_string())
        .or_else(|| Some("1080p".to_string()));
    let score = m.get("score").and_then(|s| s.as_f64());

    let genres = if let Some(g_obj) = m.get("genres").and_then(|g| g.as_object()) {
        if let Some(arr) = g_obj.get("vi").or_else(|| g_obj.get("en")).and_then(|a| a.as_array()) {
            arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
        } else {
            Vec::new()
        }
    } else if let Some(arr) = m.get("genres").and_then(|g| g.as_array()) {
        arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
    } else {
        Vec::new()
    };

    let country = m
        .get("country")
        .and_then(|c| c.get("vi").or_else(|| c.get("en")))
        .and_then(|v| v.as_str())
        .or_else(|| m.get("country").and_then(|c| c.as_str()))
        .map(|s| s.to_string());

    let poster = m
        .get("poster")
        .and_then(|p| p.get("vi").or_else(|| p.get("en")))
        .and_then(|v| v.as_str())
        .or_else(|| m.get("poster").and_then(|p| p.as_str()))
        .map(|s| s.to_string());

    let backdrop = m.get("backdrop").and_then(|b| b.as_str()).map(|s| s.to_string());

    let overview = m
        .get("overview")
        .and_then(|o| o.get("vi").or_else(|| o.get("en")))
        .and_then(|v| v.as_str())
        .or_else(|| m.get("overview").and_then(|o| o.as_str()))
        .map(|s| s.to_string());

    let total_episodes = m
        .get("epTotal")
        .or_else(|| m.get("totalEpisodes"))
        .and_then(|e| e.as_i64())
        .map(|e| e as i32);

    let raw_hls = m
        .get("hlsUrl")
        .and_then(|h| h.as_str())
        .or_else(|| {
            val.get("sources")
                .and_then(|s| s.as_array())
                .and_then(|a| a.first())
                .and_then(|src| src.get("url"))
                .and_then(|u| u.as_str())
        })
        .or_else(|| {
            val.get("episodes")
                .and_then(|e| e.as_array())
                .and_then(|a| a.first())
                .and_then(|ep| ep.get("sources"))
                .and_then(|s| s.as_array())
                .and_then(|a| a.first())
                .and_then(|src| src.get("url"))
                .and_then(|u| u.as_str())
        });

    let default_stream_url = raw_hls.map(|h| {
        if h.starts_with('/') {
            format!("https://fiml4k.fun{}", h)
        } else {
            h.to_string()
        }
    });

    let stream = default_stream_url.as_ref().map(|u| serde_json::Value::String(u.clone()));

    let mut episodes_data = Vec::new();
    if is_tv {
        if let Some(eps) = val.get("episodes").and_then(|e| e.as_array()) {
            for ep in eps {
                let season = ep.get("season").and_then(|s| s.as_i64()).unwrap_or(1) as i32;
                let episode_num = ep.get("episode").and_then(|e| e.as_i64()).unwrap_or(1) as i32;
                let ep_title = ep.get("title").and_then(|t| t.as_str()).map(|s| s.to_string());
                let runtime = ep.get("runtime").and_then(|r| r.as_i64()).map(|r| r as i32);
                let still = ep.get("still").and_then(|s| s.as_str()).map(|s| s.to_string());

                let mut sources = Vec::new();
                let mut servers = Vec::new();
                if let Some(srcs) = ep.get("sources").and_then(|s| s.as_array()) {
                    for (i, s) in srcs.iter().enumerate() {
                        let label = s
                            .get("label")
                            .and_then(|l| l.as_str())
                            .unwrap_or("Server 1")
                            .to_string();
                        let raw_url = s.get("url").and_then(|u| u.as_str()).unwrap_or("");
                        let full_hls = if raw_url.starts_with('/') {
                            format!("https://fiml4k.fun{}", raw_url)
                        } else {
                            raw_url.to_string()
                        };
                        let proxy_url = format!(
                            "https://secret.dangducminh.io.vn/?url={}",
                            crate::proxy::urlencoding::encode(&full_hls)
                        );

                        sources.push(Source {
                            label: label.clone(),
                            hls_url: full_hls.clone(),
                            proxy_stream_url: Some(proxy_url.clone()),
                        });

                        servers.push(ServerSource {
                            id: Some(serde_json::json!(format!("ep-srv-{}", i + 1))),
                            label,
                            hls_url: full_hls,
                            proxy_stream_url: Some(proxy_url),
                            quality: quality.clone(),
                        });
                    }
                }

                episodes_data.push(Episode {
                    id: None,
                    movie_slug: slug.to_string(),
                    season,
                    episode: episode_num,
                    title: ep_title,
                    runtime,
                    still,
                    sources,
                    servers,
                    subtitles: Vec::new(),
                    audio_tracks: Vec::new(),
                });
            }
        }
    }

    let mut movie_servers = Vec::new();
    if let Some(ref hls) = default_stream_url {
        let proxy_url = format!(
            "https://secret.dangducminh.io.vn/?url={}",
            crate::proxy::urlencoding::encode(hls)
        );
        movie_servers.push(ServerSource {
            id: Some(serde_json::json!("server-vip-4k")),
            label: "Server VIP (4K CDN)".to_string(),
            hls_url: hls.clone(),
            proxy_stream_url: Some(proxy_url),
            quality: quality.clone(),
        });
    }

    Some(Movie {
        id: m.get("_id").cloned(),
        slug: slug.to_string(),
        movie_type: media_type,
        title_vi: Some(title_vi),
        title_en,
        year,
        quality,
        score,
        genres,
        country,
        poster,
        backdrop,
        overview,
        total_episodes: total_episodes.or_else(|| {
            if !episodes_data.is_empty() {
                Some(episodes_data.len() as i32)
            } else {
                None
            }
        }),
        stream,
        episodes: episodes_data,
        servers: movie_servers,
        subtitles: Vec::new(),
        audio_tracks: Vec::new(),
    })
}

fn chrono_simple_now() -> String {
    let now = SystemTime::now();
    let duration = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("UTC timestamp: {}s", duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sitemap_slugs() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://fiml4k.fun/</loc></url>
  <url><loc>https://fiml4k.fun/genres</loc></url>
  <url><loc>https://fiml4k.fun/movie/interstellar</loc></url>
  <url><loc>https://fiml4k.fun/movie/species-iii</loc></url>
  <url><loc>https://fiml4k.fun/movie/interstellar</loc></url>
</urlset>"#;
        let slugs = parse_sitemap_slugs(xml);
        assert_eq!(slugs.len(), 2);
        assert_eq!(slugs[0], "interstellar");
        assert_eq!(slugs[1], "species-iii");
    }

    #[test]
    fn test_parse_title_json() {
        let json_str = r#"{
            "movie": {
                "_id": "123",
                "slug": "species",
                "mediaType": "movie",
                "title": { "vi": "Loài Ác Độc", "en": "Species" },
                "year": 1995,
                "score": 6.8,
                "genres": { "vi": ["Khoa Học Viễn Tưởng"] },
                "country": { "vi": "Mỹ" },
                "hlsUrl": "/api/hls/TOKEN/master.m3u8"
            }
        }"#;
        let val: serde_json::Value = serde_json::from_str(json_str).unwrap();
        let movie = parse_title_json_to_movie("species", &val).expect("Should parse movie");
        assert_eq!(movie.slug, "species");
        assert_eq!(movie.title_vi.as_deref(), Some("Loài Ác Độc"));
        assert_eq!(movie.title_en.as_deref(), Some("Species"));
        assert_eq!(movie.year, Some(1995));
        assert_eq!(movie.movie_type, "movie");
        assert!(movie.stream.is_some());
    }
}
