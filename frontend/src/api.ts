import {
  FilmListResponse,
  HomeResponse,
  MovieDetail,
  MovieItem,
  SearchSuggestion,
  CategoryGroup,
  EpisodeServer,
  EpisodeItem,
} from './types';

const API_BASE = '/api';

// ===== PERF-03: Client-side In-Memory Cache (TTL: 60s) =====
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry<any>>();
const DEFAULT_TTL_MS = 60_000; // 60s TTL

export function clearApiCache(): void {
  memoryCache.clear();
}

export function invalidateCacheKey(keyPrefix: string): void {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(keyPrefix)) {
      memoryCache.delete(key);
    }
  }
}

async function fetchWithCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T | null>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T | null> {
  const cached = memoryCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < ttlMs) {
    return cached.data as T;
  }

  const fresh = await fetcher();
  if (fresh !== null) {
    memoryCache.set(cacheKey, { data: fresh, timestamp: now });
  }
  return fresh;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      console.warn(`Request to ${url} failed with status ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return null;
    }
    console.error(`Fetch error for ${url}:`, err);
    return null;
  }
}

/**
 * Adapter converting raw movie summary or item to standard Bơ Film MovieItem
 */
export function summaryToMovieItem(raw: any): MovieItem {
  if (!raw) {
    return {
      name: '',
      original_name: '',
      slug: '',
      year: '',
      description: '',
      total_episodes: 1,
      current_episode: 'Full',
      time: '',
      quality: 'HD',
      language: 'Vietsub',
      thumb_url: '',
      poster_url: '',
    };
  }

  const name = raw.name || raw.title_vi || raw.title_en || raw.slug || '';
  const original_name = raw.original_name || raw.title_en || raw.title_vi || '';
  const slug = raw.slug || '';
  const year = raw.year || '';
  const description = raw.description || raw.overview || '';
  const total_episodes = raw.total_episodes ?? raw.totalEpisodes ?? 1;
  const isSeries =
    raw.movie_type === 'tv' ||
    raw.type === 'tv' ||
    (typeof total_episodes === 'number' && total_episodes > 1);
  const current_episode =
    raw.current_episode || (isSeries ? `Tập ${total_episodes}` : 'Full');
  const time = raw.time || (isSeries ? '45 phút/tập' : '120 phút');
  const quality = raw.quality || 'HD';
  const language = raw.language || 'Vietsub';
  const director = raw.director || '';
  const casts = raw.casts || '';
  const thumb_url =
    raw.thumb_url || raw.backdrop || raw.poster_url || raw.poster || '';
  const poster_url =
    raw.poster_url || raw.poster || raw.thumb_url || raw.backdrop || '';

  return {
    name,
    original_name,
    slug,
    year,
    description,
    total_episodes,
    current_episode,
    time,
    quality,
    language,
    director,
    casts,
    thumb_url,
    poster_url,
    created: raw.created,
    modified: raw.modified,
  };
}

/**
 * Adapter converting raw movie details (webproxy SQLite models or bofilm) to Bơ Film MovieDetail
 */
export function movieDetailAdapter(raw: any): MovieDetail {
  if (!raw) throw new Error('Invalid movie detail response');

  // If already standard Bơ Film MovieDetail with server_name in episodes
  if (
    raw.episodes &&
    Array.isArray(raw.episodes) &&
    raw.episodes.length > 0 &&
    raw.episodes[0].server_name &&
    raw.category
  ) {
    return raw as MovieDetail;
  }

  const name = raw.name || raw.title_vi || raw.title_en || raw.slug || '';
  const original_name = raw.original_name || raw.title_en || raw.title_vi || '';
  const slug = raw.slug || '';
  const year = raw.year || '';
  const description = raw.description || raw.overview || '';
  const total_episodes =
    raw.total_episodes ?? raw.totalEpisodes ?? (raw.episodes?.length || 1);
  const isSeries =
    raw.movie_type === 'tv' ||
    raw.type === 'tv' ||
    (typeof total_episodes === 'number' && total_episodes > 1);
  const current_episode =
    raw.current_episode || (isSeries ? `Tập ${total_episodes}` : 'Full');
  const time = raw.time || (isSeries ? '45 phút/tập' : '120 phút');
  const quality = raw.quality || 'HD';
  const language = raw.language || 'Vietsub';
  const director = raw.director || '';
  const casts = raw.casts || '';
  const thumb_url =
    raw.thumb_url || raw.backdrop || raw.poster_url || raw.poster || '';
  const poster_url =
    raw.poster_url || raw.poster || raw.thumb_url || raw.backdrop || '';

  // Category mapping
  const genres: string[] = Array.isArray(raw.genres) ? raw.genres : [];
  const country = raw.country || '';
  const category: Record<string, CategoryGroup> = {
    the_loai: {
      group: { id: 'the-loai', name: 'Thể loại' },
      list: genres.map((g) => ({
        id: g.toLowerCase().replace(/\s+/g, '-'),
        name: g,
      })),
    },
  };
  if (country) {
    category.quoc_gia = {
      group: { id: 'quoc-gia', name: 'Quốc gia' },
      list: [
        {
          id: country.toLowerCase().replace(/\s+/g, '-'),
          name: country,
        },
      ],
    };
  }

  // Parse episode servers
  let episodeServers: EpisodeServer[] = [];

  if (Array.isArray(raw.episodes) && raw.episodes.length > 0) {
    // If it's already an array of servers
    if (raw.episodes[0].server_name && Array.isArray(raw.episodes[0].items)) {
      episodeServers = [raw.episodes[0]];
    } else {
      const defaultServerItems: EpisodeItem[] = [];

      raw.episodes.forEach((ep: any) => {
        const epNum = ep.episode || 1;
        const epTitle = ep.title || `Tập ${epNum}`;
        const epSlug = `tap-${epNum}`;
        const primaryServer = ep.servers?.[0] || ep.sources?.[0];
        const m3u8Url =
          epNum > 1
            ? `/api/stream/${encodeURIComponent(slug)}/ep/${epNum}/master.m3u8`
            : `/api/stream/${encodeURIComponent(slug)}/master.m3u8`;
        const embedUrl =
          primaryServer?.embed ||
          (ep.embed && !ep.embed.includes('.m3u8') ? ep.embed : '');

        defaultServerItems.push({
          name: epTitle,
          slug: epSlug,
          embed: embedUrl,
          m3u8: m3u8Url,
          subtitles: ep.subtitles || raw.subtitles || [],
          audio_tracks:
            ep.audio_tracks ||
            ep.audioTracks ||
            raw.audio_tracks ||
            raw.audioTracks ||
            [],
        });
      });

      episodeServers.push({
        server_name: 'Server VIP #1',
        items: defaultServerItems,
      });
    }
  } else {
    // Single movie without episode list
    const serversList =
      Array.isArray(raw.servers) && raw.servers.length > 0 ? [raw.servers[0]] : [null];

    episodeServers = serversList.map((srv: any, idx: number) => {
      const srvName = srv?.label || srv?.name || `Server VIP #${idx + 1}`;
      const streamUrl = `/api/stream/${encodeURIComponent(slug)}/master.m3u8${
        idx > 0 ? `?server=${idx}` : ''
      }`;
      const embedUrl =
        srv?.embed && !srv.embed.includes('.m3u8') ? srv.embed : '';

      return {
        server_name: srvName,
        items: [
          {
            name: 'Full',
            slug: 'full',
            embed: embedUrl,
            m3u8: streamUrl,
            subtitles: raw.subtitles || [],
            audio_tracks: raw.audio_tracks || raw.audioTracks || [],
          },
        ],
      };
    });
  }

  return {
    id: raw.id || slug,
    name,
    original_name,
    slug,
    year,
    description,
    total_episodes,
    current_episode,
    time,
    quality,
    language,
    director,
    casts,
    category,
    thumb_url,
    poster_url,
    episodes: episodeServers,
    subtitles: raw.subtitles,
    audio_tracks: raw.audio_tracks || raw.audioTracks,
  };
}

// PERF-03: Cache getHome() for 60s for instant navigation
export async function getHome(bypassCache = false): Promise<HomeResponse | null> {
  const fetcher = async () => {
    const raw = await fetchJson<any>(`${API_BASE}/home`);
    if (!raw) return null;

    if (raw.hero_banners) {
      return raw as HomeResponse;
    }

    const heroList = (raw.hero || []).map(summaryToMovieItem);
    const topList = (raw.top || []).map(summaryToMovieItem);
    const seriesList = (raw.new_series || []).map(summaryToMovieItem);
    const moviesList = (raw.new_movies || []).map(summaryToMovieItem);
    const allList = (raw.list || []).map(summaryToMovieItem);

    const heroBanners = heroList.length > 0 ? heroList : topList.slice(0, 5);
    const latest = topList.length > 0 ? topList : allList.slice(0, 12);
    const series =
      seriesList.length > 0
        ? seriesList
        : allList
            .filter((m: any) => m.movie_type === 'tv' || m.type === 'tv')
            .slice(0, 12);
    const single =
      moviesList.length > 0
        ? moviesList
        : allList
            .filter(
              (m: any) =>
                m.movie_type === 'movie' ||
                m.type === 'movie' ||
                !m.movie_type
            )
            .slice(0, 12);
    const tvShows = series.slice(0, 12);
    const anime = allList
      .filter((m: any) =>
        m.genres?.some(
          (g: string) =>
            g.toLowerCase().includes('hoạt hình') ||
            g.toLowerCase().includes('anime')
        )
      )
      .slice(0, 12);

    return {
      hero_banners: heroBanners,
      latest,
      series,
      single,
      tv_shows: tvShows,
      anime: anime.length > 0 ? anime : single.slice(0, 12),
    };
  };

  if (bypassCache) {
    return fetcher();
  }
  return fetchWithCache<HomeResponse>('api_home', fetcher);
}

// PERF-03: Cache catalog queries for 60s
export async function getMovies(params: {
  page?: number;
  limit?: number;
  category?: string;
  genre?: string;
  country?: string;
  year?: string;
  sort?: string;
  keyword?: string;
}): Promise<FilmListResponse | null> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page.toString());
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.category) {
    if (params.category === 'phim-bo') {
      query.set('type', 'tv');
    } else if (params.category === 'phim-le') {
      query.set('type', 'movie');
    } else if (params.category === 'hoat-hinh') {
      query.set('genre', 'Hoạt Hình');
    } else {
      query.set('category', params.category);
    }
  }
  if (params.genre) query.set('genre', params.genre);
  if (params.country) query.set('country', params.country);
  if (params.year) query.set('year', params.year);
  if (params.sort) query.set('sort', params.sort);
  if (params.keyword) {
    query.set('search', params.keyword);
  }

  const queryString = query.toString();
  const url = `${API_BASE}/movies?${queryString}`;

  const fetcher = async () => {
    const raw = await fetchJson<any>(url);
    if (!raw) return null;

    if (raw.items && raw.paginate) {
      return raw as FilmListResponse;
    }

    const rawMovies = raw.movies || raw.items || [];
    const items = rawMovies.map(summaryToMovieItem);
    const total = raw.total ?? items.length;
    const limit = raw.limit ?? params.limit ?? 24;
    const offset = raw.offset ?? 0;
    const currentPage = params.page ?? Math.floor(offset / limit) + 1;
    const totalPage = Math.ceil(total / limit) || 1;

    return {
      status: 'success',
      paginate: {
        current_page: currentPage,
        total_page: totalPage,
        total_items: total,
        items_per_page: limit,
      },
      items,
    };
  };

  if (params.keyword) {
    return fetcher();
  }
  return fetchWithCache<FilmListResponse>(`api_movies_${queryString}`, fetcher);
}

// PERF-03: Cache getMovieDetail() per slug for 60s
export async function getMovieDetail(
  slug: string,
  bypassCache = false
): Promise<MovieDetail | null> {
  const url = `${API_BASE}/movies/${encodeURIComponent(slug)}`;
  const fetcher = async () => {
    const raw = await fetchJson<any>(url);
    if (!raw) return null;
    return movieDetailAdapter(raw.movie || raw);
  };

  if (bypassCache) {
    return fetcher();
  }
  return fetchWithCache<MovieDetail>(`api_detail_${slug}`, fetcher);
}

export async function getMoviesBySlugs(slugs: string[]): Promise<MovieItem[]> {
  if (slugs.length === 0) return [];
  const res = await fetchJson<any>(
    `${API_BASE}/movies/by-slugs?slugs=${encodeURIComponent(slugs.join(','))}`
  );
  if (!res) return [];
  const rawList = Array.isArray(res) ? res : res.movies || [];
  return rawList.map(summaryToMovieItem);
}

export async function getSearchSuggestions(
  query: string,
  signal?: AbortSignal
): Promise<SearchSuggestion[]> {
  if (!query.trim()) return [];
  const res = await fetchJson<any>(
    `${API_BASE}/search/suggest?q=${encodeURIComponent(query.trim())}`,
    signal ? { signal } : undefined
  );
  if (!res) return [];
  const rawList = Array.isArray(res) ? res : res.results || [];
  return rawList.map((item: any) => ({
    slug: item.slug,
    name: item.title_vi || item.name || item.title_en || item.slug,
    original_name: item.title_en || item.original_name || '',
    year: item.year ? item.year.toString() : undefined,
    quality: item.quality,
    current_episode:
      item.movie_type === 'tv'
        ? `Tập ${item.total_episodes || ''}`
        : 'Full',
    thumb_url: item.backdrop || item.poster || item.thumb_url || '',
  }));
}

export async function getRelatedMovies(
  slug: string,
  genreHint?: string
): Promise<MovieItem[]> {
  const result = await fetchWithCache<MovieItem[]>(
    `api_related_${slug}`,
    async () => {
      let res = await fetchJson<any>(
        `${API_BASE}/movies/${encodeURIComponent(slug)}/related`
      );
      if (!res) {
        res = await fetchJson<any>(
          `${API_BASE}/movies/${encodeURIComponent(slug)}/recommendations`
        );
      }
      if (res) {
        const rawList = Array.isArray(res)
          ? res
          : res.recommendations || res.movies || [];
        if (rawList.length > 0) {
          return rawList.map(summaryToMovieItem);
        }
      }
      if (genreHint) {
        const genreRes = await getMovies({ genre: genreHint, limit: 12 });
        if (genreRes && genreRes.items && genreRes.items.length > 0) {
          return genreRes.items.filter((m) => m.slug !== slug);
        }
      }
      return [];
    }
  );
  return result || [];
}
