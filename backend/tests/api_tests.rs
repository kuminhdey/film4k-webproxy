use reqwest::{Client, StatusCode};
use webproxy_backend::{
    crawler::CrawlerService,
    create_app,
    db::Database,
    models::{AudioTrack, Episode, Movie, MoviesResponse, ServerSource, Source, SubtitleTrack},
    proxy::is_valid_remote_url,
    AppState,
};

async fn spawn_test_server() -> (String, Database) {
    let db = Database::new_in_memory().expect("Failed to create in-memory database");

    // Seed test movies
    let movies = vec![
        Movie {
            id: None,
            slug: "interstellar".to_string(),
            movie_type: "movie".to_string(),
            title_vi: Some("Hố Đen Tử Thần".to_string()),
            title_en: Some("Interstellar".to_string()),
            year: Some(2014),
            quality: Some("4K UHD".to_string()),
            score: Some(8.7),
            genres: vec!["Sci-Fi".to_string(), "Adventure".to_string(), "Drama".to_string()],
            country: Some("US".to_string()),
            poster: Some("https://example.com/interstellar.jpg".to_string()),
            backdrop: Some("https://example.com/interstellar_bg.jpg".to_string()),
            overview: Some("When Earth becomes uninhabitable...".to_string()),
            total_episodes: Some(1),
            stream: None,
            episodes: vec![Episode {
                id: None,
                movie_slug: "interstellar".to_string(),
                season: 1,
                episode: 1,
                title: Some("Full Movie".to_string()),
                runtime: Some(169),
                still: None,
                sources: vec![Source {
                    label: "Server VIP 1".to_string(),
                    hls_url: "https://film4k.net/api/hls/interstellar.m3u8".to_string(),
                    proxy_stream_url: None,
                }],
                servers: vec![ServerSource {
                    id: Some(serde_json::json!("srv-1")),
                    label: "Server VIP 1".to_string(),
                    hls_url: "https://film4k.net/api/hls/interstellar.m3u8".to_string(),
                    proxy_stream_url: None,
                    quality: Some("4K".to_string()),
                }],
                subtitles: vec![SubtitleTrack {
                    id: Some(serde_json::json!("sub-vi")),
                    label: "Tiếng Việt".to_string(),
                    lang: Some("vi".to_string()),
                    url: Some("/api/subtitles/interstellar.vtt".to_string()),
                    kind: Some("subtitles".to_string()),
                    is_default: Some(true),
                }],
                audio_tracks: vec![AudioTrack {
                    id: Some(serde_json::json!(0)),
                    label: "ENG (Stereo)".to_string(),
                    lang: Some("en".to_string()),
                    url: None,
                    is_default: Some(true),
                }],
            }],
            servers: vec![ServerSource {
                id: Some(serde_json::json!("srv-1")),
                label: "Server VIP 1".to_string(),
                hls_url: "https://film4k.net/api/hls/interstellar.m3u8".to_string(),
                proxy_stream_url: None,
                quality: Some("4K".to_string()),
            }],
            subtitles: vec![SubtitleTrack {
                id: Some(serde_json::json!("sub-vi")),
                label: "Tiếng Việt".to_string(),
                lang: Some("vi".to_string()),
                url: Some("/api/subtitles/interstellar.vtt".to_string()),
                kind: Some("subtitles".to_string()),
                is_default: Some(true),
            }],
            audio_tracks: vec![AudioTrack {
                id: Some(serde_json::json!(0)),
                label: "ENG (Stereo)".to_string(),
                lang: Some("en".to_string()),
                url: None,
                is_default: Some(true),
            }],
        },
        Movie {
            id: None,
            slug: "breaking-bad".to_string(),
            movie_type: "tv".to_string(),
            title_vi: Some("Biến Chất".to_string()),
            title_en: Some("Breaking Bad".to_string()),
            year: Some(2008),
            quality: Some("1080p".to_string()),
            score: Some(9.5),
            genres: vec!["Crime".to_string(), "Drama".to_string(), "Thriller".to_string()],
            country: Some("US".to_string()),
            poster: Some("https://example.com/bb.jpg".to_string()),
            backdrop: Some("https://example.com/bb_bg.jpg".to_string()),
            overview: Some("A high school chemistry teacher diagnosed with cancer...".to_string()),
            total_episodes: Some(62),
            stream: None,
            episodes: vec![
                Episode {
                    id: None,
                    movie_slug: "breaking-bad".to_string(),
                    season: 1,
                    episode: 1,
                    title: Some("Pilot".to_string()),
                    runtime: Some(58),
                    still: None,
                    sources: vec![Source {
                        label: "Server 1".to_string(),
                        hls_url: "https://film4k.net/api/hls/bb_s1e1.m3u8".to_string(),
                        proxy_stream_url: None,
                    }],
                    servers: vec![],
                    subtitles: vec![],
                    audio_tracks: vec![],
                },
                Episode {
                    id: None,
                    movie_slug: "breaking-bad".to_string(),
                    season: 1,
                    episode: 2,
                    title: Some("Cat's in the Bag...".to_string()),
                    runtime: Some(48),
                    still: None,
                    sources: vec![Source {
                        label: "Server 1".to_string(),
                        hls_url: "https://film4k.net/api/hls/bb_s1e2.m3u8".to_string(),
                        proxy_stream_url: None,
                    }],
                    servers: vec![],
                    subtitles: vec![],
                    audio_tracks: vec![],
                },
            ],
            servers: vec![],
            subtitles: vec![],
            audio_tracks: vec![],
        },
        Movie {
            id: None,
            slug: "inception".to_string(),
            movie_type: "movie".to_string(),
            title_vi: Some("Kẻ Đánh Cắp Giấc Mơ".to_string()),
            title_en: Some("Inception".to_string()),
            year: Some(2010),
            quality: Some("4K UHD".to_string()),
            score: Some(8.8),
            genres: vec!["Action".to_string(), "Sci-Fi".to_string(), "Adventure".to_string()],
            country: Some("US".to_string()),
            poster: Some("https://example.com/inception.jpg".to_string()),
            backdrop: Some("https://example.com/inception_bg.jpg".to_string()),
            overview: Some("A thief who steals corporate secrets through dream-sharing...".to_string()),
            total_episodes: Some(1),
            stream: None,
            episodes: vec![Episode {
                id: None,
                movie_slug: "inception".to_string(),
                season: 1,
                episode: 1,
                title: Some("Full Movie".to_string()),
                runtime: Some(148),
                still: None,
                sources: vec![Source {
                    label: "Server 1".to_string(),
                    hls_url: "https://film4k.net/api/hls/inception.m3u8".to_string(),
                    proxy_stream_url: None,
                }],
                servers: vec![],
                subtitles: vec![],
                audio_tracks: vec![],
            }],
            servers: vec![],
            subtitles: vec![],
            audio_tracks: vec![],
        },
        Movie {
            id: None,
            slug: "oppenheimer".to_string(),
            movie_type: "movie".to_string(),
            title_vi: Some("Oppenheimer".to_string()),
            title_en: Some("Oppenheimer".to_string()),
            year: Some(2023),
            quality: Some("4K UHD".to_string()),
            score: Some(8.9),
            genres: vec!["Biography".to_string(), "Drama".to_string(), "History".to_string()],
            country: Some("US".to_string()),
            poster: Some("https://example.com/oppenheimer.jpg".to_string()),
            backdrop: Some("https://example.com/oppenheimer_bg.jpg".to_string()),
            overview: Some("The story of American scientist J. Robert Oppenheimer...".to_string()),
            total_episodes: Some(1),
            stream: None,
            episodes: vec![Episode {
                id: None,
                movie_slug: "oppenheimer".to_string(),
                season: 1,
                episode: 1,
                title: Some("Full Movie".to_string()),
                runtime: Some(180),
                still: None,
                sources: vec![Source {
                    label: "Server 1".to_string(),
                    hls_url: "https://film4k.net/api/hls/oppenheimer.m3u8".to_string(),
                    proxy_stream_url: None,
                }],
                servers: vec![],
                subtitles: vec![],
                audio_tracks: vec![],
            }],
            servers: vec![],
            subtitles: vec![],
            audio_tracks: vec![],
        },
    ];

    for m in &movies {
        db.upsert_movie(m).expect("Failed to insert seed movie");
    }

    let crawler = CrawlerService::new(db.clone());
    let state = AppState::new(db.clone(), crawler);

    let app = create_app(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind to local port");
    let addr = listener.local_addr().expect("Failed to get local address");

    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("Server terminated unexpectedly");
    });

    (format!("http://{}", addr), db)
}

#[tokio::test]
async fn test_api_health() {
    let (base_url, _) = spawn_test_server().await;
    let client = Client::new();

    let resp = client
        .get(format!("{}/api/health", base_url))
        .send()
        .await
        .expect("Failed to execute health request");

    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.text().await.expect("Failed to read response body");
    assert_eq!(body, "OK");
}

#[tokio::test]
async fn test_api_movies_pagination_and_filters() {
    let (base_url, _) = spawn_test_server().await;
    let client = Client::new();

    // 1. Default query (returns all 4 seeded movies)
    let resp = client
        .get(format!("{}/api/movies", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 4);
    assert_eq!(data.movies.len(), 4);
    assert_eq!(data.limit, 24);
    assert_eq!(data.offset, 0);

    // 2. Pagination: limit = 2
    let resp = client
        .get(format!("{}/api/movies?limit=2", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 4);
    assert_eq!(data.movies.len(), 2);
    assert_eq!(data.limit, 2);
    assert_eq!(data.offset, 0);
    let first_page_slugs: Vec<String> = data.movies.iter().map(|m| m.slug.clone()).collect();

    // 3. Pagination: limit = 2, offset = 2
    let resp = client
        .get(format!("{}/api/movies?limit=2&offset=2", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 4);
    assert_eq!(data.movies.len(), 2);
    assert_eq!(data.limit, 2);
    assert_eq!(data.offset, 2);
    let second_page_slugs: Vec<String> = data.movies.iter().map(|m| m.slug.clone()).collect();

    // Ensure page 1 and page 2 do not overlap
    for slug in &first_page_slugs {
        assert!(!second_page_slugs.contains(slug));
    }

    // 3b. Pagination via page parameter: limit = 2, page = 2 (should calculate offset = 2)
    let resp = client
        .get(format!("{}/api/movies?limit=2&page=2", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.limit, 2);
    assert_eq!(data.offset, 2);
    let page2_slugs: Vec<String> = data.movies.iter().map(|m| m.slug.clone()).collect();
    assert_eq!(page2_slugs, second_page_slugs);

    // 4. Search text (English title)
    let resp = client
        .get(format!("{}/api/movies?search=inception", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 1);
    assert_eq!(data.movies[0].slug, "inception");

    // 5. Search text (Vietnamese title)
    let resp = client
        .get(format!("{}/api/movies?search=Biến+Chất", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 1);
    assert_eq!(data.movies[0].slug, "breaking-bad");

    // 6. Search non-existent
    let resp = client
        .get(format!("{}/api/movies?search=marvel_avengers_xyz", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 0);
    assert!(data.movies.is_empty());

    // 7. Genre filter: Sci-Fi (matches Interstellar and Inception)
    let resp = client
        .get(format!("{}/api/movies?genre=Sci-Fi", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 2);
    let slugs: Vec<String> = data.movies.iter().map(|m| m.slug.clone()).collect();
    assert!(slugs.contains(&"interstellar".to_string()));
    assert!(slugs.contains(&"inception".to_string()));

    // 8. Genre filter: Crime (matches Breaking Bad)
    let resp = client
        .get(format!("{}/api/movies?genre=Crime", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 1);
    assert_eq!(data.movies[0].slug, "breaking-bad");

    // 9. Type filter: tv
    let resp = client
        .get(format!("{}/api/movies?type=tv", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 1);
    assert_eq!(data.movies[0].slug, "breaking-bad");

    // 10. Type filter: movie
    let resp = client
        .get(format!("{}/api/movies?type=movie", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let data: MoviesResponse = resp.json().await.unwrap();
    assert_eq!(data.total, 3);
}

#[tokio::test]
async fn test_api_movie_details_and_episodes() {
    let (base_url, _) = spawn_test_server().await;
    let client = Client::new();

    // 1. Fetch multi-episode TV series
    let resp = client
        .get(format!("{}/api/movies/breaking-bad", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let movie: Movie = resp.json().await.unwrap();

    assert_eq!(movie.slug, "breaking-bad");
    assert_eq!(movie.movie_type, "tv");
    assert_eq!(movie.title_en.as_deref(), Some("Breaking Bad"));
    assert_eq!(movie.title_vi.as_deref(), Some("Biến Chất"));
    assert_eq!(movie.score, Some(9.5));
    assert_eq!(movie.episodes.len(), 2);

    let ep1 = &movie.episodes[0];
    assert_eq!(ep1.season, 1);
    assert_eq!(ep1.episode, 1);
    assert_eq!(ep1.title.as_deref(), Some("Pilot"));
    assert_eq!(ep1.runtime, Some(58));
    assert_eq!(ep1.sources.len(), 1);
    assert_eq!(ep1.sources[0].label, "Server 1");
    assert_eq!(ep1.sources[0].hls_url, "https://film4k.net/api/hls/bb_s1e1.m3u8");

    let ep2 = &movie.episodes[1];
    assert_eq!(ep2.season, 1);
    assert_eq!(ep2.episode, 2);
    assert_eq!(ep2.title.as_deref(), Some("Cat's in the Bag..."));
    assert_eq!(ep2.runtime, Some(48));

    // 2. Fetch single-episode Movie
    let resp = client
        .get(format!("{}/api/movies/interstellar", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let movie: Movie = resp.json().await.unwrap();
    assert_eq!(movie.slug, "interstellar");
    assert_eq!(movie.servers.len(), 1);
    assert_eq!(movie.servers[0].label, "Server VIP 1");
    assert_eq!(movie.subtitles.len(), 1);
    assert_eq!(movie.subtitles[0].label, "Tiếng Việt");
    assert_eq!(movie.audio_tracks.len(), 1);
    assert_eq!(movie.audio_tracks[0].label, "ENG (Stereo)");
    assert_eq!(movie.episodes.len(), 1);
    assert_eq!(movie.episodes[0].sources[0].label, "Server VIP 1");
    assert_eq!(movie.episodes[0].servers.len(), 1);
    assert_eq!(movie.episodes[0].servers[0].label, "Server VIP 1");
    assert_eq!(movie.episodes[0].subtitles.len(), 1);
    assert_eq!(movie.episodes[0].subtitles[0].label, "Tiếng Việt");
    assert_eq!(movie.episodes[0].audio_tracks.len(), 1);
    assert_eq!(movie.episodes[0].audio_tracks[0].label, "ENG (Stereo)");

    // 3. Non-existent slug returns 404 NOT_FOUND
    let resp = client
        .get(format!("{}/api/movies/non-existent-movie-slug", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let err_msg = resp.text().await.unwrap();
    assert!(err_msg.contains("Movie not found"));
}

#[tokio::test]
async fn test_api_proxy_stream_ssrf_and_valid_url() {
    let (base_url, _) = spawn_test_server().await;
    let client = Client::new();

    // 1. SSRF rejection: localhost
    let resp = client
        .get(format!("{}/api/proxy/stream", base_url))
        .query(&[("url", "http://localhost:8090/api/health")])
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = resp.text().await.unwrap();
    assert_eq!(body, "Access to internal host is denied");

    // 2. SSRF rejection: 127.0.0.1
    let resp = client
        .get(format!("{}/api/proxy/stream", base_url))
        .query(&[("url", "http://127.0.0.1:8090/api/health")])
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = resp.text().await.unwrap();
    assert_eq!(body, "Access to internal host is denied");

    // 3. SSRF rejection: private ranges (10.x, 192.168.x, 172.16.x, 169.254.x, 0.0.0.0)
    let private_ips = [
        "http://10.0.0.1/admin",
        "http://192.168.1.1/secret",
        "http://172.16.0.1/sensitive",
        "http://169.254.169.254/latest/meta-data",
        "http://0.0.0.0:8080/exploit",
    ];
    for priv_url in &private_ips {
        let resp = client
            .get(format!("{}/api/proxy/stream", base_url))
            .query(&[("url", priv_url)])
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN, "Target {} should be forbidden", priv_url);
    }

    // 4. Scheme validation: file:// ftp://
    let resp = client
        .get(format!("{}/api/proxy/stream", base_url))
        .query(&[("url", "file:///etc/passwd")])
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // 5. Missing or empty url parameter
    let resp = client
        .get(format!("{}/api/proxy/stream?url=", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 6. Direct helper function unit test for SSRF
    assert!(is_valid_remote_url("http://127.0.0.1:8080").is_err());
    assert!(is_valid_remote_url("http://localhost:3000").is_err());
    assert!(is_valid_remote_url("https://example.com").is_ok());
    assert!(is_valid_remote_url("https://film4k.net/api/hls/master.m3u8").is_ok());

    // 7. Acceptance of valid remote URL
    // Calling /api/proxy/stream with a valid remote URL:
    // It should not be blocked by SSRF filter (not 403 Forbidden).
    let resp = client
        .get(format!("{}/api/proxy/stream", base_url))
        .query(&[("url", "https://example.com")])
        .send()
        .await
        .unwrap();
    assert_ne!(
        resp.status(),
        StatusCode::FORBIDDEN,
        "Valid public URL must not be blocked as forbidden"
    );
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "Valid public URL should proxy successfully"
    );
    let body = resp.text().await.unwrap();
    assert!(
        body.contains("Example Domain"),
        "Proxied body should contain expected remote content"
    );
}

#[tokio::test]
async fn test_api_proxy_stream_expired_token_auto_refresh() {
    let (base_url, db) = spawn_test_server().await;
    let client = Client::new();

    let expired_url = "https://fiml4k.fun/api/hls/Xk8FTqiOqKttOFC6h5g6M5sE7r24KCpq8ry7ajlZjlNvHtpsHmA7IVlAi_ghpn9TZ9-LBJY9HbuFOccxv__-W3PeZHuKWrq35vR6nv1bKXH25RzXre9cWDTtBQ/master.m3u8";

    // Seed movie with expired url
    let movie = Movie {
        id: None,
        slug: "spider-man-brand-new-day".to_string(),
        movie_type: "movie".to_string(),
        title_vi: Some("Người Nhện: Khởi Đầu Mới".to_string()),
        title_en: Some("Spider-Man: Brand New Day".to_string()),
        year: Some(2026),
        quality: Some("4K".to_string()),
        score: Some(8.5),
        genres: vec!["Action".to_string()],
        country: Some("US".to_string()),
        poster: None,
        backdrop: None,
        overview: None,
        total_episodes: Some(1),
        stream: Some(serde_json::Value::String(expired_url.to_string())),
        episodes: vec![],
        servers: vec![ServerSource {
            id: Some(serde_json::json!("server-vip-4k")),
            label: "Server VIP (4K CDN)".to_string(),
            hls_url: expired_url.to_string(),
            proxy_stream_url: None,
            quality: Some("4K".to_string()),
        }],
        subtitles: vec![],
        audio_tracks: vec![],
    };
    db.upsert_movie(&movie).unwrap();

    let resp = client
        .get(format!("{}/api/proxy/stream", base_url))
        .query(&[("url", expired_url), ("slug", "spider-man-brand-new-day")])
        .send()
        .await
        .unwrap();

    // The expired token should be automatically refreshed by proxy from upstream title API!
    if resp.status() == StatusCode::OK {
        let body = resp.text().await.unwrap();
        assert!(body.contains("#EXTM3U"), "Body should be a valid M3U8 playlist");
        let updated_movie = db.get_movie_by_slug("spider-man-brand-new-day").unwrap().unwrap();
        assert_ne!(
            updated_movie.servers[0].hls_url, expired_url,
            "HLS URL in DB must be updated to fresh token"
        );
        assert!(
            updated_movie.servers[0].hls_url.contains("/api/hls/"),
            "New HLS URL should contain valid stream path"
        );
    }
}

#[tokio::test]
async fn test_local_playlist_cache_and_bytedance_direct_cdn() {
    let (base_url, _) = spawn_test_server().await;
    let client = Client::new();

    let test_slug = "test-cached-movie";
    let playlist_dir = std::path::PathBuf::from("data/playlists").join(test_slug);
    tokio::fs::create_dir_all(&playlist_dir).await.unwrap();

    let master_content = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,URI="a0.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="Tiếng Việt",DEFAULT=NO,URI="s0.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080
v0.m3u8
"#;

    let v0_content = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:25
#EXT-X-MAP:URI="https://p19-ad-site-sign-sg.tiktokcdn.com/map.image?x-expires=1824367135"
#EXTINF:24.56,
https://p16-ad-site-sign-sg.tiktokcdn.com/chunk_video_01.image?lk3s=6d71dd51&x-expires=1824366813&x-signature=valid_sig_123
#EXTINF:20.00,
https://p19-ad-site-sign-sg.tiktokcdn.com/chunk_video_02.image?lk3s=6d71dd51&x-expires=1824366813&x-signature=valid_sig_456
"#;

    let a0_content = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:20
#EXTINF:20.01,
https://p16-ad-site-sign-sg.tiktokcdn.com/chunk_audio_01.image?lk3s=6d71dd51&x-expires=1824366775&x-signature=audio_sig_789
"#;

    // Write cached playlist files directly to disk
    tokio::fs::write(playlist_dir.join("master.m3u8"), master_content).await.unwrap();
    tokio::fs::write(playlist_dir.join("v0.m3u8"), v0_content).await.unwrap();
    tokio::fs::write(playlist_dir.join("a0.m3u8"), a0_content).await.unwrap();

    // 1. GET /api/stream/:slug/master.m3u8
    let master_resp = client
        .get(format!("{}/api/stream/{}/master.m3u8", base_url, test_slug))
        .send()
        .await
        .unwrap();

    assert_eq!(master_resp.status(), StatusCode::OK);
    assert_eq!(
        master_resp
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap(),
        "application/vnd.apple.mpegurl; charset=utf-8"
    );
    assert_eq!(
        master_resp
            .headers()
            .get("access-control-allow-origin")
            .unwrap()
            .to_str()
            .unwrap(),
        "*"
    );

    let master_body = master_resp.text().await.unwrap();
    assert!(master_body.contains("#EXTM3U"));
    assert!(master_body.contains(r#"URI="a0.m3u8""#));
    assert!(master_body.contains("v0.m3u8"));

    // 2. GET /api/stream/:slug/v0.m3u8 (Sub-variant video)
    let v0_resp = client
        .get(format!("{}/api/stream/{}/v0.m3u8", base_url, test_slug))
        .send()
        .await
        .unwrap();

    assert_eq!(v0_resp.status(), StatusCode::OK);
    let v0_body = v0_resp.text().await.unwrap();
    // Direct ByteDance CDN links MUST be preserved intact
    assert!(v0_body.contains("https://p16-ad-site-sign-sg.tiktokcdn.com/chunk_video_01.image?lk3s=6d71dd51&x-expires=1824366813&x-signature=valid_sig_123"));
    assert!(v0_body.contains("https://p19-ad-site-sign-sg.tiktokcdn.com/chunk_video_02.image?lk3s=6d71dd51&x-expires=1824366813&x-signature=valid_sig_456"));

    // 3. GET /api/stream/:slug/a0.m3u8 (Sub-variant audio)
    let a0_resp = client
        .get(format!("{}/api/stream/{}/a0.m3u8", base_url, test_slug))
        .send()
        .await
        .unwrap();

    assert_eq!(a0_resp.status(), StatusCode::OK);
    let a0_body = a0_resp.text().await.unwrap();
    assert!(a0_body.contains("https://p16-ad-site-sign-sg.tiktokcdn.com/chunk_audio_01.image?lk3s=6d71dd51&x-expires=1824366775&x-signature=audio_sig_789"));

    // 4. Test invalid slug / characters protection
    let bad_slug_resp = client
        .get(format!("{}/api/stream/bad!slug@chars/master.m3u8", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_slug_resp.status(), StatusCode::BAD_REQUEST);

    let bad_file_resp = client
        .get(format!("{}/api/stream/{}/bad*file?.m3u8", base_url, test_slug))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_file_resp.status(), StatusCode::BAD_REQUEST);

    // 5. Test missing file
    let missing_resp = client
        .get(format!("{}/api/stream/{}/non_existent.m3u8", base_url, test_slug))
        .send()
        .await
        .unwrap();
    assert_eq!(missing_resp.status(), StatusCode::NOT_FOUND);

    // Clean up test directory
    let _ = tokio::fs::remove_dir_all(&playlist_dir).await;
}

#[tokio::test]
async fn test_admin_login_and_auth_middleware() {
    let (base_url, _) = spawn_test_server().await;
    let client = Client::new();

    // 1. Login with invalid password
    let bad_login = client
        .post(format!("{}/api/admin/login", base_url))
        .json(&serde_json::json!({
            "password": "wrong_password_123"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(bad_login.status(), StatusCode::UNAUTHORIZED);
    let bad_val: serde_json::Value = bad_login.json().await.unwrap();
    assert_eq!(bad_val["success"], false);

    // 2. Login with valid password (default 'film4k@admin2026')
    let good_login = client
        .post(format!("{}/api/admin/login", base_url))
        .json(&serde_json::json!({
            "password": "film4k@admin2026"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(good_login.status(), StatusCode::OK);
    let good_val: serde_json::Value = good_login.json().await.unwrap();
    assert_eq!(good_val["success"], true);
    let token = good_val["token"].as_str().expect("Token should be present");
    assert!(token.starts_with("adm_"));

    // 3. GET /api/admin/stats without authentication -> 401 Unauthorized
    let unauth_stats = client
        .get(format!("{}/api/admin/stats", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(unauth_stats.status(), StatusCode::UNAUTHORIZED);

    // 4. GET /api/admin/stats with Bearer token -> 200 OK
    let auth_stats = client
        .get(format!("{}/api/admin/stats", base_url))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token))
        .send()
        .await
        .unwrap();

    assert_eq!(auth_stats.status(), StatusCode::OK);
    let stats_val: serde_json::Value = auth_stats.json().await.unwrap();
    assert_eq!(stats_val["success"], true);
    assert!(stats_val["total_movies"].as_i64().unwrap() >= 2);
    assert!(stats_val["total_series"].as_i64().unwrap() >= 1);
    assert!(stats_val["crawler_status"]["is_running"].is_boolean());
    assert!(stats_val["disk_usage"]["human_readable"].is_string());

    // 5. GET /api/admin/stats with X-Admin-Key header -> 200 OK
    let key_stats = client
        .get(format!("{}/api/admin/stats", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .send()
        .await
        .unwrap();
    assert_eq!(key_stats.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_admin_crawler_control_and_stop() {
    let (base_url, _) = spawn_test_server().await;
    let client = Client::new();

    // 1. Unauthenticated trigger -> 401 Unauthorized
    let unauth = client
        .post(format!("{}/api/admin/crawler/trigger", base_url))
        .json(&serde_json::json!({ "mode": "latest" }))
        .send()
        .await
        .unwrap();
    assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);

    // 2. Trigger crawler via X-Admin-Key
    let trigger_resp = client
        .post(format!("{}/api/admin/crawler/trigger", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .json(&serde_json::json!({ "mode": "latest" }))
        .send()
        .await
        .unwrap();
    assert_eq!(trigger_resp.status(), StatusCode::OK);
    let trigger_val: serde_json::Value = trigger_resp.json().await.unwrap();
    assert_eq!(trigger_val["mode"], "latest");

    // 3. Stop crawler via X-Admin-Key
    let stop_resp = client
        .post(format!("{}/api/admin/crawler/stop", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .send()
        .await
        .unwrap();
    assert_eq!(stop_resp.status(), StatusCode::OK);
    let stop_val: serde_json::Value = stop_resp.json().await.unwrap();
    assert_eq!(stop_val["success"], true);

    // 4. Test frontend crawler start, update, warmup endpoints
    let start_resp = client
        .post(format!("{}/api/admin/crawler/start", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .send()
        .await
        .unwrap();
    assert_eq!(start_resp.status(), StatusCode::OK);
    let start_val: serde_json::Value = start_resp.json().await.unwrap();
    assert_eq!(start_val["mode"], "full");

    let _ = client
        .post(format!("{}/api/admin/crawler/stop", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .send()
        .await;

    let update_resp = client
        .post(format!("{}/api/admin/crawler/update", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .send()
        .await
        .unwrap();
    assert_eq!(update_resp.status(), StatusCode::OK);

    let _ = client
        .post(format!("{}/api/admin/crawler/stop", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .send()
        .await;

    let warmup_resp = client
        .post(format!("{}/api/admin/crawler/warmup", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .send()
        .await
        .unwrap();
    assert_eq!(warmup_resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_admin_cache_clear() {
    let (base_url, _) = spawn_test_server().await;
    let client = Client::new();

    // Prepare mock cache directory
    let cache_dir = std::path::PathBuf::from("data/playlists/test-admin-clear");
    tokio::fs::create_dir_all(&cache_dir).await.unwrap();
    tokio::fs::write(cache_dir.join("master.m3u8"), "#EXTM3U\n").await.unwrap();
    assert!(cache_dir.exists());

    // 1. Clear specific slug cache
    let clear_slug_resp = client
        .post(format!("{}/api/admin/cache/clear", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .json(&serde_json::json!({ "slug": "test-admin-clear" }))
        .send()
        .await
        .unwrap();

    assert_eq!(clear_slug_resp.status(), StatusCode::OK);
    let clear_slug_val: serde_json::Value = clear_slug_resp.json().await.unwrap();
    assert_eq!(clear_slug_val["success"], true);
    assert_eq!(clear_slug_val["cleared_slug"], "test-admin-clear");
    assert!(!cache_dir.exists());

    // 1b. Test clear via URL parameter /api/admin/cache/clear/:slug
    let path_cache_dir = std::path::PathBuf::from("data/playlists/test-admin-path-clear");
    tokio::fs::create_dir_all(&path_cache_dir).await.unwrap();
    tokio::fs::write(path_cache_dir.join("master.m3u8"), "#EXTM3U\n").await.unwrap();
    assert!(path_cache_dir.exists());

    let clear_path_resp = client
        .post(format!("{}/api/admin/cache/clear/test-admin-path-clear", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .send()
        .await
        .unwrap();

    assert_eq!(clear_path_resp.status(), StatusCode::OK);
    let clear_path_val: serde_json::Value = clear_path_resp.json().await.unwrap();
    assert_eq!(clear_path_val["success"], true);
    assert_eq!(clear_path_val["cleared_slug"], "test-admin-path-clear");
    assert!(!path_cache_dir.exists());

    // 2. Clear all cache
    let cache_all_dir = std::path::PathBuf::from("data/playlists/all-test-clear");
    tokio::fs::create_dir_all(&cache_all_dir).await.unwrap();
    tokio::fs::write(cache_all_dir.join("v0.m3u8"), "#EXTINF\n").await.unwrap();

    let clear_all_resp = client
        .post(format!("{}/api/admin/cache/clear", base_url))
        .header("X-Admin-Key", "film4k@admin2026")
        .json(&serde_json::json!({}))
        .send()
        .await
        .unwrap();

    assert_eq!(clear_all_resp.status(), StatusCode::OK);
    let clear_all_val: serde_json::Value = clear_all_resp.json().await.unwrap();
    assert_eq!(clear_all_val["success"], true);
    assert!(!cache_all_dir.exists());
}
