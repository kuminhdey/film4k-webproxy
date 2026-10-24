use std::path::Path;
use std::sync::{Arc, Mutex};
use rusqlite::{params, Connection};
use anyhow::Context;
use tracing::{info, warn};

use crate::models::{Episode, Movie, MovieSummary, Source};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let conn = Connection::open(path)?;
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
                UNIQUE(movie_slug, season, episode),
                FOREIGN KEY (movie_slug) REFERENCES movies(slug) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_movies_slug ON movies(slug);
            CREATE INDEX IF NOT EXISTS idx_movies_type ON movies(movie_type);
            CREATE INDEX IF NOT EXISTS idx_episodes_movie ON episodes(movie_slug);
            "#,
        )?;
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

        conn.execute(
            r#"
            INSERT INTO movies (slug, movie_type, title_vi, title_en, search_text, year, quality, score, genres_json, country, poster, backdrop, overview, total_episodes, stream, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, CURRENT_TIMESTAMP)
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
                movie.stream,
            ],
        )?;

        for ep in &movie.episodes {
            let sources_json = serde_json::to_string(&ep.sources).unwrap_or_else(|_| "[]".to_string());
            conn.execute(
                r#"
                INSERT INTO episodes (movie_slug, season, episode, title, runtime, still, sources_json)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(movie_slug, season, episode) DO UPDATE SET
                    title = excluded.title,
                    runtime = excluded.runtime,
                    still = excluded.still,
                    sources_json = excluded.sources_json
                "#,
                params![
                    movie.slug,
                    ep.season,
                    ep.episode,
                    ep.title,
                    ep.runtime,
                    ep.still,
                    sources_json,
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
            SELECT id, slug, movie_type, title_vi, title_en, year, quality, score, genres_json, country, poster, backdrop, overview, total_episodes, stream
            FROM movies WHERE slug = ?1
            "#,
            params![slug],
            |row| {
                let genres_raw: String = row.get(8)?;
                let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();
                Ok(Movie {
                    id: Some(row.get(0)?),
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
                    stream: row.get(14)?,
                    episodes: Vec::new(),
                })
            },
        ).ok();

        if let Some(ref mut movie) = movie_opt {
            let mut ep_stmt = conn.prepare(
                r#"
                SELECT id, season, episode, title, runtime, still, sources_json
                FROM episodes
                WHERE movie_slug = ?1
                ORDER BY season ASC, episode ASC
                "#
            )?;

            let ep_rows = ep_stmt.query_map(params![slug], |row| {
                let sources_raw: String = row.get(6)?;
                let sources: Vec<Source> = serde_json::from_str(&sources_raw).unwrap_or_default();
                Ok(Episode {
                    id: Some(row.get(0)?),
                    movie_slug: slug.to_string(),
                    season: row.get(1)?,
                    episode: row.get(2)?,
                    title: row.get(3)?,
                    runtime: row.get(4)?,
                    still: row.get(5)?,
                    sources,
                })
            })?;

            for ep in ep_rows {
                movie.episodes.push(ep?);
            }
        }

        Ok(movie_opt)
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Episode, Movie, Source};

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
            }],
        };

        db.upsert_movie(&movie).unwrap();

        // 1. Query by slug
        let found = db.get_movie_by_slug("interstellar").unwrap().expect("Movie should exist");
        assert_eq!(found.title_en.as_deref(), Some("Interstellar"));
        assert_eq!(found.episodes.len(), 1);
        assert_eq!(found.episodes[0].sources[0].label, "Server 1");

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
}
