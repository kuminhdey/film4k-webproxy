const puppeteer = require('puppeteer-core');

async function run() {
    console.log('Testing Vietnam VPS player with local Google Chrome...');
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
        page.on('response', res => {
            const u = res.url();
            if (u.includes('m3u8') || u.includes('.image') || u.includes('.mp4')) {
                console.log(`[HTTP ${res.status()}] ${u.slice(0, 80)}... Length: ${res.headers()['content-length'] || 'chunked'}`);
            }
        });

        console.log('Navigating to http://167.254.69.251/ ...');
        await page.goto('http://167.254.69.251/', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Trigger Play
        await page.waitForSelector('#play-overlay-btn', { timeout: 10000 }).catch(() => {});
        console.log('Clicking play button...');
        await page.click('#play-overlay-btn').catch(() => {});

        await page.evaluate(() => {
            const v = document.getElementById('video');
            if (v) {
                v.muted = true;
                v.play().catch(e => console.log('play error:', e));
            }
        });

        for (let i = 1; i <= 35; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const state = await page.evaluate(() => {
                const v = document.getElementById('video');
                if (!v) return null;
                let bufEnd = 0;
                if (v.buffered.length > 0) bufEnd = v.buffered.end(v.buffered.length - 1);
                return {
                    currentTime: v.currentTime.toFixed(2),
                    paused: v.paused,
                    readyState: v.readyState,
                    bufferedEnd: bufEnd.toFixed(2)
                };
            });
            if (i % 5 === 0 || (state && parseFloat(state.currentTime) > 0)) {
                console.log(`Second ${i} -> State:`, state);
            }
        }

        const screenshotPath = '/Users/kuminhdey/.gemini/antigravity-ide/brain/2187ef5f-e121-4d6b-8a3b-385bfc344be3/vn_vps_actual_playing.png';
        await page.screenshot({ path: screenshotPath });
        console.log('Screenshot successfully saved to:', screenshotPath);
    } finally {
        await browser.close();
    }
}

run().catch(console.error);
