def render_home_page(movies: list, stats: dict, current_type: str = "all", search_query: str = "") -> str:
    hero_movie = movies[0] if movies else None
    
    # Generate movie cards HTML
    cards_html = []
    for m in movies:
        is_tv = m.get("type") == "tv"
        type_badge = f'<span class="badge badge-tv">TV Series ({m.get("total_episodes", 1)} tập)</span>' if is_tv else '<span class="badge badge-movie">Phim Lẻ</span>'
        res_badge = f'<span class="badge badge-res">{m.get("quality", "1080p")}</span>'
        score_val = m.get("score", 0.0)
        score_badge = f'<span class="badge badge-score">★ {score_val:.1f}</span>' if score_val else ''
        poster_url = m.get("poster") or "https://via.placeholder.com/300x450?text=Film4k"
        
        cards_html.append(f"""
        <div class="movie-card" onclick="window.location.href='/watch/{m['slug']}'">
            <div class="poster-box">
                <img src="{poster_url}" alt="{m['title_vi']}" loading="lazy" />
                <div class="card-overlay">
                    <button class="btn-play-circle" aria-label="Xem phim">▶</button>
                </div>
                <div class="card-badges-top">
                    {res_badge}
                    {score_badge}
                </div>
                <div class="card-badges-bottom">
                    {type_badge}
                </div>
            </div>
            <div class="card-info">
                <h3 class="card-title" title="{m['title_vi']}">{m['title_vi']}</h3>
                <div class="card-meta">
                    <span class="card-year">{m.get('year', '')}</span>
                    <span class="card-en" title="{m.get('title_en', '')}">{m.get('title_en', '')}</span>
                </div>
            </div>
        </div>
        """)
    
    cards_content = "\n".join(cards_html) if cards_html else """
        <div class="empty-state">
            <p>Chưa có phim nào phù hợp hoặc đang cào dữ liệu từ Film4k...</p>
            <button class="btn-refresh" onclick="triggerCrawl()">🔄 Bắt đầu cào phim ngay</button>
        </div>
    """

    hero_html = ""
    if hero_movie:
        hero_bg = hero_movie.get("backdrop") or hero_movie.get("poster") or ""
        hero_genres = " • ".join(hero_movie.get("genres", [])[:3])
        hero_html = f"""
        <section class="hero-billboard" style="background-image: linear-gradient(to right, rgba(11,15,25,0.95) 20%, rgba(11,15,25,0.4) 60%, rgba(11,15,25,0.95) 100%), url('{hero_bg}');">
            <div class="hero-content">
                <div class="hero-badge-row">
                    <span class="badge badge-hero">🔥 PHIM NỔI BẬT NHẤT</span>
                    <span class="badge badge-res">{hero_movie.get('quality', '4K UHD')}</span>
                    <span class="badge badge-score">★ {hero_movie.get('score', 8.5):.1f}</span>
                    <span class="badge badge-year">{hero_movie.get('year', 2025)}</span>
                </div>
                <h1 class="hero-title">{hero_movie.get('title_vi')}</h1>
                <h2 class="hero-subtitle">{hero_movie.get('title_en')}</h2>
                <p class="hero-genres">{hero_genres}</p>
                <p class="hero-overview">{hero_movie.get('overview', '')[:280]}...</p>
                <div class="hero-actions">
                    <a href="/watch/{hero_movie['slug']}" class="btn-hero-play">
                        <span class="play-icon">▶</span> XEM PHIM NGAY
                    </a>
                    <button class="btn-hero-info" onclick="window.location.href='/watch/{hero_movie['slug']}'">
                        ℹ️ Chi tiết & Tập phim
                    </button>
                </div>
            </div>
        </section>
        """

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8">
    <title>🎬 FILM 4K VIP — Web Xem Phim 4K Đỉnh Cao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg: #07090e;
            --surface: #0e131f;
            --surface-hover: #161e31;
            --border: rgba(255, 255, 255, 0.08);
            --primary: #38bdf8;
            --primary-glow: rgba(56, 189, 248, 0.25);
            --accent: #10b981;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --danger: #ef4444;
            --gold: #f59e0b;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            background: var(--bg);
            color: var(--text-main);
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
        }}
        
        /* NAVBAR */
        .navbar {{
            position: sticky;
            top: 0;
            z-index: 100;
            background: rgba(7, 9, 14, 0.85);
            backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--border);
            padding: 14px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
        }}
        .brand {{
            display: flex;
            align-items: center;
            gap: 10px;
            text-decoration: none;
            color: var(--text-main);
            font-size: 20px;
            font-weight: 800;
            letter-spacing: -0.5px;
        }}
        .brand-logo {{
            background: linear-gradient(135deg, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}
        .nav-links {{
            display: flex;
            gap: 8px;
            align-items: center;
        }}
        .nav-link {{
            padding: 6px 14px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            color: var(--text-muted);
            text-decoration: none;
            transition: all 0.2s ease;
        }}
        .nav-link:hover, .nav-link.active {{
            color: #fff;
            background: var(--surface-hover);
        }}
        .nav-link.active {{
            color: var(--primary);
            background: rgba(56, 189, 248, 0.12);
        }}
        .search-form {{
            display: flex;
            align-items: center;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 4px 14px;
            width: 280px;
            transition: all 0.2s ease;
        }}
        .search-form:focus-within {{
            border-color: var(--primary);
            box-shadow: 0 0 12px var(--primary-glow);
        }}
        .search-input {{
            background: transparent;
            border: none;
            color: #fff;
            outline: none;
            font-size: 13px;
            width: 100%;
            padding: 6px 0;
            font-family: inherit;
        }}
        .search-input::placeholder {{ color: var(--text-muted); }}

        /* HERO BILLBOARD */
        .hero-billboard {{
            position: relative;
            min-height: 480px;
            background-size: cover;
            background-position: center 25%;
            display: flex;
            align-items: center;
            padding: 40px 48px;
            border-bottom: 1px solid var(--border);
        }}
        .hero-content {{
            max-width: 650px;
            display: flex;
            flex-direction: column;
            gap: 14px;
        }}
        .hero-badge-row {{
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }}
        .hero-title {{
            font-size: 40px;
            font-weight: 800;
            line-height: 1.15;
            letter-spacing: -1px;
            color: #ffffff;
            text-shadow: 0 2px 10px rgba(0,0,0,0.8);
        }}
        .hero-subtitle {{
            font-size: 18px;
            color: var(--primary);
            font-weight: 600;
        }}
        .hero-genres {{
            font-size: 14px;
            color: var(--text-muted);
            font-weight: 500;
        }}
        .hero-overview {{
            font-size: 14px;
            color: #cbd5e1;
            line-height: 1.6;
        }}
        .hero-actions {{
            display: flex;
            gap: 12px;
            margin-top: 10px;
        }}
        .btn-hero-play {{
            background: linear-gradient(135deg, #0284c7, #38bdf8);
            color: #fff;
            padding: 12px 24px;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 700;
            font-size: 14px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 18px rgba(56, 189, 248, 0.35);
            transition: all 0.2s ease;
        }}
        .btn-hero-play:hover {{
            transform: translateY(-2px);
            box-shadow: 0 6px 24px rgba(56, 189, 248, 0.5);
        }}
        .btn-hero-info {{
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            padding: 12px 20px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            font-family: inherit;
            transition: background 0.2s;
        }}
        .btn-hero-info:hover {{
            background: rgba(255, 255, 255, 0.18);
        }}

        /* MAIN CONTAINER */
        .container {{
            width: 100%;
            max-width: 1400px;
            margin: 0 auto;
            padding: 32px 24px;
            flex: 1;
        }}
        .section-header {{
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
        }}
        .section-title {{
            font-size: 22px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
        }}
        .section-count {{
            font-size: 14px;
            color: var(--text-muted);
            font-weight: 500;
        }}

        /* MOVIE GRID */
        .movie-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 20px;
        }}
        .movie-card {{
            background: var(--surface);
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid var(--border);
            cursor: pointer;
            display: flex;
            flex-direction: column;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }}
        .movie-card:hover {{
            transform: translateY(-6px) scale(1.02);
            border-color: rgba(56, 189, 248, 0.4);
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5), 0 0 15px var(--primary-glow);
        }}
        .poster-box {{
            position: relative;
            width: 100%;
            padding-top: 150%; /* 2:3 aspect ratio */
            overflow: hidden;
            background: #0f172a;
        }}
        .poster-box img {{
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.3s ease;
        }}
        .movie-card:hover .poster-box img {{
            transform: scale(1.06);
        }}
        .card-overlay {{
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.2s ease;
        }}
        .movie-card:hover .card-overlay {{
            opacity: 1;
        }}
        .btn-play-circle {{
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: var(--primary);
            color: #fff;
            border: none;
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 14px rgba(56, 189, 248, 0.6);
            transform: scale(0.85);
            transition: transform 0.2s ease;
        }}
        .movie-card:hover .btn-play-circle {{
            transform: scale(1);
        }}
        .card-badges-top {{
            position: absolute;
            top: 8px;
            left: 8px;
            display: flex;
            gap: 4px;
        }}
        .card-badges-bottom {{
            position: absolute;
            bottom: 8px;
            left: 8px;
        }}
        .card-info {{
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex: 1;
        }}
        .card-title {{
            font-size: 14px;
            font-weight: 700;
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }}
        .card-meta {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            color: var(--text-muted);
            gap: 6px;
        }}
        .card-year {{
            font-weight: 600;
        }}
        .card-en {{
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 110px;
        }}

        /* BADGES */
        .badge {{
            padding: 3px 7px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.3px;
            display: inline-flex;
            align-items: center;
        }}
        .badge-res {{ background: #0284c7; color: #fff; }}
        .badge-score {{ background: rgba(245, 158, 11, 0.9); color: #000; font-weight: 800; }}
        .badge-tv {{ background: #8b5cf6; color: #fff; }}
        .badge-movie {{ background: #10b981; color: #fff; }}
        .badge-hero {{ background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }}
        .badge-year {{ background: rgba(255, 255, 255, 0.15); color: #fff; }}

        /* CRAWLER BAR & FOOTER */
        .crawler-widget {{
            margin-top: 40px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 18px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 16px;
        }}
        .crawler-status-box {{
            display: flex;
            align-items: center;
            gap: 12px;
        }}
        .pulse-dot {{
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--accent);
            box-shadow: 0 0 10px var(--accent);
            animation: pulse 1.5s infinite;
        }}
        @keyframes pulse {{
            0% {{ transform: scale(0.95); opacity: 0.8; }}
            50% {{ transform: scale(1.2); opacity: 1; }}
            100% {{ transform: scale(0.95); opacity: 0.8; }}
        }}
        .crawler-title {{ font-size: 14px; font-weight: 700; color: #fff; }}
        .crawler-desc {{ font-size: 12px; color: var(--text-muted); }}
        .btn-trigger-crawl {{
            background: rgba(56, 189, 248, 0.12);
            color: var(--primary);
            border: 1px solid rgba(56, 189, 248, 0.3);
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            font-family: inherit;
            transition: all 0.2s;
        }}
        .btn-trigger-crawl:hover {{
            background: var(--primary);
            color: #000;
        }}
        footer {{
            text-align: center;
            padding: 30px;
            font-size: 13px;
            color: var(--text-muted);
            border-top: 1px solid var(--border);
            margin-top: 40px;
        }}

        @media (max-width: 768px) {{
            .hero-billboard {{ padding: 30px 20px; min-height: 380px; }}
            .hero-title {{ font-size: 28px; }}
            .movie-grid {{ grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; }}
            .search-form {{ width: 100%; }}
            .navbar {{ flex-wrap: wrap; }}
        }}
    </style>
</head>
<body>
    <nav class="navbar">
        <a href="/" class="brand">
            <span class="brand-logo">🎬 FILM 4K VIP</span>
        </a>
        <div class="nav-links">
            <a href="/" class="nav-link {'active' if current_type == 'all' else ''}">Tất cả</a>
            <a href="/?type=movie" class="nav-link {'active' if current_type == 'movie' else ''}">Phim Lẻ</a>
            <a href="/?type=tv" class="nav-link {'active' if current_type == 'tv' else ''}">Phim Bộ</a>
        </div>
        <form class="search-form" method="GET" action="/">
            <input type="text" name="search" class="search-input" placeholder="Tìm tên phim, diễn viên..." value="{search_query}">
            <button type="submit" style="background:none;border:none;color:var(--text-muted);cursor:pointer;">🔍</button>
        </form>
    </nav>

    {hero_html}

    <main class="container">
        <div class="section-header">
            <h2 class="section-title">
                <span>{'Tất cả phim' if current_type == 'all' else ('Phim lẻ tuyển chọn' if current_type == 'movie' else 'Phim bộ trọn bộ')}</span>
            </h2>
            <span class="section-count">Hiển thị {len(movies)} phim • Kho lưu trữ: {stats.get('total', 0)} phim</span>
        </div>

        <div class="movie-grid">
            {cards_content}
        </div>

        <div class="crawler-widget">
            <div class="crawler-status-box">
                <span class="pulse-dot"></span>
                <div>
                    <div class="crawler-title">Bộ cào tự động Film4k (Auto-Crawler)</div>
                    <div class="crawler-desc" id="crawlerStatus">{stats.get('status', 'Sẵn sàng')}</div>
                </div>
            </div>
            <button class="btn-trigger-crawl" onclick="triggerCrawl()">⚡ Cào thêm 20 phim mới</button>
        </div>
    </main>

    <footer>
        <p>Film4k VIP Hub • Phát trực tiếp TikTok CDN siêu tốc độ 300+ Mbps • Bóc tách tự động</p>
    </footer>

    <script>
        async function triggerCrawl() {{
            const btn = document.querySelector('.btn-trigger-crawl');
            const statusEl = document.getElementById('crawlerStatus');
            btn.disabled = true;
            btn.innerText = '⏳ Đang khởi động crawler...';
            try {{
                const res = await fetch('/api/crawler/run', {{ method: 'POST' }});
                const data = await res.json();
                statusEl.innerText = data.message || 'Crawler đã được kích hoạt!';
                btn.innerText = '✅ Đang chạy ngầm...';
                setTimeout(() => location.reload(), 4000);
            }} catch (e) {{
                alert('Lỗi khởi động crawler: ' + e.message);
                btn.disabled = false;
                btn.innerText = '⚡ Cào thêm phim';
            }}
        }}
    </script>
</body>
</html>"""
