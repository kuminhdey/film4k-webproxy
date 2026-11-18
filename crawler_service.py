# crawler_service.py
import asyncio
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlparse

import httpx
from database import get_stats, set_crawler_status, upsert_movie

logger = logging.getLogger("crawler")

CRAWLER_RUNNING = False
STOP_REQUESTED = False

PROXY_URL = os.environ.get("CRAWLER_PROXY_URL")
MASTER_JSON_PATH = Path(__file__).parent / "film4k_master_database.json"


def is_https_url(value: Any) -> bool:
    if not isinstance(value, str) or not value.startswith("https://"):
        return False
    if any(ch.isspace() for ch in value):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def normalize_upstream_url(raw_url: Any) -> str:
    if not isinstance(raw_url, str):
        return ""
    trimmed = raw_url.strip()
    if not trimmed:
        return ""
    if trimmed.startswith("/"):
        return f"https://fiml4k.fun{trimmed}"
    return trimmed


def validate_movie_urls(movie_data: Dict[str, Any]) -> bool:
    if not isinstance(movie_data, dict):
        return False

    poster = movie_data.get("poster")
    if not is_https_url(poster):
        return False

    backdrop = movie_data.get("backdrop")
    if backdrop and not is_https_url(backdrop):
        return False

    stream_val = movie_data.get("stream")
    if stream_val is not None:
        if isinstance(stream_val, dict):
            hls_url = stream_val.get("hlsUrl")
            proxy_url = stream_val.get("proxyStreamUrl")
            if not is_https_url(hls_url):
                return False
            if proxy_url and not is_https_url(proxy_url):
                return False
        elif isinstance(stream_val, str):
            if not is_https_url(stream_val):
                return False
        else:
            return False

    episodes = movie_data.get("episodes") or []
    if not isinstance(episodes, list):
        return False

    has_valid_ep_source = False
    for ep in episodes:
        if not isinstance(ep, dict):
            return False
        still = ep.get("still")
        if still and not is_https_url(still):
            return False
        sources = ep.get("sources") or []
        if not isinstance(sources, list):
            return False
        for src in sources:
            if not isinstance(src, dict):
                return False
            if not is_https_url(src.get("hlsUrl")):
                return False
            proxy_src = src.get("proxyStreamUrl")
            if proxy_src and not is_https_url(proxy_src):
                return False
            has_valid_ep_source = True

    if movie_data.get("type") == "tv":
        return has_valid_ep_source
    return stream_val is not None


async def fetch_movie_detail(client: httpx.AsyncClient, slug: str) -> Optional[dict]:
    url = f"https://fiml4k.fun/api/watch/{slug}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": f"https://fiml4k.fun/watch/{slug}",
        "Accept": "application/json",
    }
    try:
        resp = await client.get(url, headers=headers, timeout=25.0)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if not data or not data.get("movie"):
            return None

        m = data["movie"]
        is_tv = m.get("mediaType") == "tv"

        episodes_data = []
        default_stream = None

        if is_tv and isinstance(data.get("episodes"), list):
            for ep in data["episodes"]:
                sources = []
                for s in ep.get("sources", []):
                    s_url = normalize_upstream_url(s.get("url", ""))
                    if not is_https_url(s_url):
                        continue
                    sources.append(
                        {
                            "label": s.get("label", "Server 1"),
                            "hlsUrl": s_url,
                            "proxyStreamUrl": f"https://secret.dangducminh.io.vn/?url={quote(s_url, safe='')}",
                        }
                    )
                still_url = normalize_upstream_url(ep.get("still", ""))
                if still_url and not is_https_url(still_url):
                    still_url = ""
                if sources:
                    episodes_data.append(
                        {
                            "movieSlug": slug,
                            "season": ep.get("season", 1),
                            "episode": ep.get("episode", 1),
                            "title": ep.get("title") or f"Tập {ep.get('episode', 1)}",
                            "runtime": ep.get("runtime", 45),
                            "still": still_url,
                            "sources": sources,
                        }
                    )
        else:
            raw_hls = m.get("hlsUrl")
            if not raw_hls and data.get("sources"):
                raw_hls = data["sources"][0].get("url")
            s_url = normalize_upstream_url(raw_hls or "")
            if is_https_url(s_url):
                default_stream = {
                    "label": "Server 1",
                    "hlsUrl": s_url,
                    "proxyStreamUrl": f"https://secret.dangducminh.io.vn/?url={quote(s_url, safe='')}",
                }

        title_obj = m.get("title", {})
        title_vi = title_obj.get("vi") or title_obj.get("en") or slug
        title_en = title_obj.get("en") or ""

        genres_obj = m.get("genres", {})
        genres_list = genres_obj.get("vi") or genres_obj.get("en") or []

        country_obj = m.get("country", {})
        country_str = country_obj.get("vi") or country_obj.get("en") or ""

        poster_obj = m.get("poster", {})
        raw_poster = poster_obj.get("vi") or poster_obj.get("en") or ""
        poster_str = normalize_upstream_url(raw_poster)

        backdrop_str = normalize_upstream_url(m.get("backdrop", ""))
        if backdrop_str and not is_https_url(backdrop_str):
            backdrop_str = ""

        overview_obj = m.get("overview", {})
        overview_str = overview_obj.get("vi") or overview_obj.get("en") or ""

        record = {
            "id": m.get("_id", ""),
            "slug": slug,
            "type": "tv" if is_tv else "movie",
            "title_vi": title_vi,
            "title_en": title_en,
            "year": m.get("year", 2024),
            "quality": m.get("maxRes", "1080p"),
            "score": round(m.get("score", 0.0), 1),
            "genres": genres_list,
            "country": country_str,
            "poster": poster_str,
            "backdrop": backdrop_str,
            "overview": overview_str,
            "totalEpisodes": len(episodes_data) if is_tv else 1,
            "stream": default_stream,
            "episodes": episodes_data,
            "crawledAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

        if not validate_movie_urls(record):
            logger.warning(f"Skipping {slug}: stream or poster URL failed https:// validation")
            return None

        return record
    except Exception as e:
        logger.error(f"Error fetching detail for {slug}: {e}")
        return None


def update_master_json(movies: List[dict]):
    master_map = {}
    if MASTER_JSON_PATH.exists():
        try:
            with open(MASTER_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and item.get("slug"):
                            master_map[item["slug"]] = item
        except Exception:
            pass
    for m in movies:
        if isinstance(m, dict) and m.get("slug") and validate_movie_urls(m):
            master_map[m["slug"]] = m

    temp_path = MASTER_JSON_PATH.with_suffix(".json.tmp")
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(list(master_map.values()), f, ensure_ascii=False, indent=2)
    os.replace(temp_path, MASTER_JSON_PATH)


async def run_crawler_pipeline(max_items: int = 10, mode: str = "hot", start_page: int = 1):
    global CRAWLER_RUNNING, STOP_REQUESTED
    if CRAWLER_RUNNING:
        print("[CRAWLER] Crawler is already running.")
        return

    CRAWLER_RUNNING = True
    STOP_REQUESTED = False
    set_crawler_status(f"Đang chuẩn bị cào Film4k (chế độ: {mode})...")

    crawled_movies = []
    try:
        proxy_cfg = PROXY_URL.strip() if PROXY_URL and PROXY_URL.strip() else None
        async with httpx.AsyncClient(
            proxy=proxy_cfg,
            timeout=30.0,
            follow_redirects=False,
            verify=True,
        ) as client:
            target_slugs = []
            if mode == "hot":
                set_crawler_status("Đang tải danh sách phim Hot từ /api/home...")
                resp = await client.get("https://fiml4k.fun/api/home")
                if resp.status_code == 200:
                    home_data = resp.json()
                    candidates = []
                    for k in ["top", "hero", "newMovies", "newSeries", "list"]:
                        for m in home_data.get(k, []):
                            if m.get("slug") and m["slug"] not in candidates:
                                candidates.append(m["slug"])
                    target_slugs = candidates[:max_items]
            else:
                sitemap_url = f"https://fiml4k.fun/sitemap-page.xml?p={start_page}"
                set_crawler_status(f"Đang tải sitemap: {sitemap_url}")
                resp = await client.get(sitemap_url)
                if resp.status_code == 200:
                    locs = re.findall(r"<loc>([^<]+)</loc>", resp.text)
                    movie_urls = [l for l in locs if "/movie/" in l]
                    target_slugs = [u.split("/movie/")[-1].strip("/") for u in movie_urls][:max_items]

            print(f"[CRAWLER] Tìm thấy {len(target_slugs)} phim cần cào.")

            for idx, slug in enumerate(target_slugs):
                if STOP_REQUESTED:
                    break

                set_crawler_status(f"Đang cào phim ({idx + 1}/{len(target_slugs)}): {slug}")
                movie_data = await fetch_movie_detail(client, slug)
                if movie_data and validate_movie_urls(movie_data):
                    upsert_movie(movie_data)
                    crawled_movies.append(movie_data)
                    print(f"  [+] Đã lưu ({len(crawled_movies)}): {movie_data['title_vi']} ({movie_data['type']})")

                await asyncio.sleep(0.3)

            if crawled_movies:
                update_master_json(crawled_movies)

    except Exception as e:
        print(f"[CRAWLER ERROR] {e}")
        set_crawler_status(f"Lỗi crawler: {e}")
    finally:
        CRAWLER_RUNNING = False
        stats = get_stats()
        set_crawler_status(f"Hoàn tất đợt cào! Đã có {stats['total']} phim trong hệ thống.")
        print(f"[CRAWLER DONE] Cào xong {len(crawled_movies)} phim. Tổng kho: {stats['total']} phim.")


if __name__ == "__main__":
    from database import init_db

    init_db()
    asyncio.run(run_crawler_pipeline(max_items=5, mode="hot"))
