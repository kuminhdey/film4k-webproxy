const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const servers = [
    { name: 'Server 1', url: 'https://motchillkc.net/phim/chuyen-tinh-rung-cam/tap-1-vietsub-4824' },
    { name: 'Server 2', url: 'https://motchillkc.net/phim/chuyen-tinh-rung-cam/tap-1-vietsub-vn2-4824' },
    { name: 'Server 3', url: 'https://motchillkc.net/phim/chuyen-tinh-rung-cam/tap-1-vietsub-vn2-sv3-4824' }
];

async function crawlServer(browser, serverInfo) {
    console.log(`\n==================================================`);
    console.log(`[+] Đang kiểm tra: ${serverInfo.name} -> ${serverInfo.url}`);
    console.log(`==================================================`);

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    const streams = [];
    const iframes = [];

    page.on('request', req => {
        const reqUrl = req.url();
        const type = req.resourceType();

        if (reqUrl.includes('.m3u8') || reqUrl.includes('.mp4') || reqUrl.includes('/stream') || reqUrl.includes('playlist')) {
            streams.push({ type, url: reqUrl, headers: req.headers() });
        } else if (reqUrl.includes('/play.php') || reqUrl.includes('/embed') || reqUrl.includes('/player/')) {
            if (type === 'document' || type === 'sub_frame' || type === 'xhr' || type === 'fetch') {
                iframes.push({ type, url: reqUrl });
            }
        }
    });

    try {
        await page.goto(serverInfo.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(`[+] Trang đã tải. Chờ player khởi tạo (8s)...`);
        await new Promise(r => setTimeout(r, 8000));

        // Kiểm tra xem player có render iframe hay video tag không
        const domElements = await page.evaluate(() => {
            const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
            const videos = Array.from(document.querySelectorAll('video')).map(v => v.src);
            return { iframes, videos };
        });

        console.log(`[i] Iframe trong DOM:`, domElements.iframes);

        if (streams.length > 0) {
            console.log(`[🎯 STREAM TÌM THẤY (${streams.length})]:`);
            for (let s of streams) {
                console.log(`   - Loai: ${s.type}`);
                console.log(`   - URL: ${s.url}`);
                console.log(`   - Referer yeu cau: ${s.headers.referer || 'Khong co'}`);

                // Kiểm tra trực tiếp bằng curl
                try {
                    const curlCmd = `curl -sI "${s.url}" -H "Referer: ${s.headers.referer || 'https://vn2data.com/'}" | head -n 5`;
                    const res = execSync(curlCmd).toString().trim();
                    console.log(`   - Kiem tra HTTP:\n${res.split('\n').map(l => '     ' + l).join('\n')}`);
                } catch (e) {
                    console.log(`   - Loi khi curl test: ${e.message}`);
                }
            }
        } else {
            console.log(`[!] Chưa thấy link stream trực tiếp từ network.`);
            console.log(`    Các iframe bắt được:`, iframes.map(i => i.url));
        }

        return { server: serverInfo.name, streams, iframes, domIframes: domElements.iframes };
    } catch (err) {
        console.error(`[-] Lỗi ở ${serverInfo.name}:`, err.message);
        return { server: serverInfo.name, error: err.message };
    } finally {
        await page.close();
    }
}

async function run() {
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

    const results = [];
    for (let s of servers) {
        const res = await crawlServer(browser, s);
        results.push(res);
    }

    await browser.close();
    console.log('\n\n================ TỔNG HỢP KẾT QUẢ 3 SERVER ================');
    console.log(JSON.stringify(results, null, 2));
}

run();
