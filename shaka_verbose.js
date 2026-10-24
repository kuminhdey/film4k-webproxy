const puppeteer = require('puppeteer-core');

async function testVerbose() {
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
    });

    try {
        const page = await browser.newPage();
        
        // Intercept console
        page.on('console', msg => {
            const txt = msg.text();
            if (txt.includes('shaka') || txt.includes('Shaka') || txt.includes('gap') || txt.includes('stall') || txt.includes('buffer') || txt.includes('SourceBuffer') || txt.includes('append') || txt.includes('error')) {
                console.log('[SHAKA LOG]', txt);
            }
        });

        await page.evaluateOnNewDocument(() => {
            window.__enable_shaka_debug = true;
        });

        await page.goto('https://secret.dangducminh.io.vn/', { waitUntil: 'domcontentloaded' });

        await page.evaluate(async () => {
            if (window.shaka && window.shaka.log) {
                shaka.log.setLevel(shaka.log.Level.INFO);
            }
        });

        await new Promise(r => setTimeout(r, 20000));

        const detailed = await page.evaluate(() => {
            const v = document.getElementById('video');
            const p = window.playerInstance;
            return {
                currentTime: v.currentTime,
                readyState: v.readyState,
                networkState: v.networkState,
                bufferedLength: v.buffered.length,
                buffered: Array.from({length: v.buffered.length}, (_, i) => [v.buffered.start(i), v.buffered.end(i)]),
                bufferedInfo: p ? p.getBufferedInfo() : null,
                stats: p ? p.getStats() : null,
                manifest: p ? !!p.getManifest() : false
            };
        });

        console.log("DETAILED STATS:", JSON.stringify(detailed, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}

testVerbose();
