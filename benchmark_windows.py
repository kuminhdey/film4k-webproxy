import time
import urllib.request
import ssl
import concurrent.futures
from urllib.parse import quote

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

CHUNK_URL = "https://p16-ad-site-sign-sg.tiktokcdn.com/ad-site-i18n-sg/202608315d0d92070256ac054355903b~tplv-d5opwmad15-ttam-origin.image?lk3s=6d71dd51&x-expires=1819745989&x-signature=ba56vt3yQB04PqektPXAzJSwPeE%3D"

targets = [
    {
        "name": "1. VPS Singapore (secret.dangducminh.io.vn - BBR + Zero-Copy)",
        "url": f"https://secret.dangducminh.io.vn/?url={quote(CHUNK_URL, safe='')}",
        "headers": {}
    },
    {
        "name": "2. Proxy PHP (dangducminh.io.vn - Cloudflare + 123HOST)",
        "url": f"https://dangducminh.io.vn/?url={quote(CHUNK_URL, safe='')}",
        "headers": {}
    },
    {
        "name": "3. TikTok CDN Gốc (Direct từ máy về CDN Singapore)",
        "url": CHUNK_URL,
        "headers": {
            "Referer": "https://film4k.net/",
            "Origin": "https://film4k.net"
        }
    }
]

print("=" * 82)
print("     BENCHMARK TỐC ĐỘ STREAM VIDEO 4K TRÊN WINDOWS (VPS SING vs PROXY PHP)")
print("=" * 82)

test_bytes = 10 * 1024 * 1024 # 10MB
results = []

for t in targets:
    print(f"\n-> Đang kiểm tra: {t['name']}...")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0",
        "Range": f"bytes=0-{test_bytes - 1}"
    }
    headers.update(t["headers"])
    req = urllib.request.Request(t["url"], headers=headers)
    
    try:
        t0 = time.time()
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=30) as resp:
            data = resp.read()
        dt = time.time() - t0
        size_mb = len(data) / (1024 * 1024)
        speed_mb = size_mb / dt
        mbps = speed_mb * 8
        
        is_fake_png = len(data) >= 4 and data[:4] == b"\x89PNG"
        format_type = "Fake PNG (Chưa cắt header)" if is_fake_png else "fMP4 (Đã cắt header)"
        
        print(f"   => Đã tải: {size_mb:.2f} MB trong {dt:.2f}s | Tốc độ: {speed_mb:.2f} MB/s ({mbps:.1f} Mbps)")
        print(f"   => Định dạng: {format_type}")
        results.append((t["name"].split("(")[0].strip(), f"{dt:.2f}s", f"{speed_mb:.2f} MB/s", f"{mbps:.1f} Mbps", format_type))
    except Exception as e:
        print(f"   => LỖI: {e}")
        results.append((t["name"].split("(")[0].strip(), "Lỗi", "0 MB/s", "0 Mbps", "Lỗi kết nối"))

print("\n" + "=" * 82)
print(f"{'Nguồn Tải':<22} | {'Thời gian':<10} | {'Tốc độ':<10} | {'Băng thông':<12} | {'Định dạng'}")
print("-" * 82)
for r in results:
    print(f"{r[0]:<22} | {r[1]:<10} | {r[2]:<10} | {r[3]:<12} | {r[4]}")
print("=" * 82)
print("📌 LƯU Ý KỸ THUẬT:")
print("1. Phim 4K UHD Remux có bitrate ~68.4 Mbps (~8.55 MB/s). Để xem mượt cần tối thiểu > 70 Mbps.")
print("2. Proxy PHP: Trả về Fake PNG nên trình duyệt không giải mã được video.")
print("3. VPS Sing: Cắt header chuẩn fMP4 nhưng luồng quốc tế về VN bị nghẽn (~7-8 Mbps).")
print("=" * 82)
