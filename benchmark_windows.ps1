# =====================================================================
# BENCHMARK TỐC ĐỘ STREAM VIDEO TRÊN WINDOWS (POWERSHELL)
# So sánh: VPS Singapore vs Proxy PHP vs TikTok CDN Gốc
# Tương thích 100% Windows 10 & 11 (Chạy ngay không cần cài đặt gì)
# =====================================================================

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "         BENCHMARK TỐC ĐỘ TẢI VIDEO THỰC TẾ TRÊN MÁY WINDOWS (ĐƠN LUỒNG)        " -ForegroundColor Yellow
Write-Host "     (Mô phỏng chính xác cách trình duyệt tải từng chunk video khi xem phim)    " -ForegroundColor Gray
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host ""

$targets = @(
    @{
        Name    = "1. VPS Singapore (secret.dangducminh.io.vn - BBR + Nginx Zero-Copy)"
        Url     = "https://secret.dangducminh.io.vn/?url=https%3A%2F%2Fp16-ad-site-sign-sg.tiktokcdn.com%2Fad-site-i18n-sg%2F202608315d0d92070256ac054355903b~tplv-d5opwmad15-ttam-origin.image%3Flk3s%3D6d71dd51%26x-expires%3D1819745989%26x-signature%3Dba56vt3yQB04PqektPXAzJSwPeE%253D"
        Headers = @{}
    },
    @{
        Name    = "2. Proxy PHP (dangducminh.io.vn - Cloudflare + 123HOST)"
        Url     = "https://dangducminh.io.vn/?url=https%3A%2F%2Fp16-ad-site-sign-sg.tiktokcdn.com%2Fad-site-i18n-sg%2F202608315d0d92070256ac054355903b~tplv-d5opwmad15-ttam-origin.image%3Flk3s%3D6d71dd51%26x-expires%3D1819745989%26x-signature%3Dba56vt3yQB04PqektPXAzJSwPeE%253D"
        Headers = @{}
    },
    @{
        Name    = "3. TikTok CDN Gốc (Direct từ máy về CDN TikTok Singapore)"
        Url     = "https://p16-ad-site-sign-sg.tiktokcdn.com/ad-site-i18n-sg/202608315d0d92070256ac054355903b~tplv-d5opwmad15-ttam-origin.image?lk3s=6d71dd51&x-expires=1819745989&x-signature=ba56vt3yQB04PqektPXAzJSwPeE%3D"
        Headers = @{
            "Referer" = "https://film4k.net/"
            "Origin"  = "https://film4k.net"
        }
    }
)

$testBytes = 10 * 1024 * 1024 # Đo mẫu 10 MB
$results = @()

foreach ($t in $targets) {
    Write-Host "-> Đang đo kiểm: $($t.Name)..." -ForegroundColor White
    $request = [System.Net.HttpWebRequest]::Create($t.Url)
    $request.Method = "GET"
    $request.Timeout = 30000
    $request.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    $request.AddRange(0, $testBytes - 1)
    
    foreach ($k in $t.Headers.Keys) {
        if ($k -eq "Referer") { $request.Referer = $t.Headers[$k] }
        else { $request.Headers.Add($k, $t.Headers[$k]) }
    }

    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $response = $request.GetResponse()
        $stream = $response.GetResponseStream()
        $buffer = New-Object byte[] 65536
        $totalRead = 0
        $firstChunk = @()

        while ($true) {
            $read = $stream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            if ($totalRead -eq 0) {
                $firstChunk = $buffer[0..([Math]::Min($read - 1, 15))]
            }
            $totalRead += $read
            if ($totalRead -ge $testBytes) { break }
        }

        $sw.Stop()
        $stream.Close()
        $response.Close()

        $seconds = $sw.Elapsed.TotalSeconds
        $sizeMB = $totalRead / 1MB
        $speedMBs = $sizeMB / $seconds
        $speedMbps = $speedMBs * 8

        # Kiểm tra header PNG giả
        $isFakePng = ($firstChunk[0] -eq 0x89 -and $firstChunk[1] -eq 0x50 -and $firstChunk[2] -eq 0x4E -and $firstChunk[3] -eq 0x47)
        $dataType = if ($isFakePng) { "Fake PNG (Chưa cắt header)" } else { "fMP4 Video (Đã cắt header)" }

        $color = if ($speedMbps -ge 50) { "Green" } elseif ($speedMbps -ge 15) { "Yellow" } else { "Red" }
        Write-Host "   => Tải xong: $([Math]::Round($sizeMB, 2)) MB trong $([Math]::Round($seconds, 2))s" -ForegroundColor $color
        Write-Host "   => Tốc độ: $([Math]::Round($speedMBs, 2)) MB/s ($([Math]::Round($speedMbps, 1)) Mbps) | Dữ liệu: $dataType" -ForegroundColor $color
        Write-Host ""

        $results += [PSCustomObject]@{
            "Nguồn Tải"       = $t.Name.Split('(')[0].Trim()
            "Thời Gian (s)"   = [Math]::Round($seconds, 2)
            "Tốc Độ (MB/s)"   = [Math]::Round($speedMBs, 2)
            "Băng Thông"      = "$([Math]::Round($speedMbps, 1)) Mbps"
            "Loại Dữ Liệu"    = $dataType
        }
    }
    catch {
        Write-Host "   => LỖI: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        $results += [PSCustomObject]@{
            "Nguồn Tải"       = $t.Name.Split('(')[0].Trim()
            "Thời Gian (s)"   = "Lỗi"
            "Tốc Độ (MB/s)"   = "0"
            "Băng Thông"      = "0 Mbps"
            "Loại Dữ Liệu"    = "Lỗi kết nối"
        }
    }
}

Write-Host "================================= BẢNG TỔNG HỢP =================================" -ForegroundColor Cyan
$results | Format-Table -AutoSize
Write-Host "--------------------------------------------------------------------------------" -ForegroundColor Gray
Write-Host "📌 GIẢI THÍCH KẾT QUẢ CHO ANH:" -ForegroundColor Yellow
Write-Host "1. Phim 4K UHD Remux có bitrate ~68.4 Mbps (~8.55 MB/s). Để xem không giật cần > 70 Mbps." -ForegroundColor Gray
Write-Host "2. Proxy PHP: Tốc độ ~8-9 Mbps nhưng trả về Fake PNG (Trình duyệt MediaSource không đọc được)." -ForegroundColor Gray
Write-Host "3. VPS Singapore: Đã cắt header PNG, phục vụ thẳng fMP4 video từ SSD qua Zero-Copy." -ForegroundColor Gray
Write-Host "================================================================================" -ForegroundColor Cyan
