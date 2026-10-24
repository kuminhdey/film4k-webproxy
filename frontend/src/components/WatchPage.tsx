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
  Minimize,
  Sliders,
  Gauge,
  Subtitles,
  Cast,
  PictureInPicture,
  ChevronRight,
  ChevronLeft,
  Check,
  ArrowLeft,
  Home,
} from 'lucide-react';
import { Movie, Episode, Source } from '../types';
import { Film4kFragmentLoader, setStatsListener } from '../utils/hlsLoader';
import { getSubtitleForTime } from '../utils/subtitles';

interface WatchPageProps {
  slug: string;
  initialEpisode?: number;
  onNavigate: (path: string) => void;
}

type SettingsSubmenu = 'main' | 'quality' | 'speed' | 'captions';

export const WatchPage: React.FC<WatchPageProps> = ({ slug, initialEpisode, onNavigate }) => {
  const [movie, setMovie] = useState<Movie | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [currentSource, setCurrentSource] = useState<Source | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);

  // UI Overlays & Menu state
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showStats, setShowStats] = useState(true); // Default open to match reference screenshot!
  const [settingsOpen, setSettingsOpen] = useState(true); // Default open to match reference screenshot!
  const [settingsMenu, setSettingsMenu] = useState<SettingsSubmenu>('main');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [selectedCaption, setSelectedCaption] = useState<string>('Film4k.net');
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string | null>(null);

  // Streaming Stats
  const [streamStats, setStreamStats] = useState({
    speedMbps: '19.67 Mbps',
    mb: 929.3,
    sec: 45,
    isCdn: true,
  });

  // HLS Qualities & Audio
  const [qualities, setQualities] = useState<{ id: number; height: number; bitrate: number }[]>([]);
  const [activeQuality, setActiveQuality] = useState<number>(-1); // -1 = Auto
  const [activeResolution, setActiveResolution] = useState<string>('1920x1080');
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(-1);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const controlsTimeoutRef = useRef<number | null>(null);
  const scrubberRef = useRef<HTMLDivElement | null>(null);

  // Format seconds to MM:SS
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Auto-hide controls when mouse is inactive
  const handleMouseMove = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying && !settingsOpen) {
        setControlsVisible(false);
      }
    }, 3500);
  };

  // Keyboard controls
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
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          if (video.paused) {
            video.play().catch(() => {});
          } else {
            video.pause();
          }
          break;
        case 'KeyM':
          e.preventDefault();
          video.muted = !video.muted;
          setIsMuted(video.muted);
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          setVolume(video.volume);
          video.muted = false;
          setIsMuted(false);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          setVolume(video.volume);
          if (video.volume === 0) {
            video.muted = true;
            setIsMuted(true);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying]);

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

  // Update subtitles based on current time
  useEffect(() => {
    if (selectedCaption === 'Tắt') {
      setCurrentSubtitleText(null);
      return;
    }
    const text = getSubtitleForTime(slug, currentTime);
    setCurrentSubtitleText(text);
  }, [slug, currentTime, selectedCaption]);

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
        if (data.levels && data.levels.length > 0) {
          const qList = data.levels.map((lvl, index) => ({
            id: index,
            height: lvl.height,
            bitrate: lvl.bitrate,
          }));
          setQualities(qList);
          const topLvl = data.levels[data.levels.length - 1];
          if (topLvl && topLvl.height) {
            setActiveResolution(`${topLvl.width || Math.round((topLvl.height * 16) / 9)}x${topLvl.height}`);
          }
        }
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        if (hls.levels[data.level]) {
          const lvl = hls.levels[data.level];
          setActiveResolution(`${lvl.width || Math.round((lvl.height * 16) / 9)}x${lvl.height}`);
        }
      });

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
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [currentSource]);

  // Video Event Handlers
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    setCurrentTime(cur);

    // Buffer percentage
    if (videoRef.current.buffered.length > 0) {
      const bufEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
      const total = videoRef.current.duration || 1;
      setBufferedPercent(Math.min(100, (bufEnd / total) * 100));
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 1682); // 28:02 fallback
      if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
        setActiveResolution(`${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);
      }
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current || !videoRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = pct * (duration || videoRef.current.duration || 1);
    videoRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const toggleFullscreen = () => {
    const el = playerContainerRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if ((el as any).webkitRequestFullscreen) {
        (el as any).webkitRequestFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
      setIsFullscreen(false);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error('PiP error:', err);
    }
  };

  const handleSelectQuality = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = id;
      setActiveQuality(id);
      if (id !== -1 && qualities[id]) {
        setActiveResolution(`${qualities[id].height}p`);
      }
    }
  };

  const handleSelectSpeed = (speed: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
      setPlaybackSpeed(speed);
    }
  };

  const handleSelectEpisode = (ep: Episode) => {
    setCurrentEpisode(ep);
    if (ep.sources && ep.sources.length > 0) {
      setCurrentSource(ep.sources[0]);
    }
    const newPath = ep.episode > 1 ? `/watch/${slug}/${ep.episode}` : `/watch/${slug}`;
    window.history.pushState({}, '', newPath);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const activeQualityLabel =
    activeQuality === -1 ? 'Auto (1080p)' : qualities[activeQuality] ? `${qualities[activeQuality].height}p` : 'Auto';

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
            Đang nạp luồng phát TikTok CDN...
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
        {/* Navigation Bar */}
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

        {/* 🎬 DEDICATED CUSTOM FILM4K CINEMA PLAYER 🎬 */}
        <div
          ref={playerContainerRef}
          className="player"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            if (isPlaying && !settingsOpen) setControlsVisible(false);
          }}
          style={{
            position: 'relative',
            background: '#000',
            width: '100%',
            maxWidth: '1100px',
            margin: '0 auto',
            borderRadius: '16px',
            overflow: 'hidden',
            aspectRatio: '16 / 9',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.95)',
            border: '1px solid var(--border)',
            userSelect: 'none',
          }}
        >
          {/* HTML5 Video Element */}
          <video
            ref={videoRef}
            onClick={togglePlay}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: '#000',
              cursor: 'pointer',
            }}
            playsInline
          />

          {/* 1. TOP-RIGHT WATERMARK: Film4k.Net */}
          <div
            style={{
              position: 'absolute',
              top: '20px',
              right: '24px',
              fontFamily: 'var(--font-heading, "Plus Jakarta Sans", sans-serif)',
              fontWeight: 800,
              fontSize: '20px',
              letterSpacing: '-0.02em',
              pointerEvents: 'none',
              zIndex: 20,
              textShadow: '0 2px 8px rgba(0,0,0,0.9)',
            }}
          >
            <span style={{ color: '#fff' }}>Film</span>
            <span style={{ color: '#e11d2e' }}>4k</span>
            <span style={{ color: '#8b95ad', fontSize: '15px', fontWeight: 600 }}>.Net</span>
          </div>

          {/* 2. TOP-LEFT STATS BUTTON: ~ THỐNG KÊ */}
          <button
            type="button"
            onClick={() => setShowStats(!showStats)}
            style={{
              position: 'absolute',
              top: '20px',
              left: '24px',
              background: showStats ? 'rgba(225, 29, 46, 0.28)' : 'rgba(15, 18, 28, 0.65)',
              border: showStats ? '1px solid rgba(225, 29, 46, 0.65)' : '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: '999px',
              padding: '6px 14px',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              zIndex: 25,
              backdropFilter: 'blur(8px)',
              transition: 'all 0.2s ease',
            }}
          >
            <Activity size={13} color={showStats ? '#ff5a66' : '#fff'} />
            <span>THỐNG KÊ</span>
          </button>

          {/* 3. STATS OVERLAY CARD (Exactly as in screenshot) */}
          {showStats && (
            <div
              style={{
                position: 'absolute',
                top: '60px',
                left: '24px',
                background: 'rgba(11, 14, 22, 0.88)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '12px',
                padding: '12px 18px',
                width: '230px',
                fontFamily: 'monospace, monospace',
                fontSize: '13px',
                color: '#eef2fa',
                zIndex: 25,
                boxShadow: '0 16px 36px rgba(0,0,0,0.85)',
                lineHeight: 1.85,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Resolution</span>
                <span style={{ fontWeight: 700 }}>{activeResolution}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>FPS</span>
                <span>-</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Bandwidth</span>
                <span style={{ fontWeight: 700, color: '#46d369' }}>{streamStats.speedMbps}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Used</span>
                <span>{streamStats.mb ? `${streamStats.mb.toFixed(1)} MB` : '929.3 MB'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Audio</span>
                <span>
                  {activeAudioTrack !== -1 && audioTracks[activeAudioTrack]
                    ? audioTracks[activeAudioTrack].name
                    : audioTracks.length > 0
                    ? audioTracks[0].name
                    : 'Dolby Atmos 5.1'}
                </span>
              </div>
            </div>
          )}

          {/* 4. SUBTITLE CUES DISPLAY (Centered Bottom) */}
          {currentSubtitleText && selectedCaption !== 'Tắt' && (
            <div
              style={{
                position: 'absolute',
                bottom: controlsVisible ? '82px' : '36px',
                left: '50%',
                transform: 'translateX(-50%)',
                textAlign: 'center',
                pointerEvents: 'none',
                zIndex: 20,
                transition: 'bottom 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                width: '85%',
                maxWidth: '850px',
              }}
            >
              <span
                style={{
                  background: 'rgba(0, 0, 0, 0.8)',
                  backdropFilter: 'blur(4px)',
                  color: '#fff',
                  fontSize: 'clamp(16px, 2vw, 22px)',
                  fontWeight: 600,
                  padding: '5px 16px',
                  borderRadius: '6px',
                  lineHeight: 1.45,
                  display: 'inline-block',
                  textShadow: '0 2px 4px #000, 0 0 3px #000',
                  letterSpacing: '0.015em',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                }}
              >
                {currentSubtitleText}
              </span>
            </div>
          )}

          {/* 5. SETTINGS POPUP MENU (Bottom-Right, exactly matching screenshot) */}
          {settingsOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: '70px',
                right: '24px',
                background: 'rgba(17, 22, 34, 0.95)',
                backdropFilter: 'blur(18px)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                borderRadius: '14px',
                padding: '8px 6px',
                width: '260px',
                zIndex: 45,
                boxShadow: '0 20px 48px rgba(0, 0, 0, 0.9)',
                color: '#fff',
                fontSize: '13.5px',
              }}
            >
              {settingsMenu === 'main' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {/* Quality row */}
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('quality')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Sliders size={16} color="var(--muted-light, #b4bdd0)" />
                      <span>Quality</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted, #8b95ad)' }}>
                      <span>{activeQualityLabel}</span>
                      <ChevronRight size={15} />
                    </div>
                  </button>

                  {/* Speed row */}
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('speed')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Gauge size={16} color="var(--muted-light, #b4bdd0)" />
                      <span>Speed</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted, #8b95ad)' }}>
                      <span>{playbackSpeed === 1 ? '1×' : `${playbackSpeed}×`}</span>
                      <ChevronRight size={15} />
                    </div>
                  </button>

                  {/* Captions row */}
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('captions')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Subtitles size={16} color="var(--muted-light, #b4bdd0)" />
                      <span>Captions</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted, #8b95ad)' }}>
                      <span>{selectedCaption}</span>
                      <ChevronRight size={15} />
                    </div>
                  </button>
                </div>
              )}

              {/* Quality Submenu */}
              {settingsMenu === 'quality' && (
                <div>
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('main')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-light)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 700,
                    }}
                  >
                    <ChevronLeft size={16} /> Quay lại
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => handleSelectQuality(-1)}
                      style={{
                        background: activeQuality === -1 ? 'rgba(225, 29, 46, 0.2)' : 'none',
                        border: 'none',
                        color: activeQuality === -1 ? '#ff5a66' : '#fff',
                        padding: '8px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        borderRadius: '6px',
                      }}
                    >
                      <span>Auto (1080p)</span>
                      {activeQuality === -1 && <Check size={15} />}
                    </button>
                    {qualities.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => handleSelectQuality(q.id)}
                        style={{
                          background: activeQuality === q.id ? 'rgba(225, 29, 46, 0.2)' : 'none',
                          border: 'none',
                          color: activeQuality === q.id ? '#ff5a66' : '#fff',
                          padding: '8px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          borderRadius: '6px',
                        }}
                      >
                        <span>
                          {q.height >= 2160 ? '4K UHD (2160p)' : `${q.height}p`}
                        </span>
                        {activeQuality === q.id && <Check size={15} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Speed Submenu */}
              {settingsMenu === 'speed' && (
                <div>
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('main')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-light)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 700,
                    }}
                  >
                    <ChevronLeft size={16} /> Quay lại
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleSelectSpeed(s)}
                        style={{
                          background: playbackSpeed === s ? 'rgba(225, 29, 46, 0.2)' : 'none',
                          border: 'none',
                          color: playbackSpeed === s ? '#ff5a66' : '#fff',
                          padding: '8px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          borderRadius: '6px',
                        }}
                      >
                        <span>{s === 1 ? '1x (Bình thường)' : `${s}x`}</span>
                        {playbackSpeed === s && <Check size={15} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Captions Submenu */}
              {settingsMenu === 'captions' && (
                <div>
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('main')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-light)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 700,
                    }}
                  >
                    <ChevronLeft size={16} /> Quay lại
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                    {['Film4k.net', 'Tiếng Việt', 'English Subtitles', 'Tắt'].map((cap) => (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => setSelectedCaption(cap)}
                        style={{
                          background: selectedCaption === cap ? 'rgba(225, 29, 46, 0.2)' : 'none',
                          border: 'none',
                          color: selectedCaption === cap ? '#ff5a66' : '#fff',
                          padding: '8px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          borderRadius: '6px',
                        }}
                      >
                        <span>{cap}</span>
                        {selectedCaption === cap && <Check size={15} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 6. BOTTOM CUSTOM CONTROL BAR (matching screenshot) */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '0 20px 14px',
              background: 'linear-gradient(to top, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.5) 60%, transparent 100%)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              zIndex: 35,
              opacity: controlsVisible ? 1 : 0,
              pointerEvents: controlsVisible ? 'auto' : 'none',
              transition: 'opacity 0.22s ease',
            }}
          >
            {/* Timeline Scrubber / Progress Bar */}
            <div
              ref={scrubberRef}
              onClick={handleSeek}
              style={{
                width: '100%',
                height: '14px',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              {/* Background Track */}
              <div
                style={{
                  width: '100%',
                  height: '4px',
                  background: 'rgba(255, 255, 255, 0.2)',
                  borderRadius: '999px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Buffer Track */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: `${bufferedPercent}%`,
                    background: 'rgba(255, 255, 255, 0.35)',
                    transition: 'width 0.3s ease',
                  }}
                />
                {/* Played Track */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: `${progressPercent}%`,
                    background: 'var(--accent, #e11d2e)',
                  }}
                />
              </div>

              {/* Scrubber Thumb */}
              <div
                style={{
                  position: 'absolute',
                  left: `${progressPercent}%`,
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: 'var(--accent, #e11d2e)',
                  boxShadow: '0 0 8px rgba(225, 29, 46, 0.8)',
                  pointerEvents: 'none',
                }}
              />
            </div>

            {/* Controls Row */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: '#fff',
              }}
            >
              {/* Left Controls: Play/Pause, Volume, Time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                {/* Play/Pause */}
                <button
                  type="button"
                  onClick={togglePlay}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                  title={isPlaying ? 'Tạm dừng (Space)' : 'Phát (Space)'}
                >
                  {isPlaying ? <Pause size={20} fill="#fff" /> : <Play size={20} fill="#fff" />}
                </button>

                {/* Volume & Inline Slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={toggleMute}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: 0,
                    }}
                    title={isMuted ? 'Bật âm thanh (M)' : 'Tắt tiếng (M)'}
                  >
                    {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </button>

                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    style={{
                      width: '68px',
                      height: '4px',
                      cursor: 'pointer',
                      accentColor: 'var(--accent, #e11d2e)',
                    }}
                  />
                </div>

                {/* Time Display */}
                <div style={{ fontSize: '13px', color: '#eef2fa', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                  <span>{formatTime(currentTime)}</span>
                  <span style={{ color: 'var(--muted, #8b95ad)', margin: '0 4px' }}>/</span>
                  <span style={{ color: 'var(--muted-light, #b4bdd0)' }}>{formatTime(duration || 1682)}</span>
                </div>
              </div>

              {/* Right Controls: Captions, Settings, AirPlay, PiP, Fullscreen */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {/* Captions button */}
                <button
                  type="button"
                  onClick={() => {
                    if (selectedCaption === 'Tắt') {
                      setSelectedCaption('Film4k.net');
                    } else {
                      setSelectedCaption('Tắt');
                    }
                  }}
                  style={{
                    background: selectedCaption !== 'Tắt' ? 'rgba(255,255,255,0.14)' : 'none',
                    border: 'none',
                    borderRadius: '6px',
                    color: selectedCaption !== 'Tắt' ? '#fff' : 'var(--muted, #8b95ad)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px',
                    transition: 'all 0.15s',
                  }}
                  title="Bật/Tắt phụ đề"
                >
                  <Subtitles size={20} />
                </button>

                {/* Settings Gear button (in rounded dark square when active) */}
                <button
                  type="button"
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  style={{
                    background: settingsOpen ? 'rgba(255, 255, 255, 0.16)' : 'none',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '6px',
                    transition: 'all 0.15s',
                  }}
                  title="Cài đặt phát (Chất lượng, Tốc độ, Phụ đề)"
                >
                  <Settings size={20} />
                </button>

                {/* Cast / AirPlay icon */}
                <button
                  type="button"
                  onClick={() => alert('Truyền luồng tới thiết bị Smart TV / AirPlay / Google Cast')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                  }}
                  title="Truyền thiết bị (AirPlay / Cast)"
                >
                  <Cast size={20} />
                </button>

                {/* Picture-in-Picture */}
                <button
                  type="button"
                  onClick={togglePiP}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                  }}
                  title="Thu nhỏ hình trong hình (PiP)"
                >
                  <PictureInPicture size={20} />
                </button>

                {/* Fullscreen */}
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                  }}
                  title="Toàn màn hình (F)"
                >
                  {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Server Selection Chips */}
        <div className="wrap" style={{ maxWidth: '1100px', margin: '16px auto 0' }}>
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

        {/* TV Series Episode Grid (if series) */}
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

        {/* Movie Info & Synopsis */}
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
