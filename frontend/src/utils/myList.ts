/**
 * Utility: My List / Bookmark for Bơ Film
 * LocalStorage key: bofilm_my_list
 */

export interface MyListItem {
  slug: string;
  title_vi?: string;
  title_en?: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  quality?: string;
  score?: number;
  movie_type?: string;
  genres?: string[];
  total_episodes?: number;
  addedAt: number;
}

const STORAGE_KEY = 'bofilm_my_list';

/**
 * Get all movies saved in My List sorted by addedAt desc
 */
export function getMyList(): MyListItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: MyListItem[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  } catch (err) {
    console.error('Error reading My List from localStorage:', err);
    return [];
  }
}

/**
 * Check if a movie is in My List
 */
export function isInMyList(slug: string): boolean {
  if (!slug) return false;
  const list = getMyList();
  return list.some((item) => item.slug === slug);
}

/**
 * Toggle bookmark state for a movie
 * Returns true if added, false if removed
 */
export function toggleMyList(movie: {
  slug: string;
  title_vi?: string;
  title_en?: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  quality?: string;
  score?: number;
  movie_type?: string;
  genres?: string[];
  total_episodes?: number;
}): boolean {
  try {
    let list = getMyList();
    const exists = list.some((item) => item.slug === movie.slug);

    if (exists) {
      list = list.filter((item) => item.slug !== movie.slug);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('bofilm_mylist_updated'));
      return false;
    } else {
      const newItem: MyListItem = {
        ...movie,
        addedAt: Date.now(),
      };
      list.unshift(newItem);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('bofilm_mylist_updated'));
      return true;
    }
  } catch (err) {
    console.error('Error toggling My List:', err);
    return false;
  }
}

/**
 * Remove a movie from My List
 */
export function removeFromMyList(slug: string): void {
  try {
    let list = getMyList();
    list = list.filter((item) => item.slug !== slug);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('bofilm_mylist_updated'));
  } catch (err) {
    console.error('Error removing from My List:', err);
  }
}

/**
 * Clear all items in My List
 */
export function clearMyList(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('bofilm_mylist_updated'));
  } catch (err) {
    console.error('Error clearing My List:', err);
  }
}
