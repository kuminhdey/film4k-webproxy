// frontend/src/components/admin/adminTypes.tsx

export type ToastVariant = 'success' | 'warning' | 'error';

export interface ToastState {
  id: number;
  variant: ToastVariant;
  message: string;
}

export type AdminSortOption = 'latest' | 'year' | 'score' | 'name_asc';
export type AdminFilterType = 'all' | 'movie' | 'tv';

export interface AdminTablePersistedState {
  page: number;
  limit: number;
  q: string;
  type: AdminFilterType;
  sort: AdminSortOption;
}

export interface MovieCrudFormValues {
  slug: string;
  title_vi: string;
  title_en: string;
  movie_type: 'movie' | 'tv';
  year: string;
  quality: string;
  score: string;
  country: string;
  genresText: string;
  poster: string;
  backdrop: string;
  overview: string;
  total_episodes: string;
  stream: string;
}

export interface MovieCrudPayload {
  slug: string;
  title_vi: string;
  title_en: string;
  movie_type: 'movie' | 'tv';
  year: number | null;
  quality: string;
  score: number | null;
  country: string;
  genres: string[];
  poster: string;
  backdrop: string;
  overview: string;
  total_episodes: number | null;
  stream: string;
}

export interface ConfirmDialogState {
  title: string;
  subtitle?: string;
  description: string;
  confirmLabel: string;
  variant: 'primary' | 'danger';
  onConfirm: () => Promise<void> | void;
}

export const SLUG_PATTERN = /^[a-z0-9-]+$/;

const TABLE_STATE_STORAGE_KEY = 'bofilm_admin_table_state';
const VALID_SORTS: readonly AdminSortOption[] = ['latest', 'year', 'score', 'name_asc'];
const VALID_TYPES: readonly AdminFilterType[] = ['all', 'movie', 'tv'];
const VALID_PAGE_SIZES = [20, 25, 50, 100];

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function slugifyVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function isValidHttpOrRelativeUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function resolveAdminPosterSrc(poster?: string | null): string {
  if (!poster || typeof poster !== 'string') return '/logo-64.png';
  const trimmed = poster.trim();
  if (!trimmed || trimmed === '/placeholder.png') return '/logo-64.png';
  if (
    trimmed.startsWith('/api/proxy/image') ||
    trimmed.startsWith('/proxy/image') ||
    (trimmed.startsWith('/') && !trimmed.startsWith('//'))
  ) {
    return trimmed;
  }
  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '/logo-64.png';
    }
    if (parsed.hostname === 'image.tmdb.org' || parsed.hostname.endsWith('.tmdb.org')) {
      return parsed.toString();
    }
    return `/api/proxy/image?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return '/logo-64.png';
  }
}

export function readInitialTableState(): AdminTablePersistedState {
  const fallback: AdminTablePersistedState = {
    page: 1,
    limit: 25,
    q: '',
    type: 'all',
    sort: 'latest',
  };

  if (typeof window === 'undefined') return fallback;

  let stored: Partial<AdminTablePersistedState> = {};
  try {
    const raw = sessionStorage.getItem(TABLE_STATE_STORAGE_KEY);
    if (raw) {
      stored = JSON.parse(raw) as Partial<AdminTablePersistedState>;
    }
  } catch {
    // ignore malformed storage
  }

  const params = new URLSearchParams(window.location.search);
  const rawPage = Number(params.get('page') ?? stored.page ?? fallback.page);
  const rawLimit = Number(params.get('limit') ?? stored.limit ?? fallback.limit);
  const rawQ = params.get('q') ?? stored.q ?? fallback.q;
  const rawType = (params.get('type') ?? stored.type ?? fallback.type) as AdminFilterType;
  const rawSort = (params.get('sort') ?? stored.sort ?? fallback.sort) as AdminSortOption;

  return {
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1,
    limit: VALID_PAGE_SIZES.includes(rawLimit) ? rawLimit : 25,
    q: typeof rawQ === 'string' ? rawQ : '',
    type: VALID_TYPES.includes(rawType) ? rawType : 'all',
    sort: VALID_SORTS.includes(rawSort) ? rawSort : 'latest',
  };
}

export function persistTableState(state: AdminTablePersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(TABLE_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }

  if (window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')) {
    const params = new URLSearchParams();
    if (state.page > 1) params.set('page', String(state.page));
    if (state.limit !== 25) params.set('limit', String(state.limit));
    if (state.q.trim()) params.set('q', state.q.trim());
    if (state.type !== 'all') params.set('type', state.type);
    if (state.sort !== 'latest') params.set('sort', state.sort);

    const qs = params.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
  }
}
