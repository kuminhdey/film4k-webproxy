// /Users/kuminhdey/Downloads/webproxy/docs/audit_artifacts/web_player/run_player_deep_verify.cjs
// Supplementary Playwright E2E Verification: Player Menus, Quality/Sub/Speed Switch, Seek Tooltip, Error State & Catalog Sort/Filter Bugs

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const playwright = require('/Users/kuminhdey/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const REPO_ROOT = '/Users/kuminhdey/Downloads/webproxy';
const ARTIFACT_DIR = path.join(REPO_ROOT, 'docs/audit_artifacts/web_player');
const TMP_DIR = '/tmp/pw_web_player_deep_' + process.pid;
const BACKEND_PORT = 18082;
const BASE_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, { timeout: 1200 }, (res) => {
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

function generateRichHlsFixture(hlsDir) {
  fs.mkdirSync(path.join(hlsDir, 'v1080'), { recursive: true });
  fs.mkdirSync(path.join(hlsDir, 'v720'), { recursive: true });
  fs.mkdirSync(path.join(hlsDir, 'subs'), { recursive: true });

  execSync(
    `ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=24 -f lavfi -i sine=frequency=440:sample_rate=44100 ` +
      `-t 12 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 24 -sc_threshold 0 -c:a aac -b:a 96k ` +
      `-f hls -hls_time 2 -hls_playlist_type vod -hls_segment_filename "${path.join(hlsDir, 'v1080/seg_%03d.ts')}" "${path.join(hlsDir, 'v1080/prog.m3u8')}"`,
    { stdio: 'ignore' }
  );
  execSync(
    `ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=24 -f lavfi -i sine=frequency=660:sample_rate=44100 ` +
      `-t 12 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 24 -sc_threshold 0 -c:a aac -b:a 64k ` +
      `-f hls -hls_time 2 -hls_playlist_type vod -hls_segment_filename "${path.join(hlsDir, 'v720/seg_%03d.ts')}" "${path.join(hlsDir, 'v720/prog.m3u8')}"`,
    { stdio: 'ignore' }
  );

  const subViM3u8 = [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:12',
    '#EXT-X-VERSION:3',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXTINF:12.000,',
    'sub_vi.vtt',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(hlsDir, 'subs/vi.m3u8'), subViM3u8);
  fs.writeFileSync(
    path.join(hlsDir, 'subs/sub_vi.vtt'),
    'WEBVTT\n\n00:00:00.000 --> 00:00:12.000\nPhụ đề Tiếng Việt đang hiển thị trực tiếp!\n'
  );

  const masterM3u8 = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Tiếng Việt",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="vi",URI="subs/vi.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080,SUBTITLES="subs"',
    'v1080/prog.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,SUBTITLES="subs"',
    'v720/prog.m3u8',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(hlsDir, 'master.m3u8'), masterM3u8);
}

async function main() {
  let backendProc = null;
  let browser = null;
  const results = {};

  try {
    const tempDbPath = path.join(TMP_DIR, 'movies.db');
    fs.copyFileSync(path.join(REPO_ROOT, 'movies.db'), tempDbPath);
    fs.symlinkSync(path.join(REPO_ROOT, 'frontend'), path.join(TMP_DIR, 'frontend'));

    const hlsDir = path.join(TMP_DIR, 'hls');
    generateRichHlsFixture(hlsDir);

    backendProc = spawn(path.join(REPO_ROOT, 'target/debug/webproxy_backend'), [], {
      cwd: TMP_DIR,
      env: {
        ...process.env,
        PORT: String(BACKEND_PORT),
        DATABASE_PATH: tempDbPath,
        STATIC_DIR: path.join(REPO_ROOT, 'frontend/dist'),
        ADMIN_PASSWORD: 'StrongAuditSecret2026!',
        RUST_LOG: 'warn',
      },
      stdio: 'ignore',
    });

    if (!(await waitForHealth(`${BASE_URL}/api/health`))) {
      throw new Error('Backend failed healthcheck');
    }

    browser = await playwright.chromium.launch({
      headless: true,
      executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
    });

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN' });
    const page = await ctx.newPage();

    // 1. Verify Catalog Sort ("name_asc" vs default) & "/danh-sach/tv-shows"
    await page.goto(`${BASE_URL}/danh-sach/phim-le`, { waitUntil: 'networkidle' });
    await wait(600);
    const titlesDefault = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h3')).map((h) => h.innerText.trim())
    );
    const sortSelect = page.locator('select[aria-label="Sắp xếp kết quả"]');
    await sortSelect.selectOption('name_asc');
    await wait(600);
    const titlesNameAsc = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h3')).map((h) => h.innerText.trim())
    );
    results.catalogSortCheck = {
      titlesDefault,
      titlesNameAsc,
      identicalOrderWhenSortedByNameAsc: JSON.stringify(titlesDefault) === JSON.stringify(titlesNameAsc),
    };

    // Check /danh-sach/tv-shows vs /danh-sach/phim-moi
    await page.goto(`${BASE_URL}/danh-sach/tv-shows`, { waitUntil: 'networkidle' });
    await wait(600);
    results.tvShowsCategoryCount = await page.evaluate(() => document.querySelectorAll('h3').length);

    // Check Hero Watch CTA on Single Movie (`Phim Street Fighter` -> `/xem-phim/street-fighter/tap-1`)
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await wait(500);
    const heroH1 = await page.locator('h1').first().innerText();
    await page.locator('button:has-text("Xem Phim Ngay")').first().click();
    await wait(800);
    results.heroWatchCtaRoute = {
      heroH1,
      landedUrl: page.url(),
    };

    // 2. Verify Upstream 403 Exhausted Error State on WatchPage (`spider-man-brand-new-day` after 2x 2000ms retries = ~5.5s)
    await page.goto(`${BASE_URL}/watch/spider-man-brand-new-day`, { waitUntil: 'domcontentloaded' });
    await wait(6500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '25_desktop_player_error_state.png'), fullPage: false });
    results.errorStateAfterRetries = await page.evaluate(() => ({
      alertText: document.querySelector('[role="alert"]')?.innerText || null,
      hasServerSwitcherOnPage: document.body.innerText.includes('Chọn Server'),
    }));

    // 3. Deep Video Player Controls Verification with Multi-Variant HLS + Subtitles
    const pPage = await ctx.newPage();
    await pPage.route('**/*', async (route) => {
      const u = route.request().url();
      if (u.includes('master.m3u8')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          body: fs.readFileSync(path.join(hlsDir, 'master.m3u8')),
        });
      }
      if (u.includes('subs/vi.m3u8')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          body: fs.readFileSync(path.join(hlsDir, 'subs/vi.m3u8')),
        });
      }
      if (u.includes('sub_vi.vtt')) {
        return route.fulfill({
          status: 200,
          contentType: 'text/vtt; charset=utf-8',
          body: fs.readFileSync(path.join(hlsDir, 'subs/sub_vi.vtt')),
        });
      }
      if (u.includes('v1080/prog.m3u8')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          body: fs.readFileSync(path.join(hlsDir, 'v1080/prog.m3u8')),
        });
      }
      if (u.includes('v720/prog.m3u8')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          body: fs.readFileSync(path.join(hlsDir, 'v720/prog.m3u8')),
        });
      }
      const m = u.match(/(v1080|v720)\/(seg_\d+\.ts)/);
      if (m) {
        return route.fulfill({
          status: 200,
          contentType: 'video/mp2t',
          body: fs.readFileSync(path.join(hlsDir, m[1], m[2])),
        });
      }
      return route.continue();
    });

    await pPage.goto(`${BASE_URL}/watch/light-to-the-night/1`, { waitUntil: 'domcontentloaded' });
    await wait(2200);

    // Ensure video plays & pause so we can test precise seekbar scrubbing + hover tooltip
    await pPage.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.muted = false;
        v.pause();
      }
    });
    await wait(300);

    // Hover & Click real seekbar (`div.group\/bar`) at 60% width (~7.2s of 12s)
    const seekbarBox = await pPage.locator('.group\\/bar').first().boundingBox();
    if (seekbarBox) {
      const targetX = seekbarBox.x + seekbarBox.width * 0.6;
      const targetY = seekbarBox.y + seekbarBox.height / 2;
      await pPage.mouse.move(targetX, targetY);
      await wait(250);
      await pPage.mouse.click(targetX, targetY);
      await wait(350);
      await pPage.mouse.move(seekbarBox.x + seekbarBox.width * 0.75, targetY);
      await wait(250);
      await pPage.screenshot({ path: path.join(ARTIFACT_DIR, '21_desktop_player_seek_and_tooltip.png'), fullPage: false });
      results.realSeekbarTest = await pPage.evaluate(() => {
        const v = document.querySelector('video');
        const timeEl = Array.from(document.querySelectorAll('div')).find(
          (d) => d.className.includes('xs:block') && d.innerText === ''
        );
        return {
          currentTimeAfterSeek: v?.currentTime,
          duration: v?.duration,
          timestampDisplayComputed: getComputedStyle(
            document.querySelector('div.hidden.xs\\:block') || document.body
          ).display,
        };
      });
    }

    // Test Mute button (`button[title*="tiếng"]`) & Volume Slider (`input[title*="Âm lượng"]`)
    const muteBtn = pPage.locator('button[title*="tiếng"]').first();
    await muteBtn.click();
    await wait(150);
    const mutedAfterClick = await pPage.evaluate(() => document.querySelector('video')?.muted);
    await muteBtn.click();
    await wait(150);
    const volSlider = pPage.locator('input[title*="Âm lượng"]').first();
    const volBox = await volSlider.boundingBox();
    if (volBox) {
      await pPage.mouse.click(volBox.x + volBox.width * 0.35, volBox.y + volBox.height / 2);
      await wait(150);
    }
    const volAfterSlider = await pPage.evaluate(() => document.querySelector('video')?.volume);
    results.volumeAndMuteTest = { mutedAfterClick, volAfterSlider };

    // Open Settings Menu (`button[title*="Cài đặt"]`) -> inspect Quality (1080p HD / 720p), Subtitles, Speed
    const settingsBtn = pPage.locator('button[title*="Cài đặt"]').first();
    await settingsBtn.click();
    await wait(350);
    await pPage.screenshot({ path: path.join(ARTIFACT_DIR, '22_desktop_player_settings_menu.png'), fullPage: false });

    results.settingsMenuContents = await pPage.evaluate(() => {
      const menu = document.querySelector('[class*="min-w-[240px]"]');
      return menu ? menu.innerText : null;
    });

    // Click 720p quality & 1.5x speed inside Settings Menu
    const q720 = pPage.locator('button').filter({ hasText: /720p/i }).first();
    if ((await q720.count()) > 0) {
      await q720.click();
      await wait(250);
    }
    // Re-open if closed or click 1.5x
    if (!(await pPage.locator('button:has-text("1.5x")').isVisible())) {
      await settingsBtn.click();
      await wait(250);
    }
    const spd15 = pPage.locator('button:has-text("1.5x")').first();
    if ((await spd15.count()) > 0) {
      await spd15.click();
      await wait(250);
    }
    results.afterQualityAndSpeedSwitch = await pPage.evaluate(() => {
      const v = document.querySelector('video');
      return {
        playbackRate: v?.playbackRate,
        savedQuality: localStorage.getItem('bofilm_player_quality'),
        savedSpeed: localStorage.getItem('bofilm_player_speed'),
      };
    });

    // Open Episode Drawer (`button[title="Danh sách tập"]`)
    const epDrawerBtn = pPage.locator('button[title="Danh sách tập"]').first();
    await epDrawerBtn.click();
    await wait(350);
    await pPage.screenshot({ path: path.join(ARTIFACT_DIR, '23_desktop_player_episode_drawer.png'), fullPage: false });
    // Close drawer
    await pPage.locator('button[title="Đóng (Esc)"]').first().click().catch(() => {});
    await wait(200);

    // Toggle Stats for Nerds + Stream Health + Keyboard Shortcuts Modal
    await pPage.locator('button[title*="Stats for Nerds"]').first().click();
    await pPage.locator('button[title*="Stream Health"]').first().click();
    await wait(300);
    await pPage.screenshot({ path: path.join(ARTIFACT_DIR, '24a_desktop_player_stats_health.png'), fullPage: false });

    await pPage.locator('button[title*="Phím tắt trình phát"]').first().click();
    await wait(300);
    await pPage.screenshot({ path: path.join(ARTIFACT_DIR, '24b_desktop_player_shortcuts_modal.png'), fullPage: false });

    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'telemetry_player_deep.json'),
      JSON.stringify(results, null, 2)
    );
    console.log('DEEP_VERIFY_OK');
  } finally {
    if (browser) await browser.close().catch(() => {});
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

main().catch((e) => {
  console.error('DEEP_VERIFY_ERR:', e);
  process.exit(1);
});
