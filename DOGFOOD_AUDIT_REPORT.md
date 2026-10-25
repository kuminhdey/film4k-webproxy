# Dogfood Report: Film4k Cinema Streaming & Admin Portal

| Field | Value |
|-------|-------|
| **Date** | 2026-10-25 |
| **App URL** | https://secret.dangducminh.io.vn |
| **Session** | `film4k` (CLI `agent-browser` - Vercel Dogfood Standard) |
| **Scope** | Trang chủ (`/`), Trình phát phim Ultrawide (`/watch/spider-man-brand-new-day`), Cổng Quản trị Admin (`/admin`) |

---

## Executive Summary

Hệ thống Film4k Cinema đã được kiểm thử toàn diện theo chuẩn **Vercel agent-browser Dogfooding** trên môi trường thực tế (Production URL `https://secret.dangducminh.io.vn`).

- **Trang chủ & Khám phá:** Tải nhanh, Hero banner hiển thị sắc nét, tìm kiếm tức thì "Spider" trả về chính xác phim *Người Nhện: Khởi Đầu Mới*, bộ lọc thể loại hoạt động mượt mà.
- **Trình phát Video Cinema Ultrawide:**
  - Tự động phát với buffer ổn định đạt **40.0s**, không bị gián đoạn.
  - Menu phụ đề hỗ trợ **38+ ngôn ngữ** cuộn mượt mà độc lập (`scrollHeight: 1732px`, `clientHeight: 340px`), không gây vỡ giao diện hay đơ scroll.
  - Độ phân giải phim tỉ lệ 2.39:1 được chuẩn hóa: **1600p 4K** (đạt render thực tế `3832x1600`), **1080p HD** (từ `1920x800`), nút Auto hiển thị `Tự động (1080p)`.
  - Chuyển đổi âm thanh sang **ViE-AI Thuyết minh tiếng Việt (Stereo)** mượt mà, video tiếp tục phát liên tục (`paused: false`, `readyState: 4`).
  - Phím tắt bàn phím (`Space` Play/Pause, `ArrowRight` tua +10s, `M` Mute/Unmute) hoạt động trơn tru.
- **Cổng Quản Trị Admin (`/admin`):**
  - Cổng bảo mật Auth Gate xác thực mật khẩu `film4k@admin2026` chính xác.
  - Bảng điều khiển hiển thị đầy đủ thống kê tổng phim (83), tỷ lệ phim lẻ/bộ, trạng thái cache M3U8 siêu tốc.
  - Thanh tiến trình Crawler Master Database cập nhật thời gian thực (82%).
  - Kích hoạt lệnh Crawler (Quét phim mới) phản hồi ngay lập tức trên Terminal Live Logs giả lập bash 80x24.

---

## Issue Severity Breakdown

| Severity | Count | Notes |
|----------|-------|-------|
| Critical | 0 | Không có lỗi gây gián đoạn luồng người dùng hoặc crash ứng dụng. |
| High | 0 | Không có lỗi chức năng nghiêm trọng. |
| Medium | 1 | Fallback request VTT trả về 404 trong Console. |
| Low / Polish | 2 | Phân trang bảng danh sách phim admin & thanh tìm kiếm khi quay lại. |
| **Total** | **3** | |

---

## Detailed Issues

### ISSUE-001: Fallback request file VTT local trả về 404 trong Console

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | console / functional |
| **URL** | `https://secret.dangducminh.io.vn/watch/spider-man-brand-new-day` |
| **Repro Video** | N/A (Static Network/Console Warning) |

**Description**
Khi player khởi động, ứng dụng phát hiện phim và gửi request GET đến `/api/subtitles/spider-man-brand-new-day.vtt` để tải phụ đề độc lập. Endpoint này trả về HTTP 404 do phụ đề được nhúng trực tiếp trong luồng HLS m3u8 (`Film4k.net`, `Tiếng Việt`, `English`, v.v.). Mặc dù phụ đề stream vẫn hoạt động bình thường, việc xuất hiện cảnh báo 404 trong console có thể làm rối log theo dõi.

**Console Warning Log:**
```
[warning] Failed to load VTT from url: /api/subtitles/spider-man-brand-new-day.vtt {stack: "Error: HTTP 404 at R2...", message: "HTTP 404"}
```

**Repro Steps:**
1. Truy cập `https://secret.dangducminh.io.vn/watch/spider-man-brand-new-day`
2. Mở Browser Console.
3. **Quan sát:** Có 2 log warning HTTP 404 đối với `/api/subtitles/spider-man-brand-new-day.vtt`.

---

### ISSUE-002: Bảng danh sách phim trong Cổng Quản trị thiếu phân trang (Pagination)

| Field | Value |
|-------|-------|
| **Severity** | Low / Polish |
| **Category** | ux / visual |
| **URL** | `https://secret.dangducminh.io.vn/admin` |
| **Repro Video** | N/A |

**Description**
Trên Admin Dashboard, card thống kê báo cáo **Tổng số phim: 83**, trong khi bảng dữ liệu bên dưới hiển thị **"Tổng cộng 17 phim trong cơ sở dữ liệu"** (chỉ hiển thị 17 hàng dữ liệu của trang đầu) mà chưa có nút phân trang (Pagination / Trang tiếp theo / Chọn số phim mỗi trang).

**Repro Steps:**
1. Đăng nhập vào `/admin` với mật khẩu quản trị.
2. Cuộn xuống phần "Quản Lý Danh Sách Phim & Cache M3U8".
3. **Quan sát:** Chỉ hiển thị 17 phim đầu tiên mà không có các nút chuyển trang (Trang 1, 2, 3...).

---

### ISSUE-003: Giữ nguyên từ khóa tìm kiếm khi điều hướng ngược từ Player về Trang chủ

| Field | Value |
|-------|-------|
| **Severity** | Low / Polish |
| **Category** | ux |
| **URL** | `https://secret.dangducminh.io.vn` |
| **Repro Video** | N/A |

**Description**
Khi người dùng tìm kiếm phim `"Spider"`, click vào xem phim, sau đó nhấn nút "Trang chủ" hoặc logo Film4k, input tìm kiếm trên header vẫn giữ giá trị `"Spider"` khiến trang chủ tiếp tục hiển thị kết quả lọc thay vì quay về danh sách đầy đủ. Cần thêm cơ chế clear search query khi click Logo / Trang chủ.

---

## Comprehensive Test Walkthrough & Evidence

### Test 1: Trang chủ, Tìm kiếm, Lọc Thể loại & Điều hướng Phim

1. **Trang chủ (`/`):**
   Giao diện hiển thị Hero banner phim bom tấn 2026, các hàng phim nổi bật, thanh điều hướng và nhãn chất lượng 4K Ultra HD.
   ![01-home](screenshots/01-home.png)

2. **Tìm kiếm phim ("Spider"):**
   Gõ tức thì từ khóa "Spider", hệ thống lọc và hiển thị ngay kết quả *Người Nhện: Khởi Đầu Mới (Spider-Man: Brand New Day 2026)* không cần tải lại trang.
   ![02-search-spider](screenshots/02-search-spider.png)

3. **Lọc thể loại ("Phim Hành Động"):**
   Bộ lọc thể loại hoạt động chính xác, hiển thị các phim hành động tiêu biểu.
   ![03-genre-filter](screenshots/03-genre-filter.png)

4. **Trang chi tiết / Chuẩn bị phát phim:**
   Nhấp vào card phim chuyển tiếp mượt mà đến trang xem phim.
   ![04-movie-detail](screenshots/04-movie-detail.png)

---

### Test 2: Trình phát Video Cinema Ultrawide (`/watch/spider-man-brand-new-day`)

5. **Tự động phát & Buffer thời gian thực:**
   Video tự động phát, độ phân giải sắc nét, đo lường buffer ban đầu đạt **40 giây an toàn**, không gián đoạn.
   ![05-player-playback](screenshots/05-player-playback.png)

6. **Popup Cài đặt nâng cao:**
   Mở popup cài đặt hiển thị 4 tùy chọn chính: Chất lượng, Âm thanh, Tốc độ phát, Phụ đề.
   ![06-settings-popup](screenshots/06-settings-popup.png)

7. **Menu Phụ đề đa ngôn ngữ:**
   Hiển thị danh sách 38+ ngôn ngữ phụ đề (`Film4k.net`, `Tiếng Việt`, `English`, `Čeština`, `Deutsch`, `Français`, `日本語`, v.v.).
   ![07-subtitles-menu](screenshots/07-subtitles-menu.png)

8. **Kiểm tra cuộn Menu Phụ đề:**
   Menu cuộn mượt với `overflow-y: auto`, `maxHeight: 340px`, chiều cao nội dung `1732px`, không làm tràn hay vỡ giao diện player.
   ![08-subtitles-scrolled](screenshots/08-subtitles-scrolled.png)

9. **Menu Chất lượng đã chuẩn hóa Ultrawide:**
   Hiển thị danh sách từ cao xuống thấp: `Tự động (1080p)`, `1600p 4K`, `1080p HD`.
   ![09-quality-menu](screenshots/09-quality-menu.png)

10. **Chọn Chất lượng 1600p 4K:**
    Chọn `1600p 4K`, kiểm tra trực tiếp qua video element ghi nhận `videoWidth: 3832, videoHeight: 1600`.
    ![10-quality-1600p-selected](screenshots/10-quality-1600p-selected.png)

11. **Chuyển đổi Âm thanh Thuyết minh ViE-AI:**
    Đổi sang track `ViE-AI - Film4k.net (Stereo)`, âm thanh chuyển mượt mà, video tiếp tục phát (`currentTime: 118s`, `paused: false`).
    ![11-audio-switched](screenshots/11-audio-switched.png)

12. **Kiểm tra Phím tắt Bàn phím:**
    - `Space`: Tạm dừng (`paused: true`) -> Nhấn tiếp: Phát lại (`paused: false`).
    - `ArrowRight`: Tua tới +10 giây thành công.
    - `M`: Bật/tắt chế độ tắt tiếng (`muted: true` / `muted: false`).
    ![12-keyboard-shortcuts](screenshots/12-keyboard-shortcuts.png)

---

### Test 3: Cổng Quản Trị Admin (`/admin`)

13. **Cổng bảo mật Auth Gate:**
    Trang quản trị yêu cầu nhập mật khẩu bảo mật `film4k@admin2026`.
    ![13-admin-login-gate](screenshots/13-admin-login-gate.png)

14. **Bảng điều khiển Quản trị (Admin Dashboard):**
    Đăng nhập thành công, hiển thị các card số liệu: Tổng số phim: 83 (Phim lẻ: 58, Phim bộ: 25), Đã cache M3U8 siêu tốc: 1, Trạng thái Crawler: Đang Hoạt Động.
    ![14-admin-dashboard](screenshots/14-admin-dashboard.png)

15. **Kích hoạt Crawler & Terminal Live Logs:**
    Nhấn "Quét Cập Nhật Phim Mới", tiến trình Crawler cập nhật 82% (82/100 phim), terminal log hiển thị thời gian thực theo định dạng macOS bash terminal.
    ![15-admin-crawler-logs](screenshots/15-admin-crawler-logs.png)

---

## Kết luận & Đề xuất hành động

1. **Chất lượng Video & Player:** Đã đạt chuẩn cao cấp nhất của trải nghiệm Cinema Ultrawide (1600p 4K / 3832x1600), phụ đề và âm thanh hoạt động hoàn hảo.
2. **Khắc phục Polish:**
   - Thêm cờ bỏ qua request `/api/subtitles/*.vtt` nếu phim đã có sẵn subtitle nhúng trong HLS stream để dọn sạch console warning.
   - Bổ sung phân trang cho bảng danh sách phim tại `/admin`.
