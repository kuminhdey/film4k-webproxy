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
} from 'lucide-react';
import { Movie, Episode, Source } from '../types';
import { Film4kFragmentLoader, setStatsListener } from '../utils/hlsLoader';
import {
  getSubtitleForTime,
  findCueBinarySearch,
  loadVttTrack,
  SUBTITLE_TRACKS,
  SAMPLE_SUBTITLES,
  SubtitleCue,
} from '../utils/subtitles';
import { getQualityDisplayInfo, sortQualitiesDescending, QualityLevel } from '../utils/quality';

export interface SubtitleTrackOption {
  id: string;
  label: string;
  url?: string;
  hlsTrackId?: number;
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
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  // Subtitle state (Dynamic from movie.subtitles, episode.subtitles, HLS manifest, or local)
  const [hlsSubtitleTracks, setHlsSubtitleTracks] = useState<SubtitleTrackOption[]>([]);
  const [selectedCaption, setSelectedCaption] = useState<string>('Tắt');
  const [activeCues, setActiveCues] = useState<SubtitleCue[] | null>(null);
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string | null>(null);

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

  // Single authentic Server VIP (4K Siêu Nhanh) connecting to /api/stream/${movie.slug}/master.m3u8
  const availableServers: Source[] = useMemo(() => {
    if (!movie?.slug) return [];
    return [
      {
        label: 'Server VIP (4K Siêu Nhanh)',
        hlsUrl: `/api/stream/${movie.slug}/master.m3u8`,
        proxyStreamUrl: `/api/stream/${movie.slug}/master.m3u8`,
      },
    ];
  }, [movie?.slug]);

  // Flexible subtitle tracks from movie.subtitles, currentEpisode.subtitles, HLS manifest, or local tracks
  const availableSubtitleOptions: SubtitleTrackOption[] = useMemo(() => {
    const list: SubtitleTrackOption[] = [];
    const seen = new Set<string>();

    // 1. Movie level subtitles from DB
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
          if (!seen.has(label)) {
            seen.add(label);
            list.push({ id: `movie-sub-${idx}`, label, url });
          }
        }
      });
    }

    // 2. Episode level subtitles from DB
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
          if (!seen.has(label)) {
            seen.add(label);
            list.push({ id: `ep-sub-${idx}`, label, url });
          }
        }
      });
    }

    // 3. Manifest subtitles from HLS
    hlsSubtitleTracks.forEach((st) => {
      if (!seen.has(st.label)) {
        seen.add(st.label);
        list.push(st);
      }
    });

    // 4. Predefined sample/bundled tracks (e.g. spider-man)
    if (SUBTITLE_TRACKS[slug]) {
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

  // Load subtitle cues when selectedCaption changes
  useEffect(() => {
    if (selectedCaption === 'Tắt' || !selectedCaption) {
      setActiveCues(null);
      setCurrentSubtitleText(null);
      if (hlsRef.current) {
        hlsRef.current.subtitleTrack = -1;
      }
      return;
    }

    const track = availableSubtitleOptions.find((t) => t.label === selectedCaption);
    if (!track) {
      if (SUBTITLE_TRACKS[slug] && SUBTITLE_TRACKS[slug][selectedCaption]) {
        setActiveCues(SUBTITLE_TRACKS[slug][selectedCaption]);
      } else {
        const fb = SAMPLE_SUBTITLES[slug];
        setActiveCues(fb || null);
      }
      return;
    }

    if (track.url) {
      loadVttTrack(track.url).then((cues) => {
        setActiveCues(cues);
      });
    } else if (track.hlsTrackId !== undefined && hlsRef.current) {
      hlsRef.current.subtitleTrack = track.hlsTrackId;
      hlsRef.current.subtitleDisplay = false;
      if (track.url) {
        loadVttTrack(track.url).then((cues) => setActiveCues(cues));
      }
    } else if (SUBTITLE_TRACKS[slug] && SUBTITLE_TRACKS[slug][track.label]) {
      setActiveCues(SUBTITLE_TRACKS[slug][track.label]);
    } else {
      const fb = SAMPLE_SUBTITLES[slug];
      setActiveCues(fb || null);
    }
  }, [selectedCaption, availableSubtitleOptions, slug]);

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
    setCurrentSubtitleText(text);
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

        // Configure audio tracks if provided by movie
        if (data.audio_tracks && data.audio_tracks.length > 0) {
          const customAudios = data.audio_tracks.map((tr, idx) => ({
            id: typeof tr === 'object' && tr.id !== undefined ? tr.id : idx,
            name: typeof tr === 'string' ? tr : tr.name || (tr as any).label || `Audio ${idx + 1}`,
          }));
          setAudioTracks(customAudios);
          setActiveAudioTrack(customAudios[0].id);
          setActiveAudioName(customAudios[0].name);
        }

        // Configure initial subtitles from DB or fallback
        let initialCaption = 'Tắt';
        if (data.subtitles && data.subtitles.length > 0) {
          const firstSub = data.subtitles[0];
          initialCaption = typeof firstSub === 'string' ? firstSub : firstSub.label || firstSub.name || 'Phụ đề 1';
        } else if (SUBTITLE_TRACKS[slug]) {
          initialCaption = Object.keys(SUBTITLE_TRACKS[slug])[0] || 'Film4k.net';
        }
        setSelectedCaption(initialCaption);

        // Sources & Server initialization: prioritize Server VIP connecting to /api/stream/${data.slug}/master.m3u8
        const localMasterUrl = `/api/stream/${data.slug}/master.m3u8`;
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

        if (data.episodes && data.episodes.length > 0) {
          const targetEp = initialEpisode
            ? data.episodes.find((e) => e.episode === initialEpisode) || data.episodes[0]
            : data.episodes[0];
          setCurrentEpisode(targetEp);
          setCurrentSource(vipSource);
        } else {
          setCurrentEpisode(virtualEp);
          setCurrentSource(vipSource);
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
      });

      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        if (data.levels && data.levels.length > 0) {
          const qList: QualityLevel[] = data.levels.map((lvl, index) => ({
            id: index,
            height: lvl.height,
            width: lvl.width,
            bitrate: lvl.bitrate,
          }));
          setQualities(qList);
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

        // Fix Audio Tracks menu: Populate immediately at MANIFEST_PARSED!
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
          const curId = hls.audioTrack >= 0 ? hls.audioTrack : 0;
          setActiveAudioTrack(curId);
          if (tracks[curId]) {
            setActiveAudioName(tracks[curId].name);
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
          setActiveAudioTrack(fallbackTracks[0].id);
          setActiveAudioName(fallbackTracks[0].name);
        }

        // Subtitles from manifest
        if (data.subtitleTracks && data.subtitleTracks.length > 0) {
          const subs: SubtitleTrackOption[] = data.subtitleTracks.map((tr) => ({
            id: `hls-${tr.id}`,
            label: tr.name || tr.lang || `Track ${tr.id + 1}`,
            hlsTrackId: tr.id,
            url: tr.url,
          }));
          setHlsSubtitleTracks(subs);
        }
        if (savedSeekTimeRef.current > 0) {
          video.currentTime = savedSeekTimeRef.current;
          savedSeekTimeRef.current = 0;
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
          const curId = hls.audioTrack >= 0 ? hls.audioTrack : 0;
          setActiveAudioTrack(curId);
          if (tracks[curId]) {
            setActiveAudioName(tracks[curId].name);
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
        const is403 = data.response && data.response.code === 403;
        if (data.fatal || is403) {
          setStreamNotice('Đang làm mới luồng phát...');

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (retryCount < MAX_RETRIES) {
                retryCount++;
                setTimeout(() => {
                  if (hlsRef.current) {
                    hlsRef.current.startLoad();
                  }
                }, 1000);
              } else {
                retryCount = 0;
                setTimeout(() => {
                  if (hlsRef.current) {
                    hlsRef.current.loadSource(streamUrl);
                    hlsRef.current.startLoad();
                  }
                }, 1500);
              }
              break;

            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;

            default:
              if (is403) {
                setTimeout(() => {
                  if (hlsRef.current) {
                    const freshUrl = `${streamUrl}&_retry=${Date.now()}`;
                    hlsRef.current.loadSource(freshUrl);
                    hlsRef.current.startLoad();
                  }
                }, 1000);
              } else {
                hls.destroy();
                setStreamNotice('Lỗi kết nối luồng phát. Vui lòng chuyển sang máy chủ khác.');
              }
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

    if (videoRef.current.buffered.length > 0) {
      const bufEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
      const total = videoRef.current.duration || 1;
      setBufferedPercent(Math.min(100, (bufEnd / total) * 100));
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 8700); // 2:25:00 default duration
      if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
        const w = videoRef.current.videoWidth;
        const h = videoRef.current.videoHeight;
        const info = getQualityDisplayInfo(h, w);
        setAutoQualityLabel(info.label);
        if (activeQuality === -1) {
          setActiveResolution(info.resolution);
        }
      }
    }
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
    setSettingsMenu('main');
  };

  const handleSelectServer = (src: Source) => {
    if (currentSource && (src.hlsUrl === currentSource.hlsUrl && src.label === currentSource.label)) return;
    if (videoRef.current && videoRef.current.currentTime > 0) {
      savedSeekTimeRef.current = videoRef.current.currentTime;
    }
    setCurrentSource(src);
  };

  const handleSelectSpeed = (speed: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
      setPlaybackSpeed(speed);
    }
    setSettingsMenu('main');
  };

  const handleSelectEpisode = (ep: Episode) => {
    setCurrentEpisode(ep);
    const localMasterUrl = movie?.slug ? `/api/stream/${movie.slug}/master.m3u8` : '';
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
                <span style={{ color: 'var(--accent-light, #ff5a66)', marginLeft: '6px' }}>
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

          {/* Stream Recovery / Refresh Notice */}
          {streamNotice && (
            <div
              style={{
                position: 'absolute',
                top: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(17, 22, 34, 0.94)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(225, 29, 46, 0.45)',
                borderRadius: '30px',
                padding: '7px 20px',
                color: '#fff',
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
                  background: '#e11d2e',
                  boxShadow: '0 0 8px #e11d2e',
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

          {/* 3. STATS OVERLAY CARD (Stats for nerds: Resolution, FPS, Dropped frames, Buffer length, Network speed, Bitrate) */}
          {showStats && (
            <div
              style={{
                position: 'absolute',
                top: '60px',
                left: '24px',
                background: 'rgba(11, 14, 22, 0.92)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
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
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  paddingBottom: '4px',
                  marginBottom: '6px',
                  color: '#ff5a66',
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
                <span style={{ fontWeight: 600, color: droppedFrames > 5 ? '#ff5a66' : '#eef2fa' }}>
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
                  color: '#ffffff',
                  fontSize: 'clamp(20px, 2.4vw, 30px)',
                  fontWeight: 650,
                  lineHeight: 1.35,
                  display: 'inline-block',
                  whiteSpace: 'pre-line',
                  textShadow:
                    '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 3px 6px rgba(0,0,0,0.95), 0 0 6px #000',
                  letterSpacing: '0.01em',
                  fontFamily: 'var(--font-body, "Inter", -apple-system, BlinkMacSystemFont, sans-serif)',
                }}
                dangerouslySetInnerHTML={{ __html: currentSubtitleText }}
              />
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
                width: '280px',
                maxHeight: 'min(420px, calc(100vh - 120px))',
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
                      maxHeight: '340px',
                      padding: '6px',
                      overscrollBehavior: 'contain',
                      WebkitOverflowScrolling: 'touch',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    {/* Off / Tắt option */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCaption('Tắt');
                        setSettingsMenu('main');
                      }}
                      style={{
                        minHeight: '40px',
                        background: selectedCaption === 'Tắt' ? 'rgba(255, 255, 255, 0.10)' : 'none',
                        border: 'none',
                        color: selectedCaption === 'Tắt' ? '#fff' : 'var(--muted-light, #b4bdd0)',
                        padding: '9px 14px',
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
                          onClick={() => {
                            setSelectedCaption(opt.label);
                            setSettingsMenu('main');
                          }}
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
                          <span
                            style={{
                              maxWidth: '210px',
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
                  <span style={{ color: 'var(--muted-light, #b4bdd0)' }}>{formatTime(duration || 8700)}</span>
                </div>
              </div>

              {/* Right Controls: Captions, Settings, AirPlay, PiP, Fullscreen */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {/* Captions button */}
                <button
                  type="button"
                  onClick={() => {
                    if (selectedCaption === 'Tắt') {
                      if (availableSubtitleOptions.length > 0) {
                        setSelectedCaption(availableSubtitleOptions[0].label);
                      } else {
                        setSelectedCaption('Film4k.net');
                      }
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

                {/* Settings Gear button */}
                <button
                  ref={settingsBtnRef}
                  type="button"
                  onClick={() => {
                    const next = !settingsOpen;
                    setSettingsOpen(next);
                    if (next) setSettingsMenu('main');
                  }}
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
                  title="Cài đặt phát (Chất lượng, Âm thanh, Tốc độ, Phụ đề)"
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
