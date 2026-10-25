import time
import subprocess
import json
import os

TEST_CHUNK = "https://p16-ad-site-sign-sg.tiktokcdn.com/ad-site-i18n-sg/202608315d0d92070256ac054355903b~tplv-d5opwmad15-ttam-origin.image?lk3s=6d71dd51&x-expires=1819745989&x-signature=ba56vt3yQB04PqektPXAzJSwPeE%3D"
SSH_KEY_PATH = os.environ.get("SSH_KEY_PATH", "vps.pem")
SSH_HOST = os.environ.get("SSH_HOST", "ubuntu@161.118.202.252")
SSH_CMD = f"ssh -i {SSH_KEY_PATH} -o StrictHostKeyChecking=no {SSH_HOST}"
RANGE_BYTES = "0-10485759" # 10 Megabytes

def run_curl_benchmark(label, curl_cmd, rounds=3):
    print(f"[*] Testing: {label} ...", flush=True)
    speeds = []
    times = []
    
    for r in range(rounds):
        full_cmd = f"{curl_cmd} -s -o /dev/null -w '%{{time_total}} %{{speed_download}} %{{http_code}}' -r {RANGE_BYTES}"
        try:
            out = subprocess.check_output(full_cmd, shell=True, timeout=30).decode().strip()
            parts = out.split()
            if len(parts) >= 3:
                time_s = float(parts[0])
                speed_b_s = float(parts[1])
                code = parts[2]
                speed_mb_s = speed_b_s / (1024 * 1024)
                speeds.append(speed_mb_s)
                times.append(time_s)
                print(f"    Round {r+1}: {speed_mb_s:.2f} MB/s ({speed_mb_s*8:.1f} Mbps) in {time_s:.2f}s [HTTP {code}]", flush=True)
            else:
                print(f"    Round {r+1}: Invalid output: {out}")
        except subprocess.TimeoutExpired:
            print(f"    Round {r+1}: TIMEOUT (>30s)")
        except Exception as e:
            print(f"    Round {r+1}: Error {e}")
        time.sleep(0.5)

    avg_speed = sum(speeds) / len(speeds) if speeds else 0
    avg_time = sum(times) / len(times) if times else 0
    return {
        "label": label,
        "avg_speed_mb_s": round(avg_speed, 2),
        "avg_speed_mbps": round(avg_speed * 8, 1),
        "avg_time_s": round(avg_time, 2)
    }

benchmarks = []

# 1. film4k (TikTok CDN) -> VPS Singapore
cmd_vps = f"{SSH_CMD} \"curl -H 'Referer: https://film4k.net/' '{TEST_CHUNK}'\""
benchmarks.append(run_curl_benchmark("1. TikTok CDN -> VPS Singapore (Direct 1Gbps)", cmd_vps))

# 2. film4k (TikTok CDN) -> Local Mac (Trực tiếp từ nhà mạng VN)
cmd_direct = f"curl -H 'Referer: https://film4k.net/' '{TEST_CHUNK}'"
benchmarks.append(run_curl_benchmark("2. TikTok CDN -> Local Mac (Trực tiếp qua mạng VN)", cmd_direct))

# 3. film4k -> VPS (DNS Only / BBR / HTTP2 / Sendfile) -> Local Mac
cmd_vps_proxy = f"curl 'https://secret.dangducminh.io.vn/?url={subprocess.check_output(['python3', '-c', f'from urllib.parse import quote; print(quote(\"{TEST_CHUNK}\", safe=\"\"))']).decode().strip()}'"
benchmarks.append(run_curl_benchmark("3. VPS Proxy (BBR + HTTP/2 + Sendfile) -> Local Mac", cmd_vps_proxy))

# 4. film4k -> PHP Proxy dangducminh.io.vn -> Local Mac
cmd_php_proxy = f"curl 'https://dangducminh.io.vn/?url={subprocess.check_output(['python3', '-c', f'from urllib.parse import quote; print(quote(\"{TEST_CHUNK}\", safe=\"\"))']).decode().strip()}'"
benchmarks.append(run_curl_benchmark("4. PHP Proxy (dangducminh.io.vn 123HOST) -> Local Mac", cmd_php_proxy))

print("\n" + "=" * 80)
print(f"{'Đường truyền (Chặng test)':<48} | {'Tốc độ tải':<15} | {'Băng thông':<12}")
print("=" * 80)
for b in benchmarks:
    print(f"{b['label']:<48} | {b['avg_speed_mb_s']:>6.2f} MB/s    | {b['avg_speed_mbps']:>6.1f} Mbps")
print("=" * 80)
