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
  Sparkles,
  Link2,
  Activity,
  Palette,
  Contrast,
  Waves,
  AudioLines,
  Moon,
  Headphones,
  Server,
} from 'lucide-react';
import {
  saveHistory,
  getImageUrl,
  sanitizeEmbedUrl,
  savePlaybackPosition,
  getPlaybackPosition,
  clearPlaybackPosition,
  formatTime,
} from '../utils';
import { normalizeStreamUrl } from '../api';
import { createFilm4kFragmentLoader } from '../utils/hlsLoader';
import { getQualityDisplayInfo, sortQualitiesDescending } from '../utils/quality';

type EqPreset = 'flat' | 'bass-boost' | 'vocal-clarity' | 'virtual-surround';
type ColorPreset = 'normal' | 'cinema' | 'vivid' | 'warm' | 'night';
type SettingsTab = 'quality' | 'sub_audio' | 'speed' | 'fx';

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
  { value: '#bef264', label: 'Bơ non' },
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
    const savedLegacyBrightness = localStorage.getItem('bofilm_player_brightness');
    const fallbackBrightness = savedLegacyBrightness
      ? clampFilterValue(Number(savedLegacyBrightness) || 1)
      : 1;
    if (!raw) {
      return {
        ...defaults,
        colorFilter: { ...DEFAULT_FILTER, brightness: fallbackBrightness },
      };
    }
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs>;
    return {
      eqPreset:
        parsed.eqPreset && parsed.eqPreset in EQ_PRESETS ? parsed.eqPreset : defaults.eqPreset,
      subtitleDelay:
        typeof parsed.subtitleDelay === 'number' &&
        parsed.subtitleDelay >= -5 &&
        parsed.subtitleDelay <= 5
          ? parsed.subtitleDelay
          : defaults.subtitleDelay,
      subtitleSize:
        parsed.subtitleSize === 'sm' ||
        parsed.subtitleSize === 'md' ||
        parsed.subtitleSize === 'lg'
          ? parsed.subtitleSize
          : defaults.subtitleSize,
      subtitleColor: SUBTITLE_COLORS.some((c) => c.value === parsed.subtitleColor)
        ? (parsed.subtitleColor as string)
        : defaults.subtitleColor,
      colorFilter:
        parsed.colorFilter && typeof parsed.colorFilter === 'object'
          ? {
              brightness: clampFilterValue(
                Number(parsed.colorFilter.brightness) || fallbackBrightness
              ),
              contrast: clampFilterValue(Number(parsed.colorFilter.contrast) || 1),
              saturation: clampFilterValue(Number(parsed.colorFilter.saturation) || 1),
            }
          : { ...defaults.colorFilter, brightness: fallbackBrightness },
      showHealthGauge:
        typeof parsed.showHealthGauge === 'boolean' ? parsed.showHealthGauge : false,
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
    (_match, a: string, b: string) =>
      `${clampFmt(parseTs(a) + offset)} --> ${clampFmt(parseTs(b) + offset)}`
  );
};

export interface AudioTrackOption {
  id: number;
  name: string;
  lang?: string;
  channels?: string | number;
  codec?: string;
  isSupported?: boolean;
}

export interface HlsSubtitleTrackOption {
  id: number;
  name: string;
  lang?: string;
  default?: boolean;
}

export interface HlsLevelInfo {
  id: number;
  height: number;
  width?: number;
  bitrate?: number;
}

export interface PlayerServerOption {
  index: number;
  name: string;
}

interface RawMediaTrack {
  id?: number;
  name?: string;
  lang?: string;
  default?: boolean;
  channels?: string | number;
  codec?: string;
  attrs?: {
    CHANNELS?: string;
    CODECS?: string;
  };
}

const isVietnameseAudio = (name: string, lang?: string) => {
  const n = (name || '').toLowerCase();
  const l = (lang || '').toLowerCase();
  return (
    l.includes('vi') ||
    n.includes('vi') ||
    n.includes('viet') ||
    n.includes('thuyết minh') ||
    n.includes('lồng tiếng') ||
    n.includes('thuyet minh') ||
    n.includes('long tieng')
  );
};

export const isAudioTrackBrowserSupported = (
  _trackName: string,
  channels?: string | number,
  codec?: string
): boolean => {
  if (typeof window === 'undefined' || !window.MediaSource) {
    return true;
  }

  const codecLower = (codec || '').toLowerCase();
  const channelsStr = String(channels || '').trim();

  if (
    channelsStr === '1' ||
    channelsStr === '2' ||
    codecLower.startsWith('mp4a') ||
    codecLower.includes('mp4a.40.2') ||
    codecLower.includes('mp4a.40.5')
  ) {
    return true;
  }

  const isAc3Codec =
    codecLower.includes('ac-3') ||
    codecLower.includes('ec-3') ||
    codecLower.includes('ac3') ||
    codecLower.includes('eac3');

  if (isAc3Codec) {
    try {
      const canAc3 =
        MediaSource.isTypeSupported('audio/mp4; codecs="ac-3"') ||
        MediaSource.isTypeSupported('audio/mp4; codecs="ec-3"');
      if (!canAc3) return false;
    } catch {
      return false;
    }
  }

  if (channelsStr === '8') {
    try {
      if (!MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"')) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
};

export const selectBestAudioTrack = (
  rawTracks: RawMediaTrack[],
  savedAudioPref?: string | null
): number => {
  if (!rawTracks || rawTracks.length === 0) return 0;

  const scored = rawTracks.map((tr, index) => {
    const id = typeof tr.id === 'number' ? tr.id : index;
    const name = tr.name || tr.lang || `Audio ${index + 1}`;
    const lang = tr.lang || '';
    const channels = tr.attrs?.CHANNELS || tr.channels;
    const codec = tr.codec || tr.attrs?.CODECS;
    const isSupported = isAudioTrackBrowserSupported(name, channels, codec);
    const isVi = isVietnameseAudio(name, lang);
    const isStereo =
      String(channels) === '2' ||
      name.toLowerCase().includes('stereo') ||
      name.toLowerCase().includes('2ch') ||
      (!name.toLowerCase().includes('8ch') &&
        !name.toLowerCase().includes('6ch') &&
        !name.toLowerCase().includes('5.1') &&
        !name.toLowerCase().includes('7.1'));

    let score = 0;
    if (isSupported) {
      score += 1000;
    } else {
      score -= 5000;
    }

    if (savedAudioPref && isSupported) {
      if (name === savedAudioPref || String(id) === savedAudioPref) {
        score += 500;
      }
    }

    if (isVi) {
      score += 200;
      if (isStereo) score += 100;
    } else if (isStereo) {
      score += 50;
    }

    return { id, score, isSupported, name };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id ?? 0;
};

const isVietnameseSubtitle = (name: string, lang?: string) => {
  const n = (name || '').toLowerCase();
  const l = (lang || '').toLowerCase();
  return (
    l.includes('vi') ||
    n.includes('vi') ||
    n.includes('viet') ||
    n.includes('tiếng việt') ||
    n.includes('tieng viet')
  );
};

function parseEpisodeNum(slug?: string, name?: string): number {
  if (slug) {
    const seasonEpMatch = slug.match(/^s\d+[-_\s]*(?:e|tap|ep)[-_\s]*(\d+)/i);
    if (seasonEpMatch) {
      const parsed = parseInt(seasonEpMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const tapMatch = slug.match(/(?:tap|ep|e)[-_]?(\d+)/i);
    if (tapMatch) {
      const parsed = parseInt(tapMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const match = slug.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  if (name) {
    const seasonEpMatch = name.match(/s\d+[-_\s]*(?:e|tap|tập|ep)[-_\s]*(\d+)/i);
    if (seasonEpMatch) {
      const parsed = parseInt(seasonEpMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const tapMatch = name.match(/(?:tập|tap|ep|episode)\s*(\d+)/i);
    if (tapMatch) {
      const parsed = parseInt(tapMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const match = name.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 1;
}

function findQualityLevelByHeight(
  levels: { height?: number; bitrate?: number }[],
  targetHeight: number
): number {
  if (!levels.length || !Number.isFinite(targetHeight) || targetHeight < 144) {
    return -1;
  }
  const exactIdx = levels.findIndex((l) => l.height === targetHeight);
  if (exactIdx !== -1) return exactIdx;

  let bestIdx = -1;
  let smallestDiff = Infinity;
  levels.forEach((lvl, idx) => {
    const h = lvl.height || 0;
    if (h > 0) {
      const diff = Math.abs(h - targetHeight);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        bestIdx = idx;
      }
    }
  });
  return bestIdx;
}

function findLowestBitrateLevelIndex(
  levels: { height?: number; bitrate?: number }[]
): number {
  if (!levels || levels.length === 0) return 0;
  let minIdx = 0;
  let minScore = levels[0]?.bitrate || levels[0]?.height || Infinity;
  for (let i = 1; i < levels.length; i++) {
    const score = levels[i]?.bitrate || levels[i]?.height || Infinity;
    if (score < minScore) {
      minScore = score;
      minIdx = i;
    }
  }
  return minIdx;
}

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

interface VideoPlayerProps {
  embedUrl: string;
  m3u8Url?: string;
  serverIndex?: number;
  servers?: PlayerServerOption[];
  onSelectServer?: (index: number) => void;
  onStreamFatalError?: () => boolean;
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
  servers,
  onSelectServer,
  onStreamFatalError,
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
  const validatedEmbedUrl = sanitizeEmbedUrl(embedUrl);

  const [isTheaterInternal, setIsTheaterInternal] = useState(false);
  const isTheater = isTheaterProp !== undefined ? isTheaterProp : isTheaterInternal;
  const toggleTheater = useCallback(() => {
    if (onToggleTheater) {
      onToggleTheater();
    } else {
      setIsTheaterInternal((prev) => !prev);
    }
  }, [onToggleTheater]);

  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const shortcutsDialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (!showShortcutsModal) return;
    const dialog = shortcutsDialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [showShortcutsModal]);

  const [isDimmed, setIsDimmed] = useState(false);
  const [key, setKey] = useState(0);
  const [internalPlayerMode, setInternalPlayerMode] = useState<'hls' | 'embed'>(
    playerModeProp || (m3u8Url || movieSlug ? 'hls' : 'embed')
  );
  const playerMode = playerModeProp !== undefined ? playerModeProp : internalPlayerMode;

  const isManualModeRef = useRef<boolean>(playerModeProp === 'embed');
  const hlsFallbackErrorRef = useRef<boolean>(false);

  const setPlayerMode = useCallback(
    (mode: 'hls' | 'embed') => {
      setInternalPlayerMode(mode);
      onPlayerModeChange?.(mode);
    },
    [onPlayerModeChange]
  );

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
  const [FragmentLoader] = useState(() => createFilm4kFragmentLoader(null));
  const [isInitializingHls, setIsInitializingHls] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);

  // ===== Timestamp URL Deep Linking (?t=seconds) — consumed ONCE per route (`MED-10`) =====
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
  const deepLinkConsumedRef = useRef<boolean>(false);

  useEffect(() => {
    deepLinkConsumedRef.current = false;
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
  const scrubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('quality');
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(0);
  const [hlsSubtitleTracks, setHlsSubtitleTracks] = useState<HlsSubtitleTrackOption[]>([]);
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number>(-1);
  const [autoNextEnabled, setAutoNextEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('bofilm_player_autonext');
    return saved !== null ? saved === 'true' : true;
  });
  const [menuMaxHeight, setMenuMaxHeight] = useState<number | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);

  // Player preferences initialized BEFORE dependent states (`HIGH-10` / `FE-PLY-03`)
  const [prefs, setPrefs] = useState<PlayerPrefs>(() => loadPlayerPrefs());
  const [brightness, setBrightness] = useState<number>(() => prefs.colorFilter.brightness);
  const [contrast, setContrast] = useState<number>(() => prefs.colorFilter.contrast);
  const [saturation, setSaturation] = useState<number>(() => prefs.colorFilter.saturation);
  const [showHealthGauge, setShowHealthGauge] = useState<boolean>(
    () => prefs.showHealthGauge
  );

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

  const [showStats, setShowStats] = useState(false);

  // ===== Custom Subtitles (.srt / .vtt) with clean Blob URL lifecycle (`HIGH-10` / `FE-PLY-05`) =====
  interface ParsedSubtitle {
    name: string;
    url: string;
    size: 'sm' | 'md' | 'lg';
    color: string;
    enabled: boolean;
  }
  const [subtitle, setSubtitle] = useState<ParsedSubtitle | null>(null);
  const subtitleUrlRef = useRef<string | null>(null);
  subtitleUrlRef.current = subtitle?.url ?? null;
  const subtitleFileRef = useRef<HTMLInputElement | null>(null);
  const baseVttRef = useRef<string | null>(null);
  const prevRouteSubKeyRef = useRef<string>(`${movieSlug}:${episodeSlug}`);

  // ===== Audio Equalizer Preset =====
  const [eqPreset, setEqPreset] = useState<EqPreset>(() => prefs.eqPreset);
  const eqPresetRef = useRef<EqPreset>(eqPreset);
  eqPresetRef.current = eqPreset;
  const eqNodesRef = useRef<BiquadFilterNode[] | null>(null);

  // ===== Subtitle Sync Delay (-5s .. +5s) =====
  const [subtitleDelay, setSubtitleDelay] = useState<number>(() => prefs.subtitleDelay);
  const prevSubtitleDelayRef = useRef<number>(subtitleDelay);

  // ===== Stream Health & Buffer Gauge =====
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

  // Persist combined player preferences (`bofilm_player_prefs`)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      const prev = raw ? (JSON.parse(raw) as Partial<PlayerPrefs>) : {};
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          eqPreset,
          subtitleDelay,
          subtitleSize: subtitle?.size ?? prev.subtitleSize ?? prefs.subtitleSize ?? 'md',
          subtitleColor:
            subtitle?.color ?? prev.subtitleColor ?? prefs.subtitleColor ?? '#ffffff',
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
     prefs.subtitleSize,
    prefs.subtitleColor,
    brightness,
    contrast,
    saturation,
    showHealthGauge,
  ]);

  const [resumePrompt, setResumePrompt] = useState<{
    time: number;
    duration: number;
  } | null>(null);
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);
  const [isPip, setIsPip] = useState(false);
  const [isPipSupported, setIsPipSupported] = useState(false);

  const [volumeBoost, setVolumeBoost] = useState<number>(() => {
    if (typeof window === 'undefined') return 100;
    const saved = localStorage.getItem('bofilm_player_boost');
    const parsed = saved !== null ? parseInt(saved, 10) : 100;
    return [100, 125, 150, 200].includes(parsed) ? parsed : 100;
  });
  const [boostUnsupported, setBoostUnsupported] = useState(false);

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
      node.threshold.value = -50;
      node.knee.value = 30;
      node.ratio.value = 12;
      node.attack.value = 0.003;
      node.release.value = 0.25;
    } else {
      node.threshold.value = 0;
      node.knee.value = 0;
      node.ratio.value = 1;
      node.attack.value = 0.003;
      node.release.value = 0.25;
    }
  };

  useEffect(() => {
    localStorage.setItem('bofilm_player_night_audio', nightAudio ? 'on' : 'off');
    const node = compressorRef.current;
    if (node) applyCompressorSettings(node, nightAudio);
  }, [nightAudio]);

  const [pitchPreserve, setPitchPreserve] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('bofilm_player_pitch_preserve') !== 'off';
  });

  // ===== Audio-Only Data Saver Mode (`HIGH-10` / `FE-PLY-04`) =====
  const [audioSaver, setAudioSaver] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('bofilm_player_audio_saver') === 'on';
  });
  const audioSaverRef = useRef<boolean>(audioSaver);
  audioSaverRef.current = audioSaver;
  const preAudioSaverLevelRef = useRef<number | null>(null);

  const [showEpisodeDrawer, setShowEpisodeDrawer] = useState(false);

  const [isBoosted, setIsBoosted] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActiveRef = useRef<boolean>(false);
  const savedRateRef = useRef<number>(1);

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
  const retryCountRef = useRef<number>(0);
  const mediaRecoveryCountRef = useRef<number>(0);
  const nativeErrorCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPosRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const boundVideoRef = useRef<HTMLVideoElement | null>(null);

  const onStreamFatalErrorRef = useRef(onStreamFatalError);
  onStreamFatalErrorRef.current = onStreamFatalError;

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

  const triggerFeedback = useCallback(
    (
      text: string,
      icon?: 'play' | 'pause' | 'seek-forward' | 'seek-backward' | 'volume'
    ) => {
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

  // Clean up HLS instance, blob subtitle URLs, and timers on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      if (touchHudTimerRef.current) clearTimeout(touchHudTimerRef.current);
      if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current);
      if (subtitleUrlRef.current) {
        URL.revokeObjectURL(subtitleUrlRef.current);
        subtitleUrlRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      FragmentLoader.reset();
    };
  }, [FragmentLoader]);

  // Revoke & clear custom uploaded subtitle when switching episode or movie (`FE-PLY-05`)
  useEffect(() => {
    const nextRouteKey = `${movieSlug}:${episodeSlug}`;
    if (prevRouteSubKeyRef.current !== nextRouteKey) {
      prevRouteSubKeyRef.current = nextRouteKey;
      baseVttRef.current = null;
      setSubtitle((prev) => {
        if (prev?.url) {
          URL.revokeObjectURL(prev.url);
        }
        return null;
      });
    }
  }, [movieSlug, episodeSlug]);

  useEffect(() => {
    if (!showSettingsMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(e.target as Node)
      ) {
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

  useEffect(() => {
    if (!showSettingsMenu || !containerRef.current) return;
    const el = containerRef.current;
    const updateMaxHeight = () => {
      if (typeof window !== 'undefined' && window.innerWidth < 640 && !isFullscreen) {
        setMenuMaxHeight(Math.max(220, Math.floor(window.innerHeight * 0.62)));
        return;
      }
      const containerH = el.clientHeight;
      const available = containerH - 72;
      setMenuMaxHeight(Math.max(120, Math.floor(available)));
    };
    updateMaxHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateMaxHeight);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateMaxHeight);
    return () => window.removeEventListener('resize', updateMaxHeight);
  }, [showSettingsMenu, isFullscreen]);

  useEffect(() => {
    hlsFallbackErrorRef.current = false;
    FragmentLoader.reset();
    if (playerModeProp === 'embed') {
      isManualModeRef.current = true;
      return;
    }
    isManualModeRef.current = false;
    if (playerModeProp === undefined && (m3u8Url || movieSlug)) {
      setPlayerMode('hls');
    }
  }, [m3u8Url, serverIndex, movieSlug, episodeName, playerModeProp, FragmentLoader, setPlayerMode]);

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

  useEffect(() => {
    setAutoNextCountdown(null);
    if (!movieSlug) return;

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

  useEffect(() => {
    if (autoNextCountdown === null) return;
    if (autoNextCountdown <= 0) {
      setAutoNextCountdown(null);
      onNextEpisode?.();
      return;
    }

    const timer = setTimeout(() => {
      setAutoNextCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [autoNextCountdown, onNextEpisode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  type WebkitPipVideo = HTMLVideoElement & {
    webkitSupportsPresentationMode?: boolean;
    webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline') => void;
    webkitPresentationMode?: string;
  };

  const checkPipSupport = useCallback(() => {
    const video = videoRef.current as WebkitPipVideo | null;
    const supported =
      typeof document !== 'undefined' &&
      (Boolean(document.pictureInPictureEnabled) ||
        Boolean(video?.webkitSupportsPresentationMode) ||
        typeof video?.webkitSetPresentationMode === 'function');
    setIsPipSupported(supported);
  }, []);

  useEffect(() => {
    checkPipSupport();
    const video = videoRef.current as WebkitPipVideo | null;
    if (!video) return;

    const handleEnterPip = () => setIsPip(true);
    const handleLeavePip = () => setIsPip(false);
    const handleWebkitMode = () => {
      if (video.webkitPresentationMode) {
        setIsPip(video.webkitPresentationMode === 'picture-in-picture');
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
  }, [playerMode, key, checkPipSupport]);

  const togglePip = useCallback(async () => {
    try {
      const video = videoRef.current as WebkitPipVideo | null;
      if (!video) return;

      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        triggerFeedback('Thoát PiP', 'volume');
      } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
        triggerFeedback('Bật PiP', 'volume');
      } else if (
        video.webkitSupportsPresentationMode &&
        typeof video.webkitSetPresentationMode === 'function'
      ) {
        const currentMode = video.webkitPresentationMode;
        const targetMode =
          currentMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
        video.webkitSetPresentationMode(targetMode);
        triggerFeedback(
          targetMode === 'picture-in-picture' ? 'Bật PiP' : 'Thoát PiP',
          'volume'
        );
      }
    } catch (err) {
      console.warn('PiP error:', err);
    }
  }, [triggerFeedback]);

  // ===== Web Audio Graph — Rebinds cleanly when `<video key>` remounts on Reload (`HIGH-10` / `FE-PLY-02`) =====
  const ensureAudioGraph = useCallback((): boolean => {
    if (boostUnsupported) return false;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) {
        setBoostUnsupported(true);
        return false;
      }
      const video = videoRef.current;
      if (!video) return false;

      if (!audioCtxRef.current) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const gain = ctx.createGain();
        const specs: [BiquadFilterType, number][] = [
          ['lowshelf', 80],
          ['peaking', 1000],
          ['highshelf', 6000],
        ];
        const filters = specs.map(([type, freq]) => {
          const node = ctx.createBiquadFilter();
          node.type = type;
          node.frequency.value = freq;
          node.Q.value = 1;
          return node;
        });
        for (let i = 0; i < filters.length - 1; i++) {
          filters[i].connect(filters[i + 1]);
        }
        const compressor = ctx.createDynamicsCompressor();
        filters[filters.length - 1].connect(compressor);
        compressor.connect(gain);
        gain.connect(ctx.destination);

        compressorRef.current = compressor;
        applyCompressorSettings(compressor, nightAudioRef.current);
        gainNodeRef.current = gain;
        eqNodesRef.current = filters;

        const gains = EQ_PRESETS[eqPresetRef.current].gains;
        filters.forEach((node, i) => {
          node.gain.value = gains[i] ?? 0;
        });
      }

      // Rebind MediaElementAudioSourceNode whenever the <video> DOM element instance changes!
      if (boundVideoRef.current !== video && eqNodesRef.current?.[0]) {
        try {
          mediaSourceRef.current?.disconnect();
        } catch {
          // ignore old node disconnect
        }
        const newSource = audioCtxRef.current.createMediaElementSource(video);
        newSource.connect(eqNodesRef.current[0]);
        mediaSourceRef.current = newSource;
        boundVideoRef.current = video;
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

  useEffect(() => {
    const gain = gainNodeRef.current;
    if (gain) {
      gain.gain.value = volumeBoost / 100;
    }
    localStorage.setItem('bofilm_player_boost', String(volumeBoost));
  }, [volumeBoost]);

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

  // Persist & enforce Audio-Only Data Saver lowest bitrate cap (`HIGH-10` / `FE-PLY-04`)
  useEffect(() => {
    localStorage.setItem('bofilm_player_audio_saver', audioSaver ? 'on' : 'off');
    const hls = hlsRef.current;
    if (!hls || !hls.levels || hls.levels.length === 0) return;

    if (audioSaver) {
      if (preAudioSaverLevelRef.current === null) {
        preAudioSaverLevelRef.current = currentLevel;
      }
      const lowestIdx = findLowestBitrateLevelIndex(hls.levels);
      hls.autoLevelCapping = lowestIdx;
      hls.nextLevel = lowestIdx;
    } else if (preAudioSaverLevelRef.current !== null) {
      const savedHeight = parseInt(
        localStorage.getItem('bofilm_player_quality') || '',
        10
      );
      const restored =
        preAudioSaverLevelRef.current >= 0
          ? preAudioSaverLevelRef.current
          : findQualityLevelByHeight(hls.levels, savedHeight);
      preAudioSaverLevelRef.current = null;
      hls.autoLevelCapping = -1;
      hls.nextLevel = restored;
      setCurrentLevel(restored);
    }
  }, [audioSaver, currentLevel]);

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

  const handleEqPresetSelect = useCallback(
    (preset: EqPreset) => {
      if (preset !== 'flat' && !ensureAudioGraph()) {
        triggerFeedback('Trình duyệt không hỗ trợ bộ chỉnh âm', 'volume');
        return;
      }
      const gains = EQ_PRESETS[preset].gains;
      eqNodesRef.current?.forEach((node, i) => {
        node.gain.value = gains[i] ?? 0;
      });
      setEqPreset(preset);
      triggerFeedback(`Chỉnh âm: ${EQ_PRESETS[preset].label}`, 'volume');
    },
    [ensureAudioGraph, triggerFeedback]
  );

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
      boundVideoRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isPlaying && audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  }, [isPlaying]);

  // ===== Quick Share =====
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
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      await copyShareLink(false);
    }
  }, [buildShareUrl, movieName, episodeName, copyShareLink]);

  useEffect(() => {
    if (!showShareMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        shareMenuRef.current &&
        !shareMenuRef.current.contains(e.target as Node)
      ) {
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

  const handleAmbientGlowToggle = useCallback(() => {
    setAmbientGlow((prev) => {
      const next = !prev;
      localStorage.setItem('bofilm_player_ambient_glow', next ? 'on' : 'off');
      triggerFeedback(
        next ? 'Đã bật hào quang điện ảnh' : 'Đã tắt hào quang điện ảnh',
        'volume'
      );
      return next;
    });
  }, [triggerFeedback]);

  // ===== Custom Subtitle Parsing (.srt -> WebVTT) =====
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
          const blob = new Blob([shiftVtt(text, subtitleDelay)], {
            type: 'text/vtt',
          });
          setSubtitle((prev) => {
            if (prev?.url) URL.revokeObjectURL(prev.url);
            return {
              name: file.name,
              url: URL.createObjectURL(blob),
              size: prev?.size || prefs.subtitleSize || 'md',
              color: prev?.color || prefs.subtitleColor || '#ffffff',
              enabled: true,
            };
          });
          triggerFeedback(`Đã tải phụ đề: ${file.name}`, 'volume');
        } catch {
          triggerFeedback('Không thể đọc tệp phụ đề', 'volume');
        }
      };
      reader.onerror = () => triggerFeedback('Không thể đọc tệp phụ đề', 'volume');
      reader.readAsText(file);
    },
    [parseSrtToVtt, triggerFeedback, subtitleDelay, prefs.subtitleSize, prefs.subtitleColor]
  );

  const handleSubtitleRemove = useCallback(() => {
    baseVttRef.current = null;
    setSubtitle((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    triggerFeedback('Đã gỡ phụ đề tùy chỉnh', 'volume');
  }, [triggerFeedback]);

  const handleSubtitleSizeSelect = useCallback(
    (size: 'sm' | 'md' | 'lg') => {
      setPrefs((prev) => ({ ...prev, subtitleSize: size }));
      setSubtitle((prev) => (prev ? { ...prev, size } : prev));
      triggerFeedback('Đã cập nhật cỡ chữ phụ đề', 'volume');
    },
    [triggerFeedback]
  );

  const handleSubtitleColorSelect = useCallback(
    (color: string) => {
      setPrefs((prev) => ({ ...prev, subtitleColor: color }));
      setSubtitle((prev) => (prev ? { ...prev, color } : prev));
      triggerFeedback('Đã cập nhật màu chữ phụ đề', 'volume');
    },
    [triggerFeedback]
  );

  const nudgeSubtitleDelay = useCallback(
    (delta: number) => {
      setSubtitleDelay((prev) => {
        const next = Math.max(-5, Math.min(5, Math.round((prev + delta) * 10) / 10));
        if (next !== prev) {
          triggerFeedback(
            `Lệch phụ đề: ${next > 0 ? '+' : ''}${next.toFixed(1)}s`,
            'volume'
          );
        }
        return next;
      });
    },
    [triggerFeedback]
  );

  // Rebuild subtitle blob ONLY when `subtitleDelay` actually changes (`FE-PLY-05`: no double allocation)
  useEffect(() => {
    if (prevSubtitleDelayRef.current === subtitleDelay) return;
    prevSubtitleDelayRef.current = subtitleDelay;
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
  }, [subtitleDelay]);

  useEffect(() => {
    if (!subtitle) return;
    const video = videoRef.current;
    if (!video) return;
    const timer = setTimeout(() => {
      const tracks = Array.from(video.textTracks || []);
      const track = tracks.find((t) => t.label === subtitle.name);
      if (track) {
        track.mode = subtitle.enabled ? 'showing' : 'disabled';
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [subtitle, subtitle?.enabled, playerMode, key]);

  // ===== Stats for Nerds =====
  type HlsInternalBandwidth = Hls & {
    bandwidthEstimate?: number;
    _fragLoadController?: { bandwidthEstimate?: number };
  };
  type WebkitPlaybackQualityVideo = HTMLVideoElement & {
    webkitDroppedFrameCount?: number;
    webkitDecodedFrameCount?: number;
  };

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
        const video = videoRef.current as WebkitPlaybackQualityVideo | null;
        if (!video) return null;
        const quality = video.getVideoPlaybackQuality
          ? video.getVideoPlaybackQuality()
          : video.webkitDroppedFrameCount !== undefined
          ? {
              totalVideoFrames: video.webkitDecodedFrameCount ?? 0,
              droppedVideoFrames: video.webkitDroppedFrameCount ?? 0,
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
        const hls = hlsRef.current as HlsInternalBandwidth | null;
        const hlsBandwidth =
          hls?.bandwidthEstimate ?? hls?._fragLoadController?.bandwidthEstimate;
        const container = containerRef.current;
        return {
          resolution:
            video.videoWidth > 0 ? `${video.videoWidth}×${video.videoHeight}` : '—',
          playerSize: container
            ? `${Math.round(container.clientWidth)}×${Math.round(
                container.clientHeight
              )}`
            : '—',
          framesDecoded: quality?.totalVideoFrames ?? 0,
          droppedFrames: quality?.droppedVideoFrames ?? 0,
          bufferedAhead: bufferedAhead.toFixed(1),
          networkActivity:
            typeof hlsBandwidth === 'number' && hlsBandwidth > 0
              ? `${(hlsBandwidth / 1000000).toFixed(1)}`
              : '—',
          currentLevel:
            hls && hls.currentLevel >= 0 && hls.levels?.[hls.currentLevel]
              ? `${heightLabel(hls.levels[hls.currentLevel].height)}${
                  hls.levels[hls.currentLevel].bitrate
                    ? ` @ ${(hls.levels[hls.currentLevel].bitrate / 1000000).toFixed(
                        1
                      )} Mbps`
                    : ''
                }`
              : 'Tự động',
          playbackRate: `${playbackSpeed}x`,
          droppedRatio:
            quality && quality.totalVideoFrames > 0
              ? `${(
                  (quality.droppedVideoFrames / quality.totalVideoFrames) *
                  100
                ).toFixed(1)}%`
              : '—',
          boost: `${volumeBoost}%`,
        };
      })()
    : null;

  const handleFilterPresetSelect = useCallback(
    (preset: ColorPreset) => {
      const values = FILTER_PRESETS[preset].values;
      setBrightness(values.brightness);
      setContrast(values.contrast);
      setSaturation(values.saturation);
      triggerFeedback(`Màu sắc: ${FILTER_PRESETS[preset].label}`, 'volume');
    },
    [triggerFeedback]
  );

  const handleFilterReset = useCallback(() => {
    setBrightness(1);
    setContrast(1);
    setSaturation(1);
    triggerFeedback('Đã đặt lại màu sắc');
  }, [triggerFeedback]);

  const activeColorPreset: ColorPreset | 'custom' = (() => {
    const current = { brightness, contrast, saturation };
    for (const k of Object.keys(FILTER_PRESETS) as ColorPreset[]) {
      if (filterEqualsPreset(current, FILTER_PRESETS[k].values)) return k;
    }
    return 'custom';
  })();

  // Sync buffered regions + immediate Stream Health gauge data (`WP-MED-05`)
  const syncBufferMetrics = useCallback(
    (video: HTMLVideoElement, forceGaugeSync = false) => {
      if (video.buffered.length > 0 && video.duration > 0) {
        for (let i = video.buffered.length - 1; i >= 0; i--) {
          if (video.buffered.start(i) <= video.currentTime + 0.25) {
            const ratio = Math.min(1, video.buffered.end(i) / video.duration);
            setBufferedRatio(ratio);
            if (showHealthGauge || forceGaugeSync) {
              const ahead = Math.max(0, video.buffered.end(i) - video.currentTime);
              const hls = hlsRef.current as HlsInternalBandwidth | null;
              const hlsBandwidth =
                hls?.bandwidthEstimate ?? hls?._fragLoadController?.bandwidthEstimate;
              setBufferHealth((prev) => {
                const bandwidthMb =
                  typeof hlsBandwidth === 'number' && hlsBandwidth > 0
                    ? Math.round((hlsBandwidth / 1000000) * 10) / 10
                    : prev.bandwidthMb;
                if (
                  !forceGaugeSync &&
                  Math.abs(ahead - prev.ahead) < 0.25 &&
                  bandwidthMb === prev.bandwidthMb
                ) {
                  return prev;
                }
                return { ahead, bandwidthMb };
              });
            }
            return;
          }
        }
      }
    },
    [showHealthGauge]
  );

  useEffect(() => {
    if (showHealthGauge && videoRef.current) {
      syncBufferMetrics(videoRef.current, true);
    }
  }, [showHealthGauge, currentTime, duration, syncBufferMetrics]);

  const bufferHealthStatus = (() => {
    if (bufferHealth.ahead === 0 && !isPlaying && currentTime === 0) {
      return {
        label: 'Sẵn sàng',
        color: 'text-lime-300',
        dot: 'bg-lime-400',
        bar: 'bg-lime-400',
      };
    }
    if (bufferHealth.ahead >= 25) {
      return {
        label: 'Rất tốt',
        color: 'text-emerald-400',
        dot: 'bg-emerald-400',
        bar: 'bg-emerald-400',
      };
    }
    if (bufferHealth.ahead >= 10) {
      return {
        label: 'Tốt',
        color: 'text-lime-400',
        dot: 'bg-lime-400',
        bar: 'bg-lime-400',
      };
    }
    if (bufferHealth.ahead >= 4) {
      return {
        label: 'Ổn định',
        color: 'text-yellow-400',
        dot: 'bg-yellow-400',
        bar: 'bg-yellow-400',
      };
    }
    if (bufferHealth.ahead >= 1.5) {
      return {
        label: 'Yếu',
        color: 'text-amber-400',
        dot: 'bg-amber-400',
        bar: 'bg-amber-400',
      };
    }
    return {
      label: 'Đang nạp',
      color: 'text-amber-300',
      dot: 'bg-amber-400',
      bar: 'bg-amber-400',
    };
  })();
  const bufferGaugePercent = Math.min(100, (bufferHealth.ahead / 60) * 100);

  const handleHealthGaugeToggle = useCallback(() => {
    setShowHealthGauge((prev) => {
      const next = !prev;
      triggerFeedback(
        next ? 'Đã bật thước đo bộ nhớ đệm' : 'Đã tắt thước đo bộ nhớ đệm',
        'volume'
      );
      return next;
    });
  }, [triggerFeedback]);

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
      triggerFeedback(
        `Tốc độ: ${clamped.toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}x`
      );
    },
    [triggerFeedback]
  );

  const handlePitchPreserveToggle = useCallback(() => {
    setPitchPreserve((prev) => {
      const next = !prev;
      triggerFeedback(
        next ? 'Đã giữ cao độ giọng nói' : 'Đã tắt giữ cao độ giọng',
        'volume'
      );
      return next;
    });
  }, [triggerFeedback]);

  const handleAudioSaverToggle = useCallback(() => {
    setAudioSaver((prev) => {
      const next = !prev;
      triggerFeedback(
        next
          ? 'Tiết kiệm dữ liệu: Chỉ nghe âm thanh'
          : 'Đã khôi phục hình ảnh video',
        'volume'
      );
      return next;
    });
  }, [triggerFeedback]);

  const getQualityLabel = useCallback((height?: number, width?: number) => {
    if (!height) return 'Tự động';
    return getQualityDisplayInfo(height, width).label;
  }, []);

  // Persist HLS quality by vertical resolution (`1080`, `720`) rather than raw array index (`MED-10`)
  const handleQualitySelect = useCallback(
    (levelIndex: number) => {
      setCurrentLevel(levelIndex);
      if (audioSaverRef.current) {
        setAudioSaver(false);
      }
      if (hlsRef.current && Hls.isSupported()) {
        hlsRef.current.autoLevelCapping = -1;
        hlsRef.current.currentLevel = levelIndex;
        if (levelIndex !== -1) {
          const level = hlsRef.current.levels[levelIndex];
          if (level) {
            const info = getQualityDisplayInfo(level.height, level.width);
            if (level.height) {
              localStorage.setItem('bofilm_player_quality', String(level.height));
            }
            triggerFeedback(`Chất lượng: ${info.label}`);
          }
        } else {
          localStorage.removeItem('bofilm_player_quality');
          triggerFeedback('Chất lượng: Tự động');
        }
      } else {
        localStorage.removeItem('bofilm_player_quality');
        triggerFeedback('Chất lượng: Tự động (Native HLS)', 'volume');
      }
      setShowSettingsMenu(false);
    },
    [triggerFeedback]
  );

  const handleAudioSelect = useCallback(
    (trackId: number) => {
      setCurrentAudioTrack(trackId);
      if (hlsRef.current) {
        hlsRef.current.audioTrack = trackId;
      }
      const track = audioTracks.find((t) => t.id === trackId);
      const trackName = track ? track.name : `Track ${trackId + 1}`;
      try {
        localStorage.setItem('bofilm_player_audio', trackName);
      } catch {
        // ignore
      }
      triggerFeedback(`Âm thanh: ${trackName}`);
    },
    [audioTracks, triggerFeedback]
  );

  // Subtitle track selection (`FE-PLY-05`: let `hls.subtitleTrack` manage HLS tracks; disable only custom `<track>`)
  const handleSubtitleSelect = useCallback(
    (trackId: number) => {
      setCurrentSubtitleTrack(trackId);
      if (hlsRef.current) {
        hlsRef.current.subtitleTrack = trackId;
      }
      if (videoRef.current && subtitle?.name) {
        const tracks = Array.from(videoRef.current.textTracks || []);
        const customTrack = tracks.find((t) => t.label === subtitle.name);
        if (customTrack) {
          customTrack.mode = 'disabled';
        }
      }
      if (subtitle?.enabled) {
        setSubtitle((prev) => (prev ? { ...prev, enabled: false } : null));
      }

      if (trackId === -1) {
        try {
          localStorage.setItem('bofilm_player_subtitle', 'off');
        } catch {
          // ignore
        }
        triggerFeedback('Đã tắt phụ đề', 'volume');
      } else {
        const track = hlsSubtitleTracks.find((s) => s.id === trackId);
        const trackName = track ? track.name : `Track ${trackId + 1}`;
        try {
          localStorage.setItem('bofilm_player_subtitle', trackName);
        } catch {
          // ignore
        }
        triggerFeedback(`Phụ đề: ${trackName}`);
      }
    },
    [hlsSubtitleTracks, subtitle?.enabled, subtitle?.name, triggerFeedback]
  );

  const handleToggleAutoNext = useCallback(() => {
    setAutoNextEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('bofilm_player_autonext', String(next));
      } catch {
        // ignore
      }
      triggerFeedback(next ? 'Tự động chuyển tập: Bật' : 'Tự động chuyển tập: Tắt');
      return next;
    });
  }, [triggerFeedback]);

  useEffect(() => {
    setHlsLevels([]);
    setActiveHeight(0);
    setAudioTracks([]);
    setCurrentAudioTrack(0);
    setHlsSubtitleTracks([]);
    setCurrentSubtitleTrack(-1);
    setCurrentLevel(-1);
  }, [movieSlug, episodeSlug, currentEpisodeSlug, serverIndex, m3u8Url]);

  // Global keyboard shortcuts (stable callbacks -> no 4Hz listener churn!)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showShortcutsModal) return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable ||
          activeEl.getAttribute('role') === 'slider')
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
          const prevIdx = SPEED_OPTIONS.slice()
            .reverse()
            .findIndex((s) => s < playbackSpeed);
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
            const prevIdx = SPEED_OPTIONS.slice()
              .reverse()
              .findIndex((s) => s < playbackSpeed);
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
  }, [
    playerMode,
    triggerFeedback,
    playbackSpeed,
    handleSpeedSelect,
    toggleFullscreen,
    toggleTheater,
    isTheater,
    togglePip,
    showShortcutsModal,
  ]);

  // On-demand resolver for uncached episode when in embed mode
  useEffect(() => {
    if (playerMode !== 'embed' || !movieSlug) return;
    if (hlsFallbackErrorRef.current) return;

    let isDisposed = false;
    const activeEpSlug = currentEpisodeSlug || episodeSlug;
    const epNum = parseEpisodeNum(activeEpSlug, episodeName);

    let checkStreamTimer: ReturnType<typeof setTimeout> | null = null;
    if (!isManualModeRef.current && playerModeProp !== 'embed') {
      checkStreamTimer = setTimeout(async () => {
        if (isDisposed || isManualModeRef.current || hlsFallbackErrorRef.current) return;
        try {
          const fallbackPath =
            epNum > 1
              ? `/api/stream/${encodeURIComponent(movieSlug)}/ep/${epNum}/master.m3u8`
              : `/api/stream/${encodeURIComponent(movieSlug)}/master.m3u8`;
          const serverParam =
            serverIndex !== undefined && serverIndex > 0 ? `?server=${serverIndex}` : '';
          const streamCheckUrl = m3u8Url || `${fallbackPath}${serverParam}`;
          const normalizedCheckUrl = normalizeStreamUrl(streamCheckUrl, movieSlug, {
            epNum,
            isSeries: epNum > 1,
            serverIndex,
          });
          const testRes = await fetch(normalizedCheckUrl, { method: 'HEAD' });
          if (
            testRes.ok &&
            !isDisposed &&
            !isManualModeRef.current &&
            !hlsFallbackErrorRef.current
          ) {
            setAutoIngested(true);
            setPlayerMode('hls');
          }
        } catch {
          // continue in embed mode
        }
      }, 3500);
    }

    return () => {
      isDisposed = true;
      if (checkStreamTimer) {
        clearTimeout(checkStreamTimer);
      }
    };
  }, [
    playerMode,
    movieSlug,
    episodeName,
    episodeSlug,
    currentEpisodeSlug,
    playerModeProp,
    m3u8Url,
    serverIndex,
    setPlayerMode,
  ]);

  // ===== HLS Stream Initialization =====
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
    const activeEpSlug = currentEpisodeSlug || episodeSlug;
    const epNum = parseEpisodeNum(activeEpSlug, episodeName);
    const currentEpKey = m3u8Url || `${movieSlug || ''}:${activeEpSlug || epNum}`;

    let streamUrl: string;
    if (m3u8Url) {
      streamUrl = normalizeStreamUrl(m3u8Url, movieSlug, {
        epNum,
        isSeries: epNum > 1,
        serverIndex,
      });
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
      const serverParam =
        serverIndex !== undefined && serverIndex > 0 ? `?server=${serverIndex}` : '';
      const basePath =
        epNum > 1
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
      streamUrl = `/?url=${encodeURIComponent(streamUrl)}`;
    }

    const isNewStream = lastStreamUrlRef.current !== streamUrl;
    if (isNewStream) {
      lastStreamUrlRef.current = streamUrl;
      retryCountRef.current = 0;
      mediaRecoveryCountRef.current = 0;
      nativeErrorCountRef.current = 0;
      setPlaybackError(false);
      setIsInitializingHls(false);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      video.pause();
    }

    if (lastEpKeyRef.current !== currentEpKey) {
      savedPositionRef.current = 0;
      wasPlayingRef.current = true;
      lastEpKeyRef.current = currentEpKey;
      retryCountRef.current = 0;
      mediaRecoveryCountRef.current = 0;
      nativeErrorCountRef.current = 0;
      setPlaybackError(false);
      hlsFallbackErrorRef.current = false;
      FragmentLoader.reset();
      setIsInitializingHls(false);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    } else if (video.currentTime > 0) {
      savedPositionRef.current = video.currentTime;
      wasPlayingRef.current = !video.paused;
    }

    // Consume `?t=` deep link ONLY ONCE per episode route (`MED-10`)
    const applyDeepLinkNow = deepLinkTime > 0 && !deepLinkConsumedRef.current;
    if (applyDeepLinkNow) {
      deepLinkConsumedRef.current = true;
    }
    const savedPosition = applyDeepLinkNow ? deepLinkTime : savedPositionRef.current;
    const shouldAutoPlay = wasPlayingRef.current || applyDeepLinkNow;

    let nativeCleanup: (() => void) | null = null;
    let playbackFailed = false;

    const failPlayback = () => {
      if (playbackFailed || isDisposed) return;
      playbackFailed = true;
      setIsInitializingHls(false);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute('src');
      video.load();

      // 1. Try automatic failover to backup server first (`CRIT-05`)
      if (onStreamFatalErrorRef.current && onStreamFatalErrorRef.current()) {
        return;
      }

      // 2. Fallback to validated external embed if available (`CRIT-03`)
      if (validatedEmbedUrl) {
        hlsFallbackErrorRef.current = true;
        setPlayerMode('embed');
      } else {
        setPlaybackError(true);
      }
    };

    const startHls = () => {
      if (isDisposed || !videoRef.current) return;

      if (Hls.isSupported()) {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const hls = new Hls({
          fLoader: FragmentLoader,
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

          if (hls.levels && hls.levels.length) {
            const rawLevels: HlsLevelInfo[] = hls.levels.map((lvl, idx) => ({
              id: idx,
              height: lvl.height || 0,
              width: lvl.width,
              bitrate: lvl.bitrate,
            }));
            const sortedLevels = sortQualitiesDescending(rawLevels);
            setHlsLevels(sortedLevels);

            const savedQualityHeight = parseInt(
              localStorage.getItem('bofilm_player_quality') || '',
              10
            );
            const matchedLevelIdx = findQualityLevelByHeight(
              hls.levels,
              savedQualityHeight
            );

            if (audioSaverRef.current) {
              preAudioSaverLevelRef.current = matchedLevelIdx;
              const lowestIdx = findLowestBitrateLevelIndex(hls.levels);
              hls.autoLevelCapping = lowestIdx;
              hls.nextLevel = lowestIdx;
              setCurrentLevel(matchedLevelIdx);
            } else if (matchedLevelIdx >= 0) {
              hls.currentLevel = matchedLevelIdx;
              setCurrentLevel(matchedLevelIdx);
            } else {
              hls.currentLevel = -1;
              setCurrentLevel(-1);
            }
          } else {
            setHlsLevels([]);
            setCurrentLevel(-1);
          }

          const rawAudios = (
            hls.audioTracks && hls.audioTracks.length > 0 ? hls.audioTracks : []
          ) as RawMediaTrack[];
          const parsedAudios: AudioTrackOption[] = rawAudios.map((tr, idx) => {
            const id = typeof tr.id === 'number' ? tr.id : idx;
            const name = tr.name || tr.lang || `Audio ${idx + 1}`;
            const channels = tr.attrs?.CHANNELS || tr.channels;
            const codec = tr.codec || tr.attrs?.CODECS;
            const isSupported = isAudioTrackBrowserSupported(name, channels, codec);
            return {
              id,
              name,
              lang: tr.lang,
              channels,
              codec,
              isSupported,
            };
          });
          setAudioTracks(parsedAudios);

          if (parsedAudios.length > 0) {
            const savedAudio = localStorage.getItem('bofilm_player_audio');
            const chosenId = selectBestAudioTrack(rawAudios, savedAudio);
            hls.audioTrack = chosenId;
            setCurrentAudioTrack(chosenId);
          } else {
            setCurrentAudioTrack(0);
          }

          const rawSubs =
            hls.subtitleTracks && hls.subtitleTracks.length > 0
              ? hls.subtitleTracks
              : [];
          const parsedSubs: HlsSubtitleTrackOption[] = rawSubs.map((tr, idx) => ({
            id: typeof tr.id === 'number' ? tr.id : idx,
            name: tr.name || tr.lang || `Track ${idx + 1}`,
            lang: tr.lang,
            default: tr.default,
          }));
          setHlsSubtitleTracks(parsedSubs);

          if (parsedSubs.length > 0) {
            const savedSub = localStorage.getItem('bofilm_player_subtitle');
            if (savedSub === 'off') {
              hls.subtitleTrack = -1;
              setCurrentSubtitleTrack(-1);
            } else if (savedSub) {
              const match = parsedSubs.find(
                (s) => s.name === savedSub || String(s.id) === savedSub
              );
              const subId = match
                ? match.id
                : parsedSubs.find((s) => isVietnameseSubtitle(s.name, s.lang))?.id ??
                  parsedSubs[0].id;
              hls.subtitleTrack = subId;
              setCurrentSubtitleTrack(subId);
            } else {
              const viSub = parsedSubs.find((s) =>
                isVietnameseSubtitle(s.name, s.lang)
              );
              const subId = viSub ? viSub.id : parsedSubs[0].id;
              hls.subtitleTrack = subId;
              setCurrentSubtitleTrack(subId);
            }
          } else {
            hls.subtitleTrack = -1;
            setCurrentSubtitleTrack(-1);
          }

          if (savedPosition > 0 && Math.abs(video.currentTime - savedPosition) > 1) {
            video.currentTime = savedPosition;
          }
          if (shouldAutoPlay) {
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          const level = hls.levels?.[data.level];
          if (level) {
            setActiveHeight(level.height || 0);
          }
        });

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
          const tracks = (data.audioTracks || []) as RawMediaTrack[];
          if (tracks.length > 0) {
            const parsedAudios: AudioTrackOption[] = tracks.map((tr, idx) => {
              const id = typeof tr.id === 'number' ? tr.id : idx;
              const name = tr.name || tr.lang || `Audio ${idx + 1}`;
              const channels = tr.attrs?.CHANNELS || tr.channels;
              const codec = tr.codec || tr.attrs?.CODECS;
              const isSupported = isAudioTrackBrowserSupported(name, channels, codec);
              return {
                id,
                name,
                lang: tr.lang,
                channels,
                codec,
                isSupported,
              };
            });
            setAudioTracks(parsedAudios);

            const currentTrackObj = tracks[hls.audioTrack];
            const isCurrentSupported = currentTrackObj
              ? isAudioTrackBrowserSupported(
                  currentTrackObj.name || '',
                  currentTrackObj.attrs?.CHANNELS || currentTrackObj.channels,
                  currentTrackObj.codec || currentTrackObj.attrs?.CODECS
                )
              : true;

            if (!isCurrentSupported || hls.audioTrack < 0) {
              const bestId = selectBestAudioTrack(
                tracks,
                localStorage.getItem('bofilm_player_audio')
              );
              hls.audioTrack = bestId;
              setCurrentAudioTrack(bestId);
            } else if (hls.audioTrack >= 0) {
              setCurrentAudioTrack(hls.audioTrack);
            }
          }
        });

        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
          if (typeof data.id === 'number') {
            setCurrentAudioTrack(data.id);
          }
        });

        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
          if (data.subtitleTracks && data.subtitleTracks.length > 0) {
            const parsedSubs: HlsSubtitleTrackOption[] = data.subtitleTracks.map(
              (tr, idx) => ({
                id: typeof tr.id === 'number' ? tr.id : idx,
                name: tr.name || tr.lang || `Track ${idx + 1}`,
                lang: tr.lang,
                default: tr.default,
              })
            );
            setHlsSubtitleTracks(parsedSubs);
          }
        });

        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
          if (typeof data.id === 'number') {
            setCurrentSubtitleTrack(data.id);
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && !playbackFailed) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (retryCountRef.current < 2) {
                  retryCountRef.current += 1;
                  setIsInitializingHls(true);
                  if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                  }
                  if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
                  retryTimerRef.current = setTimeout(() => {
                    if (isDisposed) return;
                    startHls();
                  }, 1800);
                } else {
                  failPlayback();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                if (
                  data.details === 'bufferAppendError' &&
                  hls.audioTracks &&
                  hls.audioTracks.length > 1
                ) {
                  const bestFallback = selectBestAudioTrack(
                    hls.audioTracks as RawMediaTrack[],
                    null
                  );
                  if (bestFallback !== hls.audioTrack) {
                    hls.audioTrack = bestFallback;
                    setCurrentAudioTrack(bestFallback);
                    hls.recoverMediaError();
                    break;
                  }
                }
                if (mediaRecoveryCountRef.current < 2) {
                  mediaRecoveryCountRef.current += 1;
                  hls.recoverMediaError();
                } else {
                  failPlayback();
                }
                break;
              default:
                if (retryCountRef.current < 2) {
                  retryCountRef.current += 1;
                  setIsInitializingHls(true);
                  if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                  }
                  if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
                  retryTimerRef.current = setTimeout(() => {
                    if (isDisposed) return;
                    startHls();
                  }, 1800);
                } else {
                  failPlayback();
                }
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        const handleLoadedMetadata = () => {
          setIsInitializingHls(false);
          if (savedPosition > 0 && Math.abs(video.currentTime - savedPosition) > 1) {
            video.currentTime = savedPosition;
          }
          if (shouldAutoPlay) {
            video.play().catch(() => {});
          }
        };

        const handleNativeError = () => {
          if (playbackFailed) return;
          if (nativeErrorCountRef.current < 2) {
            nativeErrorCountRef.current += 1;
            setIsInitializingHls(true);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => {
              if (isDisposed) return;
              video.src = streamUrl;
              video.load();
              if (shouldAutoPlay) {
                video.play().catch(() => {});
              }
            }, 1800);
          } else {
            failPlayback();
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
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [
    m3u8Url,
    serverIndex,
    movieSlug,
    episodeName,
    episodeSlug,
    currentEpisodeSlug,
    playerMode,
    key,
    deepLinkTime,
    validatedEmbedUrl,
    FragmentLoader,
    setPlayerMode,
  ]);

  const handleReload = () => {
    if (videoRef.current && videoRef.current.currentTime > 0) {
      savedPositionRef.current = videoRef.current.currentTime;
    }
    retryCountRef.current = 0;
    mediaRecoveryCountRef.current = 0;
    nativeErrorCountRef.current = 0;
    setPlaybackError(false);
    hlsFallbackErrorRef.current = false;
    FragmentLoader.reset();
    setIsInitializingHls(false);
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setKey((prev) => prev + 1);
  };

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
  const suppressClickRef = useRef(false);

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
          state.mode = relativeX < 0.5 ? 'brightness' : 'volume';
        }
      }
    }

    if (state.mode === 'seek') {
      const seekSpan = Math.min(duration || 120, 180);
      const seekOffset = (deltaX / rect.width) * seekSpan;
      const targetTime = Math.max(
        0,
        Math.min(duration || 99999, state.initialSeekTime + seekOffset)
      );
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
      const newBrightness = Math.max(
        0.3,
        Math.min(1.8, state.initialBrightness + change)
      );
      const rounded = Math.round(newBrightness * 100) / 100;
      setBrightness(rounded);
      try {
        localStorage.setItem('bofilm_player_brightness', String(rounded));
      } catch {
        // ignore
      }

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
      } catch {
        // ignore
      }

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
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
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
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        lastTapInfoRef.current = null;

        if (relativeX < 0.42) {
          if (videoRef.current) {
            const next = Math.max(0, videoRef.current.currentTime - 10);
            videoRef.current.currentTime = next;
            setCurrentTime(next);
          }
          setDoubleTapEffect((prev) => ({
            side: 'left',
            count:
              prev && prev.side === 'left' && now - prev.id < 1200
                ? prev.count + 10
                : 10,
            id: now,
          }));
          if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = setTimeout(() => {
            setDoubleTapEffect(null);
          }, 850);
        } else if (relativeX > 0.58) {
          if (videoRef.current) {
            const next = Math.min(
              duration || 99999,
              videoRef.current.currentTime + 10
            );
            videoRef.current.currentTime = next;
            setCurrentTime(next);
          }
          setDoubleTapEffect((prev) => ({
            side: 'right',
            count:
              prev && prev.side === 'right' && now - prev.id < 1200
                ? prev.count + 10
                : 10,
            id: now,
          }));
          if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = setTimeout(() => {
            setDoubleTapEffect(null);
          }, 850);
        } else {
          toggleFullscreen();
        }
      } else {
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

  // ===== Unified PointerEvent + Keyboard Accessible Seekbar (`HIGH-11` / `FE-PLY-09`) =====
  const getSeekTimeFromClientX = (clientX: number) => {
    if (!seekbarRef.current || !duration) return 0;
    const rect = seekbarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio >= 0.999 ? Math.max(0, duration - 0.25) : ratio * duration;
  };

  const handleSeekbarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    const targetTime = getSeekTimeFromClientX(e.clientX);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
  };

  const handleSeekbarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekbarRef.current || !duration) return;
    const rect = seekbarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(ratio * duration);
    setHoverRatio(ratio * 100);

    if (isScrubbingRef.current) {
      const moveTime = ratio >= 0.999 ? Math.max(0, duration - 0.25) : ratio * duration;
      if (videoRef.current) {
        videoRef.current.currentTime = moveTime;
        setCurrentTime(moveTime);
      }
    }
  };

  const finishScrubbing = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbingRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const finalTime = getSeekTimeFromClientX(e.clientX);
    if (videoRef.current) {
      videoRef.current.currentTime = finalTime;
      setCurrentTime(finalTime);
    }
    if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current);
    scrubTimerRef.current = setTimeout(() => {
      isScrubbingRef.current = false;
      setIsScrubbing(false);
    }, 40);
  };

  const handleSeekbarKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.max(0, video.currentTime - 5);
      video.currentTime = next;
      setCurrentTime(next);
      triggerFeedback('-5 giây', 'seek-backward');
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.min(duration, video.currentTime + 5);
      video.currentTime = next;
      setCurrentTime(next);
      triggerFeedback('+5 giây', 'seek-forward');
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      video.currentTime = 0;
      setCurrentTime(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      const endPos = Math.max(0, duration - 1);
      video.currentTime = endPos;
      setCurrentTime(endPos);
    }
  };

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

  const handleSkip = (seconds: number) => {
    if (!videoRef.current) return;
    const next = Math.max(
      0,
      Math.min(duration || 99999, videoRef.current.currentTime + seconds)
    );
    videoRef.current.currentTime = next;
    setCurrentTime(next);
    triggerFeedback(
      seconds > 0 ? `+${seconds} giây` : `${seconds} giây`,
      seconds > 0 ? 'seek-forward' : 'seek-backward'
    );
  };

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
    triggerFeedback(
      next ? 'Đã tắt tiếng' : `Âm lượng: ${Math.round(volume * 100)}%`,
      'volume'
    );
  };

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

  const effectiveSubSize = subtitle?.size ?? prefs.subtitleSize;
  const effectiveSubColor = subtitle?.color ?? prefs.subtitleColor;

  return (
    <>
      <style>
        {`video::cue {
          font-size: ${
            effectiveSubSize === 'sm'
              ? '0.85em'
              : effectiveSubSize === 'lg'
              ? '1.5em'
              : '1.1em'
          };
          color: ${effectiveSubColor};
          background: rgba(0, 0, 0, 0.65);
          font-family: 'Plus Jakarta Sans', 'Segoe UI', Roboto, sans-serif;
          text-shadow: 0 2px 4px rgba(0,0,0,0.9);
        }
        video::-webkit-media-text-track-container {
          transform: translateY(-8%) !important;
        }`}
      </style>

      {isDimmed && (
        <div
          onClick={() => setIsDimmed(false)}
          className="fixed inset-0 bg-black/92 z-40 transition-opacity backdrop-blur-md cursor-pointer"
          title="Bấm vào đây để bật lại đèn"
        />
      )}

      {/* Accessible Modal `<dialog>` via `.showModal()` (`HIGH-11`) */}
      {showShortcutsModal && (
        <dialog
          ref={shortcutsDialogRef}
          aria-label="Phím tắt trình phát"
          onCancel={() => setShowShortcutsModal(false)}
          className="fixed inset-0 z-[60] w-screen h-screen max-w-none max-h-none m-0 border-0 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowShortcutsModal(false);
          }}
        >
          <div
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[#071307] border border-lime-500/30 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between px-5 py-3.5 bg-[#071307]/95 backdrop-blur-md border-b border-lime-500/20 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-lime-400" />
                <h3 className="text-sm font-extrabold text-[#f4fbf0] uppercase tracking-wider">
                  Phím Tắt Trình Phát
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                aria-label="Đóng bảng phím tắt"
                className="min-w-[40px] min-h-[40px] p-2 rounded-lg text-[#9ab395] hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer"
                title="Đóng (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

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
                  <h4 className="text-xs font-bold uppercase tracking-wider text-lime-400">
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
                            className="inline-flex items-center justify-center min-w-[26px] px-1.5 py-0.5 rounded-md bg-lime-950/60 border border-lime-500/30 text-xs font-black text-lime-300 shadow-sm"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              <p className="text-xs text-[#9ab395] text-center pt-1">
                Phím tắt hoạt động khi phát video HLS Bơ Film.
              </p>
            </div>
          </div>
        </dialog>
      )}

      <div
        className={`relative transition-all duration-300 ${
          isTheater ? 'w-full max-w-none col-span-full z-45' : 'w-full'
        } ${isDimmed ? 'z-50' : ''}`}
      >
        {/* Cinematic Ambient Glow — Avocado/Emerald/Amber palette only (zero banned violet/purple!) */}
        {ambientGlow && (
          <div
            aria-hidden="true"
            className="absolute -inset-2 sm:-inset-4 z-0 pointer-events-none rounded-[28px] opacity-75 blur-xl transition-opacity duration-700 mix-blend-screen"
            style={{
              background:
                'linear-gradient(115deg, rgba(163,230,53,0.32), rgba(16,185,129,0.28), rgba(20,184,166,0.22), rgba(251,191,36,0.22), rgba(163,230,53,0.32))',
              backgroundSize: '300% 300%',
              animation: 'bofilm-ambient-drift 14s ease-in-out infinite',
            }}
          />
        )}
        {ambientGlow && (
          <style>{`@keyframes bofilm-ambient-drift {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
          }`}</style>
        )}

        {/* Top Control Bar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-[#09150a] border-y sm:border border-lime-500/25 rounded-none sm:rounded-t-2xl shadow-md">
          <div className="flex items-center gap-2 text-xs font-semibold text-lime-300 truncate min-w-0">
            <span className="w-2 h-2 rounded-full bg-lime-400 flex-shrink-0" />
            <span className="truncate">
              Đang phát:{' '}
              <span className="text-[#fef08a] font-bold">
                {episodeName
                  ? episodeName.startsWith('Tập') || isNaN(Number(episodeName.trim()))
                    ? episodeName
                    : `Tập ${episodeName}`
                  : 'Tập 1'}
              </span>
            </span>
            {autoIngested && (
              <span className="hidden sm:inline-flex items-center gap-1 text-xs font-bold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40">
                <span>Auto-Ingest HLS</span>
              </span>
            )}
            {volumeBoost > 100 && !boostUnsupported && (
              <span
                className="inline-flex items-center gap-1 text-xs font-bold text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/40 tabular-nums"
                title="Khuếch đại âm thanh qua Web Audio GainNode"
              >
                <Gauge className="w-3 h-3" />
                <span>{volumeBoost}% Boost</span>
              </span>
            )}
          </div>

          {/* Top Action Tools with explicit ARIA labels & states (`HIGH-11`) */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 flex-shrink-0">
            <div className="relative" ref={shareMenuRef}>
              <button
                type="button"
                onClick={() => setShowShareMenu((prev) => !prev)}
                aria-label="Chia sẻ phim và tập"
                aria-expanded={showShareMenu}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 transition-colors cursor-pointer"
                title="Chia sẻ phim & tập"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Chia sẻ</span>
              </button>

              {showShareMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-max min-w-[240px] z-50 bg-[#0a180b]/95 backdrop-blur-2xl border border-lime-500/25 rounded-2xl shadow-2xl p-1.5 flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={handleShareSystem}
                    className="min-h-[38px] px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center gap-2 text-[#cbe1c8] hover:bg-white/10 hover:text-white"
                  >
                    <Share2 className="w-3.5 h-3.5 text-lime-400" />
                    <span>Chia sẻ qua ứng dụng…</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyShareLink(false)}
                    className="min-h-[38px] px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center gap-2 text-[#cbe1c8] hover:bg-white/10 hover:text-white"
                  >
                    <Link2 className="w-3.5 h-3.5 text-lime-400" />
                    <span>Sao chép liên kết</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyShareLink(true)}
                    disabled={playerMode !== 'hls' || currentTime <= 0}
                    className="min-h-[38px] px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center gap-2 text-[#cbe1c8] hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Clock className="w-3.5 h-3.5 text-amber-300" />
                    <span className="flex flex-col items-start leading-4">
                      <span>Sao chép link kèm thời gian hiện tại</span>
                      {playerMode === 'hls' && currentTime > 0 && (
                        <span className="text-[11px] font-semibold text-amber-300/90 tabular-nums">
                          ?t={Math.floor(currentTime)} ({formatTime(currentTime)})
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsDimmed(!isDimmed)}
              aria-label={isDimmed ? 'Bật lại đèn nền' : 'Tắt đèn rạp chiếu'}
              aria-pressed={isDimmed}
              className={`min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
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

            <button
              type="button"
              onClick={toggleTheater}
              aria-label={
                isTheater ? 'Thu nhỏ chế độ rạp chiếu' : 'Mở rộng chế độ rạp chiếu'
              }
              aria-pressed={isTheater}
              className={`hidden sm:flex min-h-[36px] items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                isTheater
                  ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40'
                  : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
              }`}
              title="Chế độ rạp chiếu (Phím T)"
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

            {isPipSupported && (
              <button
                type="button"
                onClick={togglePip}
                aria-label={isPip ? 'Thoát Hình trong hình PiP' : 'Bật Hình trong hình PiP'}
                aria-pressed={isPip}
                className={`min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  isPip
                    ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40 shadow-sm'
                    : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
                }`}
                title={
                  isPip
                    ? 'Thoát Picture-in-Picture (Phím P)'
                    : 'Hình trong hình PiP (Phím P)'
                }
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">PiP</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setShowStats((prev) => !prev);
                triggerFeedback(
                  showStats ? 'Đã tắt thống kê' : 'Đã bật thống kê',
                  'volume'
                );
              }}
              aria-label="Thống kê kỹ thuật trình phát"
              aria-pressed={showStats}
              className={`min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] p-1.5 rounded-lg transition-colors flex items-center justify-center cursor-pointer ${
                showStats
                  ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40'
                  : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
              }`}
              title="Thống kê kỹ thuật trình phát (Stats for Nerds)"
            >
              <Gauge className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleHealthGaugeToggle}
              aria-label="Thước đo sức khỏe luồng phát"
              aria-pressed={showHealthGauge}
              className={`min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] p-1.5 rounded-lg transition-colors flex items-center justify-center cursor-pointer ${
                showHealthGauge
                  ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40'
                  : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
              }`}
              title="Thước đo sức khỏe stream & bộ nhớ đệm"
            >
              <Activity className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setShowShortcutsModal(true)}
              aria-label="Mở bảng phím tắt trình phát"
              aria-expanded={showShortcutsModal}
              className="hidden sm:flex min-w-[36px] min-h-[36px] p-1.5 rounded-lg bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 transition-colors items-center justify-center cursor-pointer"
              title="Phím tắt trình phát (Phím /)"
            >
              <Keyboard className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleReload}
              aria-label="Tải lại trình phát video"
              className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] p-1.5 rounded-lg bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 transition-colors flex items-center justify-center cursor-pointer"
              title="Tải lại trình phát video"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Video Frame 16:9 */}
        <div
          ref={containerRef}
          onMouseMove={triggerUserActivity}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          className={`relative ${
            showSettingsMenu ? 'z-40' : 'z-10'
          } aspect-video w-full bg-black rounded-none sm:rounded-b-2xl overflow-hidden border-x-0 sm:border border-lime-500/25 shadow-[0_10px_45px_rgba(0,0,0,0.85)] group select-none touch-none ${
            !showControls && isPlaying ? 'cursor-none' : ''
          }`}
        >
          {playerMode === 'hls' && (m3u8Url || movieSlug) ? (
            <>
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
                  if (volumeBoost > 100 || nightAudio || eqPreset !== 'flat') {
                    ensureAudioGraph();
                  }
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
                  syncBufferMetrics(videoRef.current);

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
                    syncBufferMetrics(videoRef.current);
                  }
                }}
                onLoadedMetadata={() => {
                  if (!videoRef.current) return;
                  setDuration(videoRef.current.duration);
                  videoRef.current.volume = volume;
                  videoRef.current.muted = isMuted;
                  videoRef.current.playbackRate = playbackSpeed;
                  syncBufferMetrics(videoRef.current, true);
                  checkPipSupport();
                }}
                onEnded={() => {
                  setIsPlaying(false);
                  setShowControls(true);
                  if (nextEpisode && onNextEpisode && autoNextEnabled) {
                    setAutoNextCountdown(15);
                  }
                }}
                className={`absolute inset-0 w-full h-full bg-black object-contain ${
                  audioSaver ? 'invisible' : ''
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

              {/* Stats for Nerds Overlay */}
              {showStats && playerMode === 'hls' && stats && (
                <div className="player-controls-interactive absolute left-3 top-3 z-40 pointer-events-none select-none rounded-xl bg-black/85 backdrop-blur-md border border-lime-500/30 p-3 font-mono text-[11px] leading-4 text-emerald-300/90 shadow-2xl max-w-[270px] tabular-nums">
                  <div className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-lime-400">
                    <Info className="w-3 h-3" />
                    Stats for Nerds
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-2.5">
                    <span className="text-[#9ab395]">Nguồn video:</span>
                    <span className="truncate">HLS Bơ Film</span>
                    <span className="text-[#9ab395]">Độ phân giải:</span>
                    <span className="text-white">{stats.resolution}</span>
                    <span className="text-[#9ab395]">Cỡ trình phát:</span>
                    <span className="text-white">{stats.playerSize}</span>
                    <span className="text-[#9ab395]">Chất lượng:</span>
                    <span className="text-white">{stats.currentLevel}</span>
                    <span className="text-[#9ab395]">Băng thông:</span>
                    <span className="text-white">{stats.networkActivity} Mbps</span>
                    <span className="text-[#9ab395]">Đã tải trước:</span>
                    <span className="text-white">{stats.bufferedAhead}s</span>
                    <span className="text-[#9ab395]">Vẽ / Bỏ khung:</span>
                    <span className="text-white">
                      {stats.framesDecoded} / {stats.droppedFrames} ({stats.droppedRatio})
                    </span>
                    <span className="text-[#9ab395]">Tốc độ phát:</span>
                    <span className="text-white">{stats.playbackRate}</span>
                    <span className="text-[#9ab395]">Khuếch đại âm:</span>
                    <span className="text-white">{stats.boost}</span>
                    {subtitle && (
                      <>
                        <span className="text-[#9ab395]">Phụ đề:</span>
                        <span className="truncate text-lime-200">
                          {subtitle.name || 'Tùy chỉnh'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Stream Health & Buffer Gauge Overlay */}
              {showHealthGauge && playerMode === 'hls' && (
                <div className="player-controls-interactive absolute right-3 top-3 z-40 pointer-events-none select-none rounded-xl bg-black/85 backdrop-blur-md border border-lime-500/30 p-2.5 font-mono text-[11px] leading-4 shadow-2xl w-[164px] tabular-nums">
                  <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-lime-400">
                    <span className="flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      Health
                    </span>
                    <span className={`flex items-center gap-1 font-bold ${bufferHealthStatus.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${bufferHealthStatus.dot}`} />
                      {bufferHealthStatus.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[#9ab395]">
                    <span>Buffer</span>
                    <span className="text-white font-bold">
                      {bufferHealth.ahead > 0 ? `${bufferHealth.ahead.toFixed(1)}s` : '0.0s'}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${bufferHealthStatus.bar} transition-all duration-300`}
                      style={{ width: `${bufferGaugePercent}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[#9ab395]">
                    <span>Băng thông</span>
                    <span className="text-white font-bold">
                      {bufferHealth.bandwidthMb !== null
                        ? `${bufferHealth.bandwidthMb} Mbps`
                        : '—'}
                    </span>
                  </div>
                </div>
              )}

              {/* Double Tap Ripple Animations */}
              {doubleTapEffect?.side === 'left' && (
                <div className="absolute left-0 top-0 bottom-0 w-2/5 flex items-center justify-center bg-gradient-to-r from-lime-500/25 via-lime-500/10 to-transparent pointer-events-none rounded-r-full z-30">
                  <div className="flex flex-col items-center gap-1.5 bg-black/85 backdrop-blur-md px-4 py-3 rounded-2xl border border-lime-500/50">
                    <ChevronsLeft className="w-8 h-8 text-lime-400" />
                    <span className="text-xs font-black text-[#f4fbf0] tracking-wider tabular-nums">
                      -{doubleTapEffect.count}s
                    </span>
                  </div>
                </div>
              )}

              {doubleTapEffect?.side === 'right' && (
                <div className="absolute right-0 top-0 bottom-0 w-2/5 flex items-center justify-center bg-gradient-to-l from-lime-500/25 via-lime-500/10 to-transparent pointer-events-none rounded-l-full z-30">
                  <div className="flex flex-col items-center gap-1.5 bg-black/85 backdrop-blur-md px-4 py-3 rounded-2xl border border-lime-500/50">
                    <ChevronsRight className="w-8 h-8 text-lime-400" />
                    <span className="text-xs font-black text-[#f4fbf0] tracking-wider tabular-nums">
                      +{doubleTapEffect.count}s
                    </span>
                  </div>
                </div>
              )}

              {/* Touch Gestures HUD */}
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
                  <div className="bg-black/90 backdrop-blur-md border border-lime-500/40 px-5 py-3.5 rounded-2xl flex flex-col items-center gap-2 shadow-2xl min-w-[145px] tabular-nums">
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
                              touchHud.deltaSeconds! >= 0
                                ? 'text-lime-400'
                                : 'text-yellow-400'
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
                                  Math.max(
                                    0,
                                    (touchHud.targetTime! / touchHud.duration!) * 100
                                  )
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
                            style={{
                              width: `${Math.min(100, Math.max(0, touchHud.value!))}%`,
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Center Feedback Pill */}
              {feedback && (
                <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
                  <div className="bg-black/85 backdrop-blur-md border border-lime-500/40 px-5 py-3 rounded-2xl flex items-center gap-3 shadow-xl">
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
                <div className="player-controls-interactive absolute top-4 left-4 z-30 max-w-sm sm:max-w-md bg-black/85 backdrop-blur-md border border-lime-500/40 rounded-2xl p-3 sm:p-3.5 shadow-2xl">
                  <div className="flex items-start gap-2.5">
                    <div className="p-2 rounded-xl bg-lime-500/20 border border-lime-500/30 text-lime-400 flex-shrink-0 mt-0.5">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 pr-1">
                      <p className="text-xs font-semibold text-[#f4fbf0]">
                        Bạn đang xem dở tại{' '}
                        <span className="text-lime-400 font-extrabold tabular-nums">
                          {formatTime(resumePrompt.time)}
                        </span>
                      </p>
                      <p className="text-xs text-[#9ab395] mt-0.5">
                        Bạn có muốn tiếp tục xem đoạn đã dừng lại không?
                      </p>
                      <div className="flex items-center gap-2 mt-2.5">
                        <button
                          type="button"
                          onClick={handleResumePlayback}
                          className="min-h-[36px] px-3 py-1 rounded-lg bg-lime-500 hover:bg-lime-400 text-black text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                        >
                          <Play className="w-3 h-3 fill-black" />
                          <span>Tiếp tục xem</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleRestartPlayback}
                          className="min-h-[36px] px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[#cbe1c8] text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Xem từ đầu
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResumePrompt(null)}
                      aria-label="Đóng thông báo xem tiếp"
                      className="min-w-[36px] min-h-[36px] text-[#9ab395] hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer"
                      title="Đóng thông báo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Auto-Next Episode Overlay */}
              {autoNextCountdown !== null && nextEpisode && (
                <div className="player-controls-interactive absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6 text-center">
                  <div className="relative flex items-center justify-center mb-4">
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
                      <span className="text-2xl font-black text-lime-400 tabular-nums">
                        {autoNextCountdown}s
                      </span>
                    </div>
                  </div>

                  <p className="text-xs uppercase tracking-widest text-[#9ab395] font-semibold">
                    Tập tiếp theo sẽ tự động phát sau
                  </p>
                  <h3 className="text-lg sm:text-xl font-extrabold text-[#f4fbf0] mt-1">
                    {nextEpisode.name.startsWith('Tập') ||
                    isNaN(Number(nextEpisode.name.trim()))
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
                      className="min-h-[44px] px-6 py-2.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-black font-extrabold text-xs sm:text-sm transition-all cursor-pointer flex items-center gap-2"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      <span>Xem ngay</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutoNextCountdown(null)}
                      className="min-h-[44px] px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-[#cbe1c8] hover:text-white font-bold text-xs sm:text-sm border border-white/10 transition-colors cursor-pointer"
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              )}

              {/* Initializing HLS State (clean vector icon, zero decorative emoji) */}
              {isInitializingHls && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm p-6 text-center transition-all duration-300">
                  <div className="relative mb-3 flex items-center justify-center">
                    <Loader2 className="w-10 h-10 text-lime-400 animate-spin" />
                  </div>
                  <p className="text-sm sm:text-base font-semibold text-lime-300 tracking-wide">
                    Đang khởi tạo luồng Bơ Film tốc độ cao...
                  </p>
                  <p className="text-xs text-[#9ab395] mt-1.5 max-w-xs sm:max-w-sm">
                    Hệ thống đang đồng bộ và tối ưu hóa luồng phát cho bạn, vui lòng đợi giây lát.
                  </p>
                </div>
              )}

              {/* Playback Error Overlay WITH Inline Server Switcher (`CRIT-05`) */}
              {playbackError && playerMode === 'hls' && (
                <div
                  role="alert"
                  className="player-controls-interactive absolute inset-0 z-30 flex flex-col items-center justify-center gap-3.5 bg-black/92 p-5 text-center"
                >
                  <AlertCircle className="w-10 h-10 text-amber-400" />
                  <div className="space-y-1 max-w-md">
                    <p className="text-sm font-bold text-[#f4fbf0]">
                      Không thể phát video từ nguồn này.
                    </p>
                    <p className="text-xs text-[#9ab395]">
                      Bạn có thể thử tải lại hoặc chọn ngay một Server dự phòng bên dưới.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={handleReload}
                      className="min-h-[44px] rounded-xl bg-lime-500 hover:bg-lime-400 px-4 py-2 text-xs font-extrabold text-black inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Thử lại</span>
                    </button>
                    {servers &&
                      servers.length > 1 &&
                      onSelectServer &&
                      servers.map((srv) => {
                        const isCurrent = srv.index === (serverIndex ?? 0);
                        return (
                          <button
                            key={srv.index}
                            type="button"
                            onClick={() => onSelectServer(srv.index)}
                            className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer border transition-colors ${
                              isCurrent
                                ? 'bg-lime-950/70 border-lime-400/50 text-lime-300'
                                : 'bg-[#0a180b] hover:bg-lime-500 hover:text-black border-lime-500/30 text-[#f4fbf0]'
                            }`}
                          >
                            <Server className="w-3.5 h-3.5" />
                            <span>{srv.name}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Hold-to-2x Speed Badge */}
              {isBoosted && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-black/85 backdrop-blur-md border border-lime-400/50 shadow-xl">
                    <FastForward className="w-4 h-4 text-lime-400" />
                    <span className="text-xs sm:text-sm font-black text-[#f4fbf0]">
                      2.0x Đang tăng tốc
                    </span>
                  </div>
                </div>
              )}

              {/* Audio-Only Data Saver Overlay (opaque background, lowest HLS bitrate locked) */}
              {audioSaver && playerMode === 'hls' && (
                <div
                  className="player-controls-interactive absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#050d06]"
                  onDoubleClick={() => handleAudioSaverToggle()}
                >
                  <style>{`@keyframes bofilm-wave-dance {
                    0%, 100% { transform: scaleY(0.35); }
                    50% { transform: scaleY(1); }
                  }`}</style>
                  <div className="flex items-end justify-center gap-1 h-16 sm:h-24" aria-hidden="true">
                    {[0.9, 0.45, 1.1, 0.65, 1.3, 0.55, 0.95, 0.75, 1.2, 0.5, 1.05, 0.85].map(
                      (amp, i) => (
                        <span
                          key={`wb-${i}`}
                          className="w-1.5 sm:w-2 rounded-full bg-gradient-to-t from-lime-600 via-lime-400 to-emerald-300 origin-bottom"
                          style={{
                            height: '100%',
                            animation: `bofilm-wave-dance ${0.7 + amp * 0.45}s ease-in-out ${
                              i * 0.08
                            }s infinite`,
                          }}
                        />
                      )
                    )}
                  </div>
                  <div className="mt-4 flex flex-col items-center gap-2.5 px-4 text-center">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-lime-500/15 border border-lime-500/40">
                      <AudioLines className="w-3.5 h-3.5 text-lime-400" />
                      <span className="text-xs font-extrabold uppercase tracking-wider text-lime-300">
                        Tiết kiệm dữ liệu — Đã hạ băng thông tối thiểu
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAudioSaver(false);
                        triggerFeedback('Đã khôi phục hình ảnh video', 'volume');
                      }}
                      className="min-h-[44px] flex items-center gap-2 px-4 py-2.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-black text-xs sm:text-sm font-extrabold transition-all cursor-pointer"
                    >
                      <MonitorPlay className="w-4 h-4" />
                      <span>Khôi phục hình ảnh</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Episode Drawer Overlay */}
              {showEpisodeDrawer && allEpisodes && allEpisodes.length > 0 && (
                <div
                  className="player-controls-interactive absolute inset-0 z-40 bg-black/85 backdrop-blur-xl flex flex-col"
                  onClick={() => setShowEpisodeDrawer(false)}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
                    <div className="flex items-center gap-2 text-sm font-extrabold text-[#f4fbf0] uppercase tracking-wider">
                      <ListVideo className="w-4 h-4 text-lime-400" />
                      Danh sách tập
                      <span className="text-xs font-bold text-[#9ab395] normal-case tabular-nums">
                        ({allEpisodes.length})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowEpisodeDrawer(false)}
                      aria-label="Đóng danh sách tập"
                      className="min-w-[40px] min-h-[40px] p-2 rounded-lg text-[#9ab395] hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer"
                      title="Đóng (Esc)"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                      {allEpisodes.map((ep, idx) => {
                        const isCurrent =
                          (currentEpisodeSlug && ep.slug === currentEpisodeSlug) ||
                          (!currentEpisodeSlug && ep.slug === episodeSlug);
                        return (
                          <button
                            key={`${ep.slug}-${idx}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowEpisodeDrawer(false);
                              if (!isCurrent) onSelectEpisode?.(ep.slug);
                            }}
                            className={`min-h-[44px] px-2.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                              isCurrent
                                ? 'bg-lime-500 text-black border-lime-300 font-extrabold'
                                : 'bg-white/[0.06] text-[#cbe1c8] hover:bg-white/[0.14] hover:text-white border-white/10 hover:border-lime-400/40'
                            }`}
                          >
                            <span className="truncate">
                              {ep.name.startsWith('Tập') ||
                              isNaN(Number(ep.name.trim()))
                                ? ep.name
                                : `Tập ${ep.name}`}
                            </span>
                            {isCurrent && (
                              <Check className="w-3.5 h-3.5 stroke-[3] flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom Player Controls Overlay (`CRIT-06` & `CRIT-07` mobile-safe layout) */}
              <div
                className={`player-controls-interactive absolute bottom-0 left-0 right-0 z-25 bg-gradient-to-t from-black/95 via-black/75 to-transparent pt-10 pb-2.5 px-2.5 sm:px-4 sm:pb-3.5 transition-opacity duration-300 ${
                  showControls || !isPlaying || isScrubbing || showSettingsMenu
                    ? 'opacity-100 pointer-events-auto'
                    : 'opacity-0 pointer-events-none'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Accessible ARIA & PointerEvent Timeline Seekbar (`HIGH-11`) */}
                <div
                  ref={seekbarRef}
                  role="slider"
                  tabIndex={0}
                  aria-label="Thanh tua thời gian"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(0, Math.round(duration || 0))}
                  aria-valuenow={Math.max(0, Math.round(currentTime || 0))}
                  aria-valuetext={`${formatTime(currentTime)} trên ${formatTime(duration)}`}
                  onKeyDown={handleSeekbarKeyDown}
                  onPointerDown={handleSeekbarPointerDown}
                  onPointerMove={handleSeekbarPointerMove}
                  onPointerUp={finishScrubbing}
                  onPointerCancel={finishScrubbing}
                  onPointerLeave={() => setHoverTime(null)}
                  className="relative w-full py-2.5 cursor-pointer group/bar select-none rounded-md"
                >
                  {hoverTime !== null && (
                    <div
                      className="absolute -top-9 -translate-x-1/2 pointer-events-none z-20 flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-xl bg-black/90 backdrop-blur-md border border-lime-500/50 text-xs font-bold text-lime-300 shadow-xl tabular-nums"
                      style={{ left: `${hoverRatio}%` }}
                    >
                      <span className="text-white">{formatTime(hoverTime)}</span>
                      {duration > 0 && (
                        <span className="text-[10px] font-bold text-[#9ab395] bg-white/10 px-1 py-px rounded">
                          {Math.round((hoverTime / duration) * 100)}%
                        </span>
                      )}
                    </div>
                  )}

                  <div className="relative w-full h-1.5 group-hover/bar:h-2.5 group-focus-visible/bar:h-2.5 rounded-full bg-white/20 backdrop-blur-md transition-all overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-white/30 rounded-full transition-all duration-200"
                      style={{ width: `${bufferedRatio * 100}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-lime-500 via-lime-400 to-emerald-400 rounded-full"
                      style={{
                        width: `${duration ? (currentTime / duration) * 100 : 0}%`,
                      }}
                    />
                  </div>

                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-lime-400 border-2 border-white opacity-0 group-hover/bar:opacity-100 group-focus-visible/bar:opacity-100 group-active/bar:opacity-100 transition-all pointer-events-none"
                    style={{
                      left: `${duration ? (currentTime / duration) * 100 : 0}%`,
                    }}
                  />
                </div>

                {/* Controls Action Row — fits 100% inside 375px-390px mobile without clipping! */}
                <div className="flex items-center justify-between gap-1 sm:gap-2 mt-0.5">
                  {/* Left Controls: Play, -10s, +10s, Mute (+ sm:Volume), Visible Timestamp */}
                  <div className="flex items-center gap-0.5 sm:gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
                      aria-pressed={isPlaying}
                      className="min-w-[44px] min-h-[44px] sm:min-w-[42px] sm:min-h-[42px] p-1.5 sm:p-2 rounded-xl text-[#f4fbf0] hover:text-lime-300 hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer"
                      title={isPlaying ? 'Tạm dừng (Phím Space)' : 'Phát (Phím Space)'}
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5 fill-current" />
                      ) : (
                        <Play className="w-5 h-5 fill-current" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSkip(-10)}
                      aria-label="Lùi 10 giây"
                      className="hidden sm:flex min-w-[42px] min-h-[42px] sm:px-2 py-1 rounded-xl text-[#cbe1c8] hover:text-lime-300 hover:bg-white/10 transition-colors text-xs font-bold items-center justify-center gap-0.5 cursor-pointer"
                      title="Lùi 10 giây (Phím ← hoặc J)"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span className="hidden sm:inline text-[11px] tabular-nums">-10s</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSkip(10)}
                      aria-label="Tiến 10 giây"
                      className="hidden sm:flex min-w-[42px] min-h-[42px] sm:px-2 py-1 rounded-xl text-[#cbe1c8] hover:text-lime-300 hover:bg-white/10 transition-colors text-xs font-bold items-center justify-center gap-0.5 cursor-pointer"
                      title="Tiến 10 giây (Phím → hoặc L)"
                    >
                      <RotateCw className="w-4 h-4" />
                      <span className="hidden sm:inline text-[11px] tabular-nums">+10s</span>
                    </button>

                    <div className="flex items-center gap-1.5 group/vol">
                      <button
                        type="button"
                        onClick={handleToggleMute}
                        aria-label={isMuted ? 'Bật tiếng' : 'Tắt tiếng'}
                        aria-pressed={isMuted}
                        className="min-w-[44px] min-h-[44px] sm:min-w-[42px] sm:min-h-[42px] p-1.5 rounded-xl text-[#cbe1c8] hover:text-lime-300 hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer"
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
                        aria-label="Thanh điều chỉnh âm lượng"
                        className="cinema-volume-slider hidden sm:block"
                        title={`Âm lượng: ${Math.round(volume * 100)}%`}
                      />
                    </div>

                    {/* Persistent Timestamp Readout (`CRIT-07`: visible on ALL viewports with `tabular-nums`) */}
                    <div className="block tabular-nums whitespace-nowrap text-[11px] sm:text-xs font-medium text-[#9ab395] ml-1">
                      <span className="text-[#f4fbf0] font-bold">
                        {formatTime(currentTime)}
                      </span>
                      <span className="mx-0.5 sm:mx-1">/</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  {/* Right Controls: [sm:Prev/Next], Episodes, Settings, [sm:PiP], Fullscreen */}
                  <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                    {prevEpisode && onPrevEpisode && (
                      <button
                        type="button"
                        onClick={onPrevEpisode}
                        aria-label={`Tập trước: ${prevEpisode.name}`}
                        className="hidden sm:inline-flex min-h-[38px] items-center gap-1 px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-[#cbe1c8] hover:text-white text-xs font-bold transition-all cursor-pointer"
                        title={`Tập trước: ${prevEpisode.name}`}
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Tập trước</span>
                      </button>
                    )}

                    {nextEpisode && onNextEpisode && (
                      <button
                        type="button"
                        onClick={onNextEpisode}
                        aria-label={`Tập tiếp theo: ${nextEpisode.name}`}
                        className="hidden sm:inline-flex min-h-[38px] items-center gap-1 px-2.5 py-1 rounded-xl bg-lime-500/20 hover:bg-lime-500/30 text-lime-300 border border-lime-500/30 text-xs font-bold transition-all cursor-pointer"
                        title={`Tập tiếp theo: ${nextEpisode.name}`}
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Tập kế</span>
                      </button>
                    )}

                    {allEpisodes && allEpisodes.length > 0 && onSelectEpisode && (
                      <button
                        type="button"
                        onClick={() => setShowEpisodeDrawer((prev) => !prev)}
                        aria-label="Danh sách tập phim"
                        aria-expanded={showEpisodeDrawer}
                        className={`min-w-[44px] min-h-[44px] sm:min-w-[42px] sm:min-h-[42px] sm:px-2.5 py-1 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                          showEpisodeDrawer
                            ? 'bg-lime-500 text-black border border-lime-300'
                            : 'bg-white/10 hover:bg-white/20 text-[#cbe1c8] hover:text-white'
                        }`}
                        title="Danh sách tập"
                      >
                        <ListVideo className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                        <span className="hidden md:inline">Danh sách tập</span>
                      </button>
                    )}

                    {/* Compact Grouped 4-Tab Settings Popover (`MED-14`) */}
                    <div className="relative" ref={settingsMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowSettingsMenu((prev) => !prev)}
                        aria-label="Cài đặt chất lượng và trình phát"
                        aria-expanded={showSettingsMenu}
                        className={`min-w-[44px] min-h-[44px] sm:min-w-[42px] sm:min-h-[42px] sm:px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          showSettingsMenu
                            ? 'bg-lime-500 text-black'
                            : 'bg-white/10 hover:bg-white/20 text-[#cbe1c8] hover:text-white'
                        }`}
                        title="Chất lượng, Phụ đề & Cài đặt trình phát"
                      >
                        <Settings
                          className={`w-4 h-4 sm:w-3.5 sm:h-3.5 transition-transform ${
                            showSettingsMenu ? 'rotate-90' : ''
                          }`}
                        />
                        <span className="hidden sm:inline">Cài đặt</span>
                      </button>

                      {showSettingsMenu && (
                        <div
                          style={{
                            maxHeight: menuMaxHeight ? `${menuMaxHeight}px` : undefined,
                          }}
                          className={`${
                            isFullscreen
                              ? 'absolute bottom-full right-0 mb-2 w-[284px] sm:w-[310px] max-w-[calc(100vw-24px)] z-50'
                              : 'fixed inset-x-3 bottom-20 z-[70] sm:absolute sm:inset-x-auto sm:bottom-full sm:right-0 sm:mb-2 sm:w-[310px] sm:z-50'
                          } bg-[#0a180b]/98 backdrop-blur-2xl border border-lime-500/25 rounded-2xl shadow-[0_15px_45px_rgba(0,0,0,0.9)] overflow-y-auto`}
                        >
                          {/* 4-Tab Segmented Header */}
                          <div
                            role="tablist"
                            aria-label="Nhóm cài đặt trình phát"
                            className="sticky top-0 z-10 grid grid-cols-4 gap-1 p-1.5 bg-[#071208]/95 backdrop-blur-md border-b border-lime-500/15"
                          >
                            {(
                              [
                                { id: 'quality', label: 'Chất lượng' },
                                { id: 'sub_audio', label: 'Phụ đề/Âm' },
                                { id: 'speed', label: 'Tốc độ' },
                                { id: 'fx', label: 'Nâng cao' },
                              ] as { id: SettingsTab; label: string }[]
                            ).map((tab) => {
                              const active = activeSettingsTab === tab.id;
                              return (
                                <button
                                  key={tab.id}
                                  type="button"
                                  role="tab"
                                  aria-selected={active}
                                  onClick={() => setActiveSettingsTab(tab.id)}
                                  className={`min-h-[34px] px-1.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer truncate ${
                                    active
                                      ? 'bg-lime-500 text-black font-extrabold'
                                      : 'text-[#9ab395] hover:text-[#f4fbf0] hover:bg-white/5'
                                  }`}
                                >
                                  {tab.label}
                                </button>
                              );
                            })}
                          </div>

                          {/* TAB 1: Quality + Auto-Next */}
                          {activeSettingsTab === 'quality' && (
                            <div className="p-3 space-y-3">
                              <div>
                                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#9ab395] mb-1.5">
                                  <MonitorPlay className="w-3.5 h-3.5 text-lime-400" />
                                  <span>Độ phân giải video</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  {hlsLevels.length > 0 ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleQualitySelect(-1)}
                                        className={`min-h-[38px] px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                          currentLevel === -1
                                            ? 'bg-lime-500 text-black font-extrabold'
                                            : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                        }`}
                                      >
                                        <span className="flex items-center gap-1.5">
                                          Tự động
                                          {currentLevel === -1 && activeHeight > 0 && (
                                            <span className="text-[11px] font-bold opacity-80">
                                              ({getQualityLabel(activeHeight)})
                                            </span>
                                          )}
                                        </span>
                                        {currentLevel === -1 && (
                                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                                        )}
                                      </button>
                                      {hlsLevels.map((level) => {
                                        const isActive = currentLevel === level.id;
                                        const label = getQualityLabel(
                                          level.height,
                                          level.width
                                        );
                                        return (
                                          <button
                                            key={`${level.height}-${level.id}`}
                                            type="button"
                                            onClick={() => handleQualitySelect(level.id)}
                                            className={`min-h-[38px] px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                              isActive
                                                ? 'bg-lime-500 text-black font-extrabold'
                                                : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                            }`}
                                          >
                                            <span className="flex items-center gap-1.5">
                                              {label}
                                              {(level.height ?? 0) >= 1080 && (
                                                <span
                                                  className={`text-[10px] px-1.5 py-px rounded font-black uppercase ${
                                                    isActive
                                                      ? 'bg-black/20 text-black'
                                                      : 'bg-lime-500/20 text-lime-300'
                                                  }`}
                                                >
                                                  {(level.height ?? 0) >= 2160
                                                    ? '4K'
                                                    : 'HD'}
                                                </span>
                                              )}
                                              {level.bitrate ? (
                                                <span
                                                  className={`text-[11px] font-semibold tabular-nums ${
                                                    isActive
                                                      ? 'text-black/70'
                                                      : 'text-[#9ab395]'
                                                  }`}
                                                >
                                                  {(level.bitrate / 1000000).toFixed(1)}{' '}
                                                  Mbps
                                                </span>
                                              ) : null}
                                            </span>
                                            {isActive && (
                                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                                            )}
                                          </button>
                                        );
                                      })}
                                    </>
                                  ) : (
                                    <div className="px-2.5 py-1.5 text-xs text-[#9ab395]">
                                      {activeHeight > 0
                                        ? `Đang phát (${getQualityLabel(activeHeight)})`
                                        : 'Tự động thích ứng'}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {nextEpisode && onNextEpisode && (
                                <div className="pt-2 border-t border-white/10">
                                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#9ab395] mb-1.5">
                                    <SkipForward className="w-3.5 h-3.5 text-lime-400" />
                                    <span>Tự động chuyển tập</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={handleToggleAutoNext}
                                    aria-pressed={autoNextEnabled}
                                    className={`min-h-[38px] w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                      autoNextEnabled
                                        ? 'bg-lime-500 text-black font-extrabold'
                                        : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <span>{autoNextEnabled ? 'Đang bật' : 'Đã tắt'}</span>
                                    {autoNextEnabled && (
                                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* TAB 2: Subtitles & Audio Tracks */}
                          {activeSettingsTab === 'sub_audio' && (
                            <div className="p-3 space-y-3">
                              {audioTracks.length > 1 && (
                                <div className="pb-2 border-b border-white/10">
                                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#9ab395] mb-1.5">
                                    <Headphones className="w-3.5 h-3.5 text-lime-400" />
                                    <span>Âm thanh &amp; Lồng tiếng</span>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    {audioTracks.map((tr) => (
                                      <button
                                        key={tr.id}
                                        type="button"
                                        onClick={() => handleAudioSelect(tr.id)}
                                        className={`min-h-[36px] px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all flex items-center justify-between gap-2 cursor-pointer ${
                                          currentAudioTrack === tr.id
                                            ? 'bg-lime-500 text-black font-extrabold'
                                            : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                        }`}
                                      >
                                        <span className="truncate">{tr.name}</span>
                                        {currentAudioTrack === tr.id && (
                                          <Check className="w-3.5 h-3.5 stroke-[3] flex-shrink-0" />
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div>
                                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#9ab395] mb-1.5">
                                  <Captions className="w-3.5 h-3.5 text-lime-400" />
                                  <span>Phụ đề (Subtitles)</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  {hlsSubtitleTracks.length > 0 && (
                                    <div className="space-y-1 mb-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleSubtitleSelect(-1)}
                                        className={`min-h-[36px] w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                          currentSubtitleTrack === -1 && !subtitle?.enabled
                                            ? 'bg-lime-500 text-black font-extrabold'
                                            : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                        }`}
                                      >
                                        <span>Tắt phụ đề</span>
                                        {currentSubtitleTrack === -1 &&
                                          !subtitle?.enabled && (
                                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                                          )}
                                      </button>
                                      {hlsSubtitleTracks.map((st) => (
                                        <button
                                          key={st.id}
                                          type="button"
                                          onClick={() => handleSubtitleSelect(st.id)}
                                          className={`min-h-[36px] w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                            currentSubtitleTrack === st.id &&
                                            !subtitle?.enabled
                                              ? 'bg-lime-500 text-black font-extrabold'
                                              : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                          }`}
                                        >
                                          <span className="truncate">{st.name}</span>
                                          {currentSubtitleTrack === st.id &&
                                            !subtitle?.enabled && (
                                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                                            )}
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => subtitleFileRef.current?.click()}
                                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center gap-2 text-[#cbe1c8] hover:bg-white/10 hover:text-white border border-lime-500/20"
                                  >
                                    <FileUp className="w-3.5 h-3.5 text-lime-400" />
                                    <span>Tải lên tệp .srt / .vtt…</span>
                                  </button>
                                  <input
                                    ref={subtitleFileRef}
                                    type="file"
                                    accept=".srt,.vtt,text/vtt,application/x-subrip"
                                    className="hidden"
                                    onChange={handleSubtitleFileChange}
                                  />

                                  {subtitle && (
                                    <div className="space-y-2 pt-1.5 border-t border-white/10 mt-1">
                                      <div className="flex items-center justify-between gap-2 text-xs text-[#9ab395]">
                                        <span className="truncate" title={subtitle.name}>
                                          {subtitle.name}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={handleSubtitleRemove}
                                          className="text-xs font-bold text-red-400 hover:text-red-300 cursor-pointer"
                                        >
                                          Gỡ
                                        </button>
                                      </div>

                                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#9ab395]">
                                        <Type className="w-3 h-3" />
                                        <span>Cỡ chữ &amp; Màu phụ đề</span>
                                      </div>
                                      <div className="flex gap-1">
                                        {(
                                          [
                                            { value: 'sm' as const, label: 'Nhỏ' },
                                            { value: 'md' as const, label: 'Vừa' },
                                            { value: 'lg' as const, label: 'Lớn' },
                                          ] as const
                                        ).map((s) => (
                                          <button
                                            key={s.value}
                                            type="button"
                                            onClick={() =>
                                              handleSubtitleSizeSelect(s.value)
                                            }
                                            className={`flex-1 min-h-[32px] py-1 rounded-lg text-xs font-bold cursor-pointer ${
                                              effectiveSubSize === s.value
                                                ? 'bg-lime-500 text-black font-extrabold'
                                                : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10'
                                            }`}
                                          >
                                            {s.label}
                                          </button>
                                        ))}
                                      </div>
                                      <div className="flex gap-1">
                                        {SUBTITLE_COLORS.map((c) => (
                                          <button
                                            key={c.value}
                                            type="button"
                                            aria-label={`Màu phụ đề ${c.label}`}
                                            onClick={() =>
                                              handleSubtitleColorSelect(c.value)
                                            }
                                            className={`flex-1 min-h-[32px] py-1 rounded-lg flex items-center justify-center cursor-pointer ${
                                              effectiveSubColor === c.value
                                                ? 'ring-2 ring-lime-400 bg-white/20'
                                                : 'bg-white/5 hover:bg-white/10'
                                            }`}
                                          >
                                            <span
                                              className="w-3.5 h-3.5 rounded-full border border-black/40"
                                              style={{ background: c.value }}
                                            />
                                          </button>
                                        ))}
                                      </div>

                                      <div className="flex items-center justify-between text-[11px] font-bold text-[#9ab395] tabular-nums">
                                        <span>Đồng bộ thời gian</span>
                                        <span className="text-lime-300">
                                          {subtitleDelay > 0 ? '+' : ''}
                                          {subtitleDelay.toFixed(1)}s
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => nudgeSubtitleDelay(-0.5)}
                                          disabled={subtitleDelay <= -5}
                                          className="min-h-[32px] px-2 rounded-lg bg-white/5 text-xs font-bold text-[#cbe1c8] disabled:opacity-40 cursor-pointer"
                                        >
                                          −0.5s
                                        </button>
                                        <input
                                          type="range"
                                          min="-5"
                                          max="5"
                                          step="0.5"
                                          value={subtitleDelay}
                                          aria-label="Chỉnh độ trễ phụ đề"
                                          onChange={(e) =>
                                            setSubtitleDelay(parseFloat(e.target.value))
                                          }
                                          className="flex-1 h-1.5 bg-white/20 rounded-lg accent-lime-400 cursor-pointer"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => nudgeSubtitleDelay(0.5)}
                                          disabled={subtitleDelay >= 5}
                                          className="min-h-[32px] px-2 rounded-lg bg-white/5 text-xs font-bold text-[#cbe1c8] disabled:opacity-40 cursor-pointer"
                                        >
                                          +0.5s
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* TAB 3: Playback Speed & Pitch */}
                          {activeSettingsTab === 'speed' && (
                            <div className="p-3 space-y-3">
                              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#9ab395]">
                                <SlidersHorizontal className="w-3.5 h-3.5 text-lime-400" />
                                <span>Tốc độ phát</span>
                              </div>
                              <div className="grid grid-cols-3 gap-1.5">
                                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => {
                                  const label = spd === 1 ? 'Chuẩn 1x' : `${spd}x`;
                                  return (
                                    <button
                                      key={spd}
                                      type="button"
                                      onClick={() => handleSpeedSelect(spd)}
                                      className={`min-h-[36px] px-2 py-1.5 rounded-xl text-xs font-bold text-center transition-all cursor-pointer flex items-center justify-center gap-1 ${
                                        playbackSpeed === spd
                                          ? 'bg-lime-500 text-black font-extrabold'
                                          : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                      }`}
                                    >
                                      <span>{label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="pt-1">
                                <div className="flex items-center justify-between text-xs font-bold text-[#9ab395] mb-1 tabular-nums">
                                  <span>Tinh chỉnh (0.25x – 3x)</span>
                                  <span className="text-lime-300 font-mono">
                                    {playbackSpeed
                                      .toFixed(2)
                                      .replace(/\.00$/, '')
                                      .replace(/0$/, '')}
                                    x
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0.25"
                                  max="3"
                                  step="0.05"
                                  value={playbackSpeed}
                                  aria-label="Tinh chỉnh tốc độ phát"
                                  onChange={(e) =>
                                    handleSpeedSelect(parseFloat(e.target.value), true)
                                  }
                                  className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-lime-400"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={handlePitchPreserveToggle}
                                aria-pressed={pitchPreserve}
                                className={`min-h-[38px] px-2.5 py-1.5 rounded-xl text-xs font-bold text-left w-full transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                  pitchPreserve
                                    ? 'bg-lime-500 text-black font-extrabold'
                                    : 'text-[#cbe1c8] hover:bg-white/10 hover:text-white'
                                }`}
                              >
                                <span className="flex items-center gap-1.5">
                                  <AudioLines className="w-3.5 h-3.5" />
                                  Giữ cao độ giọng nói
                                </span>
                                {pitchPreserve && (
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                )}
                              </button>
                            </div>
                          )}

                          {/* TAB 4: Audio Boost / EQ / Night Mode / Color Filter / Data Saver */}
                          {activeSettingsTab === 'fx' && (
                            <div className="p-3 space-y-3">
                              {/* Data Saver & Night Audio & Ambient Glow */}
                              <div className="space-y-1.5">
                                <button
                                  type="button"
                                  onClick={handleAudioSaverToggle}
                                  aria-pressed={audioSaver}
                                  className={`min-h-[36px] w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-left flex items-center justify-between gap-2 cursor-pointer ${
                                    audioSaver
                                      ? 'bg-lime-500 text-black font-extrabold'
                                      : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    <Waves className="w-3.5 h-3.5" />
                                    Tiết kiệm dữ liệu (Chỉ audio)
                                  </span>
                                  {audioSaver && (
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={handleNightAudioToggle}
                                  aria-pressed={nightAudio}
                                  className={`min-h-[36px] w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-left flex items-center justify-between gap-2 cursor-pointer ${
                                    nightAudio
                                      ? 'bg-lime-500 text-black font-extrabold'
                                      : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    <Moon className="w-3.5 h-3.5" />
                                    Chuẩn hóa âm thanh ban đêm
                                  </span>
                                  {nightAudio && (
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={handleAmbientGlowToggle}
                                  aria-pressed={ambientGlow}
                                  className={`min-h-[36px] w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-left flex items-center justify-between gap-2 cursor-pointer ${
                                    ambientGlow
                                      ? 'bg-lime-500 text-black font-extrabold'
                                      : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Hào quang điện ảnh
                                  </span>
                                  {ambientGlow && (
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  )}
                                </button>
                              </div>

                              {/* Volume Boost (Amber semantic accent, zero banned fuchsia!) */}
                              <div className="pt-2 border-t border-white/10 space-y-1.5">
                                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#9ab395]">
                                  <span>Khuếch đại âm lượng</span>
                                  <span
                                    className={`font-mono tabular-nums ${
                                      volumeBoost > 100
                                        ? 'text-amber-300'
                                        : 'text-lime-300'
                                    }`}
                                  >
                                    {volumeBoost}%
                                  </span>
                                </div>
                                <div className="grid grid-cols-4 gap-1">
                                  {[100, 125, 150, 200].map((boost) => (
                                    <button
                                      key={boost}
                                      type="button"
                                      onClick={() => handleBoostSelect(boost)}
                                      className={`min-h-[32px] py-1 rounded-lg text-xs font-bold cursor-pointer tabular-nums ${
                                        volumeBoost === boost
                                          ? 'bg-lime-500 text-black font-extrabold'
                                          : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10'
                                      }`}
                                    >
                                      {boost}%
                                    </button>
                                  ))}
                                </div>
                                {!boostUnsupported && (
                                  <input
                                    type="range"
                                    min={100}
                                    max={200}
                                    step={5}
                                    value={volumeBoost}
                                    aria-label="Khuếch đại âm lượng tối đa 200 phần trăm"
                                    onChange={(e) =>
                                      handleBoostSliderChange(Number(e.target.value))
                                    }
                                    className="w-full h-1.5 rounded-full accent-amber-400 cursor-pointer"
                                  />
                                )}
                              </div>

                              {/* Equalizer */}
                              <div className="pt-2 border-t border-white/10 space-y-1">
                                <div className="text-[11px] font-bold uppercase tracking-wider text-[#9ab395]">
                                  Bộ chỉnh âm (Equalizer)
                                </div>
                                <div className="grid grid-cols-2 gap-1">
                                  {(Object.keys(EQ_PRESETS) as EqPreset[]).map(
                                    (preset) => (
                                      <button
                                        key={preset}
                                        type="button"
                                        onClick={() => handleEqPresetSelect(preset)}
                                        className={`min-h-[34px] px-2 py-1 rounded-lg text-[11px] font-bold text-left truncate cursor-pointer ${
                                          eqPreset === preset
                                            ? 'bg-lime-500 text-black font-extrabold'
                                            : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10'
                                        }`}
                                      >
                                        {EQ_PRESETS[preset].label}
                                      </button>
                                    )
                                  )}
                                </div>
                              </div>

                              {/* Color Filter Presets & Sliders */}
                              <div className="pt-2 border-t border-white/10 space-y-2">
                                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#9ab395]">
                                  <span className="flex items-center gap-1">
                                    <Palette className="w-3 h-3 text-lime-400" />
                                    Bộ lọc màu sắc
                                  </span>
                                  <button
                                    type="button"
                                    onClick={handleFilterReset}
                                    className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-bold text-[#cbe1c8] hover:text-lime-300 cursor-pointer"
                                  >
                                    Đặt lại
                                  </button>
                                </div>
                                <div className="space-y-1.5">
                                  {(
                                    [
                                      {
                                        key: 'brightness',
                                        value: brightness,
                                        setter: setBrightness,
                                        label: 'Độ sáng',
                                        icon: <Sun className="w-3 h-3" />,
                                      },
                                      {
                                        key: 'contrast',
                                        value: contrast,
                                        setter: setContrast,
                                        label: 'Tương phản',
                                        icon: <Contrast className="w-3 h-3" />,
                                      },
                                      {
                                        key: 'saturation',
                                        value: saturation,
                                        setter: setSaturation,
                                        label: 'Bão hòa',
                                        icon: <Palette className="w-3 h-3" />,
                                      },
                                    ] as const
                                  ).map((row) => (
                                    <div
                                      key={row.key}
                                      className="flex items-center gap-2"
                                    >
                                      <span className="flex items-center gap-1 w-[84px] text-[11px] font-semibold text-[#9ab395]">
                                        {row.icon}
                                        {row.label}
                                      </span>
                                      <input
                                        type="range"
                                        min={0.5}
                                        max={2}
                                        step={0.05}
                                        value={row.value}
                                        aria-label={row.label}
                                        onChange={(e) =>
                                          row.setter(Number(e.target.value))
                                        }
                                        className="flex-1 h-1.5 rounded-full accent-lime-400 cursor-pointer"
                                      />
                                      <span className="w-9 text-right text-[11px] font-mono font-bold text-lime-300 tabular-nums">
                                        {Math.round(row.value * 100)}%
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                <div className="grid grid-cols-2 gap-1">
                                  {(Object.keys(FILTER_PRESETS) as ColorPreset[]).map(
                                    (preset) => (
                                      <button
                                        key={preset}
                                        type="button"
                                        onClick={() => handleFilterPresetSelect(preset)}
                                        className={`min-h-[32px] px-2 py-1 rounded-lg text-[11px] font-bold text-left truncate cursor-pointer ${
                                          activeColorPreset !== 'custom' &&
                                          activeColorPreset === preset
                                            ? 'bg-lime-500 text-black font-extrabold'
                                            : 'bg-white/5 text-[#cbe1c8] hover:bg-white/10'
                                        }`}
                                      >
                                        {FILTER_PRESETS[preset].label}
                                      </button>
                                    )
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Duplicate bottom PiP hidden on `< 640px` (`CRIT-06`) */}
                    {isPipSupported && (
                      <button
                        type="button"
                        onClick={togglePip}
                        aria-label={
                          isPip ? 'Thoát Hình trong hình PiP' : 'Hình trong hình PiP'
                        }
                        aria-pressed={isPip}
                        className={`hidden sm:inline-flex min-w-[40px] min-h-[40px] p-2 rounded-xl transition-colors items-center justify-center cursor-pointer ${
                          isPip
                            ? 'text-lime-400 bg-lime-500/20 border border-lime-500/40'
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

                    {/* Fullscreen Button — guaranteed on-screen & >= 44x44px at 375px-390px! */}
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      aria-label={
                        isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'
                      }
                      aria-pressed={isFullscreen}
                      className="min-w-[44px] min-h-[44px] sm:min-w-[42px] sm:min-h-[42px] p-1.5 sm:p-2 rounded-xl text-[#f4fbf0] hover:text-lime-300 hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer"
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
          ) : validatedEmbedUrl ? (
            <iframe
              ref={iframeRef}
              key={`embed-${key}`}
              src={validatedEmbedUrl}
              title={`${movieName} - ${episodeName}`}
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full border-0"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#071107] text-[#9ab395]">
              <AlertCircle className="w-12 h-12 text-lime-400 mb-2" />
              <p className="text-base font-semibold text-[#f4fbf0]">
                Chưa có luồng phát hợp lệ cho tập phim này
              </p>
              <p className="text-xs text-[#9ab395] mt-1">
                Vui lòng chọn tập phim khác hoặc chuyển đổi server phát bên dưới.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
