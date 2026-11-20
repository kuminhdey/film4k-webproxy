# ECC Backend, Proxy, Crawler & Ops Security & Architecture Audit

- **Target Workspace**: `/Users/kuminhdey/Downloads/webproxy`
- **Audit Track**: `ecc-backend` (Rust Axum Backend, Streaming/Image Proxy, Playlist Cache, Crawler, Legacy Node/Python Scripts, Docker/Systemd/Ops)
- **Standards Applied**: `.gemini/GEMINI.md` (ECC Baseline & Security Checklist), ECC Guardrails (`ecc-guardrails.md`), `security-review`, `backend-patterns`, `rust-patterns`, `docker-patterns`
- **Product Code Mutation**: None (strictly read-only audit)

---

## 1. Executive Summary & Inline Verification Results

### 1.1 Severity Summary

| Severity | Count | Key Themes |
| :--- | :---: | :--- |
| **Critical** | **2** | Unauthenticated Puppeteer SSRF / open segment proxy / DOM XSS / hardcoded HMAC key in `custom_player_server.js`; disabled TLS verification (`verify=False`) over hardcoded plaintext public proxy (`161.118.202.252`) enabling MitM DB poisoning in `crawler_service.py` / `crawler_service.js`. |
| **High** | **6** | Per-request `reqwest::Client` creation bypassing connection pooling; unbounded disk cache & unauthenticated subtitle parameter-space disk exhaustion (`ENOSPC`) + unvalidated child playlist filenames in `playlist_cache.rs`; DNS-rebinding SSRF & unbounded JSON/XML body OOM in `crawler.rs`; unauthenticated open CDN bandwidth proxy; blocking SQLite `Mutex` & recursive FS walks on Tokio async threads; root container execution without capability/filesystem/resource hardening. |
| **Medium** | **8** | Predictable `/dev/urandom` fallback token + PID/nanos leak on `/api/crawler/status`; unbounded admin `sessions` store & `O(N)` SHA-256 lock scan; crawler same-owner lease race & incomplete stop sync; Python/Node SQLite writers bypassing `crawler_leases` fencing + stale schema + shell `execSync`; 25+ production `.unwrap()` calls under `panic = "abort"`; `.dockerignore` `*.py` stripping `scripts/runtime_alert_monitor.py`; ignored `[profile.release]` in non-root `backend/Cargo.toml`; raw DB/FS error leaks & multi-episode proxy refresh returning Episode 1. |
| **Low** | **4** | Missing `PRAGMA foreign_keys = ON` per connection + unescaped `LIKE` wildcards + unindexed token scan; parallel `api_tests.rs` race on shared `data/playlists`; readiness `STATIC_DIR` mismatch; hardcoded `/Users/kuminhdey/...` & `secret.dangducminh.io.vn` paths, tracked `.pyc`/`wal` artifacts, and doc contract drift. |
| **Total** | **20** | **2 Critical · 6 High · 8 Medium · 4 Low** |

### 1.2 What the Rust Codebase Already Does Well
- **SQL Parameterization**: Core Rust queries in `backend/src/db.rs` use `rusqlite::params!` / `params_from_iter` placeholders rather than raw user-input SQL string concatenation.
- **Core Proxy SSRF Controls**: `backend/src/proxy.rs` (`is_blocked_ip`, `is_valid_remote_url`, `resolve_and_validate_host`, `read_body_with_cap`, `capped_stream`, `is_disallowed_stream_mime`, `is_allowed_image_mime`, `add_security_headers`) blocks private/loopback/link-local/CGNAT IPv4 & IPv6 ranges, enforces HTTPS port 443, rejects active HTML/SVG/JS MIME types, sets `nosniff` + sandbox CSP headers, and caps chunked stream/image/playlist payloads.
- **Admin Login Hardening**: `backend/src/admin.rs` enforces constant-time SHA-256 comparison (`subtle::ConstantTimeEq`), rejects legacy static `X-Admin-Key` headers, bounds `failed_attempts` to 4,096 tracked client IPs, and restricts `X-Real-IP` trust to `TRUSTED_PROXIES`.
- **SQLite Backup & Restore Tooling**: `scripts/backup_sqlite.sh` and `scripts/restore_rehearsal.sh` use `VACUUM INTO`, verify `PRAGMA integrity_check` / `quick_check`, perform staged atomic renames in the target directory, and rehearse restores in isolated `mktemp -d` sandboxes.

### 1.3 Inline Verification Executed
1. **`cargo check` (`backend/`)**: Passed (`exit=0`), surfaced workspace warning: `profiles for the non root package will be ignored` (`backend/Cargo.toml:28-33`).
2. **`cargo test -- --test-threads=1` (`backend/`)**: Passed — **47 unit tests passed** (1 live network test ignored) + **21 integration tests passed** (`backend/tests/api_tests.rs`).
3. **`cargo clippy --all-targets` (`backend/`)**: Passed with 7 library warnings and 1 test warning (`result_large_err` at `admin.rs:354`, `manual_is_multiple_of` at `crawler.rs:251`, `collapsible_match` at `crawler.rs:653`, `unnecessary_lazy_evaluations` at `crawler.rs:1092`, `type_complexity` at `db.rs:403`, `useless_format` at `db.rs:1150`, `io_other_error` at `proxy.rs:1008`, `needless_borrows_for_generic_args` at `api_tests.rs:825`).
4. **`bash scripts/test_ops_scripts.sh`**: Passed — **9/9 ops & runtime monitor test suites passed** (including `test_runtime_alert_monitor.py`).

---

## 2. Critical Findings

### BACKEND-01 [Critical] — Unauthenticated Headless-Browser SSRF, Open Proxy, Unbounded Chromium DoS, Host-Header Injection, Hardcoded HMAC Secret, and DOM XSS in `custom_player_server.js`

- **Locations**:
  - `custom_player_server.js:26-147` (`resolveStreamFromEmbed` — unvalidated `embedUrl` passed to `puppeteer.launch` with `--no-sandbox` at `41-49` and `page.goto(embedUrl)` at `95`)
  - `custom_player_server.js:124` (hardcoded AES-GCM key-derivation secret `'stream-derive-v1'`)
  - `custom_player_server.js:12, 141` (unbounded `streamCache = new Map()` without TTL or max capacity)
  - `custom_player_server.js:158, 206-207, 235` (untrusted `req.headers.host` interpolated into playlist and API URLs)
  - `custom_player_server.js:169-171, 680` (`0.0.0.0:3333` network bind with `Access-Control-Allow-Origin: *`)
  - `custom_player_server.js:189-225` (unauthenticated `POST /api/resolve` with unbounded `body += chunk` at `191-192` and raw error reflection at `221`)
  - `custom_player_server.js:245-289` (unauthenticated `GET /segment` open `https.get(targetUrl)` proxy at `265`, arbitrary `Referer` spoofing via `origin` at `247, 255`, error leak at `283`)
  - `custom_player_server.js:554, 593` (DOM XSS via `el.innerHTML = text` rendering `err.message`)
- **Mechanics & Impact**:
  1. **Full Headless-Browser SSRF & Process Exhaustion**: `POST /api/resolve` accepts any JSON `embedUrl` containing a `?hash=...` query parameter without scheme, domain, or IP validation, launches a fresh `--no-sandbox` Chrome process per request, and navigates it to `embedUrl` (`page.goto(embedUrl)`). Any caller reaching port `3333` (or triggering cross-origin POSTs from a browser tab while the developer/operator runs the server locally, since CORS `*` is enabled and simple/JSON requests are accepted without auth or CSRF tokens) can probe internal HTTP services (`127.0.0.1`, RFC1918 LAN, cloud metadata `169.254.169.254`, or `file://` URIs) or exhaust host RAM/CPU by issuing concurrent requests that spawn dozens of Chromium instances simultaneously.
  2. **Open HTTPS Proxy**: `GET /segment?url=<target>&origin=<referer>` proxies any HTTPS URL on the internet with `Content-Type: video/mp2t` and `Access-Control-Allow-Origin: *`, allowing arbitrary upstream Relay/SSRF abuse and `Referer` spoofing.
  3. **Unbounded Body & Cache Memory Growth**: `req.on('data', chunk => { body += chunk; })` (`192`) has no byte limit, and `streamCache` (`12`) retains full decrypted playlists indefinitely.
  4. **DOM XSS**: `setStatus` (`554`) assigns `el.innerHTML = text`; when `resolveStreamFromEmbed` throws an error containing attacker-controlled input or upstream content (`221`, `593`), script/HTML markup executes in the player page context.
- **Reproduction Scenario**:
  1. Start `node custom_player_server.js` (listens on `0.0.0.0:3333`).
  2. Send a `POST /api/resolve` request with an internal loopback URL containing `?hash=test` — `resolveStreamFromEmbed` launches headless Chrome with `--no-sandbox` and navigates directly to the internal service without rejecting private/loopback addresses.
  3. Send a `POST /api/resolve` payload exceeding available heap or 20 concurrent requests — Node buffers the body without bound and spawns 20 concurrent Chrome instances.
- **Fix Recommendation**:
  - Bind the utility server strictly to `127.0.0.1` (`server.listen(PORT, '127.0.0.1')`), require an authentication token, and remove `Access-Control-Allow-Origin: *`.
  - Enforce a strict HTTPS hostname allowlist + DNS resolution private-IP blocklist before both `page.goto(embedUrl)` and `https.get(targetUrl)` (mirroring `backend/src/proxy.rs`), and block all non-HTTPS requests inside Puppeteer's `page.on('request', ...)` interceptor.
  - Reuse a single bounded browser/page semaphore (e.g., max 1-2 concurrent resolves), cap POST request bodies at 4 KB, cap `streamCache` with an LRU/TTL policy, move `'stream-derive-v1'` to an environment variable, validate `Host` against expected local origins, and replace `el.innerHTML = text` (`554`) with `el.textContent = text`.

---

### BACKEND-02 [Critical] — Disabled TLS Certificate Verification (`verify=False`) Over Hardcoded Unencrypted Public Proxy (`161.118.202.252`) Enabling MitM Database Poisoning

- **Locations**:
  - `crawler_service.py:15` (`PROXY_URL = "http://161.118.202.252:9872"`)
  - `crawler_service.py:142` (`async with httpx.AsyncClient(proxy=PROXY_URL, timeout=30.0, follow_redirects=True, verify=False) as client:`)
  - `crawler_service.py:173, 180` (`upsert_movie(movie_data)` and `update_master_json(crawled_movies)`)
  - `crawler_service.js:19-23` (hardcoded plaintext HTTP proxy pool `http://161.118.202.252:9872`, `:9874`, `:9875`)
- **Mechanics & Impact**:
  `crawler_service.py` routes all upstream HTTPS API requests through a hardcoded unauthenticated HTTP proxy on a public IP (`161.118.202.252:9872`) with `verify=False` (completely disabling X.509 certificate chain and hostname verification) and `follow_redirects=True`. Any operator of `161.118.202.252` or network MitM along the unencrypted proxy path can present a self-signed certificate for `fiml4k.fun`, follow redirects to arbitrary internal/external endpoints, and return crafted movie/episode metadata (`hlsUrl`, `poster`, `backdrop`, `title`, `overview`) that is persisted directly into production `movies.db` (`173`) and `film4k_master_database.json` (`180`). In addition, hardcoding live VPS proxy IPs/ports in tracked source files exposes private proxy infrastructure to unauthorized reuse.
- **Reproduction Scenario**:
  1. Inspect `crawler_service.py:142` during execution of `run_crawler_pipeline()`.
  2. When the proxy at `161.118.202.252:9872` intercepts TLS with an untrusted/self-signed certificate or issues an HTTP 302 redirect to an untrusted host, `httpx.AsyncClient(..., follow_redirects=True, verify=False)` accepts the tampered response without error and writes the injected URLs directly into `movies.db`.
- **Fix Recommendation**:
  - Remove hardcoded proxy IPs from `crawler_service.py:15` and `crawler_service.js:19-23`; load proxy configuration exclusively from gitignored environment variables (`CRAWLER_PROXY_URL`) with authentication credentials if an outbound proxy is required.
  - Set `verify=True` and `follow_redirects=False` on `httpx.AsyncClient`, and validate every ingested `hlsUrl`, `poster`, and `backdrop` URL against the HTTPS domain allowlist before persisting to SQLite or JSON.
  - Decommission legacy standalone crawlers in favor of the Rust `CrawlerService` (`backend/src/crawler.rs`).

---

## 3. High Findings

### BACKEND-03 [High] — Per-Request & Per-Redirect `reqwest::Client` Instantiation Destroys Connection Pooling and Enables TLS/Socket Exhaustion DoS

- **Locations**:
  - `backend/src/proxy.rs:679-686` (`fetch_stream_with_client` ignores `_client: &Client`)
  - `backend/src/proxy.rs:709-715` (`fetch_stream_with_referer` calls `Client::builder()...build()` inside the `loop` on **every request and every redirect hop**)
  - `backend/src/proxy.rs:1057-1070` (`handle_image_proxy` calls `Client::builder()...build()` on every image request)
  - `backend/src/proxy.rs:542-548, 556-560, 765-775` (`fetch_upstream_title_hls*` and `fetch_pinned_stream` build new `Client` instances per call)
  - `backend/src/crawler.rs:356-360, 511-515, 710-714` (`CrawlerService` builds a new `Client` for every single movie slug crawled)
- **Mechanics & Impact**:
  `AppState::new` (`backend/src/lib.rs:42-46`) initializes a shared `http_client` intended for connection pooling, and `handle_stream_proxy` (`proxy.rs:821`) passes `&state.http_client` into `fetch_stream_with_client`. However, `fetch_stream_with_client` (`680`) discards `_client` and delegates to `fetch_stream_with_referer`, which constructs a brand-new `reqwest::Client` (initializing fresh TLS root certificates, connector state, and an isolated connection pool) for every request and every redirect hop, dropping the pool immediately after one response. The same anti-pattern occurs on every `/api/proxy/image` request (e.g., 24-40 poster thumbnails per page load!) and every movie crawled in `crawler.rs:710`. Under moderate HLS/image concurrency, this prevents TCP keep-alive and TLS session resumption, spikes CPU/memory in `libssl`, and exhausts ephemeral sockets (`TIME_WAIT` churn) and file descriptors.
- **Reproduction Scenario**:
  1. Load the homepage or catalog page rendering 24 proxied poster images (`/api/proxy/image?url=...`) while 5 clients stream HLS playlists/segments via `/api/proxy/stream`.
  2. Observe `handle_image_proxy` (`proxy.rs:1057`) and `fetch_stream_with_referer` (`proxy.rs:709`) constructing dozens of throwaway `reqwest::Client` instances per second with zero TCP/TLS reuse across requests to the same CDN host.
- **Fix Recommendation**:
  - Implement a custom `reqwest::dns::Resolve` trait wrapper (`SafeDnsResolver`) attached once to the shared `AppState.http_client` (configured with `no_proxy()` and `redirect::Policy::none()`). Inside `SafeDnsResolver::resolve`, perform `tokio::net::lookup_host` and reject any address matching `is_blocked_ip(addr.ip())`.
  - Reuse `&state.http_client` across `handle_stream_proxy`, `handle_image_proxy` (pass `State(state): State<AppState>`), and `CrawlerService` so DNS pinning/SSRF protection is preserved while maintaining full HTTP/2 multiplexing and TLS keep-alive pooling.

---

### BACKEND-04 [High] — Unbounded Disk Cache Growth, Unauthenticated Subtitle Parameter-Space Disk Exhaustion (`ENOSPC`), Unthrottled `?refresh=1`, and Unvalidated Child Playlist Filenames in `playlist_cache.rs`

- **Locations**:
  - `backend/src/playlist_cache.rs:150-170` (`start_cleanup_task` never cleans `base_dir` (`data/playlists`) on disk; `cache` `HashMap` at `107, 137-141` also lacks a max-entries cap and is unused)
  - `backend/src/playlist_cache.rs:579-649, 1162-1198` (`handle_stream_sub`, `handle_stream_sub_ep`, `get_sub_for_season_episode_server`)
  - `backend/src/playlist_cache.rs:46-51, 349, 742, 1044-1070` (`?refresh=1` cache bypass & unauthenticated upstream fetch for non-DB slugs when `ep <= 1`)
  - `backend/src/playlist_cache.rs:62-65, 822-840, 952, 962` (`extract_filename` without `is_safe_filename` check; unbounded `JoinSet` in `crawl_and_cache_for_season_episode_server`)
- **Mechanics & Impact**:
  1. **Zero Filesystem Eviction**: `PlaylistCache::start_cleanup_task` (`150-170`) purges rows from the unused SQLite `playlist_cache` table (`db.rs:367`) and prunes the unused in-memory `HashMap` (`167`), **but never deletes expired directories in `data/playlists/`**. Every cached movie, episode, season, and server variant remains on disk permanently unless manually cleared by an admin.
  2. **Unauthenticated Parameter-Space Disk Exhaustion (`ENOSPC`)**: `handle_stream_sub` (`1162`) and `get_sub_for_season_episode_server` (`579`) accept arbitrary `slug` (any alphanumeric string), `ep: Option<i32>`, `season: Option<i32>`, and `server: Option<usize>` query parameters **without checking whether the movie/episode/season/server exists in SQLite**. Whenever `file` corresponds to any valid subtitle on `https://fiml4k.fun/api/subs/{file}` (`609`), the handler creates `data/playlists/{slug}_s{season}_ep{ep}_srv{server}/sub/{file}` (`637-640`). Because `./data` is the same Docker volume hosting `/app/data/movies.db` (`docker-compose.yml:14, 18`), sweeping query parameters (`?season=2..N&ep=1..M&server=1..K`) fills disk/inodes and halts SQLite WAL commits across the entire backend.
  3. **Unthrottled Cache-Busting Amplification**: Passing `?refresh=1` on `GET /stream/:slug/master.m3u8?refresh=1` (`349`) unconditionally bypasses cached playlists with no authentication, no per-slug cooldown, and no singleflight request coalescing, allowing trivial upstream API ban/amplification.
  4. **Unvalidated Child Filenames & Unbounded Sub-Playlist Tasks**: `parse_master_and_extract_subs_for_season_server` (`952, 962`) extracts child filenames via `extract_filename` (`62-65`, splitting only on `?` and `/`) without calling `is_safe_filename` (`54-60`). A malformed or compromised upstream M3U8 referencing `..`, `.metadata.json`, or backslash-separated paths writes directly to `slug_dir.join(&filename)` (`824`), and `crawl_and_cache_for_season_episode_server` (`822-840`) spawns unbounded concurrent `JoinSet` tasks without a `Semaphore` or sub-playlist count cap.
- **Reproduction Scenario**:
  1. Request `/api/stream/nonexistent-slug/sub/<valid_vtt>?season=2&ep=10&server=99`, then increment `server=100`, `101`, ... — each request creates a new directory tree under `data/playlists/` without consulting `state.db`.
  2. Wait >24 hours after normal playback caching — `start_cleanup_task` runs hourly but `data/playlists/` size and directory count never decrease.
- **Fix Recommendation**:
  - Verify in `state.db` that `slug` (and any requested `(season, ep, server)` tuple) exists **before** creating any cache directory or making upstream requests in `get_master_*`, `get_file_*`, and `get_sub_*`.
  - Enforce `is_safe_filename(&filename)` and `filename != ".metadata.json"` (plus a max cap of e.g. 32 child playlists and a `Semaphore::new(4)`) in `crawl_and_cache_for_season_episode_server` (`822-840`).
  - Debounce `?refresh=1` per `(slug, season, ep, server)` (e.g., max once per 60s, or require admin auth for forced refresh) and coalesce concurrent cache misses with a per-key `tokio::sync::OnceCell` / `Mutex`.
  - Extend `start_cleanup_task` to walk `base_dir` hourly, remove directories whose `.metadata.json` `expires_at` (or `mtime`) is past `MAX_CACHE_AGE_SECS`, and enforce an overall disk/directory quota (LRU eviction) alongside removing dead `PlaylistCache.cache` / SQLite `playlist_cache` table code if unused.

---

### BACKEND-05 [High] — DNS-Pinning Bypass (DNS Rebinding SSRF Window) and Unbounded Response Body Allocation (OOM DoS) in `CrawlerService`

- **Locations**:
  - `backend/src/crawler.rs:349-392` (`fetch_and_update_home` — checks `is_valid_remote_url`, then calls `client.get(&primary_url).send()` without `resolve_and_validate_host` DNS pinning, and reads unbounded `resp.json().await?` at `391`)
  - `backend/src/crawler.rs:509-528` (`fetch_sitemap_slugs` — no `resolve_and_validate_host` DNS pinning, reads unbounded `resp.text().await?` at `527`)
  - `backend/src/crawler.rs:724` (`fetch_and_upsert_movie` — reads unbounded `resp.json().await?` instead of `read_body_with_cap(..., MAX_TITLE_JSON_BYTES)`)
- **Mechanics & Impact**:
  Unlike `proxy.rs` (which resolves DNS via `resolve_and_validate_host`, rejects private/internal IPs via `is_blocked_ip`, pins the socket with `.resolve(host, resolved_addr)`, and caps bodies via `read_body_with_cap`), `CrawlerService::fetch_and_update_home` and `fetch_sitemap_slugs` only run string-level `is_valid_remote_url` (which does **not** perform DNS resolution or private-IP validation) and let `reqwest` resolve DNS directly. If an origin added via `ALLOWED_PROXY_ORIGINS` (`proxy.rs:228`) or an expired/compromised subdomain resolves or DNS-rebinds to `127.0.0.1` / `169.254.169.254` / RFC1918 space, the crawler connects to the internal address. Additionally, `resp.json().await?` (`391, 724`) and `resp.text().await` (`527`) buffer upstream payloads into heap memory without any byte limit, allowing a giant or infinite chunked upstream response to OOM-kill the server (`panic = "abort"` / Linux OOM killer).
- **Reproduction Scenario**:
  1. Configure `ALLOWED_PROXY_ORIGINS=partner.example.com` where `partner.example.com` resolves to `127.0.0.1`, and set `FILM4K_HOME_URL=https://partner.example.com/api/home`.
  2. `is_valid_remote_url` (`crawler.rs:350`) returns `Ok`, and `client.get` (`365`) connects directly to `127.0.0.1:443` because `resolve_and_validate_host` is never called.
  3. Similarly, if `/sitemap-page.xml` streams 500 MB of XML, `resp.text().await` (`527`) allocates the entire payload in RAM.
- **Fix Recommendation**:
  - Route `fetch_and_update_home` and `fetch_sitemap_slugs` through the same DNS-validating, socket-pinned HTTP fetcher used by `proxy.rs` (`fetch_stream_with_referer` or `SafeDnsResolver` on `AppState.http_client`).
  - Replace all raw `resp.json().await` and `resp.text().await` calls in `crawler.rs:391, 527, 724` with `read_body_with_cap(resp, MAX_BYTES)` (e.g., `2 MB` for `/api/home` and `/api/title`, `10 MB` for `/sitemap-page.xml`) followed by `serde_json::from_slice`.

---

### BACKEND-06 [High] — Unauthenticated, Unthrottled Open CDN Bandwidth Proxy on `/api/proxy/stream`, `/?url=`, and `/api/proxy/image` with Permissive Wildcard CORS

- **Locations**:
  - `backend/src/lib.rs:85-86, 108-111, 141, 279-296` (`CorsLayer` allowing `Any` origin/methods/headers; root `/?url=` aliasing `handle_stream_proxy`)
  - `backend/src/proxy.rs:70-79, 213-238` (`ALLOWED_DOMAINS` wildcard subdomain matching for `*.tiktokcdn.com`, `*.akamaicdn.net`, `*.byteoversea.com`, `*.ibytedtos.com`, `*.ibyteimg.com`, `*.tmdb.org`)
  - `backend/src/proxy.rs:520-530, 778-992, 976-978, 1019-1146` (`Access-Control-Allow-Origin: *`, up to `50 MB` per segment, zero rate limiting or signed URL verification)
- **Mechanics & Impact**:
  `/api/proxy/stream`, `/?url=...`, and `/api/proxy/image` are exposed publicly without rate limiting, origin restriction, or HMAC signature binding, and emit `Access-Control-Allow-Origin: *`. Because `ALLOWED_DOMAINS` permits any subdomain of major global CDNs (`*.tiktokcdn.com`, `*.akamaicdn.net`, `*.ibytedtos.com`, `*.tmdb.org`), any external website can hotlink arbitrary video segments (up to 50 MB per request) and images hosted on those CDNs through this server, exhausting egress bandwidth quotas and saturating upstream connections. Furthermore, `CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)` (`lib.rs:108-111`) applies globally to `/api/admin/*` as well.
- **Reproduction Scenario**:
  1. From any external origin `https://other-site.example`, embed `<video>` or `fetch('https://<webproxy-host>/?url=https://v16m-default.akamaicdn.net/<50mb-segment>&keep_cdn=0')`.
  2. The server proxies the full 50 MB binary stream with `Access-Control-Allow-Origin: *` and no per-IP concurrency or bandwidth cap.
- **Fix Recommendation**:
  - Sign rewritten proxy URLs (`rewrite_m3u8` in `proxy.rs:465-511`) with an HMAC-SHA256 signature (`?url=...&sig=...&exp=...`) keyed by a server secret so `/api/proxy/stream` and `/?url=` only proxy URLs minted by this backend (or matching known catalog media), rather than arbitrary third-party CDN URLs.
  - Restrict `CorsLayer` on `/api/admin/*` and `/api/*` to configured `ALLOWED_FRONTEND_ORIGINS` rather than `Any`.
  - Add per-IP rate limiting / concurrency limits (at Nginx/Cloudflare edge and/or `tower::limit::ConcurrencyLimitLayer` on `/api/proxy/*`).

---

### BACKEND-07 [High] — Synchronous SQLite `std::sync::Mutex` Locking & Recursive Filesystem Walks Executed Directly on Tokio Async Worker Threads

- **Locations**:
  - `backend/src/lib.rs:204, 237, 311, 333, 351, 365, 373, 388, 392` (`health_ready_handler`, `health_check`, `list_movies`, `search_suggest`, `get_movies_by_slugs_handler`, `get_movie_recommendations`, `get_movie`, `get_home`, `get_crawler_status`)
  - `backend/src/admin.rs:411-421, 473, 698, 727-738, 777, 800-815` (`admin_stats` calling `dir_size(&base_dir)` & `count_cached_playlists` via `std::fs::read_dir`; `admin_movies`; `admin_cache_clear*` calling `std::fs::remove_dir_all`)
  - `backend/src/proxy.rs:817, 874` (`handle_stream_proxy` calling `find_slug_by_stream_url` & `get_movie_by_slug`)
  - `backend/src/playlist_cache.rs:691, 745` (`crawl_and_cache_for_season_episode_server` calling `database.get_movie_by_slug`)
- **Mechanics & Impact**:
  Explicitly flagged in ECC `rust-patterns` (`SKILL.md:493-498`: *"Blocking in async context — Blocks the executor!"*). While `Database::run_blocking` (`db.rs:46-58`) was introduced for `admin_logs` and crawler lease writes, **every public catalog endpoint, health check, proxy fallback lookup, and admin stats/cache-clear handler still acquires synchronous `std::sync::Mutex` locks (`db.rs:102-110`) with a 5,000 ms SQLite `busy_timeout` directly inside `async fn` handlers**. Worse, `admin_stats` (`admin.rs:418, 800-815`) recursively traverses every directory and file in `data/playlists` using synchronous `std::fs::read_dir` / `metadata()`, and `admin_cache_clear` (`admin.rs:731`) deletes the entire cache tree synchronously via `std::fs::remove_dir_all` on a Tokio worker thread. Under lock contention or a large playlist cache (tens of thousands of `.m3u8`/`.vtt` files), Tokio worker threads stall, causing latency spikes and `/health/ready` timeouts across unrelated streaming requests.
- **Reproduction Scenario**:
  1. Populate `data/playlists` with several thousand cached episode directories and poll `GET /api/admin/stats` (as the Admin Dashboard does periodically) while concurrent `/api/movies?search=...` and `/api/proxy/stream` requests arrive.
  2. `dir_size` (`admin.rs:800`) and synchronous `Mutex::lock()` + SQLite queries block Tokio worker threads directly instead of yielding to the async scheduler.
- **Fix Recommendation**:
  - Separate read and write blocking pools (`DB_READ_SLOTS` e.g. 16 permits, `DB_WRITE_SLOTS` 4 permits) in `Database` and wrap all SQLite read queries (`get_movies_filtered`, `get_movie_by_slug`, `search_suggest`, `check_health`, `find_slug_by_stream_url`, etc.) in `spawn_blocking`.
  - Offload `dir_size`, `count_cached_playlists`, and `std::fs::remove_dir_all` in `admin.rs` to `tokio::task::spawn_blocking` (or maintain cached disk usage counters updated incrementally).

---

### BACKEND-08 [High] — Production Container & Host Alert Service Run as `root` (UID 0) Without Capability Drops, Read-Only Rootfs, `no-new-privileges`, or Resource Limits

- **Locations**:
  - `Dockerfile:45-82` (Stage 3 runtime image installs packages and launches `CMD ["/app/webproxy_backend"]` as `root` with no `USER` directive)
  - `docker-compose.yml:1-28` (no `user:`, `cap_drop:`, `security_opt:`, `read_only:`, `tmpfs:`, `pids_limit:`, or memory/CPU limits)
  - `ops/systemd/webproxy-runtime-alerts.service:8` (`User=root` for a periodic HTTP readiness polling script)
- **Mechanics & Impact**:
  Violates ECC `docker-patterns` (`SKILL.md:218-248, 300, 548-550`). Because `/app/webproxy_backend` runs as UID 0 inside the container with default Linux capabilities (`CAP_CHOWN`, `CAP_DAC_OVERRIDE`, `CAP_FSETID`, `CAP_SETUID`, `CAP_SETGID`, `CAP_NET_RAW`, etc.), a writable root filesystem, and unlimited PIDs/memory, any vulnerability in dependencies or filesystem handling executes with container `root` privileges and can overwrite `/app/webproxy_backend` or `/app/scripts/*.sh` on disk, or exhaust host memory via unbounded allocations (`BACKEND-05`). Likewise, `webproxy-runtime-alerts.service` (`ops/systemd/webproxy-runtime-alerts.service:8`) runs Python as host `root` despite only reading `http://127.0.0.1:8090` and writing `/var/lib/webproxy-runtime-alerts/state.json`.
- **Reproduction Scenario**:
  1. Inspect `Dockerfile:45-82` or run `docker exec film4k-webproxy id` — returns `uid=0(root) gid=0(root)`.
  2. Inspect `docker inspect film4k-webproxy` — `ReadonlyRootfs: false`, `CapDrop: null`, `SecurityOpt: null`, `Memory: 0`, `PidsLimit: 0`.
- **Fix Recommendation**:
  - In `Dockerfile` Stage 3: create a dedicated unprivileged user (`RUN groupadd -g 10001 webproxy && useradd -u 10001 -g webproxy -s /usr/sbin/nologin -d /app webproxy && mkdir -p /app/data && chown -R webproxy:webproxy /app/data`) and add `USER 10001:10001` before `CMD`.
  - In `docker-compose.yml`: add `security_opt: ["no-new-privileges:true"]`, `cap_drop: ["ALL"]`, `read_only: true`, `tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"]`, `pids_limit: 256`, and `mem_limit: 1g` (or `deploy.resources.limits`).
  - In `ops/systemd/webproxy-runtime-alerts.service:8`: replace `User=root` with `DynamicUser=yes` (systemd automatically provisions `/var/lib/webproxy-runtime-alerts` via `StateDirectory=webproxy-runtime-alerts` and passes credentials safely via `LoadCredential=` or group-readable `0640` env file).

---

## 4. Medium Findings

### BACKEND-09 [Medium] — Predictable Admin Session Token Fallback on `/dev/urandom` Failure Combined with Unauthenticated PID/Timestamp Exposure via `/api/crawler/status`

- **Locations**:
  - `backend/src/admin.rs:84-102` (`generate_secure_token` silently falls back to `now ^ ((pid as u128) << 64) ^ (seq as u128)` if `File::open("/dev/urandom")` fails)
  - `backend/src/lib.rs:93, 391-393` (`GET /api/crawler/status` exposed publicly without `require_auth`)
  - `backend/src/crawler.rs:111-119, 165-172, 191-194` (`owner_id = format!("crawler_{}_{}_{}", std::process::id(), startup_nanos, seq)` + `recent_logs` exposed in `CrawlerStatus`)
- **Mechanics & Impact**:
  1. Instead of using the OS `getrandom` syscall (which never consumes file descriptors on Linux `getrandom(2)` / macOS `CCRandomGenerateBytes`), `generate_secure_token()` opens a file descriptor to `/dev/urandom` (`admin.rs:86`). Under file-descriptor pressure (`EMFILE` / `ENFILE`, inducible via `BACKEND-03` socket churn) or on non-Unix platforms (Windows), `File::open("/dev/urandom")` fails and silently mints a 128-bit admin token derived solely from `SystemTime::now().as_nanos()`, `std::process::id()`, and a sequential `AtomicU64` counter (`94-101`).
  2. Compounding this, `GET /api/crawler/status` (`lib.rs:93`) is unauthenticated and exposes `recent_logs` (which include lease conflict messages containing `owner_id` with exact `pid`, plus crawl timestamps and upstream errors).
- **Reproduction Scenario**:
  1. Call `GET /api/crawler/status` without an `Authorization` header — returns full `CrawlerStatus` JSON including 50 internal operational log entries.
  2. Run the backend on Windows (where `/dev/urandom` does not exist) or under `ulimit -n` exhaustion — `generate_secure_token` (`admin.rs:94-101`) emits deterministic timestamp/PID-based `adm_<32-hex>` tokens instead of failing closed.
- **Fix Recommendation**:
  - Add `getrandom = "0.2"` (or `rand = "0.8"`) to `backend/Cargo.toml` and generate 32 bytes via OS CSPRNG; if entropy generation ever fails, return `Err(StatusCode::INTERNAL_SERVER_ERROR)` — **never** fall back to `SystemTime` / `pid` XOR.
  - Redact `recent_logs` and internal `owner_id` from public `GET /api/crawler/status` (expose only minimal boolean/freshness fields needed by `runtime_alert_monitor.py`, or move detailed logs behind `/api/admin/stats`).

---

### BACKEND-10 [Medium] — Unbounded Admin Session Map, `O(N)` Double-SHA-256 Scan Under Lock, and Weak Password Policy

- **Locations**:
  - `backend/src/admin.rs:107, 221-230` (`sessions: Arc<RwLock<HashMap<String, Instant>>>` has no capacity limit)
  - `backend/src/admin.rs:50-54, 246-268` (`is_authenticated` iterates over every session in `sessions.iter()`, computing `Sha256::digest` twice per entry while holding the read lock)
  - `backend/src/admin.rs:119-137` (`is_strong_password` only checks `len >= 8` and 6 hardcoded words)
- **Mechanics & Impact**:
  While `failed_attempts` is capped at `MAX_FAILED_ATTEMPT_CLIENTS = 4096` (`admin.rs:32`), `sessions` has no upper bound on active entries, and `is_authenticated` performs a linear `O(N)` scan hashing every stored session token on each admin request (and breaking early on match at line `260`, leaking token index position via timing when `N` is large). Additionally, `is_strong_password` (`119-137`) accepts weak 8-character secrets such as `"aaaaaaaa"`, `"password1"`, `"admin1234"`, or `"film4knet"`.
- **Reproduction Scenario**:
  1. Set `ADMIN_PASSWORD=aaaaaaaa` — `AdminService::from_env()` (`admin.rs:143`) accepts it as strong.
  2. Repeatedly call `POST /api/admin/login` with valid credentials (e.g., from an automated health/monitoring script that forgets to reuse tokens) — `sessions` grows without bound for the 4-hour `SESSION_TTL`, slowing every `is_authenticated` call linearly.
- **Fix Recommendation**:
  - Key the `sessions` `HashMap` by `[u8; 32]` (`Sha256::digest(token)`) for `O(1)` lookup without storing raw session tokens in memory or looping with `Sha256` on every check, and cap concurrent admin sessions (e.g., `MAX_ACTIVE_SESSIONS = 32`, evicting the oldest session on insert).
  - Strengthen `is_strong_password` to require `>= 12` characters (or high character diversity / entropy check) and reject repeated-character or substring matches (`contains("admin")`, `contains("password")`, `contains("film4k")`).

---

### BACKEND-11 [Medium] — Crawler Same-Owner Lease Check Race (`trigger_mode` vs `fetch_and_update_home`) and Incomplete Stop Synchronization

- **Locations**:
  - `backend/src/crawler.rs:183-223` (`trigger_mode` checks `if owner != self.owner_id && expires_at >= now` at `190` before spawning `run_crawl_mode`)
  - `backend/src/crawler.rs:244-254, 301-312, 417-465` (`fetch_and_update_home_from_value` acquires `"crawler_main"` lease under the **same** `self.owner_id`)
  - `backend/src/crawler.rs:174-177, 539-560, 608-668` (`stop()` sets `stop_requested = true`, but up to 15 spawned `JoinSet` tasks continue running without cancellation)
- **Mechanics & Impact**:
  1. **Same-Owner Lease Race**: Both `fetch_and_update_home_from_value` (`418`, triggered at startup `main.rs:56` and hourly `crawler.rs:244`) and `run_crawl_mode` (`539`, triggered via Admin UI) contend for the single SQLite lease `"crawler_main"` using the **same** `CrawlerService.owner_id`. In `trigger_mode` (`185-197`), the pre-flight check only rejects the trigger when `owner != self.owner_id` (`190`), whereas `Database::acquire_crawler_lease` (`db.rs:482`) rejects **all** unexpired leases regardless of owner! Consequently, triggering a crawl while startup/hourly home sync holds `"crawler_main"` returns HTTP 200 `{"success": true, "message": "Crawler started..."}` to the Admin UI, and milliseconds later the spawned task silently aborts at `crawler.rs:541` (`"Skipped: active lease held by another process"`).
  2. **Stop Signal / In-Flight Drain Lag**: `stop()` (`174`) sets `stop_requested = true`, breaking the outer loop (`608`), but up to 15 in-flight `JoinSet` tasks (`651, 662`) — including slow `prewarm` playlist crawls (`733`) — continue executing without a `CancellationToken` until drained, keeping `status.is_running = true` and holding `"crawler_main"` long after `/api/admin/crawler/stop` returned `"Crawler stop signal sent successfully"`.
- **Reproduction Scenario**:
  1. Immediately after server startup (while `check_and_trigger_initial_sync` -> `fetch_and_update_home_from_value` holds `"crawler_main"`), call `POST /api/admin/crawler/start`.
  2. API responds `200 OK` with `"success": true`, yet `GET /api/admin/stats` immediately shows `crawler_is_running: false` and `last_status: "Skipped: active lease held by another process"`.
- **Fix Recommendation**:
  - Use distinct lease names for distinct jobs (`"crawler_home_sync"` vs `"crawler_catalog"`) **or** acquire the lease atomically *before* returning `success: true` (and remove `owner != self.owner_id` in `trigger_mode:190` so the pre-check matches `acquire_crawler_lease` semantics).
  - Use a `tokio_util::sync::CancellationToken` (or call `join_set.abort_all()` when `stop_requested` is set at `crawler.rs:609`) so stopping the crawler halts in-flight HTTP tasks promptly and releases the lease immediately.

---

### BACKEND-12 [Medium] — Legacy Python/Node SQLite Writers Bypass `crawler_leases` Fencing, Use Outdated Schema, Invoke Shell `execSync`, and Call Removed `/api/crawler/trigger`

- **Locations**:
  - `database.py:11-68, 100-150` (missing `servers_json`, `subtitles_json`, `audio_tracks_json`, `views`, `schema_migrations`; bypasses `crawler_leases` fencing)
  - `sync_sqlite.py:15-70, 108-175` (bypasses `crawler_leases` fencing; dynamic f-string `ALTER TABLE ... ADD COLUMN {col}` with bare `except Exception: pass` at `63-70`)
  - `crawler_service.js:125` (`execSync(\`python3 "${SYNC_SQLITE_SCRIPT}"\`)` shell invocation)
  - `crawler_service.js:134-145` (`fetch(\`${backendUrl}/api/crawler/trigger\`, { method: 'POST' })` — calls removed endpoint)
  - `crawler_service.py:49, 69, 125-126` (unencoded `httpx.URL(s_url)` query interpolation truncating `&` parameters; non-atomic `open(MASTER_JSON_PATH, "w")` overwrite)
- **Mechanics & Impact**:
  1. **Fence Bypass & Schema Drift**: While the Rust backend enforces monotonic fencing via `crawler_leases` (`db.rs:562-592`), `database.py` and `sync_sqlite.py` write directly to `movies.db` without checking or acquiring `crawler_leases`, and `database.py` defines an obsolete `movies`/`episodes` schema missing `servers_json`, `subtitles_json`, `audio_tracks_json`, and `views`. Running `python3 database.py` on a fresh DB creates tables incompatible with `db.rs` migration assumptions.
  2. **Broken URL Encoding & Non-Atomic JSON Write in `crawler_service.py`**: Lines `49` and `69` format `f"https://secret.dangducminh.io.vn/?url={httpx.URL(s_url)}"` without `urllib.parse.quote(s_url, safe='')`, causing any `&` in upstream signed URLs to break out of the `url=` parameter; lines `125-126` overwrite `film4k_master_database.json` directly in-place without temp-file rename.
  3. **Shell Execution & Dead Trigger Route in `crawler_service.js`**: Line `125` invokes a shell via `execSync` instead of `execFileSync('python3', [SYNC_SQLITE_SCRIPT])` (violating ECC `docker-patterns` shell-free runner rule), and line `135` POSTs unauthenticated to `/api/crawler/trigger`, which was removed (`api_tests.rs:897-903`) and always fails with 404/405.
- **Reproduction Scenario**:
  1. Run `node crawler_service.js --limit=1` while the Axum backend is running — `syncDatabaseAndNotify` writes to `movies.db` ignoring any active Rust `crawler_main` lease, then POSTs to `http://127.0.0.1:8090/api/crawler/trigger` and receives HTTP 404.
- **Fix Recommendation**:
  - Archive or delete legacy `crawler_service.py`, `database.py`, and `crawler_service.js` if superseded by `backend/src/crawler.rs`.
  - If `sync_sqlite.py` or `crawler_service.js` must remain as offline CLI utilities: check `crawler_leases` inside a `BEGIN IMMEDIATE` transaction before writing, replace `execSync(...)` with `execFileSync('python3', [SYNC_SQLITE_SCRIPT])`, authenticate against `/api/admin/login` + `/api/admin/crawler/trigger` if notifying the backend, URL-encode `s_url` with `urllib.parse.quote`, and write `MASTER_JSON_PATH` via atomic `.tmp` + `os.replace()`.

---

### BACKEND-13 [Medium] — Widespread `.unwrap()` on `std::sync::Mutex` / `RwLock` Across Production Modules Under `panic = "abort"`

- **Locations**:
  - `backend/src/admin.rs:189, 200, 217, 225, 233, 254` (6 `RwLock` `.unwrap()` calls)
  - `backend/src/crawler.rs:158, 166, 170, 199, 545, 555, 571, 583, 598, 628, 654, 664, 679` (13 `Mutex` `.unwrap()` calls) and `crawler.rs:784` (`Regex::new(...).unwrap()` recompiled on every call to `parse_sitemap_slugs`)
  - `backend/src/db.rs:98, 105, 108, 346, 368, 397, 437, 497, 523, 568, 634, 654, 669, 1362, 1431, 1452` (16 `Mutex` `.unwrap()` calls)
  - `backend/src/proxy.rs:878` (`REFRESH_RATE_LIMIT.lock().unwrap()`)
- **Mechanics & Impact**:
  Violates ECC `rust-patterns` (`SKILL.md:63, 465, 477`: *"Use `Result` and `?` — Never `unwrap()` in Production"*). There are 36 production `.unwrap()` calls on `Mutex`/`RwLock` guards (compare with `playlist_cache.rs:133, 138` and `crawler.rs:264, 286`, which handle poisoned locks via `.ok()` / `if let Ok(...)`). If any single request panics while holding a lock, the lock is permanently poisoned (`PoisonError`), causing cascading panics across all worker threads — or, once `panic = "abort"` (`backend/Cargo.toml:32`) is active, terminating the entire server process immediately. In addition, `parse_sitemap_slugs` (`crawler.rs:784`) recompiles a static `Regex` on every invocation instead of using `LazyLock<Regex>`.
- **Reproduction Scenario**:
  1. Trigger a panic inside any closure/scope holding `self.conn.lock().unwrap()` or `self.sessions.write().unwrap()`.
  2. Every subsequent request touching `db` or `admin` panics immediately on `.unwrap()`.
- **Fix Recommendation**:
  - Recover gracefully from poisoned standard locks using `.unwrap_or_else(|e| e.into_inner())` (or switch to `parking_lot::{Mutex, RwLock}` which does not poison), and hoist `SITEMAP_LOC_REGEX` in `crawler.rs:784` into a module-level `static LazyLock<Regex>`.

---

### BACKEND-14 [Medium] — `.dockerignore` Unanchored `*.py` Silently Strips `scripts/runtime_alert_monitor.py` from Container Images, Plus `Dockerfile` `DATABASE_PATH` Volume Mismatch

- **Locations**:
  - `.dockerignore:6` (`*.py` unanchored glob) vs `Dockerfile:68` (`COPY scripts /app/scripts`)
  - `Dockerfile:74` (`ENV DATABASE_PATH=/app/movies.db`) vs `docker-compose.yml:14, 18` (`./data:/app/data`, `DATABASE_PATH=/app/data/movies.db`) vs `backend/src/playlist_cache.rs:116` (`PathBuf::from("data/playlists")`)
- **Mechanics & Impact**:
  1. In Docker's `.dockerignore` syntax, an unanchored pattern `*.py` (`.dockerignore:6`, placed under `# Legacy Python scripts and caches`) matches `*.py` **at every directory depth**, including `scripts/runtime_alert_monitor.py` and `scripts/test_runtime_alert_monitor.py`! When `Dockerfile:68` runs `COPY scripts /app/scripts`, only `*.sh` files land in `/app/scripts` — `runtime_alert_monitor.py` and `test_runtime_alert_monitor.py` are silently excluded, so running `/app/scripts/test_ops_scripts.sh` inside the container fails on Test 7 (`scripts/test_ops_scripts.sh:199`).
  2. `Dockerfile:74` sets `ENV DATABASE_PATH=/app/movies.db`, outside `/app/data` (whereas `PlaylistCache` defaults to `/app/data/playlists` and `docker-compose.yml` mounts `./data:/app/data`). Running `docker run -v ./data:/app/data film4k-webproxy:<tag>` without explicitly overriding `-e DATABASE_PATH=/app/data/movies.db` writes SQLite data to the ephemeral container filesystem and loses the database on container recreation.
- **Reproduction Scenario**:
  1. Build the Docker image (`docker build --build-arg BUILD_COMMIT=test -t webproxy:test .`) and run `docker run --rm webproxy:test ls -la /app/scripts`.
  2. Observe `runtime_alert_monitor.py` and `test_runtime_alert_monitor.py` are missing from `/app/scripts` due to `.dockerignore:6`.
- **Fix Recommendation**:
  - Anchor root-only legacy Python scripts in `.dockerignore` as `/*.py` (or add `!scripts/*.py` negation rules after `*.py`).
  - Change `Dockerfile:74` default to `ENV DATABASE_PATH=/app/data/movies.db` (and ensure `/app/data` is created in the image) so `Dockerfile` and `docker-compose.yml` share the exact same persistent storage contract; update `.github/workflows/ci.yml:112, 169, 172` accordingly.

---

### BACKEND-15 [Medium] — Cargo Release Profile Defined in Non-Root `backend/Cargo.toml` Is Completely Ignored by Workspace Builds

- **Locations**:
  - `backend/Cargo.toml:28-33` (`[profile.release]` with `opt-level = 3`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = true`)
  - `Cargo.toml:1-5` (workspace root manifest missing `[profile.release]`)
- **Mechanics & Impact**:
  Confirmed directly during inline `cargo check` verification:
  ```text
  warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
  package:   /Users/kuminhdey/Downloads/webproxy/backend/Cargo.toml
  workspace: /Users/kuminhdey/Downloads/webproxy/Cargo.toml
  ```
  Because `Dockerfile:42` builds from the workspace root (`/app`), Cargo **completely ignores** `[profile.release]` in `backend/Cargo.toml`. As a result, production release binaries ship **unstripped** (retaining full symbol tables), without Link-Time Optimization (`lto = true`), without `codegen-units = 1`, and with unwinding panics instead of the intended release profile.
- **Reproduction Scenario**:
  1. Run `cargo check` in `/Users/kuminhdey/Downloads/webproxy` or `/Users/kuminhdey/Downloads/webproxy/backend`.
  2. Observe Cargo immediately emit the warning that `[profile.release]` in `backend/Cargo.toml` is ignored.
- **Fix Recommendation**:
  - Move `[profile.release]` from `backend/Cargo.toml:28-33` to the workspace root `Cargo.toml`.

---

### BACKEND-16 [Medium] — Raw Internal Database/Filesystem Error Leakage to Clients and Multi-Episode Stream Token Auto-Refresh Bug Returning Episode 1

- **Locations**:
  - `backend/src/lib.rs:320-323` (`list_movies` returns `format!("Failed to query movies: {}", err)`)
  - `backend/src/lib.rs:378-381` (`get_movie` returns `format!("Database error: {}", err)`)
  - `backend/src/admin.rs:703, 782` (`admin_cache_clear*` returns `format!("Failed to delete playlist cache for '{}': {}", slug, e)`)
  - `backend/src/playlist_cache.rs:807, 875` (`crawl_and_cache_*` returns raw `std::io::Error` strings)
  - `backend/src/proxy.rs:552-554, 894` (`handle_stream_proxy` auto-refresh calls `fetch_upstream_title_hls_with_client(&state.http_client, slug)`, hardcoding `episode = None`)
- **Mechanics & Impact**:
  1. **Error Information Disclosure**: Violates `.gemini/GEMINI.md:35` (*"Error messages scrubbed of sensitive internals"*) and ECC `security-review` (`SKILL.md:328-353`). Public endpoints `/api/movies` and `/api/movies/:slug` format raw `rusqlite` / `anyhow` errors directly into HTTP 500 response bodies (unlike `admin_movies` at `admin.rs:480`, which logs internally and returns a generic JSON error), and cache endpoints leak OS filesystem errors/paths.
  2. **Wrong-Episode Stream Refresh**: In `proxy.rs:894`, when an HLS playlist URL proxied through `/api/proxy/stream?url=...` expires (`403` / `"expired token"`), `handle_stream_proxy` refreshes the stream via `fetch_upstream_title_hls_with_client(&state.http_client, slug)` (`552`), which calls `fetch_upstream_title_hls_with_episode(..., None)`. For any multi-episode TV series (e.g., Episode 5), `title_hls_url_with_season(..., None, None)` (`proxy.rs:673-675`) returns **Episode 1's stream**, silently switching the viewer from Episode 5 back to Episode 1 mid-session!
- **Reproduction Scenario**:
  1. Play Episode 2 of a TV series via `/api/proxy/stream?url=<expired-ep2-url>&slug=breaking-bad`.
  2. `handle_stream_proxy` (`proxy.rs:894`) calls `fetch_upstream_title_hls_with_client` with `episode = None` and returns Episode 1's rewritten M3U8 playlist instead of Episode 2's.
- **Fix Recommendation**:
  - Scrub internal error details in `lib.rs:322, 380`, `admin.rs:703, 782`, and `playlist_cache.rs:807, 875`, logging `err` via `tracing::error!` and returning generic client-safe messages (`"Internal database error"`, `"Cache operation failed"`).
  - Accept optional `ep: Option<i32>` and `season: Option<i32>` in `ProxyQuery` (`proxy.rs:124-130`, or extract `/watch/{slug}/{ep}` from `Referer` at `proxy.rs:801-815`) and pass them to `fetch_upstream_title_hls_with_season_episode` (`proxy.rs:570`), failing closed with `403`/`502` rather than falling back to Episode 1 when episode context is unknown for a `"tv"` title.

---

## 5. Low Findings

### BACKEND-17 [Low] — SQLite `PRAGMA foreign_keys = ON` Omitted on Connections, Unescaped `LIKE` Metacharacters (`%`/`_`), Unindexed Stream Lookups, and `pub fn get_column_names` SQL Interpolation

- **Locations**:
  - `backend/src/db.rs:67-95, 121-123, 182` (`FOREIGN KEY (movie_slug) REFERENCES movies(slug) ON DELETE CASCADE` declared at `182`, but `PRAGMA foreign_keys = ON` is never executed on `conn` or `readers`)
  - `backend/src/db.rs:792, 804, 834, 886, 1007, 1336, 1348` (`format!("%{}%", ...)` without escaping `%` / `_` + full-table `LIKE` scans in `find_slug_by_stream_url`)
  - `backend/src/db.rs:112-119` (`pub fn get_column_names(conn: &Connection, table: &str)` interpolates `format!("PRAGMA table_info({})", table)`)
- **Mechanics & Impact**:
  1. SQLite disables foreign key enforcement by default on every new connection unless `PRAGMA foreign_keys = ON;` is run per connection. Because neither `Database::new` (`68, 78`) nor `new_in_memory` (`87`) enables `PRAGMA foreign_keys = ON`, deleting a row from `movies` will **not** cascade-delete its `episodes` rows.
  2. User search/filter strings (`search`, `genre`, `country`, `quality`, `q`) are parameterized (`?`), preventing SQL injection, but `%` and `_` are not escaped with an `ESCAPE '\'` clause, so searching `"100%"` or `"_"` acts as a wildcard scan. Moreover, `find_slug_by_stream_url` (`1327-1354`) runs two sequential unindexed `LIKE '%...%'` full-table scans over `movies.stream` and `movies.servers_json` (and notably never checks `episodes.sources_json` for TV episode URLs!).
  3. `get_column_names` (`112`) is `pub` and formats `table` directly into SQL without an identifier allowlist (currently only called internally with `"movies"` and `"episodes"` at `215, 241`).
- **Fix Recommendation**:
  - Add `PRAGMA foreign_keys = ON;` to the initialization batch for both writer (`db.rs:68, 87, 122`) and reader connections (`db.rs:78`).
  - Escape `\`, `%`, and `_` in user `LIKE` patterns (`ESCAPE '\'`), make `get_column_names` private (`fn`) with an `assert!(matches!(table, "movies" | "episodes"))`, and consider an FTS5 virtual table or `idx_movies_updated` / token lookup table if catalog size grows past 10k titles.

---

### BACKEND-18 [Low] — Parallel Integration Test Race Condition on Shared `data/playlists` Directory

- **Locations**:
  - `backend/tests/api_tests.rs:15-248` (`spawn_test_server` uses `AppState::new`, which defaults `PlaylistCache` to shared process-global `"data/playlists"`)
  - `backend/tests/api_tests.rs:630, 994-1050, 1462, 1566, 1741` (five `#[tokio::test]` tests write to `"data/playlists/..."`, while `test_admin_cache_clear` at `1038-1049` posts `{}` to `/api/admin/cache/clear`, deleting **every** directory inside `"data/playlists"`)
- **Mechanics & Impact**:
  Under default multi-threaded `cargo test`, `test_admin_cache_clear` (`1038-1049`) wipes all subdirectories of `data/playlists` at the exact same moment sibling tests (`test_local_playlist_cache_and_bytedance_direct_cdn`, `test_api_stream_episode_routing_and_validation`, `test_api_stream_sub_endpoint_and_caching`, `test_multi_season_friends_stream_endpoints`) create and read fixtures inside `data/playlists/`, creating a nondeterministic CI race condition (and potentially mutating local developer `backend/data/playlists` state).
- **Reproduction Scenario**:
  1. Run `cargo test --test api_tests` repeatedly in a loop with default thread concurrency — whenever `test_admin_cache_clear`'s clear-all step overlaps `test_multi_season_friends_stream_endpoints`, the sibling test's fixture directory is deleted mid-test and returns 404.
- **Fix Recommendation**:
  - Update `spawn_test_server()` in `backend/tests/api_tests.rs` to create a unique `std::env::temp_dir().join(format!("webproxy_test_playlists_{}_{}", pid, counter))` directory per test server via `.with_playlist_cache(PlaylistCacheService::new(&temp_dir))`, and return `(base_url, db, temp_dir)` so every integration test is 100% isolated on disk.

---

### BACKEND-19 [Low] — Readiness Asset Check Ignores `STATIC_DIR` & Multi-Directory Fallback Used by Router/SPA Handlers

- **Locations**:
  - `backend/src/lib.rs:113-134` (`create_app` checks `STATIC_DIR` env var + 5 candidate paths)
  - `backend/src/lib.rs:202, 241` (`health_ready_handler` and `health_check` hardcode `std::path::Path::new("frontend/dist/index.html").is_file()`)
  - `backend/src/lib.rs:253-270` (`spa_page_handler` checks 5 candidate paths in a different order and ignores `STATIC_DIR`)
- **Mechanics & Impact**:
  Static asset resolution is duplicated in three places with divergent rules. While Docker (`WORKDIR /app` + `/app/frontend/dist/index.html`) matches `"frontend/dist/index.html"`, starting the binary from `backend/` with `BUILD_COMMIT` set or configuring `STATIC_DIR=/srv/www` allows `ServeDir` (`133`) to serve assets while `/health/ready` (`202`) fails closed with `503 Static assets unavailable` and `spa_page_handler` (`253`) serves fallback placeholder HTML.
- **Fix Recommendation**:
  - Resolve `frontend_dist: PathBuf` once during `AppState` construction (respecting `STATIC_DIR` first), store `frontend_dist` on `AppState`, and reference `state.frontend_dist.join("index.html")` uniformly across `create_app`, `spa_page_handler`, `health_check`, and `health_ready_handler`.

---

### BACKEND-20 [Low] — Hardcoded Developer Workstation Paths, Hardcoded Personal Proxy Domain, Tracked `.pyc`/`wal` Artifacts, and Readiness Documentation Drift

- **Locations**:
  - `backend/src/main.rs:33`, `backend/src/lib.rs:118, 259`, `backend/src/crawler.rs:748` (hardcoded macOS user path `"/Users/kuminhdey/Downloads/webproxy/..."`)
  - `backend/src/crawler.rs:1026, 1066`, `backend/src/db.rs:1379`, `crawler_service.js:299, 310`, `crawler_service.py:49, 69` (hardcoded `https://secret.dangducminh.io.vn/?url=...`)
  - `docs/BUILD_AND_READINESS_CONTRACT.md:45`, `docs/OPERATIONS_RUNBOOK.md:219` (documents `"migrations_applied": 4` and omits `"background_scheduler": "healthy"`, whereas `db.rs:385, 393` and `lib.rs:210-212` require 5 migrations and report `"background_scheduler"`)
  - Git index (`__pycache__/vps_main.cpython-314.pyc`, `__pycache__/vps_main_clean.cpython-314.pyc`, `wal`, `frontend/tsconfig.tsbuildinfo` tracked in `git ls-files`)
- **Mechanics & Impact**:
  Hardcoding `/Users/kuminhdey/Downloads/webproxy/...` embeds developer workstation PII into production release binaries, and hardcoding `https://secret.dangducminh.io.vn` couples database records to a single personal domain instead of a relative `/api/proxy/stream?url=...` path or `PUBLIC_PROXY_BASE_URL` env var. Meanwhile, outdated migration counts (`4` vs `5`) in runbooks can mislead SREs validating `/health/ready` payloads during rollouts.
- **Fix Recommendation**:
  - Remove `/Users/kuminhdey/...` fallback paths from `main.rs`, `lib.rs`, and `crawler.rs` (relying on `DATABASE_PATH`, `SEED_JSON_PATH`, and `STATIC_DIR` env vars + relative paths).
  - Replace hardcoded `https://secret.dangducminh.io.vn/?url=` with `PUBLIC_PROXY_BASE_URL` env var defaulting to relative `/api/proxy/stream?url=`.
  - Update `docs/BUILD_AND_READINESS_CONTRACT.md` and `docs/OPERATIONS_RUNBOOK.md` to reflect `"migrations_applied": 5` and `"background_scheduler": "healthy"`, and untrack `__pycache__/*.pyc` and `wal` via `git rm --cached`.

---

## 6. Prioritized Remediation Roadmap

### Phase 1 — Immediate Security & Reliability Fixes (P0 / 24–48h)
1. **Lock down or isolate `custom_player_server.js` (`BACKEND-01`)**: Bind `127.0.0.1`, require auth, enforce `is_valid_remote_url` + private IP blocking before Puppeteer `page.goto` and `/segment` proxy, cap body size & Chromium concurrency, and replace `innerHTML` with `textContent`.
2. **Eliminate `verify=False` & hardcoded public proxy IPs (`BACKEND-02`, `BACKEND-12`)**: Enable TLS verification (`verify=True`), disable blind redirects, move proxy config to env vars, and retire legacy un-fenced Python/Node DB writers.
3. **Fix `reqwest::Client` connection pooling (`BACKEND-03`)**: Attach a custom SSRF-checking `reqwest::dns::Resolve` implementation to the shared `AppState.http_client` and stop calling `Client::builder().build()` per request/redirect.
4. **Bound `playlist_cache.rs` disk usage & validate inputs (`BACKEND-04`)**: Require slug/episode DB existence before caching subtitles/playlists, validate child playlist filenames with `is_safe_filename`, debounce `?refresh=1`, and add hourly filesystem cache eviction in `start_cleanup_task`.
5. **Close `CrawlerService` SSRF & OOM gaps (`BACKEND-05`)**: Enforce DNS pinning + `read_body_with_cap` on `/api/home`, `/sitemap-page.xml`, and `/api/title/:slug`.

### Phase 2 — Production Hardening & Concurrency Polish (P1 / Sprint)
6. **Harden Docker & systemd execution (`BACKEND-08`, `BACKEND-14`, `BACKEND-15`)**: Run container as non-root UID `10001` with `cap_drop: [ALL]`, `no-new-privileges:true`, `read_only: true`, and memory/PID limits; fix `.dockerignore` `/*.py` and `Dockerfile` `DATABASE_PATH=/app/data/movies.db`; move `[profile.release]` to root `Cargo.toml`; set `DynamicUser=yes` on `webproxy-runtime-alerts.service`.
7. **Protect proxy bandwidth & offload blocking SQLite/FS work (`BACKEND-06`, `BACKEND-07`)**: Add HMAC URL signing + rate limiting on `/api/proxy/*`, tighten `CorsLayer` origins, and wrap all SQLite reads and `admin_stats` / `admin_cache_clear` filesystem operations in `spawn_blocking`.
8. **Harden Admin sessions, lock recovery & error scrubbing (`BACKEND-09`, `BACKEND-10`, `BACKEND-11`, `BACKEND-13`, `BACKEND-16`)**: Use OS `getrandom` (no timestamp/PID fallback), hash-key and bound `AdminService.sessions`, split or pre-acquire crawler leases, replace `.unwrap()` lock calls, scrub 500 error strings, and pass episode/season context during proxy token refresh.
9. **Clean up SQLite pragmas, test isolation & config hygiene (`BACKEND-17`–`BACKEND-20`)**: Enable `PRAGMA foreign_keys = ON` per connection, isolate `api_tests.rs` playlist dirs with temp paths, unify `STATIC_DIR`, remove hardcoded workstation/domain strings, and update runbook migration counts to `5`.
