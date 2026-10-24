import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Settings,
  Activity,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  RotateCcw,
  RotateCw,
  ArrowLeft,
  Home,
} from 'lucide-react';
import { Movie, Episode, Source } from '../types';
import { Film4kFragmentLoader, setStatsListener } from '../utils/hlsLoader';

interface WatchPageProps {
  slug: string;
  initialEpisode?: number;
  onNavigate: (path: string) => void;
}

export const WatchPage: React.FC<WatchPageProps> = ({ slug, initialEpisode, onNavigate }) => {
  const [movie, setMovie] = useState<Movie | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [currentSource, setCurrentSource] = useState<Source | null>(null);

  // Streaming Stats
  const [streamStats, setStreamStats] = useState({
    speedMbps: '---',
    mb: 0,
    sec: 0,
    isCdn: true,
  });

  // Player state
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(-1);
  const [qualities, setQualities] = useState<{ id: number; height: number; bitrate: number }[]>([]);
  const [activeQuality, setActiveQuality] = useState<number>(-1); // -1 = Auto
  const [showSettings, setShowSettings] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const osdTimerRef = useRef<number | null>(null);
  const [osd, setOsd] = useState<{
    icon: 'play' | 'pause' | 'mute' | 'unmute' | 'volume' | 'rewind' | 'forward' | 'fullscreen';
    text: string;
    percent?: number;
  } | null>(null);

  const triggerOsd = (
    icon: 'play' | 'pause' | 'mute' | 'unmute' | 'volume' | 'rewind' | 'forward' | 'fullscreen',
    text: string,
    percent?: number
  ) => {
    if (osdTimerRef.current) {
      window.clearTimeout(osdTimerRef.current);
    }
    setOsd({ icon, text, percent });
    osdTimerRef.current = window.setTimeout(() => {
      setOsd(null);
    }, 900);
  };

  const toggleFullscreen = () => {
    const container = playerContainerRef.current || videoRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if ((container as any).webkitRequestFullscreen) {
        (container as any).webkitRequestFullscreen();
      }
      triggerOsd('fullscreen', 'Toàn màn hình');
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((container as any).webkitExitFullscreen) {
        (container as any).webkitExitFullscreen();
      }
      triggerOsd('fullscreen', 'Thoát toàn màn hình');
    }
  };

  // Keyboard Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      switch (e.code) {
        case 'Space': {
          e.preventDefault();
          if (video.paused) {
            video.play().catch(() => {});
            triggerOsd('play', 'Phát');
          } else {
            video.pause();
            triggerOsd('pause', 'Tạm dừng');
          }
          break;
        }
        case 'KeyM': {
          e.preventDefault();
          video.muted = !video.muted;
          if (video.muted) {
            triggerOsd('mute', 'Đã tắt tiếng');
          } else {
            const volPct = Math.round(video.volume * 100);
            triggerOsd('unmute', `Âm lượng: ${volPct}%`, volPct);
          }
          break;
        }
        case 'KeyF': {
          e.preventDefault();
          toggleFullscreen();
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          triggerOsd('rewind', '-10 giây');
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const maxTime = video.duration || video.currentTime + 10;
          video.currentTime = Math.min(maxTime, video.currentTime + 10);
          triggerOsd('forward', '+10 giây');
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          video.muted = false;
          const newVol = Math.min(1, video.volume + 0.05);
          video.volume = newVol;
          const pct = Math.round(newVol * 100);
          triggerOsd('volume', `Âm lượng: ${pct}%`, pct);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const lowerVol = Math.max(0, video.volume - 0.05);
          video.volume = lowerVol;
          const lowerPct = Math.round(lowerVol * 100);
          if (lowerPct === 0) {
            video.muted = true;
            triggerOsd('mute', 'Đã tắt tiếng');
          } else {
            triggerOsd('volume', `Âm lượng: ${lowerPct}%`, lowerPct);
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (osdTimerRef.current) {
        window.clearTimeout(osdTimerRef.current);
      }
    };
  }, []);

  // Subscribe to CDN Stats
  useEffect(() => {
    setStatsListener((info) => {
      setStreamStats({
        speedMbps: `${info.speedMbps} Mbps`,
        mb: info.mb,
        sec: info.sec,
        isCdn: info.isCdn,
      });
    });
  }, []);

  // Fetch Movie Data
  useEffect(() => {
    setLoading(true);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    fetch(`/api/movies/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error('Không thể tải thông tin phim');
        return res.json();
      })
      .then((data: Movie) => {
        setMovie(data);
        setLoading(false);

        // Select initial episode
        if (data.episodes && data.episodes.length > 0) {
          const targetEp = initialEpisode
            ? data.episodes.find((e) => e.episode === initialEpisode) || data.episodes[0]
            : data.episodes[0];
          setCurrentEpisode(targetEp);
          if (targetEp.sources && targetEp.sources.length > 0) {
            setCurrentSource(targetEp.sources[0]);
          }
        } else if (data.stream) {
          let hls = '';
          if (typeof data.stream === 'string') {
            hls = data.stream;
          } else if (typeof data.stream === 'object' && (data.stream as any).hlsUrl) {
            hls = (data.stream as any).hlsUrl;
          }

          if (hls) {
            const singleSource: Source = {
              label: 'Server VIP (4K TikTok CDN)',
              hlsUrl: hls,
              proxyStreamUrl: `/api/proxy/stream?url=${encodeURIComponent(hls)}&keep_cdn=1`,
            };
            const virtualEp: Episode = {
              movieSlug: data.slug,
              season: 1,
              episode: 1,
              title: data.title_vi || data.title_en || 'Full Movie',
              sources: [singleSource],
            };
            setCurrentEpisode(virtualEp);
            setCurrentSource(singleSource);
          }
        }
      })
      .catch((err) => {
        console.error('Error fetching movie:', err);
        setError(err.message || 'Lỗi kết nối máy chủ');
        setLoading(false);
      });
  }, [slug, initialEpisode]);

  // Initialize HLS Player
  useEffect(() => {
    if (!currentSource || !videoRef.current) return;

    const video = videoRef.current;
    const streamUrl =
      currentSource.proxyStreamUrl ||
      `/api/proxy/stream?url=${encodeURIComponent(currentSource.hlsUrl)}&keep_cdn=1`;

    if (Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const hls = new Hls({
        fLoader: Film4kFragmentLoader as any,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
      });

      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        // Collect qualities
        if (data.levels && data.levels.length > 0) {
          const qList = data.levels.map((lvl, index) => ({
            id: index,
            height: lvl.height,
            bitrate: lvl.bitrate,
          }));
          setQualities(qList);
        }

        // Start playing
        video.play().catch(() => {
          console.log('Autoplay blocked, waiting for user interaction');
        });
      });

      // Audio Tracks handling (Dolby 5.1 / Stereo)
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        if (data.audioTracks && data.audioTracks.length > 0) {
          const tracks = data.audioTracks.map((tr) => ({
            id: tr.id,
            name: tr.name || tr.lang || `Track ${tr.id + 1}`,
          }));
          setAudioTracks(tracks);
          setActiveAudioTrack(hls.audioTrack);
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('Fatal network error, attempting recovery...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('Fatal media error, attempting recovery...');
              hls.recoverMediaError();
              break;
            default:
              console.error('Unrecoverable HLS error:', data);
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
      });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [currentSource]);

  const handleSelectEpisode = (ep: Episode) => {
    setCurrentEpisode(ep);
    if (ep.sources && ep.sources.length > 0) {
      setCurrentSource(ep.sources[0]);
    }
    // Update browser URL seamlessly without reload
    const newPath = ep.episode > 1 ? `/watch/${slug}/${ep.episode}` : `/watch/${slug}`;
    window.history.pushState({}, '', newPath);
  };

  const handleSelectAudio = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = id;
      setActiveAudioTrack(id);
      const trName = audioTracks.find((t) => t.id === id)?.name || `Track ${id + 1}`;
      triggerOsd('volume', `Âm thanh: ${trName}`);
    }
  };

  const handleSelectQuality = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = id;
      setActiveQuality(id);
      if (id === -1) {
        triggerOsd('play', 'Độ phân giải: Tự động (Auto)');
      } else {
        const lvl = qualities.find((q) => q.id === id);
        triggerOsd('play', `Độ phân giải: ${lvl ? `${lvl.height}p` : 'Tùy chỉnh'}`);
      }
    }
  };

  if (loading) {
    return (
      <div className="watch-loading" style={{ minHeight: '80vh' }}>
        <div className="wrap">
          <div className="watch-skeleton-player" />
          <div className="watch-skeleton-controls">
            <span />
            <span />
            <span />
          </div>
          <div style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '24px' }}>
            Đang khởi động cụm máy chủ phát phim 4K...
          </div>
        </div>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="wrap" style={{ padding: '60px 0', textAlign: 'center' }}>
        <div className="player-error" style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'left' }}>
          <h3 style={{ margin: 0, color: '#fff' }}>Không tìm thấy luồng phát</h3>
          <p className="player-error-text">
            Phim "{slug}" hiện đang được bảo trì hoặc chuyển đổi máy chủ phát CDN.
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button
              className="player-error-help"
              onClick={() => onNavigate(`/movie/${slug}`)}
              style={{ cursor: 'pointer', border: 'none' }}
            >
              ← Xem Chi Tiết
            </button>
            <button
              className="ghost-btn"
              onClick={() => onNavigate('/')}
              style={{ cursor: 'pointer', padding: '9px 16px', borderRadius: '999px' }}
            >
              Trang Chủ
            </button>
          </div>
        </div>
      </div>
    );
  }

  const displayTitle = movie.title_vi || movie.title_en || 'Xem phim';
  const year = movie.year || 2026;

  return (
    <div className="watch" style={{ minHeight: '85vh', paddingBottom: '40px' }}>
      <div className="watch-player">
        {/* Top Control Bar */}
        <div
          className="wrap"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 0',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          {/* Navigation Back Buttons */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onNavigate(`/movie/${movie.slug}`)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                fontSize: '13px',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              <ArrowLeft size={15} />
              <span>Chi tiết</span>
            </button>

            <button
              type="button"
              className="ghost-btn"
              onClick={() => onNavigate('/')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                fontSize: '13px',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              <Home size={15} />
              <span>Trang chủ</span>
            </button>
          </div>

          {/* Current Title & Episode */}
          <div style={{ fontWeight: 700, fontSize: '16px', color: '#fff', textAlign: 'center' }}>
            {displayTitle}{' '}
            {currentEpisode && currentEpisode.episode > 1 && (
              <span style={{ color: 'var(--accent-light, #ff5a66)', marginLeft: '6px' }}>
                — Tập {currentEpisode.episode}
              </span>
            )}
            <span style={{ color: 'var(--muted)', fontSize: '13px', marginLeft: '6px' }}>
              ({year})
            </span>
          </div>

          {/* Direct CDN Status Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: '#46d369',
              background: 'rgba(70, 211, 105, 0.1)',
              padding: '6px 12px',
              borderRadius: '999px',
              border: '1px solid rgba(70, 211, 105, 0.25)',
              fontWeight: 600,
            }}
          >
            <Activity size={13} />
            <span>TikTok CDN ({streamStats.speedMbps})</span>
          </div>
        </div>

        {/* Dedicated 16:9 Video Canvas Player */}
        <div
          ref={playerContainerRef}
          className="player"
          style={{
            position: 'relative',
            background: '#000',
            width: '100%',
            maxWidth: '1100px',
            margin: '0 auto',
            borderRadius: '16px',
            overflow: 'hidden',
            aspectRatio: '16 / 9',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
            border: '1px solid var(--border)',
          }}
        >
          <video
            ref={videoRef}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            playsInline
            controls
          />

          {/* On-Screen Display (OSD) feedback */}
          {osd && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'rgba(0, 0, 0, 0.78)',
                backdropFilter: 'blur(8px)',
                color: '#fff',
                padding: '14px 24px',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                zIndex: 40,
                pointerEvents: 'none',
              }}
            >
              {osd.icon === 'play' && <Play size={28} />}
              {osd.icon === 'pause' && <Pause size={28} />}
              {osd.icon === 'mute' && <VolumeX size={28} />}
              {osd.icon === 'unmute' && <Volume2 size={28} />}
              {osd.icon === 'volume' && <Volume2 size={28} />}
              {osd.icon === 'rewind' && <RotateCcw size={28} />}
              {osd.icon === 'forward' && <RotateCw size={28} />}
              {osd.icon === 'fullscreen' && <Maximize size={28} />}
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{osd.text}</span>
            </div>
          )}

          {/* Quick Settings Floating Gear Button */}
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'rgba(0,0,0,0.65)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              cursor: 'pointer',
              zIndex: 35,
            }}
            title="Cài đặt Âm thanh & Chất lượng"
          >
            <Settings size={18} />
          </button>

          {/* Settings Popup Panel */}
          {showSettings && (
            <div
              style={{
                position: 'absolute',
                top: '60px',
                right: '16px',
                background: 'rgba(17, 22, 34, 0.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '16px',
                width: '260px',
                zIndex: 50,
                boxShadow: '0 16px 36px rgba(0,0,0,0.8)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>Cài đặt phát</span>
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              {/* Quality selector */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>
                  Chất lượng hình ảnh
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <button
                    type="button"
                    className={`chip ${activeQuality === -1 ? 'on' : ''}`}
                    onClick={() => handleSelectQuality(-1)}
                    style={{ justifyContent: 'flex-start' }}
                  >
                    Tự động (Auto)
                  </button>
                  {qualities.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      className={`chip ${activeQuality === q.id ? 'on' : ''}`}
                      onClick={() => handleSelectQuality(q.id)}
                      style={{ justifyContent: 'flex-start' }}
                    >
                      {q.height}p ({Math.round(q.bitrate / 1000000)} Mbps)
                    </button>
                  ))}
                </div>
              </div>

              {/* Audio Track Selector */}
              {audioTracks.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>
                    Track âm thanh (Dolby)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {audioTracks.map((tr) => (
                      <button
                        key={tr.id}
                        type="button"
                        className={`chip ${activeAudioTrack === tr.id ? 'on' : ''}`}
                        onClick={() => handleSelectAudio(tr.id)}
                        style={{ justifyContent: 'flex-start' }}
                      >
                        {tr.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Server Selection Chips */}
        <div className="wrap" style={{ maxWidth: '1100px', margin: '14px auto 0' }}>
          <div className="servers" style={{ padding: 0 }}>
            {currentEpisode && currentEpisode.sources && currentEpisode.sources.length > 1 ? (
              currentEpisode.sources.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  className={`chip ${currentSource === src ? 'on' : ''}`}
                  onClick={() => setCurrentSource(src)}
                >
                  {src.label || `Server ${i + 1}`}
                </button>
              ))
            ) : (
              <>
                <button type="button" className="chip on">
                  Server VIP (4K TikTok CDN)
                </button>
                <button type="button" className="chip">
                  Server Dự Phòng
                </button>
              </>
            )}
          </div>
        </div>

        {/* TV Series Episode Grid (if multiple episodes) */}
        {movie.episodes && movie.episodes.length > 1 && (
          <div className="wrap" style={{ maxWidth: '1100px', margin: '24px auto 0' }}>
            <div className="eps-head" style={{ margin: '0 0 12px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', margin: 0 }}>
                  Danh sách tập phim ({movie.episodes.length})
                </h2>
                <span className="eps-current" style={{ color: 'var(--muted)', fontSize: '12px' }}>
                  Đang phát Tập {currentEpisode?.episode || 1}
                </span>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                gap: '8px',
              }}
            >
              {movie.episodes.map((ep) => {
                const isActive = currentEpisode?.episode === ep.episode;
                return (
                  <button
                    key={ep.episode}
                    type="button"
                    onClick={() => handleSelectEpisode(ep)}
                    className={`chip ${isActive ? 'on' : ''}`}
                    style={{
                      justifyContent: 'center',
                      padding: '10px 4px',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Tập {ep.episode}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Movie Info & Synopsis Section */}
        <div className="wrap info" style={{ maxWidth: '1100px', margin: '24px auto 0', paddingBottom: '40px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 6px', color: '#fff' }}>
            {displayTitle}{' '}
            <span style={{ color: 'var(--muted)', fontSize: '16px', fontWeight: 600 }}>({year})</span>
          </h1>

          <div className="title-meta" style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '8px 0 14px' }}>
            <span
              className="score"
              style={{
                background: 'var(--accent-gold-soft)',
                color: 'var(--accent-gold)',
                border: '1px solid #e8c48a59',
                borderRadius: '999px',
                padding: '3px 10px',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              ★ {movie.score ? movie.score.toFixed(1) : '8.5'}
            </span>

            <span
              className="res"
              style={{
                background: '#ffffff0f',
                color: '#b4bdd0',
                border: '1px solid #ffffff1a',
                borderRadius: '999px',
                padding: '3px 10px',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {movie.quality || '4K UHD'}
            </span>

            <span className="chip" style={{ fontSize: '12px', padding: '3px 10px' }}>
              Dolby Atmos 5.1
            </span>

            {movie.genres?.map((g) => (
              <span key={g} className="chip" style={{ fontSize: '12px', padding: '3px 10px' }}>
                {g}
              </span>
            ))}
          </div>

          <p className="ov" style={{ color: 'var(--muted-light)', fontSize: '14px', lineHeight: 1.7, maxWidth: '85ch' }}>
            {movie.overview ||
              'Bộ phim đang được phát sóng trực tuyến với chất lượng phân giải 4K sắc nét và tốc độ tải luồng cực nhanh.'}
          </p>
        </div>
      </div>
    </div>
  );
};
