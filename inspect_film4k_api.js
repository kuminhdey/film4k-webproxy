const puppeteer = require('puppeteer-core');

async function inspectFilm4kApi() {
    console.log('[+] Đang khởi động Chrome để bắt các API của Film4k...');
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: [
            '--proxy-server=socks5://127.0.0.1:10800',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    const apiCalls = [];

    page.on('request', req => {
        const url = req.url();
        const type = req.resourceType();
        if (type === 'xhr' || type === 'fetch' || url.includes('/api/')) {
            console.log(`[API REQUEST]: [${type}] ${req.method()} ${url}`);
            apiCalls.push({ url, method: req.method(), type, postData: req.postData() });
        }
    });

    page.on('response', async res => {
        const url = res.url();
        if (url.includes('/api/') || res.request().resourceType() === 'xhr' || res.request().resourceType() === 'fetch') {
            try {
                const text = await res.text();
                if (text.startsWith('{') || text.startsWith('[')) {
                    console.log(`[API RESPONSE JSON]: ${url.substring(0, 80)}...`);
                    console.log(`Payload preview: ${text.substring(0, 200)}\n`);
                }
            } catch (e) {}
        }
    });

    try {
        console.log('[+] Đang mở trang: https://fiml4k.fun/watch/empresses-in-the-palace ...');
        await page.goto('https://fiml4k.fun/watch/empresses-in-the-palace', { waitUntil: 'networkidle2', timeout: 30000 });
        console.log('[+] Đã load xong. Đang tìm nút Enter Film4k...');
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Enter Film4k') || b.innerText.includes('Skip'));
            if (btn) btn.click();
        });
        console.log('[+] Đã click Enter. Chờ 3s để SPA chuyển sang trang phim...');
        await new Promise(r => setTimeout(r, 3000));

        const pageInfoAfter = await page.evaluate(() => {
            return {
                url: window.location.href,
                title: document.title,
                h1: document.querySelector('h1')?.innerText,
                bodyText: document.body.innerText.substring(0, 1000),
                buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean),
                allLinks: Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h.includes('movie') || h.includes('watch') || h.includes('genres'))
            };
        });
        console.log('\n===== THÔNG TIN SAU KHI CLICK ENTER =====');
        console.log(JSON.stringify(pageInfoAfter, null, 2));

        await page.screenshot({ path: 'film4k_after_enter.png' });
        console.log('[+] Đã chụp màn hình film4k_after_enter.png');
    } catch (err) {
        console.error('Lỗi truy cập:', err.message);
    } finally {
        await browser.close();
    }
}

inspectFilm4kApi();
