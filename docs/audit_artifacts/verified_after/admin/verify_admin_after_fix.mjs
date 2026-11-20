// /Users/kuminhdey/Downloads/webproxy/docs/audit_artifacts/verified_after/admin/verify_admin_after_fix.mjs
// Phase 3 Post-Remediation Live Playwright Verification Suite for Admin Panel (Port 18092)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const REPO_ROOT = '/Users/kuminhdey/Downloads/webproxy';
const FRONTEND_DIST = path.join(REPO_ROOT, 'frontend', 'dist');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'audit_artifacts', 'verified_after', 'admin');
const REAL_MOVIES_DB = path.join(REPO_ROOT, 'movies.db');
const REAL_FILM4K_DB = path.join(REPO_ROOT, 'film4k.db');

const TMP_DB = '/tmp/verify_after_admin_18092.db';
const TMP_PLAYLISTS = '/tmp/verify_after_playlists_18092';
const TMP_WORKDIR = '/tmp/verify_after_workdir_18092';

const PORT = 18092;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'VerifyStrongPass2026!';

const requireFromNpx = createRequire('/Users/kuminhdey/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = requireFromNpx('playwright');

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

function cleanupTmp() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(`${TMP_DB}${suffix}`, { force: true }); } catch {}
  }
  try { fs.rmSync(TMP_PLAYLISTS, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(TMP_WORKDIR, { recursive: true, force: true }); } catch {}
}

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function auditViewport(page, label) {
  return await page.evaluate((vpLabel) => {
    function parseRgb(str) {
      if (!str) return null;
      const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
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
      let acc = { r: 6, g: 11, b: 5, a: 1 }; // #060b05 Avocado ground
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
    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map((h) => ({
      tag: h.tagName.toLowerCase(),
      text: h.textContent.trim().slice(0, 70),
    }));

    const interactiveEls = Array.from(
      document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]')
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
      if (r.width < 43.5 || r.height < 43.5) {
        undersizedTargets.push({
          tag: el.tagName.toLowerCase(),
          label: cleanLabel || '(unlabeled)',
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
        });
      }
      if (!cleanLabel) {
        unlabeledControls.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          type: el.getAttribute('type') || '',
        });
      }
    }

    const allEls = Array.from(document.querySelectorAll('*'));
    const contrastFailures = [];
    const violetUsages = [];
    let inlineStyleCount = 0;
    let sub12PxCount = 0;

    for (const el of allEls) {
      if (el.hasAttribute('style')) inlineStyleCount++;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.6) continue;

      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const rgb = parseRgb(st[prop] || '');
        if (rgb && rgb.r > 130 && rgb.b > 200 && rgb.g < 140 && rgb.a > 0.05) {
          violetUsages.push({ tag: el.tagName.toLowerCase(), prop, value: st[prop] });
        }
      }

      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
      );
      if (!hasDirectText) continue;
      if (el.closest('button:disabled, select:disabled, input:disabled')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const fontSize = parseFloat(st.fontSize);
      const fontWeight = parseInt(st.fontWeight, 10) || 400;
      if (fontSize < 12) sub12PxCount++;

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
            text: el.textContent.trim().slice(0, 50),
            fontSize,
            color: st.color,
            bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
            ratio,
            required: threshold,
          });
        }
      }
    }

    // Check Card 1 clipping & Header height clipping
    const statSection = document.querySelector('section[aria-label="Chỉ số vận hành thời gian thực"]');
    const card1 = statSection?.children?.[0];
    const card1OverflowRightPx = card1
      ? Math.max(
          0,
          ...Array.from(card1.querySelectorAll('*')).map((c) =>
            Math.round(c.getBoundingClientRect().right - card1.getBoundingClientRect().right)
          )
        )
      : 0;

    const header = document.querySelector('header');
    const headerOverflowBottomPx = header
      ? Math.max(
          0,
          ...Array.from(header.querySelectorAll('*')).map((c) =>
            Math.round(c.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom)
          )
        )
      : 0;

    return {
      viewportLabel: vpLabel,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: docEl.scrollWidth,
      scrollHeight: docEl.scrollHeight,
      horizontalOverflowPx,
      headings,
      interactiveCount: interactiveEls.length,
      undersizedTargetCount: undersizedTargets.length,
      undersizedTargets,
      unlabeledControlCount: unlabeledControls.length,
      unlabeledControls,
      inlineStyleCount,
      sub12PxCount,
      violetCount: violetUsages.length,
      violetUsages,
      contrastFailureCount: contrastFailures.length,
      contrastFailures,
      card1OverflowRightPx,
      headerOverflowBottomPx,
      rootBg: getComputedStyle(document.querySelector('#root > div, #root > main') || document.body).backgroundColor,
      rootFont: getComputedStyle(document.body).fontFamily,
    };
  }, label);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  cleanupTmp();

  const dbBefore = {
    moviesDb: fileDigestInfo(REAL_MOVIES_DB),
    film4kDb: fileDigestInfo(REAL_FILM4K_DB),
  };

  // Copy movies.db to /tmp/verify_after_admin_18092.db & pre-seed visionquest master.m3u8
  fs.copyFileSync(REAL_MOVIES_DB, TMP_DB);
  fs.mkdirSync(TMP_WORKDIR, { recursive: true });
  fs.mkdirSync(path.join(TMP_PLAYLISTS, 'visionquest'), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_PLAYLISTS, 'visionquest', 'master.m3u8'),
    '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080\nindex.m3u8\n'
  );

  const telemetry = {
    startedAt: new Date().toISOString(),
    port: PORT,
    dbBefore,
    authAndCookieChecks: {},
    crawlerContractAndErrorChecks: {},
    crudAndTelemetryChecks: {},
    viewportsAndA11y: {},
    assetWeights: {},
    postLogout401Count: 0,
  };

  let backendProc = null;
  let browser = null;

  try {
    backendProc = spawn(
      path.join(REPO_ROOT, 'target', 'debug', 'webproxy_backend'),
      [],
      {
        cwd: TMP_WORKDIR,
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(PORT),
          DATABASE_PATH: TMP_DB,
          PLAYLISTS_DIR: TMP_PLAYLISTS,
          STATIC_DIR: FRONTEND_DIST,
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

    await waitForHttp(`${BASE_URL}/api/health/live`, 15000);

    // Check logo asset weight directly
    const logo64Res = await fetch(`${BASE_URL}/logo-64.png`);
    const logo64Bytes = (await logo64Res.arrayBuffer()).byteLength;
    const logoPngRes = await fetch(`${BASE_URL}/logo.png`);
    const logoPngBytes = (await logoPngRes.arrayBuffer()).byteLength;
    telemetry.assetWeights = { logo64Bytes, logoPngBytes };

    browser = await chromium.launch({
      headless: true,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'vi-VN',
    });
    const page = await context.newPage();

    const admin401Responses = [];
    let loginSetCookieHeader = null;
    page.on('response', (res) => {
      if (res.url().includes('/api/admin/login') && res.request().method() === 'POST' && res.status() === 200) {
        loginSetCookieHeader = res.headers()['set-cookie'] || null;
      }
      if (res.url().includes('/api/admin/') && !res.url().includes('/api/admin/login') && res.status() === 401) {
        admin401Responses.push({ url: res.url(), method: res.request().method() });
      }
    });

    // =========================================================================
    // A. SESSION COOKIE AUTH, INPUT SEMANTICS & LOGOUT
    // =========================================================================
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(OUT_DIR, '01_verified_login_desktop_1440x900.png') });
    telemetry.viewportsAndA11y.loginDesktop1440 = await auditViewport(page, 'login_1440x900');

    const pwInputAudit = await page.locator('#admin-password').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        name: el.getAttribute('name'),
        autoComplete: el.getAttribute('autocomplete'),
        hasHiddenUsernameInput: Boolean(
          el.closest('form')?.querySelector('input[name="username"][autocomplete="username"]')
        ),
        width: r.width,
        height: r.height,
        borderColor: cs.borderColor,
        outlineStyle: cs.outlineStyle,
      };
    });
    const eyeToggleBox = await page.locator('button[aria-controls="admin-password"]').boundingBox();

    // Valid login via Enter
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#admin-password').press('Enter');
    await page.waitForSelector('h1:has-text("Bảng Điều Khiển Quản Trị")', { timeout: 8000 });
    await page.waitForTimeout(700);

    const cookiesAfterLogin = await context.cookies();
    const adminCookie = cookiesAfterLogin.find((c) => c.name === 'bofilm_admin_session');
    const storageCheck = await page.evaluate(() => ({
      rawBearerTokenInSessionStorage: sessionStorage.getItem('bofilm_admin_token'),
      rawBearerTokenInLocalStorage: localStorage.getItem('bofilm_admin_token'),
      sessionFlag: sessionStorage.getItem('bofilm_admin_authenticated'),
    }));

    await page.screenshot({ path: path.join(OUT_DIR, '02_verified_dashboard_desktop_1440x900.png') });
    await page.screenshot({ path: path.join(OUT_DIR, '03_verified_dashboard_fullpage_1440x900.png'), fullPage: true });

    // Reload persistence via HttpOnly cookie
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('h1:has-text("Bảng Điều Khiển Quản Trị")', { timeout: 8000 });
    await page.waitForTimeout(500);
    const persistedViaCookie = await page.locator('h1:has-text("Bảng Điều Khiển Quản Trị")').isVisible();

    // =========================================================================
    // B. REAL CRAWLER CONTRACT, INVALID MODE 400, GLOBAL CACHE DIALOG & 500 ERROR TOAST
    // =========================================================================
    // Test invalid crawler mode returns 400 Bad Request
    const invalidModeCheck = await page.evaluate(async () => {
      const res = await fetch('/api/admin/crawler/trigger', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'stage1_catalog' }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    });

    // Capture real crawler button requests
    const crawlerCalls = [];
    const onCrawlerRes = async (res) => {
      const u = res.url();
      if (u.includes('/api/admin/crawler/')) {
        let reqBody = null;
        try { reqBody = res.request().postDataJSON(); } catch {}
        let resBody = null;
        try { resBody = await res.json(); } catch {}
        crawlerCalls.push({ pathname: new URL(u).pathname, status: res.status(), reqBody, resBody });
      }
    };
    page.on('response', onCrawlerRes);

    // Click Latest, Force, Warmup (prewarm), and Full (via Confirm Dialog)
    await page.getByRole('button', { name: 'Quét Cập Nhật Phim Mới' }).click();
    await page.waitForTimeout(450);
    await page.getByRole('button', { name: 'Làm Mới Bắt Buộc (Force)' }).click();
    await page.waitForTimeout(450);
    await page.getByRole('button', { name: 'Nạp Trước Dữ Liệu Phim Hot' }).click();
    await page.waitForTimeout(450);

    // Full crawl confirmation dialog
    await page.getByRole('button', { name: /Đồng Bộ Toàn Bộ Kho/i }).first().click();
    await page.waitForSelector('dialog[open]', { timeout: 5000 });
    await page.screenshot({ path: path.join(OUT_DIR, '04_verified_confirm_dialog_desktop.png') });
    await page.locator('dialog[open]').getByRole('button', { name: /Đồng bộ|Bắt đầu/i }).click();
    await page.waitForTimeout(450);
    page.off('response', onCrawlerRes);

    // Check Toast position relative to sticky header (must not overlap header <= 64px)
    await page.getByRole('button', { name: 'Làm Mới Số Liệu' }).click();
    await page.waitForTimeout(200);
    const toastGeometry = await page.evaluate(() => {
      const header = document.querySelector('header');
      const toast = document.querySelector('[role="status"], [role="alert"]');
      if (!header || !toast) return null;
      const hr = header.getBoundingClientRect();
      const tr = toast.getBoundingClientRect();
      return {
        headerBottom: Math.round(hr.bottom),
        toastTop: Math.round(tr.top),
        overlapsHeader: tr.top < hr.bottom,
      };
    });

    // Simulate HTTP 500 on per-movie cache clear -> verify error Toast with role="alert"
    await page.route('**/api/admin/cache/clear/**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Simulated upstream disk failure 500' }),
      });
    });
    await page.locator('table tbody tr').first().getByRole('button', { name: /^Xóa cache M3U8 phim /i }).click();
    await page.waitForSelector('dialog[open]', { timeout: 5000 });
    await page.locator('dialog[open]').getByRole('button', { name: /Xóa cache/i }).click();
    await page.waitForSelector('[role="alert"]', { timeout: 5000 });
    const errorToastAudit = await page.locator('[role="alert"]').first().evaluate((el) => ({
      role: el.getAttribute('role'),
      ariaLive: el.getAttribute('aria-live'),
      text: el.textContent.trim(),
      className: el.className,
    }));
    await page.screenshot({ path: path.join(OUT_DIR, '05_verified_error_toast_on_500.png') });
    await page.unroute('**/api/admin/cache/clear/**');
    if ((await page.locator('dialog[open]').count()) > 0) {
      await page.locator('dialog[open]').getByRole('button', { name: 'Hủy bỏ' }).click();
      await page.waitForTimeout(200);
    }

    telemetry.crawlerContractAndErrorChecks = {
      invalidModeCheck,
      crawlerCalls,
      toastGeometry,
      errorToastAudit,
    };

    // =========================================================================
    // C. LIVE MOVIE CRUD + ACCURATE TELEMETRY (has_cached_m3u8 & non-zero DB size) + SORT
    // =========================================================================
    const statsResJson = await page.evaluate(async () => {
      const r = await fetch('/api/admin/stats', { credentials: 'include' });
      return await r.json();
    });

    // Check visionquest row shows "Có mục playlist cache"
    const searchInput = page.locator('#admin-movie-search');
    await searchInput.fill('visionquest');
    await page.waitForTimeout(400);
    const visionquestCachedBadgeVisible = await page
      .locator('table tbody tr')
      .first()
      .locator('text=Có mục playlist cache')
      .isVisible();
    await searchInput.fill('');
    await page.waitForTimeout(400);

    // 1. Open Create Movie Modal & test validation + valid creation
    await page.getByRole('button', { name: 'Thêm Phim Mới' }).click();
    await page.waitForSelector('dialog[open] #crud-title-vi', { timeout: 5000 });

    // Submit empty to verify validation error alerts
    await page.locator('dialog[open] button[type="submit"]').click();
    const createValidationErrorVisible = await page.locator('#err-title-vi').isVisible();

    // Fill valid new movie
    await page.locator('#crud-title-vi').fill('Phim Kiểm Chứng Hậu Sửa Lỗi');
    await page.locator('#crud-title-en').fill('Post Remediation Verified Film');
    await page.locator('#crud-slug').fill('audit-verified-film-2026');
    await page.locator('#crud-score').fill('9.4');
    await page.locator('#crud-quality').fill('4K HDR');
    await page.locator('#crud-stream').fill('https://fiml4k.fun/api/hls/demo/master.m3u8');
    await page.locator('#crud-overview').fill('Bản ghi kiểm thử E2E CRUD trên cơ sở dữ liệu tạm thời.');
    await page.screenshot({ path: path.join(OUT_DIR, '06_verified_create_movie_modal.png') });

    const [createMovieRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/admin/movies') && r.request().method() === 'POST'),
      page.locator('dialog[open] button[type="submit"]').click(),
    ]);
    const createMovieStatus = createMovieRes.status();
    await page.waitForTimeout(500);

    // Search for created movie & verify in table
    await searchInput.fill('audit-verified-film-2026');
    await page.waitForTimeout(400);
    const createdRowVisible = await page.locator('table tbody tr:has-text("Phim Kiểm Chứng Hậu Sửa Lỗi")').isVisible();

    // 2. Edit Movie Modal (PUT /api/admin/movies/:slug)
    await page.locator('table tbody tr').first().getByRole('button', { name: /^Sửa thông tin phim/i }).click();
    await page.waitForSelector('dialog[open] #crud-title-vi', { timeout: 5000 });
    await page.locator('#crud-title-vi').fill('Phim Kiểm Chứng Đã Cập Nhật CRUD');
    await page.locator('#crud-quality').fill('4K Dolby Vision');
    const [editMovieRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/movies/audit-verified-film-2026') && r.request().method() === 'PUT'
      ),
      page.locator('dialog[open] button[type="submit"]').click(),
    ]);
    const editMovieStatus = editMovieRes.status();
    await page.waitForTimeout(500);
    const updatedRowVisible = await page
      .locator('table tbody tr:has-text("Phim Kiểm Chứng Đã Cập Nhật CRUD")')
      .isVisible();
    await page.screenshot({ path: path.join(OUT_DIR, '07_verified_edited_movie_row.png') });

    // 3. Delete Movie Confirmation (DELETE /api/admin/movies/:slug)
    await page.locator('table tbody tr').first().getByRole('button', { name: /^Xóa phim /i }).click();
    await page.waitForSelector('dialog[open]', { timeout: 5000 });
    const [deleteMovieRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/movies/audit-verified-film-2026') && r.request().method() === 'DELETE'
      ),
      page.locator('dialog[open]').getByRole('button', { name: 'Xóa vĩnh viễn' }).click(),
    ]);
    const deleteMovieStatus = deleteMovieRes.status();
    await page.waitForTimeout(500);
    const deletedMovieEmptySearch = await page
      .locator('text=Không tìm thấy phim phù hợp với từ khóa tìm kiếm.')
      .isVisible();
    await searchInput.fill('');
    await page.waitForTimeout(400);

    // 4. Column Sort ("Tên A-Z" & "Điểm") + Back-button state preservation
    await page.getByRole('button', { name: 'Tên A-Z' }).first().click();
    await page.waitForTimeout(400);
    const firstTitleSortedAZ = await page.locator('table tbody tr').first().locator('td').first().textContent();
    const urlAfterSort = page.url();

    // Click "Xem" -> goBack -> verify sort=name_asc preserved!
    await page.locator('table tbody tr').first().getByRole('button', { name: /^Xem phim /i }).click();
    await page.waitForTimeout(400);
    await page.goBack({ waitUntil: 'networkidle' });
    await page.waitForSelector('h1:has-text("Bảng Điều Khiển Quản Trị")', { timeout: 8000 });
    await page.waitForTimeout(400);
    const sortPreservedAfterBack = await page
      .getByRole('button', { name: 'Tên A-Z' })
      .first()
      .getAttribute('aria-pressed');

    telemetry.crudAndTelemetryChecks = {
      databaseBytes: statsResJson.disk_usage?.database_bytes,
      diskHumanReadable: statsResJson.disk_usage?.human_readable,
      cachedPlaylistsCount: statsResJson.cached_playlists_count,
      visionquestCachedBadgeVisible,
      createValidationErrorVisible,
      createMovieStatus,
      createdRowVisible,
      editMovieStatus,
      updatedRowVisible,
      deleteMovieStatus,
      deletedMovieEmptySearch,
      firstTitleSortedAZ: firstTitleSortedAZ?.trim().slice(0, 60),
      urlAfterSort,
      sortPreservedAfterBack,
    };

    // =========================================================================
    // D. UNIFIED AVOCADO THEME, LAYOUT & WCAG AA ACROSS 1440x900 / 768x1024 / 390x844
    // =========================================================================
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    telemetry.viewportsAndA11y.dashboardDesktop1440 = await auditViewport(page, 'dashboard_1440x900');

    // Tablet 768x1024
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT_DIR, '08_verified_dashboard_tablet_768x1024.png') });
    telemetry.viewportsAndA11y.dashboardTablet768 = await auditViewport(page, 'dashboard_768x1024');

    // Mobile 390x844 (Stacked Mobile Card List!)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT_DIR, '09_verified_dashboard_mobile_390x844.png') });
    const mobileListLocator = page.locator('[aria-label="Danh sách phim quản trị trên di động"]');
    await mobileListLocator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, '10_verified_mobile_cards_390x844.png') });
    telemetry.viewportsAndA11y.dashboardMobile390 = await auditViewport(page, 'dashboard_390x844');

    // Verify Global Clear All Cache button + Confirmation Dialog at Desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Xóa Toàn Bộ Cache M3U8' }).click();
    await page.waitForSelector('dialog[open]', { timeout: 5000 });
    const [clearAllRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/admin/cache/clear') && r.request().method() === 'POST'),
      page.locator('dialog[open]').getByRole('button', { name: /Xóa toàn bộ/i }).click(),
    ]);
    telemetry.crawlerContractAndErrorChecks.globalClearAllCacheStatus = clearAllRes.status();
    await page.waitForTimeout(350);

    // Check prefers-reduced-motion rules present
    const reducedMotionRulesPresent = await page.evaluate(() =>
      Array.from(document.styleSheets).some((s) => {
        try {
          return Array.from(s.cssRules).some((r) => r.cssText.includes('prefers-reduced-motion'));
        } catch {
          return false;
        }
      })
    );
    telemetry.viewportsAndA11y.reducedMotionRulesPresent = reducedMotionRulesPresent;

    // Logout & verify zero post-logout 401 requests!
    admin401Responses.length = 0;
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await page.waitForSelector('#admin-password', { timeout: 5000 });
    await page.waitForTimeout(600);
    telemetry.postLogout401Count = admin401Responses.length;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(OUT_DIR, '11_verified_login_mobile_390x844.png') });
    telemetry.viewportsAndA11y.loginMobile390 = await auditViewport(page, 'login_390x844');

    telemetry.authAndCookieChecks = {
      loginSetCookieHeader,
      cookieHttpOnly: adminCookie?.httpOnly ?? false,
      cookieSameSite: adminCookie?.sameSite ?? null,
      cookiePath: adminCookie?.path ?? null,
      storageCheck,
      pwInputAudit,
      eyeToggleBox,
      persistedViaCookie,
      postLogout401Count: admin401Responses.length,
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    if (backendProc && !backendProc.killed) {
      try { backendProc.kill('SIGKILL'); } catch {}
    }
    cleanupTmp();

    telemetry.dbAfter = {
      moviesDb: fileDigestInfo(REAL_MOVIES_DB),
      film4kDb: fileDigestInfo(REAL_FILM4K_DB),
    };
    telemetry.zeroRealDbMutation =
      telemetry.dbBefore.moviesDb.sha256 === telemetry.dbAfter.moviesDb.sha256 &&
      telemetry.dbBefore.film4kDb.sha256 === telemetry.dbAfter.film4kDb.sha256;
    telemetry.completedAt = new Date().toISOString();

    fs.writeFileSync(
      path.join(OUT_DIR, 'verified_admin_telemetry.json'),
      JSON.stringify(telemetry, null, 2),
      'utf-8'
    );
  }
}

main().catch((err) => {
  console.error('VERIFY ADMIN AFTER FIX FAILED:', err);
  process.exit(1);
});
