# ECC Frontend & Player Code Architecture Audit Report

- **Repository**: `/Users/kuminhdey/Downloads/webproxy`
- **Scope Audited**: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/postcss.config.js`, `frontend/tailwind.config.js`, `frontend/index.html`, `frontend/public/{sw.js,manifest.json}`, `frontend/src/**/*` (23 `.ts`/`.tsx`/`.mjs` files + 3 `.css` files + 1 `.json` asset, 13,560+ LOC), and `frontend/tests/**/*` (4 test suites).
- **Standards Applied**: Project `.gemini/GEMINI.md` (ECC Core Workflow, Coding Standards, Security Checklist, Delivery Standards) and ECC Skills (`security-review`, `react-patterns`, `react-performance`, `frontend-patterns`, `frontend-a11y`, `ecc-guardrails`).
- **Audit Mode**: Strictly Read-Only on product source code (`git status` verified clean).

---

## 1. Executive Summary & Severity Scorecard

| Severity | Security | Player & Streaming | React / TS / Bundle Architecture | **Total** |
| :--- | :---: | :---: | :---: | :---: |
| **Critical** | 1 | 1 | 0 | **2** |
| **High** | 1 | 5 | 3 | **9** |
| **Medium** | 3 | 3 | 3 | **9** |
| **Low** | 0 | 1 | 1 | **2** |
| **Total** | **5** | **10** | **7** | **22** |

### Inline Build, Typecheck & Test Verification Telemetry

All checks were executed non-destructively against `frontend/`:

1. **TypeScript Strict Compiler (`./node_modules/.bin/tsc --noEmit --incremental false`)**:
   - **Result**: `PASS` (exit code `0` under `strict: true`).
   - **Strict Unused Symbol Audit (`--noUnusedLocals --noUnusedParameters`)**: Flagged **23 unused imports/variables/functions** across 11 files because `tsconfig.json:16-17` sets `"noUnusedLocals": false` and `"noUnusedParameters": false`.
2. **Unit Test Suite (`npm test` -> `node --test tests/*.test.mjs`)**:
   - **Result**: `PASS` — `10/10` tests passing in `424.7ms` (`cardAccessibility`, `episodeLabel`, `liveSearchAccessibility`, `multiSeasonEpisode`).
   - **Gap**: Zero automated unit/component tests exist for `VideoPlayer.tsx` (4,723 LOC), `hlsLoader.ts` (`stripPngHeader`), `sw.js`, or `getHome()` / `getMovies()` adapters.
3. **Production Bundle Verification (`vite build` to isolated temp directory)**:
   - `index.html`: `4.44 kB` (`1.75 kB` gzip)
   - `assets/index-*.css`: `69.75 kB` (`11.00 kB` gzip)
   - `assets/vendor-react-*.js`: `4.22 kB` (`1.57 kB` gzip) — **misconfigured `manualChunks`! `react-dom/client` leaked into `index-*.js`**
   - `assets/vendor-icons-*.js`: `42.92 kB` (`10.22 kB` gzip)
   - `assets/AdminDashboard-*.js`: `57.83 kB` (`13.28 kB` gzip)
   - `assets/WatchPage-*.js`: `119.97 kB` (`31.00 kB` gzip)
   - `assets/index-*.js`: **`349.95 kB` (`103.50 kB` gzip)** — bloated initial entry bundle
   - `assets/vendor-hls-*.js`: `594.02 kB` (`184.84 kB` gzip) — properly deferred to lazy `WatchPage` route
4. **Dependency Vulnerability Scan (`npm audit --omit=dev`)**:
   - **Result**: `0` known npm advisory vulnerabilities (`dompurify@^3.4.17`, `hls.js@^1.5.17`, `react@^19.0.0`).

---

## 2. Security Audit Findings

### [CRITICAL] FE-SEC-01: Unvalidated `embedUrl` Protocol + `sandbox="allow-scripts allow-same-origin"` Iframe Escape

- **Locations**:
  - `frontend/src/components/VideoPlayer.tsx:4698-4707`
  - `frontend/src/components/WatchPage.tsx:318-320`
  - `frontend/src/api.ts:240-241`
  - `frontend/src/api.ts:276-277`
- **ECC Standard Violated**: `.gemini/GEMINI.md` (*"Validate user/external input at boundaries"*, *"Sanitized HTML output where applicable"*); `ecc-guardrails.md` (*"Treat external, third-party, fetched, retrieved, URL, link, and untrusted data as untrusted content"*).
- **Evidence**:
  - `WatchPage.tsx:318-320` filters `embedUrl` solely via `rawEmbed && !rawEmbed.includes('.m3u8')`. Neither `WatchPage.tsx` nor `api.ts:240-241` validates the URL scheme (`https:` / `http:`).
  - `VideoPlayer.tsx:4698-4707` renders:
    ```tsx
    <iframe
      ref={iframeRef}
      key={`embed-${key}`}
      src={embedUrl}
      title={`${movieName} - ${episodeName}`}
      sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      className="absolute inset-0 w-full h-full border-0"
    />
    ```
  - **Impact 1 (XSS via `javascript:` / `data:` URI)**: Because `embedUrl` comes from crawled third-party upstream catalogs, a poisoned upstream response supplying `javascript:...` or `data:text/html,...` executes script directly in the application context.
  - **Impact 2 (Sandbox Escape)**: Per W3C HTML5 / MDN specification, pairing `allow-scripts` with `allow-same-origin` allows any same-origin document (e.g., `/proxy/...`, relative path, or `javascript:`) loaded inside the iframe to access `window.parent`, read `window.parent.sessionStorage.getItem('bofilm_admin_token')`, and remove its own `sandbox` attribute via `window.frameElement.removeAttribute('sandbox')`.
  - **Impact 3 (Referer Leakage)**: Missing `referrerPolicy="no-referrer"` leaks internal watch URLs and `?t=` playback timestamps to external embed providers.
- **Remediation**:
  ```ts
  export function sanitizeEmbedUrl(raw?: string | null): string {
    if (!raw || raw.includes('.m3u8')) return '';
    try {
      const parsed = new URL(raw.trim());
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
      if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return '';
      return parsed.toString();
    } catch {
      return '';
    }
  }
  ```
  Render `<iframe src={safeUrl} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" ... />` **only** after verifying `parsed.origin !== window.location.origin` and `http(s):` scheme.

---

### [HIGH] FE-SEC-02: Admin Bearer Token Stored in `sessionStorage` & Missing Password Form Security Attributes

- **Locations**:
  - `frontend/src/components/AdminDashboard.tsx:40`
  - `frontend/src/components/AdminDashboard.tsx:44`
  - `frontend/src/components/AdminDashboard.tsx:63-80`
  - `frontend/src/components/AdminDashboard.tsx:355-359`
  - `frontend/src/components/AdminDashboard.tsx:839-860`
- **ECC Standard Violated**: `security-review` §4 (`SKILL.md:150-157`: *Tokens stored in `HttpOnly; Secure; SameSite=Strict` cookies, never Web Storage*); `frontend-a11y` (`SKILL.md:126-135`: `autoComplete="current-password"`).
- **Evidence**:
  - `AdminDashboard.tsx:357` writes the raw bearer token into `sessionStorage.setItem('bofilm_admin_token', savedToken)` and reads it on mount (`line 44`). While `sessionStorage` avoids cross-tab persistence compared to `localStorage`, it provides **zero isolation against XSS** (such as `FE-SEC-01` or `FE-SEC-03`): any script running in the origin can read `sessionStorage.getItem('bofilm_admin_token')` and invoke `/api/admin/crawler/*` or `/api/admin/logs/export`.
  - Additionally, `<input id="admin-password">` (`lines 839-860`) omits `name="password"` and `autoComplete="current-password"`, impairing password manager autofill and credential hygiene.
- **Remediation**:
  - Issue an `HttpOnly; Secure; SameSite=Strict; Path=/api/admin` session cookie from `/api/admin/login`, send `credentials: 'same-origin'` with a custom header (`X-Requested-With: XMLHttpRequest`) on state-changing requests, and probe `/api/admin/stats` on mount to determine auth state without exposing raw tokens to JavaScript.
  - Add `name="password" autoComplete="current-password" required aria-required="true"` to `<input id="admin-password">` (`AdminDashboard.tsx:839`).

---

### [MEDIUM] FE-SEC-03: Permissive Default `DOMPurify.sanitize()` Configuration in `FilmSynopsis`

- **Locations**:
  - `frontend/src/components/FilmSynopsis.tsx:12`
  - `frontend/src/components/FilmSynopsis.tsx:27-29`
- **ECC Standard Violated**: `security-review` §5 (`SKILL.md:209-215`: explicit `ALLOWED_TAGS` and `ALLOWED_ATTR: []`).
- **Evidence**:
  - `FilmSynopsis.tsx:12` calls `DOMPurify.sanitize(htmlContent || '<p>Nội dung phim đang được cập nhật...</p>')` with **no tag/attribute whitelist** and re-runs sanitization synchronously on every render (including when toggling `isExpanded`).
  - Because `htmlContent` is scraped from external movie catalogs, default DOMPurify permits `<a href="https://phishing.example" target="_blank">` (tabnabbing / external spam links), `<img src="https://tracker.example/pixel.png">` (automatic viewer IP & User-Agent tracking beacons), `<form action="...">`, and inline `style="..."` UI spoofing.
- **Remediation**:
  ```tsx
  const cleanHtml = useMemo(
    () =>
      DOMPurify.sanitize(htmlContent || '<p>Nội dung phim đang được cập nhật...</p>', {
        ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'em', 'strong', 'ul', 'ol', 'li'],
        ALLOWED_ATTR: [],
      }),
    [htmlContent]
  );
  ```

---

### [MEDIUM] FE-SEC-04: Unencoded `slug` Interpolation in Admin Endpoint & Unvalidated URL Schemes/Hostnames in `getImageUrl()`

- **Locations**:
  - `frontend/src/components/AdminDashboard.tsx:689`
  - `frontend/src/components/AdminDashboard.tsx:2272`
  - `frontend/src/utils.ts:177-212`
  - `frontend/src/App.tsx:294-295`, `307`, `526`, `557`
- **ECC Standard Violated**: `security-review` §2 (*Input & URL boundary validation; whitelist validation*).
- **Evidence**:
  1. `AdminDashboard.tsx:689` executes ``adminFetch(`/api/admin/cache/clear/${slug}`, { method: 'POST' })`` without `encodeURIComponent(slug)`. If a crawled `slug` contains `/`, `..`, `?`, or `#`, the authenticated `POST` request resolves to an unintended `/api/admin/*` path!
  2. `utils.ts:177-212` (`getImageUrl`):
     - `line 203` checks `targetUrl.includes('image.tmdb.org') || targetUrl.includes('tmdb.org')` via substring match instead of hostname check — any URL like `https://evil.example/a.jpg?ref=tmdb.org` bypasses `/api/proxy/image` and leaks client IP/Referer directly to `evil.example`.
     - `line 211` falls through with `return targetUrl;` for unrecognized schemes (e.g., `javascript:...`), instead of rejecting non-`http(s)` external strings to `'/logo.png'`.
- **Remediation**:
  - Wrap `slug` with `encodeURIComponent(slug)` in `AdminDashboard.tsx:689` and all URL path builders.
  - Parse URLs in `getImageUrl()` with `new URL(targetUrl)`: allow direct load only when `parsed.hostname === 'image.tmdb.org' || parsed.hostname.endsWith('.tmdb.org')`, route valid `http:`/`https:` URLs through `/api/proxy/image?url=...`, and return `'/logo.png'` for everything else.

---

### [MEDIUM] FE-SEC-05: Missing Content Security Policy (CSP) & Unawaited Service Worker `clearCache` Message Handler

- **Locations**:
  - `frontend/index.html:4-57`
  - `frontend/public/sw.js:38-47`
- **ECC Standard Violated**: `security-review` §5 (`SKILL.md:218-242`: CSP baseline).
- **Evidence**:
  - `index.html` defines no CSP `<meta http-equiv="Content-Security-Policy">` (nor is CSP configured in `vite.config.ts`), leaving `object-src 'none'` and `base-uri 'self'` unenforced on the client. Furthermore, inline `<script>` (`index.html:27-56`) and runtime `<style>` tags (`VideoPlayer.tsx:2813`, `2962`, `3647`; `AdminDashboard.tsx:962`) block strict `script-src 'self'` / `style-src 'self'` adoption until moved to external modules/CSS classes.
  - In `sw.js:42-46`, `if (event.data === 'clearCache')` invokes `caches.keys().then(...)` without wrapping the Promise in `event.waitUntil(...)`, allowing the browser to terminate the Service Worker mid-purge.
- **Remediation**: Move `index.html:27-56` recovery logic into `src/main.tsx`, replace dynamic `<style>` tags in `VideoPlayer.tsx` with CSS custom properties (`--bofilm-cue-color`, `--bofilm-cue-size`) in `index.css`, enforce CSP (`base-uri 'self'; object-src 'none'`), and wrap `sw.js:43` in `event.waitUntil(...)`.

---

## 3. Player & Streaming Reliability Audit Findings

### [CRITICAL] FE-PLY-01: Service Worker Intercepts & Caches External CDN Video Segments (`.ts`/`.m4s`/`.m3u8`) and Fails on Non-HTTP Schemes

- **Locations**:
  - `frontend/public/sw.js:49-90`
- **Evidence**:
  - `sw.js:53-61` only skips requests matching same-origin path prefixes `/api/`, `/stream/`, `/proxy/`, `/sw.js`:
    ```js
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/stream/') ||
      url.pathname.startsWith('/proxy/') ||
      url.pathname === '/sw.js' ||
      event.request.method !== 'GET'
    ) {
      return;
    }
    ```
  - **Severe Streaming Reliability Defect**: It never checks `url.origin !== self.location.origin` or streaming media extensions (`.m3u8`, `.ts`, `.m4s`, `.mp4`, `.vtt`). Whenever a manifest references direct CDN segments (`https://cdn.../chunk_001.ts` — explicitly anticipated by `hlsLoader.ts:126`), the Service Worker intercepts **every video segment**, clones the binary payload (`response.clone()`, `line 79`), and writes every `.ts`/`.m4s` chunk into `CacheStorage` (`cache.put`, `line 81`)!
    - Rapidly exhausts browser Origin Storage Quota during a single 1080p/4K movie (1–4 GB), triggering `QuotaExceededError`.
    - Adds IPC serialization + ArrayBuffer cloning overhead on every HLS fragment, causing dropped frames on mobile devices.
    - Serves stale `.m3u8` variant manifests due to stale-while-revalidate (`line 88`: `return cachedResponse || fetchPromise;`).
  - **Unhandled Rejection on Extension Requests**: Non-HTTP schemes (`chrome-extension://`) pass `event.request.method === 'GET'` and throw `TypeError: Request scheme 'chrome-extension' is unsupported` inside `cache.put()` (`line 81`).
  - **Broken Offline Navigation Fallback (`line 67`)**: `return caches.match('/') || caches.match('/index.html');` — `caches.match('/')` returns a **Promise object** (always truthy!), so `|| caches.match('/index.html')` is unreachable dead code!
- **Remediation**:
  ```js
  self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/stream/') ||
      url.pathname.startsWith('/proxy/') ||
      url.pathname === '/sw.js' ||
      /\.(m3u8|ts|m4s|mp4|aac|vtt|srt)$/i.test(url.pathname)
    ) {
      return;
    }
    if (event.request.mode === 'navigate') {
      event.respondWith(
        fetch(event.request, { cache: 'no-cache' }).catch(async () => {
          return (await caches.match('/')) || (await caches.match('/index.html')) || Response.error();
        })
      );
      return;
    }
    // ... static shell assets only
  });
  ```

---

### [HIGH] FE-PLY-02: Web Audio Graph (`createMediaElementSource`) Orphans on `<video key>` Remount & Lacks `crossOrigin="anonymous"`

- **Locations**:
  - `frontend/src/components/VideoPlayer.tsx:983-1040`
  - `frontend/src/components/VideoPlayer.tsx:2329-2342`
  - `frontend/src/components/VideoPlayer.tsx:3188-3195`
- **Evidence**:
  - `<video key={`hls-${key}`} ref={videoRef}>` (`line 3189`) destroys and recreates the underlying `HTMLVideoElement` whenever the user clicks Reload (`handleReload` increments `key` at `line 2341`) or toggles `playerMode` (`'hls'` -> `'embed'` -> `'hls'`).
  - However, `ensureAudioGraph()` (`line 995`) checks `if (!audioCtxRef.current)`. Once created on the initial `<video>`, `audioCtxRef.current` stays truthy, so `ctx.createMediaElementSource(video)` is **never called for the newly mounted `<video>`**!
    1. Volume Boost (`125%–200%`), Night Mode DynamicsCompressor, and 3-Band Equalizer silently stop working after Reload or mode switch, even though the UI badges (`200% Boost`, `Đang chuẩn hóa`) remain illuminated!
    2. `mediaSourceRef.current` retains a strong reference to the detached old `HTMLVideoElement` (DOM + media decoder leak).
    3. Furthermore, persisted `eqPreset !== 'flat'`, `nightAudio === true`, or `volumeBoost > 100` loaded from `localStorage` on mount **never call `ensureAudioGraph()`** until the user manually clicks a control again!
    4. `<video>` (`line 3188`) has no `crossOrigin="anonymous"` attribute — if any stream segment resolves cross-origin with Web Audio attached, browsers zero out the audio buffer (silent playback).
- **Remediation**: Store `boundVideoRef = useRef<HTMLVideoElement | null>(null)` alongside `mediaSourceRef`. In `ensureAudioGraph()`, if `boundVideoRef.current !== video`, disconnect the old `mediaSourceRef.current`, create a new `ctx.createMediaElementSource(video)`, connect it to `eqNodesRef.current[0]`, and update `boundVideoRef.current = video`. Trigger `ensureAudioGraph()` on first user `onPlay` when `volumeBoost > 100 || nightAudio || eqPreset !== 'flat'`.

---

### [HIGH] FE-PLY-03: Persisted Color Filter (`contrast`, `saturation`) & `showHealthGauge` Preferences Wiped on Every Mount

- **Locations**:
  - `frontend/src/components/VideoPlayer.tsx:504-603`
- **Evidence**:
  - `line 504` loads `prefs = loadPlayerPrefs()` from `localStorage` (`bofilm_player_prefs`).
  - Immediately below:
    - `line 506`: initializes `brightness` from `bofilm_player_brightness` (ignoring `prefs.colorFilter.brightness`).
    - `line 516`: `const [contrast, setContrast] = useState<number>(() => DEFAULT_FILTER.contrast);` — ignores `prefs.colorFilter.contrast`!
    - `line 517`: `const [saturation, setSaturation] = useState<number>(() => DEFAULT_FILTER.saturation);` — ignores `prefs.colorFilter.saturation`!
    - `line 563`: `const [showHealthGauge, setShowHealthGauge] = useState<boolean>(false);` — ignores `prefs.showHealthGauge`!
  - On the very first mount cycle, `useEffect` (`lines 567-569`) resets `videoFilter` to `{ brightness, contrast: 1, saturation: 1 }`, and `useEffect` (`lines 576-603`) writes `{ contrast: 1, saturation: 1, showHealthGauge: false }` right back into `localStorage` (`bofilm_player_prefs`), permanently wiping the user's saved color preset (`Cinema`, `Vivid`, `Warm`, `Night`)!
- **Remediation**:
  ```ts
  const [brightness, setBrightness] = useState<number>(() => prefs.colorFilter.brightness);
  const [contrast, setContrast] = useState<number>(() => prefs.colorFilter.contrast);
  const [saturation, setSaturation] = useState<number>(() => prefs.colorFilter.saturation);
  const [showHealthGauge, setShowHealthGauge] = useState<boolean>(() => prefs.showHealthGauge);
  ```

---

### [HIGH] FE-PLY-04: "Audio-Only Data Saver" Mode Continues Downloading & Decoding Full 4K/1080p Video Segments

- **Locations**:
  - `frontend/src/components/VideoPlayer.tsx:1543-1549`
  - `frontend/src/components/VideoPlayer.tsx:3641-3690`
  - `frontend/src/components/VideoPlayer.tsx:4421-4424`
- **Evidence**:
  - Settings menu copy (`line 4422`) promises: *"Ẩn hình ảnh để tiết kiệm pin & băng thông, hiển thị sóng âm động"*.
  - In reality, `handleAudioSaverToggle` (`lines 1543-1549`) only flips `audioSaver`, which renders a `backdrop-blur-sm` overlay + 16 infinitely animating CSS wave bars (`lines 3641-3690`) on top of the active `<video>`.
  - `hlsRef.current` is never capped to the lowest bitrate variant (`hls.currentLevel` / `hls.autoLevelCapping`), so the client continues fetching full 4K/1080p video chunks while the GPU composites a live `backdrop-blur-sm` filter over 24–60fps decoded video frames + 16 CSS animations — **increasing battery drain and saving 0% bandwidth**!
- **Remediation**: When `audioSaver` is enabled, store the user's prior `currentLevel` in a ref, lock `hlsRef.current.nextLevel` to the lowest bitrate index in `hlsRef.current.levels` (`reduce` by `lvl.bitrate || lvl.height`), and hide `<video>` painting (`className={audioSaver ? 'invisible' : ...}`) while removing `backdrop-blur-sm` from the opaque overlay. Restore prior `currentLevel` on disable.

---

### [HIGH] FE-PLY-05: Custom Subtitle `blob:` URL Memory Leak, Cross-Episode Bleed, Double Allocation, & `video.textTracks` Mis-Indexing

- **Locations**:
  - `frontend/src/components/VideoPlayer.tsx:548-551`
  - `frontend/src/components/VideoPlayer.tsx:1319-1330`
  - `frontend/src/components/VideoPlayer.tsx:1387-1400`
  - `frontend/src/components/VideoPlayer.tsx:1626-1630`
- **Evidence**:
  1. **Blob URL Leak on Unmount**: `URL.createObjectURL(blob)` (`lines 1325`, `1395`) is only revoked when replaced or manually removed (`handleSubtitleRemove`), **never on component unmount**.
  2. **Stale Custom Subtitle Across Episode/Movie Changes**: Switching episodes (`episodeSlug` / `movieSlug`) resets HLS tracks (`lines 1658-1667`) while keeping `subtitle` and `baseVttRef.current` active, displaying Episode 1's `.srt` file on Episode 2.
  3. **`ref.current` in `useEffect` Deps Causes Double Blob Allocation**: `line 1399` uses `[subtitleDelay, subtitleVersionRef.current]`. Uploading a subtitle (`lines 1319-1330`) creates `Blob #1`, increments `subtitleVersionRef.current`, and triggers a render — which immediately fires the `useEffect` at `line 1387` to revoke `Blob #1` and create `Blob #2`.
  4. **Wrong `video.textTracks` Index Mapping**: `handleSubtitleSelect` (`lines 1626-1630`) iterates `video.textTracks[i]` and sets `mode = i === trackId ? 'showing' : 'disabled'`. `trackId` is an `hls.subtitleTracks` ID, NOT an index into `video.textTracks` (which also contains `<track>` from custom subtitles or muxed CEA-608 tracks), activating the wrong track when both exist.
- **Remediation**: Track `subtitleUrlRef` and call `URL.revokeObjectURL` on unmount and when `[movieSlug, episodeSlug]` changes; remove `subtitleVersionRef.current` from `useEffect` deps (`subtitleDelay` alone suffices when `handleSubtitleFileChange` already applies `shiftVtt(text, subtitleDelay)`); let `hlsRef.current.subtitleTrack = trackId` manage HLS text tracks and disable only the custom `<track>` element by matching `t.label === subtitle?.name`.

---

### [HIGH] FE-PLY-06: Multi-Server Failover Truncated to `[0]` in `movieDetailAdapter`

- **Locations**:
  - `frontend/src/api.ts:209-211`
  - `frontend/src/api.ts:268-270`
- **Evidence**:
  - `api.ts:209-210`:
    ```ts
    if (raw.episodes[0].server_name && Array.isArray(raw.episodes[0].items)) {
      episodeServers = [raw.episodes[0]];
    }
    ```
  - `api.ts:268-270`:
    ```ts
    const serversList =
      Array.isArray(raw.servers) && raw.servers.length > 0 ? [raw.servers[0]] : [null];
    ```
  - Even though `WatchPage.tsx:270-275`, `EpisodeSelector.tsx:238-272`, and `MovieDetailPage.tsx:301-328` implement full multi-server selection (`Vietsub`, `Thuyết Minh`, `Lồng Tiếng`, `Server #2`), `movieDetailAdapter` discards all servers after index `0` for single movies (`raw.servers`) and non-categorized server arrays (`raw.episodes`), preventing users from switching to backup servers when primary streams fail!
- **Remediation**: Map all entries in `raw.episodes` (`episodeServers = raw.episodes`) and `raw.servers` (`const serversList = Array.isArray(raw.servers) && raw.servers.length > 0 ? raw.servers : [null]`), and group multi-server series episodes across `ep.servers` / `ep.sources`.

---

### [MEDIUM] FE-PLY-07: HLS Quality Persistence Stores Raw Manifest Array Index Instead of Resolution Height

- **Locations**:
  - `frontend/src/components/VideoPlayer.tsx:1579`
  - `frontend/src/components/VideoPlayer.tsx:2039-2044`
  - `frontend/src/components/VideoPlayer.tsx:3998-4005`
- **Evidence**:
  - `handleQualitySelect` (`line 1579`) writes `localStorage.setItem('bofilm_player_quality', String(levelIndex))`, and `MANIFEST_PARSED` (`lines 2039-2044`) restores `hls.currentLevel = savedIdx`. Because HLS master manifests order quality variants arbitrarily across providers (ascending vs. descending), picking `1080p` (`index 2`) on one stream locks the next movie onto `360p` (`index 2`).
  - At `line 3998`, `hlsLevels.map((level) => ...)` re-searches `hlsRef.current?.levels.findIndex(...)` instead of using `level.id` (`line 2031`).
- **Remediation**: Persist target resolution height (`String(level.height)`) in `bofilm_player_quality`, resolve the matching or nearest `hls.levels` entry on `MANIFEST_PARSED`, and pass `level.id` directly to `handleQualitySelect(level.id)`.

---

### [MEDIUM] FE-PLY-08: Stale `?t=` Deep-Link Rewinds Playback on Reload & `parseEpisodeNum` Extracts Season Number on `s2-tap-5`

- **Locations**:
  - `frontend/src/components/VideoPlayer.tsx:449-462`, `1829-1845`, `1854`, `1975`
  - `frontend/src/components/WatchPage.tsx:16-32`
- **Evidence**:
  1. When entering from Continue Watching (`/xem-phim/slug/tap-1?t=300`), `deepLinkTime` stays `300` in state as long as `?t=300` remains in `window.location.search`. If the user watches for 30 minutes (`savedPositionRef.current = 2100`) and clicks **Reload** (`handleReload`), `line 1975` (`const savedPosition = deepLinkTime > 0 ? deepLinkTime : savedPositionRef.current`) jumps backward to `300s`!
  2. Both `parseEpisodeNumber` (`WatchPage.tsx:16-32`) and `parseEpisodeNum` (`VideoPlayer.tsx:1829-1845`) execute `slug.match(/\d+/)`, which returns the **first** number in the slug. On multi-season URLs like `s2-tap-5` or `s02e05`, `match[0]` returns **`2` (the season)** instead of **`5` (the episode)** whenever `globalIndex` is unavailable (e.g., `VideoPlayer.tsx:1854` auto-ingest HEAD check).
- **Remediation**: Track `deepLinkConsumedRef = useRef(false)` (reset on `[movieSlug, episodeSlug]` change) so `deepLinkTime` applies only to the initial load; update `parseEpisodeNumber`/`parseEpisodeNum` to check `/^s\d+[-_\s]*(?:e|tap|ep)[-_\s]*(\d+)/i` before falling back to `/\d+/`.

---

### [MEDIUM] FE-PLY-09: Seekbar Drag Window Listener Leak, Triple-Seek per Click, Missing Touch Drag, & Hold-to-2x Tap Collision

- **Locations**:
  - `frontend/src/components/VideoPlayer.tsx:2486-2577`, `2602-2616`, `2661-2703`, `3760-3767`
- **Evidence**:
  1. `handleSeekbarMouseDown` (`lines 2701-2702`) binds `window` `mousemove`/`mouseup` listeners with no unmount cleanup if the component unmounts mid-scrub, plus an untracked `setTimeout` (`line 2695`).
  2. A single click on the seekbar fires `onMouseDown` (seek 1), `mouseup` (seek 2), and `onClick` (`handleSeekbarClick`, seek 3), causing triple MSE buffer seeks.
  3. The seekbar (`lines 3760-3767`) has no `PointerEvent` or `TouchEvent` drag handlers and no `role="slider"` / `aria-valuenow` / keyboard attributes (`frontend-a11y` violation).
  4. On mobile touchscreens, releasing Hold-to-2x (`endHold`, `line 2609`) sets `suppressClickRef.current = true`, which `handleTouchEnd` (`line 2486`) ignores — triggering unwanted control toggles or double-tap seeks upon releasing a 2x speed hold.
- **Remediation**: Migrate seekbar scrubbing to unified `PointerEvent` (`onPointerDown` + `setPointerCapture`), remove duplicate `onClick={handleSeekbarClick}`, add `role="slider" aria-label="Thanh tua thời gian" aria-valuemin={0} aria-valuemax={Math.floor(duration)} aria-valuenow={Math.floor(currentTime)} tabIndex={0}`, and check/reset `suppressClickRef.current` at the top of `handleTouchEnd`.

---

### [LOW] FE-PLY-10: Two-Packet Sync Check (`0x47` at `i` and `i + 188`) in `stripPngHeader` Fallback

- **Locations**:
  - `frontend/src/utils/hlsLoader.ts:78-88`
- **Evidence**:
  - If an obfuscated chunk lacks a valid PNG `IEND` chunk and fMP4 header, Method 3 (`lines 78-88`) accepts the first `bytes[i] === 0x47` where `bytes[i + 188] === 0x47`. Inside compressed PNG `IDAT` data >64 KB, a random two-byte `0x47` match occurs with ~`1/65,536` probability per byte; requiring 3 sync bytes (`i`, `i + 188`, `i + 376` when `i + 376 < bytes.length`) reduces false-positive slicing to `1/16,777,216`.

---

## 4. React, TypeScript, Bundle & Code Quality Audit Findings

### [HIGH] FE-ARC-01: Broken Home Shelf Categorization in `getHome()` Masked by `any` Casts

- **Locations**:
  - `frontend/src/api.ts:80-138`
  - `frontend/src/api.ts:328-371`
- **ECC Standard Violated**: `.gemini/GEMINI.md` (*Type safety, avoid `any`, fail loudly instead of silently producing wrong state*).
- **Evidence**:
  - In `api.ts:332`:
    ```ts
    const allList = (raw.list || []).map(summaryToMovieItem);
    ```
  - `summaryToMovieItem` (`lines 120-137`) strips `movie_type`, `type`, and `genres` because `MovieItem` (`types.ts:1-18`) does not define them!
  - Immediately below (`lines 339-362`), `getHome()` filters `allList` using `(m: any)`:
    - `line 340`: `allList.filter((m: any) => m.movie_type === 'tv' || m.type === 'tv')` -> **always `[]`** (`m.movie_type` is `undefined`).
    - `line 350`: `!m.movie_type` -> **always `true`** (TV series pollute `single` / "Phim Lẻ Chiếu Rạp").
    - `line 356`: `m.genres?.some(...)` -> **always `undefined`** (`anime` is always `[]`, falling back on `line 370` to `single.slice(0, 12)`, displaying live-action movies under "Hoạt Hình & Anime Đặc Sắc"!).
- **Remediation**: Filter `raw.list` **before** mapping through `summaryToMovieItem` (or add `movie_type?: 'movie' | 'tv'` and `genres?: string[]` to `MovieItem` and `summaryToMovieItem`), and eliminate `(m: any)` casts in `api.ts`.

---

### [HIGH] FE-ARC-02: Catalog Route vs. `FilterBar` Desynchronization & Stale Pagination Across Route Navigation

- **Locations**:
  - `frontend/src/App.tsx:151-156`
  - `frontend/src/App.tsx:178-216`
  - `frontend/src/components/FilterBar.tsx:57-110`
  - `frontend/src/components/CatalogView.tsx:276-283`
- **Evidence**:
  1. **Route Overrides `FilterBar` Selections**: `App.tsx:194-199` computes:
     ```ts
     category: route.view === 'category' ? route.slug : catalogFilters.category,
     genre: route.view === 'genre' ? route.slug : catalogFilters.genre,
     country: route.view === 'country' ? route.slug : catalogFilters.country,
     year: route.view === 'year' ? route.slug : catalogFilters.year,
     ```
     When a user visits `/danh-sach/phim-bo` (`route.view === 'category'`) and clicks **"Phim Lẻ"** or **"Hoạt Hình"** in `FilterBar`, `catalogFilters.category` updates and highlights the "Phim Lẻ" button green, yet `App.tsx:194` still sends `category: 'phim-bo'` to `/api/movies`! The same bug breaks Genre selection on `/the-loai/*`, Country selection on `/quoc-gia/*`, Year selection on `/nam-phat-hanh/*`, and empty-state popular pills (`CatalogView.tsx:276-283`).
  2. **Stale Page & Sub-Filters Across Navigation**: Clicking Header/Footer links (`navigateTo('/the-loai/hanh-dong')`) never resets `catalogFilters` (`page`, `sort`, `genre`, `country`, `year`), carrying stale `page: 3` or conflicting filters onto the new route.
  3. **`currentPath` Query-String Drift**: `navigateTo(path)` (`App.tsx:153`) sets `currentPath` to the full string including `?keyword=...` or `?t=...`, whereas initial load (`line 133`) and `popstate` (`line 160`) set `window.location.pathname`.
- **Remediation**: Synchronize route and filter state: when navigating via `navigateTo`, reset `catalogFilters` to `{ page: 1 }` and set `setCurrentPath(window.location.pathname)`; when `FilterBar` changes a dimension locked by the current URL (`category`/`genre`/`country`/`year`), navigate to `/danh-sach/phim-moi` (or the new route slug) so URL, page title, and query stay 100% consistent.

---

### [HIGH] FE-ARC-03: 702 KB of Dead Source Modules, Scraped Third-Party CSS, & Conflicting Duplicate Storage Utilities

- **Locations**:
  - `frontend/src/film4k.css:1` (`153 KB`, 0 imports)
  - `frontend/src/film4k_videojs.css:1` (`83 KB`, 0 imports)
  - `frontend/src/utils/spiderManBrandNewDaySubtitles.json:1` (`466 KB`, imported only by dead `subtitles.ts`)
  - `frontend/src/utils/subtitles.ts:1-262` (0 imports; also has single-segment HLS VTT bug at `lines 201-204` & cross-episode global `SUBTITLE_TRACKS[slug]` cache at `line 256`)
  - `frontend/src/utils/movieConfig.ts:1-91` (0 imports; defines unused `bofilm_movie_config_${slug}` & `bofilm_subtitle_settings` conflicting with `VideoPlayer.tsx:132` `bofilm_player_prefs`)
  - `frontend/src/utils/myList.ts:1-114` (0 imports; defines unused `bofilm_my_list` conflicting with `src/utils.ts:4` `bofilm_favorites`)
  - `frontend/src/utils/watchProgress.ts:1-142` (0 imports; defines unused `bofilm_continue_watching` conflicting with `src/utils.ts:3,214` `bofilm_history` + `bofilm_resume_*`)
  - `frontend/src/index.css:44-86`, `106-171` (`.avocado-glass`, `.avocado-glass-card`, `.avocado-glow`, `.avocado-glow-sm`, `.touch-target-44`, `input.cinema-volume-slider` have 0 usages; manual `.line-clamp-1..3` overrides Tailwind utilities)
  - `frontend/tsconfig.json:16-17` (`"noUnusedLocals": false`, `"noUnusedParameters": false` hiding 23 unused declarations across 11 files)
- **Remediation**: Remove the 7 dead files (`702 KB`), remove unused CSS classes in `index.css`, clean the 23 unused imports/variables flagged by `tsc`, and set `"noUnusedLocals": true` and `"noUnusedParameters": true` in `tsconfig.json`.

---

### [MEDIUM] FE-ARC-04: Monolithic God Components (`VideoPlayer` 4,723 LOC, `AdminDashboard` 2,683 LOC) & Avoidable Re-Render Cascades

- **Locations**:
  - `frontend/src/components/AdminDashboard.tsx:140-148`
  - `frontend/src/components/RelatedMoviesRow.tsx:23-47`
  - `frontend/src/components/WatchPage.tsx:297-306`, `480-490`
  - `frontend/src/components/MovieDetailPage.tsx:122-131`, `354-358`
  - `frontend/src/components/VideoPlayer.tsx:404-410`, `1809-1813`
  - `frontend/src/App.tsx:257-269`
- **ECC Standard Violated**: `.gemini/GEMINI.md` (*"Keep functions small and files focused"*); `react-patterns` & `react-performance` (`rerender-` priority rules).
- **Evidence**:
  1. **1 Hz Full-Tree Re-Render in `AdminDashboard` (`lines 143-148`)**: `setInterval` updates `currentTimeStr` every `1000ms` at the root of `AdminDashboard` (2,683 LOC), re-rendering all stat cards, terminal log entries, and up to 100 movie rows every second (even when `document.hidden` is `true`).
  2. **`RelatedMoviesRow` Skeleton Flash on Every Parent Re-Render**: `WatchPage.tsx:297` and `MovieDetailPage.tsx:122` allocate a new `genresList` array on every render and pass `genres={genresList}` into `RelatedMoviesRow`, whose `useEffect` (`RelatedMoviesRow.tsx:47`) depends on `[currentSlug, genres]` and calls `setLoading(true)` (`line 25`). Clicking Bookmark, Share, Server tab, or Theater Mode flashes the entire Related Movies grid back to a skeleton loader!
  3. **4 Hz `keydown` Listener Teardown in `VideoPlayer`**: `toggleTheater` (`VideoPlayer.tsx:404`) is unmemoized and listed in `useEffect` deps (`line 1813`). Because `onTimeUpdate` triggers `setCurrentTime` ~4x/sec, `window` `keydown` listeners are removed and re-added 4 times per second.
  4. **Component Defined Inside Render (`App.tsx:257-269`)**: `function PageLoadingFallback` is declared inside `App()`, creating a new component identity on every `App` render.
- **Remediation**: Isolate `<AdminClock />` into its own tiny component; pass `genreHint = genres[0]` as a primitive string in `RelatedMoviesRow` `useEffect([currentSlug, genreHint])`; wrap `toggleTheater` and `toggleFullscreen` in `useCallback`; hoist `PageLoadingFallback` to module top-level; modularize `VideoPlayer` and `AdminDashboard` into focused subcomponents and custom hooks.

---

### [MEDIUM] FE-ARC-05: Unhandled Rejection in `getMovieDetail()`, False-Success Admin Cache Purge, Missing Request Cancellation, & Orphaned Resume Keys

- **Locations**:
  - `frontend/src/api.ts:20-52`, `143-144`, `451-466`
  - `frontend/src/components/WatchPage.tsx:187-199`
  - `frontend/src/components/MovieDetailPage.tsx:36-53`
  - `frontend/src/components/AdminDashboard.tsx:329-334`, `563-569`, `684-705`
  - `frontend/src/components/MyListPage.tsx:20-35`
  - `frontend/src/components/HistoryPage.tsx:31-36` & `frontend/src/utils.ts:133-137`
- **Evidence**:
  1. **Infinite Spinner on Malformed Detail Payload**: `movieDetailAdapter(raw)` (`api.ts:144`) throws synchronously if `raw.movie` is null/empty, causing `getMovieDetail()` (`api.ts:459`) to reject. Neither `WatchPage.tsx:187` nor `MovieDetailPage.tsx:36` attaches `.catch(...)`, leaving `loading === true` permanently on rejection.
  2. **False-Success Admin Cache Clear (`AdminDashboard.tsx:689-700`)**: `handleClearMovieCache` never checks `if (!res.ok)` — HTTP `404`/`500` responses still log `[SUCCESS]` and display `🗑️ Đã xóa cache M3U8`, and `moviesList` is never updated (`m.has_cached_m3u8` stays `true` in UI).
  3. **Race Conditions Without `AbortController`**: `AdminDashboard.tsx:563-569` (`fetchMovies`) and `MyListPage.tsx:20-35` (`loadFavs`) do not cancel superseded in-flight requests; `AdminDashboard.tsx:329-334` (`showToast`) does not clear previous `setTimeout` timers.
  4. **Unbounded `memoryCache` & Orphaned `localStorage` Keys**: `api.ts:20` `memoryCache` has no max-entries cap (`MAX_CACHE_SIZE = 200`); `HistoryPage.tsx:33` calls `clearHistory()` (`utils.ts:133`), which removes `bofilm_history` while leaving all `bofilm_resume_*` keys orphaned in `localStorage`.
- **Remediation**: Wrap `movieDetailAdapter` inside `try/catch` in `getMovieDetail` returning `null`; check `if (!res.ok) throw new Error(...)` in `handleClearMovieCache` and optimistically update `moviesList`; add `AbortController` to `fetchMovies` and `MyListPage`; call `clearAllPlaybackPositions()` inside `clearHistory()` and cap `memoryCache` at 200 LRU entries.

---

### [MEDIUM] FE-ARC-06: Broken `React.lazy` Chunk-Error Recovery in `index.html` & Misconfigured `manualChunks` (`index.js` Bloated to 350 KB)

- **Locations**:
  - `frontend/index.html:28-56`
  - `frontend/vite.config.ts:25-29`
  - `frontend/src/App.tsx:18`, `287`
- **ECC Standard Violated**: `react-performance` §2 (`bundle-` Critical priority).
- **Evidence**:
  1. **Broken Stale-Chunk Self-Healing (`index.html:29-55`)**: `window.addEventListener('error', ...)` never fires when a `React.lazy(() => import(...))` dynamic import rejects after a redeploy — rejected dynamic imports emit `unhandledrejection` or get swallowed by React's `<ErrorBoundary>` (`App.tsx:287`). Furthermore, `lines 41-52` fire `setTimeout(() => window.location.reload(), 100)` without awaiting `Promise.all` over `r.unregister()` and `caches.delete(k)`.
  2. **Misconfigured `manualChunks` (`vite.config.ts:25-29`)**:
     ```ts
     manualChunks: {
       'vendor-hls': ['hls.js'],
       'vendor-react': ['react', 'react-dom'],
       'vendor-icons': ['lucide-react'],
     }
     ```
     In React 19, `react-dom/client` (`src/main.tsx:2`) resolves to `node_modules/react-dom/cjs/react-dom-client.production.js` + `scheduler`, which Rollup's static `'vendor-react': ['react', 'react-dom']` list misses! As verified by `vite build`, `vendor-react` is only **`4.22 kB`**, while `index-*.js` balloons to **`349.95 kB`** (`103.50 kB` gzip), also bundling `MovieDetailPage` + `dompurify` eagerly on the home route!
- **Remediation**:
  ```ts
  // vite.config.ts
  manualChunks(id) {
    if (id.includes('node_modules/hls.js')) return 'vendor-hls';
    if (
      id.includes('node_modules/react/') ||
      id.includes('node_modules/react-dom/') ||
      id.includes('node_modules/scheduler/')
    ) {
      return 'vendor-react';
    }
    if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
    if (id.includes('node_modules/dompurify')) return 'vendor-sanitize';
  }
  ```
  Lazy-load `MovieDetailPage` via `React.lazy`, add `window.addEventListener('unhandledrejection', ...)` + chunk-error detection inside `ErrorBoundary.componentDidCatch`, and `Promise.all` cache/SW cleanup before `window.location.reload()`.

---

### [LOW] FE-ARC-07: JSX Attribute Typo in `HeroBanner`, Same-Tab Header Favorite Sync, Missing `/placeholder.png`, Domain Mismatch, & Mobile Dialog Accessibility

- **Locations**:
  - `frontend/src/components/HeroBanner.tsx:19-25`, `51`
  - `frontend/src/components/Header.tsx:25-41` & `frontend/src/utils.ts:153-171`
  - `frontend/src/components/AdminDashboard.tsx:2177`, `2222`
  - `frontend/src/constants.ts:5` vs `frontend/src/components/Footer.tsx:40`
  - `frontend/src/components/MobileBottomNav.tsx:105-109`, `160-165`
  - `frontend/src/types.ts:119-123`, `203-238`
- **Evidence**:
  1. **`HeroBanner.tsx:51`**: `className="max-w-2xl ... duration-500 key={current.slug}"` places `key={current.slug}` inside the `className` string literal instead of as a JSX prop, preventing slide entrance animations and emitting a literal `key={...}` class. Also `lines 19-25` auto-rotate every 6s without pausing on hover/focus or respecting `prefers-reduced-motion`.
  2. **Same-Tab `favCount` Stale in `Header` (`Header.tsx:39`)**: `window.addEventListener('storage', updateCounts)` only fires for *cross-tab* storage events. Dispatch `window.dispatchEvent(new Event('bofilm_favorites_update'))` in `toggleFavorite()` (`utils.ts:165`) and subscribe to both `'bofilm_favorites_update'` and `'bofilm_history_update'` in `Header.tsx`, plus add `{ passive: true }` to `window.addEventListener('scroll', handleScroll, { passive: true })` (`Header.tsx:29`).
  3. **Missing `/placeholder.png` & Fabricated Year in `AdminDashboard` (`lines 2177`, `2222`)**: `<img src={m.poster || '/placeholder.png'}>` 404s because `public/placeholder.png` does not exist (use `getImageUrl(m.poster)` which falls back to `'/logo.png'`), and `{m.year || 2026}` displays `2026` when `year` is missing (use `{m.year || '—'}`).
  4. **Domain Constant Drift**: `constants.ts:5` defines `SITE_URL = "https://secret.dangducminh.io.vn"`, while `Footer.tsx:40` hardcodes `secret1.dangducminh.io.vn`.
  5. **Mobile Dialog Focus/Escape**: `MobileBottomNav.tsx:105` & `160` use `<div role="dialog" aria-modal="true">` without `Escape` key handlers or focus trapping; convert to native `<dialog>` matching `VideoPlayer.tsx:2837`.
  6. **Type Safety Cleanup**: Remove unused `Movie`, `Episode`, `FilmDetailResponse` from `types.ts` and replace the 65 `any` occurrences across `VideoPlayer.tsx` (28), `api.ts` (18), `hlsLoader.ts` (10), `AdminDashboard.tsx` (7), `LiveSearch.tsx` (1), and `types.ts` (1) with typed interfaces (`Hls` event payloads, `unknown` in `catch` blocks, and typed raw API schemas).

---

## 5. Prioritized Remediation Roadmap

### Phase 1 — Immediate Critical & High Security / Playback Fixes (Day 1)
1. **Harden `<iframe src={embedUrl}>` (`FE-SEC-01`)**: Enforce `http(s):` protocol whitelist, block same-origin URLs when `allow-same-origin` is set, and add `referrerPolicy="no-referrer"`.
2. **Fix Service Worker Media Interception (`FE-PLY-01`)**: Bypass cross-origin requests and `.m3u8`/`.ts`/`.m4s`/`.mp4`/`.vtt` paths in `public/sw.js`, and fix the broken `caches.match('/') || ...` Promise truthiness bug.
3. **Fix Home Shelf Filtering & Multi-Server Truncation (`FE-ARC-01`, `FE-PLY-06`)**: Filter `raw.list` before `summaryToMovieItem` in `api.ts:332` and stop truncating `[raw.servers[0]]` / `[raw.episodes[0]]` in `movieDetailAdapter`.
4. **Fix Player Preference Wipe, Web Audio Remount, Subtitle Leaks, & Data Saver (`FE-PLY-02..05`)**: Initialize `contrast`/`saturation`/`showHealthGauge` from `prefs`, rebind `MediaElementAudioSourceNode` when `<video>` remounts, cap `hls.nextLevel` in Audio Saver mode, and revoke/reset custom subtitle Blob URLs on unmount and episode switch.

### Phase 2 — Auth Hardening, State Consistency & Bundle Optimization (Week 1)
5. **Migrate Admin Token to `HttpOnly` Cookie + Harden `DOMPurify` & URL Encoding (`FE-SEC-02..04`)**.
6. **Unify Catalog Route & `FilterBar` State + Fix Error Handling (`FE-ARC-02`, `FE-ARC-05`)**.
7. **Delete 702 KB Dead Files & Fix `manualChunks` (`FE-ARC-03`, `FE-ARC-06`)**: Delete `film4k.css`, `film4k_videojs.css`, `spiderManBrandNewDaySubtitles.json`, `subtitles.ts`, `movieConfig.ts`, `myList.ts`, `watchProgress.ts`; enable `noUnusedLocals` & `noUnusedParameters`; fix `vendor-react` chunking in `vite.config.ts`.

### Phase 3 — Modularization, Accessibility & Automated Player Tests (Week 2)
8. **Decompose Monolithic Components (`FE-ARC-04`)**: Split `VideoPlayer.tsx` (4,723 LOC) and `AdminDashboard.tsx` (2,683 LOC) into focused subcomponents/hooks, isolate `<AdminClock />`, stabilize `RelatedMoviesRow` `genres` dependency, and add unit tests for `hlsLoader.ts`, `getHome()`, and `VideoPlayer` lifecycle cleanup.
