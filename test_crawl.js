const puppeteer = require('puppeteer-core');

async function testCrawl(url) {
    console.log(`[+] Đang khởi động Chrome để kiểm tra URL: ${url}`);
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    const capturedStreams = [];
    const capturedIframes = [];

    page.on('request', req => {
        const reqUrl = req.url();
        const type = req.resourceType();

        if (reqUrl.includes('.m3u8') || reqUrl.includes('.mp4') || reqUrl.includes('/stream') || reqUrl.includes('playlist')) {
            console.log(`[🎯 STREAM PHÁT HIỆN]: [${type}] ${reqUrl}`);
            capturedStreams.push({ type, url: reqUrl, headers: req.headers() });
        } else if (reqUrl.includes('/play.php') || reqUrl.includes('player') || reqUrl.includes('embed')) {
            if (type === 'document' || type === 'sub_frame' || type === 'xhr' || type === 'fetch') {
                console.log(`[📺 PLAYER/IFRAME]: [${type}] ${reqUrl}`);
                capturedIframes.push({ type, url: reqUrl });
            }
        }
    });

    page.on('response', async res => {
        const resUrl = res.url();
        if (resUrl.includes('.m3u8')) {
            try {
                const text = await res.text();
                console.log(`[📄 NỘI DUNG M3U8 (100 ký tự đầu)]:\n${text.substring(0, 150)}...\n`);
            } catch (e) {}
        }
    });

    try {
        console.log('[+] Đang điều hướng đến trang...');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log('[+] Đã tải DOM. Đang chờ player render và gọi stream (10 giây)...');
        
        await new Promise(r => setTimeout(r, 10000));

        // Kiểm tra xem trong trang có thẻ iframe hay video nào không
        const frameSrcs = await page.evaluate(() => {
            const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
            const videos = Array.from(document.querySelectorAll('video')).map(v => v.src);
            return { iframes, videos };
        });

        console.log('\n===== KẾT QUẢ PHÂN TÍCH =====');
        console.log('Các iframe trên trang:', frameSrcs.iframes);
        console.log('Các thẻ video trên trang:', frameSrcs.videos);
        console.log('Danh sách Stream bắt được:', capturedStreams);
        console.log('Danh sách Player/Iframe bắt được:', capturedIframes);

    } catch (err) {
        console.error('[-] Lỗi:', err.message);
    } finally {
        await browser.close();
        console.log('[+] Đã đóng trình duyệt.');
    }
}

const target = process.argv[2] || 'https://motchillkc.net/phim/dau-tay-ngot-ngao/tap-1-vietsub-4821';
testCrawl(target);
