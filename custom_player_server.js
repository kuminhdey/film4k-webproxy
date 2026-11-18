// custom_player_server.js
const http = require('http');
const https = require('https');
const fs = require('fs');
const dns = require('dns');
const net = require('net');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3333;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://127.0.0.1:3000';
const PLAYER_SERVER_TOKEN = (process.env.PLAYER_SERVER_TOKEN || '').trim();
const STREAM_HMAC_SECRET = process.env.STREAM_HMAC_SECRET || crypto.randomBytes(32).toString('hex');
const CHROME_EXECUTABLE_PATH =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MAX_RESOLVE_BODY_BYTES = 4096;
const MAX_CONCURRENT_BROWSERS = 2;
const MAX_BROWSER_WAIT_QUEUE = 8;
const MAX_STREAM_CACHE_ENTRIES = 200;

const DEFAULT_ALLOWED_HOSTS = [
    'streamc.xyz',
    'amass11.top',
    'fiml4k.fun',
    'film4k.net',
    'tiktokcdn.com',
    'akamaicdn.net',
    'byteoversea.com',
    'ibytedtos.com',
    'ibyteimg.com',
    'tmdb.org'
];

function buildAllowedHostList() {
    const extra = (process.env.ALLOWED_STREAM_HOSTS || '')
        .split(',')
        .map(h => h.trim().toLowerCase().replace(/\.$/, ''))
        .filter(Boolean);
    return Array.from(new Set([...DEFAULT_ALLOWED_HOSTS, ...extra]));
}

const OUTBOUND_BLOCKLIST = new net.BlockList();
OUTBOUND_BLOCKLIST.addSubnet('0.0.0.0', 8, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('100.64.0.0', 10, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('192.0.0.0', 24, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('192.0.2.0', 24, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('198.18.0.0', 15, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('198.51.100.0', 24, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('203.0.113.0', 24, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('224.0.0.0', 4, 'ipv4');
OUTBOUND_BLOCKLIST.addSubnet('240.0.0.0', 4, 'ipv4');
OUTBOUND_BLOCKLIST.addAddress('::', 'ipv6');
OUTBOUND_BLOCKLIST.addAddress('::1', 'ipv6');
OUTBOUND_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6');
OUTBOUND_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6');
OUTBOUND_BLOCKLIST.addSubnet('ff00::', 8, 'ipv6');
OUTBOUND_BLOCKLIST.addSubnet('2001:db8::', 32, 'ipv6');

function isDisallowedAddress(rawAddress) {
    if (typeof rawAddress !== 'string' || !rawAddress.trim()) {
        return true;
    }
    const clean = rawAddress.trim().replace(/^\[|\]$/g, '').split('%')[0];
    const family = net.isIP(clean);
    if (family === 4) {
        return OUTBOUND_BLOCKLIST.check(clean, 'ipv4');
    }
    if (family === 6) {
        return OUTBOUND_BLOCKLIST.check(clean, 'ipv6');
    }
    return true;
}

function isAllowedHostname(rawHost) {
    if (typeof rawHost !== 'string' || !rawHost.trim()) {
        return false;
    }
    const normalized = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!normalized || net.isIP(normalized) !== 0) {
        return false;
    }
    const allowedHosts = buildAllowedHostList();
    return allowedHosts.some(domain => normalized === domain || normalized.endsWith(`.${domain}`));
}

async function validateOutboundUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_err) {
        const err = new Error('Malformed target URL');
        err.statusCode = 400;
        throw err;
    }

    if (parsed.protocol !== 'https:') {
        const err = new Error('Target URL must use https: protocol');
        err.statusCode = 400;
        throw err;
    }

    if (parsed.username || parsed.password) {
        const err = new Error('Target URL must not contain credentials');
        err.statusCode = 400;
        throw err;
    }

    if (parsed.port && parsed.port !== '443') {
        const err = new Error('Target URL must use standard HTTPS port');
        err.statusCode = 400;
        throw err;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!isAllowedHostname(hostname)) {
        const err = new Error(`Hostname is not in the outbound allowlist: ${hostname}`);
        err.statusCode = 403;
        throw err;
    }

    let records;
    try {
        records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    } catch (_dnsErr) {
        const err = new Error(`Failed to resolve outbound hostname: ${hostname}`);
        err.statusCode = 502;
        throw err;
    }

    if (!Array.isArray(records) || records.length === 0) {
        const err = new Error(`No DNS records found for hostname: ${hostname}`);
        err.statusCode = 502;
        throw err;
    }

    for (const record of records) {
        if (isDisallowedAddress(record.address)) {
            const err = new Error('Outbound target resolved to a disallowed private or local address');
            err.statusCode = 403;
            throw err;
        }
    }

    return {
        parsed,
        resolvedAddress: records[0].address,
        resolvedFamily: records[0].family
    };
}

// Bounded in-memory cache for decrypted playlists (max 200 entries, evict oldest)
const streamCache = new Map();

function setStreamCacheEntry(hash, entry) {
    if (streamCache.has(hash)) {
        streamCache.delete(hash);
    }
    while (streamCache.size >= MAX_STREAM_CACHE_ENTRIES) {
        const oldestKey = streamCache.keys().next().value;
        if (oldestKey === undefined) break;
        streamCache.delete(oldestKey);
    }
    streamCache.set(hash, entry);
}

function getStreamCacheEntry(hash) {
    const entry = streamCache.get(hash);
    if (!entry) return null;
    streamCache.delete(hash);
    streamCache.set(hash, entry);
    return entry;
}

if (fs.existsSync('/tmp/decrypted_stream.m3u8')) {
    const raw = fs.readFileSync('/tmp/decrypted_stream.m3u8', 'utf-8');
    setStreamCacheEntry('816653d70e483b4f1cfe8eaf9dfe6d05', {
        m3u8: raw,
        segmentCount: raw.split('\n').filter(l => l.startsWith('https://')).length,
        embedOrigin: 'https://embed11.streamc.xyz',
        embedUrl: 'https://embed11.streamc.xyz/embed.php?hash=816653d70e483b4f1cfe8eaf9dfe6d05',
        videoHash: '816653d70e483b4f1cfe8eaf9dfe6d05'
    });
}

// Bounded concurrency limiter for Puppeteer browser sessions (max 2 active)
let activeBrowserSessions = 0;
const browserWaitQueue = [];
const inflightResolves = new Map();

function acquireBrowserSlot() {
    if (activeBrowserSessions < MAX_CONCURRENT_BROWSERS) {
        activeBrowserSessions += 1;
        return Promise.resolve();
    }
    if (browserWaitQueue.length >= MAX_BROWSER_WAIT_QUEUE) {
        const err = new Error('Resolver capacity busy; retry shortly');
        err.statusCode = 429;
        return Promise.reject(err);
    }
    return new Promise(resolve => {
        browserWaitQueue.push(resolve);
    });
}

function releaseBrowserSlot() {
    const next = browserWaitQueue.shift();
    if (next) {
        next();
    } else {
        activeBrowserSessions = Math.max(0, activeBrowserSessions - 1);
    }
}

async function resolveStreamFromEmbed(embedUrl) {
    const { parsed } = await validateOutboundUrl(embedUrl);
    const videoHash = (parsed.searchParams.get('hash') || '').trim();
    if (!/^[a-fA-F0-9]{16,128}$/.test(videoHash)) {
        const err = new Error('Đường link không chứa tham số ?hash= hợp lệ');
        err.statusCode = 400;
        throw err;
    }

    const cachedEntry = getStreamCacheEntry(videoHash);
    if (cachedEntry) {
        console.log(`[CACHE HIT] Video hash ${videoHash} đã có sẵn trong bộ nhớ!`);
        return { ...cachedEntry, fromCache: true };
    }

    if (inflightResolves.has(videoHash)) {
        return inflightResolves.get(videoHash);
    }

    const resolvePromise = (async () => {
        await acquireBrowserSlot();
        let browser = null;
        try {
            const recheck = getStreamCacheEntry(videoHash);
            if (recheck) {
                return { ...recheck, fromCache: true };
            }

            const freshCheck = await validateOutboundUrl(parsed.href);
            const embedOrigin = freshCheck.parsed.origin;
            console.log(`[RESOLVER] Đang mở trình duyệt ngầm để trích xuất: ${freshCheck.parsed.href}`);

            browser = await puppeteer.launch({
                executablePath: CHROME_EXECUTABLE_PATH,
                headless: 'new',
                args: [
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled'
                ]
            });

            let issuedPlaylistUrl = null;
            const page = await browser.newPage();
            await page.setUserAgent(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );
            await page.setExtraHTTPHeaders({
                Referer: `${embedOrigin}/`
            });

            await page.setRequestInterception(true);
            page.on('request', req => {
                const reqUrl = req.url();
                if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) {
                    return req.continue();
                }
                let parsedReq;
                try {
                    parsedReq = new URL(reqUrl);
                } catch (_e) {
                    return req.abort();
                }
                if (parsedReq.protocol !== 'https:') {
                    return req.abort();
                }
                const reqHost = parsedReq.hostname.toLowerCase().replace(/^\[|\]$/g, '');
                if (net.isIP(reqHost) !== 0 && isDisallowedAddress(reqHost)) {
                    return req.abort();
                }

                if (reqUrl.includes('guard-messages')) {
                    return req.respond({
                        status: 200,
                        contentType: 'application/javascript',
                        body: `
                            window.streamGuard = {
                                version: "guard-7",
                                status: () => ({ version: "guard-7", devtoolsBuild: "iframe-local-5", detectDevtools: true, blocked: false }),
                                ready: Promise.resolve(),
                                isBlocked: () => false,
                                reportAdResource: () => {},
                                waitForAccess: () => Promise.resolve(),
                                registerPlayer: () => {}
                            };
                        `
                    });
                }
                return req.continue();
            });

            page.on('response', async res => {
                const req = res.request();
                if (req.method() === 'POST' && res.url().includes('embed.php')) {
                    try {
                        const json = await res.json();
                        if (json && typeof json.playlist === 'string') {
                            issuedPlaylistUrl = json.playlist;
                        }
                    } catch (_e) {}
                }
            });

            await page.goto(freshCheck.parsed.href, { waitUntil: 'networkidle2', timeout: 25000 });

            for (let i = 0; i < 20; i++) {
                if (issuedPlaylistUrl) break;
                await new Promise(r => setTimeout(r, 400));
            }

            if (!issuedPlaylistUrl) {
                throw new Error('Quá thời gian chờ cấp Playlist từ máy chủ phát');
            }

            const validatedPlaylist = await validateOutboundUrl(issuedPlaylistUrl);
            console.log('[RESOLVER] Đang tải playlist m3u8 mã hóa...');
            const playlistRes = await fetch(validatedPlaylist.parsed.href, {
                redirect: 'error',
                headers: {
                    Referer: `${embedOrigin}/`,
                    'User-Agent':
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            if (!playlistRes.ok) {
                throw new Error(`Upstream playlist responded with HTTP ${playlistRes.status}`);
            }

            const rawM3u8 = await playlistRes.text();
            const lines = rawM3u8.trim().split('\n').map(l => l.trim());
            const ivMatch = lines[1] ? lines[1].match(/iv=([a-f0-9]+)/i) : null;
            if (!ivMatch || !lines[3]) {
                throw new Error('Định dạng playlist mã hóa không hợp lệ');
            }
            const iv = Buffer.from(ivMatch[1], 'hex');

            const rawCipher = Buffer.from(lines[3], 'base64');
            if (rawCipher.length <= 16) {
                throw new Error('Dữ liệu mã hóa playlist không hợp lệ');
            }
            const tag = rawCipher.subarray(rawCipher.length - 16);
            const ciphertext = rawCipher.subarray(0, rawCipher.length - 16);

            const hmac = crypto.createHmac('sha256', Buffer.from(STREAM_HMAC_SECRET, 'utf-8'));
            hmac.update(Buffer.from(videoHash, 'utf-8'));
            const key = hmac.digest();

            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');

            const segmentCount = decrypted
                .split('\n')
                .filter(l => l.trim().startsWith('https://')).length;
            const entry = {
                m3u8: decrypted,
                segmentCount,
                embedOrigin,
                embedUrl: freshCheck.parsed.href,
                videoHash
            };

            setStreamCacheEntry(videoHash, entry);
            console.log(`[RESOLVER] Đã giải mã thành công! Gồm ${segmentCount} segments.`);
            return { ...entry, fromCache: false };
        } finally {
            if (browser) {
                try {
                    await browser.close();
                } catch (_closeErr) {}
            }
            releaseBrowserSlot();
        }
    })();

    inflightResolves.set(videoHash, resolvePromise);
    try {
        return await resolvePromise;
    } finally {
        inflightResolves.delete(videoHash);
    }
}

function getSafeLocalHost(req) {
    const defaultHost = `${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
    const rawHeader = (req.headers.host || '').trim();
    if (!rawHeader) return defaultHost;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i.test(rawHeader)) {
        return rawHeader;
    }
    return defaultHost;
}

function getProxiedPlaylist(host, hash) {
    const entry = getStreamCacheEntry(hash);
    if (!entry) return null;

    const lines = entry.m3u8.split('\n');
    const rewritten = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('https://')) {
            return `http://${host}/segment?url=${encodeURIComponent(trimmed)}&origin=${encodeURIComponent(entry.embedOrigin)}`;
        }
        return line;
    });
    return rewritten.join('\n');
}

function isAuthorizedResolveRequest(req) {
    if (!PLAYER_SERVER_TOKEN) {
        return true;
    }
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
        return false;
    }
    const providedToken = authHeader.slice(7).trim();
    if (!providedToken) {
        return false;
    }
    const expectedHash = crypto.createHash('sha256').update(PLAYER_SERVER_TOKEN, 'utf-8').digest();
    const providedHash = crypto.createHash('sha256').update(providedToken, 'utf-8').digest();
    return crypto.timingSafeEqual(expectedHash, providedHash);
}

function readRequestBodyWithCap(req, maxBytes = MAX_RESOLVE_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        let settled = false;

        req.on('data', chunk => {
            if (settled) return;
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                settled = true;
                req.pause();
                const err = new Error(`Request body exceeds ${maxBytes} bytes`);
                err.statusCode = 413;
                reject(err);
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (settled) return;
            settled = true;
            resolve(Buffer.concat(chunks).toString('utf-8'));
        });

        req.on('error', err => {
            if (settled) return;
            settled = true;
            reject(err);
        });
    });
}

const server = http.createServer(async (req, res) => {
    const localHost = getSafeLocalHost(req);
    const parsedUrl = new URL(req.url || '/', `http://${localHost}`);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }

    if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderPlayerHTML());
    }

    if (pathname === '/api/resolve' && req.method === 'POST') {
        if (!isAuthorizedResolveRequest(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Bearer token required' }));
        }

        let rawBody;
        try {
            rawBody = await readRequestBodyWithCap(req, MAX_RESOLVE_BODY_BYTES);
        } catch (bodyErr) {
            const status = bodyErr.statusCode || 400;
            res.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                Connection: 'close'
            });
            return res.end(JSON.stringify({ success: false, error: bodyErr.message }));
        }

        try {
            let data;
            try {
                data = JSON.parse(rawBody || '{}');
            } catch (_parseErr) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ success: false, error: 'Invalid JSON request body' }));
            }

            const embedUrl = typeof data.embedUrl === 'string' ? data.embedUrl.trim() : '';
            if (!embedUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ success: false, error: 'Vui lòng cung cấp link embed' }));
            }

            const startTime = Date.now();
            const result = await resolveStreamFromEmbed(embedUrl);
            const durationMs = Date.now() - startTime;

            const streamUrl = `http://${localHost}/stream.m3u8?hash=${encodeURIComponent(result.videoHash)}`;

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(
                JSON.stringify({
                    success: true,
                    videoHash: result.videoHash,
                    segmentCount: result.segmentCount,
                    durationMs,
                    cached: Boolean(result.fromCache),
                    streamUrl
                })
            );
        } catch (err) {
            const status = err.statusCode || 500;
            console.error('[API RESOLVE ERROR]', err.message);
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, error: err.message }));
        }
    }

    if (pathname === '/stream.m3u8') {
        const hash = parsedUrl.searchParams.get('hash') || Array.from(streamCache.keys())[0];
        if (!hash || !streamCache.has(hash)) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Playlist not found or not resolved yet.');
        }

        const playlist = getProxiedPlaylist(localHost, hash);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache'
        });
        return res.end(playlist);
    }

    if (pathname === '/segment') {
        const targetUrl = parsedUrl.searchParams.get('url');
        const rawOrigin = parsedUrl.searchParams.get('origin') || 'https://embed11.streamc.xyz';
        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Missing segment url query parameter');
        }

        let validatedTarget;
        let safeRefererOrigin = 'https://embed11.streamc.xyz';
        try {
            validatedTarget = await validateOutboundUrl(targetUrl);
            const parsedOrigin = new URL(rawOrigin);
            if (parsedOrigin.protocol === 'https:' && isAllowedHostname(parsedOrigin.hostname)) {
                safeRefererOrigin = parsedOrigin.origin;
            }
        } catch (validationErr) {
            const status = validationErr.statusCode || 400;
            res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end(validationErr.message);
        }

        const options = {
            headers: {
                Referer: `${safeRefererOrigin}/`,
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: '*/*'
            },
            lookup: (_hostname, lookupOpts, cb) => {
                if (lookupOpts && lookupOpts.all) {
                    return cb(null, [
                        {
                            address: validatedTarget.resolvedAddress,
                            family: validatedTarget.resolvedFamily
                        }
                    ]);
                }
                return cb(null, validatedTarget.resolvedAddress, validatedTarget.resolvedFamily);
            }
        };

        if (req.headers.range) {
            options.headers['Range'] = req.headers.range;
        }

        const proxyReq = https.get(validatedTarget.parsed.href, options, proxyRes => {
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
                proxyRes.resume();
                res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('Upstream redirects are not permitted');
            }

            const headers = {
                'Content-Type': 'video/mp2t',
                'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
                Vary: 'Origin',
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'public, max-age=86400'
            };

            if (proxyRes.headers['content-length']) {
                headers['Content-Length'] = proxyRes.headers['content-length'];
            }
            if (proxyRes.headers['content-range']) {
                headers['Content-Range'] = proxyRes.headers['content-range'];
            }
            if (proxyRes.headers['accept-ranges']) {
                headers['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
            }

            res.writeHead(proxyRes.statusCode || 200, headers);
            proxyRes.pipe(res);
        });

        proxyReq.setTimeout(20000, () => {
            proxyReq.abort();
        });

        proxyReq.on('error', _err => {
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Upstream segment fetch failed');
            }
        });

        req.on('aborted', () => proxyReq.abort());
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
});

function renderPlayerHTML() {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>StreamC Universal Cinema Player</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/artplayer/dist/artplayer.js"></script>
    <style>
        :root {
            --bg-primary: #080a0f;
            --bg-card: rgba(18, 22, 31, 0.75);
            --card-border: rgba(255, 255, 255, 0.08);
            --accent: #e50914;
            --accent-glow: rgba(229, 9, 20, 0.4);
            --cyan: #38bdf8;
            --green: #22c55e;
            --text-main: #f3f4f6;
            --text-sub: #9ca3af;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg-primary);
            background-image:
                radial-gradient(at 0% 0%, rgba(229, 9, 20, 0.15) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(56, 189, 248, 0.1) 0px, transparent 50%);
            color: var(--text-main);
            font-family: 'Outfit', -apple-system, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 24px 16px 48px;
        }
        header {
            width: 100%;
            max-width: 1100px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-badge {
            background: linear-gradient(135deg, #e50914, #ff3b30);
            color: white;
            font-weight: 700;
            font-size: 13px;
            padding: 4px 10px;
            border-radius: 6px;
            box-shadow: 0 2px 12px var(--accent-glow);
        }
        .brand-title { font-size: 21px; font-weight: 600; }

        .input-container {
            width: 100%;
            max-width: 1100px;
            margin-bottom: 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .input-bar {
            display: flex;
            gap: 10px;
            background: var(--bg-card);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 6px;
            backdrop-filter: blur(16px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .input-bar:focus-within {
            border-color: rgba(229, 9, 20, 0.5);
            box-shadow: 0 10px 30px rgba(229, 9, 20, 0.2);
        }
        .input-bar input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            color: white;
            font-family: inherit;
            font-size: 14px;
            padding: 10px 16px;
        }
        .input-bar input::placeholder { color: var(--text-sub); }
        .submit-btn {
            background: linear-gradient(135deg, #e50914, #c90812);
            color: white;
            border: none;
            border-radius: 8px;
            font-family: inherit;
            font-size: 14px;
            font-weight: 600;
            padding: 10px 24px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s ease;
        }
        .submit-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 16px var(--accent-glow);
        }
        .submit-btn:disabled { opacity: 0.6; cursor: wait; }

        .presets {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            font-size: 12px;
            color: var(--text-sub);
        }
        .preset-chip {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            padding: 4px 10px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .preset-chip:hover {
            background: rgba(229, 9, 20, 0.2);
            border-color: var(--accent);
            color: white;
        }

        .status-msg {
            font-size: 13px;
            min-height: 20px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .status-msg.loading { color: var(--cyan); }
        .status-msg.success { color: var(--green); }
        .status-msg.error { color: #f87171; }

        .player-wrapper {
            width: 100%;
            max-width: 1100px;
            position: relative;
            background: #000;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px var(--card-border);
            aspect-ratio: 16 / 9;
        }
        .artplayer-app { width: 100%; height: 100%; }

        .dashboard-grid {
            width: 100%;
            max-width: 1100px;
            margin-top: 24px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 16px;
        }
        .card {
            background: var(--bg-card);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 18px 20px;
            backdrop-filter: blur(16px);
        }
        .card-label {
            font-size: 12px;
            color: var(--text-sub);
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 6px;
        }
        .card-value {
            font-size: 17px;
            font-weight: 600;
            color: var(--text-main);
        }
        .card-sub { font-size: 12px; color: var(--cyan); margin-top: 4px; }
    </style>
</head>
<body>
    <header>
        <div class="brand">
            <div class="brand-badge">PRO</div>
            <div class="brand-title">StreamC Universal Cinema Player</div>
        </div>
    </header>

    <div class="input-container">
        <div class="input-bar">
            <input type="text" id="embed-url-input"
                   value="https://embed13.streamc.xyz/embed.php?hash=32b9d2faa0d6aebe0bb83356ccc308e9"
                   placeholder="Dán link embed.php tại đây (vd: https://embed13.streamc.xyz/embed.php?hash=...)" />
            <button class="submit-btn" id="resolve-btn" onclick="handleResolve()">
                <span id="btn-text">Bóc Tách & Phát</span>
            </button>
        </div>
        <div class="presets">
            <span>Link mẫu nhanh:</span>
            <div class="preset-chip" onclick="setPreset('https://embed13.streamc.xyz/embed.php?hash=32b9d2faa0d6aebe0bb83356ccc308e9')">
                🎬 Phim Mới (Embed 13)
            </div>
            <div class="preset-chip" onclick="setPreset('https://embed11.streamc.xyz/embed.php?hash=816653d70e483b4f1cfe8eaf9dfe6d05')">
                🍿 Phim 1h52m (Embed 11)
            </div>
        </div>
        <div class="status-msg" id="status-msg"></div>
    </div>

    <div class="player-wrapper">
        <div class="artplayer-app" id="player"></div>
    </div>

    <div class="dashboard-grid">
        <div class="card">
            <div class="card-label">Hash Video Hiện Tại</div>
            <div class="card-value" id="stats-hash" style="font-family:monospace; font-size:14px;">32b9d2faa0d6aebe0bb83356ccc308e9</div>
            <div class="card-sub" id="stats-origin">Origin: https://embed13.streamc.xyz</div>
        </div>
        <div class="card">
            <div class="card-label">Độ phân giải & Video</div>
            <div class="card-value" id="stats-res">1920 × 800 FHD</div>
            <div class="card-sub">H.264 High Profile • 23.98 fps</div>
        </div>
        <div class="card">
            <div class="card-label">Tổng Segments</div>
            <div class="card-value" id="stats-segments">138 chunks</div>
            <div class="card-sub" id="stats-time">Thời gian giải: ~3s</div>
        </div>
        <div class="card">
            <div class="card-label">Buffer & Tốc độ</div>
            <div class="card-value" id="stats-buffer">Ready</div>
            <div class="card-sub" id="stats-speed">Direct proxy stream</div>
        </div>
    </div>

    <script>
        let currentArt = null;

        function setPreset(url) {
            document.getElementById('embed-url-input').value = url;
            handleResolve();
        }

        function setStatus(text, type = '') {
            const el = document.getElementById('status-msg');
            el.className = 'status-msg ' + type;
            el.textContent = text;
        }

        async function handleResolve() {
            const input = document.getElementById('embed-url-input');
            const btn = document.getElementById('resolve-btn');
            const btnText = document.getElementById('btn-text');
            const url = input.value.trim();

            if (!url) return;

            btn.disabled = true;
            btnText.textContent = 'Đang xử lý...';
            setStatus('⏳ Đang xác thực phiên phát và trích xuất stream...', 'loading');

            try {
                const headers = { 'Content-Type': 'application/json' };
                const storedToken = window.sessionStorage.getItem('player_server_token');
                if (storedToken) {
                    headers['Authorization'] = 'Bearer ' + storedToken;
                }

                const res = await fetch('/api/resolve', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ embedUrl: url })
                });

                const data = await res.json();
                if (!data.success) {
                    throw new Error(data.error || 'Giải mã thất bại');
                }

                const msg = data.cached
                    ? '⚡ Đã load tức thì từ RAM Cache (0ms)!'
                    : ('Trích xuất thành công trong ' + (data.durationMs / 1000).toFixed(1) + 's!');
                setStatus(msg, 'success');

                document.getElementById('stats-hash').textContent = data.videoHash;
                document.getElementById('stats-segments').textContent = data.segmentCount + ' chunks MPEG-TS';
                document.getElementById('stats-time').textContent = data.cached
                    ? 'Bộ nhớ đệm (0ms)'
                    : 'Giải mới (' + (data.durationMs / 1000).toFixed(1) + 's)';

                loadStream(data.streamUrl);
            } catch (err) {
                setStatus('❌ ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                btnText.textContent = 'Bóc Tách & Phát';
            }
        }

        function loadStream(url) {
            if (!currentArt) {
                initArtplayer(url);
            } else {
                currentArt.switchUrl(url);
                currentArt.play().catch(() => {});
            }
        }

        function initArtplayer(url) {
            currentArt = new Artplayer({
                container: '#player',
                url: url,
                type: 'm3u8',
                customType: {
                    m3u8: function (video, url, art) {
                        if (Hls.isSupported()) {
                            if (art.hls) {
                                art.hls.stopLoad();
                                art.hls.detachMedia();
                            }
                            const hls = new Hls({
                                maxBufferLength: 30,
                                maxMaxBufferLength: 60,
                                enableWorker: true
                            });
                            hls.loadSource(url);
                            hls.attachMedia(video);
                            art.hls = hls;

                            hls.on(Hls.Events.FRAG_LOADED, (_evt, data) => {
                                const stats = data.stats;
                                const speedMbps = ((stats.loaded * 8) / (stats.loading.end - stats.loading.start) / 1000).toFixed(1);
                                document.getElementById('stats-speed').textContent = 'Tốc độ: ' + speedMbps + ' Mbps';
                            });
                        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                            video.src = url;
                        }
                    }
                },
                volume: 0.8,
                isLive: false,
                muted: false,
                autoplay: true,
                pip: true,
                autoSize: false,
                screenshot: true,
                setting: true,
                playbackRate: true,
                aspectRatio: true,
                fullscreen: true,
                theme: '#e50914',
                lang: 'en'
            });

            setInterval(() => {
                const video = currentArt?.video;
                if (video && video.buffered.length > 0) {
                    const cur = video.currentTime;
                    for (let i = 0; i < video.buffered.length; i++) {
                        if (video.buffered.start(i) <= cur && cur <= video.buffered.end(i)) {
                            document.getElementById('stats-buffer').textContent = (video.buffered.end(i) - cur).toFixed(1) + 's đệm';
                            break;
                        }
                    }
                    if (video.videoWidth) {
                        document.getElementById('stats-res').textContent = video.videoWidth + ' × ' + video.videoHeight;
                    }
                }
            }, 1000);
        }

        window.addEventListener('DOMContentLoaded', () => {
            handleResolve();
        });
    </script>
</body>
</html>`;
}

if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`[+] Custom Cinema Player Server running at: http://${HOST}:${PORT}`);
    });
}

module.exports = {
    server,
    resolveStreamFromEmbed,
    validateOutboundUrl,
    isDisallowedAddress,
    isAllowedHostname,
    streamCache,
    setStreamCacheEntry
};
