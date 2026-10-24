import os
import re
import asyncio
import hashlib
from pathlib import Path
import urllib.parse
from urllib.parse import urljoin, quote, unquote, urlparse
from fastapi import FastAPI, Request, Response, Query
from fastapi.responses import StreamingResponse, HTMLResponse
from starlette.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx

app = FastAPI(title="M3U8 Stream Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CACHE_DIR = Path("/opt/stream-cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_download_locks = {}
_locks_guard = asyncio.Lock()
_next_segment_map = {}

async def get_download_lock(key: str) -> asyncio.Lock:
    async with _locks_guard:
        if key not in _download_locks:
            _download_locks[key] = asyncio.Lock()
        return _download_locks[key]

def cleanup_cache_if_needed():
    try:
        files = list(CACHE_DIR.glob("*.mp4"))
        total_size = sum(f.stat().st_size for f in files)
        max_bytes = 20 * 1024 * 1024 * 1024  # 20 GB
        target_bytes = 15 * 1024 * 1024 * 1024  # 15 GB
        if total_size > max_bytes:
            files.sort(key=lambda f: f.stat().st_atime)
            for f in files:
                if total_size <= target_bytes:
                    break
                s = f.stat().st_size
                f.unlink(missing_ok=True)
                total_size -= s
    except Exception as e:
        print(f"[CACHE CLEANUP ERROR] {e}")

async def ensure_cached(url: str):
    if not ("tiktokcdn.com" in url or ".image" in url):
        return

    url_clean = url.split("?")[0]
    cache_key = hashlib.md5(url_clean.encode()).hexdigest()
    cache_file = CACHE_DIR / f"{cache_key}.mp4"
    cache_temp = CACHE_DIR / f"{cache_key}.tmp"

    if cache_file.exists():
        return

    lock = await get_download_lock(cache_key)
    async with lock:
        if cache_file.exists():
            return
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
                "Referer": "https://film4k.net/",
                "Origin": "https://film4k.net",
                "Accept": "*/*"
            }
            async with httpx.AsyncClient(timeout=180.0, follow_redirects=True, verify=False, http2=False) as dl_client:
                async with dl_client.stream("GET", url, headers=headers) as upstream_resp:
                    if upstream_resp.status_code != 200:
                        return
                    with open(cache_temp, "wb") as f:
                        first = True
                        async for chunk in upstream_resp.aiter_bytes(chunk_size=1024 * 512):
                            if first:
                                first = False
                                if len(chunk) > 67 and chunk[:8] == b"\x89PNG\r\n\x1a\n":
                                    chunk = chunk[67:]
                            f.write(chunk)
            cache_temp.replace(cache_file)
            print(f"[CACHE] Prefetched & cached: {cache_key} ({cache_file.stat().st_size} bytes)")
            cleanup_cache_if_needed()
        except Exception as e:
            if cache_temp.exists():
                cache_temp.unlink(missing_ok=True)
            print(f"[CACHE ERROR] {e}")

client = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=20.0, read=120.0, write=60.0, pool=60.0),
    follow_redirects=True,
    verify=False,
    http2=False,
    limits=httpx.Limits(max_keepalive_connections=100, max_connections=200)
)

def rewrite_m3u8(content: str, source_url: str, proxy_base: str) -> str:
    base_dir = source_url.rsplit("/", 1)[0] + "/"
    lines = content.splitlines()
    new_lines = []

    def replace_uri(match):
        rel = match.group(1)
        full_url = urljoin(base_dir, rel)
        proxied = f"{proxy_base}?url={quote(full_url, safe='')}"
        return f'URI="{proxied}"'

    segment_urls = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            new_lines.append(line)
            continue

        if stripped.startswith("#"):
            if 'URI="' in line:
                line = re.sub(r'URI="([^"]+)"', replace_uri, line)
            new_lines.append(line)
        else:
            full_url = urljoin(base_dir, stripped)
            segment_urls.append(full_url)
            proxied = f"{proxy_base}?url={quote(full_url, safe='')}"
            new_lines.append(proxied)

    # Pre-map the playback sequence: when chunk N plays, N+1 and N+2 will prefetch
    for idx, seg_url in enumerate(segment_urls):
        next_urls = segment_urls[idx + 1 : idx + 3]
        if next_urls:
            _next_segment_map[seg_url] = next_urls

    # Automatically kick off prefetch for the first 2 chunks right away!
    if segment_urls:
        for init_seg in segment_urls[:2]:
            asyncio.create_task(ensure_cached(init_seg))

    return "\n".join(new_lines)

DEFAULT_STREAM = "https://film4k.net/api/hls/24BQ7QxQ3ruqdnZ65oGApWupWAQk4dPebf5bnNjsSY-h9UiRlEgiHX12KUYK1zsgXLcjPHHHqL-hCgyhdcr358NE8YpeVzX1zcQdvpJMwIkpjh3JXnB9jA/master.m3u8"

def render_player_page(stream_target: str, proxy_url: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8">
    <title>🎬 Vietnam 4K Stream Player (FPT Telecom CDN Proxy)</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.ui.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/controls.min.css">
    <style>
        :root {{
            --primary: #38bdf8;
            --bg: #090d16;
            --card: #131b2e;
            --border: #1e293b;
            --text: #f1f5f9;
            --muted: #94a3b8;
            --accent: #10b981;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            background: var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 24px 16px;
        }}
        .wrapper {{ width: 100%; max-width: 1100px; }}
        header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 12px;
        }}
        h1 {{ font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }}
        .badge-proxy {{
            background: rgba(16, 185, 129, 0.15);
            color: var(--accent);
            border: 1px solid var(--accent);
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }}
        .badge-domain {{
            background: rgba(56, 189, 248, 0.15);
            color: var(--primary);
            border: 1px solid var(--primary);
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }}
        .player-container {{
            position: relative;
            width: 100%;
            aspect-ratio: 16/9;
            background: #000;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px var(--border);
        }}
        video {{ width: 100%; height: 100%; }}
        .control-panel {{
            margin-top: 20px;
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 18px 20px;
        }}
        .input-group {{
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }}
        input[type="text"] {{
            flex: 1;
            background: #0b1120;
            border: 1px solid var(--border);
            padding: 10px 14px;
            border-radius: 8px;
            color: var(--text);
            font-size: 13px;
        }}
        input[type="text"]:focus {{ outline: none; border-color: var(--primary); }}
        button {{
            background: #0284c7;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }}
        button:hover {{ background: #0369a1; }}
        .info-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 15px;
            font-size: 13px;
        }}
        .info-card {{
            background: #0b1120;
            padding: 12px 14px;
            border-radius: 8px;
            border: 1px solid var(--border);
        }}
        .info-card b {{ color: var(--muted); display: block; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }}
        .url-box {{ word-break: break-all; color: var(--primary); font-family: monospace; font-size: 12px; }}
        .status-dot {{ display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-right: 6px; box-shadow: 0 0 8px #10b981; }}
        #log-box {{
            margin-top: 15px;
            background: #060911;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 10px 12px;
            font-family: monospace;
            font-size: 11px;
            color: #a5b4fc;
            max-height: 140px;
            overflow-y: auto;
        }}
    </style>
</head>
<body>
    <div class="wrapper">
        <header>
            <h1>🎬 Mission: Impossible II 4K UHD</h1>
            <div style="display:flex;gap:8px;">
                <span class="badge-domain">🌐 167.254.69.251</span>
                <span class="badge-proxy"><span class="status-dot"></span>100% Chunks qua VPS Proxy</span>
            </div>
        </header>

        <div class="player-container" data-shaka-player-container>
            <video autoplay muted playsinline controls data-shaka-player id="video"></video>
            <button id="play-overlay-btn" onclick="document.getElementById('video').play(); this.style.display='none';" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:20;background:rgba(2,132,199,0.9);color:white;border:none;border-radius:50px;padding:14px 28px;font-size:16px;font-weight:bold;cursor:pointer;display:none;box-shadow:0 0 30px rgba(2,132,199,0.5);">▶ BẤM ĐỂ PHÁT</button>
        </div>

        <div class="control-panel">
            <div class="input-group">
                <input type="text" id="stream-url-input" value="{stream_target}" placeholder="Dán link .m3u8 vào đây để phát qua proxy...">
                <button onclick="loadCustomStream()">Phát Ngay</button>
            </div>

            <div class="info-grid">
                <div class="info-card">
                    <b>Định dạng & Codec phát hiện</b>
                    <span id="format-info">4K HEVC (2160p) • 5 Tracks Audio (Thuyết Minh VIE + ENG 5.1)</span>
                </div>
                <div class="info-card">
                    <b>Link Proxy Đang Phát</b>
                    <div class="url-box"><a id="proxy-link" href="{proxy_url}" target="_blank" style="color:#38bdf8;">{proxy_url}</a></div>
                </div>
            </div>

            <div id="log-box">
                [System] Sẵn sàng phát luồng video 4K... 100% chunk TikTok CDN đều chạy qua VPS.<br>
            </div>
        </div>
    </div>

    <script>
        const logBox = document.getElementById('log-box');
        function addLog(msg) {{
            const d = new Date().toLocaleTimeString();
            logBox.innerHTML = `[${{d}}] ${{msg}}<br>` + logBox.innerHTML;
        }}

        let playerInstance = null;

        async function initPlayer(m3u8ProxyUrl) {{
            if (playerInstance) {{
                try {{
                    addLog('Đang nạp luồng mới...');
                    await playerInstance.load(m3u8ProxyUrl);
                    addLog('✅ Tải luồng thành công! Đang phát 4K...');
                }} catch (e) {{
                    addLog('❌ Lỗi tải luồng: ' + e.message);
                }}
                return;
            }}

            shaka.polyfill.installAll();
            if (!shaka.Player.isBrowserSupported()) {{
                alert('Trình duyệt của bạn không hỗ trợ giải mã HEVC 4K Shaka Player.');
                return;
            }}

            const video = document.getElementById('video');
            const container = document.querySelector('[data-shaka-player-container]');
            
            let player = null;
            if (video['ui']) {{
                player = video['ui'].getControls().getPlayer();
            }} else if (window.shaka && shaka.ui && shaka.ui.Overlay) {{
                player = new shaka.Player(video);
                new shaka.ui.Overlay(player, container, video);
            }} else {{
                player = new shaka.Player(video);
            }}
            window.playerInstance = player;
            playerInstance = player;

            player.configure({{
                streaming: {{
                    bufferingGoal: 60,
                    rebufferingGoal: 6,
                    bufferBehind: 30,
                    segmentPrefetchLimit: 2,
                    gapDetectionThreshold: 0.1,
                    gapJumpTimerTime: 0.25,
                    stallEnabled: true,
                    stallThreshold: 1,
                    stallSkip: 0.1,
                    startAtSegmentBoundary: false,
                    safeSeekOffset: 0.2,
                    retryParameters: {{ maxAttempts: 5, baseDelay: 1000, timeout: 300000 }}
                }}
            }});

            video.addEventListener('loadedmetadata', () => {{
                addLog('Đã nhận metadata video (3840x2160). Bắt đầu nạp chunk...');
            }});

            video.addEventListener('loadeddata', () => {{
                addLog('Đã nhận frame đầu tiên! Bỏ qua lệch timeline 0.15s...');
                if (video.currentTime < 0.15) {{
                    video.currentTime = 0.15;
                }}
            }});

            video.addEventListener('canplay', () => {{
                addLog('▶️ Video sẵn sàng phát! Đang tự động phát...');
                video.play().catch(e => console.log('Autoplay:', e));
            }});

            video.addEventListener('playing', () => {{
                addLog('🎉 VIDEO ĐANG PHÁT 4K!');
                const btn = document.getElementById('play-overlay-btn');
                if (btn) btn.style.display = 'none';
            }});

            video.addEventListener('waiting', () => {{
                addLog('⏳ Đang nạp tiếp chunk video 4K Remux...');
            }});

            player.getNetworkingEngine().registerResponseFilter((type, response) => {{
                if (response.data) {{
                    const u8 = new Uint8Array(response.data);
                    if (u8.length > 67 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {{
                        console.log('Stripping 67-byte PNG header client-side...');
                        response.data = u8.slice(67).buffer;
                    }}
                }}
            }});

            player.addEventListener('error', (event) => {{
                console.error('Shaka Error:', event.detail);
                addLog('⚠️ Lỗi Player: ' + (event.detail ? (event.detail.message || JSON.stringify(event.detail)) : 'Unknown'));
            }});

            player.addEventListener('adaptation', () => {{
                const tracks = player.getVariantTracks();
                const active = tracks.find(t => t.active);
                if (active) {{
                    document.getElementById('format-info').innerText = `${{active.width}}x${{active.height}} (${{active.videoCodec}}) • Audio: ${{active.audioCodec}}`;
                    addLog(`Resolution: ${{active.width}}x${{active.height}} @ ${{Math.round(active.bandwidth/1000)}} kbps`);
                }}
            }});

            try {{
                addLog('Đang tải luồng M3U8 từ proxy VPS...');
                await player.load(m3u8ProxyUrl);
                addLog('✅ Tải luồng thành công! Bắt đầu phát...');
                video.play().catch(e => {{
                    console.log('Autoplay blocked:', e);
                    const btn = document.getElementById('play-overlay-btn');
                    if (btn) btn.style.display = 'block';
                }});
            }} catch (e) {{
                addLog('❌ Không thể tải luồng: ' + e.message);
            }}
        }}

        function loadCustomStream() {{
            const rawUrl = document.getElementById('stream-url-input').value.trim();
            if (!rawUrl) return;
            const currentOrigin = window.location.origin;
            const newProxy = `${{currentOrigin}}/?url=${{encodeURIComponent(rawUrl)}}`;
            document.getElementById('proxy-link').href = newProxy;
            document.getElementById('proxy-link').innerText = newProxy;
            initPlayer(newProxy);
        }}

        let hasInited = false;
        function autoStart() {{
            if (hasInited) return;
            hasInited = true;
            initPlayer('{proxy_url}');
        }}

        document.addEventListener('shaka-ui-loaded', autoStart);
        document.addEventListener('DOMContentLoaded', () => {{ setTimeout(autoStart, 300); }});
        window.addEventListener('load', () => {{ setTimeout(autoStart, 300); }});
    </script>
</body>
</html>"""

@app.api_route("/", methods=["GET", "HEAD", "OPTIONS"])
@app.api_route("/player", methods=["GET", "HEAD", "OPTIONS"])
@app.api_route("/proxy", methods=["GET", "HEAD", "OPTIONS"])
async def proxy_stream(
    request: Request,
    url: str = Query(None, description="Target stream URL"),
    player: bool = Query(False, description="Render HTML5 Player preview")
):
    if request.method == "OPTIONS":
        return Response(status_code=204, headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        })

    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", request.url.netloc))
    proxy_base = f"{scheme}://{host}/"

    # If no URL or player preview requested, return player page (or 200 for HEAD)
    if not url or player or request.url.path == "/player":
        if request.method == "HEAD":
            return Response(status_code=200, headers={"Content-Type": "text/html; charset=utf-8"})
        target = url or DEFAULT_STREAM
        active_proxy_stream = f"{proxy_base}?url={quote(target, safe='')}"
        return HTMLResponse(render_player_page(target, active_proxy_stream))

    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    upstream_headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": f"{origin}/",
        "Origin": origin,
        "Accept": "*/*"
    }

    if "range" in request.headers:
        upstream_headers["Range"] = request.headers["range"]

    is_tiktok_chunk = ("tiktokcdn.com" in url or ".image" in url)

    if is_tiktok_chunk:
        url_clean = url.split("?")[0]
        cache_key = hashlib.md5(url_clean.encode()).hexdigest()
        cache_file = CACHE_DIR / f"{cache_key}.mp4"

        # Tự động tải trước (prefetch) các chunk tiếp theo ở chế độ nền
        if url in _next_segment_map:
            for next_seg in _next_segment_map[url]:
                asyncio.create_task(ensure_cached(next_seg))

        await ensure_cached(url)

        if not cache_file.exists():
            return Response(content="Chunk download failed", status_code=502)

        if "x-real-ip" in request.headers or "x-forwarded-for" in request.headers:
            return Response(
                headers={
                    "X-Accel-Redirect": f"/internal-cache/{cache_key}.mp4",
                    "Content-Type": "video/mp4",
                    "Accept-Ranges": "bytes",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                    "Cache-Control": "public, max-age=86400"
                }
            )

        return FileResponse(
            cache_file,
            media_type="video/mp4",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Cache-Control": "public, max-age=86400"
            }
        )

    method = request.method if request.method in ["GET", "HEAD"] else "GET"

    try:
        req = client.build_request(method, url, headers=upstream_headers)
        resp = await client.send(req, stream=True)
    except Exception as e:
        return Response(content=f"Error connecting to upstream: {str(e)}", status_code=502)

    content_type = resp.headers.get("content-type", "").lower()
    is_m3u8 = (
        "mpegurl" in content_type or
        url.endswith(".m3u8") or
        url.endswith(".m3u") or
        "/hls/" in url
    )

    if is_m3u8 and method == "GET":
        body = await resp.aread()
        text = body.decode("utf-8", errors="ignore")

        if "#EXTM3U" in text:
            rewritten = rewrite_m3u8(text, url, proxy_base)
            return Response(
                content=rewritten,
                media_type="application/vnd.apple.mpegurl",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                    "Cache-Control": "no-cache"
                }
            )

    is_tiktok_chunk = ("tiktokcdn.com" in url or ".image" in url)

    # TikTok CDN disguises fMP4 segments as image/png. Override to video/mp4 so MediaSource decodes properly
    if is_tiktok_chunk:
        content_type = "video/mp4"

    response_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Accept-Ranges": "bytes"
    }
    for h in ["last-modified", "etag"]:
        if h in resp.headers:
            response_headers[h] = resp.headers[h]

    strip_header = False
    if is_tiktok_chunk and resp.status_code in [200, 206]:
        strip_header = True
        if "content-length" in resp.headers:
            try:
                raw_len = int(resp.headers["content-length"])
                if raw_len > 67:
                    response_headers["content-length"] = str(raw_len - 67)
            except Exception:
                pass
        if "content-range" in resp.headers:
            cr = resp.headers["content-range"]
            match = re.match(r"bytes\s+(\d+)-(\d+)/(\d+)", cr)
            if match:
                s, e, t = int(match.group(1)), int(match.group(2)), int(match.group(3))
                if s == 0 and t > 67:
                    new_e = max(0, e - 67)
                    new_t = t - 67
                    response_headers["content-range"] = f"bytes 0-{new_e}/{new_t}"
            else:
                response_headers["content-range"] = cr
    else:
        if "content-length" in resp.headers:
            response_headers["content-length"] = resp.headers["content-length"]
        if "content-range" in resp.headers:
            response_headers["content-range"] = resp.headers["content-range"]

    response_headers["content-type"] = content_type or "video/mp4"

    if method == "HEAD":
        await resp.aclose()
        return Response(
            status_code=resp.status_code,
            headers=response_headers,
            media_type=content_type or "application/octet-stream"
        )

    async def byte_generator():
        first = True
        async for chunk in resp.aiter_bytes(chunk_size=1024 * 256):
            if first:
                first = False
                if len(chunk) > 67 and chunk[:8] == b"\x89PNG\r\n\x1a\n":
                    chunk = chunk[67:]
            yield chunk

    # Stream bytes smoothly in 256KB chunks
    return StreamingResponse(
        byte_generator(),
        status_code=resp.status_code,
        headers=response_headers,
        media_type=content_type or "application/octet-stream"
    )
