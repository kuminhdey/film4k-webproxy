// crawler_service.js
/**
 * Film4k Master Crawler Service (Crawlee + Optional Proxy + SQLite + JSON Master Sync)
 *
 * Tính năng chính:
 * 1. Tự động cào các phim Hot / Mới cập nhật từ Film4k (hỗ trợ danh sách proxy tùy chọn qua biến môi trường CRAWLER_PROXY_URLS).
 * 2. Bóc tách chi tiết metadata, ảnh poster/backdrop TMDB, danh sách tập và luồng phát stream m3u8 (chỉ chấp nhận https://).
 * 3. Tự động merge & cập nhật vào file film4k_master_database.json (không bị ghi đè mất dữ liệu cũ).
 * 4. Đồng bộ trực tiếp vào SQLite database (movies.db) qua execFileSync và gửi thông báo reload tới Axum Backend API.
 */

const { CheerioCrawler, ProxyConfiguration, Dataset } = require('crawlee');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function getConfiguredProxyUrls() {
    const raw = (process.env.CRAWLER_PROXY_URLS || '').trim();
    if (!raw) {
        return [];
    }
    return raw
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => {
            if (!entry) return false;
            try {
                const parsed = new URL(entry);
                return (
                    parsed.protocol === 'http:' ||
                    parsed.protocol === 'https:' ||
                    parsed.protocol === 'socks5:'
                );
            } catch (_err) {
                return false;
            }
        });
}

function isHttpsUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('https://')) {
        return false;
    }
    if (/\s/.test(value)) {
        return false;
    }
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' && Boolean(parsed.hostname);
    } catch (_err) {
        return false;
    }
}

function normalizeUpstreamUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('/')) {
        return `https://fiml4k.fun${trimmed}`;
    }
    return trimmed;
}

const MASTER_JSON_PATH = path.join(__dirname, 'film4k_master_database.json');
const SQLITE_DB_PATH = path.join(__dirname, 'movies.db');
const SYNC_SQLITE_SCRIPT = path.join(__dirname, 'sync_sqlite.py');

/**
 * Hàm phân tích đối số từ dòng lệnh (CLI flags)
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        mode: 'hot',          // 'hot' | 'sitemap' | 'slug'
        limit: 5,             // Số lượng phim muốn cào trong batch này
        page: 1,              // Trang sitemap nếu mode == 'sitemap'
        slug: null,           // Slug cụ thể nếu mode == 'slug'
        concurrency: 4,       // Số luồng cào đồng thời
        backendUrl: 'http://127.0.0.1:8090'
    };

    for (const arg of args) {
        if (arg.startsWith('--limit=')) {
            options.limit = parseInt(arg.split('=')[1], 10) || 5;
        } else if (arg.startsWith('--mode=')) {
            options.mode = arg.split('=')[1];
        } else if (arg.startsWith('--page=')) {
            options.page = parseInt(arg.split('=')[1], 10) || 1;
        } else if (arg.startsWith('--slug=')) {
            options.slug = arg.split('=')[1];
            options.mode = 'slug';
        } else if (arg.startsWith('--concurrency=')) {
            options.concurrency = parseInt(arg.split('=')[1], 10) || 4;
        } else if (arg.startsWith('--backend=')) {
            options.backendUrl = arg.split('=')[1];
        }
    }

    return options;
}

/**
 * Đọc file film4k_master_database.json hiện tại và merge phim mới vào
 */
function updateMasterDatabase(newRecords, filePath = MASTER_JSON_PATH) {
    let existingList = [];
    if (fs.existsSync(filePath)) {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            existingList = JSON.parse(raw);
            if (!Array.isArray(existingList)) existingList = [];
        } catch (err) {
            console.warn(`⚠️ [Master DB] Lỗi đọc JSON cũ, tạo mới:`, err.message);
            existingList = [];
        }
    }

    const movieMap = new Map();
    for (const item of existingList) {
        if (item && item.slug) {
            movieMap.set(item.slug, item);
        }
    }

    let addedCount = 0;
    let updatedCount = 0;

    for (const record of newRecords) {
        if (!record || !record.slug) continue;
        if (!isHttpsUrl(record.poster)) continue;
        if (movieMap.has(record.slug)) {
            updatedCount++;
        } else {
            addedCount++;
        }
        movieMap.set(record.slug, record);
    }

    const mergedList = Array.from(movieMap.values());

    const tempFile = `${filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(mergedList, null, 2), 'utf-8');
    fs.renameSync(tempFile, filePath);

    console.log(`\n💾 [Master DB] Cập nhật thành công file: ${filePath}`);
    console.log(`   📊 Tổng số phim trong kho: ${mergedList.length}`);
    console.log(`   ✨ Thêm mới: ${addedCount} | 🔄 Cập nhật: ${updatedCount}`);

    return { total: mergedList.length, added: addedCount, updated: updatedCount };
}

/**
 * Đồng bộ dữ liệu vào SQLite movies.db và thông báo backend
 */
async function syncDatabaseAndNotify(backendUrl = 'http://127.0.0.1:8090') {
    console.log(`\n🔄 [Sync] Đang đồng bộ vào SQLite (${path.basename(SQLITE_DB_PATH)})...`);

    try {
        if (fs.existsSync(SYNC_SQLITE_SCRIPT)) {
            const output = execFileSync('python3', [SYNC_SQLITE_SCRIPT], {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'pipe']
            });
            if (output && output.trim()) {
                console.log(`   ${output.trim()}`);
            }
        }
    } catch (err) {
        console.warn(`   ⚠️ Lỗi khi chạy sync_sqlite.py:`, err.message);
    }

    try {
        const adminToken = (process.env.ADMIN_TOKEN || '').trim();
        const headers = { 'Content-Type': 'application/json' };
        if (adminToken) {
            headers['Authorization'] = `Bearer ${adminToken}`;
        }
        const triggerPath = adminToken ? '/api/admin/crawler/trigger' : '/api/crawler/trigger';
        console.log(`📡 [Backend API] Gửi thông báo reload tới ${backendUrl}${triggerPath}...`);
        const res = await fetch(`${backendUrl}${triggerPath}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ mode: 'latest' }),
            signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
            const result = await res.json();
            console.log(`   ✅ Axum Backend phản hồi:`, JSON.stringify(result));
        } else {
            console.log(`   ℹ️ Backend trả về HTTP ${res.status}`);
        }
    } catch (_e) {
        console.log(`   ℹ️ Backend chưa chạy hoặc không phản hồi (SQLite đã được cập nhật trực tiếp).`);
    }
}

/**
 * Hàm chính thực thi crawler
 */
async function runCrawler(userOptions = {}) {
    const options = { ...parseArgs(), ...userOptions };
    const { mode, limit, page, slug, concurrency, backendUrl } = options;
    const proxyUrls = getConfiguredProxyUrls();

    console.log('================================================================');
    console.log('🚀 [FILM4K INTEGRATED CRAWLER SERVICE]');
    console.log(
        `⚡ Proxy: ${proxyUrls.length > 0 ? `${proxyUrls.length} configured endpoint(s)` : 'Direct (no CRAWLER_PROXY_URLS set)'}`
    );
    console.log(`🎯 Chế độ: ${mode.toUpperCase()} | Giới hạn batch: ${limit || 'Tất cả'} phim | Luồng: ${concurrency}`);
    console.log('================================================================\n');

    const proxyConfiguration =
        proxyUrls.length > 0 ? new ProxyConfiguration({ proxyUrls }) : undefined;

    const crawledMovies = [];

    let existingSlugs = new Set();
    if (fs.existsSync(MASTER_JSON_PATH)) {
        try {
            const currentData = JSON.parse(fs.readFileSync(MASTER_JSON_PATH, 'utf-8'));
            if (Array.isArray(currentData)) {
                existingSlugs = new Set(currentData.map(m => m.slug));
            }
        } catch (_e) {}
    }

    const crawlerOptions = {
        maxConcurrency: concurrency,
        maxRequestsPerCrawl: limit ? limit + 10 : 100,
        requestHandlerTimeoutSecs: 35,

        async requestHandler({ request, $, body, json }) {
            const url = request.url;
            const label = request.userData.label || '';

            if (label === 'HOME' || url.includes('/api/home')) {
                console.log(`🔥 [Film4k Home] Đang nạp danh mục phim Hot & Mới từ: ${url}`);
                const homeData = json || JSON.parse(body.toString('utf-8'));

                const candidateSlugs = [];
                const addSlug = m => {
                    if (m && m.slug && !candidateSlugs.includes(m.slug)) {
                        candidateSlugs.push(m.slug);
                    }
                };

                (homeData.top || []).forEach(addSlug);
                (homeData.hero || []).forEach(addSlug);
                (homeData.newMovies || []).forEach(addSlug);
                (homeData.newSeries || []).forEach(addSlug);
                (homeData.list || []).forEach(addSlug);

                console.log(`[+] Tìm thấy tổng cộng ${candidateSlugs.length} phim hot/mới trên trang chủ.`);

                const unCrawledSlugs = candidateSlugs.filter(s => !existingSlugs.has(s));
                console.log(`[+] Trong đó có ${unCrawledSlugs.length} phim chưa có trong database.`);

                let selectedSlugs = unCrawledSlugs.slice(0, limit);
                if (selectedSlugs.length < limit) {
                    const remaining = limit - selectedSlugs.length;
                    const alreadyHad = candidateSlugs.filter(s => existingSlugs.has(s)).slice(0, remaining);
                    selectedSlugs = selectedSlugs.concat(alreadyHad);
                }

                console.log(`[+] Đang đẩy ${selectedSlugs.length} phim vào hàng đợi bóc tách chi tiết:`);
                selectedSlugs.forEach((s, idx) =>
                    console.log(`   ${idx + 1}. ${s} ${existingSlugs.has(s) ? '(cập nhật)' : '(mới)'}`)
                );

                const apiRequests = selectedSlugs.map(s => ({
                    url: `https://fiml4k.fun/api/watch/${encodeURIComponent(s)}`,
                    userData: { label: 'WATCH', slug: s }
                }));

                await crawler.addRequests(apiRequests);
            } else if (label === 'SITEMAP' || url.includes('sitemap-page.xml')) {
                console.log(`📑 [Sitemap] Đang nạp sitemap: ${url}`);
                const locs = [];
                $('loc').each((_, el) => {
                    locs.push($(el).text().trim());
                });

                const movieUrls = locs.filter(l => l.includes('/movie/'));
                console.log(`[+] Tìm thấy ${movieUrls.length} link phim trong sitemap.`);

                const slugs = movieUrls
                    .map(u => u.split('/movie/')[1]?.replace(/\/$/, ''))
                    .filter(Boolean);

                const unCrawled = slugs.filter(s => !existingSlugs.has(s));
                const targetSlugs = (unCrawled.length > 0 ? unCrawled : slugs).slice(0, limit);

                console.log(`[+] Đang đưa ${targetSlugs.length} phim từ sitemap vào xử lý...`);
                const apiRequests = targetSlugs.map(s => ({
                    url: `https://fiml4k.fun/api/watch/${encodeURIComponent(s)}`,
                    userData: { label: 'WATCH', slug: s }
                }));

                await crawler.addRequests(apiRequests);
            } else if (label === 'WATCH' || url.includes('/api/watch/')) {
                const currentSlug = request.userData.slug;
                try {
                    const data = json || JSON.parse(body.toString('utf-8'));
                    if (!data || !data.movie) {
                        console.warn(`⚠️ [API] Không có trường movie trong response: ${currentSlug}`);
                        return;
                    }

                    const m = data.movie;
                    const isTv = m.mediaType === 'tv';

                    let episodesData = [];
                    let defaultStream = null;

                    if (isTv && Array.isArray(data.episodes) && data.episodes.length > 0) {
                        episodesData = data.episodes
                            .map(ep => {
                                const sources = (ep.sources || [])
                                    .map(s => {
                                        const hls = normalizeUpstreamUrl(s.url || '');
                                        if (!isHttpsUrl(hls)) return null;
                                        return {
                                            label: s.label || 'Server 1',
                                            hlsUrl: hls,
                                            proxyStreamUrl: `https://secret.dangducminh.io.vn/?url=${encodeURIComponent(hls)}`
                                        };
                                    })
                                    .filter(Boolean);
                                if (sources.length === 0) return null;
                                const stillUrl = normalizeUpstreamUrl(ep.still || '');
                                return {
                                    movieSlug: m.slug,
                                    season: ep.season || 1,
                                    episode: ep.episode,
                                    title: ep.title || `Tập ${ep.episode}`,
                                    runtime: ep.runtime || 45,
                                    still: isHttpsUrl(stillUrl) ? stillUrl : '',
                                    sources
                                };
                            })
                            .filter(Boolean);
                    } else if (m.hlsUrl || (data.sources && data.sources.length > 0)) {
                        const rawHls = m.hlsUrl || data.sources[0]?.url;
                        const fullHls = normalizeUpstreamUrl(rawHls || '');
                        if (isHttpsUrl(fullHls)) {
                            defaultStream = {
                                label: data.sources?.[0]?.label || 'Server 1',
                                hlsUrl: fullHls,
                                proxyStreamUrl: `https://secret.dangducminh.io.vn/?url=${encodeURIComponent(fullHls)}`
                            };
                        }
                    }

                    const posterUrl = normalizeUpstreamUrl(m.poster?.vi || m.poster?.en || '');
                    const backdropUrl = normalizeUpstreamUrl(m.backdrop || '');

                    if (!isHttpsUrl(posterUrl)) {
                        console.warn(`⚠️ [Validation] Bỏ qua ${currentSlug}: poster không dùng https://`);
                        return;
                    }
                    if (!isTv && !defaultStream) {
                        console.warn(`⚠️ [Validation] Bỏ qua ${currentSlug}: stream không hợp lệ`);
                        return;
                    }
                    if (isTv && episodesData.length === 0) {
                        console.warn(`⚠️ [Validation] Bỏ qua ${currentSlug}: không có tập hợp lệ`);
                        return;
                    }

                    const movieRecord = {
                        id: m._id,
                        slug: m.slug,
                        type: m.mediaType || 'movie',
                        title_vi: m.title?.vi || m.title?.en || m.slug,
                        title_en: m.title?.en || '',
                        year: m.year || 2024,
                        quality: m.maxRes || '1080p',
                        score: typeof m.score === 'number' ? Math.round(m.score * 10) / 10 : 0.0,
                        genres: m.genres?.vi || m.genres?.en || [],
                        country: m.country?.vi || m.country?.en || '',
                        poster: posterUrl,
                        backdrop: isHttpsUrl(backdropUrl) ? backdropUrl : '',
                        overview: m.overview?.vi || m.overview?.en || '',
                        totalEpisodes: isTv ? (m.epTotal || episodesData.length) : 1,
                        stream: defaultStream,
                        episodes: episodesData,
                        crawledAt: new Date().toISOString()
                    };

                    const tag = isTv ? `[📺 SERIES - ${episodesData.length} tập]` : `[🎬 MOVIE]`;
                    console.log(`✅ ${tag} ${movieRecord.title_vi} (${movieRecord.year}) • ${movieRecord.quality} • ⭐ ${movieRecord.score}`);

                    if (!isTv && movieRecord.stream) {
                        console.log(`   🎥 Stream m3u8: ${movieRecord.stream.hlsUrl.substring(0, 75)}...`);
                        console.log(`   ⚡ Proxy Stream: ${movieRecord.stream.proxyStreamUrl.substring(0, 80)}...`);
                    } else if (isTv && episodesData[0]?.sources[0]) {
                        console.log(`   🎥 Tập 1 m3u8: ${episodesData[0].sources[0].hlsUrl.substring(0, 75)}...`);
                        console.log(`   ⚡ Tập 1 Proxy: ${episodesData[0].sources[0].proxyStreamUrl.substring(0, 80)}...`);
                    }

                    crawledMovies.push(movieRecord);
                    await Dataset.pushData(movieRecord);
                } catch (err) {
                    console.error(`❌ Lỗi phân tích phim [${currentSlug}]:`, err.message);
                }
            }
        },

        failedRequestHandler({ request, error }) {
            console.error(`❌ Request thất bại [${request.url}]: ${error.message}`);
        }
    };

    if (proxyConfiguration) {
        crawlerOptions.proxyConfiguration = proxyConfiguration;
    }

    const crawler = new CheerioCrawler(crawlerOptions);

    const initialRequests = [];
    if (mode === 'slug' && slug) {
        initialRequests.push({
            url: `https://fiml4k.fun/api/watch/${encodeURIComponent(slug)}`,
            userData: { label: 'WATCH', slug }
        });
    } else if (mode === 'sitemap') {
        initialRequests.push({
            url: `https://fiml4k.fun/sitemap-page.xml?p=${page}`,
            userData: { label: 'SITEMAP' }
        });
    } else {
        initialRequests.push({
            url: 'https://fiml4k.fun/api/home',
            userData: { label: 'HOME' }
        });
    }

    await crawler.run(initialRequests);

    console.log('\n================================================================');
    console.log(`🎉 [HOÀN TẤT ĐỢT CÀO] Đã bóc tách thành công ${crawledMovies.length} phim!`);
    console.log('================================================================');

    if (crawledMovies.length > 0) {
        updateMasterDatabase(crawledMovies, MASTER_JSON_PATH);
        await syncDatabaseAndNotify(backendUrl);
    }

    return crawledMovies;
}

if (require.main === module) {
    runCrawler().catch(err => {
        console.error('💥 [FATAL ERROR] Lỗi chạy crawler service:', err);
        process.exit(1);
    });
}

module.exports = {
    runCrawler,
    updateMasterDatabase,
    syncDatabaseAndNotify,
    getConfiguredProxyUrls,
    isHttpsUrl
};
