const { CheerioCrawler, ProxyConfiguration, Dataset } = require('crawlee');
const fs = require('fs');
const path = require('path');

// Cấu hình Proxy HTTP Cloudflare WARP trên Singapore VPS
const proxyConfiguration = new ProxyConfiguration({
    proxyUrls: [
        'http://161.118.202.252:9872', // Cloudflare WARP ⚡ (Độ trễ thấp, IP sạch)
        'http://161.118.202.252:9874', // US 🇺🇸
        'http://161.118.202.252:9875'  // Hà Lan 🇳🇱
    ]
});

async function main() {
    console.log('🚀 [Crawlee] Bắt đầu khởi động crawler Film4k...');
    
    // Mảng lưu trữ kết quả phim cào được
    const scrapedMovies = [];

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxConcurrency: 5, // Crawl 5 trang đồng thời
        maxRequestsPerCrawl: 15, // Test thử 15 request đầu tiên
        requestHandlerTimeoutSecs: 30,

        async requestHandler({ request, $, json, response }) {
            const url = request.url;

            // 1. Nếu là trang Sitemap XML
            if (url.includes('sitemap-page.xml')) {
                console.log(`\n📑 [Sitemap] Đang xử lý: ${url}`);
                const locs = [];
                $('loc').each((_, el) => {
                    locs.push($(el).text().trim());
                });

                console.log(`[+] Tìm thấy ${locs.length} link trong sitemap.`);
                
                // Trích xuất các slug phim
                const movieUrls = locs.filter(l => l.includes('/movie/'));
                console.log(`[+] Trong đó có ${movieUrls.length} link phim.`);

                // Đẩy các API lấy chi tiết phim vào hàng đợi
                const apiRequests = [];
                for (let movieUrl of movieUrls) {
                    const slug = movieUrl.split('/movie/')[1]?.replace(/\/$/, '');
                    if (slug) {
                        apiRequests.push({
                            url: `https://fiml4k.fun/api/title/${slug}`,
                            userData: { slug, originalUrl: movieUrl }
                        });
                    }
                }

                // Chỉ enqueue thử 5 phim đầu tiên để test tốc độ
                const sampleRequests = apiRequests.slice(0, 5);
                console.log(`[+] Đang đẩy ${sampleRequests.length} phim mẫu vào hàng đợi crawl chi tiết...`);
                await crawler.addRequests(sampleRequests);
            }

            // 2. Nếu là API chi tiết phim (JSON)
            else if (url.includes('/api/title/')) {
                const slug = request.userData.slug;
                console.log(`🎬 [Film Details] Đang bóc tách phim: ${slug}`);

                try {
                    // CheerioCrawler tự động parse response nếu là JSON hoặc ta parse từ text
                    let data = json;
                    if (!data) {
                        const bodyText = response.body.toString('utf-8');
                        data = JSON.parse(bodyText);
                    }

                    if (data && data.movie) {
                        const m = data.movie;
                        const movieInfo = {
                            id: m._id,
                            slug: m.slug,
                            title_vi: m.title?.vi || m.title?.en,
                            title_en: m.title?.en,
                            year: m.year,
                            maxRes: m.maxRes || '1080p',
                            score: m.score,
                            genres_vi: m.genres?.vi || [],
                            poster_vi: m.poster?.vi || m.poster?.en,
                            backdrop: m.backdrop,
                            overview_vi: m.overview?.vi,
                            // Luồng phát HLS Master Playlist sạch:
                            hlsUrl: m.hlsUrl ? `https://fiml4k.fun${m.hlsUrl}` : null,
                            // Luồng phát chuyển tiếp qua proxy Singapore VPS của anh để bypass và decode TikTok CDN:
                            proxyStreamUrl: m.hlsUrl 
                                ? `https://secret.dangducminh.io.vn/?url=${encodeURIComponent(`https://fiml4k.fun${m.hlsUrl}`)}`
                                : null
                        };

                        console.log(`  ✅ ${movieInfo.title_vi} (${movieInfo.year}) - ${movieInfo.maxRes} - Điểm: ${movieInfo.score}`);
                        if (movieInfo.hlsUrl) {
                            console.log(`     🎥 HLS: ${movieInfo.hlsUrl.substring(0, 70)}...`);
                            console.log(`     ⚡ Proxy Stream: ${movieInfo.proxyStreamUrl.substring(0, 75)}...`);
                        }

                        scrapedMovies.push(movieInfo);
                        await Dataset.pushData(movieInfo);
                    }
                } catch (e) {
                    console.error(`  ❌ Lỗi parse JSON cho ${slug}:`, e.message);
                }
            }
        },

        failedRequestHandler({ request, error }) {
            console.error(`❌ Request lỗi: ${request.url} - ${error.message}`);
        }
    });

    // Thêm sitemap trang 1 vào hàng đợi
    await crawler.run([
        'https://fiml4k.fun/sitemap-page.xml?p=1'
    ]);

    console.log('\n=============================================');
    console.log(`🎉 [HOÀN TẤT] Đã cào thành công ${scrapedMovies.length} phim mẫu!`);
    
    // Lưu kết quả ra file JSON
    const outputPath = path.join(__dirname, 'film4k_sample_crawled.json');
    fs.writeFileSync(outputPath, JSON.stringify(scrapedMovies, null, 2), 'utf-8');
    console.log(`📁 File kết quả đã lưu tại: ${outputPath}`);
}

main().catch(console.error);
