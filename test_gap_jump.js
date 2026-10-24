const puppeteer = require('puppeteer-core');

async function testGapJump() {
    console.log("Testing gap jump in Chrome...");
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

        page.on('console', msg => console.log('[PAGE]', msg.text()));

        await page.goto('https://secret.dangducminh.io.vn/', { waitUntil: 'domcontentloaded' });
        
        // Wait for player to load metadata
        await page.waitForFunction(() => {
            const v = document.getElementById('video');
            return v && v.readyState >= 1;
        }, { timeout: 20000 });

        console.log("Metadata loaded! Setting currentTime = 0.2 to jump the 0.125s gap...");
        await page.evaluate(() => {
            const v = document.getElementById('video');
            v.muted = true;
            v.currentTime = 0.25;
            v.play().catch(e => console.log('play error:', e));
        });

        for (let i = 1; i <= 20; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const status = await page.evaluate(() => {
                const v = document.getElementById('video');
                let bufEnd = 0;
                if (v && v.buffered.length > 0) {
                    bufEnd = v.buffered.end(v.buffered.length - 1);
                }
                return {
                    currentTime: v.currentTime,
                    paused: v.paused,
                    readyState: v.readyState,
                    bufferedEnd: bufEnd
                };
            });
            console.log(`[T+${i}s] curTime: ${status.currentTime.toFixed(2)}s | readyState: ${status.readyState} | paused: ${status.paused} | bufEnd: ${status.bufferedEnd.toFixed(2)}s`);
            
            if (status.currentTime > 1.0) {
                console.log(">>> SUCCESS! Video is playing forward!");
                break;
            }
        }

        const screenshotPath = '/Users/kuminhdey/.gemini/antigravity-ide/brain/2187ef5f-e121-4d6b-8a3b-385bfc344be3/actual_playing_video.png';
        await page.screenshot({ path: screenshotPath });
        console.log("Screenshot saved!");

    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}

testGapJump();
