import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Headphones,
  Cast,
  PictureInPicture,
  ChevronRight,
  ChevronLeft,
  Check,
  ArrowLeft,
  Home,
  Film,
} from 'lucide-react';
import { Movie, Episode, Source } from '../types';
import { Film4kFragmentLoader, setStatsListener } from '../utils/hlsLoader';
import { saveWatchProgress, getMovieProgress, removeWatchProgress } from '../utils/watchProgress';
import {
  getSubtitleForTime,
  findCueBinarySearch,
  loadVttTrack,
  SUBTITLE_TRACKS,
  SAMPLE_SUBTITLES,
  SubtitleCue,
} from '../utils/subtitles';
import { getQualityDisplayInfo, sortQualitiesDescending, QualityLevel } from '../utils/quality';
import {
  MoviePlaybackConfig,
  getMovieConfig,
  saveMovieConfig,
  SubtitleSettings,
  getGlobalSubtitleSettings,
  saveGlobalSubtitleSettings,
} from '../utils/movieConfig';

export type { SubtitleSettings, MoviePlaybackConfig };

export interface SubtitleTrackOption {
  id: string;
  label: string;
  url?: string;
  hlsTrackId?: number;
}

export function buildRefreshUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr, window.location.origin);
    url.searchParams.set('refresh', '1');
    url.searchParams.set('_t', Date.now().toString());
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
      return `${url.pathname}${url.search}`;
    }
    return url.toString();
  } catch {
    const separator = urlStr.includes('?') ? '&' : '?';
    return `${urlStr}${separator}refresh=1&_t=${Date.now()}`;
  }
}

export function getEpisodeHlsUrl(slug: string, epNum?: number): string {
  const num = epNum && epNum > 1 ? epNum : 1;
  return num > 1 ? `/api/stream/${slug}/ep/${num}/master.m3u8` : `/api/stream/${slug}/master.m3u8`;
}

interface WatchPageProps {
  slug: string;
  initialEpisode?: number;
  onNavigate: (path: string) => void;
}

type SettingsSubmenu = 'main' | 'quality' | 'audio' | 'speed' | 'captions';

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

  // UI Overlays & Menu state (Closed by default as requested!)
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMenu, setSettingsMenu] = useState<SettingsSubmenu>('main');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
    const cfg = getMovieConfig(slug);
    return cfg.playbackSpeed !== undefined ? cfg.playbackSpeed : 1;
  });

  // Subtitle state (Dynamic from movie.subtitles, episode.subtitles, HLS manifest, or local)
  const [hlsSubtitleTracks, setHlsSubtitleTracks] = useState<SubtitleTrackOption[]>([]);
  const [selectedCaption, setSelectedCaption] = useState<string>('Tắt');
  const [activeCues, setActiveCues] = useState<SubtitleCue[] | null>(null);
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string | null>(null);

  // Subtitle appearance settings (Font size, Color, Background style) - Global across all movies
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(() => getGlobalSubtitleSettings());

  const updateSubtitleSettings = (updates: Partial<SubtitleSettings>) => {
    const next = saveGlobalSubtitleSettings(updates);
    setSubtitleSettings(next);
  };

  // Helper to persist selected subtitle track per movie
  const handleSelectCaption = (captionLabel: string) => {
    setSelectedCaption(captionLabel);
    saveMovieConfig(slug, { selectedCaption: captionLabel });
  };

  // Keep per-movie playback speed and global subtitle appearance synced when slug changes
  useEffect(() => {
    const cfg = getMovieConfig(slug);
    const speed = cfg.playbackSpeed !== undefined ? cfg.playbackSpeed : 1;
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setSubtitleSettings(getGlobalSubtitleSettings());
  }, [slug]);

  const subtitleFontSize = useMemo(() => {
    switch (subtitleSettings.fontSize) {
      case 'small':
        return 'clamp(15px, 1.8vw, 18px)';
      case 'large':
        return 'clamp(24px, 3.2vw, 30px)';
      case 'medium':
      default:
        return 'clamp(19px, 2.4vw, 24px)';
    }
  }, [subtitleSettings.fontSize]);

  const subtitleBgProps = useMemo(() => {
    switch (subtitleSettings.bgStyle) {
      case 'solid':
        return {
          backgroundColor: '#000000',
          padding: '4px 14px',
          borderRadius: '6px',
          textShadow: 'none',
        };
      case 'semi':
        return {
          backgroundColor: 'rgba(0, 0, 0, 0.60)',
          padding: '4px 14px',
          borderRadius: '6px',
          textShadow: '0 1px 2px rgba(0, 0, 0, 0.85)',
        };
      case 'outline':
      default:
        return {
          backgroundColor: 'transparent',
          padding: '2px 8px',
          borderRadius: '4px',
          textShadow:
            '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 3px 6px rgba(0,0,0,0.95), 0 0 6px #000',
        };
    }
  }, [subtitleSettings.bgStyle]);

  // Audio state (Dynamic from movie.audio_tracks & hls.audioTracks)
  const [audioTracks, setAudioTracks] = useState<{ id: number | string; name: string }[]>([
    { id: 0, name: 'ENG (Stereo)' },
    { id: 1, name: 'ENG (Dolby Atmos 5.1)' },
    { id: 2, name: 'ViE-AI Thuyết minh tiếng Việt' },
  ]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number | string>(0);
  const [activeAudioName, setActiveAudioName] = useState<string>('ENG (Stereo)');

  // Streaming Stats & Bitrate & FPS & Dropped frames & Buffer length (Stats for nerds)
  const [fps, setFps] = useState<number>(24);
  const [droppedFrames, setDroppedFrames] = useState<number>(0);
  const [bufferLengthSec, setBufferLengthSec] = useState<number>(0);
  const [activeBitrate, setActiveBitrate] = useState<string>('12.4 Mbps');
  const [streamStats, setStreamStats] = useState({
    speedMbps: '17.94 Mbps',
    mb: 1479.3,
    sec: 45,
    isCdn: true,
  });
  const [streamNotice, setStreamNotice] = useState<string | null>(null);

  // HLS Qualities (Normalized 2.39:1 scope defaults: 1920x800 -> 1080p HD, 3832x1600 -> 1600p 4K)
  const [qualities, setQualities] = useState<QualityLevel[]>([
    { id: 0, height: 800, width: 1920, bitrate: 8500000 },
    { id: 1, height: 1600, width: 3832, bitrate: 14000000 },
  ]);
  const [activeQuality, setActiveQuality] = useState<number>(-1); // -1 = Auto
  const [autoQualityLabel, setAutoQualityLabel] = useState<string>('1080p');
  const [activeResolution, setActiveResolution] = useState<string>('1920x800');

  // Sorted qualities: highest resolution first (e.g. 1600p 4K, then 1080p HD)
  const sortedQualities = useMemo(() => {
    return sortQualitiesDescending(qualities);
  }, [qualities]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const controlsTimeoutRef = useRef<number | null>(null);
  const scrubberRef = useRef<HTMLDivElement | null>(null);
  const savedSeekTimeRef = useRef<number>(0);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);

  // Auto next episode & Resume playback state
  const [autoNextEnabled, setAutoNextEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('bofilm_auto_next') !== 'false';
    } catch {
      return true;
    }
  });
  const [countdown, setCountdown] = useState<number | null>(null);
  const [resumeToast, setResumeToast] = useState<string | null>(null);
  const hasResumedRef = useRef<boolean>(false);
  const hasShownResumeToastRef = useRef<boolean>(false);
  const resumeToastTimerRef = useRef<number | null>(null);
  const lastSavedTimeRef = useRef<number>(0);
  const countdownDismissedRef = useRef<boolean>(false);

  // Check if URL specifies start=0 or restart=1
  const isStartFromBeginning = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('start') === '0' || params.get('restart') === '1';
    } catch {
      return false;
    }
  }, []);

  // Show Avocado Resume Toast notice
  const applyResumeToast = (timeInSeconds: number) => {
    if (hasShownResumeToastRef.current || isStartFromBeginning) return;
    hasShownResumeToastRef.current = true;
    const mins = Math.floor(timeInSeconds / 60);
    const secs = Math.floor(timeInSeconds % 60);
    const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    setResumeToast(`🥑 Đang tiếp tục phát từ phút ${timeFormatted}`);
    if (resumeToastTimerRef.current) {
      clearTimeout(resumeToastTimerRef.current);
    }
    resumeToastTimerRef.current = window.setTimeout(() => {
      setResumeToast(null);
    }, 6000);
  };

  // Immediate restart playback from 00:00
  const handleRestartFromBeginning = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
    setCurrentTime(0);
    lastSavedTimeRef.current = 0;
    if (resumeToastTimerRef.current) {
      clearTimeout(resumeToastTimerRef.current);
      resumeToastTimerRef.current = null;
    }
    setResumeToast(null);
    removeWatchProgress(movie?.slug || slug, currentEpisode?.episode);
  };

  // Immediate save progress helper (Threshold: >= 10s)
  const flushSaveProgress = () => {
    if (videoRef.current && (movie || slug)) {
      const cur = videoRef.current.currentTime || 0;
      const dur = videoRef.current.duration || duration || 0;
      if (cur < 10) return;
      lastSavedTimeRef.current = cur;
      saveWatchProgress({
        slug: movie?.slug || slug,
        title: movie?.title_vi || movie?.title_en || 'Phim',
        title_en: movie?.title_en,
        poster: movie?.poster,
        backdrop: movie?.backdrop,
        episode: currentEpisode?.episode,
        currentTime: cur,
        duration: dur,
        movie_type: movie?.type,
      });
    }
  };

  // Compute next episode if series
  const nextEpisode = useMemo(() => {
    if (!movie?.episodes || movie.episodes.length <= 1 || !currentEpisode) return null;
    const currentIndex = movie.episodes.findIndex((e) => e.episode === currentEpisode.episode);
    if (currentIndex >= 0 && currentIndex < movie.episodes.length - 1) {
      return movie.episodes[currentIndex + 1];
    }
    return null;
  }, [movie, currentEpisode]);

  const handleToggleAutoNext = () => {
    setAutoNextEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('bofilm_auto_next', String(next));
      } catch {}
      return next;
    });
  };

  // Reset resume and countdown flags when switching episode or movie
  useEffect(() => {
    hasResumedRef.current = false;
    hasShownResumeToastRef.current = false;
    lastSavedTimeRef.current = 0;
    countdownDismissedRef.current = false;
    setCountdown(null);
    if (resumeToastTimerRef.current) {
      clearTimeout(resumeToastTimerRef.current);
      resumeToastTimerRef.current = null;
    }
    setResumeToast(null);
  }, [slug, currentEpisode?.episode]);

  // Countdown timer effect for Auto Next Episode
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      if (nextEpisode) {
        handleSelectEpisode(nextEpisode);
      }
      setCountdown(null);
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, nextEpisode]);

  // Save progress immediately on beforeunload and component unmount
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushSaveProgress();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushSaveProgress();
    };
  }, [movie, slug, currentEpisode, duration]);

  // Click-outside listener to close settings popup
  useEffect(() => {
    if (!settingsOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        settingsRef.current &&
        !settingsRef.current.contains(target) &&
        settingsBtnRef.current &&
        !settingsBtnRef.current.contains(target)
      ) {
        setSettingsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [settingsOpen]);

  // Single authentic Server VIP (4K Siêu Nhanh) connecting to /api/stream/${movie.slug}/master.m3u8 (or ep master)
  const availableServers: Source[] = useMemo(() => {
    if (!movie?.slug) return [];
    const streamPath = getEpisodeHlsUrl(movie.slug, currentEpisode?.episode);
    return [
      {
        label: 'Server VIP (4K Siêu Nhanh)',
        hlsUrl: streamPath,
        proxyStreamUrl: streamPath,
      },
    ];
  }, [movie?.slug, currentEpisode?.episode]);

  // Flexible subtitle tracks from HLS manifest, movie.subtitles, currentEpisode.subtitles, or local tracks
  const availableSubtitleOptions: SubtitleTrackOption[] = useMemo(() => {
    const list: SubtitleTrackOption[] = [];
    const seen = new Set<string>();

    // 1. Manifest subtitles from HLS (Authoritative from stream)
    hlsSubtitleTracks.forEach((st) => {
      if (!seen.has(st.label)) {
        seen.add(st.label);
        list.push(st);
      }
    });

    const hasHlsTracks = hlsSubtitleTracks.length > 0;

    // 2. Movie level subtitles from DB (skip placeholder /api/subtitles/ if HLS stream tracks exist)
    if (movie?.subtitles && Array.isArray(movie.subtitles)) {
      movie.subtitles.forEach((s, idx) => {
        if (typeof s === 'string') {
          if (!seen.has(s)) {
            seen.add(s);
            list.push({ id: `movie-sub-${idx}`, label: s });
          }
        } else if (s && typeof s === 'object') {
          const label = s.label || s.name || s.lang || s.language || `Phụ đề ${idx + 1}`;
          const url = s.url || s.file || s.src;
          // Skip placeholder /api/subtitles/ if HLS stream tracks exist
          if (hasHlsTracks && url && url.startsWith('/api/subtitles/')) {
            return;
          }
          if (!seen.has(label)) {
            seen.add(label);
            list.push({ id: `movie-sub-${idx}`, label, url });
          }
        }
      });
    }

    // 3. Episode level subtitles from DB
    if (currentEpisode?.subtitles && Array.isArray(currentEpisode.subtitles)) {
      currentEpisode.subtitles.forEach((s, idx) => {
        if (typeof s === 'string') {
          if (!seen.has(s)) {
            seen.add(s);
            list.push({ id: `ep-sub-${idx}`, label: s });
          }
        } else if (s && typeof s === 'object') {
          const label = s.label || s.name || s.lang || s.language || `Tập ${currentEpisode.episode} Sub ${idx + 1}`;
          const url = s.url || s.file || s.src;
          if (hasHlsTracks && url && url.startsWith('/api/subtitles/')) {
            return;
          }
          if (!seen.has(label)) {
            seen.add(label);
            list.push({ id: `ep-sub-${idx}`, label, url });
          }
        }
      });
    }

    // 4. Predefined sample/bundled tracks (strictly for spider-man)
    if (slug === 'spider-man-brand-new-day' && SUBTITLE_TRACKS[slug]) {
      Object.keys(SUBTITLE_TRACKS[slug]).forEach((k) => {
        if (!seen.has(k)) {
          seen.add(k);
          list.push({ id: `bundled-${k}`, label: k });
        }
      });
    }

    return list;
  }, [movie, currentEpisode, hlsSubtitleTracks, slug]);

  // Fallback to movie.audio_tracks if audioTracks from HLS is empty
  const displayAudioTracks = useMemo(() => {
    if (audioTracks.length > 0) return audioTracks;
    if (movie?.audio_tracks && movie.audio_tracks.length > 0) {
      return movie.audio_tracks.map((tr, idx) => ({
        id: typeof tr === 'object' && (tr as any).id !== undefined ? (tr as any).id : idx,
        name:
          typeof tr === 'string'
            ? tr
            : (tr as any).name || (tr as any).label || (tr as any).lang || `Audio ${idx + 1}`,
      }));
    }
    return [];
  }, [audioTracks, movie]);

  // Format seconds to MM:SS or HH:MM:SS
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
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

      // Esc closes settings popup and stats card immediately from anywhere
      if (e.key === 'Escape' || e.code === 'Escape') {
        if (settingsOpen || showStats) {
          e.preventDefault();
          setSettingsOpen(false);
          setShowStats(false);
          return;
        }
      }

      const video = videoRef.current;
      if (!video) return;

      switch (e.code) {
        case 'Escape':
          e.preventDefault();
          setShowStats(false);
          setSettingsOpen(false);
          break;
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
  }, [isPlaying, settingsOpen, showStats]);

  // Subscribe to CDN Stats
  useEffect(() => {
    setStatsListener((info) => {
      setStreamStats({
        speedMbps: `${info.speedMbps} Mbps`,
        mb: info.totalMb > 0 ? info.totalMb : 1479.3,
        sec: info.sec,
        isCdn: true,
      });
    });
  }, []);

  // Real FPS Detection via requestVideoFrameCallback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let callbackId: number | null = null;
    let lastTime = performance.now();
    let frameCount = 0;

    const frameCallback = (now: DOMHighResTimeStamp) => {
      frameCount++;
      const delta = now - lastTime;
      if (delta >= 1000) {
        const measuredFps = Math.round((frameCount * 1000) / delta);
        if (measuredFps > 10 && measuredFps <= 120) {
          setFps(measuredFps);
        } else {
          setFps(24);
        }
        frameCount = 0;
        lastTime = now;
      }
      if ('requestVideoFrameCallback' in video) {
        callbackId = (video as any).requestVideoFrameCallback(frameCallback);
      }
    };

    if ('requestVideoFrameCallback' in video) {
      callbackId = (video as any).requestVideoFrameCallback(frameCallback);
    } else {
      setFps(24);
    }

    return () => {
      if (callbackId && 'cancelVideoFrameCallback' in video) {
        (video as any).cancelVideoFrameCallback(callbackId);
      }
    };
  }, [isPlaying]);

  // Helper to extract active cue text directly from HTMLVideoElement.textTracks
  const getActiveCueTextFromVideo = (): string | null => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return null;
    for (let i = 0; i < video.textTracks.length; i++) {
      const tt = video.textTracks[i];
      if (tt.mode === 'showing' || tt.mode === 'hidden') {
        if (tt.activeCues && tt.activeCues.length > 0) {
          const cue = tt.activeCues[0] as VTTCue;
          if (cue && cue.text) {
            return cue.text;
          }
        }
      }
    }
    return null;
  };

  // Load subtitle cues when selectedCaption changes & 2-way sync with video.textTracks
  useEffect(() => {
    const video = videoRef.current;

    // When turning off ('Tắt'): set all subtitle textTracks to 'disabled', hls.subtitleTrack = -1, and clear overlay text
    if (selectedCaption === 'Tắt' || !selectedCaption) {
      setActiveCues(null);
      setCurrentSubtitleText(null);
      if (hlsRef.current) {
        hlsRef.current.subtitleTrack = -1;
      }
      if (video && video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'disabled';
        }
      }
      return;
    }

    const track = availableSubtitleOptions.find((t) => t.label === selectedCaption);

    // 2-way sync with TextTracks: loop through video.textTracks, set selected to 'showing', others to 'hidden'
    if (video && video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        const tt = video.textTracks[i];
        const isMatched =
          track &&
          ((track.hlsTrackId !== undefined && i === track.hlsTrackId) ||
            tt.label === track.label ||
            tt.language === track.label);
        tt.mode = isMatched ? 'showing' : 'hidden';
      }
    }

    if (!track) {
      if (SUBTITLE_TRACKS[slug] && SUBTITLE_TRACKS[slug][selectedCaption]) {
        setActiveCues(SUBTITLE_TRACKS[slug][selectedCaption]);
      } else if (slug === 'spider-man-brand-new-day' && SAMPLE_SUBTITLES[slug]) {
        setActiveCues(SAMPLE_SUBTITLES[slug]);
      } else {
        setActiveCues(null);
      }
      return;
    }

    // When track is from HLS, set hlsRef.current.subtitleTrack = track.hlsTrackId and fetch .vtt cues for custom Cinema UI
    if (track.hlsTrackId !== undefined && hlsRef.current) {
      hlsRef.current.subtitleTrack = track.hlsTrackId;
      if (track.url) {
        loadVttTrack(track.url).then((cues) => {
          if (cues && cues.length > 0) {
            setActiveCues(cues);
          }
        });
      }
    } else if (track.url) {
      loadVttTrack(track.url).then((cues) => {
        if (cues && cues.length > 0) {
          setActiveCues(cues);
        } else {
          setActiveCues(null);
        }
      });
    } else if (SUBTITLE_TRACKS[slug] && SUBTITLE_TRACKS[slug][track.label]) {
      setActiveCues(SUBTITLE_TRACKS[slug][track.label]);
    } else if (slug === 'spider-man-brand-new-day' && SAMPLE_SUBTITLES[slug]) {
      setActiveCues(SAMPLE_SUBTITLES[slug]);
    } else {
      setActiveCues(null);
    }
  }, [selectedCaption, availableSubtitleOptions, slug]);

  // Listen to cuechange on HTMLVideoElement.textTracks when Hls.js manages text tracks
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleCueChange = (e: Event) => {
      if (selectedCaption === 'Tắt' || !selectedCaption) return;
      // If activeCues is already loaded via loadVttTrack, let findCueBinarySearch take precedence
      if (activeCues && activeCues.length > 0) return;

      const track = e.target as TextTrack | null;
      if (track && track.activeCues && track.activeCues.length > 0) {
        const cue = track.activeCues[0] as VTTCue;
        if (cue && cue.text) {
          setCurrentSubtitleText(cue.text);
        }
      } else {
        let anyActive = false;
        if (video.textTracks) {
          for (let i = 0; i < video.textTracks.length; i++) {
            const tt = video.textTracks[i];
            if (tt.activeCues && tt.activeCues.length > 0) {
              const c = tt.activeCues[0] as VTTCue;
              if (c && c.text) {
                setCurrentSubtitleText(c.text);
                anyActive = true;
                break;
              }
            }
          }
        }
        if (!anyActive) {
          setCurrentSubtitleText(null);
        }
      }
    };

    const tracks = video.textTracks;
    if (!tracks) return;

    for (let i = 0; i < tracks.length; i++) {
      tracks[i].addEventListener('cuechange', handleCueChange);
    }

    const handleTrackAdded = (e: TrackEvent) => {
      if (e.track) {
        e.track.addEventListener('cuechange', handleCueChange);
      }
    };

    tracks.addEventListener('addtrack', handleTrackAdded);

    return () => {
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].removeEventListener('cuechange', handleCueChange);
      }
      tracks.removeEventListener('addtrack', handleTrackAdded);
    };
  }, [selectedCaption, activeCues]);

  // Update subtitles via O(log N) binary search based on current time
  useEffect(() => {
    if (selectedCaption === 'Tắt' || !selectedCaption) {
      setCurrentSubtitleText(null);
      return;
    }
    if (activeCues && activeCues.length > 0) {
      const cue = findCueBinarySearch(activeCues, currentTime);
      setCurrentSubtitleText(cue ? cue.text : null);
      return;
    }
    const text = getSubtitleForTime(slug, currentTime, selectedCaption);
    if (text) {
      setCurrentSubtitleText(text);
    } else {
      // If no text from getSubtitleForTime and no activeCues, check direct Hls text tracks
      const video = videoRef.current;
      let hlsCueText: string | null = null;
      if (video && video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          const tt = video.textTracks[i];
          if (tt.mode !== 'disabled' && tt.activeCues && tt.activeCues.length > 0) {
            const c = tt.activeCues[0] as VTTCue;
            if (c && c.text) {
              hlsCueText = c.text;
              break;
            }
          }
        }
      }
      setCurrentSubtitleText(hlsCueText);
    }
  }, [slug, currentTime, selectedCaption, activeCues]);

  // Update dropped frames, buffer length, and live dimensions for Stats for Nerds
  useEffect(() => {
    if (!showStats && !isPlaying) return;

    const updateNerdStats = () => {
      const video = videoRef.current;
      if (!video) return;

      // 1. Dropped frames
      if (typeof video.getVideoPlaybackQuality === 'function') {
        const q = video.getVideoPlaybackQuality();
        setDroppedFrames(q.droppedVideoFrames || 0);
      } else if ((video as any).webkitDroppedFrameCount !== undefined) {
        setDroppedFrames((video as any).webkitDroppedFrameCount || 0);
      }

      // 2. Buffer length in seconds (forward buffer)
      if (video.buffered && video.buffered.length > 0) {
        const cur = video.currentTime;
        let forwardSec = 0;
        for (let i = 0; i < video.buffered.length; i++) {
          const s = video.buffered.start(i);
          const e = video.buffered.end(i);
          if (cur >= s - 0.2 && cur <= e + 0.2) {
            forwardSec = Math.max(0, e - cur);
            break;
          }
        }
        setBufferLengthSec(forwardSec);
      }

      // 3. Dynamic resolution from video stream
      if (video.videoWidth && video.videoHeight) {
        setActiveResolution(`${video.videoWidth}x${video.videoHeight}`);
      }
    };

    updateNerdStats();
    const interval = setInterval(updateNerdStats, 1000);
    return () => clearInterval(interval);
  }, [showStats, isPlaying]);

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

        if (data.quality === '4K') {
          setAutoQualityLabel('1600p');
          setActiveResolution('3832x1600');
        }

        const savedCfg = getMovieConfig(data.slug);

        // Configure audio tracks if provided by movie
        if (data.audio_tracks && data.audio_tracks.length > 0) {
          const customAudios = data.audio_tracks.map((tr, idx) => ({
            id: typeof tr === 'object' && tr.id !== undefined ? tr.id : idx,
            name: typeof tr === 'string' ? tr : tr.name || (tr as any).label || `Audio ${idx + 1}`,
          }));
          setAudioTracks(customAudios);
          const matched = savedCfg.selectedAudioName
            ? customAudios.find((t) => t.name === savedCfg.selectedAudioName)
            : null;
          const chosen = matched || customAudios[0];
          setActiveAudioTrack(chosen.id);
          setActiveAudioName(chosen.name);
        }

        // Configure initial subtitles respecting saved per-movie config
        let initialCaption = 'Tắt';
        if (savedCfg.selectedCaption !== undefined) {
          initialCaption = savedCfg.selectedCaption;
        } else if (data.subtitles && data.subtitles.length > 0) {
          const firstSub = data.subtitles[0];
          initialCaption = typeof firstSub === 'string' ? firstSub : firstSub.label || firstSub.name || 'Phụ đề 1';
        } else if (slug === 'spider-man-brand-new-day' && SUBTITLE_TRACKS[slug]) {
          initialCaption = Object.keys(SUBTITLE_TRACKS[slug])[0] || 'Tiếng Việt';
        }
        setSelectedCaption(initialCaption);

        // Sources & Server initialization: prioritize Server VIP connecting to /api/stream/${data.slug}/master.m3u8 (or ep master)
        const initialEpNum = initialEpisode || 1;
        const localMasterUrl = getEpisodeHlsUrl(data.slug, initialEpNum);
        const vipSource: Source = {
          label: 'Server VIP (4K Siêu Nhanh)',
          hlsUrl: localMasterUrl,
          proxyStreamUrl: localMasterUrl,
        };

        const virtualEp: Episode = {
          movieSlug: data.slug,
          season: 1,
          episode: 1,
          title: data.title_vi || data.title_en || 'Full Movie',
          sources: [vipSource],
        };

        let initialSource = vipSource;
        if (data.episodes && data.episodes.length > 0) {
          const targetEp = initialEpisode
            ? data.episodes.find((e) => e.episode === initialEpisode) || data.episodes[0]
            : data.episodes[0];
          setCurrentEpisode(targetEp);
          const epStreamUrl = getEpisodeHlsUrl(data.slug, targetEp.episode);
          const epVipSource: Source = {
            label: 'Server VIP (4K Siêu Nhanh)',
            hlsUrl: epStreamUrl,
            proxyStreamUrl: epStreamUrl,
          };
          initialSource = epVipSource;
          if (savedCfg.serverLabel && targetEp.sources) {
            const matchedSrc = targetEp.sources.find((s) => s.label === savedCfg.serverLabel);
            if (matchedSrc) initialSource = matchedSrc;
          }
          setCurrentSource(initialSource);
        } else {
          setCurrentEpisode(virtualEp);
          setCurrentSource(initialSource);
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
    const rawHlsUrl = currentSource.hlsUrl || currentSource.url || '';
    const streamUrl =
      currentSource.proxyStreamUrl ||
      `/api/proxy/stream?url=${encodeURIComponent(rawHlsUrl)}&keep_cdn=1`;

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
        renderTextTracksNatively: true,
      });

      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const savedCfg = getMovieConfig(slug);

        if (data.levels && data.levels.length > 0) {
          const qList: QualityLevel[] = data.levels.map((lvl, index) => ({
            id: index,
            height: lvl.height,
            width: lvl.width,
            bitrate: lvl.bitrate,
          }));
          setQualities(qList);

          if (savedCfg.selectedQualityId !== undefined && savedCfg.selectedQualityId >= 0) {
            const targetQ = qList.find((q) => q.id === savedCfg.selectedQualityId);
            if (targetQ) {
              hls.currentLevel = targetQ.id;
              hls.loadLevel = targetQ.id;
              setActiveQuality(targetQ.id);
              const info = getQualityDisplayInfo(targetQ.height, targetQ.width);
              setAutoQualityLabel(info.label);
              setActiveResolution(info.resolution);
              if (targetQ.bitrate) {
                setActiveBitrate(`${(targetQ.bitrate / 1000000).toFixed(1)} Mbps`);
              }
            }
          } else {
            const sorted = sortQualitiesDescending(qList);
            const topLvl = sorted[0];
            if (topLvl && topLvl.height) {
              const info = getQualityDisplayInfo(topLvl.height, topLvl.width);
              setAutoQualityLabel(info.label);
              setActiveResolution(info.resolution);
              if (topLvl.bitrate) {
                setActiveBitrate(`${(topLvl.bitrate / 1000000).toFixed(1)} Mbps`);
              }
            }
          }
        }

        // Fix Audio Tracks menu: Populate immediately at MANIFEST_PARSED & restore saved audio
        const hlsAudios =
          data.audioTracks && data.audioTracks.length > 0
            ? data.audioTracks
            : hls.audioTracks && hls.audioTracks.length > 0
            ? hls.audioTracks
            : [];

        if (hlsAudios.length > 0) {
          const tracks = hlsAudios.map((tr) => ({
            id: tr.id,
            name: tr.name || tr.lang || `Track ${tr.id + 1}`,
          }));
          setAudioTracks(tracks);
          const matched = savedCfg.selectedAudioName
            ? tracks.find((t) => t.name === savedCfg.selectedAudioName)
            : null;
          if (matched) {
            const trackNum = typeof matched.id === 'number' ? matched.id : 0;
            hls.audioTrack = trackNum;
            setActiveAudioTrack(matched.id);
            setActiveAudioName(matched.name);
          } else {
            const curId = hls.audioTrack >= 0 ? hls.audioTrack : 0;
            setActiveAudioTrack(curId);
            if (tracks[curId]) {
              setActiveAudioName(tracks[curId].name);
            }
          }
        } else if (movie?.audio_tracks && movie.audio_tracks.length > 0) {
          const fallbackTracks = movie.audio_tracks.map((tr, idx) => ({
            id: typeof tr === 'object' && (tr as any).id !== undefined ? (tr as any).id : idx,
            name:
              typeof tr === 'string'
                ? tr
                : (tr as any).name || (tr as any).label || (tr as any).lang || `Audio ${idx + 1}`,
          }));
          setAudioTracks(fallbackTracks);
          const matched = savedCfg.selectedAudioName
            ? fallbackTracks.find((t) => t.name === savedCfg.selectedAudioName)
            : null;
          const chosen = matched || fallbackTracks[0];
          setActiveAudioTrack(chosen.id);
          setActiveAudioName(chosen.name);
        }

        // Subtitles from manifest & restore saved caption
        if (data.subtitleTracks && data.subtitleTracks.length > 0) {
          const subs: SubtitleTrackOption[] = data.subtitleTracks.map((tr) => ({
            id: `hls-${tr.id}`,
            label: tr.name || tr.lang || `Track ${tr.id + 1}`,
            hlsTrackId: tr.id,
            url: tr.url,
          }));
          setHlsSubtitleTracks(subs);
          if (savedCfg.selectedCaption) {
            if (savedCfg.selectedCaption === 'Tắt') {
              setSelectedCaption('Tắt');
            } else {
              const matched = subs.find((s) => s.label === savedCfg.selectedCaption);
              if (matched) {
                setSelectedCaption(matched.label);
              }
            }
          }
        }

        // Seek on MANIFEST_PARSED: handle server switch or resume playback
        let targetSeekTime = 0;
        if (savedSeekTimeRef.current > 0) {
          targetSeekTime = savedSeekTimeRef.current;
          savedSeekTimeRef.current = 0;
        } else if (!hasResumedRef.current && !isStartFromBeginning) {
          const saved = getMovieProgress(slug, currentEpisode?.episode);
          const dur = video.duration || duration || 0;
          if (saved && saved.currentTime >= 10 && (dur <= 0 || saved.currentTime < dur * 0.95)) {
            targetSeekTime = saved.currentTime;
          }
        }

        if (targetSeekTime > 0) {
          video.currentTime = targetSeekTime;
          setCurrentTime(targetSeekTime);
          if (targetSeekTime >= 10 && !isStartFromBeginning) {
            applyResumeToast(targetSeekTime);
          }
          hasResumedRef.current = true;
        }

        video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHING, (_, data) => {
        if (hls.levels && hls.levels[data.level]) {
          const lvl = hls.levels[data.level];
          const info = getQualityDisplayInfo(lvl.height, lvl.width);
          setAutoQualityLabel(info.label);
          setActiveResolution(info.resolution);
          if (lvl.bitrate) {
            setActiveBitrate(`${(lvl.bitrate / 1000000).toFixed(1)} Mbps`);
          }
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        if (hls.levels && hls.levels[data.level]) {
          const lvl = hls.levels[data.level];
          const info = getQualityDisplayInfo(lvl.height, lvl.width);
          setAutoQualityLabel(info.label);
          setActiveResolution(info.resolution);
          if (lvl.bitrate) {
            setActiveBitrate(`${(lvl.bitrate / 1000000).toFixed(1)} Mbps`);
          }
        }
      });

      // Track Subtitle Tracks from Manifest
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, data) => {
        if (data.subtitleTracks && data.subtitleTracks.length > 0) {
          const subs: SubtitleTrackOption[] = data.subtitleTracks.map((tr) => ({
            id: `hls-${tr.id}`,
            label: tr.name || tr.lang || `Track ${tr.id + 1}`,
            hlsTrackId: tr.id,
            url: tr.url,
          }));
          setHlsSubtitleTracks(subs);
          const savedCfg = getMovieConfig(slug);
          if (savedCfg.selectedCaption) {
            if (savedCfg.selectedCaption === 'Tắt') {
              setSelectedCaption('Tắt');
            } else {
              const matched = subs.find((s) => s.label === savedCfg.selectedCaption);
              if (matched) {
                setSelectedCaption(matched.label);
              }
            }
          }
        }
      });

      hls.on(Hls.Events.SUBTITLE_TRACK_LOADED, (_, data) => {
        if (data.details && data.details.fragments && data.details.fragments.length > 0) {
          const fragUrl = data.details.fragments[0].url;
          if (fragUrl) {
            loadVttTrack(fragUrl).then((cues) => {
              if (cues && cues.length > 0) {
                setActiveCues(cues);
              }
            });
          }
        }
      });

      // Track Audio Tracks from Manifest
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        if (data.audioTracks && data.audioTracks.length > 0) {
          const tracks = data.audioTracks.map((tr) => ({
            id: tr.id,
            name: tr.name || tr.lang || `Track ${tr.id + 1}`,
          }));
          setAudioTracks(tracks);
          const savedCfg = getMovieConfig(slug);
          const matched = savedCfg.selectedAudioName
            ? tracks.find((t) => t.name === savedCfg.selectedAudioName)
            : null;
          if (matched) {
            const trackNum = typeof matched.id === 'number' ? matched.id : 0;
            hls.audioTrack = trackNum;
            setActiveAudioTrack(matched.id);
            setActiveAudioName(matched.name);
          } else {
            const curId = hls.audioTrack >= 0 ? hls.audioTrack : 0;
            setActiveAudioTrack(curId);
            if (tracks[curId]) {
              setActiveAudioName(tracks[curId].name);
            }
          }
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHING, (_, data) => {
        if (hls.audioTracks && hls.audioTracks[data.id]) {
          const track = hls.audioTracks[data.id];
          const name = track.name || track.lang || `Track ${data.id + 1}`;
          setActiveAudioTrack(data.id);
          setActiveAudioName(name);
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        if (hls.audioTracks && hls.audioTracks[data.id]) {
          const track = hls.audioTracks[data.id];
          const name = track.name || track.lang || `Track ${data.id + 1}`;
          setActiveAudioTrack(data.id);
          setActiveAudioName(name);
        }
      });

      // Live Bandwidth estimation from Hls.js
      hls.on(Hls.Events.FRAG_LOADED, () => {
        setStreamNotice(null);
        if (hls.bandwidthEstimate && hls.bandwidthEstimate > 0) {
          const speed = (hls.bandwidthEstimate / 1000000).toFixed(2);
          setStreamStats((prev) => ({
            ...prev,
            speedMbps: `${speed} Mbps`,
          }));
        }
      });

      let retryCount = 0;
      const MAX_RETRIES = 3;

      hls.on(Hls.Events.ERROR, (_, data) => {
        // Isolate subtitle or non-critical auxiliary errors from fatal stream reload/destroy
        const isSubtitleError =
          data.details === Hls.ErrorDetails.SUBTITLE_LOAD_ERROR ||
          data.details === (Hls.ErrorDetails as any).SUBTITLE_TRACK_EMPTY ||
          data.details === (Hls.ErrorDetails as any).SUBTITLE_TRACK_LOAD_TIMEOUT ||
          data.type === Hls.ErrorTypes.OTHER_ERROR ||
          (typeof data.details === 'string' && data.details.toLowerCase().includes('subtitle')) ||
          data.parent === 'subtitle' ||
          (data.context && (data.context as any).type === 'subtitleTrack') ||
          (data.frag && (data.frag as any).type === 'subtitle') ||
          (typeof data.url === 'string' &&
            (data.url.includes('.vtt') ||
              data.url.toLowerCase().includes('subtitle') ||
              data.url.toLowerCase().includes('sub/')));

        if (isSubtitleError) {
          console.warn('[HLS] Non-fatal subtitle error encountered, ignoring to allow video playback to continue:', {
            details: data.details,
            type: data.type,
            responseCode: data.response?.code,
            url: data.url,
          });
          return;
        }

        const is403 = data.response && data.response.code === 403;
        if (data.fatal || is403) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
            default:
              if (retryCount < MAX_RETRIES) {
                retryCount++;
                const isRefresh = retryCount > 1 || is403;
                const nextUrl = isRefresh ? buildRefreshUrl(streamUrl) : streamUrl;
                setStreamNotice(`Đang làm mới luồng phát (thử lại ${retryCount}/${MAX_RETRIES})...`);
                setTimeout(() => {
                  if (hlsRef.current) {
                    if (isRefresh) {
                      hlsRef.current.loadSource(nextUrl);
                    }
                    hlsRef.current.startLoad();
                  }
                }, 1000);
              } else {
                if (hlsRef.current) {
                  hlsRef.current.destroy();
                  hlsRef.current = null;
                }
                setStreamNotice('Không thể tải luồng phát sau nhiều lần thử lại. Vui lòng chuyển sang máy chủ khác.');
              }
              break;

            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
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
    const dur = videoRef.current.duration || duration || 0;
    setCurrentTime(cur);

    // Read activeCues directly from video.textTracks on timeupdate if activeCues not loaded yet
    if (selectedCaption !== 'Tắt' && (!activeCues || activeCues.length === 0)) {
      const textFromVideo = getActiveCueTextFromVideo();
      if (textFromVideo) {
        setCurrentSubtitleText(textFromVideo);
      }
    }

    if (videoRef.current.buffered.length > 0) {
      const bufEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
      const total = dur || 1;
      setBufferedPercent(Math.min(100, (bufEnd / total) * 100));
    }

    // Throttle save watch progress every 5 seconds (Threshold >= 10s)
    if (cur >= 10 && dur > 0 && (movie || slug)) {
      if (lastSavedTimeRef.current === 0 || Math.abs(cur - lastSavedTimeRef.current) >= 5) {
        lastSavedTimeRef.current = cur;
        saveWatchProgress({
          slug: movie?.slug || slug,
          title: movie?.title_vi || movie?.title_en || 'Phim',
          title_en: movie?.title_en,
          poster: movie?.poster,
          backdrop: movie?.backdrop,
          episode: currentEpisode?.episode,
          currentTime: cur,
          duration: dur,
          movie_type: movie?.type,
        });
      }
    }

    // Auto next episode countdown trigger (35s before end of video)
    if (
      autoNextEnabled &&
      nextEpisode &&
      !countdownDismissedRef.current &&
      countdown === null &&
      dur > 35 &&
      cur >= dur - 35
    ) {
      setCountdown(10);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration || 8700; // default duration fallback
      setDuration(dur);
      if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
        const w = videoRef.current.videoWidth;
        const h = videoRef.current.videoHeight;
        const info = getQualityDisplayInfo(h, w);
        setAutoQualityLabel(info.label);
        if (activeQuality === -1) {
          setActiveResolution(info.resolution);
        }
      }

      // Restore saved playback speed if any
      const cfg = getMovieConfig(slug);
      const speed = cfg.playbackSpeed !== undefined ? cfg.playbackSpeed : playbackSpeed;
      if (speed && speed !== 1) {
        videoRef.current.playbackRate = speed;
      }

      // Resume playback check: seek if not resumed yet or if video.currentTime reset to 0
      if (!isStartFromBeginning) {
        const saved = getMovieProgress(slug, currentEpisode?.episode);
        if (saved && saved.currentTime >= 10 && (dur <= 0 || saved.currentTime < dur * 0.95)) {
          if (!hasResumedRef.current || videoRef.current.currentTime < 1) {
            videoRef.current.currentTime = saved.currentTime;
            setCurrentTime(saved.currentTime);
            applyResumeToast(saved.currentTime);
            hasResumedRef.current = true;
          }
        }
      }
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (autoNextEnabled && nextEpisode && !countdownDismissedRef.current) {
      setCountdown(10);
    }
    if (videoRef.current && (movie || slug)) {
      const dur = videoRef.current.duration || duration || 0;
      if (dur >= 10) {
        saveWatchProgress({
          slug: movie?.slug || slug,
          title: movie?.title_vi || movie?.title_en || 'Phim',
          title_en: movie?.title_en,
          poster: movie?.poster,
          backdrop: movie?.backdrop,
          episode: currentEpisode?.episode,
          currentTime: dur,
          duration: dur,
          movie_type: movie?.type,
        });
      }
    }
  };

  const handlePause = () => {
    setIsPlaying(false);
    flushSaveProgress();
  };

  const handleVideoClick = () => {
    if (settingsOpen || showStats) {
      setSettingsOpen(false);
      setShowStats(false);
      return;
    }
    togglePlay();
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
      if (id >= 0) {
        hlsRef.current.currentLevel = id;
        hlsRef.current.loadLevel = id;
      } else {
        hlsRef.current.currentLevel = -1;
        hlsRef.current.loadLevel = -1;
      }
    }
    setActiveQuality(id);
    saveMovieConfig(slug, { selectedQualityId: id });
    if (id >= 0) {
      const q = qualities.find((item) => item.id === id);
      if (q) {
        const info = getQualityDisplayInfo(q.height, q.width);
        setActiveResolution(info.resolution);
        setAutoQualityLabel(info.label);
        if (q.bitrate) {
          setActiveBitrate(`${(q.bitrate / 1000000).toFixed(1)} Mbps`);
        }
      }
    } else {
      if (hlsRef.current && hlsRef.current.currentLevel >= 0 && hlsRef.current.levels[hlsRef.current.currentLevel]) {
        const lvl = hlsRef.current.levels[hlsRef.current.currentLevel];
        const info = getQualityDisplayInfo(lvl.height, lvl.width);
        setAutoQualityLabel(info.label);
        setActiveResolution(info.resolution);
        if (lvl.bitrate) {
          setActiveBitrate(`${(lvl.bitrate / 1000000).toFixed(1)} Mbps`);
        }
      } else {
        const sorted = sortQualitiesDescending(qualities);
        const top = sorted[0];
        if (top) {
          const info = getQualityDisplayInfo(top.height, top.width);
          setAutoQualityLabel(info.label);
          setActiveResolution(info.resolution);
          if (top.bitrate) {
            setActiveBitrate(`${(top.bitrate / 1000000).toFixed(1)} Mbps`);
          }
        }
      }
    }
    setSettingsMenu('main');
  };

  const handleSelectAudio = (id: number | string, trackName?: string) => {
    const numId = typeof id === 'number' ? id : parseInt(String(id), 10);
    if (
      !isNaN(numId) &&
      hlsRef.current &&
      hlsRef.current.audioTracks &&
      numId >= 0 &&
      numId < hlsRef.current.audioTracks.length
    ) {
      hlsRef.current.audioTrack = numId;
    }
    setActiveAudioTrack(id);
    const targetName =
      trackName ||
      audioTracks.find((t) => String(t.id) === String(id))?.name ||
      displayAudioTracks.find((t) => String(t.id) === String(id))?.name ||
      `Track ${id}`;
    setActiveAudioName(targetName);
    saveMovieConfig(slug, { selectedAudioName: targetName });
    setSettingsMenu('main');
  };

  const handleSelectServer = (src: Source) => {
    if (currentSource && (src.hlsUrl === currentSource.hlsUrl && src.label === currentSource.label)) return;
    if (videoRef.current && videoRef.current.currentTime > 0) {
      savedSeekTimeRef.current = videoRef.current.currentTime;
    }
    setCurrentSource(src);
    saveMovieConfig(slug, { serverLabel: src.label });
  };

  const handleSelectSpeed = (speed: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setPlaybackSpeed(speed);
    saveMovieConfig(slug, { playbackSpeed: speed });
    setSettingsMenu('main');
  };

  const handleSelectEpisode = (ep: Episode) => {
    setCurrentEpisode(ep);
    hasResumedRef.current = false;
    hasShownResumeToastRef.current = false;
    lastSavedTimeRef.current = 0;
    savedSeekTimeRef.current = 0;
    const localMasterUrl = movie?.slug ? getEpisodeHlsUrl(movie.slug, ep.episode) : '';
    const vipSource: Source = {
      label: 'Server VIP (4K Siêu Nhanh)',
      hlsUrl: localMasterUrl,
      proxyStreamUrl: localMasterUrl,
    };
    setCurrentSource(vipSource);
    const newPath = ep.episode > 1 ? `/watch/${slug}/${ep.episode}` : `/watch/${slug}`;
    window.history.pushState({}, '', newPath);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const selectedQuality = qualities.find((q) => q.id === activeQuality);
  const activeQualityLabel =
    activeQuality === -1
      ? `Tự động (${autoQualityLabel})`
      : selectedQuality
      ? getQualityDisplayInfo(selectedQuality.height, selectedQuality.width).label
      : 'Tự động';

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
            Đang nạp luồng phát 4K tốc độ cao...
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
        {/* Top Header Row matching web gốc */}
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
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Circle back button matching web gốc */}
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onNavigate(`/movie/${movie.slug}`)}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                cursor: 'pointer',
              }}
              title="Quay lại chi tiết phim"
            >
              <ArrowLeft size={16} />
            </button>

            {/* Title with Year */}
            <div style={{ fontWeight: 700, fontSize: '18px', color: '#fff' }}>
              {displayTitle}{' '}
              {currentEpisode && currentEpisode.episode > 1 && (
                <span style={{ color: 'var(--accent-light, #c6ff00)', marginLeft: '6px' }}>
                  — Tập {currentEpisode.episode}
                </span>
              )}
              <span style={{ color: 'var(--muted)', fontSize: '14px', marginLeft: '6px', fontWeight: 500 }}>
                ({year})
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onNavigate('/')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                fontSize: '13px',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              <Home size={14} />
              <span>Trang chủ</span>
            </button>

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
              <span>CDN Tốc độ cao ({streamStats.speedMbps})</span>
            </div>
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
            onClick={handleVideoClick}
            onTimeUpdate={handleTimeUpdate}
            onSeeking={handleTimeUpdate}
            onSeeked={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={handlePause}
            onEnded={handleEnded}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: '#000',
              cursor: 'pointer',
            }}
            playsInline
          />

          {/* Resume Playback Toast with Restart Button */}
          {resumeToast && (
            <div
              style={{
                position: 'absolute',
                top: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(10, 21, 12, 0.95)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid #aeea00',
                borderRadius: '30px',
                padding: '6px 10px 6px 18px',
                color: '#fcfdf7',
                fontSize: '13.5px',
                fontWeight: 700,
                zIndex: 35,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.8), 0 0 16px rgba(174, 234, 0, 0.35)',
                pointerEvents: 'auto',
                animation: 'fadeIn 0.25s ease',
              }}
            >
              <span>{resumeToast}</span>
              <button
                type="button"
                onClick={handleRestartFromBeginning}
                style={{
                  background: 'rgba(174, 234, 0, 0.16)',
                  border: '1px solid rgba(174, 234, 0, 0.55)',
                  color: '#aeea00',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#aeea00';
                  e.currentTarget.style.color = '#0a150c';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(174, 234, 0, 0.16)';
                  e.currentTarget.style.color = '#aeea00';
                }}
                title="Tua lại xem từ đầu (00:00)"
              >
                <span>↺</span>
                <span>Xem lại từ đầu</span>
              </button>
            </div>
          )}

          {/* 1. TOP-RIGHT WATERMARK: Bơ Film 4K */}
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
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <img
              src="/logo.png"
              alt="Bơ Film"
              style={{ height: '24px', width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 2px 6px rgba(174, 234, 0, 0.4))' }}
            />
            <span style={{ color: '#aeea00' }}>Bơ</span>
            <span style={{ color: '#fcfdf7' }}>Film</span>
            <span style={{ color: '#aeea00', fontSize: '15px', fontWeight: 700, marginLeft: '2px' }}>4K</span>
          </div>

          {/* Stream Recovery / Refresh Notice */}
          {streamNotice && (
            <div
              style={{
                position: 'absolute',
                top: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(10, 21, 12, 0.94)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(174, 234, 0, 0.45)',
                borderRadius: '30px',
                padding: '7px 20px',
                color: '#fcfdf7',
                fontSize: '13px',
                fontWeight: 600,
                zIndex: 30,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#aeea00',
                  boxShadow: '0 0 8px #aeea00',
                }}
              />
              <span>{streamNotice}</span>
            </div>
          )}

          {/* 2. TOP-LEFT STATS BUTTON: ~ THỐNG KÊ */}
          <button
            type="button"
            onClick={() => setShowStats(!showStats)}
            style={{
              position: 'absolute',
              top: '20px',
              left: '24px',
              background: showStats ? 'rgba(174, 234, 0, 0.22)' : 'rgba(10, 21, 12, 0.75)',
              border: showStats ? '1px solid #aeea00' : '1px solid rgba(40, 84, 54, 0.5)',
              borderRadius: '999px',
              padding: '6px 14px',
              color: showStats ? '#aeea00' : '#fcfdf7',
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
            <Activity size={13} color={showStats ? '#aeea00' : '#fff'} />
            <span>THỐNG KÊ</span>
          </button>

          {/* 3. STATS OVERLAY CARD (Stats for nerds: Resolution, FPS, Dropped frames, Buffer length, Network speed, Bitrate) */}
          {showStats && (
            <div
              style={{
                position: 'absolute',
                top: '60px',
                left: '24px',
                background: 'rgba(10, 21, 12, 0.94)',
                backdropFilter: 'blur(16px)',
                border: '1px solid #1e3f28',
                borderRadius: '12px',
                padding: '12px 18px',
                width: '260px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '12.5px',
                color: '#eef2fa',
                zIndex: 25,
                boxShadow: '0 16px 36px rgba(0,0,0,0.85)',
                lineHeight: 1.85,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  borderBottom: '1px solid rgba(40, 84, 54, 0.4)',
                  paddingBottom: '4px',
                  marginBottom: '6px',
                  color: '#aeea00',
                  fontSize: '11px',
                  letterSpacing: '0.05em',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>THÔNG SỐ KỸ THUẬT</span>
                <button
                  type="button"
                  onClick={() => setShowStats(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted, #8b95ad)',
                    cursor: 'pointer',
                    padding: '0 4px',
                    fontSize: '14px',
                    lineHeight: 1,
                    transition: 'color 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted, #8b95ad)')}
                  title="Đóng (Esc)"
                >
                  ✕
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Độ phân giải</span>
                <span style={{ fontWeight: 700 }}>{activeResolution}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Khung hình (FPS)</span>
                <span style={{ fontWeight: 700 }}>{fps}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Khung hình bị rớt</span>
                <span style={{ fontWeight: 600, color: droppedFrames > 5 ? '#fbbf24' : '#eef2fa' }}>
                  {droppedFrames}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Độ dài bộ đệm</span>
                <span style={{ fontWeight: 600 }}>{bufferLengthSec.toFixed(1)} s</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Tốc độ mạng</span>
                <span style={{ fontWeight: 700, color: '#46d369' }}>{streamStats.speedMbps}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Tốc độ bit (Bitrate)</span>
                <span style={{ fontWeight: 600 }}>{activeBitrate}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted, #8b95ad)' }}>Âm thanh</span>
                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeAudioName}
                </span>
              </div>
            </div>
          )}

          {/* 4. SUBTITLE CUES DISPLAY (Centered Bottom, No Gray Box, Heavy Contrast Stroke) */}
          {currentSubtitleText && selectedCaption !== 'Tắt' && (
            <div
              style={{
                position: 'absolute',
                bottom: controlsVisible ? '78px' : '36px',
                left: '50%',
                transform: 'translateX(-50%)',
                textAlign: 'center',
                pointerEvents: 'none',
                zIndex: 20,
                transition: 'bottom 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                width: '90%',
                maxWidth: '900px',
              }}
            >
              <span
                style={{
                  color: subtitleSettings.fontColor,
                  fontSize: subtitleFontSize,
                  fontWeight: 650,
                  lineHeight: 1.35,
                  display: 'inline-block',
                  whiteSpace: 'pre-line',
                  letterSpacing: '0.01em',
                  fontFamily: 'var(--font-body, "Inter", -apple-system, BlinkMacSystemFont, sans-serif)',
                  transition: 'all 0.15s ease',
                  userSelect: 'none',
                  ...subtitleBgProps,
                }}
              >
                {currentSubtitleText}
              </span>
            </div>
          )}

          {/* 5. SETTINGS POPUP MENU (Quality, Audio, Speed, Captions) */}
          {settingsOpen && (
            <div
              ref={settingsRef}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: '72px',
                right: '24px',
                width: settingsMenu === 'captions' ? '320px' : '280px',
                maxHeight: settingsMenu === 'captions' ? 'min(580px, calc(100vh - 96px))' : 'min(480px, calc(100vh - 120px))',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: 'rgba(17, 22, 34, 0.96)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '14px',
                zIndex: 50,
                boxShadow: '0 20px 48px -8px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.12)',
                color: '#fff',
                fontSize: '13.5px',
                transition: 'width 0.2s ease',
              }}
            >
              {/* Main Settings Menu */}
              {settingsMenu === 'main' && (
                <div
                  className="cinema-menu-scroll"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '8px 6px',
                    overflowY: 'auto',
                    flex: 1,
                    maxHeight: '380px',
                    overscrollBehavior: 'contain',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  {/* Quality row */}
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('quality')}
                    style={{
                      minHeight: '40px',
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'background 0.15s ease, color 0.15s ease',
                      width: '100%',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Sliders size={16} color="var(--muted-light, #b4bdd0)" />
                      <span>Chất lượng</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted, #8b95ad)' }}>
                      <span>{activeQualityLabel}</span>
                      <ChevronRight size={15} />
                    </div>
                  </button>

                  {/* Audio row */}
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('audio')}
                    style={{
                      minHeight: '40px',
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'background 0.15s ease, color 0.15s ease',
                      width: '100%',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Headphones size={16} color="var(--muted-light, #b4bdd0)" />
                      <span>Âm thanh</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted, #8b95ad)' }}>
                      <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {activeAudioName}
                      </span>
                      <ChevronRight size={15} />
                    </div>
                  </button>

                  {/* Speed row */}
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('speed')}
                    style={{
                      minHeight: '40px',
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'background 0.15s ease, color 0.15s ease',
                      width: '100%',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Gauge size={16} color="var(--muted-light, #b4bdd0)" />
                      <span>Tốc độ phát</span>
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
                      minHeight: '40px',
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'background 0.15s ease, color 0.15s ease',
                      width: '100%',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Subtitles size={16} color="var(--muted-light, #b4bdd0)" />
                      <span>Phụ đề</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted, #8b95ad)' }}>
                      <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedCaption}
                      </span>
                      <ChevronRight size={15} />
                    </div>
                  </button>

                  {/* Auto Next Episode Toggle */}
                  <div
                    style={{
                      minHeight: '40px',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'background 0.15s ease',
                      width: '100%',
                    }}
                    onClick={handleToggleAutoNext}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Film size={16} color="var(--muted-light, #b4bdd0)" />
                      <span>Tự động chuyển tập</span>
                    </div>
                    <div
                      style={{
                        width: '38px',
                        height: '22px',
                        borderRadius: '999px',
                        background: autoNextEnabled ? '#aeea00' : 'rgba(255, 255, 255, 0.2)',
                        position: 'relative',
                        transition: 'background 0.2s ease',
                      }}
                    >
                      <div
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          background: autoNextEnabled ? '#070e08' : '#cbd8cb',
                          position: 'absolute',
                          top: '3px',
                          left: autoNextEnabled ? '19px' : '3px',
                          transition: 'left 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Quality Submenu */}
              {settingsMenu === 'quality' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('main')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-light, #b4bdd0)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 12px 8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 700,
                      width: '100%',
                      flexShrink: 0,
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      textAlign: 'left',
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)')}
                  >
                    <ChevronLeft size={16} />
                    <span>Chất lượng</span>
                  </button>

                  <div
                    className="cinema-menu-scroll"
                    style={{
                      overflowY: 'auto',
                      flex: 1,
                      maxHeight: '340px',
                      padding: '6px',
                      overscrollBehavior: 'contain',
                      WebkitOverflowScrolling: 'touch',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    {/* Auto (1080p) or Auto (1600p) */}
                    <button
                      type="button"
                      onClick={() => handleSelectQuality(-1)}
                      style={{
                        minHeight: '40px',
                        background: activeQuality === -1 ? 'rgba(255, 255, 255, 0.10)' : 'none',
                        border: 'none',
                        color: activeQuality === -1 ? '#fff' : 'var(--muted-light, #b4bdd0)',
                        padding: '9px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        borderRadius: '8px',
                        fontWeight: activeQuality === -1 ? 700 : 500,
                        transition: 'background 0.15s ease, color 0.15s ease',
                        width: '100%',
                      }}
                      onMouseEnter={(e) => {
                        if (activeQuality !== -1) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                          e.currentTarget.style.color = '#fff';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (activeQuality !== -1) {
                          e.currentTarget.style.background = 'none';
                          e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)';
                        }
                      }}
                    >
                      <span>Tự động ({autoQualityLabel})</span>
                      {activeQuality === -1 && <Check size={16} color="#fff" />}
                    </button>

                    {/* Quality levels sorted from high to low */}
                    {sortedQualities.map((q) => {
                      const info = getQualityDisplayInfo(q.height, q.width);
                      const isSelected = activeQuality === q.id;
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => handleSelectQuality(q.id)}
                          style={{
                            minHeight: '40px',
                            background: isSelected ? 'rgba(255, 255, 255, 0.10)' : 'none',
                            border: 'none',
                            color: isSelected ? '#fff' : 'var(--muted-light, #b4bdd0)',
                            padding: '9px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            fontWeight: isSelected ? 700 : 500,
                            transition: 'background 0.15s ease, color 0.15s ease',
                            width: '100%',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                              e.currentTarget.style.color = '#fff';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'none';
                              e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)';
                            }
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                            {info.label}
                            <span
                              style={{
                                fontSize: '10px',
                                marginLeft: '4px',
                                fontWeight: 800,
                                color: info.badgeColor,
                                verticalAlign: 'super',
                              }}
                            >
                              {info.badge}
                            </span>
                          </span>
                          {isSelected && <Check size={16} color="#fff" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Audio Submenu */}
              {settingsMenu === 'audio' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('main')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-light, #b4bdd0)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 12px 8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 700,
                      width: '100%',
                      flexShrink: 0,
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      textAlign: 'left',
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)')}
                  >
                    <ChevronLeft size={16} />
                    <span>Âm thanh</span>
                  </button>

                  <div
                    className="cinema-menu-scroll"
                    style={{
                      overflowY: 'auto',
                      flex: 1,
                      maxHeight: '340px',
                      padding: '6px',
                      overscrollBehavior: 'contain',
                      WebkitOverflowScrolling: 'touch',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    {displayAudioTracks.length > 0 ? (
                      displayAudioTracks.map((tr) => {
                        const isSelected = String(activeAudioTrack) === String(tr.id);
                        return (
                          <button
                            key={tr.id}
                            type="button"
                            onClick={() => handleSelectAudio(tr.id, tr.name)}
                            style={{
                              minHeight: '40px',
                              background: isSelected ? 'rgba(255, 255, 255, 0.10)' : 'none',
                              border: 'none',
                              color: isSelected ? '#fff' : 'var(--muted-light, #b4bdd0)',
                              padding: '9px 14px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              cursor: 'pointer',
                              borderRadius: '8px',
                              fontWeight: isSelected ? 700 : 500,
                              transition: 'background 0.15s ease, color 0.15s ease',
                              width: '100%',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                                e.currentTarget.style.color = '#fff';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.background = 'none';
                                e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)';
                              }
                            }}
                          >
                            <span>{tr.name}</span>
                            {isSelected && <Check size={16} color="#fff" />}
                          </button>
                        );
                      })
                    ) : (
                      <div style={{ padding: '12px 14px', color: 'var(--muted, #8b95ad)', fontSize: '13px' }}>
                        Âm thanh mặc định
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Speed Submenu */}
              {settingsMenu === 'speed' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('main')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-light, #b4bdd0)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 12px 8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 700,
                      width: '100%',
                      flexShrink: 0,
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      textAlign: 'left',
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)')}
                  >
                    <ChevronLeft size={16} />
                    <span>Tốc độ phát</span>
                  </button>

                  <div
                    className="cinema-menu-scroll"
                    style={{
                      overflowY: 'auto',
                      flex: 1,
                      maxHeight: '340px',
                      padding: '6px',
                      overscrollBehavior: 'contain',
                      WebkitOverflowScrolling: 'touch',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => {
                      const isSelected = playbackSpeed === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => handleSelectSpeed(s)}
                          style={{
                            minHeight: '40px',
                            background: isSelected ? 'rgba(255, 255, 255, 0.10)' : 'none',
                            border: 'none',
                            color: isSelected ? '#fff' : 'var(--muted-light, #b4bdd0)',
                            padding: '9px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            fontWeight: isSelected ? 700 : 500,
                            transition: 'background 0.15s ease, color 0.15s ease',
                            width: '100%',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                              e.currentTarget.style.color = '#fff';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'none';
                              e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)';
                            }
                          }}
                        >
                          <span>{s === 1 ? 'Chuẩn (1×)' : `${s}×`}</span>
                          {isSelected && <Check size={16} color="#fff" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Captions Submenu */}
              {settingsMenu === 'captions' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setSettingsMenu('main')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-light, #b4bdd0)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 12px 8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 700,
                      width: '100%',
                      flexShrink: 0,
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      textAlign: 'left',
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)')}
                  >
                    <ChevronLeft size={16} />
                    <span>Phụ đề</span>
                  </button>

                  <div
                    className="cinema-menu-scroll"
                    style={{
                      overflowY: 'auto',
                      flex: 1,
                      maxHeight: '520px',
                      padding: '6px',
                      overscrollBehavior: 'contain',
                      WebkitOverflowScrolling: 'touch',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    {/* Bounded list of subtitle languages */}
                    <div
                      className="cinema-menu-scroll"
                      style={{
                        maxHeight: '260px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        paddingRight: '4px',
                        paddingBottom: '6px',
                      }}
                    >
                      {/* Off / Tắt option */}
                      <button
                        type="button"
                        onClick={() => handleSelectCaption('Tắt')}
                        style={{
                          minHeight: '38px',
                          background: selectedCaption === 'Tắt' ? 'rgba(255, 255, 255, 0.10)' : 'none',
                          border: 'none',
                          color: selectedCaption === 'Tắt' ? '#fff' : 'var(--muted-light, #b4bdd0)',
                          padding: '8px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          borderRadius: '8px',
                          fontWeight: selectedCaption === 'Tắt' ? 700 : 500,
                          transition: 'background 0.15s ease, color 0.15s ease',
                          width: '100%',
                        }}
                        onMouseEnter={(e) => {
                          if (selectedCaption !== 'Tắt') {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                            e.currentTarget.style.color = '#fff';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedCaption !== 'Tắt') {
                            e.currentTarget.style.background = 'none';
                            e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)';
                          }
                        }}
                      >
                        <span>Tắt {availableSubtitleOptions.length === 0 ? '(Không có phụ đề)' : ''}</span>
                        {selectedCaption === 'Tắt' && <Check size={16} color="#fff" />}
                      </button>

                      {/* Available Subtitle Tracks from DB, Episodes, and Manifest */}
                      {availableSubtitleOptions.map((opt) => {
                        const isSelected = selectedCaption === opt.label;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleSelectCaption(opt.label)}
                            style={{
                              minHeight: '38px',
                              background: isSelected ? 'rgba(255, 255, 255, 0.10)' : 'none',
                              border: 'none',
                              color: isSelected ? '#fff' : 'var(--muted-light, #b4bdd0)',
                              padding: '8px 12px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              cursor: 'pointer',
                              borderRadius: '8px',
                              fontWeight: isSelected ? 700 : 500,
                              transition: 'background 0.15s ease, color 0.15s ease',
                              width: '100%',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                                e.currentTarget.style.color = '#fff';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.background = 'none';
                                e.currentTarget.style.color = 'var(--muted-light, #b4bdd0)';
                              }
                            }}
                          >
                            <span
                              style={{
                                maxWidth: '225px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                textAlign: 'left',
                              }}
                            >
                              {opt.label}
                            </span>
                            {isSelected && <Check size={16} color="#fff" style={{ flexShrink: 0 }} />}
                          </button>
                        );
                      })}
                    </div>

                    {/* Divider */}
                    <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 4px 6px' }} />

                    {/* 🎨 Tùy chỉnh hiển thị phụ đề */}
                    <div style={{ padding: '2px 4px 6px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          color: '#e4b049',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>🎨 Tùy chỉnh hiển thị phụ đề</span>
                      </div>

                      {/* Kích thước chữ */}
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--muted-light, #b4bdd0)', marginBottom: '5px', fontWeight: 600 }}>
                          Kích thước chữ
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                          {[
                            { id: 'small', label: 'Nhỏ (18px)' },
                            { id: 'medium', label: 'Chuẩn (24px)' },
                            { id: 'large', label: 'Lớn (30px)' },
                          ].map((sizeOpt) => {
                            const isSelected = subtitleSettings.fontSize === sizeOpt.id;
                            return (
                              <button
                                key={sizeOpt.id}
                                type="button"
                                onClick={() => updateSubtitleSettings({ fontSize: sizeOpt.id as any })}
                                style={{
                                  padding: '6px 2px',
                                  fontSize: '11px',
                                  fontWeight: isSelected ? 700 : 500,
                                  color: isSelected ? '#0d1117' : 'var(--muted-light, #b4bdd0)',
                                  background: isSelected ? '#e4b049' : 'rgba(255, 255, 255, 0.06)',
                                  border: isSelected ? '1px solid #e4b049' : '1px solid rgba(255, 255, 255, 0.08)',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  textAlign: 'center',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                {sizeOpt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Màu sắc chữ */}
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--muted-light, #b4bdd0)', marginBottom: '5px', fontWeight: 600 }}>
                          Màu sắc chữ
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                          {[
                            { color: '#ffffff', label: '⚪ Trắng' },
                            { color: '#e4b049', label: '🥑 Vàng Bơ' },
                            { color: '#aeea00', label: '🟡 Xanh Neon' },
                          ].map((colorOpt) => {
                            const isSelected = subtitleSettings.fontColor === colorOpt.color;
                            return (
                              <button
                                key={colorOpt.color}
                                type="button"
                                onClick={() => updateSubtitleSettings({ fontColor: colorOpt.color })}
                                style={{
                                  padding: '6px 2px',
                                  fontSize: '11px',
                                  fontWeight: isSelected ? 700 : 500,
                                  color: isSelected ? '#0d1117' : 'var(--muted-light, #b4bdd0)',
                                  background: isSelected ? '#e4b049' : 'rgba(255, 255, 255, 0.06)',
                                  border: isSelected ? '1px solid #e4b049' : '1px solid rgba(255, 255, 255, 0.08)',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  textAlign: 'center',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                {colorOpt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Kiểu nền */}
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--muted-light, #b4bdd0)', marginBottom: '5px', fontWeight: 600 }}>
                          Kiểu nền
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                          {[
                            { id: 'outline', label: 'Viền đen' },
                            { id: 'semi', label: 'Nền đen mờ' },
                            { id: 'solid', label: 'Hộp đen đặc' },
                          ].map((bgOpt) => {
                            const isSelected = subtitleSettings.bgStyle === bgOpt.id;
                            return (
                              <button
                                key={bgOpt.id}
                                type="button"
                                onClick={() => updateSubtitleSettings({ bgStyle: bgOpt.id as any })}
                                style={{
                                  padding: '6px 2px',
                                  fontSize: '11px',
                                  fontWeight: isSelected ? 700 : 500,
                                  color: isSelected ? '#0d1117' : 'var(--muted-light, #b4bdd0)',
                                  background: isSelected ? '#e4b049' : 'rgba(255, 255, 255, 0.06)',
                                  border: isSelected ? '1px solid #e4b049' : '1px solid rgba(255, 255, 255, 0.08)',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  textAlign: 'center',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                {bgOpt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Live Preview Box */}
                      <div style={{ marginTop: '2px' }}>
                        <div
                          style={{
                            fontSize: '11px',
                            color: 'var(--muted-light, #b4bdd0)',
                            marginBottom: '6px',
                            fontWeight: 600,
                          }}
                        >
                          Khung xem trước trực quan
                        </div>
                        <div
                          style={{
                            borderRadius: '8px',
                            padding: '12px 8px',
                            minHeight: '52px',
                            background: 'radial-gradient(ellipse at center, #1e293b 0%, #0a0f1d 100%)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          <span
                            style={{
                              color: subtitleSettings.fontColor,
                              fontSize:
                                subtitleSettings.fontSize === 'small'
                                  ? '13px'
                                  : subtitleSettings.fontSize === 'large'
                                  ? '18px'
                                  : '15px',
                              fontWeight: 650,
                              lineHeight: 1.35,
                              display: 'inline-block',
                              backgroundColor:
                                subtitleSettings.bgStyle === 'solid'
                                  ? '#000000'
                                  : subtitleSettings.bgStyle === 'semi'
                                  ? 'rgba(0, 0, 0, 0.60)'
                                  : 'transparent',
                              padding: subtitleSettings.bgStyle === 'outline' ? '2px 4px' : '3px 10px',
                              borderRadius: subtitleSettings.bgStyle === 'outline' ? '0' : '4px',
                              textShadow:
                                subtitleSettings.bgStyle === 'outline'
                                  ? '-1.2px -1.2px 0 #000, 1.2px -1.2px 0 #000, -1.2px 1.2px 0 #000, 1.2px 1.2px 0 #000, 0 2px 4px rgba(0,0,0,0.9)'
                                  : '0 1px 2px rgba(0,0,0,0.8)',
                              fontFamily: 'var(--font-body, "Inter", -apple-system, BlinkMacSystemFont, sans-serif)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            🥑 Phụ đề mẫu Bơ Film
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 6. BOTTOM CUSTOM CONTROL BAR */}
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
                    background: '#2d5a37',
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
                    background: 'var(--accent, #aeea00)',
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
                  background: '#c6ff00',
                  boxShadow: '0 0 12px rgba(198, 255, 0, 0.8), 0 0 4px rgba(174, 234, 0, 0.9)',
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
                <button
                  type="button"
                  className="cinema-ctrl-btn"
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
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>

                {/* Volume & Inline Slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="cinema-ctrl-btn"
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
                      accentColor: 'var(--accent, #aeea00)',
                    }}
                  />
                </div>

                {/* Time Display */}
                <div style={{ fontSize: '13px', color: '#eef2fa', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                  <span>{formatTime(currentTime)}</span>
                  <span style={{ color: 'var(--muted, #8b95ad)', margin: '0 4px' }}>/</span>
                  <span style={{ color: 'var(--muted-light, #b4bdd0)' }}>{formatTime(duration || 8700)}</span>
                </div>
              </div>

              {/* Right Controls: Captions, Settings, AirPlay, PiP, Fullscreen */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {/* Captions button */}
                <button
                  type="button"
                  className="cinema-ctrl-btn"
                  onClick={() => {
                    if (selectedCaption === 'Tắt') {
                      if (availableSubtitleOptions.length > 0) {
                        handleSelectCaption(availableSubtitleOptions[0].label);
                      }
                    } else {
                      handleSelectCaption('Tắt');
                    }
                  }}
                  style={{
                    background: selectedCaption !== 'Tắt' ? 'rgba(174, 234, 0, 0.16)' : 'none',
                    border: 'none',
                    borderRadius: '6px',
                    color: selectedCaption !== 'Tắt' ? '#aeea00' : 'var(--muted, #8b95ad)',
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

                {/* Settings Gear button */}
                <button
                  ref={settingsBtnRef}
                  type="button"
                  className="cinema-ctrl-btn"
                  onClick={() => {
                    const next = !settingsOpen;
                    setSettingsOpen(next);
                    if (next) setSettingsMenu('main');
                  }}
                  style={{
                    background: settingsOpen ? 'rgba(174, 234, 0, 0.18)' : 'none',
                    border: 'none',
                    borderRadius: '8px',
                    color: settingsOpen ? '#aeea00' : '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '6px',
                    transition: 'all 0.15s',
                  }}
                  title="Cài đặt phát (Chất lượng, Âm thanh, Tốc độ, Phụ đề)"
                >
                  <Settings size={20} />
                </button>

                {/* Cast / AirPlay icon */}
                <button
                  type="button"
                  className="cinema-ctrl-btn"
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
                  className="cinema-ctrl-btn"
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
                  className="cinema-ctrl-btn"
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

          {/* Bottom-Right Countdown Next Episode Overlay */}
          {countdown !== null && nextEpisode && (
            <div
              className="auto-next-overlay"
              style={{
                position: 'absolute',
                bottom: controlsVisible ? '90px' : '24px',
                right: '24px',
                zIndex: 35,
                background: 'rgba(15, 34, 20, 0.96)',
                border: '1px solid #1e3f28',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.85), 0 0 20px rgba(174, 234, 0, 0.2)',
                borderRadius: '14px',
                padding: '16px 18px',
                maxWidth: '340px',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                color: '#fcfdf7',
                transition: 'bottom 0.25s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 700,
                    color: '#aeea00',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>Tập tiếp theo sau</span>
                  <span
                    style={{
                      background: '#aeea00',
                      color: '#070e08',
                      borderRadius: '50%',
                      width: '20px',
                      height: '20px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 800,
                    }}
                  >
                    {countdown}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCountdown(null);
                    countdownDismissedRef.current = true;
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted, #94a896)',
                    cursor: 'pointer',
                    padding: '2px 6px',
                    fontSize: '12px',
                    borderRadius: '4px',
                  }}
                  title="Hủy chuyển tập"
                >
                  ✕ Hủy
                </button>
              </div>

              <div
                style={{
                  fontSize: '13.5px',
                  fontWeight: 700,
                  marginBottom: '12px',
                  color: '#fff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Tập {nextEpisode.episode}: {nextEpisode.title || `Tập ${nextEpisode.episode}`}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setCountdown(null);
                    handleSelectEpisode(nextEpisode);
                  }}
                  style={{
                    flex: 1,
                    padding: '7px 14px',
                    fontSize: '13px',
                    fontWeight: 700,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    background: 'linear-gradient(135deg, #aeea00 0%, #84cc16 100%)',
                    color: '#070e08',
                    border: 'none',
                  }}
                >
                  ▶ Phát ngay
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setCountdown(null);
                    countdownDismissedRef.current = true;
                  }}
                  style={{
                    padding: '7px 12px',
                    fontSize: '13px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  Hủy
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Server Selection Chips / Badge */}
        <div className="wrap" style={{ maxWidth: '1100px', margin: '16px auto 0' }}>
          <div className="servers" style={{ padding: 0, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted, #8b95ad)', marginRight: '4px' }}>
              Máy chủ phát:
            </span>
            {availableServers.length > 1 ? (
              availableServers.map((src, i) => {
                const isSelected = currentSource?.hlsUrl === src.hlsUrl || currentSource?.label === src.label;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`chip ${isSelected ? 'on' : ''}`}
                    onClick={() => handleSelectServer(src)}
                    style={{ cursor: 'pointer' }}
                  >
                    {src.label || `Server ${i + 1}`}
                  </button>
                );
              })
            ) : (
              <span className="chip on" style={{ cursor: 'default' }}>
                Server VIP (4K CDN)
              </span>
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
              {activeAudioName}
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
