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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS movies (
                slug TEXT PRIMARY KEY,
                id TEXT,
                type TEXT, -- 'movie' or 'tv'
                title_vi TEXT,
                title_en TEXT,
                year INTEGER,
                quality TEXT,
                score REAL,
                genres TEXT, -- JSON array
                country TEXT,
                poster TEXT,
                backdrop TEXT,
                overview TEXT,
                total_episodes INTEGER DEFAULT 1,
                hls_url TEXT,
                episodes_json TEXT, -- JSON array of episodes
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS crawler_state (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_movies_type ON movies(type)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_movies_score ON movies(score)")
    conn.close()

def upsert_movie(movie_data: Dict[str, Any]):
    conn = get_connection()
    slug = movie_data.get("slug")
    if not slug:
        return
    with conn:
        conn.execute("""
            INSERT INTO movies (
                slug, id, type, title_vi, title_en, year, quality, score,
                genres, country, poster, backdrop, overview, total_episodes,
                hls_url, episodes_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(slug) DO UPDATE SET
                title_vi=excluded.title_vi,
                title_en=excluded.title_en,
                year=excluded.year,
                quality=excluded.quality,
                score=excluded.score,
                genres=excluded.genres,
                country=excluded.country,
                poster=excluded.poster,
                backdrop=excluded.backdrop,
                overview=excluded.overview,
                total_episodes=excluded.total_episodes,
                hls_url=excluded.hls_url,
                episodes_json=excluded.episodes_json,
                updated_at=CURRENT_TIMESTAMP
        """, (
            slug,
            movie_data.get("id", ""),
            movie_data.get("type", "movie"),
            movie_data.get("title_vi", ""),
            movie_data.get("title_en", ""),
            movie_data.get("year", 2024),
            movie_data.get("quality", "1080p"),
            movie_data.get("score", 0.0),
            json.dumps(movie_data.get("genres", []), ensure_ascii=False),
            movie_data.get("country", ""),
            movie_data.get("poster", ""),
            movie_data.get("backdrop", ""),
            movie_data.get("overview", ""),
            movie_data.get("total_episodes", 1),
            movie_data.get("hls_url", ""),
            json.dumps(movie_data.get("episodes", []), ensure_ascii=False)
        ))
    conn.close()

def get_movies(
    type_filter: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 40,
    offset: int = 0
) -> List[Dict[str, Any]]:
    conn = get_connection()
    query = "SELECT * FROM movies WHERE 1=1"
    params = []

    if type_filter and type_filter in ["movie", "tv"]:
        query += " AND type = ?"
        params.append(type_filter)

    if search:
        query += " AND (title_vi LIKE ? OR title_en LIKE ? OR slug LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s])

    query += " ORDER BY updated_at DESC, score DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    results = []
    for row in rows:
        r = dict(row)
        r["genres"] = json.loads(r["genres"]) if r.get("genres") else []
        r["episodes"] = json.loads(r["episodes_json"]) if r.get("episodes_json") else []
        del r["episodes_json"]
        results.append(r)
    return results

def get_movie_by_slug(slug: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM movies WHERE slug = ?", (slug,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    r = dict(row)
    r["genres"] = json.loads(r["genres"]) if r.get("genres") else []
    r["episodes"] = json.loads(r["episodes_json"]) if r.get("episodes_json") else []
    del r["episodes_json"]
    return r

def get_stats() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT count(*) as total, sum(case when type='movie' then 1 else 0 end) as movies, sum(case when type='tv' then 1 else 0 end) as series FROM movies")
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
