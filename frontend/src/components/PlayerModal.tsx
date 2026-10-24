import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  ArrowLeft,
} from 'lucide-react';
import { Movie, Episode, Source } from '../types';
import { Film4kFragmentLoader, setStatsListener } from '../utils/hlsLoader';
import { getQualityDisplayInfo, sortQualitiesDescending, QualityLevel } from '../utils/quality';

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
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [activeQuality, setActiveQuality] = useState<number>(-1); // -1 = Auto
  const [showSettings, setShowSettings] = useState(false);

  const sortedQualities = useMemo(() => {
    return sortQualitiesDescending(qualities);
  }, [qualities]);

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

    let rawUrl = currentSource.hlsUrl;
    if (!rawUrl.includes('.m3u8')) {
      rawUrl = rawUrl.endsWith('/') ? `${rawUrl}master.m3u8` : `${rawUrl}/master.m3u8`;
    }
    // Route master playlist through backend proxy with keep_cdn=1
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
        videoEl.play().catch(() => {});

        // Parse quality levels
        const levels: QualityLevel[] = data.levels.map((lvl, index) => ({
          id: index,
          height: lvl.height,
          width: lvl.width,
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
    <div className="cinema-modal">
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          background: 'var(--panel, #111622)',
          borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          zIndex: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            type="button"
            className="ghost"
            onClick={onClose}
            aria-label="Quay lại"
            style={{
              padding: '6px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: 'var(--radius-md, 12px)',
              cursor: 'pointer',
            }}
          >
            <ArrowLeft size={16} />
            <span style={{ fontSize: '13px', fontWeight: 600 }}>Quay lại</span>
          </button>

          <span className="card-res" style={{ position: 'static' }}>
            4K UHD
          </span>

          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--fg-bright, #fff)' }}>
            {movie?.title_vi || movie?.title_en || 'Xem Phim'}
          </h2>

          {currentEpisode && (
            <span
              className="chip"
              style={{
                fontSize: '12px',
                padding: '3px 8px',
                pointerEvents: 'none',
              }}
            >
              Tập {currentEpisode.episode}
            </span>
          )}
        </div>

        {/* Live Stream Telemetry & Close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12.5px',
              color: '#4ade80',
              background: 'rgba(74, 222, 128, 0.1)',
              padding: '4px 12px',
              borderRadius: '9999px',
              border: '1px solid rgba(74, 222, 128, 0.25)',
              fontWeight: 600,
            }}
          >
            <Activity size={14} />
            <span>
              {streamStats.speedMbps} Mbps • {streamStats.isCdn ? 'CDN Tốc độ cao' : 'Máy chủ Proxy'}
            </span>
          </div>

          <button
            type="button"
            className="ghost"
            onClick={onClose}
            style={{
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Main Player Area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Video Canvas */}
        <div
          ref={playerContainerRef}
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
          {loading && (
            <div style={{ color: 'var(--fg, #fff)', fontSize: '15px' }}>
              Đang kết nối luồng phát 4K tốc độ cao...
            </div>
          )}
          {error && (
            <div className="player-error">
              <p className="player-error-text">Lỗi: {error}</p>
            </div>
          )}

          <video
            ref={videoRef}
            controls
            playsInline
            style={{
              width: '100%',
              height: '100%',
              maxHeight: 'calc(100vh - 130px)',
              objectFit: 'contain',
              background: '#000',
            }}
          />

          {/* On-Screen Display (OSD) */}
          {osd && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 30,
                background: 'rgba(7, 9, 15, 0.88)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
                borderRadius: '16px',
                padding: '18px 24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                color: '#fff',
                boxShadow: 'var(--shadow-lg, 0 20px 40px rgba(0,0,0,0.8))',
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
                      background: 'var(--accent, #e11d2e)',
                      borderRadius: '2px',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Keyboard Shortcut Hints */}
          <div
            style={{
              position: 'absolute',
              bottom: '50px',
              left: '24px',
              zIndex: 10,
              background: 'rgba(11, 14, 22, 0.8)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
              borderRadius: '9999px',
              padding: '6px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '12px',
              color: 'var(--muted, #8b95ad)',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          >
            <span>
              <kbd style={{ background: '#242b3c', padding: '1px 6px', borderRadius: '4px', color: '#fff' }}>Space</kbd> Phát/Dừng
            </span>
            <span>
              <kbd style={{ background: '#242b3c', padding: '1px 6px', borderRadius: '4px', color: '#fff' }}>M</kbd> Tắt tiếng
            </span>
            <span>
              <kbd style={{ background: '#242b3c', padding: '1px 6px', borderRadius: '4px', color: '#fff' }}>F</kbd> Toàn màn hình
            </span>
            <span>
              <kbd style={{ background: '#242b3c', padding: '1px 6px', borderRadius: '4px', color: '#fff' }}>← / →</kbd> Tua 10s
            </span>
            <span>
              <kbd style={{ background: '#242b3c', padding: '1px 6px', borderRadius: '4px', color: '#fff' }}>↑ / ↓</kbd> Âm lượng
            </span>
          </div>

          {/* Quick Quality / Audio Settings Button */}
          <div
            style={{
              position: 'absolute',
              bottom: '50px',
              right: '24px',
              zIndex: 10,
            }}
          >
            <button
              type="button"
              className="ghost"
              onClick={() => setShowSettings(!showSettings)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: 'var(--radius-md, 12px)',
                cursor: 'pointer',
              }}
            >
              <Settings size={15} />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Cài đặt luồng</span>
            </button>
          </div>

          {/* Settings Popup */}
          {showSettings && (
            <div
              style={{
                position: 'absolute',
                bottom: '95px',
                right: '24px',
                borderRadius: 'var(--radius-lg, 16px)',
                padding: '16px',
                width: '280px',
                zIndex: 20,
                background: 'var(--panel, #111622)',
                border: '1px solid var(--border, #242b3c)',
                boxShadow: 'var(--shadow-lg, 0 20px 48px rgba(0,0,0,0.8))',
              }}
            >
              {/* Server selector */}
              {currentEpisode && currentEpisode.sources && currentEpisode.sources.length > 1 && (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--muted, #8b95ad)', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>
                    Chọn máy chủ phát
                  </div>
                  <div className="servers" style={{ padding: 0 }}>
                    {currentEpisode.sources.map((src, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`chip ${currentSource === src ? 'on' : ''}`}
                        onClick={() => setCurrentSource(src)}
                      >
                        {src.label || `Server ${i + 1}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quality Selector */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted, #8b95ad)', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>
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
                  {sortedQualities.map((q) => {
                    const info = getQualityDisplayInfo(q.height, q.width);
                    return (
                      <button
                        key={q.id}
                        type="button"
                        className={`chip ${activeQuality === q.id ? 'on' : ''}`}
                        onClick={() => handleSelectQuality(q.id)}
                        style={{ justifyContent: 'flex-start' }}
                      >
                        {info.label} [{info.badge}]{q.bitrate ? ` (${(q.bitrate / 1000000).toFixed(1)} Mbps)` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Audio Selector */}
              {audioTracks.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--muted, #8b95ad)', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>
                    Track âm thanh
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

        {/* Episode list panel for TV Series */}
        {movie && movie.episodes && movie.episodes.length > 1 && (
          <div
            style={{
              width: '320px',
              background: 'var(--panel, #111622)',
              borderLeft: '1px solid var(--border, #242b3c)',
              display: 'flex',
              flexDirection: 'column',
              padding: '18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <Tv size={18} color="var(--accent, #e11d2e)" />
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#fff', margin: 0 }}>
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
                    type="button"
                    onClick={() => handleSelectEpisode(ep)}
                    className={`chip ${isActive ? 'on' : ''}`}
                    style={{
                      justifyContent: 'center',
                      padding: '10px 4px',
                      fontSize: '13px',
                      fontWeight: 700,
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
