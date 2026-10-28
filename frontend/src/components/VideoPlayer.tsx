import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Maximize2,
  Minimize2,
  Lightbulb,
  LightbulbOff,
  RefreshCw,
  AlertCircle,
  Loader2,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  Volume1,
  VolumeX,
  SkipForward,
  SkipBack,
  ListVideo,
  Check,
  X,
  Clock,
  Sun,
  ChevronsLeft,
  ChevronsRight,
  PictureInPicture2,
  FastForward,
  Settings,
  SlidersHorizontal,
  MonitorPlay,
  Keyboard,
  Share2,
  Gauge,
  Captions,
  Type,
  FileUp,
  Info,
  ImageOff,
  Sparkles,
  Link2,
  Activity,
  Palette,
  Contrast,
  Waves,
  AudioLines,
  Moon,
} from 'lucide-react';
import {
  saveHistory,
  getImageUrl,
  savePlaybackPosition,
  getPlaybackPosition,
  clearPlaybackPosition,
  formatTime,
} from '../utils';
import { Film4kFragmentLoader, resetCumulativeBytes } from '../utils/hlsLoader';

type EqPreset = 'flat' | 'bass-boost' | 'vocal-clarity' | 'virtual-surround';

type ColorPreset = 'normal' | 'cinema' | 'vivid' | 'warm' | 'night';

export interface VideoFilterValues {
  brightness: number;
  contrast: number;
  saturation: number;
}

const DEFAULT_FILTER: VideoFilterValues = { brightness: 1, contrast: 1, saturation: 1 };

const FILTER_PRESETS: Record<
  ColorPreset,
  { label: string; values: VideoFilterValues }
> = {
  normal: { label: 'Chuẩn', values: { brightness: 1, contrast: 1, saturation: 1 } },
  cinema: { label: 'Điện ảnh (Cinema)', values: { brightness: 0.95, contrast: 1.12, saturation: 0.9 } },
  vivid: { label: 'Rực rỡ (Vivid)', values: { brightness: 1.05, contrast: 1.18, saturation: 1.35 } },
  warm: { label: 'Ấm áp (Warm)', values: { brightness: 1.02, contrast: 1.05, saturation: 1.2 } },
  night: { label: 'Xem đêm (Night)', values: { brightness: 0.8, contrast: 0.95, saturation: 0.85 } },
};

const clampFilterValue = (val: number) =>
  Math.min(2, Math.max(0.5, Math.round(val * 100) / 100));

const filterEqualsPreset = (
  values: VideoFilterValues,
  preset: VideoFilterValues
) =>
  Math.abs(values.brightness - preset.brightness) < 0.011 &&
  Math.abs(values.contrast - preset.contrast) < 0.011 &&
  Math.abs(values.saturation - preset.saturation) < 0.011;

const buildFilterCss = (values: VideoFilterValues) => {
  const parts: string[] = [];
  if (Math.abs(values.brightness - 1) > 0.011) parts.push(`brightness(${values.brightness})`);
  if (Math.abs(values.contrast - 1) > 0.011) parts.push(`contrast(${values.contrast})`);
  if (Math.abs(values.saturation - 1) > 0.011) parts.push(`saturate(${values.saturation})`);
  return parts.length > 0 ? parts.join(' ') : undefined;
};

const EQ_PRESETS: Record<
  EqPreset,
  { label: string; gains: [number, number, number] }
> = {
  flat: { label: 'Phẳng (Flat)', gains: [0, 0, 0] },
  'bass-boost': { label: 'Tăng trầm (Bass Boost)', gains: [8, -1, -1] },
  'vocal-clarity': { label: 'Nổi thoại (Vocal Clarity)', gains: [-2, 5, 2] },
  'virtual-surround': { label: 'Vây kín (Virtual Surround)', gains: [2, -3, 4] },
};

const SUBTITLE_COLORS: { value: string; label: string }[] = [
  { value: '#ffffff', label: 'Trắng' },
  { value: '#fde047', label: 'Vàng' },
  { value: '#67e8f9', label: 'Xanh' },
  { value: '#f9a8d4', label: 'Hồng' },
];

interface PlayerPrefs {
  eqPreset: EqPreset;
  subtitleDelay: number;
  subtitleSize: 'sm' | 'md' | 'lg';
  subtitleColor: string;
  colorFilter: VideoFilterValues;
  showHealthGauge: boolean;
}

const PREFS_KEY = 'bofilm_player_prefs';

const loadPlayerPrefs = (): PlayerPrefs => {
  const defaults: PlayerPrefs = {
    eqPreset: 'flat',
    subtitleDelay: 0,
    subtitleSize: 'md',
    subtitleColor: '#ffffff',
    colorFilter: DEFAULT_FILTER,
    showHealthGauge: false,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs>;
    return {
      eqPreset:
        parsed.eqPreset && parsed.eqPreset in EQ_PRESETS ? parsed.eqPreset : defaults.eqPreset,
      subtitleDelay:
        typeof parsed.subtitleDelay === 'number' && parsed.subtitleDelay >= -5 && parsed.subtitleDelay <= 5
          ? parsed.subtitleDelay
          : defaults.subtitleDelay,
      subtitleSize:
        parsed.subtitleSize === 'sm' || parsed.subtitleSize === 'md' || parsed.subtitleSize === 'lg'
          ? parsed.subtitleSize
          : defaults.subtitleSize,
      subtitleColor: SUBTITLE_COLORS.some((c) => c.value === parsed.subtitleColor)
        ? (parsed.subtitleColor as string)
        : defaults.subtitleColor,
      colorFilter:
        parsed.colorFilter && typeof parsed.colorFilter === 'object'
          ? {
              brightness: clampFilterValue(Number(parsed.colorFilter.brightness) || 1),
              contrast: clampFilterValue(Number(parsed.colorFilter.contrast) || 1),
              saturation: clampFilterValue(Number(parsed.colorFilter.saturation) || 1),
            }
          : defaults.colorFilter,
      showHealthGauge:
        typeof parsed.showHealthGauge === 'boolean'
          ? parsed.showHealthGauge
          : false,
    };
  } catch {
    return defaults;
  }
};

const shiftVtt = (vtt: string, offset: number): string => {
  if (!offset) return vtt;
  const clampFmt = (sec: number) => {
    const s = Math.max(0, sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = (s % 60).toFixed(3).padStart(6, '0');
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${ss}`;
  };
  const parseTs = (ts: string) => {
    const [h, m, s] = ts.split(':');
    return Number(h) * 3600 + Number(m) * 60 + parseFloat(s);
  };
  return vtt.replace(
    /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/g,
    (_match, a: string, b: string) => `${clampFmt(parseTs(a) + offset)} --> ${clampFmt(parseTs(b) + offset)}`
  );
};

interface HlsLevelInfo {
  height?: number;
  bitrate?: number;
}

interface VideoPlayerProps {
  embedUrl: string;
  m3u8Url?: string;
  serverIndex?: number;
  movieName: string;
  movieSlug: string;
  episodeName: string;
  episodeSlug: string;
  posterUrl: string;
  playerMode?: 'hls' | 'embed';
  onPlayerModeChange?: (mode: 'hls' | 'embed') => void;
  nextEpisode?: { name: string; slug: string };
  onNextEpisode?: () => void;
  prevEpisode?: { name: string; slug: string };
  onPrevEpisode?: () => void;
  allEpisodes?: { name: string; slug: string }[];
  currentEpisodeSlug?: string;
  onSelectEpisode?: (slug: string) => void;
  isTheater?: boolean;
  onToggleTheater?: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  embedUrl,
  m3u8Url,
  serverIndex,
  movieName,
  movieSlug,
  episodeName,
  episodeSlug,
  posterUrl,
  playerMode: playerModeProp,
  onPlayerModeChange,
  nextEpisode,
  onNextEpisode,
  prevEpisode,
  onPrevEpisode,
  allEpisodes,
  currentEpisodeSlug,
  onSelectEpisode,
  isTheater: isTheaterProp,
  onToggleTheater,
}) => {
  const [isTheaterInternal, setIsTheaterInternal] = useState(false);
  const isTheater = isTheaterProp !== undefined ? isTheaterProp : isTheaterInternal;
  const toggleTheater = () => {
    if (onToggleTheater) {
      onToggleTheater();
    } else {
      setIsTheaterInternal((prev) => !prev);
    }
  };
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [isDimmed, setIsDimmed] = useState(false);
  const [key, setKey] = useState(0);
  const [internalPlayerMode, setInternalPlayerMode] = useState<'hls' | 'embed'>(
    playerModeProp || (m3u8Url || movieSlug ? 'hls' : 'embed')
  );
  const playerMode = playerModeProp !== undefined ? playerModeProp : internalPlayerMode;

  const setPlayerMode = (mode: 'hls' | 'embed') => {
    setInternalPlayerMode(mode);
    onPlayerModeChange?.(mode);
  };

  useEffect(() => {
    if (playerModeProp !== undefined) {
      setInternalPlayerMode(playerModeProp);
      if (playerModeProp === 'embed') {
        isManualModeRef.current = true;
      } else if (playerModeProp === 'hls') {
        isManualModeRef.current = false;
        hlsFallbackErrorRef.current = false;
      }
    }
  }, [playerModeProp]);

  const [autoIngested, setAutoIngested] = useState(false);
  const [isInitializingHls, setIsInitializingHls] = useState(false);

  // ===== Timestamp URL Deep Linking (?t=seconds) =====
  const getDeepLinkTime = (): number => {
    if (typeof window === 'undefined') return 0;
    try {
      const t = Number(new URLSearchParams(window.location.search).get('t'));
      return Number.isFinite(t) && t > 0 ? t : 0;
    } catch {
      return 0;
    }
  };
  const [deepLinkTime, setDeepLinkTime] = useState<number>(() => getDeepLinkTime());

  useEffect(() => {
    setDeepLinkTime(getDeepLinkTime());
  }, [movieSlug, episodeSlug]);

  // Modern Player Controls States
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedRatio, setBufferedRatio] = useState(0);
  const [volume, setVolume] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const saved = localStorage.getItem('bofilm_player_volume');
    return saved !== null ? parseFloat(saved) : 1;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const saved = localStorage.getItem('bofilm_player_speed');
    const parsed = saved !== null ? parseFloat(saved) : 1;
    return Number.isFinite(parsed) && parsed >= 0.25 && parsed <= 3 ? parsed : 1;
  });
  const [hlsLevels, setHlsLevels] = useState<HlsLevelInfo[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [activeHeight, setActiveHeight] = useState<number>(0);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [menuMaxHeight, setMenuMaxHeight] = useState<number | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);

  // Player preferences (defined first to prevent any TDZ ReferenceError)
  const [prefs, setPrefs] = useState<PlayerPrefs>(() => loadPlayerPrefs());

  const [brightness, setBrightness] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('bofilm_player_brightness');
      if (saved) {
        const val = Number(saved);
        if (Number.isFinite(val) && val >= 0.3 && val <= 1.8) return val;
      }
    } catch {}
    return DEFAULT_FILTER.brightness;
  });
  const [contrast, setContrast] = useState<number>(() => DEFAULT_FILTER.contrast);
  const [saturation, setSaturation] = useState<number>(() => DEFAULT_FILTER.saturation);
  const [touchHud, setTouchHud] = useState<{
    type: 'seek' | 'brightness' | 'volume';
    value?: number;
    targetTime?: number;
    deltaSeconds?: number;
    duration?: number;
  } | null>(null);
  const [doubleTapEffect, setDoubleTapEffect] = useState<{
    side: 'left' | 'right';
    count: number;
    id: number;
  } | null>(null);

  const [feedback, setFeedback] = useState<{
    text: string;
    icon?: 'play' | 'pause' | 'seek-forward' | 'seek-backward' | 'volume';
    id: number;
  } | null>(null);

  // ===== Pro Tools: Stats for Nerds =====
  const [showStats, setShowStats] = useState(false);

  // ===== Pro Tools: Custom Subtitles (.srt / .vtt) =====
  interface ParsedSubtitle {
    name: string;
    url: string;
    size: 'sm' | 'md' | 'lg';
    color: string;
    enabled: boolean;
  }
  const [subtitle, setSubtitle] = useState<ParsedSubtitle | null>(null);
  const subtitleFileRef = useRef<HTMLInputElement | null>(null);
  const baseVttRef = useRef<string | null>(null);
  const subtitleVersionRef = useRef(0);

  // ===== Audio Equalizer Preset (BiquadFilterNodes) =====
  const [eqPreset, setEqPreset] = useState<EqPreset>(() => prefs.eqPreset);
  const eqPresetRef = useRef<EqPreset>(eqPreset);
  eqPresetRef.current = eqPreset;
  const eqNodesRef = useRef<BiquadFilterNode[] | null>(null);

  // ===== Subtitle Sync Delay (timing nudge -5s .. +5s) =====
  const [subtitleDelay, setSubtitleDelay] = useState<number>(() => prefs.subtitleDelay);

  // ===== Stream Health & Buffer Gauge =====
  const [showHealthGauge, setShowHealthGauge] = useState<boolean>(false);
  const [videoFilter, setVideoFilter] = useState<string | undefined>(() =>
    buildFilterCss(prefs.colorFilter)
  );
  useEffect(() => {
    setVideoFilter(buildFilterCss({ brightness, contrast, saturation }));
  }, [brightness, contrast, saturation]);
  const [bufferHealth, setBufferHealth] = useState<{
    ahead: number;
    bandwidthMb: number | null;
  }>({ ahead: 0, bandwidthMb: null });

  // ===== Persist combined player preferences (bofilm_player_prefs) =====
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      const prev = raw ? (JSON.parse(raw) as Partial<PlayerPrefs>) : {};
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          eqPreset,
          subtitleDelay,
          subtitleSize: subtitle?.size ?? prev.subtitleSize ?? 'md',
          subtitleColor: subtitle?.color ?? prev.subtitleColor ?? '#ffffff',
          colorFilter: { brightness, contrast, saturation },
          showHealthGauge,
        })
      );
    } catch {
      // ignore quota/storage errors
    }
  }, [
    eqPreset,
    subtitleDelay,
    subtitle?.size,
    subtitle?.color,
    brightness,
    contrast,
    saturation,
    showHealthGauge,
  ]);

  // Resume Playback Prompt State
  const [resumePrompt, setResumePrompt] = useState<{
    time: number;
    duration: number;
  } | null>(null);

  // Auto-Next Episode State
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);

  // Picture-in-Picture State
  const [isPip, setIsPip] = useState(false);
  const [isPipSupported, setIsPipSupported] = useState(false);

  // Audio Volume Booster State (100% - 200%)
  const [volumeBoost, setVolumeBoost] = useState<number>(() => {
    if (typeof window === 'undefined') return 100;
    const saved = localStorage.getItem('bofilm_player_boost');
    const parsed = saved !== null ? parseInt(saved, 10) : 100;
    return [100, 125, 150, 200].includes(parsed) ? parsed : 100;
  });
  const [boostUnsupported, setBoostUnsupported] = useState(false);

  // ===== Night Mode Audio Normalization (DynamicsCompressorNode) =====
  const [nightAudio, setNightAudio] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('bofilm_player_night_audio') === 'on';
  });
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const nightAudioRef = useRef<boolean>(nightAudio);
  nightAudioRef.current = nightAudio;

  const applyCompressorSettings = (
    node: DynamicsCompressorNode,
    enabled: boolean
  ) => {
    if (enabled) {
      // Strong compression: loud explosions & quiet dialogue both settle near a comfortable level
      node.threshold.value = -50;
      node.knee.value = 30;
      node.ratio.value = 12;
      node.attack.value = 0.003;
      node.release.value = 0.25;
    } else {
      // Effectively transparent (bypass)
      node.threshold.value = 0;
      node.knee.value = 0;
      node.ratio.value = 1;
      node.attack.value = 0.003;
      node.release.value = 0.25;
    }
  };

  // Apply night mode settings whenever toggled (persist preference too)
  useEffect(() => {
    localStorage.setItem('bofilm_player_night_audio', nightAudio ? 'on' : 'off');
    const node = compressorRef.current;
    if (node) applyCompressorSettings(node, nightAudio);
  }, [nightAudio]);

  // ===== Pitch Preservation for fine-tuned speeds =====
  const [pitchPreserve, setPitchPreserve] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('bofilm_player_pitch_preserve') !== 'off';
  });

  // ===== Audio-Only Data Saver Mode (animated wave visualizer) =====
  const [audioSaver, setAudioSaver] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('bofilm_player_audio_saver') === 'on';
  });

  // ===== In-Player Episode Switching (Drawer) =====
  const [showEpisodeDrawer, setShowEpisodeDrawer] = useState(false);

  // ===== Hold-to-2x Speed (Press & Hold) =====
  const [isBoosted, setIsBoosted] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActiveRef = useRef<boolean>(false);
  const savedRateRef = useRef<number>(1);

  // ===== Cinematic Ambient Glow Mode =====
  const [ambientGlow, setAmbientGlow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('bofilm_player_ambient_glow') === 'on';
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const seekbarRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastEpKeyRef = useRef<string>('');
  const lastStreamUrlRef = useRef<string>('');
  const savedPositionRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(true);
  const isManualModeRef = useRef<boolean>(playerModeProp === 'embed');
  const hlsFallbackErrorRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPosRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Touch gesture & HUD refs
  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    lastX: number;
    lastY: number;
    mode: 'none' | 'seek' | 'brightness' | 'volume';
    initialSeekTime: number;
    currentSeekTime: number;
    initialVolume: number;
    initialBrightness: number;
    hasMoved: boolean;
  } | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapInfoRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const touchHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Feedback popup trigger
  const triggerFeedback = useCallback(
    (text: string, icon?: 'play' | 'pause' | 'seek-forward' | 'seek-backward' | 'volume') => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      setFeedback({ text, icon, id: Date.now() });
      feedbackTimeoutRef.current = setTimeout(() => {
        setFeedback(null);
      }, 850);
    },
    []
  );

  // Clean up HLS instance, cumulative bytes, timers on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = null;
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      if (touchHudTimerRef.current) {
        clearTimeout(touchHudTimerRef.current);
        touchHudTimerRef.current = null;
      }
      if (doubleTapTimerRef.current) {
        clearTimeout(doubleTapTimerRef.current);
        doubleTapTimerRef.current = null;
      }
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      resetCumulativeBytes();
    };
  }, []);

  // Click outside & Escape key listener for Speed + Settings menus
  useEffect(() => {
    if (!showSettingsMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showSettingsMenu]);

  // Dynamically bound Settings menu height inside video container so it never clips at the top
  useEffect(() => {
    if (!showSettingsMenu || !containerRef.current) return;
    const el = containerRef.current;
    const updateMaxHeight = () => {
      const containerH = el.clientHeight;
      // Controls bottom row is ~50px, mb-2 is 8px, top bar is ~44px; headroom 110px prevents clipping
      const available = containerH - 110;
      setMenuMaxHeight(Math.max(180, Math.floor(available)));
    };
    updateMaxHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateMaxHeight);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateMaxHeight);
    return () => window.removeEventListener('resize', updateMaxHeight);
  }, [showSettingsMenu]);

  // Default to HLS whenever new episode stream or movie is provided
  useEffect(() => {
    hlsFallbackErrorRef.current = false;
    resetCumulativeBytes();
    if (playerModeProp === 'embed') {
      isManualModeRef.current = true;
      return;
    }
    isManualModeRef.current = false;
    if (playerModeProp === undefined && (m3u8Url || movieSlug)) {
      setPlayerMode('hls');
    }
  }, [m3u8Url, serverIndex, movieSlug, episodeName, playerModeProp]);

  // Automatically save history
  useEffect(() => {
    if (movieSlug && episodeSlug) {
      saveHistory({
        slug: movieSlug,
        name: movieName,
        episodeName,
        episodeSlug,
        posterUrl: getImageUrl(posterUrl),
      });
    }
  }, [movieSlug, movieName, episodeName, episodeSlug, posterUrl]);

  // Check saved resume playback position on episode change
  useEffect(() => {
    setAutoNextCountdown(null);
    if (!movieSlug) return;

    // A ?t= deep link takes priority over the resume prompt
    if (deepLinkTime > 0) {
      setResumePrompt(null);
      return;
    }

    const saved = getPlaybackPosition(movieSlug, episodeSlug);
    if (saved && saved.time >= 10) {
      setResumePrompt({ time: saved.time, duration: saved.duration });
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = setTimeout(() => {
        setResumePrompt(null);
      }, 10000);
    } else {
      setResumePrompt(null);
    }

    return () => {
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
      }
    };
  }, [movieSlug, episodeSlug, deepLinkTime]);

  // Auto-Next countdown timer effect
  useEffect(() => {
    if (autoNextCountdown === null) return;
    if (autoNextCountdown <= 0) {
      setAutoNextCountdown(null);
      if (onNextEpisode) {
        onNextEpisode();
      }
      return;
    }

    const timer = setTimeout(() => {
      setAutoNextCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [autoNextCountdown, onNextEpisode]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const checkPipSupport = useCallback(() => {
    const video = videoRef.current;
    const supported =
      typeof document !== 'undefined' &&
      (Boolean((document as any).pictureInPictureEnabled) ||
        Boolean((video as any)?.webkitSupportsPresentationMode) ||
        typeof (video as any)?.webkitSetPresentationMode === 'function');
    setIsPipSupported(supported);
  }, []);

  // Check PiP support and track PiP state
  useEffect(() => {
    checkPipSupport();
    const video = videoRef.current;
    if (!video) return;

    const handleEnterPip = () => setIsPip(true);
    const handleLeavePip = () => setIsPip(false);
    const handleWebkitMode = () => {
      if ((video as any).webkitPresentationMode) {
        setIsPip((video as any).webkitPresentationMode === 'picture-in-picture');
      }
    };

    video.addEventListener('enterpictureinpicture', handleEnterPip);
    video.addEventListener('leavepictureinpicture', handleLeavePip);
    video.addEventListener('webkitpresentationmodechanged', handleWebkitMode);

    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnterPip);
      video.removeEventListener('leavepictureinpicture', handleLeavePip);
      video.removeEventListener('webkitpresentationmodechanged', handleWebkitMode);
    };
  }, [playerMode, checkPipSupport]);

  // Picture-in-Picture Toggle Handler
  const togglePip = useCallback(async () => {
    try {
      const video = videoRef.current;
      if (!video) return;

      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        triggerFeedback('Thoát PiP', 'volume');
      } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
        triggerFeedback('Bật PiP', 'volume');
      } else if (
        (video as any).webkitSupportsPresentationMode &&
        typeof (video as any).webkitSetPresentationMode === 'function'
      ) {
        const currentMode = (video as any).webkitPresentationMode;
        const targetMode = currentMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
        (video as any).webkitSetPresentationMode(targetMode);
        triggerFeedback(targetMode === 'picture-in-picture' ? 'Bật PiP' : 'Thoát PiP', 'volume');
      }
    } catch (err: any) {
      console.warn('PiP error:', err);
    }
  }, [triggerFeedback]);

  // ===== Audio Volume Booster (Web Audio API) =====
  const ensureAudioGraph = useCallback((): boolean => {
    if (boostUnsupported) return false;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        setBoostUnsupported(true);
        return false;
      }
      const video = videoRef.current;
      if (!video) return false;
      if (!audioCtxRef.current) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaElementSource(video);
        const gain = ctx.createGain();
        // EQ chain: source -> lowshelf(80Hz) -> peaking(1kHz) -> highshelf(6kHz) -> gain
        const specs: [BiquadFilterType, number][] = [
          ['lowshelf', 80],
          ['peaking', 1000],
          ['highshelf', 6000],
        ];
        let tail: AudioNode = source;
        const filters = specs.map(([type, freq]) => {
          const node = ctx.createBiquadFilter();
          node.type = type;
          node.frequency.value = freq;
          node.Q.value = 1;
          tail.connect(node);
          tail = node;
          return node;
        });
        // Night Mode compressor: chained after the EQ tail, before the boost gain
        const compressor = ctx.createDynamicsCompressor();
        tail.connect(compressor);
        compressor.connect(gain);
        compressorRef.current = compressor;
        applyCompressorSettings(compressor, nightAudioRef.current);
        gain.connect(ctx.destination);
        mediaSourceRef.current = source;
        gainNodeRef.current = gain;
        eqNodesRef.current = filters;
        const gains = EQ_PRESETS[eqPresetRef.current].gains;
        filters.forEach((node, i) => {
          node.gain.value = gains[i] ?? 0;
        });
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      return true;
    } catch (err) {
      console.warn('Audio boost unsupported:', err);
      setBoostUnsupported(true);
      return false;
    }
  }, [boostUnsupported]);

  // Apply gain whenever boost level changes
  useEffect(() => {
    const gain = gainNodeRef.current;
    if (gain) {
      gain.gain.value = volumeBoost / 100;
    }
    localStorage.setItem('bofilm_player_boost', String(volumeBoost));
  }, [volumeBoost]);

  // Apply pitch preservation & persist fine tune speed whenever they change
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const v = video as HTMLVideoElement & {
        webkitPreservesPitch?: boolean;
        mozPreservesPitch?: boolean;
      };
      v.preservesPitch = pitchPreserve;
      if ('webkitPreservesPitch' in v) v.webkitPreservesPitch = pitchPreserve;
      if ('mozPreservesPitch' in v) v.mozPreservesPitch = pitchPreserve;
      v.playbackRate = isBoosted ? 2 : playbackSpeed;
    }
    localStorage.setItem('bofilm_player_pitch_preserve', pitchPreserve ? 'on' : 'off');
    localStorage.setItem('bofilm_player_speed', String(playbackSpeed));
  }, [pitchPreserve, playbackSpeed, isBoosted, playerMode, key]);

  // Persist Audio-Only Data Saver preference
  useEffect(() => {
    localStorage.setItem('bofilm_player_audio_saver', audioSaver ? 'on' : 'off');
  }, [audioSaver]);

  const handleBoostSelect = useCallback(
    (boost: number) => {
      if (boost > 100 && !ensureAudioGraph()) {
        triggerFeedback('Không hỗ trợ khuếch đại âm thanh', 'volume');
        setShowSettingsMenu(false);
        return;
      }
      setVolumeBoost(boost);
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = boost / 100;
      }
      triggerFeedback(`Âm lượng khuếch đại: ${boost}%`, 'volume');
      setShowSettingsMenu(false);
    },
    [ensureAudioGraph, triggerFeedback]
  );

  const handleBoostSliderChange = useCallback(
    (boost: number) => {
      if (boost > 100 && !gainNodeRef.current && !ensureAudioGraph()) {
        setBoostUnsupported(true);
        return;
      }
      setVolumeBoost(boost);
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = boost / 100;
      }
      triggerFeedback(`Âm lượng khuếch đại: ${boost}%`, 'volume');
    },
    [ensureAudioGraph, triggerFeedback]
  );

  // ===== Night Mode Audio Normalization handler =====
  const handleNightAudioToggle = useCallback(() => {
    setNightAudio((prev) => {
      const next = !prev;
      if (next && !ensureAudioGraph()) {
        triggerFeedback('Trình duyệt không hỗ trợ chuẩn hóa âm thanh', 'volume');
        return prev;
      }
      triggerFeedback(
        next ? 'Chế độ đêm: Đã chuẩn hóa âm thanh' : 'Đã tắt chuẩn hóa âm thanh đêm',
        'volume'
      );
      return next;
    });
  }, [ensureAudioGraph, triggerFeedback]);

  // ===== Audio Equalizer Preset handlers =====
  const handleEqPresetSelect = useCallback(
    (preset: EqPreset) => {
      if (preset !== 'flat' && !ensureAudioGraph()) {
        triggerFeedback('Trình duyệt không hỗ trợ bộ chỉnh âm', 'volume');
        setShowSettingsMenu(false);
        return;
      }
      const gains = EQ_PRESETS[preset].gains;
      eqNodesRef.current?.forEach((node, i) => {
        node.gain.value = gains[i] ?? 0;
      });
      setEqPreset(preset);
      triggerFeedback(`Chỉnh âm: ${EQ_PRESETS[preset].label}`, 'volume');
      setShowSettingsMenu(false);
    },
    [ensureAudioGraph, triggerFeedback]
  );

  // Cleanup Web Audio graph on unmount
  useEffect(() => {
    return () => {
      try {
        mediaSourceRef.current?.disconnect();
        eqNodesRef.current?.forEach((node) => node.disconnect());
        eqNodesRef.current = null;
        compressorRef.current?.disconnect();
        compressorRef.current = null;
        gainNodeRef.current?.disconnect();
        audioCtxRef.current?.close().catch(() => {});
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
      gainNodeRef.current = null;
      mediaSourceRef.current = null;
    };
  }, []);

  // Resume AudioContext on playback (autoplay policies can suspend it)
  useEffect(() => {
    if (isPlaying && audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  }, [isPlaying]);

  // ===== Quick Share (Chia sẻ phim & tập) =====
  const [showShareMenu, setShowShareMenu] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);

  const buildShareUrl = useCallback(
    (withTimestamp: boolean): string => {
      if (typeof window === 'undefined') return '';
      try {
        const url = new URL(window.location.href);
        if (withTimestamp && playerMode === 'hls' && currentTime > 0) {
          url.searchParams.set('t', String(Math.floor(currentTime)));
        } else {
          url.searchParams.delete('t');
        }
        return url.toString();
      } catch {
        return window.location.href;
      }
    },
    [playerMode, currentTime]
  );

  const copyShareLink = useCallback(
    async (withTimestamp: boolean) => {
      const shareUrl = buildShareUrl(withTimestamp);
      if (!shareUrl) {
        triggerFeedback('Không thể tạo liên kết chia sẻ', 'volume');
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareUrl);
        } else {
          const ta = document.createElement('textarea');
          ta.value = shareUrl;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        triggerFeedback(
          withTimestamp
            ? `Đã sao chép link kèm thời gian (${formatTime(currentTime)})`
            : 'Đã sao chép liên kết xem phim',
          'volume'
        );
      } catch {
        triggerFeedback('Không thể sao chép liên kết', 'volume');
      } finally {
        setShowShareMenu(false);
      }
    },
    [buildShareUrl, currentTime, triggerFeedback]
  );

  const handleShareSystem = useCallback(async () => {
    const shareUrl = buildShareUrl(false);
    const shareData: ShareData = {
      title: movieName,
      text: `${movieName} - ${episodeName || 'Xem phim'}`,
      url: shareUrl,
    };
    setShowShareMenu(false);
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await copyShareLink(false);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      await copyShareLink(false);
    }
  }, [buildShareUrl, movieName, episodeName, copyShareLink]);

  // Click outside & Escape closes the share menu
  useEffect(() => {
    if (!showShareMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowShareMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showShareMenu]);

  // Escape closes the Episode Drawer
  useEffect(() => {
    if (!showEpisodeDrawer) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowEpisodeDrawer(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showEpisodeDrawer]);

  // ===== Cinematic Ambient Glow Mode handlers =====
  const handleAmbientGlowToggle = useCallback(() => {
    setAmbientGlow((prev) => {
      const next = !prev;
      localStorage.setItem('bofilm_player_ambient_glow', next ? 'on' : 'off');
      triggerFeedback(next ? 'Đã bật hào quang điện ảnh' : 'Đã tắt hào quang điện ảnh', 'volume');
      return next;
    });
  }, [triggerFeedback]);

  // ===== Hold-to-2x Speed state & handlers =====

  const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  // ===== Pro Tools: Subtitle parsing (.srt -> WebVTT) =====
  const parseSrtToVtt = useCallback((srtText: string): string => {
    const body = srtText
      .replace(/\r\n/g, '\n')
      .replace(/^\uFEFF/, '')
      .replace(/^\d+\s*$/gm, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
      .trim();
    return `WEBVTT\n\n${body}`;
  }, []);

  const handleSubtitleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const isSrt = /\.srt$/i.test(file.name);
      const isVtt = /\.vtt$/i.test(file.name);
      if (!isSrt && !isVtt) {
        triggerFeedback('Chỉ hỗ trợ tệp .srt hoặc .vtt', 'volume');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          let text = String(reader.result || '');
          if (isSrt) text = parseSrtToVtt(text);
          baseVttRef.current = text;
          subtitleVersionRef.current += 1;
          const blob = new Blob([shiftVtt(text, subtitleDelay)], { type: 'text/vtt' });
          setSubtitle((prev) => {
            if (prev?.url) URL.revokeObjectURL(prev.url);
            return {
              name: file.name,
              url: URL.createObjectURL(blob),
              size: prev?.size || 'md',
              color: prev?.color || '#ffffff',
              enabled: true,
            };
          });
          triggerFeedback(`Đã tải phụ đề: ${file.name}`, 'volume');
          setShowSettingsMenu(false);
        } catch {
          triggerFeedback('Không thể đọc tệp phụ đề', 'volume');
        }
      };
      reader.onerror = () => triggerFeedback('Không thể đọc tệp phụ đề', 'volume');
      reader.readAsText(file);
    },
    [parseSrtToVtt, triggerFeedback, subtitleDelay]
  );

  const handleSubtitleRemove = useCallback(() => {
    baseVttRef.current = null;
    subtitleVersionRef.current += 1;
    setSubtitle((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    triggerFeedback('Đã gỡ phụ đề tùy chỉnh', 'volume');
  }, [triggerFeedback]);

  const handleSubtitleSizeSelect = useCallback(
    (size: 'sm' | 'md' | 'lg') => {
      setSubtitle((prev) => (prev ? { ...prev, size } : prev));
      setShowSettingsMenu(false);
      triggerFeedback('Đã cập nhật cỡ chữ phụ đề', 'volume');
    },
    [triggerFeedback]
  );

  // ===== Subtitle styling: font color =====
  const handleSubtitleColorSelect = useCallback(
    (color: string) => {
      setSubtitle((prev) => (prev ? { ...prev, color } : prev));
      triggerFeedback('Đã cập nhật màu chữ phụ đề', 'volume');
    },
    [triggerFeedback]
  );

  // ===== Subtitle sync delay (timing nudge -5s .. +5s) =====
  const nudgeSubtitleDelay = useCallback(
    (delta: number) => {
      setSubtitleDelay((prev) => {
        const next = Math.max(-5, Math.min(5, Math.round((prev + delta) * 10) / 10));
        if (next !== prev) {
          triggerFeedback(`Lệch phụ đề: ${next > 0 ? '+' : ''}${next.toFixed(1)}s`, 'volume');
        }
        return next;
      });
    },
    [triggerFeedback]
  );

  // Rebuild subtitle blob whenever the delay offset changes
  useEffect(() => {
    const base = baseVttRef.current;
    if (!base) return;
    const shifted = shiftVtt(base, subtitleDelay);
    const blob = new Blob([shifted], { type: 'text/vtt' });
    setSubtitle((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.url);
        return { ...prev, url: URL.createObjectURL(blob) };
      }
      return prev;
    });
  }, [subtitleDelay, subtitleVersionRef.current]);

  // Activate custom subtitle track once attached
  useEffect(() => {
    if (!subtitle) return;
    const video = videoRef.current;
    if (!video) return;
    const timer = setTimeout(() => {
      const tracks = Array.from(video.textTracks || []);
      const track = tracks.find((t) => t.label === subtitle.name) || tracks[tracks.length - 1];
      if (track) {
        track.mode = subtitle.enabled ? 'showing' : 'hidden';
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [subtitle, subtitle?.enabled, playerMode, key]);

  // ===== Pro Tools: Stats for Nerds =====
  const stats = showStats
    ? (() => {
        const heightLabel = (h?: number) => {
          if (!h) return 'Tự động';
          if (h >= 2160) return '4K';
          if (h >= 1080) return '1080p';
          if (h >= 720) return '720p';
          if (h >= 480) return '480p';
          return `${h}p`;
        };
        const video = videoRef.current;
        if (!video) return null;
        const quality = video.getVideoPlaybackQuality
          ? video.getVideoPlaybackQuality()
          : (video as any).webkitDroppedFrameCount !== undefined
          ? {
              totalVideoFrames: (video as any).webkitDecodedFrameCount,
              droppedVideoFrames: (video as any).webkitDroppedFrameCount,
            }
          : null;
        let bufferedAhead = 0;
        if (video.buffered.length > 0 && video.duration > 0) {
          for (let i = video.buffered.length - 1; i >= 0; i--) {
            if (video.buffered.start(i) <= video.currentTime) {
              bufferedAhead = Math.max(0, video.buffered.end(i) - video.currentTime);
              break;
            }
          }
        }
        const hls = hlsRef.current;
        const hlsBandwidth = (hls as any)?.bandwidthEstimate ?? (hls as any)?._fragLoadController?.bandwidthEstimate;
        const container = containerRef.current;
        return {
          resolution: `${video.videoWidth}×${video.videoHeight}` || '—',
          playerSize: container ? `${Math.round(container.clientWidth)}×${Math.round(container.clientHeight)}` : '—',
          framesDecoded: quality?.totalVideoFrames ?? 0,
          droppedFrames: quality?.droppedVideoFrames ?? 0,
          bufferedAhead: bufferedAhead.toFixed(1),
          networkActivity: typeof hlsBandwidth === 'number' ? `${(hlsBandwidth / 1000000).toFixed(1)}` : '—',
          currentLevel:
            hls && hls.currentLevel >= 0 && hls.levels?.[hls.currentLevel]
              ? `${heightLabel(hls.levels[hls.currentLevel].height)}${
                  hls.levels[hls.currentLevel].bitrate
                    ? ` @ ${(hls.levels[hls.currentLevel].bitrate / 1000000).toFixed(1)} Mbps`
                    : ''
                }`
              : 'Tự động (Native HLS)',
          playbackRate: `${playbackSpeed}x`,
          droppedRatio:
            quality && quality.totalVideoFrames > 0
              ? `${((quality.droppedVideoFrames / quality.totalVideoFrames) * 100).toFixed(1)}%`
              : '—',
          boost: `${volumeBoost}%`,
        };
      })()
    : null;

  // Color filter preset selection
  const handleFilterPresetSelect = useCallback(
    (preset: ColorPreset) => {
      const values = FILTER_PRESETS[preset].values;
      setBrightness(values.brightness);
      setContrast(values.contrast);
      setSaturation(values.saturation);
      triggerFeedback(`Màu sắc: ${FILTER_PRESETS[preset].label}`, 'volume');
      setShowSettingsMenu(false);
    },
    [triggerFeedback]
  );

  const handleFilterReset = useCallback(() => {
    setBrightness(1);
    setContrast(1);
    setSaturation(1);
    triggerFeedback('Đã đặt lại màu sắc');
    setShowSettingsMenu(false);
  }, [triggerFeedback]);

  const activeColorPreset: ColorPreset | 'custom' = (() => {
    const current = { brightness, contrast, saturation };
    for (const key of Object.keys(FILTER_PRESETS) as ColorPreset[]) {
      if (filterEqualsPreset(current, FILTER_PRESETS[key].values)) return key;
    }
    return 'custom';
  })();

  // Stream Health & Buffer Gauge
  const bufferHealthStatus = (() => {
    if (bufferHealth.ahead >= 30) return { label: 'Rất tốt', color: 'text-emerald-400', dot: 'bg-emerald-400', bar: 'bg-emerald-400' };
    if (bufferHealth.ahead >= 12) return { label: 'Tốt', color: 'text-lime-400', dot: 'bg-lime-400', bar: 'bg-lime-400' };
    if (bufferHealth.ahead >= 5) return { label: 'Trung bình', color: 'text-yellow-400', dot: 'bg-yellow-400', bar: 'bg-yellow-400' };
    if (bufferHealth.ahead >= 2) return { label: 'Yếu', color: 'text-orange-400', dot: 'bg-orange-400', bar: 'bg-orange-400' };
    return { label: 'Nghiêm trọng', color: 'text-red-400', dot: 'bg-red-400', bar: 'bg-red-400' };
  })();
  const bufferGaugePercent = Math.min(100, (bufferHealth.ahead / 60) * 100);

  const handleHealthGaugeToggle = useCallback(() => {
    setShowHealthGauge((prev) => !prev);
    triggerFeedback(showHealthGauge ? 'Đã tắt thước đo bộ nhớ đệm' : 'Đã bật thước đo bộ nhớ đệm', 'volume');
  }, [showHealthGauge, triggerFeedback]);

  // Playback speed selection (buttons close the menu; the fine slider keeps it open)
  const handleSpeedSelect = useCallback(
    (speed: number, keepMenuOpen = false) => {
      const clamped = Math.min(3, Math.max(0.25, Math.round(speed * 100) / 100));
      setPlaybackSpeed(clamped);
      if (videoRef.current) {
        videoRef.current.playbackRate = clamped;
      }
      localStorage.setItem('bofilm_player_speed', String(clamped));
      if (!keepMenuOpen) {
        setShowSettingsMenu(false);
      }
      triggerFeedback(`Tốc độ: ${clamped.toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}x`);
    },
    [triggerFeedback]
  );

  const handlePitchPreserveToggle = useCallback(() => {
    setPitchPreserve((prev) => {
      const next = !prev;
      triggerFeedback(next ? 'Đã giữ cao độ giọng nói' : 'Đã tắt giữ cao độ (pitch đổi theo tốc)', 'volume');
      return next;
    });
  }, [triggerFeedback]);

  const handleAudioSaverToggle = useCallback(() => {
    setAudioSaver((prev) => {
      const next = !prev;
      triggerFeedback(next ? 'Tiết kiệm dữ liệu: Chỉ nghe âm thanh' : 'Đã khôi phục hình ảnh video', 'volume');
      return next;
    });
  }, [triggerFeedback]);

  // Quality label helper (height -> text) shared by menu + hover badge
  const getQualityLabel = useCallback((height?: number) => {
    if (!height) return 'Tự động';
    if (height >= 2160) return '4K';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    if (height >= 360) return '360p';
    return `${height}p`;
  }, []);

  // HLS quality level selection (-1 = auto / adaptive)
  const handleQualitySelect = useCallback(
    (levelIndex: number) => {
      setCurrentLevel(levelIndex);
      if (hlsRef.current && Hls.isSupported()) {
        hlsRef.current.currentLevel = levelIndex;
        if (levelIndex !== -1) {
          const level = hlsRef.current.levels[levelIndex];
          if (level) {
            triggerFeedback(`Chất lượng: ${getQualityLabel(level.height)}`);
          }
        } else {
          triggerFeedback('Chất lượng: Tự động');
        }
      } else {
        // Native HLS (Safari): fallback via re-src is not supported; show feedback
        triggerFeedback('Chất lượng: Tự động (Native HLS)', 'volume');
      }
      if (levelIndex === -1) {
        localStorage.removeItem('bofilm_player_quality');
      } else {
        localStorage.setItem('bofilm_player_quality', String(levelIndex));
      }
      setShowSettingsMenu(false);
    },
    [triggerFeedback, getQualityLabel]
  );

  // Reset quality/levels state when episode or stream changes
  useEffect(() => {
    setHlsLevels([]);
    setActiveHeight(0);
    const saved = typeof window !== 'undefined' ? localStorage.getItem('bofilm_player_quality') : null;
    setCurrentLevel(saved !== null ? parseInt(saved, 10) : -1);
  }, [movieSlug, episodeSlug, serverIndex, m3u8Url]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (playerMode !== 'hls') return;
      const video = videoRef.current;
      if (!video) return;

      switch (e.code) {
        case 'Space':
        case 'KeyK': {
          e.preventDefault();
          if (video.paused) {
            video.play().catch(() => {});
            triggerFeedback('Phát', 'play');
          } else {
            video.pause();
            triggerFeedback('Tạm dừng', 'pause');
          }
          break;
        }
        case 'ArrowLeft':
        case 'KeyJ': {
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          triggerFeedback('-10 giây', 'seek-backward');
          break;
        }
        case 'ArrowRight':
        case 'KeyL': {
          e.preventDefault();
          video.currentTime = Math.min(video.duration || 99999, video.currentTime + 10);
          triggerFeedback('+10 giây', 'seek-forward');
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const newVol = Math.min(1, Math.round((video.volume + 0.1) * 10) / 10);
          video.volume = newVol;
          video.muted = false;
          setVolume(newVol);
          setIsMuted(false);
          localStorage.setItem('bofilm_player_volume', String(newVol));
          triggerFeedback(`Âm lượng: ${Math.round(newVol * 100)}%`, 'volume');
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const newVol = Math.max(0, Math.round((video.volume - 0.1) * 10) / 10);
          video.volume = newVol;
          setVolume(newVol);
          if (newVol === 0) {
            video.muted = true;
            setIsMuted(true);
          }
          localStorage.setItem('bofilm_player_volume', String(newVol));
          triggerFeedback(`Âm lượng: ${Math.round(newVol * 100)}%`, 'volume');
          break;
        }
        case 'KeyM': {
          e.preventDefault();
          const nextMuted = !video.muted;
          video.muted = nextMuted;
          setIsMuted(nextMuted);
          triggerFeedback(
            nextMuted ? 'Đã tắt tiếng' : `Âm lượng: ${Math.round(video.volume * 100)}%`,
            'volume'
          );
          break;
        }
        case 'KeyF': {
          e.preventDefault();
          toggleFullscreen();
          break;
        }
        case 'KeyT': {
          e.preventDefault();
          toggleTheater();
          triggerFeedback(isTheater ? 'Thu nhỏ trình phát' : 'Chế độ rạp chiếu');
          break;
        }
        case 'KeyP': {
          e.preventDefault();
          togglePip();
          break;
        }
        case 'Slash': {
          e.preventDefault();
          setShowShortcutsModal((prev) => !prev);
          break;
        }
        case 'BracketRight': {
          e.preventDefault();
          const nextIdx = SPEED_OPTIONS.findIndex((s) => s > playbackSpeed);
          if (nextIdx !== -1) {
            handleSpeedSelect(SPEED_OPTIONS[nextIdx]);
          }
          break;
        }
        case 'BracketLeft': {
          e.preventDefault();
          const prevIdx = SPEED_OPTIONS.slice().reverse().findIndex((s) => s < playbackSpeed);
          if (prevIdx !== -1) {
            handleSpeedSelect(SPEED_OPTIONS[SPEED_OPTIONS.length - 1 - prevIdx]);
          }
          break;
        }
        case 'Period': {
          if (e.shiftKey) {
            e.preventDefault();
            const nextIdx = SPEED_OPTIONS.findIndex((s) => s > playbackSpeed);
            if (nextIdx !== -1) {
              handleSpeedSelect(SPEED_OPTIONS[nextIdx]);
            }
          }
          break;
        }
        case 'Comma': {
          if (e.shiftKey) {
            e.preventDefault();
            const prevIdx = SPEED_OPTIONS.slice().reverse().findIndex((s) => s < playbackSpeed);
            if (prevIdx !== -1) {
              handleSpeedSelect(SPEED_OPTIONS[SPEED_OPTIONS.length - 1 - prevIdx]);
            }
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [playerMode, triggerFeedback, playbackSpeed, handleSpeedSelect, toggleTheater, isTheater, togglePip]);

  // Escape / outside click closes shortcuts modal
  useEffect(() => {
    if (!showShortcutsModal) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowShortcutsModal(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [showShortcutsModal]);

function parseEpisodeNum(slug?: string, name?: string): number {
  if (slug) {
    const match = slug.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  if (name) {
    const match = name.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 1;
}

  // On-demand resolver for uncached episode
  useEffect(() => {
    if (playerMode !== 'embed' || !movieSlug) return;
    if (hlsFallbackErrorRef.current) return;

    let isDisposed = false;
    const epNum = parseEpisodeNum(episodeSlug, episodeName);

    let checkStreamTimer: ReturnType<typeof setTimeout> | null = null;
    if (!isManualModeRef.current && playerModeProp !== 'embed') {
      checkStreamTimer = setTimeout(async () => {
        if (isDisposed || isManualModeRef.current || hlsFallbackErrorRef.current) return;
        try {
          const fallbackPath = epNum > 1
            ? `/api/stream/${encodeURIComponent(movieSlug)}/ep/${epNum}/master.m3u8`
            : `/api/stream/${encodeURIComponent(movieSlug)}/master.m3u8`;
          const serverParam = serverIndex !== undefined && serverIndex > 0 ? `?server=${serverIndex}` : '';
          const streamCheckUrl = m3u8Url || `${fallbackPath}${serverParam}`;
          const testRes = await fetch(streamCheckUrl, { method: 'HEAD' });
          if (testRes.ok && !isDisposed && !isManualModeRef.current && !hlsFallbackErrorRef.current) {
            setAutoIngested(true);
            setPlayerMode('hls');
          }
        } catch {
          // Stream not ready yet, continue in iframe
        }
      }, 3500);
    }

    return () => {
      isDisposed = true;
      if (checkStreamTimer) {
        clearTimeout(checkStreamTimer);
      }
    };
  }, [playerMode, movieSlug, episodeName, episodeSlug, playerModeProp, m3u8Url, serverIndex]);

  // Handle HLS stream initialization when playerMode === 'hls'
  useEffect(() => {
    if (playerMode !== 'hls' || !videoRef.current) {
      setIsInitializingHls(false);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return;
    }

    let isDisposed = false;
    const video = videoRef.current;
    const epNum = parseEpisodeNum(episodeSlug, episodeName);
    const currentEpKey = `${movieSlug || ''}:${epNum}`;

    let streamUrl: string;
    if (m3u8Url) {
      streamUrl = m3u8Url;
      if (serverIndex !== undefined && serverIndex > 0) {
        try {
          const isAbsolute = /^https?:\/\//i.test(streamUrl);
          const urlObj = new URL(streamUrl, window.location.origin);
          urlObj.searchParams.set('server', String(serverIndex));
          streamUrl = isAbsolute ? urlObj.toString() : urlObj.pathname + urlObj.search;
        } catch {
          if (!streamUrl.includes('server=')) {
            const separator = streamUrl.includes('?') ? '&' : '?';
            streamUrl = `${streamUrl}${separator}server=${serverIndex}`;
          }
        }
      }
    } else if (movieSlug) {
      const serverParam = serverIndex !== undefined && serverIndex > 0 ? `?server=${serverIndex}` : '';
      const basePath = epNum > 1
        ? `/api/stream/${encodeURIComponent(movieSlug)}/ep/${epNum}/master.m3u8`
        : `/api/stream/${encodeURIComponent(movieSlug)}/master.m3u8`;
      streamUrl = `${basePath}${serverParam}`;
    } else {
      return;
    }

    if (
      streamUrl.startsWith('http') &&
      !streamUrl.startsWith(window.location.origin) &&
      !streamUrl.includes('/api/stream/') &&
      !streamUrl.includes('/stream/')
    ) {
      streamUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrl)}`;
    }

    const isNewStream = lastStreamUrlRef.current !== streamUrl;
    if (isNewStream) {
      lastStreamUrlRef.current = streamUrl;
      retryCountRef.current = 0;
      setIsInitializingHls(false);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (video) {
        video.pause();
      }
    }

    if (lastEpKeyRef.current !== currentEpKey) {
      savedPositionRef.current = 0;
      wasPlayingRef.current = true;
      lastEpKeyRef.current = currentEpKey;
      retryCountRef.current = 0;
      hlsFallbackErrorRef.current = false;
      resetCumulativeBytes();
      setIsInitializingHls(false);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    } else if (video.currentTime > 0) {
      savedPositionRef.current = video.currentTime;
      wasPlayingRef.current = !video.paused;
    }

    // ?t= deep link has priority over the saved resume position
    const savedPosition = deepLinkTime > 0 ? deepLinkTime : savedPositionRef.current;
    const shouldAutoPlay = wasPlayingRef.current || deepLinkTime > 0;

    let nativeCleanup: (() => void) | null = null;

    const startHls = () => {
      if (isDisposed || !videoRef.current) return;

      if (Hls.isSupported()) {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const hls = new Hls({
          fLoader: Film4kFragmentLoader as any,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          startPosition: savedPosition > 0 ? savedPosition : -1,
        });
        hlsRef.current = hls;

        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsInitializingHls(false);
          retryCountRef.current = 0;
          // Expose multi-level qualities from the master manifest
          if (hls.levels && hls.levels.length) {
            const sortedIndices = hls.levels
              .map((_, i) => i)
              .sort((a, b) => (hls.levels[b].height || 0) - (hls.levels[a].height || 0));
            setHlsLevels(sortedIndices.map((i) => hls.levels[i]));
            // Restore persisted quality preference (closest available height)
            const saved = localStorage.getItem('bofilm_player_quality');
            const savedIdx = saved !== null ? parseInt(saved, 10) : -1;
            if (savedIdx !== -1 && savedIdx < hls.levels.length) {
              hls.currentLevel = sortedIndices.includes(savedIdx) ? savedIdx : -1;
              setCurrentLevel(sortedIndices.includes(savedIdx) ? savedIdx : -1);
            } else {
              hls.currentLevel = -1;
            }
          } else {
            setHlsLevels([]);
          }
          if (savedPosition > 0 && Math.abs(video.currentTime - savedPosition) > 1) {
            video.currentTime = savedPosition;
          }
          if (shouldAutoPlay) {
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event: any, data: any) => {
          const level = hls.levels?.[data.level];
          if (level) {
            setActiveHeight(level.height || 0);
          }
        });

        hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (retryCountRef.current < 2) {
                  retryCountRef.current += 1;
                  setIsInitializingHls(true);
                  if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                  }
                  if (retryTimerRef.current) {
                    clearTimeout(retryTimerRef.current);
                  }
                  retryTimerRef.current = setTimeout(() => {
                    if (isDisposed) return;
                    startHls();
                  }, 2000);
                } else {
                  setIsInitializingHls(false);
                  if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                  }
                  const hasEmbed = Boolean(embedUrl && !embedUrl.includes('.m3u8') && !embedUrl.endsWith('.m3u8'));
                  if (hasEmbed) {
                    hlsFallbackErrorRef.current = true;
                    setPlayerMode('embed');
                  }
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                if (retryCountRef.current < 2) {
                  retryCountRef.current += 1;
                  setIsInitializingHls(true);
                  if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                  }
                  if (retryTimerRef.current) {
                    clearTimeout(retryTimerRef.current);
                  }
                  retryTimerRef.current = setTimeout(() => {
                    if (isDisposed) return;
                    startHls();
                  }, 2000);
                } else {
                  setIsInitializingHls(false);
                  if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                  }
                  const hasEmbed = Boolean(embedUrl && !embedUrl.includes('.m3u8') && !embedUrl.endsWith('.m3u8'));
                  if (hasEmbed) {
                    hlsFallbackErrorRef.current = true;
                    setPlayerMode('embed');
                  }
                }
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        let nativeLoaded = false;
        const handleLoadedMetadata = () => {
          nativeLoaded = true;
          setIsInitializingHls(false);
          retryCountRef.current = 0;
          if (savedPosition > 0 && Math.abs(video.currentTime - savedPosition) > 1) {
            video.currentTime = savedPosition;
          }
          if (shouldAutoPlay) {
            video.play().catch(() => {});
          }
        };

        const handleNativeError = () => {
          if (nativeLoaded) return;
          if (retryCountRef.current < 2) {
            retryCountRef.current += 1;
            setIsInitializingHls(true);
            if (retryTimerRef.current) {
              clearTimeout(retryTimerRef.current);
            }
            retryTimerRef.current = setTimeout(() => {
              if (isDisposed) return;
              video.src = streamUrl;
              video.load();
              if (shouldAutoPlay) {
                video.play().catch(() => {});
              }
            }, 2000);
          } else {
            setIsInitializingHls(false);
            const hasEmbed = Boolean(embedUrl && !embedUrl.includes('.m3u8') && !embedUrl.endsWith('.m3u8'));
            if (hasEmbed) {
              hlsFallbackErrorRef.current = true;
              setPlayerMode('embed');
            }
          }
        };

        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('error', handleNativeError);
        nativeCleanup = () => {
          video.removeEventListener('loadedmetadata', handleLoadedMetadata);
          video.removeEventListener('error', handleNativeError);
        };

        video.src = streamUrl;
        video.load();
      }
    };

    startHls();

    return () => {
      isDisposed = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (nativeCleanup) {
        nativeCleanup();
      }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [m3u8Url, serverIndex, movieSlug, episodeName, episodeSlug, playerMode, key, deepLinkTime]);

  const handleReload = () => {
    retryCountRef.current = 0;
    hlsFallbackErrorRef.current = false;
    resetCumulativeBytes();
    setIsInitializingHls(false);
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setKey((prev) => prev + 1);
  };

  // Fullscreen toggling
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Auto-hide controls handling
  const triggerUserActivity = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying && !isScrubbing && !showSettingsMenu) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 2800);
    }
  };

  const isTouchInteractingRef = useRef(false);

  // Touch gesture handlers for mobile & touchscreens
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    triggerUserActivity();

    const target = e.target as HTMLElement;
    if (target.closest('.player-controls-interactive')) {
      return;
    }

    if (e.touches.length !== 1) {
      touchStateRef.current = null;
      return;
    }

    isTouchInteractingRef.current = true;
    const touch = e.touches[0];
    const video = videoRef.current;
    const initialSeekTime = video ? video.currentTime : 0;
    const initialVolume = video ? video.volume : volume;

    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      lastX: touch.clientX,
      lastY: touch.clientY,
      mode: 'none',
      initialSeekTime,
      currentSeekTime: initialSeekTime,
      initialVolume,
      initialBrightness: brightness,
      hasMoved: false,
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const state = touchStateRef.current;
    if (!state || e.touches.length !== 1 || !containerRef.current) return;

    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = touch.clientX - state.startX;
    const deltaY = touch.clientY - state.startY;

    state.lastX = touch.clientX;
    state.lastY = touch.clientY;

        if (state.mode === 'none') {
          const moveDist = Math.hypot(deltaX, deltaY);
          if (moveDist > 12) {
            if (holdTimerRef.current) {
              clearTimeout(holdTimerRef.current);
              holdTimerRef.current = null;
            }
            state.hasMoved = true;
        if (Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
          state.mode = 'seek';
        } else if (Math.abs(deltaY) > Math.abs(deltaX) * 1.25) {
          const relativeX = (state.startX - rect.left) / rect.width;
          if (relativeX < 0.5) {
            state.mode = 'brightness';
          } else {
            state.mode = 'volume';
          }
        }
      }
    }

    if (state.mode === 'seek') {
      const seekSpan = Math.min(duration || 120, 180);
      const seekOffset = (deltaX / rect.width) * seekSpan;
      const targetTime = Math.max(0, Math.min(duration || 99999, state.initialSeekTime + seekOffset));
      state.currentSeekTime = targetTime;

      if (touchHudTimerRef.current) clearTimeout(touchHudTimerRef.current);
      setTouchHud({
        type: 'seek',
        targetTime,
        deltaSeconds: Math.round(targetTime - state.initialSeekTime),
        duration,
      });
    } else if (state.mode === 'brightness') {
      const change = (-deltaY / rect.height) * 1.2;
      const newBrightness = Math.max(0.3, Math.min(1.8, state.initialBrightness + change));
      const rounded = Math.round(newBrightness * 100) / 100;
      setBrightness(rounded);
      try {
        localStorage.setItem('bofilm_player_brightness', String(rounded));
      } catch {}

      if (touchHudTimerRef.current) clearTimeout(touchHudTimerRef.current);
      setTouchHud({
        type: 'brightness',
        value: Math.round(rounded * 100),
      });
    } else if (state.mode === 'volume') {
      const change = -deltaY / rect.height;
      const newVolume = Math.max(0, Math.min(1, state.initialVolume + change));
      const rounded = Math.round(newVolume * 100) / 100;
      if (videoRef.current) {
        videoRef.current.volume = rounded;
        videoRef.current.muted = rounded === 0;
      }
      setVolume(rounded);
      setIsMuted(rounded === 0);
      try {
        localStorage.setItem('bofilm_player_volume', String(rounded));
      } catch {}

      if (touchHudTimerRef.current) clearTimeout(touchHudTimerRef.current);
      setTouchHud({
        type: 'volume',
        value: Math.round(rounded * 100),
      });
    }
  };

  const handleTouchEnd = () => {
    const state = touchStateRef.current;
    touchStateRef.current = null;
    if (!state || !containerRef.current) return;

    if (state.mode === 'seek') {
      if (videoRef.current) {
        videoRef.current.currentTime = state.currentSeekTime;
        setCurrentTime(state.currentSeekTime);
      }
      triggerFeedback(`Đến ${formatTime(state.currentSeekTime)}`, 'seek-forward');
      if (touchHudTimerRef.current) clearTimeout(touchHudTimerRef.current);
      touchHudTimerRef.current = setTimeout(() => {
        setTouchHud(null);
      }, 400);
      return;
    }

    if (state.mode === 'brightness' || state.mode === 'volume') {
      if (touchHudTimerRef.current) clearTimeout(touchHudTimerRef.current);
      touchHudTimerRef.current = setTimeout(() => {
        setTouchHud(null);
      }, 500);
      return;
    }

    if (!state.hasMoved) {
      const now = Date.now();
      const rect = containerRef.current.getBoundingClientRect();
      const touchX = state.startX - rect.left;
      const relativeX = touchX / rect.width;

      const lastTap = lastTapInfoRef.current;
      if (
        lastTap &&
        now - lastTap.time < 380 &&
        Math.hypot(state.startX - lastTap.x, state.startY - lastTap.y) < 60
      ) {
        // Double tap confirmed!
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        lastTapInfoRef.current = null;

        if (relativeX < 0.42) {
          // Double Tap Left: -10s
          if (videoRef.current) {
            const next = Math.max(0, videoRef.current.currentTime - 10);
            videoRef.current.currentTime = next;
            setCurrentTime(next);
          }
          setDoubleTapEffect((prev) => ({
            side: 'left',
            count: prev && prev.side === 'left' && now - prev.id < 1200 ? prev.count + 10 : 10,
            id: now,
          }));
          if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = setTimeout(() => {
            setDoubleTapEffect(null);
          }, 850);
        } else if (relativeX > 0.58) {
          // Double Tap Right: +10s
          if (videoRef.current) {
            const next = Math.min(duration || 99999, videoRef.current.currentTime + 10);
            videoRef.current.currentTime = next;
            setCurrentTime(next);
          }
          setDoubleTapEffect((prev) => ({
            side: 'right',
            count: prev && prev.side === 'right' && now - prev.id < 1200 ? prev.count + 10 : 10,
            id: now,
          }));
          if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = setTimeout(() => {
            setDoubleTapEffect(null);
          }, 850);
        } else {
          // Center Double Tap: Toggle fullscreen
          toggleFullscreen();
        }
      } else {
        // Single tap candidate
        lastTapInfoRef.current = { time: now, x: state.startX, y: state.startY };
        if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = setTimeout(() => {
          lastTapInfoRef.current = null;
          setShowControls((prev) => !prev);
        }, 220);
      }
    }
  };

  const handleTouchCancel = () => {
    touchStateRef.current = null;
    setTouchHud(null);
  };

  // ===== Hold-to-2x Speed (press & hold on video canvas) =====
  const suppressClickRef = useRef(false);

  const startHold = () => {
    if (playerMode !== 'hls' || holdTimerRef.current) return;
    holdTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (!video || video.paused) return;
      holdTimerRef.current = null;
      holdActiveRef.current = true;
      savedRateRef.current = video.playbackRate || playbackSpeed || 1;
      if (video.playbackRate !== 2) {
        video.playbackRate = 2;
        setIsBoosted(true);
      }
    }, 300);
  };

  const endHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      suppressClickRef.current = true;
      const video = videoRef.current;
      if (video && video.playbackRate === 2) {
        video.playbackRate = savedRateRef.current;
      }
      setIsBoosted(false);
    }
  };

  // Center video click (single: play/pause, double: fullscreen)
  const handleVideoClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.player-controls-interactive')) {
      return;
    }

    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    if (isTouchInteractingRef.current) {
      isTouchInteractingRef.current = false;
      return;
    }

    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      toggleFullscreen();
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        if (!videoRef.current) return;
        if (videoRef.current.paused) {
          videoRef.current.play().catch(() => {});
          triggerFeedback('Phát', 'play');
        } else {
          videoRef.current.pause();
          triggerFeedback('Tạm dừng', 'pause');
        }
      }, 220);
    }
  };

  // Seekbar interactions
  const getSeekTimeFromEvent = (e: React.MouseEvent | MouseEvent) => {
    if (!seekbarRef.current || !duration) return 0;
    const rect = seekbarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio >= 0.999 ? Math.max(0, duration - 0.25) : ratio * duration;
  };

  const handleSeekbarClick = (e: React.MouseEvent) => {
    const targetTime = getSeekTimeFromEvent(e);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
  };

  const handleSeekbarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    const targetTime = getSeekTimeFromEvent(e);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const moveTime = getSeekTimeFromEvent(moveEvent);
      if (videoRef.current) {
        videoRef.current.currentTime = moveTime;
        setCurrentTime(moveTime);
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const finalTime = getSeekTimeFromEvent(upEvent);
      if (videoRef.current) {
        videoRef.current.currentTime = finalTime;
        setCurrentTime(finalTime);
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setTimeout(() => {
        isScrubbingRef.current = false;
        setIsScrubbing(false);
      }, 50);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleSeekbarMouseMove = (e: React.MouseEvent) => {
    if (!seekbarRef.current || !duration) return;
    const rect = seekbarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(ratio * duration);
    setHoverRatio(ratio * 100);
  };

  const handleSeekbarMouseLeave = () => {
    setHoverTime(null);
  };

  // Play / Pause button
  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      triggerFeedback('Phát', 'play');
    } else {
      videoRef.current.pause();
      triggerFeedback('Tạm dừng', 'pause');
    }
  };

  // Skip +-10s
  const handleSkip = (seconds: number) => {
    if (!videoRef.current) return;
    const next = Math.max(0, Math.min(duration || 99999, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = next;
    setCurrentTime(next);
    triggerFeedback(
      seconds > 0 ? `+${seconds} giây` : `${seconds} giây`,
      seconds > 0 ? 'seek-forward' : 'seek-backward'
    );
  };

  // Volume slider
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
    localStorage.setItem('bofilm_player_volume', String(val));
  };

  const handleToggleMute = () => {
    if (!videoRef.current) return;
    const next = !isMuted;
    setIsMuted(next);
    videoRef.current.muted = next;
    triggerFeedback(next ? 'Đã tắt tiếng' : `Âm lượng: ${Math.round(volume * 100)}%`, 'volume');
  };

  // Resume prompt actions
  const handleResumePlayback = () => {
    if (!resumePrompt || !videoRef.current) return;
    videoRef.current.currentTime = resumePrompt.time;
    videoRef.current.play().catch(() => {});
    triggerFeedback(`Tiếp tục từ ${formatTime(resumePrompt.time)}`, 'play');
    setResumePrompt(null);
  };

  const handleRestartPlayback = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
    clearPlaybackPosition(movieSlug, episodeSlug);
    triggerFeedback('Xem từ đầu', 'play');
    setResumePrompt(null);
  };

  // Sync buffered regions + buffer health gauge data
  const updateBuffered = (video: HTMLVideoElement) => {
    if (video.buffered.length > 0 && video.duration > 0) {
      for (let i = video.buffered.length - 1; i >= 0; i--) {
        if (video.buffered.start(i) <= video.currentTime) {
          setBufferedRatio(Math.min(1, video.buffered.end(i) / video.duration));
          if (showHealthGauge) {
            const ahead = Math.max(0, video.buffered.end(i) - video.currentTime);
            const hls = hlsRef.current;
            const hlsBandwidth = (hls as any)?.bandwidthEstimate;
            setBufferHealth((prev) => {
              const bandwidthMb =
                typeof hlsBandwidth === 'number' && hlsBandwidth > 0
                  ? Math.round((hlsBandwidth / 1000000) * 100) / 100
                  : prev.bandwidthMb;
              if (
                Math.abs(ahead - prev.ahead) < 0.25 &&
                bandwidthMb === prev.bandwidthMb
              ) {
                return prev;
              }
              return { ahead, bandwidthMb };
            });
          }
          break;
        }
      }
    }
  };

  return (
    <>
      {/* Pro Tools: Dynamic subtitle cue styling */}
      {subtitle && (
        <style>
          {`video::cue {
            font-size: ${subtitle.size === 'sm' ? '0.85em' : subtitle.size === 'lg' ? '1.5em' : '1.1em'};
            color: ${subtitle.color};
            background: rgba(0, 0, 0, 0.65);
            font-family: 'Segoe UI', Roboto, sans-serif;
            text-shadow: 0 2px 4px rgba(0,0,0,0.9);
          }
          video::-webkit-media-text-track-container {
            transform: translateY(-8%) !important;
          }`}
        </style>
      )}

      {/* Dim Lights Backdrop */}
      {isDimmed && (
        <div
          onClick={() => setIsDimmed(false)}
          className="fixed inset-0 bg-black/92 z-40 transition-opacity backdrop-blur-md cursor-pointer"
          title="Bấm vào đây để bật lại đèn"
        />
      )}

      {/* Keyboard Shortcuts Guide Modal */}
      {showShortcutsModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowShortcutsModal(false)}
        >
          <div
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[#071307] border border-lime-500/30 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 flex items-center justify-between px-5 py-3.5 bg-[#071307]/95 backdrop-blur-md border-b border-lime-500/20 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-lime-400" />
                <h3 className="text-sm font-black text-[#f4fbf0] uppercase tracking-wider">
                  Phím Tắt Trình Phát
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="p-1.5 rounded-lg text-[#8aa885] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Đóng (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Shortcut Groups */}
            <div className="p-5 space-y-5">
              {[
                {
                  title: 'Phát / Tạm dừng',
                  items: [
                    { keys: ['Space'], desc: 'Phát hoặc tạm dừng video' },
                    { keys: ['K'], desc: 'Phát hoặc tạm dừng video' },
                  ],
                },
                {
                  title: 'Tua video',
                  items: [
                    { keys: ['←', 'J'], desc: 'Lùi lại 10 giây' },
                    { keys: ['→', 'L'], desc: 'Tiến tới 10 giây' },
                  ],
                },
                {
                  title: 'Âm lượng',
                  items: [
                    { keys: ['↑'], desc: 'Tăng âm lượng 10%' },
                    { keys: ['↓'], desc: 'Giảm âm lượng 10%' },
                    { keys: ['M'], desc: 'Bật / tắt tiếng' },
                  ],
                },
                {
                  title: 'Tốc độ phát',
                  items: [
                    { keys: [']'], desc: 'Tăng tốc độ phát' },
                    { keys: ['['], desc: 'Giảm tốc độ phát' },
                    { keys: ['Shift', '.'], desc: 'Tăng tốc độ phát' },
                    { keys: ['Shift', ','], desc: 'Giảm tốc độ phát' },
                  ],
                },
                {
                  title: 'Hiển thị',
                  items: [
                    { keys: ['F'], desc: 'Toàn màn hình' },
                    { keys: ['T'], desc: 'Chế độ rạp chiếu (Theater mode)' },
                    { keys: ['P'], desc: 'Hình trong hình (Picture-in-Picture)' },
                    { keys: ['/'], desc: 'Mở / đóng bảng phím tắt này' },
                    { keys: ['Esc'], desc: 'Đóng menu hoặc bảng phím tắt' },
                  ],
                },
              ].map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-lime-400">
                    {group.title}
                  </h4>
                  {group.items.map((item, i) => (
                    <div
                      key={`${item.keys.join('-')}-${i}`}
                      className="flex items-center justify-between gap-3 py-1.5 px-3 rounded-xl bg-[#0a180b] border border-lime-500/10"
                    >
                      <span className="text-xs text-[#cbe1c8]">{item.desc}</span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        {item.keys.map((k) => (
                          <kbd
                            key={k}
                            className="inline-flex items-center justify-center min-w-[26px] px-1.5 py-0.5 rounded-md bg-lime-950/60 border border-lime-500/30 text-[11px] font-black text-lime-300 shadow-sm"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              <p className="text-[11px] text-[#8aa885] text-center pt-1">
                Phím tắt chỉ hoạt động ở nguồn phát HLS Bơ Film, không áp dụng cho Server Dự Phòng.
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        className={`relative transition-all duration-300 ${
          isTheater ? 'w-full max-w-none col-span-full z-45' : 'w-full'
        } ${isDimmed ? 'z-50' : ''}`}
      >
        {/* Cinematic Ambient Glow (blooming light behind the player) */}
        {ambientGlow && (
          <div
            aria-hidden
            className="absolute -inset-2 sm:-inset-4 z-0 pointer-events-none rounded-[28px] opacity-80 blur-xl transition-opacity duration-700 mix-blend-screen"
            style={{
              background:
                'linear-gradient(115deg, rgba(163,230,53,0.35), rgba(34,211,238,0.28), rgba(168,85,247,0.28), rgba(251,191,36,0.25), rgba(163,230,53,0.35))',
              backgroundSize: '300% 300%',
              animation: 'bofilm-ambient-drift 14s ease-in-out infinite',
            }}
          />
        )}
        {ambientGlow && (
          <style>{`@keyframes bofilm-ambient-drift {
            0%, 100% { background-position: 0% 50%; filter: hue-rotate(0deg); }
            50% { background-position: 100% 50%; filter: hue-rotate(25deg); }
          }`}</style>
        )}

        {/* Top Control Bar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-[#09150a] border-y sm:border border-lime-500/25 rounded-none sm:rounded-t-2xl shadow-md">
          {/* Status Indicator */}
          <div className="flex items-center gap-2 text-xs font-semibold text-lime-300 truncate">
            <span className="w-2 h-2 rounded-full bg-lime-400 animate-pulse flex-shrink-0" />
            <span className="truncate">
              Đang phát:{' '}
              <span className="text-[#fef08a] font-bold">
                {episodeName
                  ? episodeName.startsWith('Tập')
                    ? episodeName
                    : `Tập ${episodeName}`
                  : 'Tập 1'}
              </span>
            </span>
            {autoIngested && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40 shadow-sm animate-pulse">
                <span>✨ Auto-Ingest HLS</span>
              </span>
            )}
            {volumeBoost > 100 && !boostUnsupported && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-bold text-fuchsia-300 bg-fuchsia-950/80 px-2 py-0.5 rounded border border-fuchsia-500/40 shadow-sm"
                title="Khuếch đại âm thanh qua Web Audio GainNode"
              >
                <Gauge className="w-3 h-3" />
                <span>{volumeBoost}% Boost</span>
              </span>
            )}
          </div>

          {/* Action Tools */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Quick Share Button */}
            <div className="relative" ref={shareMenuRef}>
              <button
                type="button"
                onClick={() => setShowShareMenu((prev) => !prev)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 transition-colors cursor-pointer"
                title="Chia sẻ phim & tập"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Chia sẻ</span>
              </button>

              {showShareMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-max min-w-[240px] z-50 bg-gradient-to-b from-white/[0.08] to-white/[0.03] backdrop-blur-2xl border border-white/15 rounded-2xl shadow-[0_15px_45px_rgba(0,0,0,0.85)] p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-150">
                  <button
                    type="button"
                    onClick={handleShareSystem}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center gap-2 text-[#cbe1c8] hover:bg-white/10 hover:text-white"
                  >
                    <Share2 className="w-3.5 h-3.5 text-lime-400" />
                    <span>Chia sẻ qua ứng dụng…</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyShareLink(false)}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center gap-2 text-[#cbe1c8] hover:bg-white/10 hover:text-white"
                  >
                    <Link2 className="w-3.5 h-3.5 text-lime-400" />
                    <span>Sao chép liên kết</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyShareLink(true)}
                    disabled={playerMode !== 'hls' || currentTime <= 0}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center gap-2 text-[#cbe1c8] hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    title={
                      playerMode !== 'hls' || currentTime <= 0
                        ? 'Chỉ khả dụng khi đang phát nguồn HLS'
                        : `Kèm mốc ${formatTime(currentTime)} trong URL (?t=${Math.floor(currentTime)})`
                    }
                  >
                    <Clock className="w-3.5 h-3.5 text-amber-300" />
                    <span className="flex flex-col items-start leading-4">
                      <span>Sao chép link kèm thời gian hiện tại</span>
                      {playerMode === 'hls' && currentTime > 0 && (
                        <span className="text-[10px] font-semibold text-amber-300/90">
                          ?t={Math.floor(currentTime)} ({formatTime(currentTime)})
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              )}
            </div>
            {/* Dimmer Toggle */}
            <button
              type="button"
              onClick={() => setIsDimmed(!isDimmed)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                isDimmed
                  ? 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/40'
                  : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
              }`}
              title="Tắt/Bật đèn rạp chiếu"
            >
              {isDimmed ? (
                <>
                  <Lightbulb className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Bật đèn</span>
                </>
              ) : (
                <>
                  <LightbulbOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Tắt đèn</span>
                </>
              )}
            </button>

            {/* Theater Mode Toggle */}
            <button
              type="button"
              onClick={toggleTheater}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                isTheater
                  ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40'
                  : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
              }`}
              title="Chế độ rạp chiếu (Theater mode)"
            >
              {isTheater ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Thu nhỏ</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Mở rộng</span>
                </>
              )}
            </button>

            {/* Picture-in-Picture Button */}
            {isPipSupported && (
              <button
                type="button"
                onClick={togglePip}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  isPip
                    ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40 shadow-sm'
                    : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
                }`}
                title={isPip ? 'Thoát Picture-in-Picture (Phím P)' : 'Hình trong hình PiP (Phím P)'}
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">PiP</span>
              </button>
            )}

            {/* Pro Tools: Stats for Nerds Toggle */}
            <button
              type="button"
              onClick={() => {
                setShowStats((prev) => !prev);
                triggerFeedback(showStats ? 'Đã tắt thống kê' : 'Đã bật thống kê', 'volume');
              }}
              className={`p-1 rounded-lg transition-colors cursor-pointer ${
                showStats
                  ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40'
                  : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
              }`}
              title="Thống kê trình phát dành cho dân công nghệ (Stats for Nerds)"
            >
              <Gauge className="w-3.5 h-3.5" />
            </button>

            {/* Stream Health & Buffer Gauge Toggle */}
            <button
              type="button"
              onClick={handleHealthGaugeToggle}
              className={`p-1 rounded-lg transition-colors cursor-pointer ${
                showHealthGauge
                  ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40'
                  : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
              }`}
              title="Thước đo sức khỏe stream & bộ nhớ đệm (Stream Health)"
            >
              <Activity className="w-3.5 h-3.5" />
            </button>

            {/* Keyboard Shortcuts Guide Button */}
            <button
              type="button"
              onClick={() => setShowShortcutsModal(true)}
              className="p-1 rounded-lg bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 transition-colors cursor-pointer"
              title="Phím tắt trình phát (Phím /)"
            >
              <Keyboard className="w-3.5 h-3.5" />
            </button>

            {/* Reload Button */}
            <button
              type="button"
              onClick={handleReload}
              className="p-1 rounded-lg bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 transition-colors"
              title="Tải lại trình phát video"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Video Frame 16:9 responsive with Fullscreen Container Ref */}
        <div
          ref={containerRef}
          onMouseMove={triggerUserActivity}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          className={`relative z-10 aspect-video w-full bg-black rounded-none sm:rounded-b-2xl overflow-hidden border-x-0 sm:border border-lime-500/25 shadow-[0_10px_45px_rgba(0,0,0,0.85)] group select-none touch-none ${
            !showControls && isPlaying ? 'cursor-none' : ''
          }`}
        >
          {playerMode === 'hls' && (m3u8Url || movieSlug) ? (
            <>
              {/* Native HTML5 Video Element with Custom Controls Overlay */}
              <video
                key={`hls-${key}`}
                ref={videoRef}
                playsInline
                style={{
                  filter: videoFilter,
                }}
                onClick={handleVideoClick}
                onMouseDown={startHold}
                onMouseUp={endHold}
                onMouseLeave={endHold}
                onTouchStart={startHold}
                onTouchEnd={endHold}
                onTouchCancel={endHold}
                onPlay={() => {
                  setIsPlaying(true);
                  triggerUserActivity();
                }}
                onPause={() => {
                  setIsPlaying(false);
                  setShowControls(true);
                  if (videoRef.current && movieSlug && episodeSlug) {
                    savePlaybackPosition(
                      movieSlug,
                      episodeSlug,
                      videoRef.current.currentTime,
                      videoRef.current.duration
                    );
                  }
                }}
                onTimeUpdate={() => {
                  if (!videoRef.current || isScrubbingRef.current) return;
                  const cur = videoRef.current.currentTime;
                  setCurrentTime(cur);
                  updateBuffered(videoRef.current);

                  // Throttled position saving to localStorage
                  if (Math.abs(cur - lastSavedPosRef.current) >= 4) {
                    lastSavedPosRef.current = cur;
                    if (movieSlug && episodeSlug) {
                      savePlaybackPosition(
                        movieSlug,
                        episodeSlug,
                        cur,
                        videoRef.current.duration
                      );
                    }
                  }
                }}
                onDurationChange={() => {
                  if (videoRef.current) {
                    setDuration(videoRef.current.duration);
                  }
                }}
                onProgress={() => {
                  if (videoRef.current) {
                    updateBuffered(videoRef.current);
                  }
                }}
                onLoadedMetadata={() => {
                  if (!videoRef.current) return;
                  setDuration(videoRef.current.duration);
                  videoRef.current.volume = volume;
                  videoRef.current.muted = isMuted;
                  videoRef.current.playbackRate = playbackSpeed;
                  checkPipSupport();
                }}
                onEnded={() => {
                  setIsPlaying(false);
                  setShowControls(true);
                  if (nextEpisode && onNextEpisode) {
                    setAutoNextCountdown(15);
                  }
                }}
                className="absolute inset-0 w-full h-full bg-black object-contain"
              >
                {subtitle && (
                  <track
                    key={subtitle.url}
                    kind="subtitles"
                    label={subtitle.name}
                    srcLang="vi"
                    src={subtitle.url}
                    default
                  />
                )}
              </video>

      {/* Pro Tools: Stats for Nerds overlay */}
      {showStats && playerMode === 'hls' && stats && (
        <div className="player-controls-interactive absolute left-3 top-3 z-40 pointer-events-none select-none rounded-xl bg-black/85 backdrop-blur-md border border-lime-500/30 p-3 font-mono text-[10px] leading-4 text-emerald-300/90 shadow-[0_8px_30px_rgba(0,0,0,0.85)] max-w-[260px]">
          <div className="mb-1.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-lime-400">
            <Info className="w-3 h-3" />
            Stats for Nerds
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2.5">
            <span className="text-[#8aa885]">Nguồn video:</span>
            <span className="truncate">HLS Bơ Film</span>
            <span className="text-[#8aa885]">Độ phân giải:</span>
            <span className="text-white">{stats.resolution}</span>
            <span className="text-[#8aa885]">Cỡ trình phát:</span>
            <span className="text-white">{stats.playerSize}</span>
            <span className="text-[#8aa885]">Chất lượng:</span>
            <span className="text-white">{stats.currentLevel}</span>
            <span className="text-[#8aa885]">Băng thông ước tính:</span>
            <span className="text-white">{stats.networkActivity} Mbps</span>
            <span className="text-[#8aa885]">Đã tải trước (buffer):</span>
            <span className="text-white">{stats.bufferedAhead}s</span>
            <span className="text-[#8aa885]">Vẽ / Bỏ khung hình:</span>
            <span className="text-white">
              {stats.framesDecoded} / {stats.droppedFrames} ({stats.droppedRatio})
            </span>
            <span className="text-[#8aa885]">Tốc độ phát:</span>
            <span className="text-white">{stats.playbackRate}</span>
            <span className="text-[#8aa885]">Khuếch đại âm:</span>
            <span className="text-white">{stats.boost}</span>
            {subtitle && (
              <>
                <span className="text-[#8aa885]">Phụ đề:</span>
                <span className="truncate text-lime-200">{subtitle.name || 'Tùy chỉnh'}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Stream Health & Buffer Gauge overlay */}
      {showHealthGauge && playerMode === 'hls' && (
        <div className="player-controls-interactive absolute right-3 top-3 z-40 pointer-events-none select-none rounded-xl bg-black/85 backdrop-blur-md border border-lime-500/30 p-2.5 font-mono text-[10px] leading-4 shadow-[0_8px_30px_rgba(0,0,0,0.85)] w-[150px]">
          <div className="mb-1 flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-lime-400">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3" />
              Stream Health
            </span>
            <span className={`flex items-center gap-1 font-bold ${bufferHealthStatus.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${bufferHealthStatus.dot} animate-pulse`} />
              {bufferHealthStatus.label}
            </span>
          </div>
          <div className="flex items-center justify-between text-[#8aa885]">
            <span>Buffer</span>
            <span className="text-white font-bold">
              {bufferHealth.ahead > 0 ? `${bufferHealth.ahead.toFixed(1)}s` : '—'}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full ${bufferHealthStatus.bar} transition-all duration-500`}
              style={{ width: `${bufferGaugePercent}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[#8aa885]">
            <span>Băng thông</span>
            <span className="text-white font-bold">
              {bufferHealth.bandwidthMb !== null ? `${bufferHealth.bandwidthMb} Mbps` : '—'}
            </span>
          </div>
        </div>
      )}

              {/* Double Tap Ripple Animations for Mobile/Touch */}
              {doubleTapEffect?.side === 'left' && (
                <div className="absolute left-0 top-0 bottom-0 w-2/5 flex items-center justify-center bg-gradient-to-r from-lime-500/25 via-lime-500/10 to-transparent pointer-events-none rounded-r-full z-30 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex flex-col items-center gap-1.5 bg-black/85 backdrop-blur-md px-4 py-3 rounded-2xl border border-lime-500/50 shadow-[0_0_30px_rgba(132,204,22,0.4)]">
                    <ChevronsLeft className="w-8 h-8 text-lime-400 animate-pulse" />
                    <span className="text-xs font-black text-[#f4fbf0] tracking-wider">
                      -{doubleTapEffect.count}s
                    </span>
                  </div>
                </div>
              )}

              {doubleTapEffect?.side === 'right' && (
                <div className="absolute right-0 top-0 bottom-0 w-2/5 flex items-center justify-center bg-gradient-to-l from-lime-500/25 via-lime-500/10 to-transparent pointer-events-none rounded-l-full z-30 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex flex-col items-center gap-1.5 bg-black/85 backdrop-blur-md px-4 py-3 rounded-2xl border border-lime-500/50 shadow-[0_0_30px_rgba(132,204,22,0.4)]">
                    <ChevronsRight className="w-8 h-8 text-lime-400 animate-pulse" />
                    <span className="text-xs font-black text-[#f4fbf0] tracking-wider">
                      +{doubleTapEffect.count}s
                    </span>
                  </div>
                </div>
              )}

              {/* Touch Gestures HUD (Seek, Brightness, Volume) */}
              {touchHud && (
                <div
                  className={`absolute inset-0 z-35 pointer-events-none flex items-center transition-all ${
                    touchHud.type === 'brightness'
                      ? 'justify-start pl-6 sm:pl-16'
                      : touchHud.type === 'volume'
                      ? 'justify-end pr-6 sm:pr-16'
                      : 'justify-center'
                  }`}
                >
                  <div className="bg-black/90 backdrop-blur-md border border-lime-500/40 px-5 py-3.5 rounded-2xl flex flex-col items-center gap-2 shadow-[0_0_35px_rgba(132,204,22,0.4)] min-w-[145px] animate-in zoom-in-95 fade-in duration-100">
                    {touchHud.type === 'seek' && (
                      <>
                        <div className="flex items-center gap-2">
                          {touchHud.deltaSeconds! >= 0 ? (
                            <RotateCw className="w-5 h-5 text-lime-400" />
                          ) : (
                            <RotateCcw className="w-5 h-5 text-lime-400" />
                          )}
                          <span className="text-sm font-black text-[#f4fbf0]">
                            {formatTime(touchHud.targetTime!)}
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              touchHud.deltaSeconds! >= 0 ? 'text-lime-400' : 'text-yellow-400'
                            }`}
                          >
                            ({touchHud.deltaSeconds! >= 0 ? '+' : ''}
                            {touchHud.deltaSeconds}s)
                          </span>
                        </div>
                        {touchHud.duration! > 0 && (
                          <div className="w-28 h-1.5 bg-white/20 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-lime-400 rounded-full"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(0, (touchHud.targetTime! / touchHud.duration!) * 100)
                                )}%`,
                              }}
                            />
                          </div>
                        )}
                      </>
                    )}

                    {touchHud.type === 'brightness' && (
                      <>
                        <div className="flex items-center gap-2">
                          <Sun className="w-5 h-5 text-yellow-300" />
                          <span className="text-sm font-black text-[#f4fbf0]">
                            Độ sáng {touchHud.value}%
                          </span>
                        </div>
                        <div className="w-28 h-1.5 bg-white/20 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-yellow-300 rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.max(0, ((touchHud.value! - 30) / 130) * 100)
                              )}%`,
                            }}
                          />
                        </div>
                      </>
                    )}

                    {touchHud.type === 'volume' && (
                      <>
                        <div className="flex items-center gap-2">
                          {touchHud.value === 0 ? (
                            <VolumeX className="w-5 h-5 text-red-400" />
                          ) : touchHud.value! < 50 ? (
                            <Volume1 className="w-5 h-5 text-lime-400" />
                          ) : (
                            <Volume2 className="w-5 h-5 text-lime-400" />
                          )}
                          <span className="text-sm font-black text-[#f4fbf0]">
                            Âm lượng {touchHud.value}%
                          </span>
                        </div>
                        <div className="w-28 h-1.5 bg-white/20 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-lime-400 rounded-full"
                            style={{ width: `${Math.min(100, Math.max(0, touchHud.value!))}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Transient Center Feedback Pill */}
              {feedback && (
                <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
                  <div className="bg-black/80 backdrop-blur-md border border-lime-500/40 px-5 py-3 rounded-2xl flex items-center gap-3 shadow-[0_0_25px_rgba(132,204,22,0.35)] animate-in zoom-in-75 fade-in duration-150">
                    {feedback.icon === 'play' && (
                      <Play className="w-6 h-6 text-lime-400 fill-lime-400" />
                    )}
                    {feedback.icon === 'pause' && (
                      <Pause className="w-6 h-6 text-lime-400 fill-lime-400" />
                    )}
                    {feedback.icon === 'seek-forward' && (
                      <RotateCw className="w-6 h-6 text-lime-400" />
                    )}
                    {feedback.icon === 'seek-backward' && (
                      <RotateCcw className="w-6 h-6 text-lime-400" />
                    )}
                    {feedback.icon === 'volume' && (
                      <Volume2 className="w-6 h-6 text-lime-400" />
                    )}
                    <span className="text-sm font-bold text-[#f4fbf0]">
                      {feedback.text}
                    </span>
                  </div>
                </div>
              )}

              {/* Resume Playback Prompt Banner */}
              {resumePrompt && (
                <div className="player-controls-interactive absolute top-4 left-4 z-30 max-w-sm sm:max-w-md bg-black/85 backdrop-blur-md border border-lime-500/40 rounded-2xl p-3 sm:p-3.5 shadow-[0_10px_35px_rgba(0,0,0,0.8)] animate-in fade-in slide-in-from-top-3 duration-250">
                  <div className="flex items-start gap-2.5">
                    <div className="p-2 rounded-xl bg-lime-500/20 border border-lime-500/30 text-lime-400 flex-shrink-0 mt-0.5">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 pr-1">
                      <p className="text-xs font-semibold text-[#f4fbf0]">
                        Bạn đang xem dở tại{' '}
                        <span className="text-lime-400 font-extrabold">
                          {formatTime(resumePrompt.time)}
                        </span>
                      </p>
                      <p className="text-[11px] text-[#8aa885] mt-0.5">
                        Bạn có muốn tiếp tục xem đoạn đã dừng lại không?
                      </p>
                      <div className="flex items-center gap-2 mt-2.5">
                        <button
                          type="button"
                          onClick={handleResumePlayback}
                          className="px-3 py-1 rounded-lg bg-lime-500 hover:bg-lime-400 text-black text-xs font-bold transition-all shadow-[0_0_12px_rgba(132,204,22,0.4)] cursor-pointer flex items-center gap-1"
                        >
                          <Play className="w-3 h-3 fill-black" />
                          <span>Tiếp tục xem</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleRestartPlayback}
                          className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[#cbe1c8] text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Xem từ đầu
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResumePrompt(null)}
                      className="text-[#8aa885] hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                      title="Đóng thông báo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Auto-Next Episode Overlay with 15s Countdown */}
              {autoNextCountdown !== null && nextEpisode && (
                <div className="player-controls-interactive absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6 text-center animate-in fade-in zoom-in-95 duration-200">
                  <div className="relative flex items-center justify-center mb-4">
                    {/* Circular countdown SVG */}
                    <svg className="w-20 h-20 -rotate-90 transform" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        stroke="rgba(255, 255, 255, 0.15)"
                        strokeWidth="7"
                        fill="none"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        stroke="#a3e635"
                        strokeWidth="7"
                        fill="none"
                        strokeDasharray={264}
                        strokeDashoffset={264 - (264 * autoNextCountdown) / 15}
                        strokeLinecap="round"
                        className="transition-all duration-1000 ease-linear"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl font-black text-lime-400">
                        {autoNextCountdown}s
                      </span>
                    </div>
                  </div>

                  <p className="text-xs uppercase tracking-widest text-[#8aa885] font-semibold">
                    Tập tiếp theo sẽ tự động phát sau
                  </p>
                  <h3 className="text-lg sm:text-xl font-black text-[#f4fbf0] mt-1 drop-shadow">
                    {nextEpisode.name.startsWith('Tập')
                      ? nextEpisode.name
                      : `Tập ${nextEpisode.name}`}
                  </h3>

                  <div className="flex items-center gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setAutoNextCountdown(null);
                        onNextEpisode?.();
                      }}
                      className="px-6 py-2.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-black font-extrabold text-xs sm:text-sm transition-all shadow-[0_0_20px_rgba(132,204,22,0.6)] cursor-pointer flex items-center gap-2"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      <span>Xem ngay</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutoNextCountdown(null)}
                      className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-[#cbe1c8] hover:text-white font-bold text-xs sm:text-sm border border-white/10 transition-colors cursor-pointer"
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              )}

              {/* Initializing HLS State */}
              {isInitializingHls && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm p-6 text-center transition-all duration-300">
                  <div className="relative mb-3 flex items-center justify-center">
                    <Loader2 className="w-10 h-10 text-lime-400 animate-spin" />
                  </div>
                  <p className="text-sm sm:text-base font-semibold text-lime-300 tracking-wide drop-shadow">
                    🥑 Đang khởi tạo luồng Bơ Film tốc độ cao (~2s)...
                  </p>
                  <p className="text-xs text-[#8aa885] mt-1.5 max-w-xs sm:max-w-sm">
                    Hệ thống đang giải mã và tối ưu hóa luồng phát cho bạn, vui lòng đợi trong giây lát.
                  </p>
                </div>
              )}

              {/* Hold-to-2x Speed Badge (top-center) */}
              {isBoosted && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-in fade-in zoom-in-90 duration-100">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-black/85 backdrop-blur-md border border-lime-400/50 shadow-[0_0_25px_rgba(132,204,22,0.45)]">
                    <FastForward className="w-4 h-4 text-lime-400" />
                    <span className="text-xs sm:text-sm font-black text-[#f4fbf0]">
                      2.0x ⏩ Đang tăng tốc
                    </span>
                  </div>
                </div>
              )}

              {/* Audio-Only Data Saver: animated wave visualizer + quick restore */}
              {audioSaver && playerMode === 'hls' && (
                <div
                  className="player-controls-interactive absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-br from-[#04120a] via-[#071608] to-[#020a04] backdrop-blur-sm"
                  style={{ display: audioSaver ? 'flex' : undefined }}
                  onDoubleClick={() => handleAudioSaverToggle()}
                >
                  <style>{`@keyframes bofilm-wave-dance {
                    0%, 100% { transform: scaleY(0.35); }
                    50% { transform: scaleY(1); }
                  }`}</style>
                  <div className="flex items-end justify-center gap-1 h-20 sm:h-28" aria-hidden>
                    {[0.9, 0.45, 1.1, 0.65, 1.3, 0.55, 0.95, 0.75, 1.2, 0.5, 1.05, 0.85, 0.6, 1.15, 0.4, 1.0].map(
                      (amp, i) => (
                        <span
                          key={`wb-${i}`}
                          className="w-1.5 sm:w-2 rounded-full bg-gradient-to-t from-lime-600 via-lime-400 to-emerald-300 origin-bottom shadow-[0_0_10px_rgba(132,204,22,0.6)]"
                          style={{
                            height: '100%',
                            animation: `bofilm-wave-dance ${0.7 + amp * 0.45}s ease-in-out ${i * 0.08}s infinite`,
                          }}
                        />
                      )
                    )}
                  </div>
                  <div className="mt-5 flex flex-col items-center gap-2.5">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-lime-500/15 border border-lime-500/40">
                      <AudioLines className="w-3.5 h-3.5 text-lime-400" />
                      <span className="text-[11px] font-black uppercase tracking-wider text-lime-300">
                        Chế độ tiết kiệm dữ liệu — Chỉ nghe audio
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAudioSaver(false);
                        triggerFeedback('Đã khôi phục hình ảnh video', 'volume');
                      }}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-black text-xs sm:text-sm font-black transition-all shadow-[0_0_20px_rgba(132,204,22,0.55)] hover:scale-105 cursor-pointer"
                      title="Bật lại hình ảnh video (Khôi phục nhanh)"
                    >
                      <MonitorPlay className="w-4 h-4" />
                      <span>Khôi phục hình ảnh</span>
                    </button>
                    <p className="text-[10px] text-[#8aa885]">
                      Sóng âm trực quan • Double-click để khôi phục
                    </p>
                  </div>
                </div>
              )}

              {/* Episode Drawer Overlay */}
              {showEpisodeDrawer && allEpisodes && allEpisodes.length > 0 && (
                <div
                  className="player-controls-interactive absolute inset-0 z-40 bg-black/80 backdrop-blur-xl flex flex-col animate-in fade-in slide-in-from-right-5 duration-200"
                  onClick={() => setShowEpisodeDrawer(false)}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
                    <div className="flex items-center gap-2 text-sm font-black text-[#f4fbf0] uppercase tracking-wider">
                      <ListVideo className="w-4 h-4 text-lime-400" />
                      Danh sách tập
                      <span className="text-[10px] font-bold text-[#8aa885] normal-case">
                        ({allEpisodes.length})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowEpisodeDrawer(false)}
                      className="p-1.5 rounded-lg text-[#8aa885] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      title="Đóng (Esc)"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                      {allEpisodes.map((ep) => {
                        const isCurrent =
                          (currentEpisodeSlug && ep.slug === currentEpisodeSlug) ||
                          (!currentEpisodeSlug && ep.slug === episodeSlug);
                        return (
                          <button
                            key={ep.slug}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowEpisodeDrawer(false);
                              if (!isCurrent) onSelectEpisode?.(ep.slug);
                            }}
                            className={`px-2.5 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                              isCurrent
                                ? 'bg-lime-500 text-black border-lime-300 shadow-[0_0_15px_rgba(132,204,22,0.6)] font-extrabold'
                                : 'bg-white/[0.06] text-[#cbe1c8] hover:bg-white/[0.14] hover:text-white border-white/10 hover:border-lime-400/40'
                            }`}
                          >
                            <span className="truncate">
                              {ep.name.startsWith('Tập') ? ep.name : `Tập ${ep.name}`}
                            </span>
                            {isCurrent && <Check className="w-3.5 h-3.5 stroke-[3] flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Modern Player Controls Overlay */}
              <div
                className={`player-controls-interactive absolute bottom-0 left-0 right-0 z-25 bg-gradient-to-t from-black/95 via-black/75 to-transparent pt-12 pb-3 px-3 sm:px-4 sm:pb-4 transition-opacity duration-300 ${
                   showControls || !isPlaying || isScrubbing || showSettingsMenu
                    ? 'opacity-100 pointer-events-auto'
                    : 'opacity-0 pointer-events-none'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Glassmorphism Seekbar */}
                <div
                  ref={seekbarRef}
                  onClick={handleSeekbarClick}
                  onMouseDown={handleSeekbarMouseDown}
                  onMouseMove={handleSeekbarMouseMove}
                  onMouseLeave={handleSeekbarMouseLeave}
                  className="relative w-full py-2.5 cursor-pointer group/bar select-none"
                >
                  {/* Hover Timestamp Tooltip (timestamp theo vị trí con trỏ X) */}
                  {hoverTime !== null && (
                    <div
                      className="absolute -top-9 -translate-x-1/2 pointer-events-none z-20 flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-xl bg-black/90 backdrop-blur-md border border-lime-500/50 text-[11px] font-bold text-lime-300 shadow-[0_4px_20px_rgba(0,0,0,0.9)]"
                      style={{ left: `${hoverRatio}%` }}
                    >
                      <span className="text-white">{formatTime(hoverTime)}</span>
                      {duration > 0 && (
                        <span className="text-[9px] font-bold text-[#8aa885] bg-white/10 px-1 py-px rounded">
                          {Math.round((hoverTime / duration) * 100)}%
                        </span>
                      )}
                      {hoverTime !== currentTime && duration > 0 && (
                        <span
                          className={`text-[9px] font-bold px-1 py-px rounded ${
                            hoverTime > currentTime
                              ? 'text-yellow-300 bg-yellow-300/15'
                              : 'text-cyan-300 bg-cyan-300/15'
                          }`}
                        >
                          {hoverTime > currentTime ? '+' : '-'}
                          {formatTime(Math.abs(hoverTime - currentTime))}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Timeline Track Bar Container */}
                  <div className="relative w-full h-1.5 group-hover/bar:h-2.5 rounded-full bg-white/20 backdrop-blur-md transition-all overflow-hidden">
                    {/* Buffered Stream Bar */}
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-white/30 rounded-full transition-all duration-200"
                      style={{ width: `${bufferedRatio * 100}%` }}
                    />
                    {/* Played Progress Bar */}
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-lime-500 via-lime-400 to-emerald-400 rounded-full shadow-[0_0_12px_rgba(163,230,53,0.7)]"
                      style={{
                        width: `${duration ? (currentTime / duration) * 100 : 0}%`,
                      }}
                    />
                  </div>

                  {/* Glow Scrubber Thumb */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-lime-400 border-2 border-white shadow-[0_0_10px_rgba(163,230,53,0.9)] opacity-0 group-hover/bar:opacity-100 group-active/bar:opacity-100 transition-all pointer-events-none"
                    style={{
                      left: `${duration ? (currentTime / duration) * 100 : 0}%`,
                    }}
                  />
                </div>

                {/* Controls Action Row */}
                <div className="flex items-center justify-between gap-2 mt-1">
                  {/* Left Controls: Play/Pause, Skip -+10s, Volume, Time */}
                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    {/* Play/Pause Button */}
                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      className="p-1.5 sm:p-2 rounded-xl text-[#f4fbf0] hover:text-lime-300 hover:bg-white/10 transition-colors cursor-pointer"
                      title={isPlaying ? 'Tạm dừng (Phím Space)' : 'Phát (Phím Space)'}
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5 fill-current" />
                      ) : (
                        <Play className="w-5 h-5 fill-current" />
                      )}
                    </button>

                    {/* Skip -10s Button */}
                    <button
                      type="button"
                      onClick={() => handleSkip(-10)}
                      className="flex items-center gap-0.5 px-1.5 py-1 rounded-xl text-[#cbe1c8] hover:text-lime-300 hover:bg-white/10 transition-colors text-xs font-bold cursor-pointer"
                      title="Lùi 10 giây (Phím ← hoặc J)"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span className="text-[11px]">-10s</span>
                    </button>

                    {/* Skip +10s Button */}
                    <button
                      type="button"
                      onClick={() => handleSkip(10)}
                      className="flex items-center gap-0.5 px-1.5 py-1 rounded-xl text-[#cbe1c8] hover:text-lime-300 hover:bg-white/10 transition-colors text-xs font-bold cursor-pointer"
                      title="Tiến 10 giây (Phím → hoặc L)"
                    >
                      <RotateCw className="w-4 h-4" />
                      <span className="text-[11px]">+10s</span>
                    </button>


                    {/* Volume Slider and Mute Toggle */}
                    <div className="flex items-center gap-1.5 group/vol">
                      <button
                        type="button"
                        onClick={handleToggleMute}
                        className="p-1.5 rounded-xl text-[#cbe1c8] hover:text-lime-300 hover:bg-white/10 transition-colors cursor-pointer"
                        title={isMuted ? 'Bật tiếng (Phím M)' : 'Tắt tiếng (Phím M)'}
                      >
                        {isMuted || volume === 0 ? (
                          <VolumeX className="w-4 h-4 text-red-400" />
                        ) : volume < 0.5 ? (
                          <Volume1 className="w-4 h-4" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.02"
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-16 sm:w-20 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-lime-400 hover:accent-lime-300 transition-all"
                        title={`Âm lượng: ${Math.round(volume * 100)}%`}
                      />
                    </div>

                    {/* Current / Duration Time Display */}
                    <div className="text-xs font-medium text-[#8aa885] ml-1 hidden xs:block">
                      <span className="text-[#f4fbf0] font-bold">
                        {formatTime(currentTime)}
                      </span>
                      <span className="mx-1">/</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  {/* Right Controls: Prev Episode, Next Episode, Episode List, Speed, Theater, Fullscreen */}
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                    {/* Prev Episode Button */}
                    {prevEpisode && onPrevEpisode && (
                      <button
                        type="button"
                        onClick={onPrevEpisode}
                        className="flex items-center gap-1 px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-[#cbe1c8] hover:text-white text-xs font-bold transition-all cursor-pointer"
                        title={`Tập trước: ${prevEpisode.name}`}
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Tập trước</span>
                      </button>
                    )}

                    {/* Next Episode Button */}
                    {nextEpisode && onNextEpisode && (
                      <button
                        type="button"
                        onClick={onNextEpisode}
                        className="flex items-center gap-1 px-2 py-1 rounded-xl bg-lime-500/20 hover:bg-lime-500/30 text-lime-300 border border-lime-500/30 text-xs font-bold transition-all cursor-pointer"
                        title={`Tập tiếp theo: ${nextEpisode.name}`}
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Tập kế</span>
                      </button>
                    )}

                    {/* Episode List Toggle Button */}
                    {allEpisodes && allEpisodes.length > 0 && onSelectEpisode && (
                      <button
                        type="button"
                        onClick={() => setShowEpisodeDrawer((prev) => !prev)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          showEpisodeDrawer
                            ? 'bg-lime-500 text-black border border-lime-300 shadow-[0_0_12px_rgba(132,204,22,0.5)]'
                            : 'bg-white/10 hover:bg-white/20 text-[#cbe1c8] hover:text-white'
                        }`}
                        title="Danh sách tập"
                      >
                        <ListVideo className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Danh sách tập</span>
                      </button>
                    )}

                    {/* Settings Menu: Quality + Playback Speed (Glassmorphism) */}
                    <div className="relative" ref={settingsMenuRef}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSettingsMenu(!showSettingsMenu);
                                          }}
                        className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                          showSettingsMenu
                            ? 'bg-lime-500 text-black shadow-[0_0_12px_rgba(132,204,22,0.5)]'
                            : 'bg-white/10 hover:bg-white/20 text-[#cbe1c8] hover:text-white'
                        }`}
                        title="Chất lượng & Tốc độ phát (Cài đặt)"
                      >
                        <Settings className={`w-3.5 h-3.5 ${showSettingsMenu ? 'rotate-90 transition-transform' : 'transition-transform'}`} />
                        <span className="hidden sm:inline">Cài đặt</span>
                      </button>

                      {showSettingsMenu && (
                        <div
                          style={{ maxHeight: menuMaxHeight ? `${menuMaxHeight}px` : undefined }}
                          className="absolute bottom-full right-0 mb-2 bg-[#0a180b]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-[0_15px_45px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.08)] w-max min-w-[240px] max-w-[calc(100vw-32px)] sm:max-w-xs overflow-y-auto z-50 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-150"
                        >
                          {/* Quality Section */}
                          <div className="px-3 pt-2.5 pb-2">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <MonitorPlay className="w-3 h-3" />
                              Chất lượng
                            </div>
                            <div className="flex flex-col gap-0.5">
                              {hlsLevels.length > 0 ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleQualitySelect(-1)}
                                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                      currentLevel === -1
                                        ? 'bg-lime-500/90 text-black shadow-md font-extrabold'
                                        : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <span className="flex items-center gap-1.5">
                                      Tự động
                                      {currentLevel === -1 && activeHeight > 0 && (
                                        <span className="text-[10px] font-bold opacity-80">
                                          ({getQualityLabel(activeHeight)})
                                        </span>
                                      )}
                                    </span>
                                    {currentLevel === -1 && (
                                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                                    )}
                                  </button>
                                  {hlsLevels.map((level) => {
                                    const idx = hlsRef.current?.levels.findIndex((l) => l.height === level.height && l.bitrate === level.bitrate) ?? -1;
                                    const isActive = idx !== -1 && currentLevel === idx;
                                    const label = getQualityLabel(level.height);
                                    return (
                                      <button
                                        key={`${level.height}-${idx}`}
                                        type="button"
                                        onClick={() => handleQualitySelect(idx)}
                                        className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                          isActive
                                            ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                            : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                        }`}
                                      >
                                        <span className="flex items-center gap-1.5">
                                          {label}
                                          {(level.height ?? 0) >= 1080 && (
                                            <span
                                              className={`text-[9px] px-1 py-px rounded font-black uppercase tracking-wide ${
                                                isActive
                                                  ? 'bg-black/20 text-black'
                                                  : 'bg-lime-500/20 text-lime-300'
                                              }`}
                                            >
                                              {(level.height ?? 0) >= 2160 ? '4K' : 'HD'}
                                            </span>
                                          )}
                                          {level.bitrate ? (
                                            <span
                                              className={`text-[10px] font-semibold ${
                                                isActive ? 'text-black/70' : 'text-[#8aa885]'
                                              }`}
                                            >
                                              {(level.bitrate / 1000000).toFixed(1)} Mbps
                                            </span>
                                          ) : null}
                                        </span>
                                        {isActive && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                      </button>
                                    );
                                  })}
                                </>
                              ) : (
                                <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[#8aa885]">
                                  Native HLS — Chất lượng tự động
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Pro Tools: Custom Subtitles Section (.srt / .vtt) */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <Captions className="w-3 h-3" />
                              Phụ đề tùy chỉnh (.srt / .vtt)
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={() => subtitleFileRef.current?.click()}
                                className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center gap-2 text-[#cbe1c8] hover:bg-white/10 hover:text-white"
                              >
                                <FileUp className="w-3.5 h-3.5 text-lime-400" />
                                <span>Tải lên tệp phụ đề…</span>
                              </button>
                              <input
                                ref={subtitleFileRef}
                                type="file"
                                accept=".srt,.vtt,text/vtt,application/x-subrip"
                                className="hidden"
                                onChange={handleSubtitleFileChange}
                              />
                              {subtitle && (
                                <>
                                  <div className="px-2.5 py-1.5 text-[10px] text-[#8aa885] flex items-center justify-between gap-2">
                                    <span className="truncate" title={subtitle.name}>
                                      {subtitle.name}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={handleSubtitleRemove}
                                      className="flex-shrink-0 text-[10px] font-bold text-red-400 hover:text-red-300 cursor-pointer"
                                    >
                                      Gỡ
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSubtitle((prev) => (prev ? { ...prev, enabled: !prev.enabled } : prev));
                                      setShowSettingsMenu(false);
                                      triggerFeedback(
                                        subtitle.enabled ? 'Đã tắt phụ đề' : 'Đã bật phụ đề',
                                        'volume'
                                      );
                                    }}
                                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                      subtitle.enabled
                                        ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                        : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <span className="flex items-center gap-1.5">
                                      <Captions className="w-3.5 h-3.5" />
                                      {subtitle.enabled ? 'Đang bật phụ đề' : 'Đã tắt phụ đề'}
                                    </span>
                                    {subtitle.enabled && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                  </button>
                                  <div className="px-2.5 pt-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885]">
                                    <Type className="w-3 h-3" />
                                    Cỡ chữ
                                  </div>
                                  <div className="flex gap-1 px-2.5 pb-1">
                                    {(
                                      [
                                        { value: 'sm' as const, label: 'Nhỏ' },
                                        { value: 'md' as const, label: 'Vừa' },
                                        { value: 'lg' as const, label: 'Lớn' },
                                      ]
                                    ).map((sz) => (
                                      <button
                                        key={sz.value}
                                        type="button"
                                        onClick={() => handleSubtitleSizeSelect(sz.value)}
                                        className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                                          subtitle.size === sz.value
                                            ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                            : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                        }`}
                                      >
                                        {sz.label}
                                      </button>
                                       ))}
                                   </div>
                                  <div className="px-2.5 pt-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885]">
                                    <Type className="w-3 h-3" />
                                    Màu chữ
                                  </div>
                                  <div className="flex gap-1 px-2.5 pb-1">
                                    {SUBTITLE_COLORS.map((c) => (
                                      <button
                                        key={c.value}
                                        type="button"
                                        onClick={() => handleSubtitleColorSelect(c.value)}
                                        title={c.label}
                                        className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center ${
                                          subtitle.color === c.value
                                            ? 'bg-lime-500 shadow-md'
                                            : 'bg-white/5 hover:bg-white/10'
                                        }`}
                                      >
                                        <span
                                          className="w-3 h-3 rounded-full border border-black/40 shadow-sm"
                                          style={{ background: c.value }}
                                        />
                                      </button>
                                    ))}
                                  </div>
                                  <div className="px-2.5 pt-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885]">
                                    <Clock className="w-3 h-3" />
                                    Đồng bộ thời gian ({subtitleDelay > 0 ? '+' : ''}
                                    {subtitleDelay.toFixed(1)}s)
                                  </div>
                                  <div className="flex items-center gap-1.5 px-2.5 pb-1">
                                    <button
                                      type="button"
                                      onClick={() => nudgeSubtitleDelay(-0.5)}
                                      disabled={subtitleDelay <= -5}
                                      className="px-2 py-1 rounded-lg bg-white/5 text-[#cbe1c8] text-[11px] font-bold hover:bg-white/10 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                                      title="Lùi phụ đề sớm hơn 0.5s"
                                    >
                                      −0.5s
                                    </button>
                                    <input
                                      type="range"
                                      min="-5"
                                      max="5"
                                      step="0.5"
                                      value={subtitleDelay}
                                      onChange={(e) => {
                                        const next = parseFloat(e.target.value);
                                        setSubtitleDelay(next);
                                        triggerFeedback(
                                          `Lệch phụ đề: ${next > 0 ? '+' : ''}${next.toFixed(1)}s`,
                                          'volume'
                                        );
                                      }}
                                      className="flex-1 min-w-[70px] h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-lime-400"
                                      title="Lệch thời gian phụ đề (-5s đến +5s)"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => nudgeSubtitleDelay(0.5)}
                                      disabled={subtitleDelay >= 5}
                                      className="px-2 py-1 rounded-lg bg-white/5 text-[#cbe1c8] text-[11px] font-bold hover:bg-white/10 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                                      title="Lùi phụ đề muộn hơn 0.5s"
                                    >
                                      +0.5s
                                    </button>
                                    {subtitleDelay !== 0 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSubtitleDelay(0);
                                          triggerFeedback('Đã đặt lại lệch phụ đề', 'volume');
                                        }}
                                        className="px-1.5 py-1 rounded-lg text-[10px] font-bold text-red-400 hover:text-red-300 cursor-pointer flex-shrink-0"
                                        title="Đặt lại về 0"
                                      >
                                        Reset
                                      </button>
                                    )}
                                  </div>
                                 </>
                              )}
                            </div>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Speed Section: presets + fine slider (0.25x - 3.0x) */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <SlidersHorizontal className="w-3 h-3" />
                              Tốc độ phát
                            </div>
                            <div className="flex flex-col gap-0.5">
                              {SPEED_OPTIONS.map((spd) => {
                                const label =
                                  spd === 1
                                    ? '1x (Chuẩn)'
                                    : spd === 0.25
                                    ? '0.25x (Siêu chậm)'
                                    : spd === 0.5
                                    ? '0.5x (Chậm)'
                                    : spd === 2
                                    ? '2x (Nhanh)'
                                    : spd === 3
                                    ? '3x (Cực nhanh)'
                                    : `${spd}x`;
                                return (
                                  <button
                                    key={spd}
                                    type="button"
                                    onClick={() => handleSpeedSelect(spd)}
                                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                      playbackSpeed === spd
                                        ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                        : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <span>{label}</span>
                                    {playbackSpeed === spd && (
                                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Fine-tune slider 0.25x - 3.0x */}
                            <div className="mt-2 mb-1 px-1">
                              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1">
                                <span>Tinh chỉnh</span>
                                <span className="text-lime-300 font-mono text-[11px] normal-case">
                                  {playbackSpeed.toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}x
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0.25"
                                max="3"
                                step="0.05"
                                value={playbackSpeed}
                                onChange={(e) => handleSpeedSelect(parseFloat(e.target.value), true)}
                                className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-lime-400"
                                title="Tinh chỉnh tốc độ phát 0.25x - 3.0x"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handlePitchPreserveToggle}
                              className={`mt-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold text-left w-full transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                pitchPreserve
                                  ? 'bg-lime-500/90 text-black shadow-md font-extrabold'
                                  : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                              }`}
                              title="Giữ cao độ giọng nói ổn định khi phát nhanh/chậm (pitch preservation)"
                            >
                              <span className="flex items-center gap-1.5">
                                <AudioLines className="w-3.5 h-3.5" />
                                Giữ cao độ giọng (pitch)
                              </span>
                              {pitchPreserve && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </button>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Audio-Only Data Saver Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <Waves className="w-3 h-3" />
                              Tiết kiệm dữ liệu (Chỉ audio)
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={handleAudioSaverToggle}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                  audioSaver
                                    ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                    : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                }`}
                                title="Che hình ảnh, chỉ nghe âm thanh trực tiếp trên trình duyệt"
                              >
                                <span className="flex items-center gap-1.5">
                                  <AudioLines className="w-3.5 h-3.5" />
                                  {audioSaver ? 'Đang phát audio' : 'Chỉ nghe âm thanh'}
                                </span>
                                {audioSaver && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </button>
                              <p className="px-2.5 py-1 text-[10px] text-[#8aa885]">
                                Ẩn hình ảnh để tiết kiệm pin &amp; băng thông, hiển thị sóng âm động.
                                Bấm nút khôi phục để xem lại video.
                              </p>
                            </div>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Audio Volume Booster Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <Gauge className="w-3 h-3" />
                              Khuếch đại âm thanh
                            </div>
                            <div className="flex flex-col gap-0.5">
                              {[100, 125, 150, 200].map((boost) => {
                                const label =
                                  boost === 100 ? '100% (Chuẩn)' : `${boost}%`;
                                return (
                                  <button
                                    key={boost}
                                    type="button"
                                    onClick={() => handleBoostSelect(boost)}
                                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                      volumeBoost === boost
                                        ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                        : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <span>{label}</span>
                                    {volumeBoost === boost && (
                                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                                    )}
                                  </button>
                                );
                              })}
                              {boostUnsupported && (
                                <p className="px-2 py-1 text-[10px] text-yellow-400/80">
                                  Trình duyệt không hỗ trợ khuếch đại âm thanh.
                                </p>
                              )}
                              {!boostUnsupported && (
                                <div className="flex items-center gap-2 px-2.5 py-1.5">
                                  <input
                                    type="range"
                                    min={100}
                                    max={200}
                                    step={5}
                                    value={volumeBoost}
                                    onChange={(e) =>
                                      handleBoostSliderChange(Number(e.target.value))
                                    }
                                    className="flex-1 h-1 rounded-full accent-fuchsia-400 cursor-pointer"
                                    title="Kéo để khuếch đại âm lượng tới 200%"
                                  />
                                  <span
                                    className={`w-16 text-right text-[10px] font-mono font-bold ${
                                      volumeBoost > 100 ? 'text-fuchsia-300' : 'text-lime-300'
                                    }`}
                                  >
                                    {volumeBoost > 100 ? `${volumeBoost}% Boost` : '100%'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Night Mode Audio Normalization Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <Moon className="w-3 h-3" />
                              Âm thanh ban đêm
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={handleNightAudioToggle}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                  nightAudio
                                    ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                    : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                }`}
                                title="Nén dải động (DynamicsCompressor): tiếng lớn không quá to, thoại nhỏ vẫn nghe rõ"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Moon className="w-3.5 h-3.5" />
                                  {nightAudio ? 'Đang chuẩn hóa' : 'Chuẩn hóa âm thanh'}
                                </span>
                                {nightAudio && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </button>
                              <p className="px-2.5 py-1 text-[10px] text-[#8aa885]">
                                Nén dải động qua Web Audio, phù hợp xem phim ban đêm mà không
                                đánh thức người khác.
                              </p>
                            </div>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Audio Equalizer Presets Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <SlidersHorizontal className="w-3 h-3" />
                              Bộ chỉnh âm (Equalizer)
                            </div>
                            <div className="flex flex-col gap-0.5">
                              {(Object.keys(EQ_PRESETS) as EqPreset[]).map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => handleEqPresetSelect(preset)}
                                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                    eqPreset === preset
                                      ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                      : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  <span>{EQ_PRESETS[preset].label}</span>
                                  {eqPreset === preset && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                </button>
                              ))}
                              <p className="px-2.5 py-1 text-[10px] text-[#8aa885]">
                                Chỉnh dải trầm, thoại và cao qua Web Audio, ưu tiên này được lưu tự động.
                              </p>
                            </div>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Video Color Filters Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center justify-between gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-2">
                              <span className="flex items-center gap-1.5">
                                <Palette className="w-3 h-3" />
                                Bộ lọc hình ảnh
                              </span>
                              <button
                                type="button"
                                onClick={handleFilterReset}
                                className="px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-[9px] font-bold text-[#cbe1c8] hover:text-lime-300 hover:bg-white/10 transition-colors cursor-pointer"
                                title="Đặt lại bộ lọc về mặc định"
                              >
                                Đặt lại
                              </button>
                            </div>
                            {/* Sliders */}
                            <div className="space-y-2 mb-2">
                              {(
                                [
                                  { key: 'brightness', value: brightness, setter: setBrightness, label: 'Độ sáng', icon: <Sun className="w-3 h-3" /> },
                                  { key: 'contrast', value: contrast, setter: setContrast, label: 'Tương phản', icon: <Contrast className="w-3 h-3" /> },
                                  { key: 'saturation', value: saturation, setter: setSaturation, label: 'Độ bão hòa', icon: <Palette className="w-3 h-3" /> },
                                ] as const
                              ).map((row) => (
                                <div key={row.key} className="flex items-center gap-2">
                                  <span className="flex items-center gap-1 w-[86px] text-[10px] font-bold text-[#8aa885] uppercase tracking-wide">
                                    {row.icon}
                                    {row.label}
                                  </span>
                                  <input
                                    type="range"
                                    min={0.5}
                                    max={2}
                                    step={0.05}
                                    value={row.value}
                                    onChange={(e) => row.setter(Number(e.target.value))}
                                    className="flex-1 h-1 rounded-full accent-lime-400 cursor-pointer"
                                  />
                                  <span className="w-9 text-right text-[10px] font-mono font-bold text-lime-300">
                                    {Math.round(row.value * 100)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                            {/* Presets */}
                            <div className="flex flex-col gap-0.5">
                              {(Object.keys(FILTER_PRESETS) as ColorPreset[]).map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => handleFilterPresetSelect(preset)}
                                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                    activeColorPreset !== 'custom' && activeColorPreset === preset
                                      ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                      : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  <span>{FILTER_PRESETS[preset].label}</span>
                                  {activeColorPreset === preset && (
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  )}
                                </button>
                              ))}
                              <p className="px-2.5 py-1 text-[10px] text-[#8aa885]">
                                Tinh chỉnh màu video trực tiếp trên trình duyệt, cài đặt được lưu tự động.
                              </p>
                            </div>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Cinematic Ambient Glow Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <Sparkles className="w-3 h-3" />
                              Hào quang điện ảnh
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={handleAmbientGlowToggle}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                  ambientGlow
                                    ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                    : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                }`}
                              >
                                <span className="flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5" />
                                  {ambientGlow ? 'Đang phát sáng' : 'Đã tắt'}
                                </span>
                                {ambientGlow && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </button>
                              <p className="px-2.5 py-1 text-[10px] text-[#8aa885]">
                                Thêm ánh sáng bloom đổi màu động phía sau trình phát.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Picture-in-Picture Button */}
                    {isPipSupported && (
                      <button
                        type="button"
                        onClick={togglePip}
                        className={`p-1.5 sm:p-2 rounded-xl transition-colors cursor-pointer ${
                          isPip
                            ? 'text-lime-400 bg-lime-500/20 border border-lime-500/40 shadow-sm'
                            : 'text-[#f4fbf0] hover:text-lime-300 hover:bg-white/10'
                        }`}
                        title={
                          isPip
                            ? 'Thoát Picture-in-Picture (Phím P)'
                            : 'Hình trong hình PiP (Phím P)'
                        }
                      >
                        <PictureInPicture2 className="w-4 h-4 sm:w-5 sm:h-5" />
                      </button>
                    )}

                    {/* Fullscreen Button */}
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="p-1.5 sm:p-2 rounded-xl text-[#f4fbf0] hover:text-lime-300 hover:bg-white/10 transition-colors cursor-pointer"
                      title={
                        isFullscreen
                          ? 'Thoát toàn màn hình (Phím F)'
                          : 'Toàn màn hình (Phím F)'
                      }
                    >
                      {isFullscreen ? (
                        <Minimize2 className="w-4 h-4 sm:w-5 sm:h-5" />
                      ) : (
                        <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : embedUrl ? (
            <iframe
              ref={iframeRef}
              key={`embed-${key}`}
              src={embedUrl}
              title={`${movieName} - ${episodeName}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full border-0"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#071107] text-[#8aa885]">
              <AlertCircle className="w-12 h-12 text-lime-400 mb-2" />
              <p className="text-base font-semibold text-[#f4fbf0]">
                Chưa có luồng phát cho tập phim này
              </p>
              <p className="text-xs text-[#8aa885] mt-1">
                Vui lòng chọn tập phim khác hoặc chuyển đổi server phát bên dưới.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
