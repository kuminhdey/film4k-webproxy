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

CACHE_DIR = Path("/home/ubuntu/stream-cache")
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
        max_bytes = 15 * 1024 * 1024 * 1024  # 15 GB
        target_bytes = 10 * 1024 * 1024 * 1024  # 10 GB
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

def rewrite_m3u8(content: str, source_url: str, proxy_base: str, keep_cdn: bool = False) -> str:
    base_dir = source_url.rsplit("/", 1)[0] + "/"
    lines = content.splitlines()
    new_lines = []

    def replace_uri(match):
        rel = match.group(1)
        full_url = urljoin(base_dir, rel)
        if keep_cdn and ("tiktokcdn.com" in full_url or ".image" in full_url):
            return f'URI="{full_url}"'
        proxied = f"{proxy_base}?url={quote(full_url, safe='')}"
        if keep_cdn:
            proxied += "&keep_cdn=1"
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
            if keep_cdn and ("tiktokcdn.com" in full_url or ".image" in full_url):
                new_lines.append(full_url)
            else:
                proxied = f"{proxy_base}?url={quote(full_url, safe='')}"
                if keep_cdn:
                    proxied += "&keep_cdn=1"
                new_lines.append(proxied)

    if not keep_cdn:
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

def render_player_page(stream_target: str, proxy_url: str, keep_cdn: bool = True) -> str:
    is_keep_cdn_str = "true" if keep_cdn else "false"
    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8">
    <title>🎬 Mission: Impossible II 4K UHD — Film4k Player</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
    <style>
        :root {{
            --primary: #38bdf8;
            --primary-hover: #0284c7;
            --bg: #0b0f19;
            --card: #131b2e;
            --card-sub: #0f172a;
            --border: #1e293b;
            --text: #f8fafc;
            --muted: #94a3b8;
            --accent: #10b981;
            --accent-glow: rgba(16, 185, 129, 0.2);
            --danger: #ef4444;
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
        .wrapper {{ width: 100%; max-width: 1080px; }}
        
        header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 12px;
        }}
        h1 {{ font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 10px; }}
        .meta-badges {{ display: flex; gap: 8px; align-items: center; }}
        .badge {{
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }}
        .badge-domain {{
            background: rgba(56, 189, 248, 0.15);
            color: var(--primary);
            border: 1px solid rgba(56, 189, 248, 0.4);
        }}
        .badge-status {{
            background: var(--accent-glow);
            color: var(--accent);
            border: 1px solid var(--accent);
        }}
        .status-dot {{
            width: 8px; height: 8px;
            background: var(--accent);
            border-radius: 50%;
            box-shadow: 0 0 8px var(--accent);
        }}

        .hevc-warning {{
            display: none;
            background: rgba(234, 179, 8, 0.12);
            border: 1px solid rgba(234, 179, 8, 0.5);
            color: #fef08a;
            padding: 12px 16px;
            border-radius: 10px;
            margin-bottom: 16px;
            font-size: 13px;
            line-height: 1.5;
        }}

        /* Player Container */
        .player-container {{
            position: relative;
            width: 100%;
            aspect-ratio: 16/9;
            background: #000;
            border-radius: 14px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9), 0 0 0 1px var(--border);
        }}
        video {{ width: 100%; height: 100%; object-fit: contain; }}

        .overlay-center {{
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            z-index: 20;
            display: none;
        }}
        .btn-play-big {{
            background: linear-gradient(135deg, #0284c7, #0369a1);
            color: #fff;
            border: none;
            border-radius: 50px;
            padding: 14px 28px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 10px 25px -5px rgba(2, 132, 199, 0.5);
            transition: transform 0.2s;
        }}
        .btn-play-big:hover {{ transform: scale(1.05); }}

        /* Server & Track Selectors like Film4k */
        .selectors-section {{
            margin-top: 20px;
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }}
        .selector-row {{
            display: flex;
            flex-direction: column;
            gap: 8px;
        }}
        .selector-label {{
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--muted);
            display: flex;
            align-items: center;
            gap: 6px;
        }}
        .chip-group {{
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }}
        .chip {{
            background: var(--card-sub);
            border: 1px solid var(--border);
            color: var(--text);
            padding: 7px 15px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            display: inline-flex;
            align-items: center;
            gap: 6px;
            user-select: none;
        }}
        .chip:hover {{
            border-color: var(--primary);
            background: rgba(56, 189, 248, 0.08);
        }}
        .chip.on {{
            background: #0284c7;
            border-color: #38bdf8;
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
        }}
        .chip.disabled {{
            opacity: 0.5;
            cursor: not-allowed;
        }}

        /* Info Grid */
        .info-grid {{
            margin-top: 16px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 12px;
        }}
        .info-card {{
            background: var(--card-sub);
            padding: 12px 14px;
            border-radius: 8px;
            border: 1px solid var(--border);
            font-size: 13px;
        }}
        .info-card b {{
            color: var(--muted);
            display: block;
            margin-bottom: 4px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}

        /* Log Console */
        #log-box {{
            margin-top: 16px;
            background: #060911;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px 14px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 12px;
            color: #93c5fd;
            max-height: 150px;
            overflow-y: auto;
            line-height: 1.5;
        }}
    </style>
</head>
<body>
    <div class="wrapper">
        <header>
            <h1>🎬 Mission: Impossible II 4K UHD</h1>
            <div class="meta-badges">
                <span class="badge badge-domain">🌐 secret.dangducminh.io.vn</span>
                <span class="badge badge-status"><span class="status-dot"></span><span id="server-badge-text">⚡ TikTok CDN (Chuẩn Film4k)</span></span>
            </div>
        </header>

        <div id="hevc-notice" class="hevc-warning">
            ⚠️ <b>Lưu ý giải mã trên Windows:</b> Phim 4K HEVC Main 10 Remux. Nếu Chrome không phát được, vui lòng dùng <b>Microsoft Edge</b> hoặc mở <code>chrome://flags/#enable-platform-hevc</code> chọn <b>Enabled</b>.
        </div>

        <div class="player-container">
            <video id="video" controls autoplay playsinline></video>
            <div id="play-overlay" class="overlay-center">
                <button class="btn-play-big" onclick="startPlay()">▶ BẤM ĐỂ PHÁT</button>
            </div>
        </div>

        <div class="selectors-section">
            <!-- 1. CHỌN MÁY CHỦ / NGUỒN PHÁT (SERVERS) -->
            <div class="selector-row">
                <div class="selector-label">📡 Nguồn Phát / Server (Chuẩn Film4k)</div>
                <div class="chip-group" id="server-chips">
                    <button type="button" class="chip {'on' if keep_cdn else ''}" id="srv-btn-cdn" onclick="switchServerMode(true)">
                        ⚡ VIP 1 (TikTok CDN Trực Tiếp - keep_cdn=1)
                    </button>
                    <button type="button" class="chip {'' if keep_cdn else 'on'}" id="srv-btn-vps" onclick="switchServerMode(false)">
                        🛡️ VIP 2 (VPS Singapore Proxy - Remux BBR)
                    </button>
                </div>
            </div>

            <!-- 2. CHỌN ÂM THANH / THUYẾT MINH (AUDIO TRACKS) -->
            <div class="selector-row">
                <div class="selector-label">🔊 Lồng Tiếng / Thuyết Minh / Âm Thanh</div>
                <div class="chip-group" id="audio-chips">
                    <span style="font-size:12px;color:var(--muted);">Đang phân tích danh sách âm thanh từ luồng...</span>
                </div>
            </div>

            <!-- 3. CHỌN ĐỘ PHÂN GIẢI (QUALITY LEVELS) -->
            <div class="selector-row">
                <div class="selector-label">📺 Chất Lượng Video</div>
                <div class="chip-group" id="quality-chips">
                    <button type="button" class="chip on">Auto (3840x2160 - 4K UHD)</button>
                </div>
            </div>

            <!-- INFO METRICS -->
            <div class="info-grid">
                <div class="info-card">
                    <b>Trạng Thái Bộ Giải Mã</b>
                    <span id="player-status">Đang khởi tạo Hls.js...</span>
                </div>
                <div class="info-card">
                    <b>Độ Phân Giải & Codec</b>
                    <span id="format-info">3840x2160 (HEVC 10-bit) • E-AC-3 / AAC</span>
                </div>
                <div class="info-card">
                    <b>Tốc Độ Tải Chunk Hiện Tại</b>
                    <span id="speed-info">Đang chờ chunk đầu tiên...</span>
                </div>
            </div>

            <!-- LOG BOX -->
            <div id="log-box"></div>
        </div>
    </div>

    <script>
        const logBox = document.getElementById('log-box');
        function addLog(msg) {{
            console.log(msg);
            const line = document.createElement('div');
            line.textContent = `[${{new Date().toLocaleTimeString()}}] ${{msg}}`;
            logBox.appendChild(line);
            logBox.scrollTop = logBox.scrollHeight;
        }}

        // ==========================================
        // 1. FILM4K EXACT PNG HEADER STRIPPER U(e)
        // ==========================================
        const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

        function stripPngHeader(e) {{
            if (!e) return e;
            let t = new Uint8Array(e);
            if (t.length < PNG_SIG.length) return e;
            for (let idx = 0; idx < PNG_SIG.length; idx++) {{
                if (t[idx] !== PNG_SIG[idx]) return e;
            }}
            let n = new DataView(e), r = PNG_SIG.length;
            while (r + 12 <= t.length) {{
                let i = n.getUint32(r, false);
                let a = r + 12 + i;
                if (a > t.length) return e;
                // Ký tự IEND: 73, 69, 78, 68
                if (t[r + 4] === 73 && t[r + 5] === 69 && t[r + 6] === 78 && t[r + 7] === 68) {{
                    return e.slice(a);
                }}
                r = a;
            }}
            return e;
        }}

        function extractCleanBuffer(data) {{
            if (data instanceof ArrayBuffer) {{
                return stripPngHeader(data);
            }}
            if (ArrayBuffer.isView(data)) {{
                let rawBuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                return stripPngHeader(rawBuf);
            }}
            return data;
        }}

        // ==========================================
        // 2. FILM4K CUSTOM FRAGMENT LOADER (Ce)
        // ==========================================
        class Film4kFragmentLoader extends Hls.DefaultConfig.loader {{
            constructor(config) {{
                super(config);
                const originalLoad = this.load.bind(this);
                this.load = function (context, config, callbacks) {{
                    const isCdn = context.url && context.url.includes("tiktokcdn.com");
                    const type = context.frag ? context.frag.type : 'frag';
                    const startTime = performance.now();
                    
                    const customCallbacks = {{
                        ...callbacks,
                        onProgress: function (stats, ctx, data, networkDetails) {{
                            if (stats && stats.loaded) {{
                                const mb = (stats.loaded / (1024 * 1024)).toFixed(1);
                                const totalMb = stats.total ? (stats.total / (1024 * 1024)).toFixed(1) : '139.7';
                                const elapsed = Math.max(0.1, (performance.now() - startTime) / 1000);
                                const curMbps = ((stats.loaded * 8) / (elapsed * 1024 * 1024)).toFixed(1);
                                const pct = stats.total ? Math.round((stats.loaded / stats.total) * 100) : 0;
                                const pctStr = pct > 0 ? ` (${{pct}}%)` : '';
                                document.getElementById('speed-info').innerText = `⏳ Đang tải ${{mb}}/${{totalMb}} MB${{pctStr}} • ${{curMbps}} Mbps • ${{isCdn ? "TikTok CDN" : "Proxy"}}`;
                            }}
                            if (callbacks.onProgress) callbacks.onProgress(stats, ctx, data, networkDetails);
                        }},
                        onSuccess: function (response, stats, ctx, networkDetails) {{
                            if (response && response.data) {{
                                response.data = extractCleanBuffer(response.data);
                            }}
                            const mb = response.data ? (response.data.byteLength / (1024 * 1024)).toFixed(2) : 0;
                            const elapsedSec = Math.max(0.1, (performance.now() - startTime) / 1000);
                            const speedMbps = ((parseFloat(mb) * 8) / elapsedSec).toFixed(1);
                            
                            document.getElementById('speed-info').innerText = `⚡ ${{mb}} MB (${{elapsedSec.toFixed(1)}}s) • ${{speedMbps}} Mbps • ${{isCdn ? "TikTok CDN" : "Proxy"}}`;
                            addLog(`📥 Nạp xong [${{type}}]: ${{mb}} MB (${{speedMbps}} Mbps) từ ${{isCdn ? "TikTok CDN" : "VPS Proxy"}}`);
                            
                            callbacks.onSuccess(response, stats, ctx, networkDetails);
                        }},
                        onError: function (err, ctx, networkDetails, stats) {{
                            addLog(`❌ Lỗi tải chunk: ${{err ? err.message : JSON.stringify(err)}}`);
                            if (callbacks.onError) callbacks.onError(err, ctx, networkDetails, stats);
                        }}
                    }};

                    originalLoad(context, config, customCallbacks);
                }};
            }}
        }}

        // ==========================================
        // 3. MASTER STREAMS & SERVER LOGIC
        // ==========================================
        const BASE_STREAM = "{stream_target}";
        let isKeepCdn = {is_keep_cdn_str};
        let hlsInstance = null;
        let savedPosition = 0;

        function getProxyUrl(targetStream, keepCdn) {{
            const encoded = encodeURIComponent(targetStream);
            const cdnParam = keepCdn ? "&keep_cdn=1" : "";
            return `https://secret.dangducminh.io.vn/?url=${{encoded}}${{cdnParam}}`;
        }}

        function switchServerMode(useCdn) {{
            if (isKeepCdn === useCdn) {{
                addLog(`ℹ️ Đang chạy sẵn trên: ${{useCdn ? "⚡ VIP 1 (TikTok CDN Trực Tiếp)" : "🛡️ VIP 2 (VPS Singapore Proxy)"}}`);
                return;
            }}
            const video = document.getElementById('video');
            if (video && Number.isFinite(video.currentTime)) {{
                savedPosition = video.currentTime;
            }}
            isKeepCdn = useCdn;
            document.getElementById('srv-btn-cdn').className = isKeepCdn ? 'chip on' : 'chip';
            document.getElementById('srv-btn-vps').className = !isKeepCdn ? 'chip on' : 'chip';
            const badge = document.getElementById('server-badge-text');
            if (badge) badge.innerText = isKeepCdn ? '⚡ TikTok CDN (Chuẩn Film4k)' : '🛡️ VPS Singapore Proxy';
            addLog(`🔄 Đang chuyển server sang: ${{isKeepCdn ? "⚡ VIP 1 (TikTok CDN Trực Tiếp)" : "🛡️ VIP 2 (VPS Singapore Proxy)"}} (vị trí ${{savedPosition.toFixed(1)}}s)...`);
            initPlayer(getProxyUrl(BASE_STREAM, isKeepCdn));
        }}

        function renderAudioTracks(tracks, currentIdx) {{
            const container = document.getElementById('audio-chips');
            container.innerHTML = '';
            if (!tracks || tracks.length === 0) {{
                container.innerHTML = '<span style="font-size:12px;color:var(--muted);">Mặc định (Stereo / 5.1)</span>';
                return;
            }}

            tracks.forEach((track, index) => {{
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `chip ${{index === currentIdx ? 'on' : ''}}`;
                
                // Gắn icon cờ cho ngôn ngữ
                let langFlag = '🇬🇧';
                let trackName = track.name || track.lang || `Track ${{index+1}}`;
                if (track.lang === 'vie' || trackName.toLowerCase().includes('vi') || trackName.toLowerCase().includes('thuyết minh')) {{
                    langFlag = '🇻🇳';
                }}
                
                btn.innerHTML = `${{langFlag}} ${{trackName}}`;
                btn.onclick = () => {{
                    const inst = window.hlsInstance;
                    if (inst) {{
                        addLog(`🔊 Đổi sang luồng âm thanh: [${{langFlag}} ${{trackName}}] (Track #${{index}})`);
                        inst.audioTrack = index;
                        renderAudioTracks(tracks, index);
                    }} else {{
                        addLog("⚠️ Trình phát HLS chưa sẵn sàng");
                    }}
                }};
                container.appendChild(btn);
            }});
        }}

        function renderQualityLevels(levels, currentIdx) {{
            const container = document.getElementById('quality-chips');
            container.innerHTML = '';
            
            // Nút Auto
            const autoBtn = document.createElement('button');
            autoBtn.type = 'button';
            autoBtn.className = `chip ${{currentIdx === -1 ? 'on' : ''}}`;
            autoBtn.innerText = 'Tự Động (Auto 4K)';
            autoBtn.onclick = () => {{
                const inst = window.hlsInstance;
                if (inst) {{
                    addLog('📺 Đổi chất lượng video sang: Tự Động (Auto 4K)');
                    inst.currentLevel = -1;
                    renderQualityLevels(levels, -1);
                }}
            }};
            container.appendChild(autoBtn);

            levels.forEach((level, index) => {{
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `chip ${{index === currentIdx ? 'on' : ''}}`;
                const resLabel = level.height ? `${{level.width}}x${{level.height}} (4K UHD)` : `Level ${{index+1}}`;
                btn.innerText = resLabel;
                btn.onclick = () => {{
                    const inst = window.hlsInstance;
                    if (inst) {{
                        addLog(`📺 Đổi chất lượng video sang: ${{resLabel}}`);
                        inst.currentLevel = index;
                        renderQualityLevels(levels, index);
                    }}
                }};
                container.appendChild(btn);
            }});
        }}

        function startPlay() {{
            const video = document.getElementById('video');
            video.play().then(() => {{
                document.getElementById('play-overlay').style.display = 'none';
            }}).catch(e => console.log('Play:', e));
        }}

        // ==========================================
        // 4. HLS.JS INITIALIZATION
        // ==========================================
        function initPlayer(m3u8Url) {{
            const video = document.getElementById('video');
            document.getElementById('player-status').innerText = 'Đang nạp Hls.js...';

            if (window.hlsInstance) {{
                window.hlsInstance.destroy();
                window.hlsInstance = null;
            }}

            if (window.MediaSource && !MediaSource.isTypeSupported('video/mp4; codecs="hev1.2.4.L153.B0"') && !MediaSource.isTypeSupported('video/mp4; codecs="hvc1.2.4.L153.B0"')) {{
                document.getElementById('hevc-notice').style.display = 'block';
            }}

            if (!Hls.isSupported()) {{
                if (video.canPlayType('application/vnd.apple.mpegurl')) {{
                    video.src = m3u8Url;
                    video.addEventListener('loadedmetadata', () => video.play());
                    document.getElementById('player-status').innerText = 'Apple Native HLS';
                    return;
                }}
                alert('Trình duyệt không hỗ trợ Hls.js MSE!');
                return;
            }}

            const hls = new Hls({{
                fLoader: Film4kFragmentLoader,
                enableWorker: true,
                lowLatencyMode: false,
                progressive: false,
                backBufferLength: 90,
                maxBufferLength: 60,
                maxMaxBufferLength: 120,
                maxBufferSize: 600 * 1024 * 1024,
                fragLoadingTimeOut: 120000,
                fragLoadingMaxRetry: 6,
                fragLoadingRetryDelay: 1000,
                levelLoadingTimeOut: 30000,
                manifestLoadingTimeOut: 30000,
                autoStartLoad: true
            }});
            window.hlsInstance = hls;

            hls.loadSource(m3u8Url);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {{
                document.getElementById('player-status').innerText = `✅ Đã nhận Manifest (${{data.levels.length}} streams)`;
                addLog(`✅ Master M3U8 sẵn sàng! Render danh sách chất lượng video...`);
                renderQualityLevels(data.levels, hls.currentLevel);

                if (savedPosition > 0) {{
                    addLog(`⏩ Khôi phục vị trí xem dở: ${{savedPosition.toFixed(1)}}s`);
                    video.currentTime = savedPosition;
                }}

                video.play().catch(e => {{
                    document.getElementById('play-overlay').style.display = 'block';
                }});
            }});

            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (event, data) => {{
                addLog(`🎵 Tìm thấy ${{data.audioTracks.length}} luồng âm thanh/thuyết minh. Đang hiển thị lựa chọn...`);
                renderAudioTracks(data.audioTracks, hls.audioTrack);
            }});

            hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {{
                addLog(`📋 Đã tải danh sách phân đoạn (${{data.details.fragments.length}} chunks)`);
            }});

            hls.on(Hls.Events.BUFFER_APPENDED, (event, data) => {{
                const bufferedSec = video.buffered.length > 0 ? (video.buffered.end(0) - video.buffered.start(0)).toFixed(1) : 0;
                document.getElementById('player-status').innerText = `🎉 Đang phát 4K • Bộ đệm: ${{bufferedSec}}s`;
            }});

            hls.on(Hls.Events.ERROR, (event, data) => {{
                if (data.fatal) {{
                    addLog(`❌ Lỗi HLS Fatal: ${{data.type}} - ${{data.details}}`);
                    switch (data.type) {{
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            addLog("Đang kết nối lại mạng...");
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            addLog("Đang phục hồi MediaSource demuxer...");
                            hls.recoverMediaError();
                            break;
                        default:
                            hls.destroy();
                            break;
                    }}
                }}
            }});

            video.addEventListener('playing', () => {{
                document.getElementById('player-status').innerText = '🎉 ĐANG PHÁT 4K TRỰC TIẾP!';
                document.getElementById('play-overlay').style.display = 'none';
            }});

            video.addEventListener('waiting', () => {{
                document.getElementById('player-status').innerText = '⏳ Đang tải tiếp phân đoạn 4K...';
            }});
        }}

        // Tự động khởi động luồng đầu tiên
        initPlayer(getProxyUrl(BASE_STREAM, isKeepCdn));
    </script>
</body>
</html>
"""

@app.api_route("/", methods=["GET", "HEAD", "OPTIONS"])
@app.api_route("/player", methods=["GET", "HEAD", "OPTIONS"])
@app.api_route("/proxy", methods=["GET", "HEAD", "OPTIONS"])
async def proxy_stream(
    request: Request,
    url: str = Query(None, description="Target stream URL"),
    player: bool = Query(False, description="Render HTML5 Player preview"),
    keep_cdn: bool = Query(True, description="Keep original TikTok CDN URLs in playlists")
):
    if request.method == "OPTIONS":
        return Response(status_code=204, headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        })

    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", request.url.netloc))
    if "161.118.202.252" in host:
        proxy_base = f"{scheme}://{host}/stream/"
    else:
        proxy_base = f"{scheme}://{host}/"

    # If no URL or player preview requested, return player page (or 200 for HEAD)
    if not url or player or request.url.path == "/player":
        if request.method == "HEAD":
            return Response(status_code=200, headers={"Content-Type": "text/html; charset=utf-8"})
        target = url or DEFAULT_STREAM
        cdn_arg = "&keep_cdn=1" if keep_cdn else ""
        active_proxy_stream = f"{proxy_base}?url={quote(target, safe='')}{cdn_arg}"
        return HTMLResponse(render_player_page(target, active_proxy_stream, keep_cdn=keep_cdn))

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
            rewritten = rewrite_m3u8(text, url, proxy_base, keep_cdn=keep_cdn)
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
