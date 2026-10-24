const puppeteer = require('puppeteer-core');

async function testFullWait() {
    console.log("Testing playback with full 60s wait for 178MB chunk download...");
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: [
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox',
            '--enable-features=PlatformHEVCDecoderSupport'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        page.on('console', msg => {
            const t = msg.text();
            if (!t.includes('Polyfill') && !t.includes('font')) {
                console.log('[BROWSER]', t);
            }
        });

        await page.goto('https://secret.dangducminh.io.vn/', { waitUntil: 'domcontentloaded' });
        
        // Wait for metadata
        await page.waitForFunction(() => {
            const v = document.getElementById('video');
            return v && v.readyState >= 1;
        }, { timeout: 30000 });

        console.log("Metadata ready. Unmuting, seeking to 0.2s, and playing...");
        await page.evaluate(() => {
            const v = document.getElementById('video');
            v.muted = true; // headless requires muted for autoplay
            v.currentTime = 0.25;
            v.play();
        });

        let played = false;
        for (let i = 1; i <= 60; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const status = await page.evaluate(() => {
                const v = document.getElementById('video');
                let bufEnd = 0;
                let bufRanges = [];
                if (v && v.buffered.length > 0) {
                    for (let j = 0; j < v.buffered.length; j++) {
                        bufRanges.push(`[${v.buffered.start(j).toFixed(1)}-${v.buffered.end(j).toFixed(1)}]`);
                    }
                    bufEnd = v.buffered.end(v.buffered.length - 1);
                }
                const p = window.playerInstance;
                const stats = p ? p.getStats() : {};
                return {
                    curTime: v.currentTime,
                    readyState: v.readyState,
                    paused: v.paused,
                    bufRanges: bufRanges.join(', '),
                    decodedFrames: stats.decodedFrames || 0
                };
            });

            if (i % 5 === 0 || status.bufRanges.length > 0) {
                console.log(`[T+${i}s] curTime: ${status.curTime.toFixed(2)}s | readyState: ${status.readyState} | buf: ${status.bufRanges || 'none'} | frames: ${status.decodedFrames}`);
            }

            if (status.curTime > 2.0 && status.decodedFrames > 10) {
                console.log(`>>> SUCCESS: Video is actively playing at ${status.curTime}s with ${status.decodedFrames} decoded frames!`);
                played = true;
                break;
            }
        }

        const screenshotPath = '/Users/kuminhdey/.gemini/antigravity-ide/brain/2187ef5f-e121-4d6b-8a3b-385bfc344be3/actual_playing_video.png';
        await page.screenshot({ path: screenshotPath });
        console.log("Screenshot saved to:", screenshotPath);

    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}

testFullWait();
