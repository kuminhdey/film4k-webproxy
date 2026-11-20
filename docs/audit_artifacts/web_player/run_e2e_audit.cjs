// /Users/kuminhdey/Downloads/webproxy/docs/audit_artifacts/web_player/run_e2e_audit.cjs
// Live Playwright Real-User E2E + Taste Skill + UI/UX Pro Max Audit Runner (Node.js / x64-arm64 / macOS)

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const PW_MODULE_PATHS = [
  '/Users/kuminhdey/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
  '/Users/kuminhdey/Downloads/Minh_Test/node_modules/playwright',
  '/Users/kuminhdey/Downloads/bot_pharamcity/node_modules/playwright',
  'playwright',
];

let playwright = null;
for (const p of PW_MODULE_PATHS) {
  try {
    playwright = require(p);
    break;
  } catch (_) {}
}
if (!playwright) {
  throw new Error('Playwright module could not be resolved');
}

const REPO_ROOT = '/Users/kuminhdey/Downloads/webproxy';
const ARTIFACT_DIR = path.join(REPO_ROOT, 'docs/audit_artifacts/web_player');
const TMP_DIR = '/tmp/pw_web_player_isolated_' + process.pid;
const BACKEND_PORT = 18081;
const BASE_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function checkPortListening(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(url, { timeout: 1500 }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return true;
    } catch (_) {}
    await wait(300);
  }
  return false;
}

function generateLocalHlsFixture(hlsDir) {
  fs.mkdirSync(path.join(hlsDir, 'v1080'), { recursive: true });
  fs.mkdirSync(path.join(hlsDir, 'v720'), { recursive: true });
  // Generate 8-second real H.264 + AAC HLS variants using ffmpeg
  execSync(
    `ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=24 -f lavfi -i sine=frequency=440:sample_rate=44100 ` +
      `-t 8 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 24 -sc_threshold 0 -c:a aac -b:a 96k ` +
      `-f hls -hls_time 2 -hls_playlist_type vod -hls_segment_filename "${path.join(hlsDir, 'v1080/seg_%03d.ts')}" "${path.join(hlsDir, 'v1080/prog.m3u8')}"`,
    { stdio: 'ignore' }
  );
  execSync(
    `ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=24 -f lavfi -i sine=frequency=660:sample_rate=44100 ` +
      `-t 8 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 24 -sc_threshold 0 -c:a aac -b:a 64k ` +
      `-f hls -hls_time 2 -hls_playlist_type vod -hls_segment_filename "${path.join(hlsDir, 'v720/seg_%03d.ts')}" "${path.join(hlsDir, 'v720/prog.m3u8')}"`,
    { stdio: 'ignore' }
  );
  const masterM3u8 = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080,NAME="1080p"',
    'v1080/prog.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720,NAME="720p"',
    'v720/prog.m3u8',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(hlsDir, 'master.m3u8'), masterM3u8);
  const vttVi = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:04.000',
    'Phụ đề Tiếng Việt kiểm thử trực tiếp trên trình phát.',
    '',
    '00:00:04.000 --> 00:00:08.000',
    'Dòng phụ đề thứ hai đang hiển thị chính xác.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(hlsDir, 'sub_vi.vtt'), vttVi);
}

// Browser-side comprehensive DOM, Taste Skill, Accessibility, Contrast & Layout evaluator
async function collectPageDiagnostics(page, label) {
  return await page.evaluate((pageLabel) => {
    function parseRgb(str) {
      if (!str) return null;
      const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (!m) return null;
      return {
        r: parseFloat(m[1]),
        g: parseFloat(m[2]),
        b: parseFloat(m[3]),
        a: m[4] !== undefined ? parseFloat(m[4]) : 1,
      };
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
    function getEffectiveBg(el) {
      const layers = [];
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const bg = parseRgb(getComputedStyle(cur).backgroundColor);
        if (bg && bg.a > 0) layers.push(bg);
        if (bg && bg.a >= 0.99) break;
        cur = cur.parentElement;
      }
      // Base canvas fallback (check body/html, else dark #0a0a0a if dark theme, else white)
      let acc = { r: 10, g: 10, b: 12, a: 1 };
      const htmlBg = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
      if (htmlBg && htmlBg.a > 0) acc = blend(htmlBg, acc);
      for (let i = layers.length - 1; i >= 0; i--) {
        acc = blend(layers[i], acc);
      }
      return acc;
    }
    function relLum({ r, g, b }) {
      const conv = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * conv(r) + 0.7152 * conv(g) + 0.0722 * conv(b);
    }
    function contrastRatio(c1, c2) {
      const l1 = relLum(c1);
      const l2 = relLum(c2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }
    function isVisible(el) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docScrollWidth = document.documentElement.scrollWidth;
    const bodyScrollWidth = document.body ? document.body.scrollWidth : 0;

    // 1. Headings & Typography hierarchy
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .filter(isVisible)
      .map((h) => {
        const st = getComputedStyle(h);
        const r = h.getBoundingClientRect();
        return {
          tag: h.tagName.toLowerCase(),
          text: (h.innerText || '').trim().slice(0, 100),
          fontSize: st.fontSize,
          fontWeight: st.fontWeight,
          lineHeight: st.lineHeight,
          letterSpacing: st.letterSpacing,
          fontFamily: st.fontFamily.slice(0, 80),
          top: Math.round(r.top + window.scrollY),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      });

    // 2. Landmarks
    const landmarks = {
      header: document.querySelectorAll('header').length,
      nav: document.querySelectorAll('nav').length,
      main: document.querySelectorAll('main').length,
      footer: document.querySelectorAll('footer').length,
      skipLink: !!document.querySelector('a[href^="#main"], a[href^="#content"]'),
    };

    // 3. Images & Aspect Ratios
    const images = Array.from(document.querySelectorAll('img')).map((img) => {
      const r = img.getBoundingClientRect();
      const st = getComputedStyle(img);
      return {
        src: (img.currentSrc || img.src || '').slice(0, 140),
        alt: img.getAttribute('alt'),
        hasAltAttr: img.hasAttribute('alt'),
        loading: img.getAttribute('loading'),
        widthAttr: img.getAttribute('width'),
        heightAttr: img.getAttribute('height'),
        aspectRatioCss: st.aspectRatio,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        shownWidth: Math.round(r.width),
        shownHeight: Math.round(r.height),
        top: Math.round(r.top + window.scrollY),
        visible: isVisible(img),
      };
    });
    const brokenImages = images.filter((i) => i.visible && i.complete && i.naturalWidth === 0);
    const missingAltImages = images.filter((i) => i.visible && !i.hasAltAttr);
    const missingDimsImages = images.filter(
      (i) => i.visible && !i.widthAttr && !i.heightAttr && (!i.aspectRatioCss || i.aspectRatioCss === 'auto')
    );
    const belowFoldNotLazy = images.filter((i) => i.visible && i.top > vh * 1.2 && i.loading !== 'lazy');

    // 4. Interactive controls: tap targets, cursor, accessible names
    const interactives = Array.from(
      document.querySelectorAll('a, button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')
    ).filter(isVisible);

    const undersizedTargets44 = [];
    const undersizedTargets24 = [];
    const unlabeledControls = [];
    const missingCursorPointer = [];

    for (const el of interactives) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      const text = (el.innerText || el.value || '').trim();
      const ariaLabel = el.getAttribute('aria-label') || '';
      const ariaLabelledBy = el.getAttribute('aria-labelledby') || '';
      const title = el.getAttribute('title') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const imgAlt = el.querySelector('img[alt]')?.getAttribute('alt') || '';
      const accessibleName = (ariaLabel || text || imgAlt || title || placeholder || ariaLabelledBy).trim();
      const desc = {
        tag: el.tagName.toLowerCase(),
        className: String(el.className || '').slice(0, 80),
        name: accessibleName.slice(0, 50),
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.left),
        y: Math.round(r.top + window.scrollY),
        cursor: st.cursor,
      };
      if (r.width < 44 || r.height < 44) {
        undersizedTargets44.push(desc);
      }
      if (r.width < 24 || r.height < 24) {
        undersizedTargets24.push(desc);
      }
      if (!accessibleName && el.tagName.toLowerCase() !== 'input') {
        unlabeledControls.push(desc);
      }
      if (
        (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') &&
        !el.disabled &&
        st.cursor !== 'pointer'
      ) {
        missingCursorPointer.push(desc);
      }
    }

    // 5. Contrast & tiny text check across visible leaf-ish text elements
    const textCandidates = Array.from(
      document.querySelectorAll('p, span, a, button, li, label, h1, h2, h3, h4, small, div')
    ).filter((el) => {
      if (!isVisible(el)) return false;
      // Check direct text node presence
      let directText = '';
      for (const n of el.childNodes) {
        if (n.nodeType === 3) directText += n.textContent;
      }
      return directText.trim().length > 0;
    });

    const lowContrast = [];
    const tinyText = [];
    const emojiNodes = [];
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

    for (const el of textCandidates.slice(0, 350)) {
      const st = getComputedStyle(el);
      const fontSize = parseFloat(st.fontSize);
      const fontWeight = parseInt(st.fontWeight, 10) || 400;
      const text = (el.innerText || '').trim().slice(0, 70);
      if (fontSize < 12) {
        tinyText.push({
          tag: el.tagName.toLowerCase(),
          text,
          fontSize: st.fontSize,
          className: String(el.className || '').slice(0, 70),
        });
      }
      if (emojiRegex.test(text)) {
        emojiNodes.push({
          tag: el.tagName.toLowerCase(),
          text,
          className: String(el.className || '').slice(0, 70),
        });
      }
      const fgRaw = parseRgb(st.color);
      if (fgRaw) {
        const bg = getEffectiveBg(el);
        const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
        const ratio = contrastRatio(fg, bg);
        const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        const threshold = isLarge ? 3.0 : 4.5;
        // Skip elements sitting directly over dynamic backdrop images if bg was transparent all the way,
        // still record with note so we can verify
        if (ratio < threshold) {
          lowContrast.push({
            tag: el.tagName.toLowerCase(),
            text,
            ratio: Number(ratio.toFixed(2)),
            threshold,
            fg: st.color,
            bgResolved: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
            fontSize: st.fontSize,
            className: String(el.className || '').slice(0, 70),
          });
        }
      }
    }

    // 6. Sections & Edge Alignment (Taste Skill rules 3 & 4)
    const sections = Array.from(document.querySelectorAll('main > section, section, .container, main > div'))
      .filter(isVisible)
      .slice(0, 25)
      .map((s) => {
        const r = s.getBoundingClientRect();
        return {
          tag: s.tagName.toLowerCase(),
          className: String(s.className || '').slice(0, 80),
          top: Math.round(r.top + window.scrollY),
          height: Math.round(r.height),
          left: Math.round(r.left),
          rightGap: Math.round(vw - r.right),
          width: Math.round(r.width),
        };
      });

    // 7. Overflowing elements if horizontal overflow exists
    const horizontalOverflowOffenders = [];
    if (docScrollWidth > vw + 1) {
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 2 || r.left < -2) {
          horizontalOverflowOffenders.push({
            tag: el.tagName.toLowerCase(),
            className: String(el.className || '').slice(0, 80),
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
          });
          if (horizontalOverflowOffenders.length >= 15) break;
        }
      }
    }

    // 8. Performance metrics injected via initScript
    const perfEntries = performance.getEntriesByType('navigation')[0];
    const paintEntries = performance.getEntriesByType('paint');
    const fcp = paintEntries.find((p) => p.name === 'first-contentful-paint')?.startTime || null;

    return {
      label: pageLabel,
      url: location.href,
      title: document.title,
      viewport: { vw, vh },
      overflow: {
        docScrollWidth,
        bodyScrollWidth,
        hasHorizontalOverflow: docScrollWidth > vw + 1,
        offenders: horizontalOverflowOffenders,
      },
      perf: {
        domContentLoaded: perfEntries ? Math.round(perfEntries.domContentLoadedEventEnd) : null,
        loadEvent: perfEntries ? Math.round(perfEntries.loadEventEnd) : null,
        fcpMs: fcp ? Math.round(fcp) : null,
        lcpMs: window.__auditPerf?.lcp ? Math.round(window.__auditPerf.lcp) : null,
        cls: window.__auditPerf?.cls !== undefined ? Number(window.__auditPerf.cls.toFixed(4)) : null,
      },
      landmarks,
      headings,
      sections,
      imagesSummary: {
        total: images.length,
        visible: images.filter((i) => i.visible).length,
        brokenCount: brokenImages.length,
        brokenSamples: brokenImages.slice(0, 10),
        missingAltCount: missingAltImages.length,
        missingDimsCount: missingDimsImages.length,
        belowFoldNotLazyCount: belowFoldNotLazy.length,
        posterRatiosSample: images
          .filter((i) => i.visible && i.shownHeight > 60)
          .slice(0, 12)
          .map((i) => ({
            src: i.src.slice(-45),
            shown: `${i.shownWidth}x${i.shownHeight}`,
            ratio: i.shownHeight ? Number((i.shownWidth / i.shownHeight).toFixed(2)) : null,
            natural: `${i.naturalWidth}x${i.naturalHeight}`,
          })),
      },
      interactivesSummary: {
        totalVisible: interactives.length,
        undersized44Count: undersizedTargets44.length,
        undersized44Samples: undersizedTargets44.slice(0, 20),
        undersized24Count: undersizedTargets24.length,
        undersized24Samples: undersizedTargets24.slice(0, 15),
        unlabeledCount: unlabeledControls.length,
        unlabeledSamples: unlabeledControls.slice(0, 20),
        missingCursorPointerCount: missingCursorPointer.length,
        missingCursorPointerSamples: missingCursorPointer.slice(0, 10),
      },
      typographyAndColor: {
        lowContrastCount: lowContrast.length,
        lowContrastSamples: lowContrast.slice(0, 20),
        tinyTextCount: tinyText.length,
        tinyTextSamples: tinyText.slice(0, 20),
        emojiCount: emojiNodes.length,
        emojiSamples: emojiNodes.slice(0, 15),
      },
    };
  }, label);
}

function attachTelemetry(page, bucketName, telemetry) {
  telemetry[bucketName] = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    httpErrors: [],
    streamRequests: [],
    largeAssets: [],
  };
  const b = telemetry[bucketName];

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') b.consoleErrors.push(text.slice(0, 300));
    else if (type === 'warning') b.consoleWarnings.push(text.slice(0, 300));
  });
  page.on('pageerror', (err) => {
    b.pageErrors.push(String(err?.stack || err).slice(0, 400));
  });
  page.on('requestfailed', (req) => {
    b.httpErrors.push({
      type: 'requestfailed',
      method: req.method(),
      url: req.url().slice(0, 220),
      failure: req.failure()?.errorText || 'unknown',
    });
  });
  page.on('response', async (res) => {
    const url = res.url();
    const status = res.status();
    const ct = res.headers()['content-type'] || '';
    const cl = parseInt(res.headers()['content-length'] || '0', 10);

    if (status >= 400) {
      b.httpErrors.push({
        type: 'http_status',
        status,
        method: res.request().method(),
        url: url.slice(0, 220),
      });
    }
    if (
      url.includes('.m3u8') ||
      url.includes('/stream/') ||
      url.includes('/proxy/stream') ||
      url.includes('?url=') ||
      url.includes('.vtt') ||
      url.includes('/subtitles/') ||
      url.includes('.ts')
    ) {
      b.streamRequests.push({
        status,
        url: url.slice(0, 220),
        contentType: ct,
      });
    }
    if (cl > 350 * 1024) {
      b.largeAssets.push({
        url: url.slice(0, 180),
        bytes: cl,
        kib: Math.round(cl / 1024),
        contentType: ct,
      });
    }
  });
}

const PERF_INIT_SCRIPT = `
  window.__auditPerf = { lcp: 0, cls: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__auditPerf.lcp = e.startTime;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__auditPerf.cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (_) {}
`;

async function main() {
  let backendProc = null;
  let browser = null;
  const reportData = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    diagnostics: {},
    interactions: {},
    telemetry: {},
  };

  try {
    // Prepare isolated DB & working directory so repo stays 100% untouched
    const tempDbPath = path.join(TMP_DIR, 'movies.db');
    fs.copyFileSync(path.join(REPO_ROOT, 'movies.db'), tempDbPath);
    fs.symlinkSync(path.join(REPO_ROOT, 'frontend'), path.join(TMP_DIR, 'frontend'));

    // Generate local HLS fixture for Phase 4B real video playback verification
    const hlsFixtureDir = path.join(TMP_DIR, 'hls_fixture');
    generateLocalHlsFixture(hlsFixtureDir);

    const alreadyListening = await checkPortListening(BACKEND_PORT);
    if (!alreadyListening) {
      const backendBin = path.join(REPO_ROOT, 'target/debug/webproxy_backend');
      backendProc = spawn(backendBin, [], {
        cwd: TMP_DIR,
        env: {
          ...process.env,
          PORT: String(BACKEND_PORT),
          DATABASE_PATH: tempDbPath,
          STATIC_DIR: path.join(REPO_ROOT, 'frontend/dist'),
          ADMIN_PASSWORD: 'StrongAuditSecret2026!',
          RUST_LOG: 'warn',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      backendProc.stderr.on('data', () => {});
      backendProc.stdout.on('data', () => {});
    }

    const healthy = await waitForHealth(`${BASE_URL}/api/health`, 20000);
    if (!healthy) {
      throw new Error(`Backend failed healthcheck on ${BASE_URL}/api/health`);
    }

    const launchOpts = { headless: true };
    if (fs.existsSync(CHROME_PATH)) {
      launchOpts.executablePath = CHROME_PATH;
    }
    browser = await playwright.chromium.launch(launchOpts);

    // =========================================================================
    // DESKTOP 1440x900 AUDIT
    // =========================================================================
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      locale: 'vi-VN',
    });
    await desktopCtx.addInitScript(PERF_INIT_SCRIPT);
    const page = await desktopCtx.newPage();
    attachTelemetry(page, 'desktop', reportData.telemetry);

    // --- 1. Homepage & Discovery ---
    const homeNavStart = Date.now();
    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await wait(1500);
    const homeLoadWallMs = Date.now() - homeNavStart;

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01_desktop_home_hero.png'), fullPage: false });
    reportData.diagnostics.desktopHomeInitial = await collectPageDiagnostics(page, 'desktop_home_initial');
    reportData.diagnostics.desktopHomeInitial.wallLoadMs = homeLoadWallMs;

    // Scroll down progressively to trigger lazy images & inspect sections
    const totalScrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 600; y < totalScrollHeight; y += 600) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
      await wait(250);
    }
    await wait(800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02_desktop_home_scrolled.png'), fullPage: false });
    reportData.diagnostics.desktopHomeAfterScroll = await collectPageDiagnostics(page, 'desktop_home_after_scroll');
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(400);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01b_desktop_home_full.png'), fullPage: true });

    // Inspect DOM structure of header, hero, cards, tabs so we record exact behavior
    const homeStructure = await page.evaluate(() => {
      const navLinks = Array.from(document.querySelectorAll('header a, header button, nav a, nav button')).map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').trim(),
        ariaLabel: el.getAttribute('aria-label'),
        href: el.getAttribute('href'),
        className: String(el.className || '').slice(0, 80),
      }));
      const buttons = Array.from(document.querySelectorAll('button, a')).slice(0, 50).map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').trim().slice(0, 60),
        href: el.getAttribute('href'),
        className: String(el.className || '').slice(0, 80),
      }));
      return { navLinks, sampleButtons: buttons };
    });
    reportData.interactions.homeStructure = homeStructure;

    // Hover test on first movie card
    const cardTest = await page.evaluate(() => {
      const card = document.querySelector('a[href*="/movie/"], a[href*="/phim/"], [class*="card"], [class*="movie"]');
      if (!card) return null;
      const r = card.getBoundingClientRect();
      const st = getComputedStyle(card);
      const img = card.querySelector('img');
      const imgSt = img ? getComputedStyle(img) : null;
      return {
        found: true,
        tag: card.tagName.toLowerCase(),
        href: card.getAttribute('href'),
        className: String(card.className || '').slice(0, 100),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        beforeTransform: st.transform,
        beforeShadow: st.boxShadow,
        beforeImgTransform: imgSt ? imgSt.transform : null,
      };
    });
    if (cardTest && cardTest.found) {
      await page.mouse.move(cardTest.x, cardTest.y);
      await wait(400);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '03_desktop_card_hover.png'), fullPage: false });
      const afterHover = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)?.closest('a[href*="/movie/"], a[href*="/phim/"], [class*="card"], [class*="movie"]');
        if (!el) return null;
        const st = getComputedStyle(el);
        const img = el.querySelector('img');
        return {
          afterTransform: st.transform,
          afterShadow: st.boxShadow,
          afterImgTransform: img ? getComputedStyle(img).transform : null,
        };
      }, cardTest);
      reportData.interactions.cardHover = { ...cardTest, ...afterHover };
    }

    // Test Category / Explore / Genre Tabs & Filters
    const categoryClickResult = {};
    const exploreLink = page.locator('header a, nav a, button').filter({ hasText: /Khám phá|Phim bộ|Phim lẻ|Thể loại|Explore|Series|Movies|Danh sách/i }).first();
    if ((await exploreLink.count()) > 0) {
      categoryClickResult.clickedText = (await exploreLink.innerText()).trim();
      await exploreLink.click({ timeout: 5000 }).catch(() => {});
      await wait(1000);
      categoryClickResult.urlAfterClick = page.url();
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '04_desktop_category_filter.png'), fullPage: false });
      reportData.diagnostics.desktopCategoryPage = await collectPageDiagnostics(page, 'desktop_category_page');

      // Check for filter/genre pills or selects or pagination
      const filterControls = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select')).map((s) => ({
          name: s.name || s.id || s.getAttribute('aria-label'),
          optionsCount: s.options.length,
          sampleOptions: Array.from(s.options).slice(0, 5).map((o) => o.text),
        }));
        const pills = Array.from(document.querySelectorAll('button')).map((b) => ({
          text: (b.innerText || '').trim(),
          className: String(b.className || '').slice(0, 60),
        })).filter((b) => b.text.length > 0 && b.text.length < 30);
        return { selects, pills: pills.slice(0, 30) };
      });
      categoryClickResult.filterControls = filterControls;
    }
    reportData.interactions.categoryTest = categoryClickResult;

    // Return to homepage for Search Flow & Keyboard Navigation
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await wait(1000);

    // --- Keyboard Tab Focus Ring Audit on Homepage ---
    const tabSequence = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      await wait(80);
      const active = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 40),
          outline: `${st.outlineWidth} ${st.outlineStyle} ${st.outlineColor}`,
          boxShadow: st.boxShadow.slice(0, 80),
          top: Math.round(r.top),
          left: Math.round(r.left),
          obscuredByHeader: r.top < 64 && st.position !== 'fixed' && !el.closest('header, nav'),
        };
      });
      tabSequence.push(active);
    }
    reportData.interactions.keyboardTabHome = tabSequence;

    // --- 2. Search Flow ---
    const searchAudit = {};
    // Find search trigger button or direct input
    let searchInput = page.locator('input[type="search"], input[type="text"], input[placeholder*="Tìm"], input[placeholder*="tìm"], input[placeholder*="Search"], input[placeholder*="search"]').first();
    if ((await searchInput.count()) === 0 || !(await searchInput.isVisible())) {
      const searchBtn = page.locator('button[aria-label*="Tìm"], button[aria-label*="Search"], header button').first();
      if ((await searchBtn.count()) > 0) {
        await searchBtn.click().catch(() => {});
        await wait(400);
      }
      searchInput = page.locator('input[type="search"], input[type="text"], input').first();
    }

    if ((await searchInput.count()) > 0 && (await searchInput.isVisible())) {
      searchAudit.inputFound = true;
      searchAudit.inputAttrs = await searchInput.evaluate((el) => ({
        type: el.getAttribute('type'),
        placeholder: el.getAttribute('placeholder'),
        ariaLabel: el.getAttribute('aria-label'),
        id: el.id,
        hasAssociatedLabel: !!(el.id && document.querySelector(`label[for="${el.id}"]`)) || !!el.closest('label'),
        fontSize: getComputedStyle(el).fontSize,
      }));

      // 2a. Valid Vietnamese query
      await searchInput.click();
      await searchInput.fill('Hắc Dạ');
      await wait(800);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '05_desktop_search_valid_vi.png'), fullPage: false });
      searchAudit.validViUrl = page.url();
      searchAudit.validViSuggestText = await page.evaluate(() => document.body.innerText.includes('Hắc Dạ Cáo Bạch'));

      // 2b. Valid English query
      await searchInput.fill('Spider-Man');
      await wait(800);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '05b_desktop_search_valid_en.png'), fullPage: false });
      searchAudit.validEnMatches = await page.evaluate(() => document.body.innerText.includes('Spider-Man'));

      // 2c. Partial query
      await searchInput.fill('Thủy');
      await wait(700);
      searchAudit.partialMatches = await page.evaluate(() => document.body.innerText.includes('Thủy Long Ngâm'));

      // 2d. Gibberish empty-result query + Enter
      await searchInput.fill('zzzznotfound99999');
      await searchInput.press('Enter');
      await wait(900);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '06_desktop_search_empty.png'), fullPage: false });
      searchAudit.emptyQueryUrl = page.url();
      searchAudit.emptyStateSample = await page.evaluate(() => {
        const mainText = (document.querySelector('main') || document.body).innerText;
        return mainText.slice(0, 400);
      });

      // 2e. XSS-like special characters
      // Re-locate search input if Enter navigated
      let searchInput2 = page.locator('input[type="search"], input[type="text"], input[placeholder*="Tìm"], input[placeholder*="tìm"], input[placeholder*="Search"], input[placeholder*="search"]').first();
      if ((await searchInput2.count()) === 0 || !(await searchInput2.isVisible())) {
        const sb = page.locator('button[aria-label*="Tìm"], button[aria-label*="Search"], header button').first();
        if ((await sb.count()) > 0) await sb.click().catch(() => {});
        await wait(300);
        searchInput2 = page.locator('input').first();
      }
      if ((await searchInput2.count()) > 0 && (await searchInput2.isVisible())) {
        const xssProbe = `"><img src=x onerror="window.__xssTriggered=1">' OR 1=1--`;
        await searchInput2.fill(xssProbe);
        await searchInput2.press('Enter');
        await wait(800);
        await page.screenshot({ path: path.join(ARTIFACT_DIR, '07_desktop_search_xss.png'), fullPage: false });
        searchAudit.xssExecuted = await page.evaluate(() => Boolean(window.__xssTriggered));

        // Escape key & clear test
        await searchInput2.press('Escape');
        await wait(300);
        searchAudit.valueAfterEscape = await searchInput2.inputValue().catch(() => null);
      }
    } else {
      searchAudit.inputFound = false;
    }
    reportData.interactions.searchAudit = searchAudit;

    // --- 3. Movie Detail Pages (Single Movie + Multi-Episode Series) & SPA Routing ---
    // Navigate back to Home and click into Single Movie (`spider-man-brand-new-day`)
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await wait(1000);

    // Click into a card from Homepage if present, else navigate via UI link
    const spiderLink = page.locator('a[href*="spider-man-brand-new-day"], [data-slug="spider-man-brand-new-day"]').first();
    if ((await spiderLink.count()) > 0) {
      await spiderLink.click().catch(() => {});
    } else {
      // Click first movie card on homepage first to test real card click routing!
      const anyCard = page.locator('a[href*="/movie/"], a[href*="/phim/"]').first();
      if ((await anyCard.count()) > 0) {
        await anyCard.click();
      } else {
        await page.goto(`${BASE_URL}/movie/spider-man-brand-new-day`);
      }
    }
    await wait(1200);
    reportData.interactions.firstCardClickUrl = page.url();

    // Ensure we inspect both a Single Movie (`spider-man-brand-new-day`) and Multi-Episode Series (`arsenal-military-academy` & `light-to-the-night`)
    await page.goto(`${BASE_URL}/movie/spider-man-brand-new-day`, { waitUntil: 'networkidle' }).catch(() => {});
    await wait(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '08_desktop_detail_single_movie.png'), fullPage: false });
    reportData.diagnostics.desktopDetailSingle = await collectPageDiagnostics(page, 'desktop_detail_single_movie');
    reportData.interactions.detailSingleMeta = await page.evaluate(() => {
      const synopsis = Array.from(document.querySelectorAll('p')).find((p) => (p.innerText || '').length > 60);
      const synSt = synopsis ? getComputedStyle(synopsis) : null;
      const synRect = synopsis ? synopsis.getBoundingClientRect() : null;
      return {
        url: location.href,
        h1: document.querySelector('h1')?.innerText,
        synopsisLength: synopsis?.innerText.length || 0,
        synopsisWidthPx: synRect ? Math.round(synRect.width) : null,
        synopsisFontSize: synSt?.fontSize,
        synopsisLineHeight: synSt?.lineHeight,
        buttons: Array.from(document.querySelectorAll('button, a'))
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || '').trim().slice(0, 40),
            href: el.getAttribute('href'),
          }))
          .filter((x) => x.text || x.href)
          .slice(0, 25),
      };
    });

    // Multi-Episode Series Detail (`arsenal-military-academy` - 48 episodes, and `light-to-the-night` - 17 episodes)
    await page.goto(`${BASE_URL}/movie/arsenal-military-academy`, { waitUntil: 'networkidle' }).catch(() => {});
    await wait(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '09_desktop_detail_series_48eps.png'), fullPage: true });
    reportData.diagnostics.desktopDetailSeries = await collectPageDiagnostics(page, 'desktop_detail_series');

    // Test SPA Back / Forward routing
    await page.goBack();
    await wait(700);
    const afterBackUrl = page.url();
    await page.goForward();
    await wait(700);
    const afterForwardUrl = page.url();
    reportData.interactions.spaBackForward = { afterBackUrl, afterForwardUrl };

    // Now open `light-to-the-night` detail and click Watch CTA like a real user!
    await page.goto(`${BASE_URL}/movie/light-to-the-night`, { waitUntil: 'networkidle' }).catch(() => {});
    await wait(900);
    const watchCta = page.locator('a[href*="/watch/"], a[href*="/xem-phim/"], button:has-text("Xem"), a:has-text("Xem")').first();
    if ((await watchCta.count()) > 0) {
      await watchCta.click();
    } else {
      await page.goto(`${BASE_URL}/watch/light-to-the-night/1`);
    }
    await wait(3500);

    // --- 4A. Watch Page & Video Player (Real Untouched Upstream Stream Behavior) ---
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '10_desktop_watch_series_ep1_real.png'), fullPage: false });
    reportData.diagnostics.desktopWatchEp1Real = await collectPageDiagnostics(page, 'desktop_watch_ep1_real');
    reportData.interactions.watchEp1RealState = await page.evaluate(() => {
      const v = document.querySelector('video');
      const playerControls = Array.from(document.querySelectorAll('button, input[type="range"], [role="slider"]'))
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || '').trim().slice(0, 35),
            ariaLabel: el.getAttribute('aria-label'),
            title: el.getAttribute('title'),
            className: String(el.className || '').slice(0, 70),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        });
      return {
        url: location.href,
        hasVideoElement: !!v,
        videoState: v
          ? {
              src: v.currentSrc || v.src,
              readyState: v.readyState,
              networkState: v.networkState,
              paused: v.paused,
              muted: v.muted,
              volume: v.volume,
              currentTime: v.currentTime,
              duration: v.duration,
              videoWidth: v.videoWidth,
              videoHeight: v.videoHeight,
              error: v.error ? { code: v.error.code, message: v.error.message } : null,
              textTracksCount: v.textTracks ? v.textTracks.length : 0,
              trackElements: Array.from(v.querySelectorAll('track')).map((t) => ({
                kind: t.kind,
                label: t.label,
                srclang: t.srclang,
                src: t.getAttribute('src'),
                default: t.default,
              })),
            }
          : null,
        visibleControls: playerControls.slice(0, 50),
      };
    });

    // Test Episode Switch (`Ep 1` -> `Ep 2`)
    const ep2Btn = page.locator('button, a').filter({ hasText: /^(Tập\s*0?2|0?2|Ep\s*0?2)$/i }).first();
    if ((await ep2Btn.count()) > 0) {
      await ep2Btn.click();
      await wait(2500);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '11_desktop_watch_series_ep2_switched.png'), fullPage: false });
      reportData.interactions.episodeSwitch = await page.evaluate(() => {
        const v = document.querySelector('video');
        return {
          switched: true,
          newUrl: location.href,
          videoReadyState: v?.readyState,
          videoCurrentTime: v?.currentTime,
          videoSrc: v?.currentSrc || v?.src,
        };
      });
    } else {
      reportData.interactions.episodeSwitch = { switched: false, note: 'Ep 2 selector did not match' };
    }

    // Navigate to Multi-Server Single Movie Watch Page (`spider-man-brand-new-day` has 3 servers!)
    await page.goto(`${BASE_URL}/watch/spider-man-brand-new-day`, { waitUntil: 'domcontentloaded' });
    await wait(2500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '12_desktop_watch_multiserver_before.png'), fullPage: false });

    const serverButtons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a'))
        .filter((el) => /Server|Dự Phòng|VIP|Direct CDN/i.test(el.innerText || ''))
        .map((el) => ({
          text: (el.innerText || '').trim(),
          className: String(el.className || '').slice(0, 80),
        }));
    });
    reportData.interactions.serverButtonsFound = serverButtons;

    const srv2Btn = page.locator('button, a').filter({ hasText: /Server 2|Dự Phòng/i }).first();
    if ((await srv2Btn.count()) > 0) {
      await srv2Btn.click();
      await wait(2500);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '12b_desktop_watch_server2_switched.png'), fullPage: false });
      reportData.interactions.serverSwitchAfter = await page.evaluate(() => {
        const v = document.querySelector('video');
        return {
          clickedServer2: true,
          url: location.href,
          bodyErrorText: (document.body.innerText.match(/lỗi|error|không thể tải|thử lại|server/gi) || []).slice(0, 10),
          videoError: v?.error ? { code: v.error.code, message: v.error.message } : null,
          videoReadyState: v?.readyState,
        };
      });
    }

    // --- 4B. Live Decoded HLS Video Player Controls Deep Test (Play/Pause, Space, Seek, Mute/Vol, Quality, CC, Audio, Fullscreen) ---
    const playerPage = await desktopCtx.newPage();
    attachTelemetry(playerPage, 'desktop_player_live_hls', reportData.telemetry);

    // Intercept HLS & VTT endpoints with our valid multi-bitrate ffmpeg HLS fixture so real H.264+AAC frames decode!
    await playerPage.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('master.m3u8') || (url.includes('/proxy/stream') && !url.includes('.ts') && !url.includes('prog.m3u8')) || (url.includes('/?url=') && url.includes('master.m3u8'))) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: fs.readFileSync(path.join(hlsFixtureDir, 'master.m3u8')),
        });
      }
      if (url.includes('v1080/prog.m3u8')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: fs.readFileSync(path.join(hlsFixtureDir, 'v1080/prog.m3u8')),
        });
      }
      if (url.includes('v720/prog.m3u8')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: fs.readFileSync(path.join(hlsFixtureDir, 'v720/prog.m3u8')),
        });
      }
      const segMatch = url.match(/(v1080|v720)\/(seg_\d+\.ts)/);
      if (segMatch) {
        const segFile = path.join(hlsFixtureDir, segMatch[1], segMatch[2]);
        if (fs.existsSync(segFile)) {
          return route.fulfill({
            status: 200,
            contentType: 'video/mp2t',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: fs.readFileSync(segFile),
          });
        }
      }
      if (url.endsWith('.vtt') || url.includes('/api/subtitles/')) {
        return route.fulfill({
          status: 200,
          contentType: 'text/vtt; charset=utf-8',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: fs.readFileSync(path.join(hlsFixtureDir, 'sub_vi.vtt')),
        });
      }
      return route.continue();
    });

    await playerPage.goto(`${BASE_URL}/watch/light-to-the-night/1`, { waitUntil: 'domcontentloaded' });
    await wait(2500);

    const liveControlsAudit = {};
    liveControlsAudit.initialVideo = await playerPage.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return null;
      return {
        readyState: v.readyState,
        duration: v.duration,
        paused: v.paused,
        muted: v.muted,
        volume: v.volume,
        currentTime: v.currentTime,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
      };
    });

    // Hover over video container so controls bar stays visible
    const videoBox = await playerPage.locator('video').first().boundingBox();
    if (videoBox) {
      await playerPage.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height - 30);
      await wait(300);
    }
    await playerPage.screenshot({ path: path.join(ARTIFACT_DIR, '13_desktop_player_loaded_controls.png'), fullPage: false });

    // Capture exact player control buttons & sliders in DOM
    liveControlsAudit.playerDomControls = await playerPage.evaluate(() => {
      const v = document.querySelector('video');
      const root = v?.closest('[class*="player"], [class*="video"], .relative') || document.body;
      return Array.from(root.querySelectorAll('button, input, [role="slider"], [class*="progress"], [class*="seek"]')).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type'),
          ariaLabel: el.getAttribute('aria-label'),
          title: el.getAttribute('title'),
          text: (el.innerText || '').trim().slice(0, 30),
          className: String(el.className || '').slice(0, 90),
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        };
      });
    });

    // Test Play via clicking video or Play button
    if (videoBox) {
      // Ensure muted so headless Chrome autoplay policy never blocks programmatic/click play if unmuted fails
      await playerPage.evaluate(() => {
        const v = document.querySelector('video');
        if (v && v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      });
      await wait(1200);
      liveControlsAudit.afterPlay = await playerPage.evaluate(() => {
        const v = document.querySelector('video');
        return v ? { paused: v.paused, currentTime: v.currentTime, readyState: v.readyState } : null;
      });
      await playerPage.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height - 25);
      await wait(200);
      await playerPage.screenshot({ path: path.join(ARTIFACT_DIR, '14_desktop_player_playing.png'), fullPage: false });

      // Test Spacebar toggle Play/Pause!
      // Focus the player container or body first
      await playerPage.mouse.click(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2);
      await wait(300);
      const pausedAfterCenterClick = await playerPage.evaluate(() => document.querySelector('video')?.paused);
      const scrollBeforeSpace = await playerPage.evaluate(() => window.scrollY);
      await playerPage.keyboard.press('Space');
      await wait(400);
      const afterSpace1 = await playerPage.evaluate(() => ({
        paused: document.querySelector('video')?.paused,
        scrollY: window.scrollY,
      }));
      await playerPage.keyboard.press('Space');
      await wait(400);
      const afterSpace2 = await playerPage.evaluate(() => ({
        paused: document.querySelector('video')?.paused,
        scrollY: window.scrollY,
      }));
      liveControlsAudit.spacebarAndClickToggle = {
        pausedAfterCenterClick,
        scrollBeforeSpace,
        afterSpace1,
        afterSpace2,
      };

      // Test ArrowRight / ArrowLeft seek keyboard shortcuts!
      const timeBeforeArrow = await playerPage.evaluate(() => document.querySelector('video')?.currentTime);
      await playerPage.keyboard.press('ArrowRight');
      await wait(300);
      const timeAfterArrowRight = await playerPage.evaluate(() => document.querySelector('video')?.currentTime);
      liveControlsAudit.arrowSeek = { timeBeforeArrow, timeAfterArrowRight };

      // Test Timeline Seek / Scrub via clicking progress bar or range input
      await playerPage.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height - 25);
      await wait(250);
      const seekTarget = await playerPage.evaluate(() => {
        const v = document.querySelector('video');
        const root = v?.parentElement?.parentElement || document;
        const bar =
          root.querySelector('input[type="range"]') ||
          root.querySelector('[role="slider"]') ||
          Array.from(root.querySelectorAll('div')).find((d) => {
            const r = d.getBoundingClientRect();
            const vRect = v.getBoundingClientRect();
            return r.width > vRect.width * 0.5 && r.height >= 3 && r.height <= 32 && r.bottom <= vRect.bottom && r.top > vRect.bottom - 90;
          });
        if (!bar) return null;
        const r = bar.getBoundingClientRect();
        return { x: r.left + r.width * 0.65, y: r.top + r.height / 2, w: r.width, h: r.height, tag: bar.tagName };
      });
      if (seekTarget) {
        await playerPage.mouse.click(seekTarget.x, seekTarget.y);
        await wait(500);
        liveControlsAudit.timelineSeek = {
          seekTarget,
          currentTimeAfterClick: await playerPage.evaluate(() => document.querySelector('video')?.currentTime),
        };
      } else {
        liveControlsAudit.timelineSeek = { seekTarget: null };
      }

      // Test Mute button & Volume slider
      const muteBtn = playerPage.locator('button[aria-label*="Mute"], button[aria-label*="mute"], button[aria-label*="Âm"], button[title*="Mute"], button[title*="Âm"]').first();
      if ((await muteBtn.count()) > 0) {
        const mutedBefore = await playerPage.evaluate(() => document.querySelector('video')?.muted);
        await muteBtn.click().catch(() => {});
        await wait(200);
        const mutedAfter = await playerPage.evaluate(() => document.querySelector('video')?.muted);
        liveControlsAudit.muteToggle = { foundByLabel: true, mutedBefore, mutedAfter };
      } else {
        liveControlsAudit.muteToggle = { foundByLabel: false };
      }

      // Test Settings / Quality / Subtitles / Audio menus if buttons exist inside player
      await playerPage.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height - 25);
      await wait(200);
      const playerButtonsCount = await playerPage.evaluate(() => {
        const v = document.querySelector('video');
        const root = v?.closest('[class*="player"], .relative, .aspect-video') || v?.parentElement;
        return root ? root.querySelectorAll('button').length : 0;
      });
      liveControlsAudit.playerButtonsCount = playerButtonsCount;

      // Try opening settings/subtitle/quality popover by clicking right-side player buttons (excluding fullscreen which is usually last)
      const rightSideButtons = await playerPage.evaluate(() => {
        const v = document.querySelector('video');
        const root = v?.closest('[class*="player"], .relative, .aspect-video') || v?.parentElement;
        if (!root) return [];
        const vRect = v.getBoundingClientRect();
        return Array.from(root.querySelectorAll('button'))
          .map((b, idx) => {
            const r = b.getBoundingClientRect();
            return {
              idx,
              text: (b.innerText || '').trim(),
              ariaLabel: b.getAttribute('aria-label'),
              title: b.getAttribute('title'),
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
              w: r.width,
              h: r.height,
              isRightSide: r.left > vRect.left + vRect.width * 0.5,
            };
          })
          .filter((b) => b.w > 0 && b.isRightSide);
      });
      liveControlsAudit.rightSideButtons = rightSideButtons;

      // Click penultimate right-side button (typically Settings/Quality or Subtitles) and screenshot menu!
      if (rightSideButtons.length >= 2) {
        const targetBtn = rightSideButtons[rightSideButtons.length - 2];
        await playerPage.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height - 25);
        await wait(150);
        await playerPage.mouse.click(targetBtn.x, targetBtn.y);
        await wait(400);
        await playerPage.screenshot({ path: path.join(ARTIFACT_DIR, '15_desktop_player_menu_open.png'), fullPage: false });
        liveControlsAudit.menuTextSample = await playerPage.evaluate(() => {
          const v = document.querySelector('video');
          const root = v?.closest('[class*="player"], .relative, .aspect-video') || v?.parentElement;
          return root ? root.innerText.slice(0, 400) : '';
        });
      }

      // Click Fullscreen button (last right-side button)
      if (rightSideButtons.length >= 1) {
        const fsBtn = rightSideButtons[rightSideButtons.length - 1];
        await playerPage.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height - 25);
        await wait(150);
        await playerPage.mouse.click(fsBtn.x, fsBtn.y);
        await wait(300);
        liveControlsAudit.fullscreenAfterClick = await playerPage.evaluate(() => ({
          fullscreenElement: !!document.fullscreenElement,
        }));
        if (liveControlsAudit.fullscreenAfterClick.fullscreenElement) {
          await playerPage.evaluate(() => document.exitFullscreen().catch(() => {}));
        }
      }
    }
    reportData.interactions.liveControlsAudit = liveControlsAudit;
    await playerPage.close();

    // --- Reduced Motion Emulation Check on Desktop ---
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await wait(800);
    reportData.interactions.reducedMotionCheck = await page.evaluate(() => {
      const animated = [];
      for (const el of Array.from(document.querySelectorAll('*')).slice(0, 400)) {
        const st = getComputedStyle(el);
        if (
          (st.animationName && st.animationName !== 'none' && parseFloat(st.animationDuration) > 0.01) ||
          parseFloat(st.transitionDuration) > 0.05
        ) {
          animated.push({
            tag: el.tagName.toLowerCase(),
            className: String(el.className || '').slice(0, 70),
            animationName: st.animationName,
            animationDuration: st.animationDuration,
            transitionDuration: st.transitionDuration,
          });
          if (animated.length >= 15) break;
        }
      }
      return { activeAnimationsOrTransitionsUnderReducedMotion: animated.length, samples: animated };
    });

    await desktopCtx.close();

    // =========================================================================
    // MOBILE 390x844 REAL-USER TOUCH AUDIT
    // =========================================================================
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      locale: 'vi-VN',
    });
    await mobileCtx.addInitScript(PERF_INIT_SCRIPT);
    const mPage = await mobileCtx.newPage();
    attachTelemetry(mPage, 'mobile', reportData.telemetry);

    // Mobile Home
    await mPage.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await wait(1200);
    await mPage.screenshot({ path: path.join(ARTIFACT_DIR, '16_mobile_home_hero.png'), fullPage: false });
    reportData.diagnostics.mobileHome = await collectPageDiagnostics(mPage, 'mobile_home_390x844');

    // Scroll Mobile Home
    await mPage.evaluate(() => window.scrollTo(0, 750));
    await wait(600);
    await mPage.screenshot({ path: path.join(ARTIFACT_DIR, '16b_mobile_home_scrolled.png'), fullPage: false });
    await mPage.evaluate(() => window.scrollTo(0, 0));
    await wait(300);

    // Mobile Navigation Menu / Search Check
    const mobileMenuTest = {};
    const menuBtns = mPage.locator('header button, nav button');
    mobileMenuTest.headerButtonCount = await menuBtns.count();
    if (mobileMenuTest.headerButtonCount > 0) {
      await menuBtns.last().tap().catch(() => menuBtns.last().click().catch(() => {}));
      await wait(500);
      await mPage.screenshot({ path: path.join(ARTIFACT_DIR, '17_mobile_header_interaction.png'), fullPage: false });
    }
    reportData.interactions.mobileMenuTest = mobileMenuTest;

    // Mobile Series Detail (`arsenal-military-academy` 48 eps)
    await mPage.goto(`${BASE_URL}/movie/arsenal-military-academy`, { waitUntil: 'networkidle' }).catch(() => {});
    await wait(1000);
    await mPage.screenshot({ path: path.join(ARTIFACT_DIR, '18_mobile_detail_series.png'), fullPage: false });
    reportData.diagnostics.mobileDetailSeries = await collectPageDiagnostics(mPage, 'mobile_detail_series_390x844');

    // Scroll down to episode grid on Mobile
    await mPage.evaluate(() => window.scrollTo(0, 650));
    await wait(500);
    await mPage.screenshot({ path: path.join(ARTIFACT_DIR, '18b_mobile_detail_episodes.png'), fullPage: false });

    // Mobile Watch Page (intercept HLS so controls render in real playing state too)
    await mPage.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('master.m3u8') || (url.includes('/proxy/stream') && !url.includes('.ts') && !url.includes('prog.m3u8')) || (url.includes('/?url=') && url.includes('master.m3u8'))) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: fs.readFileSync(path.join(hlsFixtureDir, 'master.m3u8')),
        });
      }
      if (url.includes('v1080/prog.m3u8')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: fs.readFileSync(path.join(hlsFixtureDir, 'v1080/prog.m3u8')),
        });
      }
      if (url.includes('v720/prog.m3u8')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: fs.readFileSync(path.join(hlsFixtureDir, 'v720/prog.m3u8')),
        });
      }
      const segMatch = url.match(/(v1080|v720)\/(seg_\d+\.ts)/);
      if (segMatch) {
        const segFile = path.join(hlsFixtureDir, segMatch[1], segMatch[2]);
        if (fs.existsSync(segFile)) {
          return route.fulfill({
            status: 200,
            contentType: 'video/mp2t',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: fs.readFileSync(segFile),
          });
        }
      }
      if (url.endsWith('.vtt') || url.includes('/api/subtitles/')) {
        return route.fulfill({
          status: 200,
          contentType: 'text/vtt; charset=utf-8',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: fs.readFileSync(path.join(hlsFixtureDir, 'sub_vi.vtt')),
        });
      }
      return route.continue();
    });

    await mPage.goto(`${BASE_URL}/watch/light-to-the-night/1`, { waitUntil: 'domcontentloaded' });
    await wait(2200);
    // Tap player to reveal mobile controls
    const mVideoBox = await mPage.locator('video').first().boundingBox();
    if (mVideoBox) {
      await mPage.touchscreen.tap(mVideoBox.x + mVideoBox.width / 2, mVideoBox.y + mVideoBox.height / 2);
      await wait(350);
    }
    await mPage.screenshot({ path: path.join(ARTIFACT_DIR, '19_mobile_watch_player.png'), fullPage: false });
    reportData.diagnostics.mobileWatch = await collectPageDiagnostics(mPage, 'mobile_watch_390x844');
    reportData.interactions.mobilePlayerErgonomics = await mPage.evaluate(() => {
      const v = document.querySelector('video');
      const root = v?.closest('[class*="player"], .relative, .aspect-video') || v?.parentElement;
      const vr = v ? v.getBoundingClientRect() : null;
      const btns = root
        ? Array.from(root.querySelectorAll('button')).map((b) => {
            const r = b.getBoundingClientRect();
            return {
              text: (b.innerText || '').trim().slice(0, 20),
              ariaLabel: b.getAttribute('aria-label'),
              w: Math.round(r.width),
              h: Math.round(r.height),
              x: Math.round(r.left),
              y: Math.round(r.top),
            };
          })
        : [];
      return {
        videoRect: vr ? { w: Math.round(vr.width), h: Math.round(vr.height), top: Math.round(vr.top) } : null,
        playerButtons: btns.filter((b) => b.w > 0),
      };
    });

    await mobileCtx.close();

    // =========================================================================
    // TABLET 768x1024 CHECK (Taste Skill & Design Review Phase 2)
    // =========================================================================
    const tabletCtx = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      deviceScaleFactor: 2,
      locale: 'vi-VN',
    });
    await tabletCtx.addInitScript(PERF_INIT_SCRIPT);
    const tPage = await tabletCtx.newPage();
    attachTelemetry(tPage, 'tablet', reportData.telemetry);
    await tPage.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 }).catch(() => {});
    await wait(1000);
    await tPage.screenshot({ path: path.join(ARTIFACT_DIR, '20_tablet_768x1024_home.png'), fullPage: false });
    reportData.diagnostics.tabletHome = await collectPageDiagnostics(tPage, 'tablet_home_768x1024');
    await tabletCtx.close();

    reportData.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'telemetry_summary.json'),
      JSON.stringify(reportData, null, 2)
    );
    console.log('AUDIT_RUN_OK');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (backendProc && !backendProc.killed) {
      try {
        backendProc.kill('SIGKILL');
      } catch (_) {}
    }
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('AUDIT_RUN_ERR:', err);
  process.exit(1);
});
