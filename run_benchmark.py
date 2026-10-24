import time
import urllib.request
import urllib.parse
import ssl
import statistics

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

headers_browser = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
}

film4k_m3u8 = "https://film4k.net/api/hls/24BQ7QxQ3ruqdnZ65oGApWupWAQk4dPebf5bnNjsSY-h9UiRlEgiHX12KUYK1zsgXLcjPHHHqL-hCgyhdcr358NE8YpeVzX1zcQdvpJMwIkpjh3JXnB9jA/master.m3u8"
tiktok_chunk = "https://p16-ad-site-sign-sg.tiktokcdn.com/ad-site-i18n-sg/202608315d0d92070256ac054355903b~tplv-d5opwmad15-ttam-origin.image?lk3s=6d71dd51&x-expires=1819745989&x-signature=ba56vt3yQB04PqektPXAzJSwPeE%3D"
motchill_page = "https://motchillkc.net/phim/chuyen-tinh-rung-cam/tap-1-vietsub-4824"

# Proxy Endpoints
vps_proxy = "http://161.118.202.252/stream/?url="
host123_proxy = "https://dangducminh.io.vn/?url="
host123_tunnel = "https://dangducminh.io.vn/tunnel.php?key=minh1998_vn_proxy&url="

def bench_url(name, url, range_bytes=None, rounds=2):
    durations = []
    sizes = []
    codes = []
    
    headers = dict(headers_browser)
    if range_bytes:
        headers["Range"] = f"bytes={range_bytes}"
        
    for r in range(rounds):
        t0 = time.time()
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, context=ctx, timeout=8) as response:
                content = response.read(5 * 1024 * 1024) # read up to 5MB
                dt = (time.time() - t0) * 1000
                durations.append(dt)
                sizes.append(len(content))
                codes.append(response.status)
        except urllib.error.HTTPError as e:
            dt = (time.time() - t0) * 1000
            durations.append(dt)
            sizes.append(0)
            codes.append(f"HTTP {e.code}")
        except Exception as e:
            dt = (time.time() - t0) * 1000
            durations.append(dt)
            sizes.append(0)
            codes.append(str(e)[:30])
        time.sleep(0.2)
        
    avg_dt = statistics.mean(durations) if durations else 0
    avg_size = statistics.mean(sizes) if sizes else 0
    status_str = str(codes[0]) if codes else "N/A"
    speed_mb = (avg_size / (1024 * 1024)) / (avg_dt / 1000) if avg_dt > 0 and avg_size > 0 else 0
    return {
        "name": name,
        "avg_ms": round(avg_dt, 1),
        "size_kb": round(avg_size / 1024, 1),
        "speed_mb_s": round(speed_mb, 2),
        "status": status_str
    }

print("=" * 80)
print("🏁 ĐANG BẮT ĐẦU CHẠY BENCHMARK SO SÁNH GIỮA CÁC MÁY CHỦ")
print("=" * 80)

tests = [
    # 1. Film4k M3U8 Playlist
    ("Film4k Master M3U8 | Direct (Local Mac)", film4k_m3u8, None),
    ("Film4k Master M3U8 | VPS Singapore (161)", f"{vps_proxy}{film4k_m3u8}", None),
    ("Film4k Master M3U8 | 123HOST TP.HCM (dangducminh)", f"{host123_proxy}{urllib.parse.quote(film4k_m3u8, safe='')}", None),
    ("Film4k Master M3U8 | 123HOST Tunnel", f"{host123_tunnel}{urllib.parse.quote(film4k_m3u8, safe='')}", None),

    # 2. Motchill Page
    ("Motchill Page | Direct (Local Mac)", motchill_page, None),
    ("Motchill Page | VPS Singapore (161)", f"{vps_proxy}{motchill_page}", None),
    ("Motchill Page | 123HOST TP.HCM", f"{host123_proxy}{urllib.parse.quote(motchill_page, safe='')}", None),

    # 3. TikTok CDN Video Chunk (Download 3MB)
    ("TikTok 3MB Chunk | Direct CDN", tiktok_chunk, "0-3145727"),
    ("TikTok 3MB Chunk | VPS Singapore (161)", f"{vps_proxy}{tiktok_chunk}", "0-3145727"),
    ("TikTok 3MB Chunk | 123HOST TP.HCM", f"{host123_proxy}{urllib.parse.quote(tiktok_chunk, safe='')}", "0-3145727"),
]

results = []
for test_name, u, rng in tests:
    print(f"-> Testing: {test_name} ...", flush=True)
    res = bench_url(test_name, u, range_bytes=rng, rounds=2)
    results.append(res)
    print(f"   KQ: {res['status']} | Latency: {res['avg_ms']} ms | Size: {res['size_kb']} KB | Speed: {res['speed_mb_s']} MB/s")

print("\n" + "=" * 80)
print(f"{'Mục Test':<44} | {'Status':<10} | {'Latency':<10} | {'Tốc độ':<10}")
print("-" * 80)
for r in results:
    print(f"{r['name']:<44} | {str(r['status']):<10} | {str(r['avg_ms']) + ' ms':<10} | {str(r['speed_mb_s']) + ' MB/s':<10}")
print("=" * 80)
