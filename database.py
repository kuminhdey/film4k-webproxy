import sqlite3
import json
from pathlib import Path
from typing import List, Optional, Dict, Any

DB_PATH = Path("/home/ubuntu/stream-proxy/movies.db")
# Fallback to local directory if not on VPS
if not DB_PATH.parent.exists():
    DB_PATH = Path(__file__).parent / "movies.db"

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    with conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("""
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
            )
        """)
        conn.execute("""
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
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS crawler_state (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_movies_slug ON movies(slug)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_movies_type ON movies(movie_type)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_episodes_movie ON episodes(movie_slug)")
    conn.close()

def upsert_movie(movie_data: Dict[str, Any]):
    conn = get_connection()
    slug = movie_data.get("slug")
    if not slug:
        return
    
    movie_type = movie_data.get("type") or movie_data.get("movie_type", "movie")
    title_vi = movie_data.get("title_vi") or ""
    title_en = movie_data.get("title_en") or ""
    search_text = f"{title_vi} {title_en} {slug}".lower()
    year = movie_data.get("year", 2024)
    quality = movie_data.get("quality", "1080p")
    score = movie_data.get("score", 0.0)
    genres_json = json.dumps(movie_data.get("genres", []), ensure_ascii=False)
    country = movie_data.get("country", "")
    poster = movie_data.get("poster", "")
    backdrop = movie_data.get("backdrop", "")
    overview = movie_data.get("overview", "")
    total_episodes = movie_data.get("totalEpisodes") or movie_data.get("total_episodes", 1)

    stream_val = movie_data.get("stream")
    stream_str = None
    if isinstance(stream_val, dict):
        stream_str = stream_val.get("proxyStreamUrl") or stream_val.get("hlsUrl")
    elif isinstance(stream_val, str):
        stream_str = stream_val
    elif movie_data.get("hls_url"):
        stream_str = movie_data.get("hls_url")

    with conn:
        conn.execute("""
            INSERT INTO movies (
                slug, movie_type, title_vi, title_en, search_text,
                year, quality, score, genres_json, country,
                poster, backdrop, overview, total_episodes, stream, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
        """, (
            slug, movie_type, title_vi, title_en, search_text,
            year, quality, score, genres_json, country,
            poster, backdrop, overview, total_episodes, stream_str
        ))

        # Episodes
        episodes = movie_data.get("episodes", [])
        for ep in episodes:
            sources_json = json.dumps(ep.get("sources", []), ensure_ascii=False)
            conn.execute("""
                INSERT INTO episodes (
                    movie_slug, season, episode, title, runtime, still, sources_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(movie_slug, season, episode) DO UPDATE SET
                    title = excluded.title,
                    runtime = excluded.runtime,
                    still = excluded.still,
                    sources_json = excluded.sources_json
            """, (
                slug,
                ep.get("season", 1),
                ep.get("episode", 1),
                ep.get("title", f"Tập {ep.get('episode', 1)}"),
                ep.get("runtime", 45),
                ep.get("still", ""),
                sources_json
            ))

    conn.close()

def get_stats() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT count(*) as total, sum(case when movie_type='movie' then 1 else 0 end) as movies, sum(case when movie_type='tv' then 1 else 0 end) as series FROM movies")
    row = cursor.fetchone()
    
    cursor.execute("SELECT value FROM crawler_state WHERE key = 'status'")
    status_row = cursor.fetchone()
    conn.close()

    return {
        "total": row["total"] or 0,
        "movies": row["movies"] or 0,
        "series": row["series"] or 0,
        "status": status_row["value"] if status_row else "idle"
    }

def set_crawler_status(status_text: str):
    conn = get_connection()
    with conn:
        conn.execute("""
            INSERT INTO crawler_state (key, value, updated_at)
            VALUES ('status', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
        """, (status_text,))
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at:", DB_PATH)
