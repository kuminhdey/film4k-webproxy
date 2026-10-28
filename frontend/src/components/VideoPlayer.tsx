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
  Timer,
  Share2,
  Gauge,
  AlarmClockOff,
  Camera,
  Captions,
  Type,
  FileUp,
  Film,
  Info,
  ImageOff,
  Bookmark,
  Repeat,
  Sparkles,
  Link2,
  Activity,
  Palette,
  Contrast,
  Waves,
  AudioLines,
  Moon,
  MessageSquare,
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
  autoSkipIntro: boolean;
  introDuration: number;
  colorFilter: VideoFilterValues;
  showHealthGauge: boolean;
}

const INTRO_DURATION_OPTIONS = [60, 85, 90, 120];

const PREFS_KEY = 'bofilm_player_prefs';

// ===== Danmaku / Floating Bullet Comments =====
type DanmakuFontSize = 12 | 14 | 18;

interface DanmakuSettings {
  enabled: boolean;
  opacity: number;
  fontSize: DanmakuFontSize;
}

interface DanmakuComment {
  t: number;
  text: string;
  kind: 'text' | 'emoji';
}

interface DanmakuFlying {
  id: number;
  text: string;
  kind: 'text' | 'emoji';
  lane: number;
  duration: number;
}

const DANMAKU_SETTINGS_KEY = 'bofilm_danmaku_settings';
const DANMAKU_LANES = 5;
const DANMAKU_REACTIONS = ['❤️', '🔥', '😂', '👏', '🍿', '😭', '😱'];
const DANMAKU_SEED_TEXTS = [
  'Phim hay quá!',
  'Đoạn này đỉnh thật sự 🔥',
  'Nhạc phim cuốn dã man',
  'Bơ Film xem mượt ghê ❤️',
];

const loadDanmakuSettings = (): DanmakuSettings => {
  if (typeof window === 'undefined') return { enabled: true, opacity: 0.85, fontSize: 14 };
  try {
    const raw = localStorage.getItem(DANMAKU_SETTINGS_KEY);
    if (!raw) return { enabled: true, opacity: 0.85, fontSize: 14 };
    const parsed = JSON.parse(raw) as Partial<DanmakuSettings>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      opacity: Math.min(1, Math.max(0.3, typeof parsed.opacity === 'number' ? parsed.opacity : 0.85)),
      fontSize: parsed.fontSize === 12 || parsed.fontSize === 18 ? parsed.fontSize : 14,
    };
  } catch {
    return { enabled: true, opacity: 0.85, fontSize: 14 };
  }
};

const loadPlayerPrefs = (): PlayerPrefs => {
  const defaults: PlayerPrefs = {
    eqPreset: 'flat',
    subtitleDelay: 0,
    subtitleSize: 'md',
    subtitleColor: '#ffffff',
    autoSkipIntro: false,
    introDuration: 85,
    colorFilter: DEFAULT_FILTER,
    showHealthGauge: true,
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
      autoSkipIntro:
        typeof parsed.autoSkipIntro === 'boolean' ? parsed.autoSkipIntro : defaults.autoSkipIntro,
      introDuration: INTRO_DURATION_OPTIONS.includes(parsed.introDuration as number)
        ? (parsed.introDuration as number)
        : defaults.introDuration,
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
          : defaults.showHealthGauge,
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
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  const scrubRatioRef = useRef<number | null>(null);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
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
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [brightness, setBrightness] = useState<number>(() => prefs.colorFilter.brightness);
  const [contrast, setContrast] = useState<number>(() => prefs.colorFilter.contrast);
  const [saturation, setSaturation] = useState<number>(() => prefs.colorFilter.saturation);
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

  // ===== Pro Tools: Aspect Ratio Fit Mode =====
  type FitMode = 'contain' | 'cinema' | 'stretch' | 'cover';
  const [fitMode, setFitMode] = useState<FitMode>(() => {
    if (typeof window === 'undefined') return 'contain';
    const saved = localStorage.getItem('bofilm_player_fit');
    return ['contain', 'cinema', 'stretch', 'cover'].includes(saved as FitMode)
      ? (saved as FitMode)
      : 'contain';
  });

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
  const [prefs, setPrefs] = useState<PlayerPrefs>(() => loadPlayerPrefs());
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

  // ===== Skip Intro preferences (persisted in bofilm_player_prefs) =====
  const [autoSkipIntro, setAutoSkipIntro] = useState<boolean>(() => prefs.autoSkipIntro);
  const [introDuration, setIntroDuration] = useState<number>(() => prefs.introDuration);

  // ===== Stream Health & Buffer Gauge =====
  const [showHealthGauge, setShowHealthGauge] = useState<boolean>(() => prefs.showHealthGauge);
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
          autoSkipIntro,
          introDuration,
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
    autoSkipIntro,
    introDuration,
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

  // Sleep Timer State
  const [sleepTimerOption, setSleepTimerOption] = useState<number | 'end' | 'off'>('off');
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null);
  const [sleepRemaining, setSleepRemaining] = useState<number>(0);
  const [sleepPausedOverlay, setSleepPausedOverlay] = useState(false);
  const [sleepFading, setSleepFading] = useState(false);
  const [sleepBadgeFlash, setSleepBadgeFlash] = useState(false);
  const sleepFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Auto-floating Skip Intro (+85s) State
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  const dismissedSkipIntroRef = useRef<boolean>(false);
  const autoSkipIntroFiredRef = useRef<boolean>(false);

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

  // ===== A-B Loop Repeat Mode =====
  const [abLoop, setAbLoop] = useState<{ a: number | null; b: number | null; active: boolean }>({
    a: null,
    b: null,
    active: false,
  });

  // ===== Scene Bookmarks (marker lưu theo phim & tập, kèm nhãn) =====
  type SceneBookmark = { t: number; label: string };
  const [bookmarks, setBookmarks] = useState<SceneBookmark[]>([]);
  const bookmarkKey = `bofilm_bookmarks_${movieSlug || 'default'}_${episodeSlug || 'default'}`;

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(bookmarkKey) : null;
      const parsed = raw ? JSON.parse(raw) : [];
      const normalized = (Array.isArray(parsed) ? parsed : [])
        .map((b: unknown) => {
          if (typeof b === 'number') return { t: b, label: '' };
          if (b && typeof b === 'object' && typeof (b as SceneBookmark).t === 'number') {
            return { t: (b as SceneBookmark).t, label: String((b as SceneBookmark).label || '') };
          }
          return null;
        })
        .filter((b): b is SceneBookmark => b !== null)
        .sort((a: SceneBookmark, b: SceneBookmark) => a.t - b.t);
      setBookmarks(normalized);
    } catch {
      setBookmarks([]);
    }
  }, [bookmarkKey]);

  const persistBookmarks = useCallback(
    (next: SceneBookmark[]) => {
      setBookmarks(next);
      try {
        localStorage.setItem(bookmarkKey, JSON.stringify(next));
      } catch {
        // ignore quota/storage errors
      }
    },
    [bookmarkKey]
  );

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
  const sleepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // ===== Danmaku / Floating Bullet Comments Engine =====
  const [danmakuSettings, setDanmakuSettings] = useState<DanmakuSettings>(() =>
    loadDanmakuSettings()
  );
  const [danmakuComments, setDanmakuComments] = useState<DanmakuComment[]>([]);
  const [danmakuFlying, setDanmakuFlying] = useState<DanmakuFlying[]>([]);
  const [danmakuInputText, setDanmakuInputText] = useState('');
  const danmakuPosRef = useRef<number>(0);
  const danmakuLaneRef = useRef<number>(0);
  const commentsKey = `bofilm_danmaku_${movieSlug || 'default'}_${episodeSlug || 'default'}`;

  useEffect(() => {
    let comments: DanmakuComment[] = [];
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(commentsKey) : null;
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        comments = parsed.filter(
          (c: unknown) =>
            c &&
            typeof c === 'object' &&
            typeof (c as DanmakuComment).t === 'number' &&
            typeof (c as DanmakuComment).text === 'string'
        ).map((c: DanmakuComment) => ({
          t: c.t,
          text: c.text,
          kind: c.kind === 'emoji' ? 'emoji' : 'text',
        }));
      }
    } catch {
      comments = [];
    }
    if (comments.length === 0) {
      comments = DANMAKU_SEED_TEXTS.map((text, i) => ({
        t: 12 + i * 37,
        text,
        kind: 'text' as const,
      }));
      try {
        localStorage.setItem(commentsKey, JSON.stringify(comments));
      } catch {
        // ignore quota/storage errors
      }
    }
    comments.sort((a, b) => a.t - b.t);
    setDanmakuComments(comments);
    danmakuPosRef.current = videoRef.current?.currentTime ?? 0;
    setDanmakuFlying([]);
  }, [commentsKey]);

  useEffect(() => {
    try {
      localStorage.setItem(DANMAKU_SETTINGS_KEY, JSON.stringify(danmakuSettings));
    } catch {
      // ignore quota/storage errors
    }
  }, [danmakuSettings]);

  const spawnDanmaku = useCallback((text: string, kind: 'text' | 'emoji') => {
    const lane = danmakuLaneRef.current;
    danmakuLaneRef.current = (danmakuLaneRef.current + 1) % DANMAKU_LANES;
    setDanmakuFlying((prev) =>
      [
        ...prev.slice(-29),
        {
          id: Date.now() + Math.random(),
          text,
          kind,
          lane,
          duration: 6 + Math.random() * 2,
        },
      ]
    );
  }, []);

  const handleDanmakuToggle = useCallback(() => {
    setDanmakuSettings((prev) => {
      const next = { ...prev, enabled: !prev.enabled };
      if (next.enabled) {
        danmakuPosRef.current = videoRef.current?.currentTime ?? 0;
      }
      triggerFeedback(next.enabled ? 'Bật bình luận bay' : 'Tắt bình luận bay');
      return next;
    });
  }, [triggerFeedback]);

  const updateDanmakuSetting = useCallback((patch: Partial<DanmakuSettings>) => {
    setDanmakuSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Launch stored comments as playback passes their timestamp
  useEffect(() => {
    if (!danmakuSettings.enabled || playerMode !== 'hls') {
      danmakuPosRef.current = currentTime;
      return;
    }
    const prev = danmakuPosRef.current;
    if (currentTime >= prev && currentTime - prev < 3) {
      danmakuComments
        .filter((c) => c.t > prev && c.t <= currentTime)
        .forEach((c) => spawnDanmaku(c.text, c.kind));
    }
    danmakuPosRef.current = currentTime;
  }, [currentTime, danmakuComments, danmakuSettings.enabled, playerMode, spawnDanmaku]);

  const persistDanmakuComment = useCallback(
    (comment: DanmakuComment) => {
      spawnDanmaku(comment.text, comment.kind);
      setDanmakuComments((prevCommentList) => {
        const next = [...prevCommentList, comment].sort((a, b) => a.t - b.t);
        try {
          localStorage.setItem(commentsKey, JSON.stringify(next));
        } catch {
          // ignore quota/storage errors
        }
        return next;
      });
    },
    [commentsKey, spawnDanmaku]
  );

  const handleDanmakuSubmit = useCallback(() => {
    const text = danmakuInputText.trim();
    if (!text) return;
    const t = videoRef.current?.currentTime ?? 0;
    persistDanmakuComment({ t, text, kind: 'text' });
    setDanmakuInputText('');
  }, [danmakuInputText, persistDanmakuComment]);

  const handleDanmakuReaction = useCallback(
    (emoji: string) => {
      const t = videoRef.current?.currentTime ?? 0;
      persistDanmakuComment({ t, text: emoji, kind: 'emoji' });
    },
    [persistDanmakuComment]
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
      if (sleepFadeTimeoutRef.current) {
        clearTimeout(sleepFadeTimeoutRef.current);
        sleepFadeTimeoutRef.current = null;
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
      const isFs =
        Boolean(document.fullscreenElement) ||
        Boolean((document as any).webkitFullscreenElement) ||
        isPseudoFullscreen;
      setIsFullscreen(isFs);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isPseudoFullscreen]);

  // Handle pseudo fullscreen body locking
  useEffect(() => {
    if (isPseudoFullscreen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setIsPseudoFullscreen(false);
      };
      window.addEventListener('keydown', handleEsc);
      return () => {
        document.body.style.overflow = prev;
        window.removeEventListener('keydown', handleEsc);
      };
    }
  }, [isPseudoFullscreen]);

  // Check PiP support and track PiP state
  useEffect(() => {
    const video = videoRef.current;
    const supported =
      typeof document !== 'undefined' &&
      (Boolean(document.pictureInPictureEnabled) ||
        Boolean(
          (video as any)?.webkitSupportsPresentationMode &&
            typeof (video as any).webkitSetPresentationMode === 'function'
        ) ||
        (typeof navigator !== 'undefined' &&
          /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) &&
          'ontouchend' in document));
    setIsPipSupported(supported);

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
  }, [playerMode, key]);

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

  // ===== Sleep Timer (Hẹn Giờ Tắt) =====
  const clearSleepFadeTimeouts = useCallback(() => {
    if (sleepFadeTimeoutRef.current) {
      clearTimeout(sleepFadeTimeoutRef.current);
      sleepFadeTimeoutRef.current = null;
    }
  }, []);

  const stopSleepTimer = useCallback(() => {
    if (sleepTimerRef.current) {
      clearInterval(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    clearSleepFadeTimeouts();
    setSleepEndsAt(null);
    setSleepRemaining(0);
    setSleepFading(false);
  }, [clearSleepFadeTimeouts]);

  const handleSleepPausedResume = useCallback(() => {
    setSleepPausedOverlay(false);
    triggerFeedback('Tiếp tục xem', 'play');
    const video = videoRef.current;
    if (video) {
      video.play().catch(() => {});
    }
  }, [triggerFeedback]);

  // Gently fade volume to zero over 3 seconds, then pause & show overlay
  const beginSleepFadeOut = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const savedVolume = video.volume;
    const savedMuted = video.muted;
    setSleepFading(true);
    video.muted = false;
    const FADE_MS = 3000;
    const STEPS = 30;
    for (let i = 1; i <= STEPS; i++) {
      sleepFadeTimeoutRef.current = setTimeout(() => {
        if (!videoRef.current) return;
        const progress = i / STEPS;
        videoRef.current.volume = Math.max(0, savedVolume * (1 - progress));
        if (i === STEPS) {
          videoRef.current.pause();
          videoRef.current.volume = savedVolume;
          videoRef.current.muted = savedMuted;
          setSleepFading(false);
          setSleepPausedOverlay(true);
        }
      }, (FADE_MS / STEPS) * i);
    }
  }, []);

  const handleSleepTimerSelect = useCallback(
    (option: number | 'end' | 'off') => {
      setSleepTimerOption(option);
      stopSleepTimer();
      if (option === 'off') {
        triggerFeedback('Hẹn giờ tắt: Tắt');
      } else if (option === 'end') {
        triggerFeedback('Hẹn giờ tắt: Hết tập');
      } else {
        const endsAt = Date.now() + option * 60 * 1000;
        setSleepTimerMinutes(option);
        setSleepEndsAt(endsAt);
        setSleepRemaining(option * 60);
        triggerFeedback(`Hẹn giờ tắt: ${option} phút`);
        setSleepBadgeFlash(true);
        sleepFadeTimeoutRef.current = setTimeout(() => setSleepBadgeFlash(false), 4000);
      }
      setShowSettingsMenu(false);
    },
    [stopSleepTimer, triggerFeedback]
  );

  // Sleep timer countdown tick
  useEffect(() => {
    if (sleepEndsAt === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((sleepEndsAt - Date.now()) / 1000));
      setSleepRemaining(remaining);
      if (remaining <= 0) {
        stopSleepTimer();
        setSleepTimerOption('off');
        beginSleepFadeOut();
      }
    };
    tick();
    sleepTimerRef.current = setInterval(tick, 1000);
    return () => {
      if (sleepTimerRef.current) {
        clearInterval(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
    };
  }, [sleepEndsAt, stopSleepTimer, triggerFeedback, beginSleepFadeOut]);

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

  // Format sleep remaining as mm:ss
  const formatSleepRemaining = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ===== Cinematic Ambient Glow Mode handlers =====
  const handleAmbientGlowToggle = useCallback(() => {
    setAmbientGlow((prev) => {
      const next = !prev;
      localStorage.setItem('bofilm_player_ambient_glow', next ? 'on' : 'off');
      triggerFeedback(next ? 'Đã bật hào quang điện ảnh' : 'Đã tắt hào quang điện ảnh', 'volume');
      return next;
    });
  }, [triggerFeedback]);

  // ===== A-B Loop handlers =====
  const handleSetLoopA = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    setAbLoop((prev) => ({ ...prev, a: t, active: prev.b !== null && t < prev.b }));
    triggerFeedback(`Điểm A: ${formatTime(t)}`, 'volume');
  }, [triggerFeedback]);

  const handleSetLoopB = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    setAbLoop((prev) => {
      const a = prev.a !== null && prev.a < t ? prev.a : Math.max(0, t - 1);
      return { a, b: t, active: true };
    });
    triggerFeedback(`Điểm B: ${formatTime(t)} — Vòng lặp bật`, 'volume');
  }, [triggerFeedback]);

  const handleClearLoop = useCallback(() => {
    setAbLoop({ a: null, b: null, active: false });
    triggerFeedback('Đã tắt vòng lặp A-B', 'volume');
  }, [triggerFeedback]);

  // A-B Loop engine: rewind to Point A whenever playback passes Point B
  useEffect(() => {
    if (!abLoop.active || abLoop.a === null || abLoop.b === null) return;
    if (abLoop.b <= abLoop.a) return;
    if (currentTime > abLoop.b && videoRef.current) {
      videoRef.current.currentTime = abLoop.a;
      setCurrentTime(abLoop.a);
    }
  }, [currentTime, abLoop.active, abLoop.a, abLoop.b]);

  // ===== Scene Bookmarks handlers =====
  const handleAddBookmark = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    const label = `Đánh dấu ${formatTime(t)}`;
    setBookmarks((prev) => {
      if (prev.some((b) => Math.abs(b.t - t) < 1)) return prev;
      const next = [...prev, { t, label }].sort((a, b) => a.t - b.t);
      try {
        localStorage.setItem(bookmarkKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    triggerFeedback(`Đã đánh dấu khoảnh khắc: ${formatTime(t)}`, 'volume');
  }, [bookmarks, triggerFeedback]);

  const handleJumpToBookmark = useCallback(
    (t: number) => {
      if (!videoRef.current) return;
      videoRef.current.currentTime = t;
      setCurrentTime(t);
      videoRef.current.play().catch(() => {});
      triggerFeedback(`Nhảy đến ${formatTime(t)}`, 'seek-forward');
    },
    [triggerFeedback]
  );

  const handleRemoveBookmark = useCallback(
    (t: number) => {
      setBookmarks((prev) => {
        const next = prev.filter((b) => b.t !== t);
        try {
          localStorage.setItem(bookmarkKey, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      triggerFeedback('Đã xóa mốc đánh dấu', 'volume');
    },
    [bookmarks, triggerFeedback]
  );

  // Reset Skip Intro dismiss on new episode or movie
  useEffect(() => {
    dismissedSkipIntroRef.current = false;
    autoSkipIntroFiredRef.current = false;
    setShowSkipIntro(false);
  }, [movieSlug, episodeSlug]);

  // Auto-floating Skip Intro detection (5s .. 95s window)
  useEffect(() => {
    if (playerMode !== 'hls') {
      setShowSkipIntro(false);
      return;
    }
    const inIntroRange = currentTime >= 5 && currentTime <= 95;
    const isLongEnough = !duration || duration >= 180;
    if (inIntroRange && isLongEnough && !dismissedSkipIntroRef.current) {
      setShowSkipIntro(true);
    } else if (!inIntroRange) {
      setShowSkipIntro(false);
    }
  }, [currentTime, duration, playerMode]);

  // Skip Intro Handler: seek forward by intro duration
  const handleSkipIntro = useCallback(() => {
    if (!videoRef.current) return;
    const next = Math.max(0, Math.min(duration || 99999, videoRef.current.currentTime + introDuration));
    videoRef.current.currentTime = next;
    setCurrentTime(next);
    dismissedSkipIntroRef.current = true;
    setShowSkipIntro(false);
    triggerFeedback('Đã bỏ qua đoạn mở đầu', 'seek-forward');
  }, [duration, introDuration, triggerFeedback]);

  // Auto-Skip Intro: fire once per episode at the 5s mark
  useEffect(() => {
    if (!autoSkipIntro || playerMode !== 'hls') return;
    if (autoSkipIntroFiredRef.current) return;
    if (currentTime < 5) return;
    const isLongEnough = !duration || duration >= 180;
    if (!isLongEnough) return;
    if (dismissedSkipIntroRef.current) return;
    autoSkipIntroFiredRef.current = true;
    handleSkipIntro();
  }, [currentTime, autoSkipIntro, playerMode, duration, episodeSlug, handleSkipIntro]);

  // ===== Hold-to-2x Speed state & handlers =====

  const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  // ===== Pro Tools: Native Frame Screenshot Capture =====
  const handleCaptureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      triggerFeedback('Chưa có khung hình để chụp', 'volume');
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const clean = (s: string) => s.replace(/[^a-zA-Z0-9-_ ]+/g, '').trim().replace(/\s+/g, '-') || 'frame';
      const filename = `${clean(movieName)}-${clean(episodeName || 'tap-1')}-${formatTime(currentTime).replace(/:/g, '-')}.png`;
      try {
        // Safari: needs the element in DOM to call toBlob
        canvas.toBlob((blob) => {
          if (!blob) {
            triggerFeedback('Không thể chụp khung hình', 'volume');
            return;
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          triggerFeedback('Đã lưu ảnh khung hình', 'volume');
        }, 'image/png');
      } catch {
        // Canvas tainted by cross-origin data without CORS headers
        triggerFeedback('Nguồn phát không cho phép chụp khung hình', 'volume');
      }
    } catch (err: any) {
      console.warn('Screenshot error:', err);
      triggerFeedback('Nguồn phát không cho phép chụp khung hình', 'volume');
    }
  }, [movieName, episodeName, currentTime, triggerFeedback]);

  // ===== Pro Tools: Aspect Ratio Fit Mode selection =====
  const FIT_MODES: { value: FitMode; label: string }[] = [
    { value: 'contain', label: 'Vừa khung 16:9 (Mặc định)' },
    { value: 'cinema', label: 'Điện ảnh 21:9 Cinema' },
    { value: 'stretch', label: 'Kéo giãn Stretch' },
    { value: 'cover', label: 'Phủ toàn khung Zoom Cover' },
  ];
  const FIT_LABELS: Record<FitMode, string> = {
    contain: '16:9',
    cinema: '21:9',
    stretch: 'Fill',
    cover: 'Zoom',
  };
  const handleFitModeSelect = useCallback(
    (mode: FitMode) => {
      setFitMode(mode);
      localStorage.setItem('bofilm_player_fit', mode);
      setShowSettingsMenu(false);
      triggerFeedback(`Khung hình: ${FIT_LABELS[mode]}`, 'volume');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [triggerFeedback]
  );

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
          fitMode: FIT_LABELS[fitMode],
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
        case 'Slash': {
          e.preventDefault();
          setShowShortcutsModal((prev) => !prev);
          break;
        }
        case 'KeyP': {
          e.preventDefault();
          togglePip();
          break;
        }
        case 'KeyS': {
          if (showSkipIntro) {
            e.preventDefault();
            handleSkipIntro();
          }
          break;
        }
        case 'KeyD': {
          e.preventDefault();
          handleDanmakuToggle();
          break;
        }
        case 'KeyB': {
          e.preventDefault();
          handleAddBookmark();
          break;
        }
        case 'KeyZ': {
          e.preventDefault();
          const cycleOrder: FitMode[] = ['contain', 'cover', 'stretch'];
          const nextMode =
            cycleOrder[(cycleOrder.indexOf(fitMode) + 1) % cycleOrder.length] ?? 'contain';
          setFitMode(nextMode);
          localStorage.setItem('bofilm_player_fit', nextMode);
          triggerFeedback(`Khung hình: ${FIT_LABELS[nextMode]}`, 'volume');
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
  }, [playerMode, triggerFeedback, playbackSpeed, handleSpeedSelect, togglePip, showSkipIntro, handleSkipIntro, toggleTheater, isTheater, fitMode, handleAddBookmark, handleDanmakuToggle]);

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

  // On-demand resolver for uncached episode
  useEffect(() => {
    if (playerMode !== 'embed' || !movieSlug) return;
    if (hlsFallbackErrorRef.current) return;

    let isDisposed = false;
    const cleanEpisode =
      (episodeName || '').replace(/^Tập\s*/i, '').trim() ||
      (episodeSlug || '').replace(/^tap-/i, '').trim() ||
      '1';

    let checkStreamTimer: ReturnType<typeof setTimeout> | null = null;
    if (!isManualModeRef.current && playerModeProp !== 'embed') {
      checkStreamTimer = setTimeout(async () => {
        if (isDisposed || isManualModeRef.current || hlsFallbackErrorRef.current) return;
        try {
          const streamCheckUrl =
            m3u8Url ||
            `/api/stream/${encodeURIComponent(movieSlug)}/ep/${encodeURIComponent(cleanEpisode)}/master.m3u8${
              serverIndex !== undefined ? `?server=${serverIndex}` : ''
            }`;
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
    const cleanEpisode =
      (episodeName || '').replace(/^Tập\s*/i, '').trim() ||
      (episodeSlug || '').replace(/^tap-/i, '').trim() ||
      '1';
    const currentEpKey = `${movieSlug || ''}:${cleanEpisode}`;

    let streamUrl: string;
    if (m3u8Url) {
      streamUrl = m3u8Url;
      if (serverIndex !== undefined) {
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
    } else if (movieSlug && cleanEpisode) {
      const serverParam = serverIndex !== undefined ? `?server=${serverIndex}` : '';
      streamUrl = `/api/stream/${encodeURIComponent(movieSlug)}/ep/${encodeURIComponent(cleanEpisode)}/master.m3u8${serverParam}`;
    } else {
      return;
    }

    if (streamUrl.startsWith('http')) {
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
                  hlsFallbackErrorRef.current = true;
                  setPlayerMode('embed');
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
                  hlsFallbackErrorRef.current = true;
                  setPlayerMode('embed');
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
            hlsFallbackErrorRef.current = true;
            setPlayerMode('embed');
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
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;

    const isCurrentlyFullscreen =
      Boolean(document.fullscreenElement) ||
      Boolean((document as any).webkitFullscreenElement) ||
      isPseudoFullscreen;

    if (!isCurrentlyFullscreen) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {
          if (video && typeof (video as any).webkitEnterFullscreen === 'function') {
            (video as any).webkitEnterFullscreen();
          } else {
            setIsPseudoFullscreen(true);
          }
        });
      } else if ((container as any).webkitRequestFullscreen) {
        try {
          (container as any).webkitRequestFullscreen();
        } catch {
          if (video && typeof (video as any).webkitEnterFullscreen === 'function') {
            (video as any).webkitEnterFullscreen();
          } else {
            setIsPseudoFullscreen(true);
          }
        }
      } else if (video && typeof (video as any).webkitEnterFullscreen === 'function') {
        (video as any).webkitEnterFullscreen();
      } else {
        setIsPseudoFullscreen(true);
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitFullscreenElement && (document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
      setIsPseudoFullscreen(false);
    }
  }, [isPseudoFullscreen]);

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
      const newBrightness = Math.max(0.3, Math.min(1.6, state.initialBrightness + change));
      setBrightness(newBrightness);

      if (touchHudTimerRef.current) clearTimeout(touchHudTimerRef.current);
      setTouchHud({
        type: 'brightness',
        value: Math.round(newBrightness * 100),
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
      localStorage.setItem('bofilm_player_volume', String(rounded));

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
        now - lastTap.time < 320 &&
        Math.hypot(state.startX - lastTap.x, state.startY - lastTap.y) < 40
      ) {
        // Double tap confirmed!
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        lastTapInfoRef.current = null;

        if (relativeX < 0.38) {
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
          }, 800);
        } else if (relativeX > 0.62) {
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
          }, 800);
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
        }, 240);
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
  const getSeekRatioFromClientX = (clientX: number) => {
    if (!seekbarRef.current) return 0;
    const rect = seekbarRef.current.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const rawRatio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, rawRatio));
  };

  const handleSeekbarClick = (e: React.MouseEvent) => {
    if (!duration) return;
    const ratio = getSeekRatioFromClientX(e.clientX);
    const targetTime = ratio >= 0.999 ? Math.max(0, duration - 0.25) : ratio * duration;
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
    }
    setCurrentTime(targetTime);
  };

  const handleSeekbarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!seekbarRef.current || !duration) return;
    isScrubbingRef.current = true;
    setIsScrubbing(true);

    const updateSeekPosition = (clientX: number) => {
      if (!seekbarRef.current || !duration) return 0;
      const ratio = getSeekRatioFromClientX(clientX);
      scrubRatioRef.current = ratio;
      setScrubRatio(ratio);
      const targetTime = ratio * duration;
      setCurrentTime(targetTime);
      setHoverTime(targetTime);
      setHoverRatio(ratio * 100);
      return targetTime;
    };

    updateSeekPosition(e.clientX);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      updateSeekPosition(moveEvent.clientX);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      const finalTarget = updateSeekPosition(upEvent.clientX);
      const finalRatio = scrubRatioRef.current ?? (duration > 0 ? finalTarget / duration : 0);
      const safeTarget =
        finalRatio >= 0.999
          ? Math.max(0, duration - 0.25)
          : Math.max(0, Math.min(duration, finalRatio * duration));

      if (videoRef.current) {
        videoRef.current.currentTime = safeTarget;
      }
      setCurrentTime(safeTarget);
      isScrubbingRef.current = false;
      scrubRatioRef.current = null;
      setIsScrubbing(false);
      setScrubRatio(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleSeekbarTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (!seekbarRef.current || !duration || e.touches.length === 0) return;
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    const ratio = getSeekRatioFromClientX(e.touches[0].clientX);
    scrubRatioRef.current = ratio;
    setScrubRatio(ratio);
    const targetTime = ratio * duration;
    setCurrentTime(targetTime);
  };

  const handleSeekbarTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (!seekbarRef.current || !duration || e.touches.length === 0) return;
    const ratio = getSeekRatioFromClientX(e.touches[0].clientX);
    scrubRatioRef.current = ratio;
    setScrubRatio(ratio);
    const targetTime = ratio * duration;
    setCurrentTime(targetTime);
  };

  const handleSeekbarTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (!duration) return;
    const finalRatio = scrubRatioRef.current ?? 0;
    const safeTarget =
      finalRatio >= 0.999
        ? Math.max(0, duration - 0.25)
        : Math.max(0, Math.min(duration, finalRatio * duration));

    if (videoRef.current) {
      videoRef.current.currentTime = safeTarget;
    }
    setCurrentTime(safeTarget);
    isScrubbingRef.current = false;
    scrubRatioRef.current = null;
    setIsScrubbing(false);
    setScrubRatio(null);
  };

  const handleSeekbarMouseMove = (e: React.MouseEvent) => {
    if (!seekbarRef.current || !duration) return;
    const ratio = getSeekRatioFromClientX(e.clientX);
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
                  title: 'Phát lại / Điều khiển',
                  items: [
                    { keys: ['D'], desc: 'Bật / tắt bình luận bay (Danmaku)' },
                  ],
                },
                {
                  title: 'Tua video',
                  items: [
                    { keys: ['←', 'J'], desc: 'Lùi lại 10 giây' },
                    { keys: ['→', 'L'], desc: 'Tiến tới 10 giây' },
                    { keys: ['S'], desc: 'Bỏ qua phần giới thiệu (+85s, khi có)' },
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
                  title: 'Đánh dấu & vòng lặp',
                  items: [
                    { keys: ['B'], desc: 'Đánh dấu khoảnh khắc (Bookmark) tại thời điểm hiện tại' },
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
                    { keys: ['Z'], desc: 'Xoay vòng khung hình: Vừa khung / Zoom / Fill' },
                    { keys: ['F'], desc: 'Toàn màn hình' },
                    { keys: ['T'], desc: 'Chế độ rạp chiếu (Theater mode)' },
                    { keys: ['P'], desc: 'Hình trong hình (PiP)' },
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
            {sleepEndsAt !== null && sleepRemaining > 0 && (
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/40 shadow-sm ${
                  sleepBadgeFlash ? 'animate-pulse ring-1 ring-amber-400' : ''
                }`}
                title="Hẹn giờ tắt đang hoạt động"
              >
                <Timer className="w-3 h-3" />
                <span>{formatSleepRemaining(sleepRemaining)}</span>
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
                <span className="text-[11px] sm:text-xs">PiP</span>
              </button>
            )}

            {/* Pro Tools: Frame Screenshot Button */}
            <button
              type="button"
              onClick={handleCaptureFrame}
              className="p-1 rounded-lg bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 transition-colors cursor-pointer"
              title="Chụp ảnh khung hình hiện tại (screenshot)"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>

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
          className={`relative z-10 ${
            isPseudoFullscreen
              ? '!fixed !inset-0 !z-[9999] !w-screen !h-[100dvh] !max-w-none !aspect-auto !rounded-none !border-0'
              : 'aspect-video w-full bg-black rounded-none sm:rounded-b-2xl overflow-hidden border-x-0 sm:border border-lime-500/25 shadow-[0_10px_45px_rgba(0,0,0,0.85)] select-none'
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
                  const video = videoRef.current;
                  if (
                    typeof document !== 'undefined' &&
                    (Boolean(document.pictureInPictureEnabled) ||
                      Boolean(
                        (video as any)?.webkitSupportsPresentationMode &&
                          typeof (video as any).webkitSetPresentationMode === 'function'
                      ) ||
                      (typeof navigator !== 'undefined' &&
                        /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) &&
                        'ontouchend' in document))
                  ) {
                    setIsPipSupported(true);
                  }
                }}
                onEnded={() => {
                  setIsPlaying(false);
                  setShowControls(true);
                  if (sleepTimerOption === 'end') {
                    setSleepTimerOption('off');
                    setSleepTimerMinutes(null);
                    stopSleepTimer();
                    videoRef.current?.pause();
                    setSleepPausedOverlay(true);
                    return;
                  }
                  if (nextEpisode && onNextEpisode) {
                    setAutoNextCountdown(15);
                  }
                }}
                className={`absolute inset-0 w-full h-full bg-black ${
                  fitMode === 'stretch'
                    ? 'object-fill'
                    : fitMode === 'cover'
                    ? 'object-cover'
                    : 'object-contain'
                }`}
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

              {/* Pro Tools: 21:9 Cinema letterbox bars */}
              {fitMode === 'cinema' && (
                <>
                  <div
                    className="absolute inset-x-0 top-0 bg-black z-[5] pointer-events-none"
                    style={{ height: `${((1 - 16 / 21) / 2) * 100}%` }}
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 bg-black z-[5] pointer-events-none"
                    style={{ height: `${((1 - 16 / 21) / 2) * 100}%` }}
                  />
                </>
              )}

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
            <span className="text-[#8aa885]">Chế độ khung:</span>
            <span className="text-white">{stats.fitMode}</span>
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

      {/* Sleep Timer Pause Overlay */}
      {sleepPausedOverlay && (
        <div className="player-controls-interactive absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 max-w-sm w-full rounded-3xl bg-[#0a180b]/95 border border-amber-500/30 p-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.9)]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-950/70 border border-amber-500/40">
              <Timer className="w-7 h-7 text-amber-300" />
            </div>
            <h3 className="text-base font-extrabold text-[#f4fbf0] mb-1">
              Đã tạm dừng theo hẹn giờ tắt
            </h3>
            <p className="text-xs text-[#8aa885] mb-5">
              {sleepTimerMinutes
                ? `Hẹn giờ ${sleepTimerMinutes} phút đã hoàn tất.`
                : 'Tập phim đã phát hết theo hẹn giờ.'}
            </p>
            <button
              type="button"
              onClick={handleSleepPausedResume}
              className="w-full px-4 py-2.5 rounded-xl bg-lime-500 text-black text-sm font-extrabold hover:bg-lime-400 transition-colors cursor-pointer shadow-md"
            >
              Tiếp tục xem
            </button>
          </div>
        </div>
      )}

      {/* Sleep Timer volume fade indicator */}
      {sleepFading && (
        <div className="absolute inset-0 z-40 flex items-end justify-center pb-24 pointer-events-none">
          <span className="px-3 py-1.5 rounded-xl bg-amber-950/90 border border-amber-500/40 text-amber-200 text-xs font-bold shadow-md">
            Đang giảm âm lượng từ từ...
          </span>
        </div>
      )}

              {/* Double Tap Ripple Animations for Mobile/Touch */}
              {doubleTapEffect?.side === 'left' && (
                <div className="absolute left-0 top-0 bottom-0 w-1/3 flex items-center justify-center bg-gradient-to-r from-lime-500/20 via-lime-500/10 to-transparent pointer-events-none rounded-r-full z-30 animate-in fade-in zoom-in-90 duration-150">
                  <div className="flex flex-col items-center gap-1 bg-black/75 backdrop-blur-md px-3.5 py-2.5 rounded-2xl border border-lime-500/40 shadow-2xl">
                    <ChevronsLeft className="w-7 h-7 text-lime-400 animate-pulse" />
                    <span className="text-xs font-black text-[#f4fbf0]">
                      -{doubleTapEffect.count}s
                    </span>
                  </div>
                </div>
              )}

              {doubleTapEffect?.side === 'right' && (
                <div className="absolute right-0 top-0 bottom-0 w-1/3 flex items-center justify-center bg-gradient-to-l from-lime-500/20 via-lime-500/10 to-transparent pointer-events-none rounded-l-full z-30 animate-in fade-in zoom-in-90 duration-150">
                  <div className="flex flex-col items-center gap-1 bg-black/75 backdrop-blur-md px-3.5 py-2.5 rounded-2xl border border-lime-500/40 shadow-2xl">
                    <ChevronsRight className="w-7 h-7 text-lime-400 animate-pulse" />
                    <span className="text-xs font-black text-[#f4fbf0]">
                      +{doubleTapEffect.count}s
                    </span>
                  </div>
                </div>
              )}

              {/* Touch Gestures HUD (Seek, Brightness, Volume) */}
              {touchHud && (
                <div className="absolute inset-0 z-35 pointer-events-none flex items-center justify-center">
                  <div className="bg-black/85 backdrop-blur-md border border-lime-500/40 px-5 py-3.5 rounded-2xl flex flex-col items-center gap-2 shadow-[0_0_30px_rgba(132,204,22,0.35)] min-w-[150px] animate-in zoom-in-95 fade-in duration-100">
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

              {/* Mobile Normal Mode Quick PiP Button */}
              {!isFullscreen && isPipSupported && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePip();
                  }}
                  className={`sm:hidden absolute top-3 right-3 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-xl backdrop-blur-md border text-xs font-black shadow-[0_4px_16px_rgba(0,0,0,0.85)] transition-all cursor-pointer ${
                    showControls || !isPlaying
                      ? 'opacity-100 pointer-events-auto'
                      : 'opacity-0 pointer-events-none'
                  } ${
                    isPip
                      ? 'bg-lime-500/30 text-lime-300 border-lime-500/60 shadow-[0_0_12px_rgba(132,204,22,0.45)]'
                      : 'bg-black/80 hover:bg-black/95 text-[#f4fbf0] hover:text-lime-300 border-lime-500/40 active:scale-95'
                  }`}
                  title={isPip ? 'Thoát Picture-in-Picture' : 'Chế độ hình trong hình (PiP)'}
                >
                  <PictureInPicture2 className="w-3.5 h-3.5" />
                  <span>{isPip ? 'Đang PiP' : 'PiP'}</span>
                </button>
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

              {/* Auto-floating Skip Intro (+85s) Button */}
              {showSkipIntro && (
                <div className="player-controls-interactive absolute bottom-16 sm:bottom-20 right-3 sm:right-6 z-30 flex items-center animate-in fade-in slide-in-from-bottom-3 duration-300">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSkipIntro();
                    }}
                    className="flex items-center gap-2 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-[#061406]/90 hover:bg-lime-500 text-lime-300 hover:text-black border border-lime-400/50 hover:border-lime-300 backdrop-blur-md shadow-[0_4px_25px_rgba(0,0,0,0.85)] text-xs sm:text-sm font-black transition-all transform hover:scale-105 cursor-pointer group"
                    title="Bỏ qua phần giới thiệu đầu phim (+85 giây, phím S)"
                  >
                    <FastForward className="w-4 h-4 fill-current group-hover:fill-black text-lime-400 group-hover:text-black transition-colors" />
                    <span>Bỏ qua mở đầu (+{introDuration}s)</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissedSkipIntroRef.current = true;
                      setShowSkipIntro(false);
                    }}
                    className="ml-1.5 p-2 rounded-xl bg-[#061406]/80 hover:bg-black text-[#8aa885] hover:text-white border border-lime-500/20 backdrop-blur-md transition-colors cursor-pointer"
                    title="Đóng thông báo"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
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
                  className="player-controls-interactive fixed inset-0 sm:absolute sm:inset-0 z-50 sm:z-40 bg-black/90 backdrop-blur-xl flex flex-col animate-in fade-in duration-200"
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

              {/* Danmaku / Floating Bullet Comments Layer */}
              {playerMode === 'hls' && danmakuSettings.enabled && (
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 pointer-events-none select-none overflow-hidden z-20"
                >
                  <style>{`@keyframes bofilm-danmaku-fly {
                    from { transform: translate3d(0, 0, 0); }
                    to { transform: translate3d(-110vw, 0, 0); }
                  }`}</style>
                  {danmakuFlying.map((item) => (
                    <span
                      key={item.id}
                      onAnimationEnd={() =>
                        setDanmakuFlying((prev) => prev.filter((f) => f.id !== item.id))
                      }
                      className={`absolute right-0 whitespace-nowrap font-bold pointer-events-none will-change-transform drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] ${
                        item.kind === 'emoji'
                          ? 'flex items-center leading-none'
                          : 'rounded-full bg-black/45 px-2.5 py-0.5 text-white'
                      }`}
                      style={{
                        top: `${6 + item.lane * 11}%`,
                        fontSize:
                          item.kind === 'emoji'
                            ? `${Math.round(danmakuSettings.fontSize * 1.6)}px`
                            : `${danmakuSettings.fontSize}px`,
                        opacity: danmakuSettings.opacity,
                        animation: `bofilm-danmaku-fly ${item.duration.toFixed(2)}s linear forwards`,
                      }}
                    >
                      {item.text}
                    </span>
                  ))}
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
                {/* Danmaku Quick Reactions + Comment Input */}
                {playerMode === 'hls' && danmakuSettings.enabled && (
                  <div
                    className="flex flex-wrap items-center justify-center gap-1.5 mb-1.5 px-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center rounded-xl bg-black/70 border border-white/15 backdrop-blur-md overflow-hidden">
                      {DANMAKU_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleDanmakuReaction(emoji)}
                          className="w-6 sm:w-7 text-sm sm:text-base leading-none py-1 hover:scale-125 hover:bg-lime-500/20 transition-transform cursor-pointer"
                          title={`Thả reaction ${emoji} tại ${formatTime(currentTime)}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={danmakuInputText}
                      onChange={(e) => setDanmakuInputText(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleDanmakuSubmit();
                        }
                      }}
                      placeholder={`Bình luận bay tại ${formatTime(currentTime)}… (Enter để gửi)`}
                      maxLength={120}
                      onClick={(e) => e.stopPropagation()}
                      className="w-48 sm:w-64 h-6 rounded-xl bg-black/70 border border-white/15 focus:border-lime-400/60 focus:outline-none text-[11px] text-[#f4fbf0] placeholder:text-[#8aa885] px-2.5 backdrop-blur-md cursor-text"
                    />
                  </div>
                )}

                {/* Glassmorphism Seekbar */}
                {(() => {
                  const displayProgressPercent =
                    scrubRatio !== null
                      ? scrubRatio * 100
                      : duration > 0
                      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
                      : 0;
                  return (
                    <div
                      ref={seekbarRef}
                      onClick={handleSeekbarClick}
                      onMouseDown={handleSeekbarMouseDown}
                      onTouchStart={handleSeekbarTouchStart}
                      onTouchMove={handleSeekbarTouchMove}
                      onTouchEnd={handleSeekbarTouchEnd}
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
                          className={`absolute top-0 bottom-0 left-0 bg-gradient-to-r from-lime-500 via-lime-400 to-emerald-400 rounded-full shadow-[0_0_12px_rgba(163,230,53,0.7)] ${
                            isScrubbing ? 'transition-none' : ''
                          }`}
                          style={{
                            width: `${displayProgressPercent}%`,
                          }}
                        />
                        {/* A-B Loop Region Highlight */}
                        {abLoop.a !== null && abLoop.b !== null && duration > 0 && (
                          <div
                            className="absolute top-0 bottom-0 bg-cyan-400/40 border-x border-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.7)]"
                            style={{
                              left: `${(abLoop.a / duration) * 100}%`,
                              width: `${((abLoop.b - abLoop.a) / duration) * 100}%`,
                            }}
                          />
                        )}
                        {/* Scene Bookmark Markers (vibrant purple, click to jump) */}
                        {bookmarks.map((b) =>
                          duration > 0 ? (
                            <div
                              key={b.t}
                              className="group/bookmark absolute top-0 bottom-0 w-3 -translate-x-1/2 z-10 cursor-pointer"
                              style={{ left: `${(b.t / duration) * 100}%` }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToBookmark(b.t);
                              }}
                            >
                              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[3px] bg-fuchsia-400 rounded-full shadow-[0_0_10px_rgba(232,121,249,0.95)] transition-all group-hover/bookmark:w-[5px] group-hover/bookmark:bg-fuchsia-300" />
                              {/* Hover tooltip: bookmark label & time */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/bookmark:block whitespace-nowrap rounded-lg bg-[#0a180b] border border-fuchsia-500/40 px-2 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.8)]">
                                <span className="block text-[10px] font-bold text-fuchsia-300">
                                  {b.label || 'Bookmark'} • {formatTime(b.t)}
                                </span>
                                <span className="block text-[9px] text-[#8aa885]">
                                  Nhấn để nhảy đến mốc này
                                </span>
                              </div>
                              {/* Pin head above the bar */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 w-2 h-2 rounded-full bg-fuchsia-400 border border-fuchsia-200 shadow-[0_0_8px_rgba(232,121,249,0.95)] transition-transform group-hover/bookmark:scale-125" />
                            </div>
                          ) : null
                        )}
                      </div>

                      {/* A-B Loop Point Pins */}
                      {abLoop.a !== null && duration > 0 && (
                        <div
                          className="absolute bottom-full w-2.5 h-2.5 -translate-x-1/2 rounded-full bg-cyan-400 border-2 border-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.9)] pointer-events-none flex items-center justify-center text-[7px] font-black text-black"
                          title={`Điểm A: ${formatTime(abLoop.a)}`}
                          style={{ left: `${(abLoop.a / duration) * 100}%` }}
                        >
                          A
                        </div>
                      )}
                      {abLoop.b !== null && duration > 0 && (
                        <div
                          className="absolute bottom-full w-2.5 h-2.5 -translate-x-1/2 rounded-full bg-cyan-400 border-2 border-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.9)] pointer-events-none flex items-center justify-center text-[7px] font-black text-black"
                          title={`Điểm B: ${formatTime(abLoop.b)}`}
                          style={{ left: `${(abLoop.b / duration) * 100}%` }}
                        >
                          B
                        </div>
                      )}

                      {/* Glow Scrubber Thumb */}
                      <div
                        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-lime-400 border-2 border-white shadow-[0_0_10px_rgba(163,230,53,0.9)] ${
                          isScrubbing
                            ? 'opacity-100 transition-none scale-125'
                            : 'opacity-0 group-hover/bar:opacity-100 group-active/bar:opacity-100 transition-all'
                        } pointer-events-none`}
                        style={{
                          left: `${displayProgressPercent}%`,
                        }}
                      />
                    </div>
                  );
                })()}

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

                    {/* Scene Bookmark Button */}
                    {playerMode === 'hls' && (
                      <button
                        type="button"
                        onClick={handleAddBookmark}
                        className="flex items-center gap-0.5 px-1.5 py-1 rounded-xl text-[#cbe1c8] hover:text-fuchsia-300 hover:bg-white/10 transition-colors text-xs font-bold cursor-pointer"
                        title="Đánh dấu khoảnh khắc hiện tại (Phím B)"
                      >
                        <Bookmark className="w-4 h-4" />
                      </button>
                    )}

                    {/* A-B Loop Set Point Buttons */}
                    {playerMode === 'hls' && (
                      <div className="flex items-center gap-0.5 rounded-xl border border-cyan-500/20 bg-cyan-950/20 px-1 py-0.5">
                        <button
                          type="button"
                          onClick={handleSetLoopA}
                          disabled={abLoop.active && abLoop.a === null}
                          className={`px-1.5 py-0.5 rounded-lg text-[11px] font-black transition-colors cursor-pointer ${
                            abLoop.a !== null
                              ? 'text-cyan-300'
                              : 'text-[#cbe1c8] hover:text-cyan-300'
                          }`}
                          title="Chọn điểm A cho vòng lặp A-B"
                        >
                          A
                        </button>
                        <button
                          type="button"
                          onClick={handleSetLoopB}
                          className={`px-1.5 py-0.5 rounded-lg text-[11px] font-black transition-colors cursor-pointer ${
                            abLoop.b !== null
                              ? 'text-cyan-300'
                              : 'text-[#cbe1c8] hover:text-cyan-300'
                          }`}
                          title="Chọn điểm B & bật vòng lặp A-B"
                        >
                          B
                        </button>
                        {abLoop.active && (
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mx-0.5" />
                        )}
                      </div>
                    )}

                    {/* Danmaku Toggle Button (Phím D) */}
                    {playerMode === 'hls' && (
                      <button
                        type="button"
                        onClick={handleDanmakuToggle}
                        className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                          danmakuSettings.enabled
                            ? 'text-lime-300 bg-lime-500/15 border border-lime-500/50 shadow-[0_0_12px_rgba(132,204,22,0.55)]'
                            : 'text-[#8aa885] hover:text-lime-300 hover:bg-white/10'
                        }`}
                        title={
                          danmakuSettings.enabled
                            ? 'Tắt bình luận bay (Phím D)'
                            : 'Bật bình luận bay (Phím D)'
                        }
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    )}

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
                        className="cinema-volume-slider w-16 sm:w-20 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-lime-400 hover:accent-lime-300 transition-all"
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
                        <>
                          {/* Mobile backdrop */}
                          <div
                            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 sm:hidden"
                            onClick={() => setShowSettingsMenu(false)}
                          />
                          <div
                            style={{
                              maxHeight: typeof window !== 'undefined' && window.innerWidth < 640 ? '82vh' : undefined,
                            }}
                            className="fixed inset-x-0 bottom-0 z-50 max-h-[82vh] rounded-t-3xl border-t border-lime-500/30 bg-[#0a180b]/98 backdrop-blur-2xl p-2 sm:p-0 sm:absolute sm:inset-auto sm:bottom-full sm:right-0 sm:mb-2 sm:w-max sm:min-w-[240px] sm:max-w-xs sm:rounded-2xl sm:border sm:border-white/15 overflow-y-auto shadow-[0_15px_45px_rgba(0,0,0,0.85)] animate-in slide-in-from-bottom duration-200"
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

                          {/* Pro Tools: Aspect Ratio Fit Mode Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <Film className="w-3 h-3" />
                              Khung hình (Aspect)
                            </div>
                            <div className="flex flex-col gap-0.5">
                              {FIT_MODES.map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => handleFitModeSelect(opt.value)}
                                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                    fitMode === opt.value
                                      ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                      : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  <span>{opt.label}</span>
                                  {fitMode === opt.value && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                </button>
                              ))}
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

                          {/* Skip Intro Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <FastForward className="w-3 h-3" />
                              Bỏ qua mở đầu
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setAutoSkipIntro((prev) => {
                                    const next = !prev;
                                    setPrefs((p) => ({ ...p, autoSkipIntro: next }));
                                    triggerFeedback(
                                      next ? 'Tự động bỏ qua mở đầu: Bật' : 'Tự động bỏ qua mở đầu: Tắt',
                                      'volume'
                                    );
                                    return next;
                                  });
                                }}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                  autoSkipIntro
                                    ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                    : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                }`}
                              >
                                <span className="flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5" />
                                  Tự động bỏ qua mở đầu
                                </span>
                                {autoSkipIntro && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </button>
                              <div className="px-2.5 pt-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885]">
                                <Clock className="w-3 h-3" />
                                Thời lượng bỏ qua
                              </div>
                              <div className="flex gap-1 px-2.5 pb-1">
                                {INTRO_DURATION_OPTIONS.map((d) => (
                                  <button
                                    key={d}
                                    type="button"
                                    onClick={() => {
                                      setIntroDuration(d);
                                      setPrefs((p) => ({ ...p, introDuration: d }));
                                      triggerFeedback(`Bỏ qua mở đầu: +${d}s`, 'volume');
                                    }}
                                    className={`flex-1 px-1 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                                      introDuration === d
                                        ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                        : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    {d}s
                                  </button>
                                ))}
                              </div>
                              <p className="px-2.5 py-1 text-[10px] text-[#8aa885]">
                                Cài đặt được lưu tự động cho lần xem sau.
                              </p>
                            </div>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Danmaku Settings Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <MessageSquare className="w-3 h-3" />
                              Bình luận bay (Danmaku)
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={handleDanmakuToggle}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                  danmakuSettings.enabled
                                    ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                    : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                }`}
                                title="Bật / tắt bình luận bay (Phím D)"
                              >
                                <span className="flex items-center gap-1.5">
                                  <MessageSquare className="w-3.5 h-3.5" />
                                  {danmakuSettings.enabled
                                    ? 'Đang bật bình luận bay'
                                    : 'Đã tắt bình luận bay'}
                                </span>
                                {danmakuSettings.enabled && (
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                )}
                              </button>
                              <div className="mt-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#8aa885]">
                                <span>Độ mờ (Opacity)</span>
                                <span className="text-lime-300 font-mono text-[11px] normal-case">
                                  {Math.round(danmakuSettings.opacity * 100)}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0.3"
                                max="1"
                                step="0.05"
                                value={danmakuSettings.opacity}
                                onChange={(e) =>
                                  updateDanmakuSetting({ opacity: parseFloat(e.target.value) })
                                }
                                className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-lime-400"
                                title="Độ mờ của bình luận bay (30% - 100%)"
                              />
                              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885]">
                                <Type className="w-3 h-3" />
                                Cỡ chữ
                              </div>
                              <div className="flex gap-1">
                                {(
                                  [
                                    { value: 12 as DanmakuFontSize, label: 'Nhỏ 12px' },
                                    { value: 14 as DanmakuFontSize, label: 'Vừa 14px' },
                                    { value: 18 as DanmakuFontSize, label: 'Lớn 18px' },
                                  ]
                                ).map((sz) => (
                                  <button
                                    key={sz.value}
                                    type="button"
                                    onClick={() => updateDanmakuSetting({ fontSize: sz.value })}
                                    className={`flex-1 px-1 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                                      danmakuSettings.fontSize === sz.value
                                        ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                        : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    {sz.label}
                                  </button>
                                ))}
                              </div>
                              <p className="px-2.5 py-1 text-[10px] text-[#8aa885]">
                                Cài đặt lưu tự động. Bấm phím D để bật / tắt nhanh, thả
                                ❤️🔥😂👏 trực tiếp trên trình phát.
                              </p>
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

                          {/* Sleep Timer Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <Timer className="w-3 h-3" />
                              Hẹn giờ tắt
                            </div>
                            <div className="flex flex-col gap-0.5">
                              {(
                                [
                                  { value: 'off' as const, label: 'Tắt' },
                                  { value: 15, label: '15 phút' },
                                  { value: 30, label: '30 phút' },
                                  { value: 45, label: '45 phút' },
                                  { value: 60, label: '60 phút' },
                                  { value: 'end' as const, label: 'Hết tập hiện tại' },
                                ]
                              ).map((opt) => (
                                <button
                                  key={String(opt.value)}
                                  type="button"
                                  onClick={() => handleSleepTimerSelect(opt.value)}
                                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                    sleepTimerOption === opt.value
                                      ? 'bg-lime-500 text-black shadow-md font-extrabold'
                                      : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    {opt.label}
                                    {opt.value === 'end' &&
                                      sleepTimerOption === 'end' && (
                                        <AlarmClockOff className="w-3 h-3" />
                                      )}
                                  </span>
                                  {sleepTimerOption === opt.value && (
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  )}
                                </button>
                              ))}
                              {sleepEndsAt !== null && sleepRemaining > 0 && (
                                <p className="px-2.5 py-1 text-[10px] font-bold text-amber-300">
                                  Còn lại: {formatSleepRemaining(sleepRemaining)}
                                </p>
                              )}
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

                          <div className="mx-3 border-t border-white/10" />

                          {/* A-B Loop Repeat Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <Repeat className="w-3 h-3" />
                              Vòng lặp A-B
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={handleSetLoopA}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                  abLoop.a !== null
                                    ? 'bg-cyan-500 text-black shadow-md font-extrabold'
                                    : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                }`}
                                title="Đặt điểm A tại vị trí phát hiện tại"
                              >
                                <span>
                                  Đặt điểm A{abLoop.a !== null ? `: ${formatTime(abLoop.a)}` : ''}
                                </span>
                                {abLoop.a !== null && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </button>
                              <button
                                type="button"
                                onClick={handleSetLoopB}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                  abLoop.b !== null
                                    ? 'bg-cyan-500 text-black shadow-md font-extrabold'
                                    : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                }`}
                                title="Đặt điểm B & tự động phát lặp A↔B"
                              >
                                <span>
                                  Đặt điểm B{abLoop.b !== null ? `: ${formatTime(abLoop.b)}` : ''}
                                </span>
                                {abLoop.b !== null && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </button>
                              {abLoop.active && (
                                <button
                                  type="button"
                                  onClick={handleClearLoop}
                                  className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-left bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors cursor-pointer"
                                >
                                  Tắt vòng lặp A-B
                                </button>
                              )}
                              <p className="px-2.5 py-1 text-[10px] text-[#8aa885]">
                                Khi bật, video tự lặp lại giữa hai mốc thời gian A và B.
                              </p>
                            </div>
                          </div>

                          <div className="mx-3 border-t border-white/10" />

                          {/* Scene Bookmarks Section */}
                          <div className="px-3 pt-2 pb-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8aa885] mb-1.5">
                              <Bookmark className="w-3 h-3" />
                              Đánh dấu cảnh
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={handleAddBookmark}
                                className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center gap-2 text-[#cbe1c8] hover:bg-white/10 hover:text-white"
                              >
                                <Bookmark className="w-3.5 h-3.5 text-fuchsia-300" />
                                <span>Đánh dấu khoảnh khắc hiện tại (Phím B)</span>
                              </button>
                              {bookmarks.length === 0 ? (
                                <p className="px-2.5 py-1 text-[10px] text-[#8aa885]">
                                  Chưa có mốc nào. Bookmark được lưu theo từng phim & tập.
                                </p>
                              ) : (
                                bookmarks.map((b) => (
                                  <div
                                    key={b.t}
                                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleJumpToBookmark(b.t)}
                                      className="flex items-center gap-1.5 text-xs font-bold text-[#cbe1c8] hover:text-fuchsia-300 cursor-pointer min-w-0"
                                      title={`Nhảy đến ${formatTime(b.t)}`}
                                    >
                                      <Clock className="w-3 h-3 text-fuchsia-300 flex-shrink-0" />
                                      <span className="truncate">
                                        {b.label || 'Bookmark'} · {formatTime(b.t)}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveBookmark(b.t)}
                                      className="text-[10px] font-bold text-red-400 hover:text-red-300 cursor-pointer flex-shrink-0"
                                      title="Xóa mốc đánh dấu này"
                                    >
                                      Xóa
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                        </>
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
