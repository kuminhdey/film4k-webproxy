const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

async function crawlFilm4k(targetUrl) {
    console.log(`[+] Đang khởi động Chrome trực tiếp (không qua proxy)...`);
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
    await page.setViewport({ width: 1366, height: 768 });

    const streams = [];
    const iframes = [];
    const ads = [];

    page.on('request', req => {
        const url = req.url();
        const type = req.resourceType();

        if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('/stream') || url.includes('master') || url.includes('playlist')) {
            // Lọc bớt quảng cáo nếu rõ ràng là ad domain
            if (url.includes('xbet') || url.includes('bet') || url.includes('casino')) {
                ads.push(url);
            } else {
                console.log(`[🎯 STREAM REQUEST]: [${type}] ${url}`);
                streams.push({ type, url, headers: req.headers() });
            }
        } else if (type === 'document' || type === 'sub_frame') {
            if (!url.includes('google') && !url.includes('doubleclick') && !url.includes('analytics')) {
                console.log(`[📺 FRAME/IFRAME]: ${url}`);
                iframes.push(url);
            }
        }
    });

    try {
        console.log(`[+] Đang truy cập trực tiếp: ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log('[+] Đã tải DOM. Đang chờ player render và kích hoạt luồng (10 giây)...');
        
        await new Promise(r => setTimeout(r, 10000));

        // Kiểm tra xem có nút play nào chưa click không
        const playClicked = await page.evaluate(() => {
            const playButtons = Array.from(document.querySelectorAll('button, .play, .btn-play, #play, .play-btn, .jw-display-icon-container, svg'));
            for (let b of playButtons) {
                if (b.innerText && b.innerText.toLowerCase().includes('play') || b.className.toString().includes('play')) {
                    b.click();
                    return true;
                }
            }
            return false;
        });

        if (playClicked) {
            console.log('[+] Đã click nút Play trong player, chờ thêm 5 giây...');
            await new Promise(r => setTimeout(r, 5000));
        }

        const domInfo = await page.evaluate(() => {
            const title = document.title;
            const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
            const videos = Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc);
            const serverButtons = Array.from(document.querySelectorAll('.server, .servers, .btn-server, [data-server], .episode, .episodes, .nav-tabs li a')).map(el => el.innerText.trim());
            return { title, iframes, videos, serverButtons };
        });

        console.log('\n===== THÔNG TIN TRANG =====');
        console.log('Tiêu đề:', domInfo.title);
        console.log('Các thẻ Iframe trên trang:', domInfo.iframes);
        console.log('Các thẻ Video trên trang:', domInfo.videos);
        console.log('Các nút Server/Tập:', domInfo.serverButtons.slice(0, 10));

        console.log('\n===== CÁC LINK STREAM TÌM ĐƯỢC =====');
        if (streams.length === 0) {
            console.log('[!] Chưa tìm thấy link stream phim chính thức.');
        } else {
            for (let s of streams) {
                console.log(`- Loai: ${s.type}`);
                console.log(`  URL: ${s.url}`);
                console.log(`  Referer: ${s.headers.referer || 'None'}`);

                try {
                    const testCmd = `curl -sI "${s.url}" -H "Referer: ${s.headers.referer || targetUrl}" | head -n 5`;
                    const res = execSync(testCmd).toString().trim();
                    console.log(`  Header phản hồi:\n${res.split('\n').map(l => '    ' + l).join('\n')}`);
                } catch (e) {}
            }
        }

        if (ads.length > 0) {
            console.log('\n(Bỏ qua video quảng cáo:', ads.length, 'link)');
        }

    } catch (err) {
        console.error('[-] Lỗi:', err.message);
    } finally {
        await browser.close();
        console.log('\n[+] Đã đóng trình duyệt.');
    }
}

const target = process.argv[2] || 'https://film4k.net/watch/mission-impossible-ii';
crawlFilm4k(target);
