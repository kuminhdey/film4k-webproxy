/**
 * Film4k Master Crawler using Crawlee
 * Tự động cào toàn bộ danh mục, thông tin phim, danh sách tập và link stream m3u8
 */
const { CheerioCrawler, ProxyConfiguration, Dataset } = require('crawlee');
const fs = require('fs');
const path = require('path');

// Sử dụng Proxy Pool trên VPS Singapore (WARP / US / EU)
const proxyConfiguration = new ProxyConfiguration({
    proxyUrls: [
        'http://161.118.202.252:9872', // Cloudflare WARP ⚡ (Độ trễ thấp, IP sạch)
        'http://161.118.202.252:9874', // US 🇺🇸
        'http://161.118.202.252:9875'  // Netherlands 🇳🇱
    ]
});

async function runFilm4kCrawler(options = {}) {
    const {
        maxMovies = 10,       // Số lượng phim muốn cào thử (set null nếu muốn cào hết)
        startPage = 1,
        concurrency = 5
    } = options;

    console.log('====================================================');
    console.log('🚀 [FILM4K MASTER CRAWLER] KHỞI ĐỘNG HỆ THỐNG CRAWLEE');
    console.log(`⚡ Concurrency: ${concurrency} | Giới hạn test: ${maxMovies || 'Toàn bộ'} phim`);
    console.log('====================================================\n');

    const crawledResults = [];

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxConcurrency: concurrency,
        maxRequestsPerCrawl: maxMovies ? (maxMovies + 5) : undefined,
        requestHandlerTimeoutSecs: 30,

        async requestHandler({ request, $, body, json }) {
            const url = request.url;

            // ----------------------------------------------------
            // 1. XỬ LÝ SITEMAP XML (Thu thập danh sách tất cả các phim)
            // ----------------------------------------------------
            if (url.includes('sitemap-page.xml')) {
                console.log(`📑 [Sitemap] Đang nạp danh mục: ${url}`);
                const locs = [];
                $('loc').each((_, el) => {
                    locs.push($(el).text().trim());
                });

                const movieUrls = locs.filter(l => l.includes('/movie/'));
                console.log(`[+] Tổng link trong sitemap: ${locs.length} | Link phim: ${movieUrls.length}`);

                // Tạo danh sách request gọi thẳng API /api/watch/{slug}
                const apiRequests = [];
                for (let movieUrl of movieUrls) {
                    const slug = movieUrl.split('/movie/')[1]?.replace(/\/$/, '');
                    if (slug) {
                        apiRequests.push({
                            url: `https://fiml4k.fun/api/watch/${slug}`,
                            userData: { slug, originalUrl: movieUrl }
                        });
                    }
                }

                // Giới hạn số lượng nếu đang ở chế độ test
                const selectedRequests = maxMovies ? apiRequests.slice(0, maxMovies) : apiRequests;
                console.log(`[+] Đang đẩy ${selectedRequests.length} phim vào hàng đợi xử lý...`);
                await crawler.addRequests(selectedRequests);
            }

            // ----------------------------------------------------
            // 2. XỬ LÝ API WATCH & METADATA (Bóc tách phim & tập & stream)
            // ----------------------------------------------------
            else if (url.includes('/api/watch/')) {
                const slug = request.userData.slug;
                try {
                    const data = json || (typeof body === 'string' ? JSON.parse(body) : JSON.parse(body.toString('utf-8')));

                    if (!data || !data.movie) {
                        console.warn(`⚠️ Không tìm thấy dữ liệu movie cho: ${slug}`);
                        return;
                    }

                    const m = data.movie;
                    const isTv = m.mediaType === 'tv';

                    // Xử lý danh sách tập phim (nếu là series) hoặc nguồn phát (nếu là movie)
                    let episodesData = [];
                    let defaultStream = null;

                    if (isTv && Array.isArray(data.episodes) && data.episodes.length > 0) {
                        episodesData = data.episodes.map(ep => ({
                            season: ep.season,
                            episode: ep.episode,
                            runtime: ep.runtime,
                            still: ep.still,
                            sources: (ep.sources || []).map(s => ({
                                label: s.label,
                                hlsUrl: `https://fiml4k.fun${s.url}`,
                                // Proxy Stream qua VPS Singapore của anh (vừa decode PNG, vừa phát mượt)
                                proxyStreamUrl: `https://secret.dangducminh.io.vn/?url=${encodeURIComponent(`https://fiml4k.fun${s.url}`)}`
                            }))
                        }));
                    } else if (m.hlsUrl || (data.sources && data.sources.length > 0)) {
                        const rawHls = m.hlsUrl || data.sources[0]?.url;
                        defaultStream = {
                            label: 'Server 1',
                            hlsUrl: `https://fiml4k.fun${rawHls}`,
                            proxyStreamUrl: `https://secret.dangducminh.io.vn/?url=${encodeURIComponent(`https://fiml4k.fun${rawHls}`)}`
                        };
                    }

                    const movieRecord = {
                        id: m._id,
                        slug: m.slug,
                        type: m.mediaType, // "movie" hoặc "tv"
                        title_vi: m.title?.vi || m.title?.en,
                        title_en: m.title?.en,
                        year: m.year,
                        quality: m.maxRes || '1080p',
                        score: m.score,
                        genres: m.genres?.vi || [],
                        country: m.country?.vi || m.country?.en,
                        poster: m.poster?.vi || m.poster?.en,
                        backdrop: m.backdrop,
                        overview: m.overview?.vi || m.overview?.en,
                        totalEpisodes: isTv ? (m.epTotal || episodesData.length) : 1,
                        stream: defaultStream,
                        episodes: episodesData,
                        crawledAt: new Date().toISOString()
                    };

                    const tag = isTv ? `[📺 PHIM BỘ - ${episodesData.length} tập]` : `[🎬 PHIM LẺ]`;
                    console.log(`✅ ${tag} ${movieRecord.title_vi} (${movieRecord.year}) • ${movieRecord.quality} • ⭐ ${movieRecord.score}`);
                    
                    if (!isTv && movieRecord.stream) {
                        console.log(`   🔗 Stream: ${movieRecord.stream.proxyStreamUrl.substring(0, 80)}...`);
                    } else if (isTv && episodesData[0]?.sources[0]) {
                        console.log(`   🔗 Tập 1: ${episodesData[0].sources[0].proxyStreamUrl.substring(0, 80)}...`);
                    }

                    crawledResults.push(movieRecord);
                    await Dataset.pushData(movieRecord);
                } catch (err) {
                    console.error(`❌ Lỗi parse JSON cho ${slug}:`, err.message);
                }
            }
        },

        failedRequestHandler({ request, error }) {
            console.error(`❌ Request thất bại [${request.url}]: ${error.message}`);
        }
    });

    // Bắt đầu cào từ trang sitemap chỉ định
    await crawler.run([
        `https://fiml4k.fun/sitemap-page.xml?p=${startPage}`
    ]);

    console.log('\n====================================================');
    console.log(`🎉 [HOÀN TẤT] Đã cào thành công ${crawledResults.length} phim!`);
    
    // Xuất ra file JSON
    const outputFile = path.join(__dirname, 'film4k_master_database.json');
    fs.writeFileSync(outputFile, JSON.stringify(crawledResults, null, 2), 'utf-8');
    console.log(`📁 Dữ liệu đầy đủ đã được xuất ra: ${outputFile}`);
    console.log('====================================================');

    return crawledResults;
}

// Chạy test 8 phim (gồm cả phim lẻ và phim bộ)
runFilm4kCrawler({ maxMovies: 8, startPage: 1, concurrency: 4 }).catch(console.error);
