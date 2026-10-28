import { HistoryItem, MovieItem } from './types';

const HISTORY_KEY = 'bofilm_history';
const FAVORITES_KEY = 'bofilm_favorites';

export function saveHistory(item: {
  slug: string;
  name: string;
  episodeName?: string;
  episodeSlug?: string;
  posterUrl: string;
  time?: number;
  duration?: number;
}) {
  if (typeof window === 'undefined') return;
  try {
    const list = getHistory();
    const existing = list.find((i) => i.slug === item.slug);
    const filtered = list.filter((i) => i.slug !== item.slug);
    filtered.unshift({
      ...item,
      time: item.time ?? existing?.time,
      duration: item.duration ?? existing?.duration,
      timestamp: Date.now(),
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, 50)));
    window.dispatchEvent(new Event('bofilm_history_update'));
  } catch (e) {
    console.error('Failed to save history', e);
  }
}

export function getHistory(): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

export function getContinueWatching(): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const history = getHistory();
    const result: HistoryItem[] = [];

    for (const item of history) {
      let time = item.time;
      let duration = item.duration;
      let episodeSlug = item.episodeSlug;
      let episodeName = item.episodeName;

      // 1. Check direct playback position lookup
      let pos =
        getPlaybackPosition(item.slug, episodeSlug || 'default') ||
        getPlaybackPosition(item.slug, 'default');

      // 2. Scan resume keys if not found directly
      if (!pos) {
        let latestTimestamp = 0;
        const prefix = `${RESUME_KEY_PREFIX}${item.slug}_`;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(prefix)) {
            try {
              const val = JSON.parse(localStorage.getItem(key) || '{}');
              if (
                val &&
                typeof val.time === 'number' &&
                val.time > 5 &&
                val.updatedAt &&
                val.updatedAt > latestTimestamp
              ) {
                latestTimestamp = val.updatedAt;
                pos = val;
                const epPart = key.slice(prefix.length);
                if (epPart && epPart !== 'default') {
                  episodeSlug = epPart;
                  if (!episodeName) {
                    const clean = epPart.replace(/^tap-/i, '');
                    episodeName = `Tập ${clean}`;
                  }
                }
              }
            } catch {}
          }
        }
      }

      if (pos) {
        time = pos.time;
        duration = pos.duration;
      }

      if (
        time !== undefined &&
        duration !== undefined &&
        time > 5 &&
        duration > 0 &&
        time < duration - 15 &&
        time / duration < 0.96
      ) {
        result.push({
          ...item,
          time,
          duration,
          episodeSlug,
          episodeName,
        });
      }
    }

    return result;
  } catch (e) {
    return [];
  }
}

export function removeHistoryItem(slug: string) {
  if (typeof window === 'undefined') return;
  try {
    const list = getHistory().filter((i) => i.slug !== slug);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    clearPlaybackPosition(slug);
    window.dispatchEvent(new Event('bofilm_history_update'));
  } catch (e) {
    console.error('Failed to remove history item', e);
  }
}

export function clearHistory() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(HISTORY_KEY);
  window.dispatchEvent(new Event('bofilm_history_update'));
}

export function getFavorites(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(FAVORITES_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

export function isFavorite(slug: string): boolean {
  return getFavorites().includes(slug);
}

export function toggleFavorite(slug: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const favs = getFavorites();
    let updated: string[];
    let isAdded = false;
    if (favs.includes(slug)) {
      updated = favs.filter((s) => s !== slug);
    } else {
      updated = [slug, ...favs];
      isAdded = true;
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
    return isAdded;
  } catch (e) {
    console.error('Failed to toggle favorite', e);
    return false;
  }
}

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

export function getImageUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') {
    return '/logo.png';
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return '/logo.png';
  }

  if (
    trimmed.startsWith('/api/proxy/image') ||
    trimmed.startsWith('/proxy/image') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }

  const targetUrl = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

  // TMDB or direct image urls work natively in modern browsers
  if (targetUrl.includes('image.tmdb.org') || targetUrl.includes('tmdb.org')) {
    return targetUrl;
  }

  if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
    return `/api/proxy/image?url=${encodeURIComponent(targetUrl)}`;
  }

  return targetUrl;
}

const RESUME_KEY_PREFIX = 'bofilm_resume_';

export function savePlaybackPosition(
  movieSlug: string,
  episodeSlug: string,
  time: number,
  duration: number
) {
  if (typeof window === 'undefined' || !movieSlug) return;
  try {
    const key = `${RESUME_KEY_PREFIX}${movieSlug}_${episodeSlug || 'default'}`;
    if (time > 5 && duration > 0 && time < duration - 15) {
      localStorage.setItem(
        key,
        JSON.stringify({
          time: Math.floor(time),
          duration: Math.floor(duration),
          updatedAt: Date.now(),
        })
      );
    } else if (duration > 0 && time >= duration - 15) {
      localStorage.removeItem(key);
    }

    const list = getHistory();
    const itemIndex = list.findIndex((i) => i.slug === movieSlug);
    if (itemIndex >= 0) {
      list[itemIndex].time = Math.floor(time);
      list[itemIndex].duration = Math.floor(duration);
      if (episodeSlug) {
        list[itemIndex].episodeSlug = episodeSlug;
      }
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('bofilm_history_update'));
    }
  } catch (e) {
    console.error('Failed to save playback position', e);
  }
}

export function getPlaybackPosition(
  movieSlug: string,
  episodeSlug: string
): { time: number; duration: number; updatedAt: number } | null {
  if (typeof window === 'undefined' || !movieSlug) return null;
  try {
    const key = `${RESUME_KEY_PREFIX}${movieSlug}_${episodeSlug || 'default'}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.time === 'number' && parsed.time > 5) {
      return parsed;
    }
  } catch (e) {
    return null;
  }
  return null;
}

export function clearPlaybackPosition(movieSlug: string, episodeSlug?: string) {
  if (typeof window === 'undefined' || !movieSlug) return;
  try {
    if (episodeSlug) {
      const key = `${RESUME_KEY_PREFIX}${movieSlug}_${episodeSlug}`;
      localStorage.removeItem(key);
    } else {
      const prefix = `${RESUME_KEY_PREFIX}${movieSlug}_`;
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keysToRemove.push(k);
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    }
  } catch (e) {}
}

export function clearAllPlaybackPositions() {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(RESUME_KEY_PREFIX)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch (e) {
    console.error('Failed to clear playback positions', e);
  }
}

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}
