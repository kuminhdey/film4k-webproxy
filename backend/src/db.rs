use std::path::Path;
use std::sync::{Arc, Mutex};
use rusqlite::{params, Connection};
use anyhow::Context;
use tracing::{info, warn};

use crate::models::{AudioTrack, Episode, Movie, MovieSummary, ServerSource, Source, SubtitleTrack};

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
        let conn = self.conn.lock().unwrap();
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
            "#,
        )?;

        // Auto-migrate new columns for pre-existing databases
        let _ = conn.execute("ALTER TABLE movies ADD COLUMN servers_json TEXT NOT NULL DEFAULT '[]'", []);
        let _ = conn.execute("ALTER TABLE movies ADD COLUMN subtitles_json TEXT NOT NULL DEFAULT '[]'", []);
        let _ = conn.execute("ALTER TABLE movies ADD COLUMN audio_tracks_json TEXT NOT NULL DEFAULT '[]'", []);

        let _ = conn.execute("ALTER TABLE episodes ADD COLUMN servers_json TEXT NOT NULL DEFAULT '[]'", []);
        let _ = conn.execute("ALTER TABLE episodes ADD COLUMN subtitles_json TEXT NOT NULL DEFAULT '[]'", []);
        let _ = conn.execute("ALTER TABLE episodes ADD COLUMN audio_tracks_json TEXT NOT NULL DEFAULT '[]'", []);

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

        let mut inserted = 0;
        for movie in &movies {
            self.upsert_movie(movie)?;
            inserted += 1;
        }

        info!("Successfully seeded {} movies into database", inserted);
        Ok(inserted)
    }

    pub fn upsert_movie(&self, movie: &Movie) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
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

    pub fn get_movies(
        &self,
        search: Option<&str>,
        genre: Option<&str>,
        movie_type: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<(Vec<MovieSummary>, i64)> {
        let conn = self.conn.lock().unwrap();

        let mut where_clauses = Vec::new();
        let mut query_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(s) = search {
            if !s.trim().is_empty() {
                let pattern = format!("%{}%", s.trim().to_lowercase());
                where_clauses.push("search_text LIKE ?");
                query_params.push(Box::new(pattern));
            }
        }

        if let Some(g) = genre {
            if !g.trim().is_empty() {
                let pattern = format!("%\"{}\"%", g.trim());
                where_clauses.push("genres_json LIKE ?");
                query_params.push(Box::new(pattern));
            }
        }

        if let Some(mt) = movie_type {
            if !mt.trim().is_empty() && mt != "all" {
                where_clauses.push("movie_type = ?");
                query_params.push(Box::new(mt.to_string()));
            }
        }

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
            ORDER BY year DESC, score DESC, id DESC
            LIMIT ? OFFSET ?
            "#,
            where_sql
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
}
