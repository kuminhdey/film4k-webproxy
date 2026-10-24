const puppeteer = require('puppeteer-core');

async function testPlayerDiag() {
    console.log("Launching Google Chrome for playback diagnostics...");
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: [
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox',
            '--disable-web-security',
            '--window-size=1280,800'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        page.on('console', msg => console.log('[PAGE CONSOLE]', msg.text()));
        page.on('pageerror', err => console.log('[PAGE ERROR]', err.toString()));
        page.on('requestfailed', req => console.log('[REQ FAILED]', req.url(), req.failure().errorText));
        page.on('response', res => {
            const u = res.url();
            if (u.includes('.image') || u.includes('.mp4') || u.includes('m3u8') || res.status() >= 400) {
                console.log(`[HTTP ${res.status()}] ${u.slice(0, 100)}... Length: ${res.headers()['content-length'] || 'chunked'}`);
            }
        });

        console.log("Navigating to https://secret.dangducminh.io.vn/ ...");
        await page.goto('https://secret.dangducminh.io.vn/', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Add listeners to video element
        await page.evaluate(() => {
            const v = document.getElementById('video');
            const events = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting', 'stalled', 'error', 'timeupdate'];
            events.forEach(evt => {
                v.addEventListener(evt, (e) => {
                    console.log(`>>> VIDEO EVENT: ${evt} (currentTime=${v.currentTime}, readyState=${v.readyState})`);
                });
            });

            if (window.player) {
                window.player.addEventListener('error', (e) => console.log('>>> SHAKA ERROR EVENT:', e.detail));
                window.player.addEventListener('buffering', (e) => console.log('>>> SHAKA BUFFERING EVENT: buffering =', e.buffering));
            }
        });

        // Trigger play
        console.log("Triggering Play via button click...");
        await page.click('#play-overlay-btn').catch(() => {});
        await page.evaluate(() => {
            const v = document.getElementById('video');
            v.muted = true;
            v.play().catch(e => console.log('v.play error:', e));
        });

        for (let i = 1; i <= 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const info = await page.evaluate(() => {
                const v = document.getElementById('video');
                const p = window.playerInstance || window.player;
                let b = [];
                if (v && v.buffered.length > 0) {
                    for (let j = 0; j < v.buffered.length; j++) {
                        b.push(`[${v.buffered.start(j).toFixed(2)} - ${v.buffered.end(j).toFixed(2)}]`);
                    }
                }
                const tracks = p ? p.getVariantTracks() : [];
                const activeTrack = tracks.find(t => t.active);
                return {
                    currentTime: v ? v.currentTime : 0,
                    paused: v ? v.paused : true,
                    readyState: v ? v.readyState : 0,
                    buffered: b.join(', '),
                    activeTrack: activeTrack ? `${activeTrack.width}x${activeTrack.height} @ ${activeTrack.bandwidth}bps` : 'none',
                    decodedFrames: (p && p.getStats()) ? p.getStats().decodedFrames : 0,
                    loadMode: (p && p.getLoadMode) ? p.getLoadMode() : 0
                };
            });
            console.log(`[T+${i}s] curTime: ${info.currentTime} | readyState: ${info.readyState} | paused: ${info.paused} | buf: ${info.buffered} | track: ${info.activeTrack} | frames: ${info.decodedFrames}`);
            
            if (info.currentTime > 2.0 && info.decodedFrames > 20) {
                console.log(">>> SUCCESS: Video is actively decoding and progressing!");
                break;
            }
        }

        const screenshotPath = '/Users/kuminhdey/.gemini/antigravity-ide/brain/2187ef5f-e121-4d6b-8a3b-385bfc344be3/actual_playing_video.png';
        await page.screenshot({ path: screenshotPath });
        console.log("Screenshot saved.");

    } catch (e) {
        console.error("Diagnostic error:", e);
    } finally {
        await browser.close();
    }
}

testPlayerDiag();
