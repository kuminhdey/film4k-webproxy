const puppeteer = require('puppeteer-core');

async function debugShaka() {
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
    });

    try {
        const page = await browser.newPage();
        page.on('console', msg => console.log('[BROWSER]', msg.text()));

        await page.goto('https://secret.dangducminh.io.vn/', { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 15000));

        const info = await page.evaluate(() => {
            const p = window.playerInstance || window.player;
            const v = document.getElementById('video');
            return {
                videoReadyState: v.readyState,
                videoCurrentTime: v.currentTime,
                videoPaused: v.paused,
                videoError: v.error ? { code: v.error.code, message: v.error.message } : null,
                bufferedRanges: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]),
                shakaBufferedInfo: p ? p.getBufferedInfo() : null,
                shakaTracks: p ? p.getTracks() : null,
                shakaVariantTracks: p ? p.getVariantTracks() : null,
                shakaStats: p ? p.getStats() : null
            };
        });

        console.log("SHAKA DEBUG INFO:", JSON.stringify(info, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}

debugShaka();
