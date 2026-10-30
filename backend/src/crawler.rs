use regex::Regex;
use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime};
use tracing::{info, warn};

use crate::db::Database;
use crate::models::{Episode, HomeResponse, Movie, MovieSummary, ServerSource, Source};
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
    pub owner_id: String,
    db: Database,
    playlist_cache: Option<PlaylistCacheService>,
    status: Arc<Mutex<CrawlerStatus>>,
    logs: Arc<Mutex<VecDeque<String>>>,
    stop_requested: Arc<AtomicBool>,
    home_cache: Arc<RwLock<Option<HomeResponse>>>,
    scheduler_healthy: Arc<AtomicBool>,
}

struct CrawlerLeaseGuard {
    db: Database,
    owner_id: String,
    token: i64,
}

impl Drop for CrawlerLeaseGuard {
    fn drop(&mut self) {
        let db = self.db.clone();
        let owner = self.owner_id.clone();
        let token = self.token;
        if tokio::runtime::Handle::try_current().is_ok() {
            tokio::spawn(async move {
                let worker_db = db.clone();
                if let Err(error) = db.run_blocking(move || worker_db.release_crawler_lease("crawler_main", &owner, token)).await {
                    warn!("Failed to release crawler lease: {}", error);
                }
            });
        } else if let Err(error) = self.db.release_crawler_lease("crawler_main", &self.owner_id, self.token) {
            warn!("Failed to release crawler lease: {}", error);
        }
    }
}

impl CrawlerService {
    fn acquire_lease(&self) -> anyhow::Result<CrawlerLeaseGuard> {
        let token = self
            .db
            .acquire_crawler_lease("crawler_main", &self.owner_id, 120)?
            .ok_or_else(|| anyhow::anyhow!("Another crawler owns the active lease"))?;
        Ok(CrawlerLeaseGuard {
            db: self.db.clone(),
            owner_id: self.owner_id.clone(),
            token,
        })
    }

    async fn acquire_lease_async(&self) -> anyhow::Result<CrawlerLeaseGuard> {
        let db = self.db.clone();
        let owner = self.owner_id.clone();
        let token = self.db.run_blocking(move || db.acquire_crawler_lease("crawler_main", &owner, 120)).await?
            .ok_or_else(|| anyhow::anyhow!("Another crawler owns the active lease"))?;
        Ok(CrawlerLeaseGuard { db: self.db.clone(), owner_id: self.owner_id.clone(), token })
    }
    pub fn new(db: Database) -> Self {
        let total = db
            .get_movies(None, None, None, 1, 0)
            .map(|(_, count)| count)
            .unwrap_or(0);

        let cached_home = db.get_home_cache().ok().flatten();
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let seq = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let owner_id = format!(
            "crawler_{}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
            seq
        );

        Self {
            owner_id,
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
            home_cache: Arc::new(RwLock::new(cached_home)),
            scheduler_healthy: Arc::new(AtomicBool::new(false)),
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
        // Verify no other process holds an unexpired crawler lease
        if let Ok(Some((owner, _fence, expires_at))) = self.db.get_crawler_lease("crawler_main") {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            if owner != self.owner_id && expires_at >= now {
                self.add_log(format!(
                    "⚠️ Crawler trigger ignored: another crawler instance ({}) holds active lease until timestamp {}",
                    owner, expires_at
                ));
                return false;
            }
        }

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
        let health = self.scheduler_healthy.clone();
        tokio::spawn(async move {
            health.store(true, Ordering::SeqCst);
            let _health_guard = SchedulerHealthGuard(health);
            let mut interval = tokio::time::interval(Duration::from_secs(interval_hours * 3600));
            // First tick finishes immediately, wait for next cycle
            interval.tick().await;

            loop {
                interval.tick().await;
                info!("⏰ Scheduled periodic crawl & home sync triggered (every {}h)", interval_hours);
                service.add_log(format!("⏰ Scheduled sync triggered (interval: {}h)", interval_hours));

                // 1. Hourly homepage sync
                if let Err(e) = service.fetch_and_update_home().await {
                    warn!("Scheduled fetch_and_update_home error: {}", e);
                    service.add_log(format!("⚠️ Scheduled home sync error: {}", e));
                }

                // 2. Scheduled crawl for latest movies
                service.run_crawl_mode("latest").await;
            }
        });
    }

    pub fn scheduler_is_healthy(&self) -> bool {
        self.scheduler_healthy.load(Ordering::SeqCst)
    }

    pub fn get_home(&self) -> HomeResponse {
        if let Ok(guard) = self.home_cache.read() {
            if let Some(ref h) = *guard {
                return h.clone();
            }
        }
        if let Ok(Some(cached)) = self.db.get_home_cache() {
            if let Ok(mut guard) = self.home_cache.write() {
                *guard = Some(cached.clone());
            }
            return cached;
        }
        if let Ok(fallback) = self.db.generate_fallback_home() {
            return fallback;
        }
        HomeResponse::default()
    }

    pub fn set_home_cache(&self, home: HomeResponse) {
        match self.acquire_lease().and_then(|lease| {
            self.db.save_home_cache_with_fence(&home, &self.owner_id, lease.token)
        }) {
            Ok(()) => {
                if let Ok(mut guard) = self.home_cache.write() {
                    *guard = Some(home);
                }
            }
            Err(error) => warn!("Home cache update skipped without an active lease: {}", error),
        }
    }

    pub fn is_home_cache_stale_or_empty(&self) -> bool {
        match self.db.get_home_cache_age_seconds() {
            Ok(Some(age)) => age >= 3600,
            _ => true,
        }
    }

    pub fn check_and_trigger_initial_sync(&self) {
        if self.is_home_cache_stale_or_empty() {
            info!("🔄 Cache is empty or stale (>1h). Triggering initial home crawl...");
            self.add_log("🔄 Initial home sync triggered on startup".to_string());
            let service = self.clone();
            tokio::spawn(async move {
                if let Err(e) = service.fetch_and_update_home().await {
                    warn!("Initial home crawl failed: {}", e);
                    service.add_log(format!("⚠️ Initial home crawl failed: {}", e));
                }
            });
        } else {
            info!("✅ Home cache is fresh (<1h), running startup HLS prewarming...");
            self.add_log("✅ Home cache is fresh (<1h), prewarming hot movies".to_string());
            let home = self.get_home();
            let mut hot_slugs = Vec::new();
            for m in home.hero.iter().take(5) {
                if !hot_slugs.contains(&m.slug) {
                    hot_slugs.push(m.slug.clone());
                }
            }
            for m in home.top.iter().take(10) {
                if !hot_slugs.contains(&m.slug) {
                    hot_slugs.push(m.slug.clone());
                }
            }
            if let Some(ref cache) = self.playlist_cache {
                let cache_clone = cache.clone();
                let db_clone = self.db.clone();
                tokio::spawn(async move {
                    cache_clone.prewarm_hot_movies(&hot_slugs, &db_clone).await;
                });
            }
        }
    }

    pub async fn prewarm_hot_movies(&self, slugs: &[String]) {
        if let Some(ref cache) = self.playlist_cache {
            cache.prewarm_hot_movies(slugs, &self.db).await;
        }
    }

    pub async fn fetch_and_update_home(&self) -> anyhow::Result<HomeResponse> {
        let primary_url = std::env::var("FILM4K_HOME_URL")
            .unwrap_or_else(|_| "https://film4k.net/api/home".to_string());
        let fallback_url = std::env::var("FIML4K_HOME_URL")
            .unwrap_or_else(|_| "https://fiml4k.fun/api/home".to_string());

        // Validate URLs with SSRF policy
        let _ = crate::proxy::is_valid_remote_url(&primary_url).map_err(|e| anyhow::anyhow!("Primary home URL rejected: {}", e))?;
        let _ = crate::proxy::is_valid_remote_url(&fallback_url).map_err(|e| anyhow::anyhow!("Fallback home URL rejected: {}", e))?;

        let user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        let referer = "https://film4k.net/";

        let client = Client::builder()
            .timeout(Duration::from_secs(12))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()?;

        self.add_log(format!("🌐 Fetching homepage from primary: {}", primary_url));

        let resp_res = client
            .get(&primary_url)
            .header(header::REFERER, referer)
            .header(header::USER_AGENT, user_agent)
            .header(header::ACCEPT, "application/json, text/plain, */*")
            .send()
            .await;

        let resp = match resp_res {
            Ok(r) if r.status().is_success() => r,
            err => {
                warn!("Primary home URL ({}) failed: {:?}. Retrying fallback URL ({})...", primary_url, err, fallback_url);
                self.add_log(format!("⚠️ Primary {} failed, trying fallback: {}", primary_url, fallback_url));
                client
                    .get(&fallback_url)
                    .header(header::REFERER, referer)
                    .header(header::USER_AGENT, user_agent)
                    .header(header::ACCEPT, "application/json, text/plain, */*")
                    .send()
                    .await?
            }
        };

        if !resp.status().is_success() {
            anyhow::bail!("Home endpoint returned HTTP status {}", resp.status());
        }

        let val: serde_json::Value = resp.json().await?;
        self.fetch_and_update_home_from_value(&val).await
    }

    async fn parse_home_section(&self, items: Option<&Vec<serde_json::Value>>, fence_token: i64) -> anyhow::Result<Vec<MovieSummary>> {
        let items = items.cloned().unwrap_or_default();
        let db = self.db.clone();
        let owner = self.owner_id.clone();
        self.db.run_blocking(move || {
            let mut summaries = Vec::new();
            for item in &items {
                if let Some(movie) = parse_home_movie_item(item) {
                    db.upsert_movie_with_fence(&movie, &owner, fence_token)?;
                    let summary = db.get_movie_summary_by_slug(&movie.slug).ok().flatten().unwrap_or_else(|| MovieSummary {
                        id: 0, slug: movie.slug.clone(), movie_type: movie.movie_type.clone(),
                        title_vi: movie.title_vi.clone(), title_en: movie.title_en.clone(), year: movie.year,
                        quality: movie.quality.clone(), score: movie.score, genres: movie.genres.clone(),
                        poster: movie.poster.clone(), backdrop: movie.backdrop.clone(), total_episodes: movie.total_episodes,
                    });
                    summaries.push(summary);
                }
            }
            Ok(summaries)
        }).await
    }

    pub async fn fetch_and_update_home_from_value(&self, val: &serde_json::Value) -> anyhow::Result<HomeResponse> {
        let lease = self.acquire_lease_async().await?;
        let hero = self.parse_home_section(val.get("hero").and_then(|v| v.as_array()), lease.token).await?;
        let top = self.parse_home_section(val.get("top").and_then(|v| v.as_array()), lease.token).await?;
        let new_series = self.parse_home_section(val.get("newSeries").and_then(|v| v.as_array()), lease.token).await?;
        let new_movies = self.parse_home_section(val.get("newMovies").and_then(|v| v.as_array()), lease.token).await?;
        let list = self.parse_home_section(val.get("list").and_then(|v| v.as_array()), lease.token).await?;

        let genres: Vec<String> = val
            .get("genres")
            .and_then(|g| g.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let total: i64 = val
            .get("total")
            .and_then(|t| t.as_i64())
            .unwrap_or_else(|| {
                self.db.get_stats().map(|(t, _, _)| t).unwrap_or(0)
            });

        let more = val.get("more").and_then(|m| m.as_bool()).unwrap_or(true);
        let page = val.get("page").and_then(|p| p.as_u64()).unwrap_or(1) as usize;

        let home_response = HomeResponse {
            hero,
            top,
            new_series,
            new_movies,
            list,
            genres,
            total,
            more,
            page,
        };

        // 1. Cache snapshot into SQLite Database
        let db = self.db.clone();
        let owner = self.owner_id.clone();
        let cache_value = home_response.clone();
        self.db.run_blocking(move || db.save_home_cache_with_fence(&cache_value, &owner, lease.token)).await?;

        // 2. Cache snapshot into memory for immediate GET /api/home returns
        if let Ok(mut guard) = self.home_cache.write() {
            *guard = Some(home_response.clone());
        }

        self.add_log(format!(
            "🔥 [Home Sync] Cached home snapshot: {} hero, {} top, {} new series, {} new movies, {} list items (Total: {})",
            home_response.hero.len(),
            home_response.top.len(),
            home_response.new_series.len(),
            home_response.new_movies.len(),
            home_response.list.len(),
            home_response.total,
        ));

        // 3. Prewarm top hero (5) and top (10) movies for zero-delay HLS playback
        let mut hot_slugs = Vec::new();
        for m in home_response.hero.iter().take(5) {
            if !hot_slugs.contains(&m.slug) {
                hot_slugs.push(m.slug.clone());
            }
        }
        for m in home_response.top.iter().take(10) {
            if !hot_slugs.contains(&m.slug) {
                hot_slugs.push(m.slug.clone());
            }
        }

        if let Some(ref cache) = self.playlist_cache {
            let cache_clone = cache.clone();
            let db_clone = self.db.clone();
            tokio::spawn(async move {
                cache_clone.prewarm_hot_movies(&hot_slugs, &db_clone).await;
            });
        }

        Ok(home_response)
    }

    pub async fn fetch_sitemap_slugs(&self) -> anyhow::Result<Vec<String>> {
        let sitemap_url = std::env::var("SITEMAP_URL")
            .unwrap_or_else(|_| "https://fiml4k.fun/sitemap-page.xml?p=1".to_string());

        let _ = crate::proxy::is_valid_remote_url(&sitemap_url).map_err(|e| anyhow::anyhow!("Sitemap URL rejected: {}", e))?;

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
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

        // Persistent lease acquisition across processes
        let lease_ttl = 120u64;
        let lease_db = self.db.clone();
        let lease_owner = self.owner_id.clone();
        let fence_token = match self.db.run_blocking(move || lease_db.acquire_crawler_lease("crawler_main", &lease_owner, lease_ttl)).await {
            Ok(Some(token)) => token,
            Ok(None) => {
                let msg = "⚠️ Crawler lease 'crawler_main' currently held by another active process. Aborting crawl.";
                self.add_log(msg.to_string());
                warn!("{}", msg);
                let mut st = self.status.lock().unwrap();
                st.is_running = false;
                st.mode = "idle".to_string();
                st.last_status = "Skipped: active lease held by another process".to_string();
                return;
            }
            Err(e) => {
                let msg = format!("⚠️ Error acquiring crawler lease: {}", e);
                self.add_log(msg.clone());
                warn!("{}", msg);
                let mut st = self.status.lock().unwrap();
                st.is_running = false;
                st.mode = "idle".to_string();
                st.last_status = "Failed to acquire crawler lease".to_string();
                return;
            }
        };
        self.add_log(format!("🔒 Acquired crawler lease 'crawler_main' with fence token {}", fence_token));
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
                self.run_fallback_json_import(fence_token).await;
                let release_db = self.db.clone();
                let release_owner = self.owner_id.clone();
                let _ = self.db.run_blocking(move || release_db.release_crawler_lease("crawler_main", &release_owner, fence_token)).await;
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

            // Renew lease and verify fencing token periodically
            if idx > 0 && idx % 10 == 0 {
                let renew_db = self.db.clone();
                let renew_owner = self.owner_id.clone();
                match self.db.run_blocking(move || renew_db.renew_crawler_lease("crawler_main", &renew_owner, fence_token, lease_ttl)).await {
                    Ok(true) => {}
                    Ok(false) | Err(_) => {
                        self.add_log(format!("🛑 Lost crawler lease or fenced out (token: {}). Halting crawl loop.", fence_token));
                        warn!("Crawler {} lost lease/fence token {}", self.owner_id, fence_token);
                        break;
                    }
                }
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
                service.process_single_slug(&slug_clone, &mode_clone, fence_token).await
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

        // Release crawler lease on completion
        let release_db = self.db.clone();
        let release_owner = self.owner_id.clone();
        let _ = self.db.run_blocking(move || release_db.release_crawler_lease("crawler_main", &release_owner, fence_token)).await;
        self.add_log("🔓 Released crawler lease 'crawler_main'".to_string());

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

    pub async fn process_single_slug(&self, slug: &str, mode: &str, fence_token: i64) -> (bool, bool) {
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

        match self.fetch_and_upsert_movie(slug, mode, fence_token).await {
            Ok(updated) => (updated, false),
            Err(e) => {
                warn!("Error crawling slug '{}': {}", slug, e);
                (false, true)
            }
        }
    }

    pub async fn fetch_and_upsert_movie(&self, slug: &str, mode: &str, fence_token: i64) -> anyhow::Result<bool> {
        let api_base = std::env::var("FIML4K_API_BASE").unwrap_or_else(|_| "https://fiml4k.fun".to_string());
        let title_url = format!("{}/api/title/{}", api_base.trim_end_matches('/'), slug);

        // Pre-fetch SSRF validation on upstream title endpoint
        let parsed_title = crate::proxy::is_valid_remote_url(&title_url)
            .map_err(|err| anyhow::anyhow!("Title URL rejected by SSRF policy: {}", err))?;

        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()?;

        let (resp, _) = crate::proxy::fetch_stream_with_client(&client, &parsed_title, None, 3)
            .await
            .map_err(|(status, message)| anyhow::anyhow!("Title fetch failed ({}): {}", status, message))?;

        if !resp.status().is_success() {
            anyhow::bail!("API returned status {}", resp.status());
        }

        let val: serde_json::Value = resp.json().await?;
        if let Some(movie) = parse_title_json_to_movie(slug, &val) {
            let db = self.db.clone();
            let owner = self.owner_id.clone();
            self.db.run_blocking(move || db.upsert_movie_with_fence(&movie, &owner, fence_token)).await?;

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

    async fn run_fallback_json_import(&self, fence_token: i64) {
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
                            let db = self.db.clone();
                            let owner = self.owner_id.clone();
                            if self.db.run_blocking(move || db.upsert_movie_with_fence(&m, &owner, fence_token)).await.is_ok() {
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

struct SchedulerHealthGuard(Arc<AtomicBool>);

impl Drop for SchedulerHealthGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
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

pub fn parse_home_movie_item(m: &serde_json::Value) -> Option<Movie> {
    let slug = m.get("slug").and_then(|s| s.as_str())?.to_string();
    if slug.is_empty() {
        return None;
    }

    let media_type = m
        .get("mediaType")
        .or_else(|| m.get("type"))
        .and_then(|t| t.as_str())
        .unwrap_or("movie")
        .to_string();

    let title_vi = m
        .get("title")
        .and_then(|t| t.get("vi").or_else(|| t.get("en")))
        .and_then(|v| v.as_str())
        .or_else(|| m.get("title").and_then(|t| t.as_str()))
        .or_else(|| m.get("title_vi").and_then(|t| t.as_str()))
        .unwrap_or(&slug)
        .to_string();

    let title_en = m
        .get("title")
        .and_then(|t| t.get("en"))
        .and_then(|v| v.as_str())
        .or_else(|| m.get("title_en").and_then(|t| t.as_str()))
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

    Some(Movie {
        id: m.get("_id").cloned(),
        slug,
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
        total_episodes,
        stream: None,
        episodes: Vec::new(),
        servers: Vec::new(),
        subtitles: Vec::new(),
        audio_tracks: Vec::new(),
    })
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

    #[test]
    fn test_parse_home_movie_item() {
        let item_json = r#"{
            "_id": "6adbca73dd087d43ae0fd928",
            "slug": "street-fighter",
            "backdrop": "https://image.tmdb.org/t/p/w1280/qRN8eqYwG6HPSy0i3fKzuLrUOhp.jpg",
            "country": { "en": "United States", "vi": "Âu Mỹ" },
            "genres": { "en": ["Action", "Fantasy"], "vi": ["Phim Hành Động", "Phim Giả Tượng"] },
            "maxRes": "1080p",
            "mediaType": "movie",
            "overview": { "vi": "Chiến binh đường phố đối đầu ác quỷ." },
            "poster": { "vi": "https://image.tmdb.org/t/p/w500/lnaGK9y2Dw1cwRz8e7X5plvYVdI.jpg" },
            "score": 6.3,
            "title": { "en": "Street Fighter", "vi": "Chiến Binh Đường Phố" },
            "year": 2026
        }"#;
        let val: serde_json::Value = serde_json::from_str(item_json).unwrap();
        let movie = parse_home_movie_item(&val).expect("Should parse home movie item");
        assert_eq!(movie.slug, "street-fighter");
        assert_eq!(movie.title_vi.as_deref(), Some("Chiến Binh Đường Phố"));
        assert_eq!(movie.title_en.as_deref(), Some("Street Fighter"));
        assert_eq!(movie.year, Some(2026));
        assert_eq!(movie.score, Some(6.3));
        assert_eq!(movie.quality.as_deref(), Some("1080p"));
        assert_eq!(movie.genres, vec!["Phim Hành Động", "Phim Giả Tượng"]);
    }

    #[tokio::test]
    async fn test_fetch_and_update_home_from_value() {
        let db = Database::new_in_memory().unwrap();
        let crawler = CrawlerService::new(db.clone());

        // Cache initially empty
        assert!(crawler.is_home_cache_stale_or_empty());

        let home_json = r#"{
            "hero": [
                {
                    "_id": "h1",
                    "slug": "hero-movie",
                    "title": { "vi": "Phim Hero", "en": "Hero Movie" },
                    "mediaType": "movie",
                    "year": 2025,
                    "score": 8.5,
                    "genres": ["Hành Động"],
                    "poster": "https://example.com/hero.jpg",
                    "backdrop": "https://example.com/hero_bg.jpg"
                }
            ],
            "top": [
                {
                    "_id": "t1",
                    "slug": "top-movie",
                    "title": { "vi": "Phim Top", "en": "Top Movie" },
                    "mediaType": "movie",
                    "year": 2024,
                    "score": 9.0,
                    "genres": ["Kịch Tính"]
                }
            ],
            "newSeries": [
                {
                    "_id": "s1",
                    "slug": "new-series-1",
                    "title": { "vi": "Bộ Phim Mới", "en": "New Series" },
                    "mediaType": "tv",
                    "year": 2025,
                    "epTotal": 12,
                    "genres": ["Hoạt Hình"]
                }
            ],
            "newMovies": [
                {
                    "_id": "m1",
                    "slug": "new-cinema-movie",
                    "title": { "vi": "Phim Chiếu Rạp Mới", "en": "New Cinema Movie" },
                    "mediaType": "movie",
                    "year": 2025,
                    "genres": ["Khoa Học Viễn Tưởng"]
                }
            ],
            "list": [
                {
                    "_id": "l1",
                    "slug": "list-movie",
                    "title": { "vi": "Phim Danh Sách", "en": "List Movie" },
                    "mediaType": "movie",
                    "year": 2023,
                    "genres": ["Tâm Lý"]
                }
            ],
            "genres": ["Hành Động", "Hoạt Hình", "Kịch Tính"],
            "total": 3500,
            "more": true,
            "page": 1
        }"#;

        let val: serde_json::Value = serde_json::from_str(home_json).unwrap();
        let res = crawler.fetch_and_update_home_from_value(&val).await.expect("Should update home");

        assert_eq!(res.hero.len(), 1);
        assert_eq!(res.hero[0].slug, "hero-movie");
        assert_eq!(res.top.len(), 1);
        assert_eq!(res.top[0].slug, "top-movie");
        assert_eq!(res.new_series.len(), 1);
        assert_eq!(res.new_series[0].slug, "new-series-1");
        assert_eq!(res.new_movies.len(), 1);
        assert_eq!(res.new_movies[0].slug, "new-cinema-movie");
        assert_eq!(res.list.len(), 1);
        assert_eq!(res.list[0].slug, "list-movie");
        assert_eq!(res.total, 3500);
        assert!(res.more);
        assert_eq!(res.page, 1);

        // Verify cached in memory
        let cached = crawler.get_home();
        assert_eq!(cached.hero[0].slug, "hero-movie");
        assert_eq!(cached.new_series[0].slug, "new-series-1");

        // Verify stored in DB
        let db_movie = db.get_movie_by_slug("hero-movie").unwrap().expect("Should be in DB");
        assert_eq!(db_movie.title_vi.as_deref(), Some("Phim Hero"));

        // Cache should not be stale now
        assert!(!crawler.is_home_cache_stale_or_empty());
    }

    #[tokio::test]
    #[ignore]
    async fn test_live_fetch_and_update_home() {
        let db = Database::new_in_memory().unwrap();
        let crawler = CrawlerService::new(db.clone());
        let res = crawler.fetch_and_update_home().await.expect("Live home fetch should succeed");
        assert!(!res.hero.is_empty());
        assert!(!res.top.is_empty());
        assert!(!res.new_series.is_empty());
        assert!(!res.new_movies.is_empty());
        assert!(!res.list.is_empty());
        assert!(!res.genres.is_empty());
        assert!(res.total > 0);
    }
}
