// /Users/kuminhdey/Downloads/webproxy/docs/audit_artifacts/admin/run_admin_e2e_audit.mjs
// Self-contained Playwright Real-User E2E + Taste Skill + UI/UX Pro Max Audit Runner for Admin Panel
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const REPO_ROOT = '/Users/kuminhdey/Downloads/webproxy';
const FRONTEND_ROOT = path.join(REPO_ROOT, 'frontend');
const ARTIFACT_DIR = path.join(REPO_ROOT, 'docs', 'audit_artifacts', 'admin');
const REAL_MOVIES_DB = path.join(REPO_ROOT, 'movies.db');
const REAL_FILM4K_DB = path.join(REPO_ROOT, 'film4k.db');

const TMP_DB = '/tmp/audit_admin_test.db';
const TMP_WORKDIR = '/tmp/audit_admin_workdir';
const TMP_PLAYLISTS = '/tmp/audit_admin_playlists';

const BACKEND_PORT = 18082;
const FRONTEND_PORT = 15174;
const ADMIN_PASSWORD = 'AuditStrongPass2026!';
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

const requireFromNpx = createRequire('/Users/kuminhdey/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = requireFromNpx('playwright');
const requireFromFrontend = createRequire(path.join(FRONTEND_ROOT, 'package.json'));
const { createServer: createViteServer } = requireFromFrontend('vite');

function fileDigestInfo(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  const buf = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  return {
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function cleanTmpArtifacts() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(`${TMP_DB}${suffix}`, { force: true }); } catch {}
  }
  try { fs.rmSync(TMP_WORKDIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(TMP_PLAYLISTS, { recursive: true, force: true }); } catch {}
}

async function collectLayoutAndA11yMetrics(page, viewportLabel) {
  return await page.evaluate((vpLabel) => {
    function parseRgb(str) {
      if (!str) return null;
      const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
    }
    function blend(fg, bg) {
      const a = fg.a + bg.a * (1 - fg.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    }
    function parseGradientFirstColor(bgImg) {
      if (!bgImg || bgImg === 'none') return null;
      const hexMatch = bgImg.match(/#([0-9a-f]{6})/i);
      if (hexMatch) {
        const h = hexMatch[1];
        return {
          r: parseInt(h.slice(0, 2), 16),
          g: parseInt(h.slice(2, 4), 16),
          b: parseInt(h.slice(4, 6), 16),
          a: 1,
        };
      }
      return parseRgb(bgImg);
    }
    function effectiveBg(el) {
      const chain = [];
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const cs = getComputedStyle(cur);
        const bg = parseRgb(cs.backgroundColor);
        const grad = parseGradientFirstColor(cs.backgroundImage);
        if (grad) chain.unshift(grad);
        else if (bg && bg.a > 0) chain.unshift(bg);
        cur = cur.parentElement;
      }
      let acc = { r: 9, g: 11, b: 16, a: 1 }; // #090b10 base
      for (const layer of chain) acc = blend(layer, acc);
      return acc;
    }
    function relLum({ r, g, b }) {
      const conv = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * conv(r) + 0.7152 * conv(g) + 0.0722 * conv(b);
    }
    function contrastRatio(c1, c2) {
      const l1 = relLum(c1);
      const l2 = relLum(c2);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
    }

    const docEl = document.documentElement;
    const horizontalOverflowPx = docEl.scrollWidth - window.innerWidth;

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => ({
      tag: h.tagName.toLowerCase(),
      text: h.textContent.trim().slice(0, 80),
    }));

    const landmarks = {
      header: document.querySelectorAll('header').length,
      main: document.querySelectorAll('main').length,
      nav: document.querySelectorAll('nav').length,
      footer: document.querySelectorAll('footer').length,
      dialog: document.querySelectorAll('dialog').length,
    };

    const interactiveEls = Array.from(
      document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')
    ).filter((el) => {
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });

    const undersizedTargets = [];
    const unlabeledControls = [];
    for (const el of interactiveEls) {
      const r = el.getBoundingClientRect();
      const label =
        el.getAttribute('aria-label') ||
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) ||
        el.closest('label')?.textContent?.trim() ||
        el.textContent?.trim() ||
        '';
      const cleanLabel = label.replace(/\s+/g, ' ').slice(0, 60);
      if (r.width < 44 || r.height < 44) {
        undersizedTargets.push({
          tag: el.tagName.toLowerCase(),
          label: cleanLabel || el.getAttribute('placeholder') || '(unlabeled)',
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
        });
      }
      if (!cleanLabel) {
        unlabeledControls.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          placeholder: el.getAttribute('placeholder') || '',
          title: el.getAttribute('title') || '',
        });
      }
    }

    // Contrast + typography + color scan
    const allElements = Array.from(document.querySelectorAll('*'));
    const contrastFailures = [];
    const sub12PxTexts = [];
    const violetUsages = [];
    let inlineStyleCount = 0;

    for (const el of allElements) {
      if (el.hasAttribute('style')) inlineStyleCount++;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;

      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const val = st[prop] || '';
        const rgb = parseRgb(val);
        if (rgb && rgb.r > 130 && rgb.b > 200 && rgb.g < 140 && rgb.a > 0.05) {
          violetUsages.push({
            tag: el.tagName.toLowerCase(),
            prop,
            value: val,
            text: (el.textContent || '').trim().slice(0, 50),
          });
        }
      }

      // Direct text node check
      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
      );
      if (!hasDirectText) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const fontSize = parseFloat(st.fontSize);
      const fontWeight = parseInt(st.fontWeight, 10) || 400;
      const textSample = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);

      if (fontSize < 12) {
        sub12PxTexts.push({ tag: el.tagName.toLowerCase(), fontSize, text: textSample });
      }

      const fgRaw = parseRgb(st.color);
      if (fgRaw) {
        const bg = effectiveBg(el);
        const fg = blend(fgRaw, bg);
        const ratio = contrastRatio(fg, bg);
        const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        const threshold = isLarge ? 3.0 : 4.5;
        if (ratio < threshold) {
          contrastFailures.push({
            tag: el.tagName.toLowerCase(),
            text: textSample,
            fontSize,
            color: st.color,
            bgResolved: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
            ratio,
            required: threshold,
          });
        }
      }
    }

    return {
      viewportLabel: vpLabel,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: docEl.scrollWidth,
      scrollHeight: docEl.scrollHeight,
      horizontalOverflowPx,
      headings,
      landmarks,
      interactiveCount: interactiveEls.length,
      undersizedTargetCount: undersizedTargets.length,
      undersizedTargetsSample: undersizedTargets.slice(0, 25),
      unlabeledControls,
      inlineStyleCount,
      sub12PxCount: sub12PxTexts.length,
      sub12PxSample: sub12PxTexts.slice(0, 15),
      violetCount: violetUsages.length,
      violetSample: violetUsages.slice(0, 10),
      contrastFailureCount: contrastFailures.length,
      contrastFailuresSample: contrastFailures.slice(0, 20),
      bodyFontFamily: getComputedStyle(document.body).fontFamily,
      adminRootFontFamily: document.querySelector('#root > div')
        ? getComputedStyle(document.querySelector('#root > div')).fontFamily
        : null,
    };
  }, viewportLabel);
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  cleanTmpArtifacts();

  const dbIntegrityBefore = {
    moviesDb: fileDigestInfo(REAL_MOVIES_DB),
    film4kDb: fileDigestInfo(REAL_FILM4K_DB),
  };

  // Copy real DB to /tmp/audit_admin_test.db without mutating source
  fs.copyFileSync(REAL_MOVIES_DB, TMP_DB);
  fs.mkdirSync(TMP_WORKDIR, { recursive: true });
  fs.mkdirSync(TMP_PLAYLISTS, { recursive: true });

  // Read 2 real slugs from TMP_DB so we can pre-seed realistic cached M3U8 folders in TMP_PLAYLISTS
  const initialSlugsRaw = execFileSync(
    '/usr/bin/sqlite3',
    [TMP_DB, 'SELECT slug FROM movies ORDER BY year DESC NULLS LAST, score DESC NULLS LAST, id DESC LIMIT 3;'],
    { encoding: 'utf-8' }
  );
  const initialSlugs = initialSlugsRaw.split('\n').map((s) => s.trim()).filter(Boolean);
  for (const slug of [...initialSlugs.slice(0, 2), 'synthetic-cache-only-slug']) {
    const dir = path.join(TMP_PLAYLISTS, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'master.m3u8'),
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080\nindex.m3u8\n'
    );
  }

  const telemetry = {
    startedAt: new Date().toISOString(),
    ports: { backend: BACKEND_PORT, frontend: FRONTEND_PORT },
    dbIntegrityBefore,
    initialSlugs,
    consoleMessages: [],
    pageErrors: [],
    networkFailures: [],
    resourceWeights: [],
    apiSecurityChecks: {},
    authChecks: {},
    dashboardChecks: {},
    crudAndTableChecks: {},
    crawlerAndCacheChecks: {},
    faultInjectionChecks: {},
    responsiveAndA11y: {},
    rateLimitCheck: {},
  };

  let backendProc = null;
  let viteServer = null;
  let browser = null;
  const backendLogs = [];

  try {
    // 1. Spawn isolated Rust backend
    backendProc = spawn(
      path.join(REPO_ROOT, 'target', 'debug', 'webproxy_backend'),
      [],
      {
        cwd: TMP_WORKDIR,
        env: {
          ...process.env,
          PORT: String(BACKEND_PORT),
          DATABASE_PATH: TMP_DB,
          PLAYLISTS_DIR: TMP_PLAYLISTS,
          STATIC_DIR: path.join(FRONTEND_ROOT, 'dist'),
          ADMIN_PASSWORD,
          FILM4K_HOME_URL: 'https://invalid.example.invalid/api/home',
          FIML4K_HOME_URL: 'https://invalid.example.invalid/api/home',
          SITEMAP_URL: 'https://invalid.example.invalid/sitemap.xml',
          FIML4K_API_BASE: 'https://invalid.example.invalid',
          RUST_LOG: 'info',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    backendProc.stdout.on('data', (d) => backendLogs.push(d.toString()));
    backendProc.stderr.on('data', (d) => backendLogs.push(d.toString()));

    await waitForHttp(`${BACKEND_URL}/api/health/live`, 15000);

    // 2. Start isolated Vite dev server on FRONTEND_PORT proxying /api and /proxy to BACKEND_PORT
    process.chdir(FRONTEND_ROOT);
    viteServer = await createViteServer({
      root: FRONTEND_ROOT,
      configFile: path.join(FRONTEND_ROOT, 'vite.config.ts'),
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: FRONTEND_PORT,
        strictPort: true,
        proxy: {
          '/api': { target: BACKEND_URL, changeOrigin: true },
          '/proxy': { target: BACKEND_URL, changeOrigin: true },
        },
      },
    });
    await viteServer.listen();
    await waitForHttp(`${FRONTEND_URL}/admin`, 15000);

    // 3. Direct API Security & CRUD Endpoint Probing (unauthenticated vs spoofed headers)
    const unauthStats = await fetch(`${BACKEND_URL}/api/admin/stats`);
    const unauthMovies = await fetch(`${BACKEND_URL}/api/admin/movies`);
    const unauthLogs = await fetch(`${BACKEND_URL}/api/admin/logs`);
    const unauthCrawl = await fetch(`${BACKEND_URL}/api/admin/crawler/start`, { method: 'POST' });
    const unauthCache = await fetch(`${BACKEND_URL}/api/admin/cache/clear`, { method: 'POST' });
    const spoofedStaticKey = await fetch(`${BACKEND_URL}/api/admin/stats`, {
      headers: { 'X-Admin-Key': ADMIN_PASSWORD, Authorization: `Bearer ${ADMIN_PASSWORD}` },
    });

    telemetry.apiSecurityChecks = {
      unauthStatsStatus: unauthStats.status,
      unauthMoviesStatus: unauthMovies.status,
      unauthLogsStatus: unauthLogs.status,
      unauthCrawlStatus: unauthCrawl.status,
      unauthCacheStatus: unauthCache.status,
      spoofedRawPasswordBearerStatus: spoofedStaticKey.status,
    };

    // 4. Launch Playwright Chromium (using local Chrome binary)
    browser = await chromium.launch({
      headless: true,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'vi-VN',
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) {
        telemetry.consoleMessages.push({
          type: msg.type(),
          text: msg.text().slice(0, 300),
          location: msg.location(),
        });
      }
    });
    page.on('pageerror', (err) => {
      telemetry.pageErrors.push(err.message);
    });
    page.on('response', async (res) => {
      const url = res.url();
      const status = res.status();
      if (status >= 400 && !url.includes('/api/admin/login')) {
        telemetry.networkFailures.push({ url, status, method: res.request().method() });
      }
      if (url.endsWith('/logo.png') || url.endsWith('.js') || url.endsWith('.css')) {
        const cl = res.headers()['content-length'];
        if (cl && Number(cl) > 100_000) {
          telemetry.resourceWeights.push({ url, bytes: Number(cl), contentType: res.headers()['content-type'] });
        }
      }
    });

    // =========================================================================
    // PHASE 1: ADMIN AUTH & SECURITY UX (Desktop 1440x900)
    // =========================================================================
    await page.goto(`${FRONTEND_URL}/admin`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01_login_gate_desktop_1440x900.png') });

    telemetry.responsiveAndA11y.loginDesktop1440 = await collectLayoutAndA11yMetrics(page, 'login_1440x900');

    // Inspect password input attributes & autofill readiness
    const pwInputAttrs = await page.locator('#admin-password').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.id,
        name: el.getAttribute('name'),
        type: el.getAttribute('type'),
        autocomplete: el.getAttribute('autocomplete'),
        placeholder: el.getAttribute('placeholder'),
        ariaInvalid: el.getAttribute('aria-invalid'),
        ariaDescribedBy: el.getAttribute('aria-describedby'),
        hasAssociatedLabel: Boolean(document.querySelector(`label[for="${el.id}"]`)),
        hasUsernameFieldInForm: Boolean(el.closest('form')?.querySelector('input[type="text"], input[name*="user"]')),
        width: r.width,
        height: r.height,
      };
    });

    const toggleBtnInfo = await page.locator('button[aria-controls="admin-password"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        ariaLabel: el.getAttribute('aria-label'),
        ariaPressed: el.getAttribute('aria-pressed'),
        width: r.width,
        height: r.height,
      };
    });

    // Test empty password submit
    await page.locator('button[type="submit"]').click();
    const emptyErrorText = await page.locator('form').locator('..').textContent();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02_login_empty_error_desktop.png') });

    // Test wrong password submit via Enter key + password visibility toggle
    await page.locator('#admin-password').fill('WrongPass_Attempt1');
    await page.locator('button[aria-controls="admin-password"]').click();
    const typeAfterReveal = await page.locator('#admin-password').getAttribute('type');
    await page.locator('#admin-password').press('Enter');
    await page.waitForSelector('text=Invalid admin password', { timeout: 5000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03_login_wrong_password_revealed.png') });
    await page.locator('button[aria-controls="admin-password"]').click(); // hide again

    // Test "Quay lại Trang Chủ Cinema" link and navigate back to /admin
    await page.getByRole('button', { name: /Quay lại Trang Chủ Cinema/i }).click();
    await page.waitForTimeout(300);
    const navigatedHomePath = new URL(page.url()).pathname;
    await page.goto(`${FRONTEND_URL}/admin`, { waitUntil: 'networkidle' });

    // Valid login via Enter key
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#admin-password').press('Enter');
    await page.waitForSelector('text=Bảng Điều Khiển Quản Trị', { timeout: 8000 });
    await page.waitForTimeout(800); // allow stats & movies & logs initial fetch

    const storageStateAfterLogin = await page.evaluate(() => ({
      sessionTokenPresent: Boolean(sessionStorage.getItem('bofilm_admin_token')),
      sessionTokenPrefix: (sessionStorage.getItem('bofilm_admin_token') || '').slice(0, 8),
      localStorageTokenPresent: Boolean(localStorage.getItem('bofilm_admin_token')),
    }));

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '04_dashboard_overview_desktop_1440x900.png') });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '05_dashboard_fullpage_desktop_1440x900.png'), fullPage: true });

    // Test reload persistence
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Bảng Điều Khiển Quản Trị', { timeout: 8000 });
    const persistedAfterReload = await page.locator('text=Bảng Điều Khiển Quản Trị').isVisible();

    // Test expired/invalid token auto-redirect to login gate
    const validTokenBackup = await page.evaluate(() => sessionStorage.getItem('bofilm_admin_token'));
    await page.evaluate(() => sessionStorage.setItem('bofilm_admin_token', 'adm_invalid_expired_0000'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#admin-password', { timeout: 8000 });
    const expiredBannerVisible = await page.locator('text=/Phiên làm việc đã hết hạn/i').isVisible();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '06_session_expired_redirect_desktop.png') });

    // Re-login & test server-side Logout invalidation
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#admin-password').press('Enter');
    await page.waitForSelector('text=Bảng Điều Khiển Quản Trị', { timeout: 8000 });
    const tokenBeforeLogout = await page.evaluate(() => sessionStorage.getItem('bofilm_admin_token'));
    await page.getByRole('button', { name: /Đăng xuất/i }).click();
    await page.waitForSelector('#admin-password', { timeout: 5000 });
    const reuseLoggedOutTokenRes = await fetch(`${BACKEND_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tokenBeforeLogout}` },
    });

    telemetry.authChecks = {
      pwInputAttrs,
      toggleBtnInfo,
      emptyErrorDisplayed: emptyErrorText?.includes('Vui lòng nhập mật khẩu quản trị') || false,
      typeAfterReveal,
      navigatedHomePath,
      storageStateAfterLogin,
      persistedAfterReload,
      expiredBannerVisible,
      reuseLoggedOutTokenStatus: reuseLoggedOutTokenRes.status,
      validTokenInvalidatedcheck: Boolean(validTokenBackup),
    };

    // Log back in for Dashboard, Catalog & Ops suites
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#admin-password').press('Enter');
    await page.waitForSelector('text=Bảng Điều Khiển Quản Trị', { timeout: 8000 });
    await page.waitForTimeout(800);

    const activeToken = await page.evaluate(() => sessionStorage.getItem('bofilm_admin_token'));

    // =========================================================================
    // PHASE 2: DASHBOARD OVERVIEW & TELEMETRY + TASTE/UI-UX METRICS (1440x900)
    // =========================================================================
    telemetry.responsiveAndA11y.dashboardDesktop1440 = await collectLayoutAndA11yMetrics(page, 'dashboard_1440x900');

    const rawStatsPayload = await (
      await fetch(`${BACKEND_URL}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
    ).json();

    // Measure stat cards alignment, heights, typography
    const statCardsMetrics = await page.evaluate(() => {
      const main = document.querySelector('main.admin-dashboard-main');
      const grid = main?.children?.[1];
      if (!grid) return [];
      return Array.from(grid.children).map((card, idx) => {
        const r = card.getBoundingClientRect();
        const childOverflowRightPx = Math.max(
          0,
          ...Array.from(card.querySelectorAll('*')).map((c) => Math.round(c.getBoundingClientRect().right - r.right))
        );
        return {
          index: idx + 1,
          top: Math.round(r.top),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height),
          childOverflowRightPx,
          text: card.textContent.trim().replace(/\s+/g, ' ').slice(0, 140),
        };
      });
    });

    // Check broken images in movie table
    const posterHealth = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('table tbody img'));
      return {
        totalImgs: imgs.length,
        hiddenOrBrokenCount: imgs.filter((img) => getComputedStyle(img).display === 'none' || !img.complete || img.naturalWidth === 0).length,
        sampleSrcs: imgs.slice(0, 5).map((img) => ({
          src: img.getAttribute('src'),
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          display: getComputedStyle(img).display,
        })),
      };
    });

    telemetry.dashboardChecks = {
      rawStatsSummary: {
        total_movies: rawStatsPayload.total_movies,
        total_single: rawStatsPayload.total_single,
        total_series: rawStatsPayload.total_series,
        detail_rows: rawStatsPayload.detail_rows,
        cached_playlists_count: rawStatsPayload.cached_playlists_count,
        cached_m3u8_count: rawStatsPayload.cached_m3u8_count,
        disk_usage: rawStatsPayload.disk_usage,
        crawler_last_status: rawStatsPayload.crawler_last_status,
      },
      statCardsMetrics,
      posterHealth,
    };

    // =========================================================================
    // PHASE 3: MOVIE / CATALOG MANAGEMENT & CRUD AUDIT (Isolated Temp DB)
    // =========================================================================
    // Probe unsupported CRUD endpoints on backend
    const crudProbeCreate = await fetch(`${BACKEND_URL}/api/admin/movies`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'test-create', title_vi: 'Phim Thử Nghiệm' }),
    });
    const crudProbeUpdate = await fetch(`${BACKEND_URL}/api/admin/movies/${initialSlugs[0] || 'test'}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title_vi: 'Updated' }),
    });
    const crudProbeDelete = await fetch(`${BACKEND_URL}/api/admin/movies/${initialSlugs[0] || 'test'}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${activeToken}` },
    });

    // Check UI for CRUD buttons, table sort headers, and has_cached_m3u8 badge accuracy
    const tableUiInspection = await page.evaluate((cachedSlugs) => {
      const buttons = Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim());
      const hasCreateMovieBtn = buttons.some((t) => /thêm phim|tạo phim|create movie|new movie|add movie/i.test(t));
      const hasEditMovieBtn = buttons.some((t) => /sửa|chỉnh sửa|edit/i.test(t));
      const hasDeleteMovieBtn = buttons.some((t) => /^xóa phim$|^delete$/i.test(t));
      const hasClearAllCacheBtn = buttons.some((t) => /xóa tất cả cache|clear all cache|dọn sạch cache/i.test(t));
      const hasCachedFilterTab = buttons.some((t) => /đã cache|chưa cache/i.test(t));

      const ths = Array.from(document.querySelectorAll('table thead th')).map((th) => ({
        text: th.textContent.trim(),
        ariaSort: th.getAttribute('aria-sort'),
        hasButtonOrClickable: Boolean(th.querySelector('button, a')) || getComputedStyle(th).cursor === 'pointer',
      }));

      const rows = Array.from(document.querySelectorAll('table tbody tr')).map((tr) => {
        const text = tr.textContent || '';
        return {
          text: text.replace(/\s+/g, ' ').trim().slice(0, 120),
          showsCachedBadge: text.includes('Có mục playlist cache'),
          matchesPreseededCacheSlug: cachedSlugs.some((slug) => text.includes(slug)),
        };
      });

      return {
        hasCreateMovieBtn,
        hasEditMovieBtn,
        hasDeleteMovieBtn,
        hasClearAllCacheBtn,
        hasCachedFilterTab,
        ths,
        totalRenderedRows: rows.length,
        anyRowShowsCachedBadge: rows.some((r) => r.showsCachedBadge),
        preseededSlugRowsStillSayUncached: rows.filter((r) => r.matchesPreseededCacheSlug),
      };
    }, initialSlugs.slice(0, 2));

    // Test Filter Tabs (Phim lẻ / Phim bộ / Tất cả)
    await page.getByRole('button', { name: 'Phim lẻ', exact: true }).click();
    await page.waitForTimeout(450);
    const singleFilterCount = await page.locator('table tbody tr').count();

    await page.getByRole('button', { name: 'Phim bộ', exact: true }).click();
    await page.waitForTimeout(450);
    const seriesFilterCount = await page.locator('table tbody tr').count();

    await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
    await page.waitForTimeout(450);

    // Test Search Input (valid query + empty state query)
    const searchInput = page.locator('input[placeholder*="Tìm kiếm phim"]');
    if (initialSlugs[0]) {
      await searchInput.fill(initialSlugs[0]);
      await page.waitForTimeout(450);
    }
    const matchedSlugRowCount = await page.locator('table tbody tr').count();

    await searchInput.fill('khong_ton_tai_phim_99999_xyz');
    await page.waitForTimeout(450);
    const emptySearchVisible = await page.locator('text=Không tìm thấy phim phù hợp với từ khóa tìm kiếm.').isVisible();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '07_movies_search_empty_state.png') });
    await searchInput.fill('');
    await page.waitForTimeout(450);

    // Seed 45 synthetic test movies + episodes into ISOLATED /tmp/audit_admin_test.db to exercise real pagination (total 62 > 25/page)
    let seedSql = 'BEGIN TRANSACTION;\n';
    for (let i = 1; i <= 45; i++) {
      const slug = `audit-test-phim-${String(i).padStart(2, '0')}`;
      const mtype = i % 2 === 0 ? 'tv' : 'movie';
      const titleVi = `Phim Kiểm Thử Quản Trị Số ${i}`;
      const titleEn = `Admin Audit Test Film ${i}`;
      seedSql += `INSERT OR IGNORE INTO movies (slug, movie_type, title_vi, title_en, search_text, year, quality, score, genres_json, country, poster, total_episodes) VALUES ('${slug}', '${mtype}', '${titleVi}', '${titleEn}', '${titleVi.toLowerCase()} ${titleEn.toLowerCase()} ${slug}', 2026, 'FHD', 8.2, '["Hành Động","Viễn Tưởng"]', 'Việt Nam', '/logo.png', ${mtype === 'tv' ? 12 : 1});\n`;
    }
    seedSql += 'COMMIT;\n';
    execFileSync('/usr/bin/sqlite3', [TMP_DB, seedSql]);

    // Refresh stats & movies in UI
    await page.getByRole('button', { name: /Làm Mới Số Liệu/i }).click();
    await page.waitForTimeout(600);
    await page.locator('table').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '08_movies_paginated_table_desktop.png') });

    // Exercise pagination: Page 2, Trang cuối, Jump to page (valid & invalid), Page size selector
    const page2Btn = page.locator('button', { hasText: /^2$/ }).first();
    await page2Btn.click();
    await page.waitForTimeout(450);
    const page2Indicator = await page.locator('text=/Hiển thị trang/i').textContent();

    await page.getByRole('button', { name: /Trang cuối/i }).click();
    await page.waitForTimeout(450);
    const lastPageIndicator = await page.locator('text=/Hiển thị trang/i').textContent();

    // Jump to invalid page 999 -> verify silent no-op without error message
    const jumpInput = page.locator('form input[type="number"]');
    await jumpInput.fill('999');
    await page.getByRole('button', { name: 'Chuyển', exact: true }).click();
    await page.waitForTimeout(300);
    const jumpInvalidInputRemaining = await jumpInput.inputValue();
    const afterInvalidJumpIndicator = await page.locator('text=/Hiển thị trang/i').textContent();

    // Jump to valid page 2
    await jumpInput.fill('2');
    await page.getByRole('button', { name: 'Chuyển', exact: true }).click();
    await page.waitForTimeout(450);
    const afterValidJumpIndicator = await page.locator('text=/Hiển thị trang/i').textContent();

    // Change page size to 50
    await page.locator('select').selectOption('50');
    await page.waitForTimeout(450);
    const rowsAtPageSize50 = await page.locator('table tbody tr').count();
    await page.locator('select').selectOption('25');
    await page.waitForTimeout(450);

    // Navigate to page 2, click "Xem" on first row -> verify navigation to /watch/:slug & state loss on back
    await page.locator('button', { hasText: /^2$/ }).first().click();
    await page.waitForTimeout(450);
    await page.locator('table tbody tr').first().getByRole('button', { name: /Xem/i }).click();
    await page.waitForTimeout(500);
    const watchNavPath = new URL(page.url()).pathname;
    await page.goBack({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Bảng Điều Khiển Quản Trị', { timeout: 8000 });
    await page.waitForTimeout(500);
    const pageIndicatorAfterBack = await page.locator('text=/Hiển thị trang/i').textContent();

    telemetry.crudAndTableChecks = {
      backendCrudEndpoints: {
        postCreateStatus: crudProbeCreate.status,
        putUpdateStatus: crudProbeUpdate.status,
        deleteMovieStatus: crudProbeDelete.status,
      },
      tableUiInspection,
      singleFilterCount,
      seriesFilterCount,
      matchedSlugRowCount,
      emptySearchVisible,
      pagination: {
        page2Indicator: page2Indicator?.trim(),
        lastPageIndicator: lastPageIndicator?.trim(),
        jumpInvalidInputRemaining,
        afterInvalidJumpIndicator: afterInvalidJumpIndicator?.trim(),
        afterValidJumpIndicator: afterValidJumpIndicator?.trim(),
        rowsAtPageSize50,
        watchNavPath,
        pageIndicatorAfterBack: pageIndicatorAfterBack?.trim(),
      },
    };

    // =========================================================================
    // PHASE 4: CRAWLER, CACHE, LOGS & OPS CONTROLS
    // =========================================================================
    const crawlerRequestsCaptured = [];
    page.on('response', async (res) => {
      const u = res.url();
      if (u.includes('/api/admin/crawler/') || u.includes('/api/admin/cache/')) {
        let reqBody = null;
        try { reqBody = res.request().postDataJSON(); } catch {}
        let resBody = null;
        try { resBody = await res.json(); } catch {}
        crawlerRequestsCaptured.push({
          url: new URL(u).pathname,
          method: res.request().method(),
          status: res.status(),
          reqBody,
          resBody,
        });
      }
    });

    // 4a. Confirmation Modal UX: open, check focus & Escape & Cancel, re-open & Confirm
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /Kích hoạt cào dữ liệu|Cào phim còn thiếu/i }).first().click();
    await page.waitForSelector('dialog[open]', { timeout: 5000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '09_confirm_crawl_modal_desktop.png') });

    // Check focus management inside modal
    const modalFocusCheck = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]');
      const activeInsideDialog = dialog ? dialog.contains(document.activeElement) : false;
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const activeText = (document.activeElement?.textContent || '').trim();
      return { activeInsideDialog, activeTag, activeText };
    });

    // Press Tab 4 times to verify native <dialog>.showModal() focus cycle
    const tabSequenceInModal = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      const cur = await page.evaluate(() => ({
        insideDialog: Boolean(document.querySelector('dialog[open]')?.contains(document.activeElement)),
        text: (document.activeElement?.textContent || '').trim(),
      }));
      tabSequenceInModal.push(cur);
    }

    // Cancel via Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closedAfterEscape = (await page.locator('dialog[open]').count()) === 0;

    // Open again, Cancel via "Hủy bỏ" button
    await page.getByRole('button', { name: /Kích hoạt cào dữ liệu|Cào phim còn thiếu/i }).first().click();
    await page.waitForSelector('dialog[open]', { timeout: 5000 });
    await page.locator('dialog[open]').getByRole('button', { name: 'Hủy bỏ' }).click();
    await page.waitForTimeout(200);
    const closedAfterCancelBtn = (await page.locator('dialog[open]').count()) === 0;

    // Open again & Confirm ("Bắt đầu ngay")
    await page.getByRole('button', { name: /Kích hoạt cào dữ liệu|Cào phim còn thiếu/i }).first().click();
    await page.waitForSelector('dialog[open]', { timeout: 5000 });
    await page.locator('dialog[open]').getByRole('button', { name: /Bắt đầu ngay/i }).click();
    await page.waitForTimeout(600);

    // Exercise Stage 1, Stage 2, Stage 3, Warmup, Update, Stop buttons
    for (const btnPattern of [
      /Stage 1: Đồng bộ Catalog/i,
      /Stage 2: Cào Chi Tiết Đồng Thời/i,
      /Stage 3: Quét Cache M3U8/i,
      /Nạp Trước Dữ Liệu Phim Hot/i,
      /Quét Cập Nhật Phim Mới/i,
    ]) {
      // Ensure crawler is idle before clicking next trigger
      await page.waitForTimeout(400);
      const btn = page.getByRole('button', { name: btnPattern });
      if (await btn.isEnabled()) {
        await btn.click();
        await page.waitForTimeout(450);
      }
    }

    // Check sticky hover mutation bug on "Quét Cập Nhật Phim Mới"
    const updateBtn = page.getByRole('button', { name: /Quét Cập Nhật Phim Mới/i });
    const bgBeforeHover = await updateBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    await updateBtn.hover();
    const bgDuringHover = await updateBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.move(10, 10);
    const bgAfterMouseLeave = await updateBtn.evaluate((el) => getComputedStyle(el).backgroundColor);

    // Test per-movie "Xóa Cache" on pre-seeded cached slug
    const targetCacheSlug = initialSlugs[0];
    const cacheDirExistedBefore = fs.existsSync(path.join(TMP_PLAYLISTS, targetCacheSlug));
    await searchInput.fill(targetCacheSlug);
    await page.waitForTimeout(450);
    await page.locator('table tbody tr').first().getByRole('button', { name: /Xóa Cache/i }).click();
    await page.waitForTimeout(450);
    const cacheDirExistsAfter = fs.existsSync(path.join(TMP_PLAYLISTS, targetCacheSlug));
    await searchInput.fill('');
    await page.waitForTimeout(450);

    // Terminal logs controls: Auto-scroll toggle, Copy, Export download
    const autoScrollBtn = page.getByRole('button', { name: /Auto-scroll/i });
    const autoScrollBefore = await autoScrollBtn.textContent();
    await autoScrollBtn.click();
    const autoScrollAfter = await autoScrollBtn.textContent();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.getByRole('button', { name: /Xuất tất cả/i }).click(),
    ]);
    const exportedLogsPath = path.join(ARTIFACT_DIR, 'exported_admin_task_logs.jsonl');
    await download.saveAs(exportedLogsPath);
    const exportedLogLines = fs.readFileSync(exportedLogsPath, 'utf-8').trim().split('\n').filter(Boolean).length;

    telemetry.crawlerAndCacheChecks = {
      modalFocusCheck,
      tabSequenceInModal,
      closedAfterEscape,
      closedAfterCancelBtn,
      crawlerRequestsCaptured,
      updateBtnHoverMutation: { bgBeforeHover, bgDuringHover, bgAfterMouseLeave },
      cacheClearRealEffect: {
        slug: targetCacheSlug,
        cacheDirExistedBefore,
        cacheDirExistsAfter,
      },
      terminalControls: {
        autoScrollBefore: autoScrollBefore?.trim(),
        autoScrollAfter: autoScrollAfter?.trim(),
        exportedLogLines,
      },
    };

    // =========================================================================
    // PHASE 5: FAULT INJECTION, ACTIVE CRAWLER RUNNING STATE & DOUBLE-CLICK PROTECTION
    // =========================================================================
    // 5a. Simulate active crawler running (58.4%) to inspect disabled states & progress bar
    await page.route('**/api/admin/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...rawStatsPayload,
          crawler_is_running: true,
          crawler_progress_percent: 58.4,
          crawler_processed: 36,
          crawler_total: 62,
          crawler_current_movie: 'ho-den-tu-than-2014',
          crawler_last_status: 'Started crawler in mode: full',
        }),
      });
    });
    await page.getByRole('button', { name: /Làm Mới Số Liệu/i }).click();
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '10_crawler_running_state_desktop.png') });

    const disabledButtonVisualAudit = await page.evaluate(() => {
      const labels = [
        'Stage 1: Đồng bộ Catalog',
        'Stage 2: Cào Chi Tiết Đồng Thời',
        'Stage 3: Quét Cache M3U8',
        'Nạp Trước Dữ Liệu Phim Hot',
        'Dừng Crawler',
      ];
      return labels.map((lbl) => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes(lbl));
        if (!btn) return { label: lbl, found: false };
        const st = getComputedStyle(btn);
        return {
          label: lbl,
          disabled: btn.disabled,
          cursor: st.cursor,
          color: st.color,
          backgroundColor: st.backgroundColor,
          opacity: st.opacity,
        };
      });
    });
    await page.unroute('**/api/admin/stats');
    await page.getByRole('button', { name: /Làm Mới Số Liệu/i }).click();
    await page.waitForTimeout(400);

    // 5b. Rapid double-click protection test with delayed 700ms response
    let updateHitCount = 0;
    await page.route('**/api/admin/crawler/update', async (route) => {
      updateHitCount++;
      await new Promise((r) => setTimeout(r, 700));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, mode: 'latest', message: 'Delayed update ok' }),
      });
    });
    const updBtn = page.getByRole('button', { name: /Quét Cập Nhật Phim Mới/i });
    await updBtn.click();
    const disabledWhileInFlight = await updBtn.isDisabled();
    // Attempt second click via dispatch/force check (normal user cannot click disabled button)
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('Quét Cập Nhật Phim Mới'));
      b?.click();
    });
    await page.waitForTimeout(850);
    await page.unroute('**/api/admin/crawler/update');

    // 5c. Upstream / Backend 500 failure on per-movie Cache Clear -> verify FALSE POSITIVE green toast bug!
    await page.route('**/api/admin/cache/clear/**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Simulated disk permission error EACCES' }),
      });
    });
    await page.locator('table tbody tr').first().getByRole('button', { name: /Xóa Cache/i }).click();
    await page.waitForTimeout(300);
    const toastAfter500CacheClear = await page.evaluate(() => {
      const banner = Array.from(document.querySelectorAll('div')).find(
        (d) => getComputedStyle(d).position === 'fixed' && d.textContent.includes('Đã xóa cache M3U8')
      );
      return banner ? banner.textContent.trim() : null;
    });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '11_false_success_toast_on_500.png') });
    await page.unroute('**/api/admin/cache/clear/**');

    // 5d. Backend 500 failure on /api/admin/movies -> verify error recovery UI & "Thử lại" button
    await page.route('**/api/admin/movies*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Database connection pool exhausted (simulated 500)' }),
      });
    });
    await page.getByRole('button', { name: /Làm Mới Số Liệu/i }).click();
    await page.waitForSelector('text=Không thể tải danh sách phim từ máy chủ', { timeout: 5000 });
    await page.locator('text=Không thể tải danh sách phim từ máy chủ').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '12_movies_api_500_error_state.png') });
    await page.unroute('**/api/admin/movies*');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.waitForSelector('table tbody tr', { timeout: 5000 });

    telemetry.faultInjectionChecks = {
      disabledButtonVisualAudit,
      doubleClickProtection: {
        disabledWhileInFlight,
        requestsSentDuringRapidDoubleClick: updateHitCount,
      },
      falsePositiveSuccessToastOnHttp500: toastAfter500CacheClear,
      movies500ErrorStateRecovered: (await page.locator('table tbody tr').count()) > 0,
    };

    // =========================================================================
    // PHASE 6: RESPONSIVE BREAKPOINTS (Tablet 768x1024 & Mobile 390x844) + REDUCED MOTION
    // =========================================================================
    // Tablet 768x1024
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '13_dashboard_tablet_768x1024.png') });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '14_dashboard_tablet_fullpage_768x1024.png'), fullPage: true });
    telemetry.responsiveAndA11y.dashboardTablet768 = await collectLayoutAndA11yMetrics(page, 'dashboard_768x1024');

    // Mobile 390x844 — Dashboard, Table Overflow, Modal, and Login Gate
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '15_dashboard_mobile_390x844.png') });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '16_dashboard_mobile_fullpage_390x844.png'), fullPage: true });

    // Measure table horizontal scroll container on 390x844
    const mobileTableMetrics = await page.evaluate(() => {
      const table = document.querySelector('table');
      const wrapper = table?.parentElement;
      if (!table || !wrapper) return null;
      return {
        wrapperClientWidth: wrapper.clientWidth,
        wrapperScrollWidth: wrapper.scrollWidth,
        tableScrollOverflowPx: wrapper.scrollWidth - wrapper.clientWidth,
        theadPosition: getComputedStyle(table.querySelector('thead')).position,
        firstThPosition: getComputedStyle(table.querySelector('th')).position,
      };
    });
    await page.locator('table').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '17_table_mobile_scroll_390x844.png') });

    // Open Confirmation Modal on Mobile 390x844
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /Kích hoạt cào dữ liệu|Cào phim còn thiếu/i }).first().click();
    await page.waitForSelector('dialog[open]', { timeout: 5000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '18_modal_mobile_390x844.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    telemetry.responsiveAndA11y.dashboardMobile390 = await collectLayoutAndA11yMetrics(page, 'dashboard_390x844');
    telemetry.responsiveAndA11y.mobileTableMetrics = mobileTableMetrics;

    // Check prefers-reduced-motion support
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedMotionCheck = await page.evaluate(() => {
      const hasReducedMotionRule = Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some((r) => r.cssText.includes('prefers-reduced-motion'));
        } catch {
          return false;
        }
      });
      return { hasReducedMotionRule };
    });
    telemetry.responsiveAndA11y.reducedMotionCheck = reducedMotionCheck;
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // =========================================================================
    // PHASE 7: MOBILE LOGIN + BRUTE-FORCE RATE LIMITING LOCKOUT (429)
    // =========================================================================
    await page.getByRole('button', { name: /Đăng xuất/i }).click();
    await page.waitForSelector('#admin-password', { timeout: 5000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '19_login_mobile_390x844.png') });
    telemetry.responsiveAndA11y.loginMobile390 = await collectLayoutAndA11yMetrics(page, 'login_390x844');

    // Resize back to Desktop 1440x900 for crisp rate-limit lockout verification
    await page.setViewportSize({ width: 1440, height: 900 });
    const loginStatuses = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      const [loginRes] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/admin/login') && r.request().method() === 'POST'),
        (async () => {
          await page.locator('#admin-password').fill(`WrongBruteForce_${attempt}`);
          await page.locator('#admin-password').press('Enter');
        })(),
      ]);
      loginStatuses.push({
        attempt,
        status: loginRes.status(),
        retryAfter: loginRes.headers()['retry-after'] || null,
        body: await loginRes.json().catch(() => null),
      });
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '20_login_rate_limit_lockout_429.png') });
    telemetry.rateLimitCheck = { loginStatuses };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    if (viteServer) {
      try { await viteServer.close(); } catch {}
    }
    if (backendProc && !backendProc.killed) {
      try { backendProc.kill('SIGKILL'); } catch {}
    }
    cleanTmpArtifacts();

    telemetry.dbIntegrityAfter = {
      moviesDb: fileDigestInfo(REAL_MOVIES_DB),
      film4kDb: fileDigestInfo(REAL_FILM4K_DB),
    };
    telemetry.zeroMutationVerified =
      telemetry.dbIntegrityBefore.moviesDb.sha256 === telemetry.dbIntegrityAfter.moviesDb.sha256 &&
      telemetry.dbIntegrityBefore.film4kDb.sha256 === telemetry.dbIntegrityAfter.film4kDb.sha256;
    telemetry.backendLogTail = backendLogs.join('').split('\n').slice(-40);
    telemetry.completedAt = new Date().toISOString();

    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'admin_audit_telemetry.json'),
      JSON.stringify(telemetry, null, 2),
      'utf-8'
    );
  }
}

main().catch((err) => {
  console.error('ADMIN E2E AUDIT FAILED:', err);
  process.exit(1);
});
