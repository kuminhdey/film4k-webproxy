use std::path::Path;
use std::sync::{Arc, Mutex};
use rusqlite::{params, Connection};
use anyhow::Context;
use tracing::{info, warn};

use crate::models::{AudioTrack, Episode, HomeResponse, Movie, MovieSummary, MoviesQuery, ServerSource, Source, SubtitleTrack};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let p = path.as_ref();
        if let Some(parent) = p.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(p)?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_tables()?;
        Ok(db)
    }

    pub fn new_in_memory() -> anyhow::Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> anyhow::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        Self::run_migrations(&mut conn)
    }

    pub fn get_column_names(conn: &Connection, table: &str) -> anyhow::Result<Vec<String>> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
        let cols = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(Result::ok)
            .collect();
        Ok(cols)
    }

    fn run_migrations(conn: &mut Connection) -> anyhow::Result<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )?;

        let applied_versions: std::collections::HashSet<i64> = {
            let mut stmt = conn.prepare("SELECT version FROM schema_migrations")?;
            let rows = stmt.query_map([], |row| row.get(0))?;
            rows.filter_map(Result::ok).collect()
        };

        // Migration 1: Base schema (movies, episodes, home_cache, indexes)
        if !applied_versions.contains(&1) {
            conn.execute_batch(
                r#"
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;

                CREATE TABLE IF NOT EXISTS movies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    slug TEXT UNIQUE NOT NULL,
                    movie_type TEXT NOT NULL DEFAULT 'movie',
                    title_vi TEXT,
                    title_en TEXT,
                    search_text TEXT NOT NULL DEFAULT '',
                    year INTEGER,
                    quality TEXT,
                    score REAL,
                    genres_json TEXT NOT NULL DEFAULT '[]',
                    country TEXT,
                    poster TEXT,
                    backdrop TEXT,
                    overview TEXT,
                    total_episodes INTEGER,
                    stream TEXT,
                    servers_json TEXT NOT NULL DEFAULT '[]',
                    subtitles_json TEXT NOT NULL DEFAULT '[]',
                    audio_tracks_json TEXT NOT NULL DEFAULT '[]',
                    views INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS episodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    movie_slug TEXT NOT NULL,
                    season INTEGER NOT NULL DEFAULT 1,
                    episode INTEGER NOT NULL,
                    title TEXT,
                    runtime INTEGER,
                    still TEXT,
                    sources_json TEXT NOT NULL DEFAULT '[]',
                    servers_json TEXT NOT NULL DEFAULT '[]',
                    subtitles_json TEXT NOT NULL DEFAULT '[]',
                    audio_tracks_json TEXT NOT NULL DEFAULT '[]',
                    UNIQUE(movie_slug, season, episode),
                    FOREIGN KEY (movie_slug) REFERENCES movies(slug) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_movies_slug ON movies(slug);
                CREATE INDEX IF NOT EXISTS idx_movies_type ON movies(movie_type);
                CREATE INDEX IF NOT EXISTS idx_episodes_movie ON episodes(movie_slug);

                CREATE TABLE IF NOT EXISTS home_cache (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    data_json TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                "#,
            )?;
            conn.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (1, 'base_schema')",
                [],
            )?;
            info!("Applied schema migration 1: base_schema");
        }

        // Migration 2: Verify and safely migrate extra columns for pre-existing databases
        if !applied_versions.contains(&2) {
            let movie_cols = Self::get_column_names(conn, "movies")?;
            if !movie_cols.contains(&"servers_json".to_string()) {
                conn.execute(
                    "ALTER TABLE movies ADD COLUMN servers_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )?;
            }
            if !movie_cols.contains(&"subtitles_json".to_string()) {
                conn.execute(
                    "ALTER TABLE movies ADD COLUMN subtitles_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )?;
            }
            if !movie_cols.contains(&"audio_tracks_json".to_string()) {
                conn.execute(
                    "ALTER TABLE movies ADD COLUMN audio_tracks_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )?;
            }
            if !movie_cols.contains(&"views".to_string()) {
                conn.execute(
                    "ALTER TABLE movies ADD COLUMN views INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }

            let ep_cols = Self::get_column_names(conn, "episodes")?;
            if !ep_cols.contains(&"servers_json".to_string()) {
                conn.execute(
                    "ALTER TABLE episodes ADD COLUMN servers_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )?;
            }
            if !ep_cols.contains(&"subtitles_json".to_string()) {
                conn.execute(
                    "ALTER TABLE episodes ADD COLUMN subtitles_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )?;
            }
            if !ep_cols.contains(&"audio_tracks_json".to_string()) {
                conn.execute(
                    "ALTER TABLE episodes ADD COLUMN audio_tracks_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )?;
            }

            conn.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (2, 'extra_json_columns')",
                [],
            )?;
            info!("Applied schema migration 2: extra_json_columns");
        }

        Ok(())
    }

    pub fn seed_from_file<P: AsRef<Path>>(&self, path: P) -> anyhow::Result<usize> {
        let count: i64 = {
            let conn = self.conn.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM movies", [], |r| r.get(0))?
        };

        if count > 0 {
            info!("Database already has {} movies, skipping initial seed", count);
            return Ok(count as usize);
        }

        let file_path = path.as_ref();
        if !file_path.exists() {
            warn!("Seed file {:?} does not exist", file_path);
            return Ok(0);
        }

        let content = std::fs::read_to_string(file_path)
            .with_context(|| format!("Reading seed file {:?}", file_path))?;
        let movies: Vec<Movie> = serde_json::from_str(&content)
            .with_context(|| "Parsing seed JSON")?;

        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        let mut inserted = 0;
        for movie in &movies {
            Self::upsert_movie_conn(&tx, movie)?;
            inserted += 1;
        }

        tx.commit()?;
        info!("Successfully seeded {} movies into database atomically", inserted);
        Ok(inserted)
    }

    pub fn upsert_movie(&self, movie: &Movie) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        Self::upsert_movie_conn(&conn, movie)
    }

    pub fn upsert_movie_conn(conn: &Connection, movie: &Movie) -> anyhow::Result<()> {
        let genres_json = serde_json::to_string(&movie.genres).unwrap_or_else(|_| "[]".to_string());
        let search_text = format!(
            "{} {} {}",
            movie.title_vi.as_deref().unwrap_or(""),
            movie.title_en.as_deref().unwrap_or(""),
            movie.slug
        ).to_lowercase();

        let stream_str = match &movie.stream {
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            Some(serde_json::Value::Object(obj)) => {
                obj.get("proxyStreamUrl")
                    .and_then(|v| v.as_str())
                    .or_else(|| obj.get("hlsUrl").and_then(|v| v.as_str()))
                    .map(|s| s.to_string())
                    .or_else(|| Some(serde_json::to_string(obj).unwrap_or_default()))
            }
            _ => None,
        };

        let servers_json = serde_json::to_string(&movie.servers).unwrap_or_else(|_| "[]".to_string());
        let subtitles_json = serde_json::to_string(&movie.subtitles).unwrap_or_else(|_| "[]".to_string());
        let audio_tracks_json = serde_json::to_string(&movie.audio_tracks).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            r#"
            INSERT INTO movies (slug, movie_type, title_vi, title_en, search_text, year, quality, score, genres_json, country, poster, backdrop, overview, total_episodes, stream, servers_json, subtitles_json, audio_tracks_json, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, CURRENT_TIMESTAMP)
            ON CONFLICT(slug) DO UPDATE SET
                movie_type = excluded.movie_type,
                title_vi = COALESCE(excluded.title_vi, movies.title_vi),
                title_en = COALESCE(excluded.title_en, movies.title_en),
                search_text = excluded.search_text,
                year = COALESCE(excluded.year, movies.year),
                quality = COALESCE(excluded.quality, movies.quality),
                score = COALESCE(excluded.score, movies.score),
                genres_json = excluded.genres_json,
                country = COALESCE(excluded.country, movies.country),
                poster = COALESCE(excluded.poster, movies.poster),
                backdrop = COALESCE(excluded.backdrop, movies.backdrop),
                overview = COALESCE(excluded.overview, movies.overview),
                total_episodes = COALESCE(excluded.total_episodes, movies.total_episodes),
                stream = COALESCE(excluded.stream, movies.stream),
                servers_json = CASE WHEN excluded.servers_json != '[]' THEN excluded.servers_json ELSE movies.servers_json END,
                subtitles_json = CASE WHEN excluded.subtitles_json != '[]' THEN excluded.subtitles_json ELSE movies.subtitles_json END,
                audio_tracks_json = CASE WHEN excluded.audio_tracks_json != '[]' THEN excluded.audio_tracks_json ELSE movies.audio_tracks_json END,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                movie.slug,
                movie.movie_type,
                movie.title_vi,
                movie.title_en,
                search_text,
                movie.year,
                movie.quality,
                movie.score,
                genres_json,
                movie.country,
                movie.poster,
                movie.backdrop,
                movie.overview,
                movie.total_episodes,
                stream_str,
                servers_json,
                subtitles_json,
                audio_tracks_json,
            ],
        )?;

        for ep in &movie.episodes {
            let sources_json = serde_json::to_string(&ep.sources).unwrap_or_else(|_| "[]".to_string());
            let ep_servers_json = serde_json::to_string(&ep.servers).unwrap_or_else(|_| "[]".to_string());
            let ep_subtitles_json = serde_json::to_string(&ep.subtitles).unwrap_or_else(|_| "[]".to_string());
            let ep_audio_tracks_json = serde_json::to_string(&ep.audio_tracks).unwrap_or_else(|_| "[]".to_string());
            conn.execute(
                r#"
                INSERT INTO episodes (movie_slug, season, episode, title, runtime, still, sources_json, servers_json, subtitles_json, audio_tracks_json)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ON CONFLICT(movie_slug, season, episode) DO UPDATE SET
                    title = excluded.title,
                    runtime = excluded.runtime,
                    still = excluded.still,
                    sources_json = excluded.sources_json,
                    servers_json = CASE WHEN excluded.servers_json != '[]' THEN excluded.servers_json ELSE episodes.servers_json END,
                    subtitles_json = CASE WHEN excluded.subtitles_json != '[]' THEN excluded.subtitles_json ELSE episodes.subtitles_json END,
                    audio_tracks_json = CASE WHEN excluded.audio_tracks_json != '[]' THEN excluded.audio_tracks_json ELSE episodes.audio_tracks_json END
                "#,
                params![
                    movie.slug,
                    ep.season,
                    ep.episode,
                    ep.title,
                    ep.runtime,
                    ep.still,
                    sources_json,
                    ep_servers_json,
                    ep_subtitles_json,
                    ep_audio_tracks_json,
                ],
            )?;
        }

        Ok(())
    }

    pub fn get_movies_filtered(
        &self,
        query: &MoviesQuery,
    ) -> anyhow::Result<(Vec<MovieSummary>, i64)> {
        let conn = self.conn.lock().unwrap();

        let mut where_clauses = Vec::new();
        let mut query_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        let effective_search = query.search.as_ref().or(query.keyword.as_ref());
        if let Some(s) = effective_search {
            if !s.trim().is_empty() {
                let pattern = format!("%{}%", s.trim().to_lowercase());
                where_clauses.push("(search_text LIKE ? OR title_vi LIKE ? OR title_en LIKE ? OR slug LIKE ?)");
                query_params.push(Box::new(pattern.clone()));
                query_params.push(Box::new(pattern.clone()));
                query_params.push(Box::new(pattern.clone()));
                query_params.push(Box::new(pattern));
            }
        }

        if let Some(ref g) = query.genre {
            if !g.trim().is_empty() && g != "all" {
                let pattern = format!("%\"{}\"%", g.trim());
                where_clauses.push("genres_json LIKE ?");
                query_params.push(Box::new(pattern));
            }
        }

        let effective_type = query.movie_type.as_ref().or(query.category.as_ref());
        if let Some(mt) = effective_type {
            let mt_trimmed = mt.trim();
            if !mt_trimmed.is_empty() && mt_trimmed != "all" {
                let mapped = match mt_trimmed {
                    "phim-bo" | "series" | "tv" => "tv",
                    "phim-le" | "single" | "movie" => "movie",
                    other => other,
                };
                if mapped == "tv" || mapped == "movie" {
                    where_clauses.push("movie_type = ?");
                    query_params.push(Box::new(mapped.to_string()));
                } else if mapped == "hoat-hinh" || mapped == "anime" {
                    where_clauses.push("genres_json LIKE ?");
                    query_params.push(Box::new("%Hoạt Hình%".to_string()));
                }
            }
        }

        if let Some(ref c) = query.country {
            if !c.trim().is_empty() && c != "all" {
                let pattern = format!("%{}%", c.trim());
                where_clauses.push("country LIKE ?");
                query_params.push(Box::new(pattern));
            }
        }

        if let Some(ref y) = query.year {
            let y_trimmed = y.trim();
            if !y_trimmed.is_empty() && y_trimmed != "all" {
                if let Some(rest) = y_trimmed.strip_prefix("<=") {
                    if let Ok(val) = rest.trim().parse::<i32>() {
                        where_clauses.push("year <= ?");
                        query_params.push(Box::new(val));
                    }
                } else if let Some(rest) = y_trimmed.strip_prefix('<') {
                    if let Ok(val) = rest.trim().parse::<i32>() {
                        where_clauses.push("year < ?");
                        query_params.push(Box::new(val));
                    }
                } else if let Some(rest) = y_trimmed.strip_prefix(">=") {
                    if let Ok(val) = rest.trim().parse::<i32>() {
                        where_clauses.push("year >= ?");
                        query_params.push(Box::new(val));
                    }
                } else if let Some(rest) = y_trimmed.strip_prefix('>') {
                    if let Ok(val) = rest.trim().parse::<i32>() {
                        where_clauses.push("year > ?");
                        query_params.push(Box::new(val));
                    }
                } else if y_trimmed.contains('-') {
                    let parts: Vec<&str> = y_trimmed.split('-').collect();
                    if parts.len() == 2 {
                        if let (Ok(y1), Ok(y2)) = (parts[0].trim().parse::<i32>(), parts[1].trim().parse::<i32>()) {
                            where_clauses.push("year BETWEEN ? AND ?");
                            query_params.push(Box::new(y1));
                            query_params.push(Box::new(y2));
                        }
                    }
                } else if let Ok(val) = y_trimmed.parse::<i32>() {
                    where_clauses.push("year = ?");
                    query_params.push(Box::new(val));
                }
            }
        }

        if let Some(ref q) = query.quality {
            if !q.trim().is_empty() && q != "all" {
                let pattern = format!("%{}%", q.trim());
                where_clauses.push("quality LIKE ?");
                query_params.push(Box::new(pattern));
            }
        }

        if let Some(ref t) = query.track {
            match t.to_lowercase().as_str() {
                "tm" => {
                    where_clauses.push("(audio_tracks_json LIKE '%Thuyết minh%' OR audio_tracks_json LIKE '%thuyết minh%' OR audio_tracks_json LIKE '%Lồng tiếng%' OR audio_tracks_json LIKE '%lồng tiếng%')");
                }
                "pd" => {
                    where_clauses.push("(subtitles_json LIKE '%\"vi\"%' OR subtitles_json LIKE '%Tiếng Việt%' OR subtitles_json != '[]')");
                }
                "both" => {
                    where_clauses.push("((audio_tracks_json LIKE '%Thuyết minh%' OR audio_tracks_json LIKE '%thuyết minh%' OR audio_tracks_json LIKE '%Lồng tiếng%' OR audio_tracks_json LIKE '%lồng tiếng%') AND (subtitles_json LIKE '%\"vi\"%' OR subtitles_json LIKE '%Tiếng Việt%' OR subtitles_json != '[]'))");
                }
                _ => {}
            }
        }

        let order_clause = match query.sort.as_deref().unwrap_or("default") {
            "latest" => "ORDER BY id DESC",
            "score" => "ORDER BY score DESC NULLS LAST, id DESC",
            "views" => "ORDER BY views DESC, score DESC NULLS LAST, id DESC",
            "year" => "ORDER BY year DESC NULLS LAST, score DESC NULLS LAST, id DESC",
            _ => "ORDER BY year DESC NULLS LAST, score DESC NULLS LAST, id DESC",
        };

        let limit = query.limit.unwrap_or(24).clamp(1, 100) as i64;
        let offset = query.offset.unwrap_or_else(|| {
            if let Some(p) = query.page {
                (p.max(1) - 1) * (limit as usize)
            } else {
                0
            }
        }) as i64;

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        // Total count
        let count_sql = format!("SELECT COUNT(*) FROM movies {}", where_sql);
        let mut count_stmt = conn.prepare(&count_sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = query_params.iter().map(|p| p.as_ref()).collect();
        let total: i64 = count_stmt.query_row(param_refs.as_slice(), |r| r.get(0))?;

        // Query movies
        let query_sql = format!(
            r#"
            SELECT id, slug, movie_type, title_vi, title_en, year, quality, score, genres_json, poster, backdrop, total_episodes
            FROM movies
            {}
            {}
            LIMIT ? OFFSET ?
            "#,
            where_sql, order_clause
        );

        let mut stmt = conn.prepare(&query_sql)?;
        let mut full_params = query_params;
        full_params.push(Box::new(limit));
        full_params.push(Box::new(offset));
        let full_param_refs: Vec<&dyn rusqlite::ToSql> = full_params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(full_param_refs.as_slice(), |row| {
            let genres_raw: String = row.get(8)?;
            let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();
            Ok(MovieSummary {
                id: row.get(0)?,
                slug: row.get(1)?,
                movie_type: row.get(2)?,
                title_vi: row.get(3)?,
                title_en: row.get(4)?,
                year: row.get(5)?,
                quality: row.get(6)?,
                score: row.get(7)?,
                genres,
                poster: row.get(9)?,
                backdrop: row.get(10)?,
                total_episodes: row.get(11)?,
            })
        })?;

        let mut summaries = Vec::new();
        for r in rows {
            summaries.push(r?);
        }

        Ok((summaries, total))
    }

    pub fn get_movies(
        &self,
        search: Option<&str>,
        genre: Option<&str>,
        movie_type: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<(Vec<MovieSummary>, i64)> {
        let q = MoviesQuery {
            search: search.map(ToString::to_string),
            genre: genre.map(ToString::to_string),
            movie_type: movie_type.map(ToString::to_string),
            limit: Some(limit as usize),
            offset: Some(offset as usize),
            ..Default::default()
        };
        self.get_movies_filtered(&q)
    }

    pub fn search_suggest(&self, query: &str, limit: usize) -> anyhow::Result<Vec<MovieSummary>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let conn = self.conn.lock().unwrap();
        let pattern_full = format!("%{}%", trimmed.to_lowercase());
        let exact = trimmed.to_lowercase();
        let prefix = format!("{}%", trimmed.to_lowercase());
        let limit_val = limit.clamp(1, 20) as i64;

        let mut stmt = conn.prepare(
            r#"
            SELECT id, slug, movie_type, title_vi, title_en, year, quality, score, genres_json, poster, backdrop, total_episodes
            FROM movies
            WHERE search_text LIKE ?1 OR title_vi LIKE ?1 OR title_en LIKE ?1 OR slug LIKE ?1
            ORDER BY
                CASE
                    WHEN lower(slug) = ?2 THEN 1
                    WHEN lower(title_vi) LIKE ?3 THEN 2
                    WHEN lower(title_en) LIKE ?3 THEN 3
                    ELSE 4
                END,
                score DESC NULLS LAST,
                year DESC NULLS LAST,
                id DESC
            LIMIT ?4
            "#,
        )?;

        let rows = stmt.query_map(params![pattern_full, exact, prefix, limit_val], |row| {
            let genres_raw: String = row.get(8)?;
            let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();
            Ok(MovieSummary {
                id: row.get(0)?,
                slug: row.get(1)?,
                movie_type: row.get(2)?,
                title_vi: row.get(3)?,
                title_en: row.get(4)?,
                year: row.get(5)?,
                quality: row.get(6)?,
                score: row.get(7)?,
                genres,
                poster: row.get(9)?,
                backdrop: row.get(10)?,
                total_episodes: row.get(11)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_movies_by_slugs(&self, slugs: &[String]) -> anyhow::Result<Vec<MovieSummary>> {
        let mut clean_slugs = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for s in slugs {
            let trimmed = s.trim();
            if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
                clean_slugs.push(trimmed.to_string());
                if clean_slugs.len() >= 50 {
                    break;
                }
            }
        }

        if clean_slugs.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders: Vec<String> = (1..=clean_slugs.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            r#"
            SELECT id, slug, movie_type, title_vi, title_en, year, quality, score, genres_json, poster, backdrop, total_episodes
            FROM movies
            WHERE slug IN ({})
            "#,
            placeholders.join(", ")
        );

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;

        let param_refs: Vec<&dyn rusqlite::ToSql> = clean_slugs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            let genres_raw: String = row.get(8)?;
            let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();
            Ok(MovieSummary {
                id: row.get(0)?,
                slug: row.get(1)?,
                movie_type: row.get(2)?,
                title_vi: row.get(3)?,
                title_en: row.get(4)?,
                year: row.get(5)?,
                quality: row.get(6)?,
                score: row.get(7)?,
                genres,
                poster: row.get(9)?,
                backdrop: row.get(10)?,
                total_episodes: row.get(11)?,
            })
        })?;

        let mut map: std::collections::HashMap<String, MovieSummary> = std::collections::HashMap::new();
        for r in rows {
            let item = r?;
            map.insert(item.slug.clone(), item);
        }

        // Return movies strictly in the requested input order of slugs
        let mut ordered = Vec::new();
        for slug in &clean_slugs {
            if let Some(movie) = map.remove(slug) {
                ordered.push(movie);
            }
        }

        Ok(ordered)
    }

    pub fn get_recommendations(&self, slug: &str, limit: usize) -> anyhow::Result<Vec<MovieSummary>> {
        let max_items = limit.clamp(1, 24);
        let movie_opt = self.get_movie_by_slug(slug)?;

        let conn = self.conn.lock().unwrap();
        let mut results = Vec::new();
        let mut seen_slugs = std::collections::HashSet::new();
        seen_slugs.insert(slug.to_string());

        if let Some(target) = movie_opt {
            let mut genre_clauses = Vec::new();
            let mut query_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
            query_params.push(Box::new(slug.to_string()));

            for g in &target.genres {
                if !g.trim().is_empty() {
                    let pattern = format!("%\"{}\"%", g.trim());
                    genre_clauses.push("genres_json LIKE ?");
                    query_params.push(Box::new(pattern));
                }
            }

            let where_sql = if !genre_clauses.is_empty() {
                format!("WHERE slug != ?1 AND ({})", genre_clauses.join(" OR "))
            } else {
                query_params.push(Box::new(target.movie_type.clone()));
                format!("WHERE slug != ?1 AND movie_type = ?2")
            };

            let query_sql = format!(
                r#"
                SELECT id, slug, movie_type, title_vi, title_en, year, quality, score, genres_json, poster, backdrop, total_episodes
                FROM movies
                {}
                ORDER BY score DESC NULLS LAST, year DESC NULLS LAST, id DESC
                LIMIT ?
                "#,
                where_sql
            );

            let mut stmt = conn.prepare(&query_sql)?;
            let mut full_params = query_params;
            full_params.push(Box::new(max_items as i64));
            let param_refs: Vec<&dyn rusqlite::ToSql> = full_params.iter().map(|p| p.as_ref()).collect();

            let rows = stmt.query_map(param_refs.as_slice(), |row| {
                let genres_raw: String = row.get(8)?;
                let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();
                Ok(MovieSummary {
                    id: row.get(0)?,
                    slug: row.get(1)?,
                    movie_type: row.get(2)?,
                    title_vi: row.get(3)?,
                    title_en: row.get(4)?,
                    year: row.get(5)?,
                    quality: row.get(6)?,
                    score: row.get(7)?,
                    genres,
                    poster: row.get(9)?,
                    backdrop: row.get(10)?,
                    total_episodes: row.get(11)?,
                })
            })?;

            for r in rows {
                let item = r?;
                if seen_slugs.insert(item.slug.clone()) {
                    results.push(item);
                }
            }
        }

        // Backfill if needed up to max_items
        if results.len() < max_items {
            let needed = max_items - results.len();
            let mut stmt = conn.prepare(
                r#"
                SELECT id, slug, movie_type, title_vi, title_en, year, quality, score, genres_json, poster, backdrop, total_episodes
                FROM movies
                WHERE slug != ?1
                ORDER BY score DESC NULLS LAST, year DESC NULLS LAST, id DESC
                LIMIT ?2
                "#,
            )?;
            let rows = stmt.query_map(params![slug, (needed + 10) as i64], |row| {
                let genres_raw: String = row.get(8)?;
                let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();
                Ok(MovieSummary {
                    id: row.get(0)?,
                    slug: row.get(1)?,
                    movie_type: row.get(2)?,
                    title_vi: row.get(3)?,
                    title_en: row.get(4)?,
                    year: row.get(5)?,
                    quality: row.get(6)?,
                    score: row.get(7)?,
                    genres,
                    poster: row.get(9)?,
                    backdrop: row.get(10)?,
                    total_episodes: row.get(11)?,
                })
            })?;

            for r in rows {
                let item = r?;
                if seen_slugs.insert(item.slug.clone()) {
                    results.push(item);
                    if results.len() >= max_items {
                        break;
                    }
                }
            }
        }

        Ok(results)
    }

    pub fn get_movie_by_slug(&self, slug: &str) -> anyhow::Result<Option<Movie>> {
        let conn = self.conn.lock().unwrap();

        let mut movie_opt: Option<Movie> = conn.query_row(
            r#"
            SELECT id, slug, movie_type, title_vi, title_en, year, quality, score, genres_json, country, poster, backdrop, overview, total_episodes, stream, servers_json, subtitles_json, audio_tracks_json
            FROM movies WHERE slug = ?1
            "#,
            params![slug],
            |row| {
                let genres_raw: String = row.get(8)?;
                let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();
                let servers_raw: String = row.get(15).unwrap_or_else(|_| "[]".to_string());
                let servers: Vec<ServerSource> = serde_json::from_str(&servers_raw).unwrap_or_default();
                let subtitles_raw: String = row.get(16).unwrap_or_else(|_| "[]".to_string());
                let subtitles: Vec<SubtitleTrack> = serde_json::from_str(&subtitles_raw).unwrap_or_default();
                let audio_tracks_raw: String = row.get(17).unwrap_or_else(|_| "[]".to_string());
                let audio_tracks: Vec<AudioTrack> = serde_json::from_str(&audio_tracks_raw).unwrap_or_default();

                Ok(Movie {
                    id: Some(serde_json::json!(row.get::<_, i64>(0)?)),
                    slug: row.get(1)?,
                    movie_type: row.get(2)?,
                    title_vi: row.get(3)?,
                    title_en: row.get(4)?,
                    year: row.get(5)?,
                    quality: row.get(6)?,
                    score: row.get(7)?,
                    genres,
                    country: row.get(9)?,
                    poster: row.get(10)?,
                    backdrop: row.get(11)?,
                    overview: row.get(12)?,
                    total_episodes: row.get(13)?,
                    stream: row.get::<_, Option<String>>(14)?.map(serde_json::Value::String),
                    episodes: Vec::new(),
                    servers,
                    subtitles,
                    audio_tracks,
                })
            },
        ).ok();

        if let Some(ref mut movie) = movie_opt {
            let mut ep_stmt = conn.prepare(
                r#"
                SELECT id, season, episode, title, runtime, still, sources_json, servers_json, subtitles_json, audio_tracks_json
                FROM episodes
                WHERE movie_slug = ?1
                ORDER BY season ASC, episode ASC
                "#
            )?;

            let ep_rows = ep_stmt.query_map(params![slug], |row| {
                let sources_raw: String = row.get(6)?;
                let sources: Vec<Source> = serde_json::from_str(&sources_raw).unwrap_or_default();
                let servers_raw: String = row.get(7).unwrap_or_else(|_| "[]".to_string());
                let servers: Vec<ServerSource> = serde_json::from_str(&servers_raw).unwrap_or_default();
                let subtitles_raw: String = row.get(8).unwrap_or_else(|_| "[]".to_string());
                let subtitles: Vec<SubtitleTrack> = serde_json::from_str(&subtitles_raw).unwrap_or_default();
                let audio_tracks_raw: String = row.get(9).unwrap_or_else(|_| "[]".to_string());
                let audio_tracks: Vec<AudioTrack> = serde_json::from_str(&audio_tracks_raw).unwrap_or_default();

                Ok(Episode {
                    id: Some(row.get(0)?),
                    movie_slug: slug.to_string(),
                    season: row.get(1)?,
                    episode: row.get(2)?,
                    title: row.get(3)?,
                    runtime: row.get(4)?,
                    still: row.get(5)?,
                    sources,
                    servers,
                    subtitles,
                    audio_tracks,
                })
            })?;

            for ep in ep_rows {
                movie.episodes.push(ep?);
            }
        }

        Ok(movie_opt)
    }

    pub fn find_slug_by_stream_url(&self, url: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();

        // 1. If URL has /api/hls/<token>/..., extract token
        if let Some(idx) = url.find("/api/hls/") {
            let after = &url[idx + 9..];
            let token_part = after.split('/').next().unwrap_or(after);
            let token = token_part.split('?').next().unwrap_or(token_part);
            if token.len() >= 4 {
                let pattern = format!("%{}%", token);
                if let Ok(slug) = conn.query_row(
                    "SELECT slug FROM movies WHERE stream LIKE ?1 OR servers_json LIKE ?1 LIMIT 1",
                    params![pattern],
                    |row| row.get::<_, String>(0),
                ) {
                    return Some(slug);
                }
            }
        }

        // 2. Direct full URL search
        let pattern_full = format!("%{}%", url);
        conn.query_row(
            "SELECT slug FROM movies WHERE stream LIKE ?1 OR servers_json LIKE ?1 LIMIT 1",
            params![pattern_full],
            |row| row.get::<_, String>(0),
        ).ok()
    }

    pub fn update_movie_stream(&self, slug: &str, new_hls_url: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();

        let current: Option<(Option<String>, String)> = conn.query_row(
            "SELECT stream, servers_json FROM movies WHERE slug = ?1",
            params![slug],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok();

        if let Some((_, servers_json_str)) = current {
            let mut servers: Vec<ServerSource> = serde_json::from_str(&servers_json_str).unwrap_or_default();
            let proxy_url = format!("https://secret.dangducminh.io.vn/?url={}", crate::proxy::urlencoding::encode(new_hls_url));

            if let Some(first) = servers.first_mut() {
                first.hls_url = new_hls_url.to_string();
                first.proxy_stream_url = Some(proxy_url);
            } else {
                servers.push(ServerSource {
                    id: Some(serde_json::json!("server-vip-4k")),
                    label: "Server VIP (4K CDN)".to_string(),
                    hls_url: new_hls_url.to_string(),
                    proxy_stream_url: Some(proxy_url),
                    quality: Some("4K".to_string()),
                });
            }

            let new_servers_json = serde_json::to_string(&servers).unwrap_or_else(|_| "[]".to_string());
            let updated = conn.execute(
                r#"
                UPDATE movies
                SET stream = ?1, servers_json = ?2, updated_at = CURRENT_TIMESTAMP
                WHERE slug = ?3
                "#,
                params![new_hls_url, new_servers_json, slug],
            )?;

            info!("Updated stream & servers_json for movie {} to {}", slug, new_hls_url);
            Ok(updated > 0)
        } else {
            Ok(false)
        }
    }

    pub fn get_stats(&self) -> anyhow::Result<(i64, i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM movies", [], |r| r.get(0))
            .unwrap_or(0);
        let movies: i64 = conn
            .query_row("SELECT COUNT(*) FROM movies WHERE movie_type = 'movie'", [], |r| r.get(0))
            .unwrap_or(0);
        let series: i64 = conn
            .query_row("SELECT COUNT(*) FROM movies WHERE movie_type = 'tv'", [], |r| r.get(0))
            .unwrap_or(0);
        Ok((total, movies, series))
    }

    pub fn save_home_cache(&self, home: &HomeResponse) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        let json_str = serde_json::to_string(home)?;
        conn.execute(
            r#"
            INSERT INTO home_cache (id, data_json, updated_at)
            VALUES (1, ?1, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                data_json = excluded.data_json,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![json_str],
        )?;
        Ok(())
    }

    pub fn get_home_cache(&self) -> anyhow::Result<Option<HomeResponse>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT data_json FROM home_cache WHERE id = 1")?;
        let res = stmt.query_row([], |row| {
            let json_str: String = row.get(0)?;
            Ok(json_str)
        });
        match res {
            Ok(json_str) => {
                let home: HomeResponse = serde_json::from_str(&json_str)?;
                Ok(Some(home))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn get_home_cache_age_seconds(&self) -> anyhow::Result<Option<u64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT CAST((strftime('%s', 'now') - strftime('%s', updated_at)) AS INTEGER) FROM home_cache WHERE id = 1")?;
        let res = stmt.query_row([], |row| {
            let age: i64 = row.get(0)?;
            Ok(age)
        });
        match res {
            Ok(age) => Ok(Some(age.max(0) as u64)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn get_movie_summary_by_slug(&self, slug: &str) -> anyhow::Result<Option<MovieSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT id, slug, movie_type, title_vi, title_en, year, quality, score, genres_json, poster, backdrop, total_episodes
            FROM movies WHERE slug = ?1
            "#,
        )?;
        let res = stmt.query_row(params![slug], |row| {
            let genres_raw: String = row.get(8)?;
            let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();
            Ok(MovieSummary {
                id: row.get(0)?,
                slug: row.get(1)?,
                movie_type: row.get(2)?,
                title_vi: row.get(3)?,
                title_en: row.get(4)?,
                year: row.get(5)?,
                quality: row.get(6)?,
                score: row.get(7)?,
                genres,
                poster: row.get(9)?,
                backdrop: row.get(10)?,
                total_episodes: row.get(11)?,
            })
        });
        match res {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn generate_fallback_home(&self) -> anyhow::Result<HomeResponse> {
        let (all_movies, total) = self.get_movies(None, None, None, 24, 0)?;
        let (top_movies, _) = self.get_movies(None, None, None, 10, 0)?;
        let (new_series, _) = self.get_movies(None, None, Some("tv"), 12, 0)?;
        let (new_movies, _) = self.get_movies(None, None, Some("movie"), 12, 0)?;
        let hero = top_movies.iter().take(5).cloned().collect();

        let mut genres_set = std::collections::BTreeSet::new();
        for m in &all_movies {
            for g in &m.genres {
                genres_set.insert(g.clone());
            }
        }
        let genres = if genres_set.is_empty() {
            vec![
                "Hành Động".to_string(),
                "Phiêu Lưu".to_string(),
                "Khoa Học Viễn Tưởng".to_string(),
                "Chính Kịch".to_string(),
                "Hài Hước".to_string(),
            ]
        } else {
            genres_set.into_iter().collect()
        };

        Ok(HomeResponse {
            hero,
            top: top_movies,
            new_series,
            new_movies,
            list: all_movies,
            genres,
            total,
            more: total > 24,
            page: 1,
        })
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AudioTrack, Episode, Movie, ServerSource, Source, SubtitleTrack};

    #[test]
    fn test_db_crud_and_query() {
        let db = Database::new_in_memory().unwrap();

        let movie = Movie {
            id: None,
            slug: "interstellar".to_string(),
            movie_type: "movie".to_string(),
            title_vi: Some("Hố Đen Tử Thần".to_string()),
            title_en: Some("Interstellar".to_string()),
            year: Some(2014),
            quality: Some("4K UHD".to_string()),
            score: Some(8.7),
            genres: vec!["Sci-Fi".to_string(), "Adventure".to_string()],
            country: Some("US".to_string()),
            poster: Some("https://example.com/poster.jpg".to_string()),
            backdrop: Some("https://example.com/backdrop.jpg".to_string()),
            overview: Some("When Earth becomes uninhabitable...".to_string()),
            total_episodes: Some(1),
            stream: None,
            episodes: vec![Episode {
                id: None,
                movie_slug: "interstellar".to_string(),
                season: 1,
                episode: 1,
                title: Some("Full Movie".to_string()),
                runtime: Some(169),
                still: None,
                sources: vec![Source {
                    label: "Server 1".to_string(),
                    hls_url: "https://film4k.net/api/hls/test/master.m3u8".to_string(),
                    proxy_stream_url: None,
                }],
                servers: vec![ServerSource {
                    id: Some(serde_json::json!("srv-1")),
                    label: "Server VIP 1".to_string(),
                    hls_url: "https://film4k.net/api/hls/test/master.m3u8".to_string(),
                    proxy_stream_url: None,
                    quality: Some("4K".to_string()),
                }],
                subtitles: vec![SubtitleTrack {
                    id: Some(serde_json::json!("sub-vi")),
                    label: "Tiếng Việt".to_string(),
                    lang: Some("vi".to_string()),
                    url: Some("/api/subtitles/interstellar.vtt".to_string()),
                    kind: Some("subtitles".to_string()),
                    is_default: Some(true),
                }],
                audio_tracks: vec![AudioTrack {
                    id: Some(serde_json::json!(0)),
                    label: "ENG (Stereo)".to_string(),
                    lang: Some("en".to_string()),
                    url: None,
                    is_default: Some(true),
                }],
            }],
            servers: vec![ServerSource {
                id: Some(serde_json::json!("srv-1")),
                label: "Server VIP 1".to_string(),
                hls_url: "https://film4k.net/api/hls/test/master.m3u8".to_string(),
                proxy_stream_url: None,
                quality: Some("4K".to_string()),
            }],
            subtitles: vec![SubtitleTrack {
                id: Some(serde_json::json!("sub-vi")),
                label: "Tiếng Việt".to_string(),
                lang: Some("vi".to_string()),
                url: Some("/api/subtitles/interstellar.vtt".to_string()),
                kind: Some("subtitles".to_string()),
                is_default: Some(true),
            }],
            audio_tracks: vec![AudioTrack {
                id: Some(serde_json::json!(0)),
                label: "ENG (Stereo)".to_string(),
                lang: Some("en".to_string()),
                url: None,
                is_default: Some(true),
            }],
        };

        db.upsert_movie(&movie).unwrap();

        // 1. Query by slug
        let found = db.get_movie_by_slug("interstellar").unwrap().expect("Movie should exist");
        assert_eq!(found.title_en.as_deref(), Some("Interstellar"));
        assert_eq!(found.servers.len(), 1);
        assert_eq!(found.servers[0].label, "Server VIP 1");
        assert_eq!(found.subtitles.len(), 1);
        assert_eq!(found.subtitles[0].label, "Tiếng Việt");
        assert_eq!(found.audio_tracks.len(), 1);
        assert_eq!(found.audio_tracks[0].label, "ENG (Stereo)");
        assert_eq!(found.episodes.len(), 1);
        assert_eq!(found.episodes[0].sources[0].label, "Server 1");
        assert_eq!(found.episodes[0].servers.len(), 1);
        assert_eq!(found.episodes[0].servers[0].label, "Server VIP 1");
        assert_eq!(found.episodes[0].subtitles.len(), 1);
        assert_eq!(found.episodes[0].subtitles[0].label, "Tiếng Việt");
        assert_eq!(found.episodes[0].audio_tracks.len(), 1);
        assert_eq!(found.episodes[0].audio_tracks[0].label, "ENG (Stereo)");

        // 2. Query list with search
        let (list, total) = db.get_movies(Some("hố đen"), None, None, 10, 0).unwrap();
        assert_eq!(total, 1);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].slug, "interstellar");

        // 3. Query list with genre
        let (list_genre, total_genre) = db.get_movies(None, Some("Sci-Fi"), None, 10, 0).unwrap();
        assert_eq!(total_genre, 1);
        assert_eq!(list_genre[0].slug, "interstellar");

        // 4. Query list with non-matching search
        let (empty_list, empty_total) = db.get_movies(Some("nonexistent_film"), None, None, 10, 0).unwrap();
        assert_eq!(empty_total, 0);
        assert!(empty_list.is_empty());
    }

    #[test]
    fn test_seed_master_database_and_verify_movie_configs() {
        let db = Database::new_in_memory().unwrap();
        let seed_path = std::path::Path::new("../film4k_master_database.json");
        if !seed_path.exists() {
            return;
        }

        let inserted = db.seed_from_file(seed_path).unwrap();
        assert_eq!(inserted, 17);

        // 1. Verify spider-man-brand-new-day
        let spidey = db.get_movie_by_slug("spider-man-brand-new-day").unwrap().expect("Spiderman should exist");
        assert_eq!(spidey.servers.len(), 3);
        assert_eq!(spidey.servers[0].label, "Server VIP (4K CDN)");
        assert_eq!(spidey.servers[0].quality.as_deref(), Some("4K"));
        assert_eq!(spidey.servers[1].label, "Server 2 (Dự Phòng)");
        assert_eq!(spidey.servers[2].label, "Server 3 (Direct CDN)");

        assert_eq!(spidey.subtitles.len(), 3);
        assert_eq!(spidey.subtitles[0].label, "Film4k.net");
        assert_eq!(spidey.subtitles[0].url.as_deref(), Some("/api/subtitles/spider-man-brand-new-day.vtt"));
        assert_eq!(spidey.subtitles[0].is_default, Some(true));
        assert_eq!(spidey.subtitles[1].label, "Tiếng Việt");
        assert_eq!(spidey.subtitles[2].label, "English");

        assert_eq!(spidey.audio_tracks.len(), 3);
        assert_eq!(spidey.audio_tracks[0].label, "ENG (Stereo)");
        assert_eq!(spidey.audio_tracks[0].is_default, Some(true));
        assert_eq!(spidey.audio_tracks[1].label, "ENG (Dolby Atmos 5.1)");
        assert_eq!(spidey.audio_tracks[2].label, "VIE (Thuyết minh)");

        // 2. Verify street-fighter
        let sf = db.get_movie_by_slug("street-fighter").unwrap().expect("Street Fighter should exist");
        assert_eq!(sf.servers.len(), 3);
        assert_eq!(sf.servers[0].label, "Server VIP (4K CDN)");
        assert_eq!(sf.subtitles.len(), 3);
        assert_eq!(sf.subtitles[0].url.as_deref(), Some("/api/subtitles/street-fighter.vtt"));
        assert_eq!(sf.audio_tracks.len(), 3);
        assert_eq!(sf.audio_tracks[2].label, "VIE (Lồng tiếng)");

        // 3. Verify other movies have configs populated
        let jurassic = db.get_movie_by_slug("jurassic-park").unwrap().expect("Jurassic Park should exist");
        assert!(!jurassic.servers.is_empty());
        assert!(!jurassic.subtitles.is_empty());
        assert!(!jurassic.audio_tracks.is_empty());
    }

    #[test]
    fn test_find_slug_and_update_movie_stream() {
        let db = Database::new_in_memory().unwrap();

        let movie = Movie {
            id: None,
            slug: "spider-man-brand-new-day".to_string(),
            movie_type: "movie".to_string(),
            title_vi: Some("Người Nhện".to_string()),
            title_en: Some("Spider-Man".to_string()),
            year: Some(2026),
            quality: Some("4K".to_string()),
            score: Some(8.5),
            genres: vec!["Action".to_string()],
            country: Some("US".to_string()),
            poster: None,
            backdrop: None,
            overview: None,
            total_episodes: Some(1),
            stream: Some(serde_json::Value::String("https://fiml4k.fun/api/hls/OLD_EXPIRED_TOKEN_12345/master.m3u8".to_string())),
            episodes: vec![],
            servers: vec![ServerSource {
                id: Some(serde_json::json!("srv-vip")),
                label: "Server VIP (4K CDN)".to_string(),
                hls_url: "https://fiml4k.fun/api/hls/OLD_EXPIRED_TOKEN_12345/master.m3u8".to_string(),
                proxy_stream_url: None,
                quality: Some("4K".to_string()),
            }],
            subtitles: vec![],
            audio_tracks: vec![],
        };

        db.upsert_movie(&movie).unwrap();

        // 1. Test finding slug by expired stream url
        let slug = db.find_slug_by_stream_url("https://fiml4k.fun/api/hls/OLD_EXPIRED_TOKEN_12345/master.m3u8");
        assert_eq!(slug.as_deref(), Some("spider-man-brand-new-day"));

        // 2. Test updating stream to fresh HLS url
        let new_url = "https://fiml4k.fun/api/hls/Wjr-5Z8WSYrKNhiOd5cAiDVphbcaBtcUdgaR3nz6nEzPek9X-hZCbJDWS8IFGhKR4ZoQ6ML0l1OXXar0InDk9QJ4a4axA82LdzGZ59H95lI8BHumvDQhQNOdaQ/master.m3u8";
        let updated = db.update_movie_stream("spider-man-brand-new-day", new_url).unwrap();
        assert!(updated);

        // 3. Verify movie in DB now has fresh stream and updated server
        let reloaded = db.get_movie_by_slug("spider-man-brand-new-day").unwrap().unwrap();
        assert_eq!(reloaded.stream, Some(serde_json::Value::String(new_url.to_string())));
        assert_eq!(reloaded.servers[0].hls_url, new_url);
        assert!(reloaded.servers[0].proxy_stream_url.as_ref().unwrap().contains("https%3A%2F%2Ffiml4k.fun"));

        // 4. Test finding slug by new stream url
        let slug_new = db.find_slug_by_stream_url(new_url);
        assert_eq!(slug_new.as_deref(), Some("spider-man-brand-new-day"));
    }

    #[test]
    fn test_schema_migrations_and_versioning() {
        let db = Database::new_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();

        // 1. Verify schema_migrations table contains expected migrations
        let mut stmt = conn.prepare("SELECT version, name FROM schema_migrations ORDER BY version").unwrap();
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, 1);
        assert_eq!(rows[0].1, "base_schema");
        assert_eq!(rows[1].0, 2);
        assert_eq!(rows[1].1, "extra_json_columns");

        // 2. Verify all expected columns exist in movies
        let movie_cols = Database::get_column_names(&conn, "movies").unwrap();
        assert!(movie_cols.contains(&"servers_json".to_string()));
        assert!(movie_cols.contains(&"subtitles_json".to_string()));
        assert!(movie_cols.contains(&"audio_tracks_json".to_string()));
        assert!(movie_cols.contains(&"views".to_string()));

        // 3. Verify all expected columns exist in episodes
        let ep_cols = Database::get_column_names(&conn, "episodes").unwrap();
        assert!(ep_cols.contains(&"servers_json".to_string()));
        assert!(ep_cols.contains(&"subtitles_json".to_string()));
        assert!(ep_cols.contains(&"audio_tracks_json".to_string()));
    }
}
