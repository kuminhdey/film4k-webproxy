import asyncio
import re
import json
import logging
from typing import Optional, List
import httpx
from database import upsert_movie, set_crawler_status, get_stats

logger = logging.getLogger("crawler")

CRAWLER_RUNNING = False
STOP_REQUESTED = False

async def fetch_movie_detail(client: httpx.AsyncClient, slug: str) -> Optional[dict]:
    url = f"https://fiml4k.fun/api/watch/{slug}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": f"https://fiml4k.fun/watch/{slug}",
        "Accept": "application/json"
    }
    try:
        resp = await client.get(url, headers=headers, timeout=20.0)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if not data or not data.get("movie"):
            return None
        
        m = data["movie"]
        is_tv = m.get("mediaType") == "tv"
        
        episodes_data = []
        default_stream = ""
        
        if is_tv and isinstance(data.get("episodes"), list):
            for ep in data["episodes"]:
                sources = []
                for s in ep.get("sources", []):
                    s_url = s.get("url", "")
                    if s_url and not s_url.startswith("http"):
                        s_url = f"https://fiml4k.fun{s_url}"
                    sources.append({
                        "label": s.get("label", "Server 1"),
                        "hls_url": s_url
                    })
                episodes_data.append({
                    "season": ep.get("season", 1),
                    "episode": ep.get("episode", 1),
                    "runtime": ep.get("runtime", 45),
                    "still": ep.get("still", ""),
                    "sources": sources
                })
        else:
            raw_hls = m.get("hlsUrl")
            if not raw_hls and data.get("sources"):
                raw_hls = data["sources"][0].get("url")
            if raw_hls:
                default_stream = f"https://fiml4k.fun{raw_hls}" if not raw_hls.startswith("http") else raw_hls

        title_obj = m.get("title", {})
        title_vi = title_obj.get("vi") or title_obj.get("en") or slug
        title_en = title_obj.get("en") or ""

        genres_obj = m.get("genres", {})
        genres_list = genres_obj.get("vi") or genres_obj.get("en") or []

        country_obj = m.get("country", {})
        country_str = country_obj.get("vi") or country_obj.get("en") or ""

        poster_obj = m.get("poster", {})
        poster_str = poster_obj.get("vi") or poster_obj.get("en") or ""

        overview_obj = m.get("overview", {})
        overview_str = overview_obj.get("vi") or overview_obj.get("en") or ""

        return {
            "id": m.get("_id", ""),
            "slug": slug,
            "type": "tv" if is_tv else "movie",
            "title_vi": title_vi,
            "title_en": title_en,
            "year": m.get("year", 2024),
            "quality": m.get("maxRes", "1080p"),
            "score": m.get("score", 0.0),
            "genres": genres_list,
            "country": country_str,
            "poster": poster_str,
            "backdrop": m.get("backdrop", ""),
            "overview": overview_str,
            "total_episodes": len(episodes_data) if is_tv else 1,
            "hls_url": default_stream,
            "episodes": episodes_data
        }
    except Exception as e:
        logger.error(f"Error fetching detail for {slug}: {e}")
        return None

async def run_crawler_pipeline(max_items: int = 50, start_page: int = 1):
    global CRAWLER_RUNNING, STOP_REQUESTED
    if CRAWLER_RUNNING:
        print("[CRAWLER] Crawler is already running.")
        return
    
    CRAWLER_RUNNING = True
    STOP_REQUESTED = False
    set_crawler_status(f"Đang chuẩn bị cào sitemap trang {start_page}...")

    crawled_count = 0
    try:
        # Client configured to handle Film4k directly
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, verify=False) as client:
            sitemap_url = f"https://fiml4k.fun/sitemap-page.xml?p={start_page}"
            set_crawler_status(f"Đang tải sitemap: {sitemap_url}")
            
            resp = await client.get(sitemap_url)
            if resp.status_code != 200:
                set_crawler_status(f"Lỗi tải sitemap: HTTP {resp.status_code}")
                return

            locs = re.findall(r"<loc>([^<]+)</loc>", resp.text)
            movie_urls = [l for l in locs if "/movie/" in l]
            print(f"[CRAWLER] Tìm thấy {len(movie_urls)} phim trong sitemap {start_page}.")

            for idx, m_url in enumerate(movie_urls):
                if STOP_REQUESTED or (max_items and crawled_count >= max_items):
                    break
                
                slug = m_url.split("/movie/")[-1].strip("/")
                set_crawler_status(f"Đang cào phim ({crawled_count + 1}/{max_items or len(movie_urls)}): {slug}")
                
                movie_data = await fetch_movie_detail(client, slug)
                if movie_data:
                    upsert_movie(movie_data)
                    crawled_count += 1
                    print(f"  [+] Đã lưu ({crawled_count}): {movie_data['title_vi']} ({movie_data['type']})")
                
                # Courtesy sleep: 300ms so Cloudflare never throttles
                await asyncio.sleep(0.3)

    except Exception as e:
        print(f"[CRAWLER ERROR] {e}")
        set_crawler_status(f"Lỗi crawler: {e}")
    finally:
        CRAWLER_RUNNING = False
        stats = get_stats()
        set_crawler_status(f"Hoàn tất đợt cào! Đã có tổng cộng {stats['total']} phim trong hệ thống.")
        print(f"[CRAWLER DONE] Cào xong {crawled_count} phim. Tổng kho: {stats['total']} phim.")

if __name__ == "__main__":
    from database import init_db
    init_db()
    asyncio.run(run_crawler_pipeline(max_items=10, start_page=1))
