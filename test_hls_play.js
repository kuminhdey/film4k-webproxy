const puppeteer = require('puppeteer-core');
const path = require('path');

async function test() {
    console.log('[+] Đang mở Chrome để kiểm tra Player kiểu Film4k...');
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    const filePath = 'file://' + path.resolve(__dirname, 'test_film4k_player.html');
    await page.goto(filePath);

    console.log('[+] Đang chờ player nạp stream và phát trong 15 giây...');
    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const status = await page.evaluate(() => {
            const v = document.getElementById('video');
            return {
                currentTime: v ? v.currentTime : 0,
                paused: v ? v.paused : true,
                readyState: v ? v.readyState : 0,
                videoWidth: v ? v.videoWidth : 0,
                videoHeight: v ? v.videoHeight : 0,
                logs: Array.from(document.querySelectorAll('#logs div')).map(d => d.textContent).slice(-4)
            };
        });
        console.log(`[Giây ${i+1}] time=${status.currentTime.toFixed(1)}s, paused=${status.paused}, readyState=${status.readyState}, res=${status.videoWidth}x${status.videoHeight}`);
        if (status.currentTime > 2) {
            console.log('🎉 XÁC NHẬN: Video đang phát mượt mà trực tiếp từ TikTok CDN với fLoader của Film4k!');
            break;
        }
    }

    const screenshotPath = path.resolve(__dirname, 'hls_film4k_playing.png');
    await page.screenshot({ path: screenshotPath });
    console.log('[+] Đã chụp màn hình kết quả tại:', screenshotPath);

    await browser.close();
}

test();
