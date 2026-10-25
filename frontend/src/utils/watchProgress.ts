/**
 * Utility: Watch Progress & Resume Playback for Bơ Film
 * LocalStorage key: bofilm_continue_watching
 */

export interface WatchProgressItem {
  slug: string;
  title: string;
  title_en?: string;
  poster?: string;
  backdrop?: string;
  episode?: number;
  currentTime: number;
  duration: number;
  movie_type?: string;
  updatedAt: number;
}

const STORAGE_KEY = 'bofilm_continue_watching';
const MAX_ITEMS = 20;

/**
 * Get all continue watching items sorted by updatedAt desc
 */
export function getWatchProgress(): WatchProgressItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: WatchProgressItem[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (err) {
    console.error('Error reading watch progress from localStorage:', err);
    return [];
  }
}

/**
 * Get watch progress for a specific movie (and optional episode)
 */
export function getMovieProgress(slug: string, episode?: number): WatchProgressItem | null {
  const list = getWatchProgress();
  return (
    list.find((item) => {
      if (item.slug !== slug) return false;
      if (episode !== undefined && item.episode !== undefined) {
        return item.episode === episode;
      }
      return true;
    }) || null
  );
}

/**
 * Save or update watch progress
 * - Ignores if currentTime < 10 (short test click)
 * - Removes if currentTime / duration > 0.95 (finished movie)
 * - Limits to 20 most recent items
 */
export function saveWatchProgress(item: {
  slug: string;
  title: string;
  title_en?: string;
  poster?: string;
  backdrop?: string;
  episode?: number;
  currentTime: number;
  duration: number;
  movie_type?: string;
}): void {
  try {
    const { slug, currentTime, duration } = item;

    // Do not save if user only watched less than 10 seconds
    if (currentTime < 10) {
      return;
    }

    let list = getWatchProgress();

    // If watched > 95% of duration, consider finished and remove from resume list
    if (duration > 0 && currentTime / duration >= 0.95) {
      list = list.filter((it) => !(it.slug === slug && (item.episode === undefined || it.episode === item.episode)));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('bofilm_progress_updated'));
      return;
    }

    // Remove existing item for this slug (and episode if applicable)
    list = list.filter((it) => !(it.slug === slug && (item.episode === undefined || it.episode === item.episode)));

    const newItem: WatchProgressItem = {
      ...item,
      updatedAt: Date.now(),
    };

    // Prepend to top and slice to MAX_ITEMS
    list.unshift(newItem);
    if (list.length > MAX_ITEMS) {
      list = list.slice(0, MAX_ITEMS);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('bofilm_progress_updated'));
  } catch (err) {
    console.error('Error saving watch progress:', err);
  }
}

/**
 * Remove an item from continue watching
 */
export function removeWatchProgress(slug: string, episode?: number): void {
  try {
    let list = getWatchProgress();
    list = list.filter((it) => {
      if (it.slug !== slug) return true;
      if (episode !== undefined && it.episode !== undefined) {
        return it.episode !== episode;
      }
      return false;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('bofilm_progress_updated'));
  } catch (err) {
    console.error('Error removing watch progress:', err);
  }
}

/**
 * Clear all continue watching history
 */
export function clearAllWatchProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('bofilm_progress_updated'));
  } catch (err) {
    console.error('Error clearing watch progress:', err);
  }
}
