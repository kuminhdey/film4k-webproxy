// /Users/kuminhdey/Downloads/webproxy/docs/audit_artifacts/verified_after/web_player/run_phase3_verify.cjs
// Phase 3 Post-Remediation Live Playwright Regression & Upstream Playback Verifier (Port 18091)

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PW_PATHS = [
  '/Users/kuminhdey/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
  '/Users/kuminhdey/Downloads/Minh_Test/node_modules/playwright',
  'playwright',
];
let playwright = null;
for (const p of PW_PATHS) {
  try {
    playwright = require(p);
    break;
  } catch (_) {}
}
if (!playwright) throw new Error('Playwright not found');

const REPO_ROOT = '/Users/kuminhdey/Downloads/webproxy';
const OUT_DIR = path.join(REPO_ROOT, 'docs/audit_artifacts/verified_after/web_player');
const PORT = 18091;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEMP_DB = `/tmp/verify_after_web_${PORT}.db`;
const TEMP_PLAYLISTS = `/tmp/verify_after_playlists_${PORT}`;
const TEMP_CWD = `/tmp/verify_after_cwd_${PORT}`;
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TEMP_PLAYLISTS, { recursive: true });
fs.mkdirSync(TEMP_CWD, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function waitForHealth(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, { timeout: 1500 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await wait(250);
  }
  return false;
}

const CLS_INIT_SCRIPT = `
  window.__cwv = { cls: 0, lcp: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__cwv.cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__cwv.lcp = e.startTime;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) {}
`;

async function waitForRealPlayback(page, maxWaitMs = 35000) {
  const start = Date.now();
  const streamEvents = [];
  const onRes = (res) => {
    const u = res.url();
    if (
      u.includes('/api/stream/') ||
      u.includes('/stream/') ||
      u.includes('/proxy/stream') ||
      u.includes('?url=') ||
      u.includes('.m3u8') ||
      u.includes('.ts') ||
      u.includes('.m4s')
    ) {
      streamEvents.push({
        status: res.status(),
        url: u.slice(0, 200),
        ct: res.headers()['content-type'] || '',
      });
    }
  };
  page.on('response', onRes);

  try {
    while (Date.now() - start < maxWaitMs) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        if (v.paused && v.readyState >= 2) {
          v.muted = true;
          v.play().catch(() => {});
        } else if (v.paused) {
          v.muted = true;
          v.play().catch(() => {});
        }
        return {
          readyState: v.readyState,
          networkState: v.networkState,
          paused: v.paused,
          muted: v.muted,
          currentTime: v.currentTime,
          duration: v.duration,
          videoWidth: v.videoWidth,
          videoHeight: v.videoHeight,
          error: v.error ? { code: v.error.code, message: v.error.message } : null,
        };
      });

      if (state && state.readyState >= 2 && state.currentTime > 2.2) {
        return {
          passed: true,
          elapsedWallMs: Date.now() - start,
          video: state,
          streamEventsCount: streamEvents.length,
          streamEventsSample: streamEvents.slice(0, 25),
        };
      }
      await wait(500);
    }

    const finalState = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v
        ? {
            readyState: v.readyState,
            networkState: v.networkState,
            paused: v.paused,
            currentTime: v.currentTime,
            duration: v.duration,
            videoWidth: v.videoWidth,
            videoHeight: v.videoHeight,
            error: v.error ? { code: v.error.code, message: v.error.message } : null,
            alertText: document.querySelector('[role="alert"]')?.innerText || null,
          }
        : null;
    });
    return {
      passed: false,
      elapsedWallMs: Date.now() - start,
      video: finalState,
      streamEventsCount: streamEvents.length,
      streamEventsSample: streamEvents.slice(0, 30),
    };
  } finally {
    page.off('response', onRes);
  }
}

async function main() {
  let backendProc = null;
  let browser = null;
  const realDbPath = path.join(REPO_ROOT, 'movies.db');
  const dbShaBefore = sha256File(realDbPath);

  const summary = {
    verifiedAt: new Date().toISOString(),
    port: PORT,
    dbShaBefore,
    checks: {},
    consoleErrors: [],
    pageErrors: [],
  };

  try {
    fs.copyFileSync(realDbPath, TEMP_DB);
    const fgSymlink = path.join(TEMP_CWD, 'frontend');
    if (!fs.existsSync(fgSymlink)) {
      fs.symlinkSync(path.join(REPO_ROOT, 'frontend'), fgSymlink);
    }

    backendProc = spawn(path.join(REPO_ROOT, 'target/debug/webproxy_backend'), [], {
      cwd: TEMP_CWD,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(PORT),
        DATABASE_PATH: TEMP_DB,
        PLAYLISTS_DIR: TEMP_PLAYLISTS,
        STATIC_DIR: path.join(REPO_ROOT, 'frontend/dist'),
        ADMIN_PASSWORD: 'VerifyStrongPass2026!',
        RUST_LOG: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const backendLogs = [];
    backendProc.stdout.on('data', (d) => backendLogs.push(d.toString()));
    backendProc.stderr.on('data', (d) => backendLogs.push(d.toString()));

    const healthy = await waitForHealth(`${BASE_URL}/api/health`, 20000);
    if (!healthy) {
      throw new Error('Backend failed healthcheck on ' + BASE_URL);
    }
    // Wait ~3.5s so startup /api/home sync populates Anime & catalog shelves cleanly
    await wait(3500);

    // Check static asset byte sizes on disk in frontend/dist
    const distAssets = ['logo.png', 'logo-64.png', 'favicon-32.png', 'favicon.ico', 'favicon.png'];
    summary.checks.staticAssetSizesBytes = {};
    for (const f of distAssets) {
      const p = path.join(REPO_ROOT, 'frontend/dist', f);
      if (fs.existsSync(p)) {
        summary.checks.staticAssetSizesBytes[f] = fs.statSync(p).size;
      }
    }

    browser = await playwright.chromium.launch({
      headless: true,
      executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
    });

    // =========================================================================
    // 1. DESKTOP 1440x900 STOREFRONT, CWV, TASTE 2.5, SEARCH & SORT
    // =========================================================================
    const dCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'vi-VN',
    });
    await dCtx.addInitScript(CLS_INIT_SCRIPT);
    const page = await dCtx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') summary.consoleErrors.push(m.text().slice(0, 250));
    });
    page.on('pageerror', (e) => summary.pageErrors.push(String(e).slice(0, 300)));

    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await wait(1000);
    await page.screenshot({ path: path.join(OUT_DIR, '01_after_desktop_home_hero.png'), fullPage: false });

    summary.checks.desktopHome = await page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const hero = document.querySelector('main section, main > div > div:first-child');
      const heroRect = hero ? hero.getBoundingClientRect() : null;
      const firstShelfHeading = Array.from(document.querySelectorAll('h2'))[0];
      const h2Rect = firstShelfHeading ? firstShelfHeading.getBoundingClientRect() : null;

      // Semantic nav links check
      const headerAnchors = Array.from(document.querySelectorAll('header nav a')).map((a) => ({
        text: (a.innerText || '').trim(),
        href: a.getAttribute('href'),
        ariaCurrent: a.getAttribute('aria-current'),
      }));
      const skipLink = !!document.querySelector('a[href="#main-content"], a[href^="#main"]');

      // Shelves content check (Anime vs Single Movies)
      const sections = Array.from(document.querySelectorAll('main section')).map((sec) => {
        const title = sec.querySelector('h2')?.innerText.trim() || '';
        const items = Array.from(sec.querySelectorAll('h3')).map((h) => h.innerText.trim());
        return { title, items };
      });

      const imgs = Array.from(document.querySelectorAll('img'));
      const missingDims = imgs.filter((i) => !i.getAttribute('width') && !i.getAttribute('height') && getComputedStyle(i).aspectRatio === 'auto').length;

      return {
        cls: Number((window.__cwv?.cls || 0).toFixed(4)),
        lcpMs: Math.round(window.__cwv?.lcp || 0),
        scrollWidth: document.documentElement.scrollWidth,
        vw,
        vh,
        heroBottomY: heroRect ? Math.round(heroRect.bottom) : null,
        firstShelfH2TopY: h2Rect ? Math.round(h2Rect.top) : null,
        heroFillsFirstScreenCleanly: h2Rect ? h2Rect.top >= vh - 8 : true,
        headerAnchors,
        skipLink,
        shelves: sections,
        imagesTotal: imgs.length,
        imagesMissingDimsAndRatio: missingDims,
      };
    });

    // Catalog Sort ("name_asc" / Tên A-Z) verification
    await page.goto(`${BASE_URL}/danh-sach/phim-le`, { waitUntil: 'networkidle' });
    await wait(600);
    const beforeSort = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main h3')).map((h) => h.innerText.trim())
    );
    const sortSel = page.locator('select[aria-label*="Sắp xếp"], select').last();
    await sortSel.selectOption('name_asc');
    await wait(800);
    await page.screenshot({ path: path.join(OUT_DIR, '10_after_desktop_catalog_sort_az.png'), fullPage: false });
    const afterSort = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main h3')).map((h) => h.innerText.trim())
    );
    summary.checks.catalogSortNameAsc = {
      beforeFirst5: beforeSort.slice(0, 5),
      afterFirst5: afterSort.slice(0, 5),
      orderChanged: JSON.stringify(beforeSort) !== JSON.stringify(afterSort),
    };

    // Search Empty State + Reset CTA + No Dropdown Overlap
    await page.goto(`${BASE_URL}/tim-kiem?keyword=zzzznotfound99999`, { waitUntil: 'networkidle' });
    await wait(600);
    await page.screenshot({ path: path.join(OUT_DIR, '11_after_desktop_search_empty.png'), fullPage: false });
    summary.checks.searchEmptyState = await page.evaluate(() => {
      const mainText = document.querySelector('main')?.innerText || '';
      const resetBtn = Array.from(document.querySelectorAll('main button, main a')).find((el) =>
        /Đặt lại|Xóa tìm kiếm|Xóa bộ lọc/i.test(el.innerText || '')
      );
      return {
        hasSearchSpecificHeading: mainText.includes('Không tìm thấy phim cho "zzzznotfound99999"'),
        hasResetButton: !!resetBtn,
        resetButtonText: resetBtn ? resetBtn.innerText.trim() : null,
      };
    });

    // Detail Page: Single Movie (`spider-man-brand-new-day`) — Multi-Server badges, Synopsis measure & CLS, no redundant 1-ep grid
    await page.goto(`${BASE_URL}/phim/spider-man-brand-new-day`, { waitUntil: 'networkidle' });
    await wait(800);
    await page.screenshot({ path: path.join(OUT_DIR, '04_after_desktop_detail_spiderman_servers.png'), fullPage: false });
    summary.checks.detailSingleMovie = await page.evaluate(() => {
      const mainText = document.querySelector('main')?.innerText || '';
      const serverBtns = Array.from(document.querySelectorAll('main button, main a'))
        .map((el) => (el.innerText || '').trim())
        .filter((t) => /Server|Dự Phòng|VIP|Direct CDN/i.test(t));
      const synContainer = Array.from(document.querySelectorAll('main h2'))
        .find((h) => h.innerText.includes('Nội Dung'))
        ?.parentElement;
      const synProse = synContainer?.querySelector('div[class*="text-"]');
      const synRect = synProse ? synProse.getBoundingClientRect() : null;
      return {
        cls: Number((window.__cwv?.cls || 0).toFixed(4)),
        serverButtons: serverBtns,
        hasMultipleServers: serverBtns.length >= 2,
        hasRedundantSingleEpList: mainText.includes('Danh Sách Tập Phim') && mainText.includes('1 tập'),
        synopsisWidthPx: synRect ? Math.round(synRect.width) : null,
      };
    });

    // =========================================================================
    // 2. REAL UPSTREAM PLAYBACK & PLAYER UX / ACCESSIBILITY (DESKTOP 1440x900)
    // =========================================================================
    // 2A. Single Movie: `/xem-phim/spider-man-brand-new-day/full`
    const playPage1 = await dCtx.newPage();
    await playPage1.addInitScript(CLS_INIT_SCRIPT);
    await playPage1.goto(`${BASE_URL}/xem-phim/spider-man-brand-new-day/full`, { waitUntil: 'domcontentloaded' });
    const spiderPlayback = await waitForRealPlayback(playPage1, 40000);
    // Hover player so controls + visible timestamp show in screenshot
    const vBox1 = await playPage1.locator('video').first().boundingBox().catch(() => null);
    if (vBox1) {
      await playPage1.mouse.move(vBox1.x + vBox1.width / 2, vBox1.y + vBox1.height - 25);
      await wait(300);
    }
    await playPage1.screenshot({ path: path.join(OUT_DIR, '05_after_desktop_watch_spiderman_playing.png'), fullPage: false });

    summary.checks.spidermanWatchPage = await playPage1.evaluate(() => {
      const serverBtns = Array.from(document.querySelectorAll('main button'))
        .map((b) => (b.innerText || '').trim())
        .filter((t) => /Server|Dự Phòng|VIP|Direct CDN/i.test(t));
      return {
        cls: Number((window.__cwv?.cls || 0).toFixed(4)),
        serverButtonsOnWatchPage: serverBtns,
      };
    });
    summary.checks.spidermanPlayback = spiderPlayback;
    await playPage1.close();

    // Check `jurassic-park` multi-server presence too
    await page.goto(`${BASE_URL}/xem-phim/jurassic-park/full`, { waitUntil: 'networkidle' }).catch(() => {});
    await wait(800);
    summary.checks.jurassicParkServers = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('main button'))
        .map((b) => (b.innerText || '').trim())
        .filter((t) => /Server|Dự Phòng|VIP/i.test(t));
    });

    // 2B. Multi-Episode Series Ep 2: `/xem-phim/light-to-the-night/tap-2`
    const playPage2 = await dCtx.newPage();
    await playPage2.addInitScript(CLS_INIT_SCRIPT);
    await playPage2.goto(`${BASE_URL}/xem-phim/light-to-the-night/tap-2`, { waitUntil: 'domcontentloaded' });
    const seriesEp2Playback = await waitForRealPlayback(playPage2, 40000);

    const vBox2 = await playPage2.locator('video').first().boundingBox().catch(() => null);
    if (vBox2) {
      await playPage2.mouse.move(vBox2.x + vBox2.width / 2, vBox2.y + vBox2.height - 25);
      await wait(300);
    }
    await playPage2.screenshot({ path: path.join(OUT_DIR, '06_after_desktop_watch_series_ep2_playing.png'), fullPage: false });

    // Inspect Player UX, Timestamp visibility, Seekbar ARIA + keyboard, Icon button aria-labels, Volume focus ring, 4-tab Settings, Modal <dialog>, Service Worker CacheStorage!
    summary.checks.playerUxAndA11yDesktop = await playPage2.evaluate(() => {
      const v = document.querySelector('video');
      const playerRoot = v?.closest('.relative.z-10')?.parentElement || document;
      const slider = playerRoot.querySelector('[role="slider"]');
      const timestampEl = Array.from(playerRoot.querySelectorAll('div')).find(
        (d) => d.className.includes('tabular-nums') && (d.innerText || '').includes('/')
      );
      const tsStyle = timestampEl ? getComputedStyle(timestampEl) : null;
      const tsRect = timestampEl ? timestampEl.getBoundingClientRect() : null;

      const playerBtns = Array.from(playerRoot.querySelectorAll('button')).filter(
        (b) => b.getBoundingClientRect().width > 0
      );
      const unlabeledPlayerBtns = playerBtns
        .filter((b) => {
          const name = (b.getAttribute('aria-label') || b.innerText || '').trim();
          return !name;
        })
        .map((b) => ({ className: b.className.slice(0, 60), title: b.getAttribute('title') }));

      return {
        cls: Number((window.__cwv?.cls || 0).toFixed(4)),
        timestamp: {
          found: !!timestampEl,
          display: tsStyle?.display || null,
          text: timestampEl?.innerText.trim() || null,
          width: tsRect ? Math.round(tsRect.width) : 0,
        },
        seekbar: slider
          ? {
              role: slider.getAttribute('role'),
              tabIndex: slider.tabIndex,
              ariaLabel: slider.getAttribute('aria-label'),
              ariaValueMin: slider.getAttribute('aria-valuemin'),
              ariaValueMax: slider.getAttribute('aria-valuemax'),
              ariaValueNow: slider.getAttribute('aria-valuenow'),
              ariaValueText: slider.getAttribute('aria-valuetext'),
            }
          : null,
        totalVisiblePlayerButtons: playerBtns.length,
        unlabeledPlayerButtonsCount: unlabeledPlayerBtns.length,
        unlabeledSamples: unlabeledPlayerBtns,
      };
    });

    // Test keyboard ArrowRight on focused seekbar `[role="slider"]`
    const sliderLoc = playPage2.locator('[role="slider"]').first();
    if ((await sliderLoc.count()) > 0) {
      await playPage2.evaluate(() => document.querySelector('video')?.pause());
      await wait(150);
      const tBefore = await playPage2.evaluate(() => document.querySelector('video')?.currentTime || 0);
      await sliderLoc.focus();
      await playPage2.keyboard.press('ArrowRight');
      await wait(250);
      const tAfter = await playPage2.evaluate(() => document.querySelector('video')?.currentTime || 0);
      summary.checks.seekbarKeyboardTest = { tBefore, tAfter, advanced: tAfter > tBefore };
    }

    // Open 4-tab Settings Menu & screenshot
    const settingsBtn = playPage2.locator('button[aria-label*="Cài đặt"]').first();
    if ((await settingsBtn.count()) > 0) {
      await settingsBtn.click();
      await wait(300);
      await playPage2.screenshot({ path: path.join(OUT_DIR, '07_after_desktop_player_4tab_settings.png'), fullPage: false });
      summary.checks.settingsMenuTabs = await playPage2.evaluate(() => {
        return Array.from(document.querySelectorAll('[role="tab"]')).map((t) => t.innerText.trim());
      });
      await settingsBtn.click();
      await wait(150);
    }

    // Test `<dialog>` shortcuts modal `.showModal()` focus trap
    const kbBtn = playPage2.locator('button[aria-label*="Phím tắt"]').first();
    if ((await kbBtn.count()) > 0) {
      await kbBtn.click();
      await wait(250);
      summary.checks.shortcutsDialogModal = await playPage2.evaluate(() => {
        const dlg = document.querySelector('dialog');
        return {
          exists: !!dlg,
          openProp: dlg ? dlg.open : false,
          matchesModalPseudo: !!document.querySelector('dialog:modal'),
        };
      });
      await playPage2.keyboard.press('Escape');
      await wait(200);
    }

    // Check Service Worker CacheStorage after real streaming!
    summary.checks.serviceWorkerMediaBypass = await playPage2.evaluate(async () => {
      if (!('caches' in window)) return { supported: false };
      const keys = await caches.keys();
      const allCachedUrls = [];
      for (const k of keys) {
        const c = await caches.open(k);
        const reqs = await c.keys();
        for (const r of reqs) allCachedUrls.push(r.url);
      }
      const leakedMedia = allCachedUrls.filter((u) =>
        /\.(m3u8|ts|m4s|mp4|vtt)(\?|$)/i.test(u) || u.includes('/api/stream/') || u.includes('/proxy/stream')
      );
      return {
        cacheNames: keys,
        totalCachedStaticEntries: allCachedUrls.length,
        cachedMediaEntriesCount: leakedMedia.length,
        leakedMedia,
      };
    });
    summary.checks.seriesEp2Playback = seriesEp2Playback;
    await playPage2.close();

    // Reduced Motion check on Desktop
    const rmPage = await dCtx.newPage();
    await rmPage.emulateMedia({ reducedMotion: 'reduce' });
    await rmPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await wait(6500); // wait past 6s hero interval to confirm hero did NOT auto-advance!
    summary.checks.reducedMotion = await rmPage.evaluate(() => {
      const h1 = document.querySelector('h1')?.innerText.trim();
      const runningInfinites = Array.from(document.querySelectorAll('*')).filter((el) => {
        const st = getComputedStyle(el);
        return st.animationName !== 'none' && parseFloat(st.animationDuration) > 0.01;
      }).length;
      return { heroH1After6500ms: h1, runningAnimationsUnderReducedMotion: runningInfinites };
    });
    await rmPage.close();
    await dCtx.close();

    // =========================================================================
    // 3. TABLET 768x1024 VERIFICATION (CLS < 0.1 & Layout)
    // =========================================================================
    const tCtx = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      deviceScaleFactor: 2,
      locale: 'vi-VN',
    });
    await tCtx.addInitScript(CLS_INIT_SCRIPT);
    const tPage = await tCtx.newPage();
    await tPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await wait(900);
    await tPage.screenshot({ path: path.join(OUT_DIR, '02_after_tablet_home.png'), fullPage: false });
    summary.checks.tabletHome = await tPage.evaluate(() => ({
      cls: Number((window.__cwv?.cls || 0).toFixed(4)),
      scrollWidth: document.documentElement.scrollWidth,
      vw: window.innerWidth,
    }));
    await tCtx.close();

    // =========================================================================
    // 4. MOBILE 390x844 HOME, SEARCH ERGONOMICS & UNCLIPPED VIDEO PLAYER
    // =========================================================================
    const mCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'vi-VN',
    });
    await mCtx.addInitScript(CLS_INIT_SCRIPT);
    const mPage = await mCtx.newPage();
    await mPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await wait(900);
    await mPage.screenshot({ path: path.join(OUT_DIR, '03_after_mobile_home.png'), fullPage: false });

    summary.checks.mobileHome = await mPage.evaluate(() => {
      const visibleInputs = Array.from(document.querySelectorAll('input')).filter(
        (i) => i.getBoundingClientRect().width > 0
      );
      return {
        cls: Number((window.__cwv?.cls || 0).toFixed(4)),
        scrollWidth: document.documentElement.scrollWidth,
        vw: window.innerWidth,
        visibleHeaderInputs: visibleInputs.map((i) => ({
          fontSize: getComputedStyle(i).fontSize,
          h: Math.round(i.getBoundingClientRect().height),
        })),
      };
    });

    // Mobile Watch Page (`/xem-phim/light-to-the-night/tap-2`)
    await mPage.goto(`${BASE_URL}/xem-phim/light-to-the-night/tap-2`, { waitUntil: 'domcontentloaded' });
    const mobilePlayback = await waitForRealPlayback(mPage, 35000);
    // Pause & tap player so control bar stays visible for exact bounding-box inspection
    await mPage.evaluate(() => document.querySelector('video')?.pause());
    await wait(300);
    await mPage.screenshot({ path: path.join(OUT_DIR, '08_after_mobile_watch_unclipped.png'), fullPage: false });

    summary.checks.mobileWatchErgonomics = await mPage.evaluate(() => {
      const v = document.querySelector('video');
      const vRect = v ? v.getBoundingClientRect() : null;
      const bottomBar = v?.parentElement?.querySelector('.player-controls-interactive.absolute.bottom-0');
      const btns = bottomBar
        ? Array.from(bottomBar.querySelectorAll('button')).map((b) => {
            const r = b.getBoundingClientRect();
            return {
              ariaLabel: b.getAttribute('aria-label'),
              text: (b.innerText || '').trim(),
              left: Math.round(r.left),
              right: Math.round(r.right),
              w: Math.round(r.width),
              h: Math.round(r.height),
              unclippedInsideVideo: vRect ? r.left >= vRect.left - 1 && r.right <= vRect.right + 1 : false,
            };
          }).filter((b) => b.w > 0)
        : [];
      const ts = bottomBar
        ? Array.from(bottomBar.querySelectorAll('div')).find(
            (d) => d.className.includes('tabular-nums') && (d.innerText || '').includes('/')
          )
        : null;
      return {
        cls: Number((window.__cwv?.cls || 0).toFixed(4)),
        scrollWidth: document.documentElement.scrollWidth,
        videoRect: vRect ? { left: Math.round(vRect.left), right: Math.round(vRect.right), w: Math.round(vRect.width), h: Math.round(vRect.height) } : null,
        timestampVisible: ts ? getComputedStyle(ts).display !== 'none' : false,
        timestampText: ts ? ts.innerText.trim() : null,
        bottomControlButtons: btns,
        allButtonsUnclipped: btns.length > 0 && btns.every((b) => b.unclippedInsideVideo),
        allButtonsAtLeast44x44: btns.length > 0 && btns.every((b) => b.w >= 44 && b.h >= 44),
      };
    });
    summary.checks.mobilePlayback = mobilePlayback;

    // Actually tap Settings button on Mobile 390x844 to prove reachability & unclipped popover!
    const mSettingsBtn = mPage.locator('button[aria-label*="Cài đặt"]').first();
    if ((await mSettingsBtn.count()) > 0) {
      await mSettingsBtn.tap();
      await wait(350);
      await mPage.screenshot({ path: path.join(OUT_DIR, '09_after_mobile_player_settings_open.png'), fullPage: false });
      summary.checks.mobileSettingsPopover = await mPage.evaluate(() => {
        const tablist = document.querySelector('[role="tablist"]');
        const pop = tablist?.parentElement;
        const r = pop ? pop.getBoundingClientRect() : null;
        const tr = tablist ? tablist.getBoundingClientRect() : null;
        return {
          opened: document.querySelectorAll('[role="tab"]').length === 4,
          popoverRect: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) } : null,
          tablistRect: tr ? { top: Math.round(tr.top), bottom: Math.round(tr.bottom) } : null,
          unclippedInViewport: r && tr ? r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth && tr.top >= 0 : false,
        };
      });
    }

    await mCtx.close();

    summary.dbShaAfter = sha256File(realDbPath);
    summary.realDbUntouched = summary.dbShaBefore === summary.dbShaAfter;
    summary.backendTailLogs = backendLogs.join('').slice(-1500);

    fs.writeFileSync(
      path.join(OUT_DIR, 'verified_web_player_telemetry.json'),
      JSON.stringify(summary, null, 2)
    );
    console.log('PHASE3_WEB_VERIFY_OK');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (backendProc && !backendProc.killed) {
      try {
        backendProc.kill('SIGKILL');
      } catch (_) {}
    }
    for (const f of [TEMP_DB, `${TEMP_DB}-wal`, `${TEMP_DB}-shm`, TEMP_PLAYLISTS, TEMP_CWD]) {
      try {
        fs.rmSync(f, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}

main().catch((err) => {
  console.error('PHASE3_WEB_VERIFY_ERR:', err);
  process.exit(1);
});
