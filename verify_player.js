const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    console.log('Navigating to https://secret.dangducminh.io.vn/ ...');
    await page.goto('https://secret.dangducminh.io.vn/', { waitUntil: 'networkidle2', timeout: 30000 });

    await new Promise(r => setTimeout(r, 4000));

    const title = await page.title();
    console.log('Page Title:', title);

    const logBoxText = await page.evaluate(() => document.getElementById('log-box')?.innerText);
    console.log('Player Logs:\n', logBoxText);

    const videoState = await page.evaluate(() => {
        const v = document.getElementById('video');
        return {
            paused: v?.paused,
            readyState: v?.readyState,
            currentTime: v?.currentTime,
            duration: v?.duration,
            videoWidth: v?.videoWidth,
            videoHeight: v?.videoHeight
        };
    });
    console.log('Video State:', videoState);

    await browser.close();
})();
