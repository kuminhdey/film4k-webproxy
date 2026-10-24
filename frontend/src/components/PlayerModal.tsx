import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  X,
  Settings,
  Activity,
  Tv,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { Movie, Episode, Source } from '../types';
import { Film4kFragmentLoader, setStatsListener } from '../utils/hlsLoader';

interface PlayerModalProps {
  slug: string;
  onClose: () => void;
}

export const PlayerModal: React.FC<PlayerModalProps> = ({ slug, onClose }) => {
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
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
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
          const newVol = Math.min(1, Math.round((video.volume + 0.1) * 10) / 10);
          video.volume = newVol;
          triggerOsd('volume', `Âm lượng: ${Math.round(newVol * 100)}%`, Math.round(newVol * 100));
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const newVol = Math.max(0, Math.round((video.volume - 0.1) * 10) / 10);
          video.volume = newVol;
          if (newVol === 0) {
            video.muted = true;
            triggerOsd('mute', 'Đã tắt tiếng', 0);
          } else {
            triggerOsd('volume', `Âm lượng: ${Math.round(newVol * 100)}%`, Math.round(newVol * 100));
          }
          break;
        }
        case 'Escape': {
          if (!document.fullscreenElement) {
            onClose();
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
  }, [onClose]);

  // 1. Fetch movie details
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`/api/movies/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error('Không thể tải thông tin phim');
        return res.json();
      })
      .then((data: Movie) => {
        if (mounted) {
          setMovie(data);
          const firstEp = data.episodes && data.episodes.length > 0 ? data.episodes[0] : null;
          setCurrentEpisode(firstEp);
          if (firstEp && firstEp.sources && firstEp.sources.length > 0) {
            setCurrentSource(firstEp.sources[0]);
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [slug]);

  // 2. Setup stats listener
  useEffect(() => {
    setStatsListener((stats) => {
      setStreamStats({
        speedMbps: stats.speedMbps,
        mb: stats.mb,
        sec: stats.sec,
        isCdn: stats.isCdn,
      });
    });

    return () => {
      setStatsListener(null);
    };
  }, []);

  // 3. Initialize HLS Player when source changes
  useEffect(() => {
    if (!currentSource || !videoRef.current) return;

    const videoEl = videoRef.current;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const rawUrl = currentSource.hlsUrl;
    // Route master playlist through backend proxy
    const proxyStreamUrl = `/api/proxy/stream?url=${encodeURIComponent(rawUrl)}&keep_cdn=1`;

    if (Hls.isSupported()) {
      const hls = new Hls({
        fLoader: Film4kFragmentLoader as any,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
      });

      hlsRef.current = hls;
      hls.loadSource(proxyStreamUrl);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        videoEl.play().catch(() => {
          // Autoplay was prevented, wait for user click
        });

        // Parse quality levels
        const levels = data.levels.map((lvl, index) => ({
          id: index,
          height: lvl.height,
          bitrate: lvl.bitrate,
        }));
        setQualities(levels);
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        const tracks = data.audioTracks.map((tr) => ({
          id: tr.id,
          name: tr.name || tr.lang || `Track ${tr.id + 1}`,
        }));
        setAudioTracks(tracks);
        setActiveAudioTrack(hls.audioTrack);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[HLS] Network error, recovering...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[HLS] Media error, recovering...');
              hls.recoverMediaError();
              break;
            default:
              console.error('[HLS] Fatal error:', data);
              hls.destroy();
              break;
          }
        }
      });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari support
      videoEl.src = proxyStreamUrl;
      videoEl.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [currentSource]);

  // Switch Audio Track
  const handleSelectAudio = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = id;
      setActiveAudioTrack(id);
    }
  };

  // Switch Quality
  const handleSelectQuality = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = id;
      setActiveQuality(id);
    }
  };

  // Switch Episode
  const handleSelectEpisode = (ep: Episode) => {
    setCurrentEpisode(ep);
    if (ep.sources && ep.sources.length > 0) {
      setCurrentSource(ep.sources[0]);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0, 0, 0, 0.92)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 28px',
          background: 'rgba(18, 18, 24, 0.8)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="badge-4k">4K UHD</span>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>
            {movie?.title_vi || movie?.title_en || 'Xem Phim'}
          </h2>
          {currentEpisode && (
            <span
              style={{
                fontSize: '0.85rem',
                color: '#9494a8',
                background: 'rgba(255,255,255,0.08)',
                padding: '2px 8px',
                borderRadius: '4px',
              }}
            >
              Tập {currentEpisode.episode}
            </span>
          )}
        </div>

        {/* Live Stream Telemetry */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.8rem',
              color: '#4ade80',
              background: 'rgba(74, 222, 128, 0.1)',
              padding: '4px 10px',
              borderRadius: '20px',
              border: '1px solid rgba(74, 222, 128, 0.2)',
            }}
          >
            <Activity size={14} />
            <span>
              {streamStats.speedMbps} Mbps • {streamStats.isCdn ? 'TikTok CDN' : 'VPS Proxy'}
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main Player Area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Video Canvas */}
        <div
          ref={playerContainerRef}
          className="video-container"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative',
            background: '#000',
            overflow: 'hidden',
          }}
        >
          {loading && <div style={{ color: '#fff' }}>Đang nạp dữ liệu phim...</div>}
          {error && <div style={{ color: '#ff4d58' }}>Lỗi: {error}</div>}

          <video
            ref={videoRef}
            controls
            playsInline
            style={{
              width: '100%',
              height: '100%',
              maxHeight: 'calc(100vh - 120px)',
              objectFit: 'contain',
              background: '#000',
            }}
          />

          {/* On-Screen Display (OSD) Feedback */}
          {osd && (
            <div
              className="player-osd"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 30,
                background: 'rgba(0, 0, 0, 0.85)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '16px',
                padding: '18px 24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                color: '#fff',
                boxShadow: '0 12px 36px rgba(0, 0, 0, 0.8)',
                minWidth: '130px',
              }}
            >
              {osd.icon === 'play' && <Play size={34} fill="#fff" />}
              {osd.icon === 'pause' && <Pause size={34} fill="#fff" />}
              {osd.icon === 'mute' && <VolumeX size={34} color="#ff4d58" />}
              {osd.icon === 'unmute' && <Volume2 size={34} color="#4ade80" />}
              {osd.icon === 'volume' && <Volume2 size={34} color="#fff" />}
              {osd.icon === 'rewind' && <RotateCcw size={34} color="#fff" />}
              {osd.icon === 'forward' && <RotateCw size={34} color="#fff" />}
              {osd.icon === 'fullscreen' && <Maximize size={34} color="#fff" />}
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{osd.text}</span>
              {typeof osd.percent === 'number' && (
                <div
                  style={{
                    width: '100px',
                    height: '4px',
                    background: 'rgba(255,255,255,0.2)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                    marginTop: '2px',
                  }}
                >
                  <div
                    style={{
                      width: `${osd.percent}%`,
                      height: '100%',
                      background: '#e50914',
                      borderRadius: '2px',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Keyboard Shortcut Hints */}
          <div
            className="shortcut-hints"
            style={{
              position: 'absolute',
              bottom: '50px',
              left: '24px',
              zIndex: 10,
              background: 'rgba(10, 10, 14, 0.7)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '20px',
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '0.75rem',
              color: '#a0a0b8',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <kbd style={{ background: 'rgba(255,255,255,0.15)', padding: '1px 5px', borderRadius: '3px', color: '#fff', fontSize: '0.7rem' }}>Space</kbd> Phát/Dừng
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <kbd style={{ background: 'rgba(255,255,255,0.15)', padding: '1px 5px', borderRadius: '3px', color: '#fff', fontSize: '0.7rem' }}>M</kbd> Tắt tiếng
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <kbd style={{ background: 'rgba(255,255,255,0.15)', padding: '1px 5px', borderRadius: '3px', color: '#fff', fontSize: '0.7rem' }}>F</kbd> Toàn màn hình
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <kbd style={{ background: 'rgba(255,255,255,0.15)', padding: '1px 5px', borderRadius: '3px', color: '#fff', fontSize: '0.7rem' }}>← / →</kbd> Tua 10s
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <kbd style={{ background: 'rgba(255,255,255,0.15)', padding: '1px 5px', borderRadius: '3px', color: '#fff', fontSize: '0.7rem' }}>↑ / ↓</kbd> Âm lượng
            </span>
          </div>

          {/* Quick Audio / Quality selector controls bar */}
          <div
            style={{
              position: 'absolute',
              bottom: '50px',
              right: '24px',
              zIndex: 10,
              display: 'flex',
              gap: '8px',
            }}
          >
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backdropFilter: 'blur(8px)',
              }}
            >
              <Settings size={14} />
              Luồng & Âm thanh
            </button>
          </div>

          {/* Settings Popup */}
          {showSettings && (
            <div
              className="glass-panel"
              style={{
                position: 'absolute',
                bottom: '95px',
                right: '24px',
                borderRadius: '12px',
                padding: '16px',
                width: '260px',
                zIndex: 20,
              }}
            >
              {/* Quality Selector */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '0.75rem', color: '#9494a8', fontWeight: 700, marginBottom: '6px' }}>
                  CHẤT LƯỢNG HÌNH ẢNH
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <button
                    onClick={() => handleSelectQuality(-1)}
                    style={{
                      background: activeQuality === -1 ? '#e50914' : 'rgba(255,255,255,0.06)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    Tự động (Auto)
                  </button>
                  {qualities.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => handleSelectQuality(q.id)}
                      style={{
                        background: activeQuality === q.id ? '#e50914' : 'rgba(255,255,255,0.06)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {q.height}p ({Math.round(q.bitrate / 1000000)} Mbps)
                    </button>
                  ))}
                </div>
              </div>

              {/* Audio Selector */}
              {audioTracks.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9494a8', fontWeight: 700, marginBottom: '6px' }}>
                    TRACK ÂM THANH
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {audioTracks.map((tr) => (
                      <button
                        key={tr.id}
                        onClick={() => handleSelectAudio(tr.id)}
                        style={{
                          background: activeAudioTrack === tr.id ? '#e50914' : 'rgba(255,255,255,0.06)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
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

        {/* Episode list panel for TV Series */}
        {movie && movie.episodes && movie.episodes.length > 1 && (
          <div
            style={{
              width: '320px',
              background: '#0d0d12',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              flexDirection: 'column',
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Tv size={18} color="#e50914" />
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
                Danh sách tập ({movie.episodes.length})
              </h3>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                alignContent: 'start',
              }}
            >
              {movie.episodes.map((ep) => {
                const isActive = currentEpisode?.episode === ep.episode;
                return (
                  <button
                    key={ep.episode}
                    onClick={() => handleSelectEpisode(ep)}
                    style={{
                      background: isActive ? 'linear-gradient(135deg, #e50914, #b20710)' : 'rgba(255,255,255,0.06)',
                      color: '#fff',
                      border: isActive ? '1px solid #ff4d58' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      padding: '10px 4px',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    Tập {ep.episode}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
