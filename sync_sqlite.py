#!/usr/bin/env python3
import json
import sqlite3
import sys
from pathlib import Path

def sync_master_json_to_sqlite(json_path: Path, db_path: Path):
    if not json_path.exists():
        print(f"❌ JSON file does not exist: {json_path}")
        return 0

    with open(json_path, "r", encoding="utf-8") as f:
        movies = json.load(f)

    conn = sqlite3.connect(db_path)
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
        conn.execute("CREATE INDEX IF NOT EXISTS idx_movies_slug ON movies(slug)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_movies_type ON movies(movie_type)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_episodes_movie ON episodes(movie_slug)")

        movie_upsert_count = 0
        episode_upsert_count = 0

        for m in movies:
            slug = m.get("slug")
            if not slug:
                continue

            movie_type = m.get("type", "movie")
            title_vi = m.get("title_vi") or ""
            title_en = m.get("title_en") or ""
            search_text = f"{title_vi} {title_en} {slug}".lower()
            year = m.get("year", 2024)
            quality = m.get("quality", "1080p")
            score = m.get("score", 0.0)
            genres_json = json.dumps(m.get("genres", []), ensure_ascii=False)
            country = m.get("country", "")
            poster = m.get("poster", "")
            backdrop = m.get("backdrop", "")
            overview = m.get("overview", "")
            total_episodes = m.get("totalEpisodes", 1)

            stream_val = m.get("stream")
            stream_str = None
            if isinstance(stream_val, dict):
                stream_str = stream_val.get("proxyStreamUrl") or stream_val.get("hlsUrl")
            elif isinstance(stream_val, str):
                stream_str = stream_val

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
            movie_upsert_count += 1

            # Episodes
            episodes = m.get("episodes", [])
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
                episode_upsert_count += 1

    conn.close()
    print(f"📦 [SQLite Sync] Đã đồng bộ {movie_upsert_count} phim và {episode_upsert_count} tập vào {db_path.name}")
    return movie_upsert_count

if __name__ == "__main__":
    base_dir = Path(__file__).parent
    json_file = base_dir / "film4k_master_database.json"
    sqlite_file = base_dir / "movies.db"
    sync_master_json_to_sqlite(json_file, sqlite_file)
