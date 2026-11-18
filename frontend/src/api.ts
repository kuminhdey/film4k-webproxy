import {
  FilmListResponse,
  HomeResponse,
  MovieDetail,
  MovieItem,
  SearchSuggestion,
  CategoryGroup,
  EpisodeServer,
  EpisodeItem,
  SubtitleTrack,
  AudioTrack,
  ServerSource,
} from './types';

const API_BASE = '/api';

// ===== PERF-03: Bounded LRU Client-side In-Memory Cache (TTL: 60s, max 200 entries) =====
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const MAX_CACHE_ENTRIES = 200;
const memoryCache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 60_000;

const LEGACY_PROXY_HOSTS = new Set([
  'secret.dangducminh.io.vn',
  'secret1.dangducminh.io.vn',
]);

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

function setBoundedCache<T>(key: string, data: T, timestamp: number): void {
  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  } else if (memoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey !== undefined) {
      memoryCache.delete(oldestKey);
    }
  }
  memoryCache.set(key, { data, timestamp });
}

async function fetchWithCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T | null>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T | null> {
  const cached = memoryCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < ttlMs) {
    // Refresh LRU position
    memoryCache.delete(cacheKey);
    memoryCache.set(cacheKey, cached);
    return cached.data as T;
  }

  if (cached) {
    memoryCache.delete(cacheKey);
  }

  const fresh = await fetcher();
  if (fresh !== null) {
    setBoundedCache(cacheKey, fresh, now);
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
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return null;
    }
    console.error(`Fetch error for ${url}:`, err);
    return null;
  }
}

/**
 * Unwraps hardcoded legacy proxy domains (`https://secret.dangducminh.io.vn/?url=...`)
 * into local relative `/api/stream/...` or local `/?url=...` paths so playback always
 * routes through the active backend (which auto-refreshes expired `fiml4k.fun` tokens).
 */
export function normalizeStreamUrl(
  rawUrl: string | undefined | null,
  slug?: string,
  options?: {
    epNum?: number;
    isSeries?: boolean;
    season?: number;
    hasMultipleSeasons?: boolean;
    serverIndex?: number;
  }
): string {
  const buildLocal = (): string => {
    if (!slug) return '';
    const epNum = options?.epNum ?? 1;
    const season = options?.season;
    const hasSeasonQuery = Boolean(
      options?.hasMultipleSeasons || (season !== undefined && season > 1)
    );
    const isMultiEp = (Boolean(options?.isSeries) && epNum > 1) || hasSeasonQuery;
    const basePath = isMultiEp
      ? `/api/stream/${encodeURIComponent(slug)}/ep/${epNum}/master.m3u8`
      : `/api/stream/${encodeURIComponent(slug)}/master.m3u8`;
    const params = new URLSearchParams();
    if (hasSeasonQuery && season !== undefined) {
      params.set('season', String(season));
    }
    if (options?.serverIndex !== undefined && options.serverIndex > 0) {
      params.set('server', String(options.serverIndex));
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return buildLocal();
  }

  let trimmed = rawUrl.trim();

  // Already a local stream endpoint
  if (trimmed.startsWith('/api/stream/') || trimmed.startsWith('/stream/')) {
    if (options?.serverIndex !== undefined && options.serverIndex > 0 && !trimmed.includes('server=')) {
      const sep = trimmed.includes('?') ? '&' : '?';
      return `${trimmed}${sep}server=${options.serverIndex}`;
    }
    return trimmed;
  }

  // Local proxy query `/?url=...` or `/api/proxy/stream?url=...`
  if (trimmed.startsWith('/?url=') || trimmed.startsWith('/api/proxy/stream')) {
    return slug ? buildLocal() : trimmed;
  }

  if (trimmed.startsWith('//')) {
    trimmed = `https:${trimmed}`;
  }

  try {
    let parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return buildLocal();
    }

    // Unwrap legacy `secret.dangducminh.io.vn` / `secret1.dangducminh.io.vn` wrappers
    let guard = 0;
    while (LEGACY_PROXY_HOSTS.has(parsed.hostname.toLowerCase()) && guard < 3) {
      guard += 1;
      if (parsed.pathname.startsWith('/api/stream/')) {
        let localPath = `${parsed.pathname}${parsed.search}`;
        if (
          options?.serverIndex !== undefined &&
          options.serverIndex > 0 &&
          !localPath.includes('server=')
        ) {
          const sep = localPath.includes('?') ? '&' : '?';
          localPath = `${localPath}${sep}server=${options.serverIndex}`;
        }
        return localPath;
      }
      const inner = parsed.searchParams.get('url');
      if (inner) {
        parsed = new URL(inner);
      } else {
        return buildLocal();
      }
    }

    // Route any upstream film4k / external HLS URL through local `/api/stream/:slug/...` when slug is known
    if (slug) {
      return buildLocal();
    }

    return `/?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return buildLocal();
  }
}

function sanitizeAdapterEmbedUrl(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('.m3u8')) return '';

  try {
    let parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    if (LEGACY_PROXY_HOSTS.has(parsed.hostname.toLowerCase())) {
      const inner = parsed.searchParams.get('url');
      if (!inner) return '';
      parsed = new URL(inner);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return '';
      }
    }
    if (parsed.pathname.toLowerCase().endsWith('.m3u8') || parsed.toString().includes('.m3u8')) {
      return '';
    }
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

interface RawMovieRecord {
  id?: string | number;
  slug?: string;
  name?: string;
  original_name?: string;
  title_vi?: string;
  title_en?: string;
  year?: string | number;
  description?: string;
  overview?: string;
  total_episodes?: number | string;
  totalEpisodes?: number | string;
  movie_type?: string;
  type?: string;
  current_episode?: string;
  time?: string;
  quality?: string;
  language?: string;
  director?: string;
  casts?: string;
  thumb_url?: string;
  poster_url?: string;
  poster?: string;
  backdrop?: string;
  genres?: string[];
  country?: string;
  created?: string;
  modified?: string;
  category?: Record<string, CategoryGroup>;
  episodes?: RawEpisodeOrServer[];
  servers?: ServerSource[];
  subtitles?: SubtitleTrack[];
  audio_tracks?: AudioTrack[];
  audioTracks?: AudioTrack[];
  movie?: RawMovieRecord;
}

interface RawEpisodeOrServer {
  server_name?: string;
  items?: EpisodeItem[];
  episode?: number;
  season?: number;
  title?: string;
  embed?: string;
  servers?: ServerSource[];
  sources?: ServerSource[];
  subtitles?: SubtitleTrack[];
  audio_tracks?: AudioTrack[];
  audioTracks?: AudioTrack[];
}

/**
 * Adapter converting raw movie summary or item to standard Bơ Film MovieItem
 */
export function summaryToMovieItem(raw: RawMovieRecord | null | undefined): MovieItem {
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
  const movie_type = raw.movie_type || raw.type || (isSeries ? 'tv' : 'movie');
  const genres = Array.isArray(raw.genres) ? raw.genres : undefined;

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
    movie_type,
    genres,
    created: raw.created,
    modified: raw.modified,
  };
}

/**
 * Adapter converting raw movie details (webproxy SQLite models or bofilm) to Bơ Film MovieDetail
 */
export function movieDetailAdapter(raw: RawMovieRecord | null | undefined): MovieDetail {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid movie detail response');
  }

  const slug = raw.slug || '';
  if (!slug && !raw.name && !raw.title_vi && !raw.title_en) {
    throw new Error('Empty movie detail payload');
  }

  const name = raw.name || raw.title_vi || raw.title_en || slug || '';
  const original_name = raw.original_name || raw.title_en || raw.title_vi || '';
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
  let category: Record<string, CategoryGroup>;
  if (raw.category && typeof raw.category === 'object') {
    category = raw.category;
  } else {
    const genres: string[] = Array.isArray(raw.genres) ? raw.genres : [];
    const country = raw.country || '';
    category = {
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
  }

  // Parse episode servers (preserving ALL servers for multi-server failover!)
  let episodeServers: EpisodeServer[] = [];

  if (Array.isArray(raw.episodes) && raw.episodes.length > 0) {
    if (raw.episodes[0].server_name && Array.isArray(raw.episodes[0].items)) {
      // Preserve ALL configured server groups and normalize legacy URLs
      episodeServers = raw.episodes.map((srvGroup, srvIdx) => {
        const items = (srvGroup.items || []).map((item, itemIdx) => {
          const epNum = item.globalIndex || item.episode || itemIdx + 1;
          const normalizedM3u8 = normalizeStreamUrl(item.m3u8, slug, {
            epNum,
            isSeries: isSeries || (srvGroup.items?.length ?? 0) > 1,
            season: item.season,
            serverIndex: srvIdx,
          });
          return {
            ...item,
            m3u8: normalizedM3u8,
            embed: sanitizeAdapterEmbedUrl(item.embed),
          };
        });
        return {
          server_name: srvGroup.server_name || `Server VIP #${srvIdx + 1}`,
          items,
        };
      });
    } else {
      const seenEpisodeNums = new Set<number>();
      let hasDuplicateEpNums = false;
      for (const ep of raw.episodes) {
        const num = Number(ep.episode || 1);
        if (seenEpisodeNums.has(num)) {
          hasDuplicateEpNums = true;
          break;
        }
        seenEpisodeNums.add(num);
      }
      const hasMultipleSeasons =
        raw.episodes.some((ep) => (ep.season ?? 1) > 1) || hasDuplicateEpNums;

      const rawMovieServers = Array.isArray(raw.servers) ? raw.servers : [];
      let maxServers = Math.max(1, rawMovieServers.length);
      for (const ep of raw.episodes) {
        const epSrvLen = Array.isArray(ep.servers) ? ep.servers.length : 0;
        const epSrcLen = Array.isArray(ep.sources) ? ep.sources.length : 0;
        if (epSrvLen > maxServers) maxServers = epSrvLen;
        if (epSrcLen > maxServers) maxServers = epSrcLen;
      }

      for (let srvIdx = 0; srvIdx < maxServers; srvIdx++) {
        let serverLabel =
          rawMovieServers[srvIdx]?.label || rawMovieServers[srvIdx]?.name || '';
        const serverItems: EpisodeItem[] = [];

        raw.episodes.forEach((ep, idx) => {
          const epNum = ep.episode || 1;
          const seasonNum = ep.season || 1;
          const globalIndex = idx + 1;
          const epTitle = ep.title || `Tập ${epNum}`;
          const epSlug = hasMultipleSeasons ? `tap-${globalIndex}` : `tap-${epNum}`;

          const epServersArr =
            Array.isArray(ep.servers) && ep.servers.length > 0
              ? ep.servers
              : Array.isArray(ep.sources)
              ? ep.sources
              : [];
          const selectedSrv =
            epServersArr[srvIdx] || (srvIdx === 0 ? epServersArr[0] : undefined);

          if (!serverLabel && (selectedSrv?.label || selectedSrv?.name)) {
            serverLabel = selectedSrv.label || selectedSrv.name || '';
          }

          const targetStreamEp = hasMultipleSeasons ? globalIndex : epNum;
          const m3u8Url = normalizeStreamUrl(
            selectedSrv?.proxyStreamUrl || selectedSrv?.hlsUrl || selectedSrv?.url,
            slug,
            {
              epNum: targetStreamEp,
              isSeries: true,
              season: seasonNum,
              hasMultipleSeasons,
              serverIndex: srvIdx,
            }
          );

          const rawEmbed =
            selectedSrv?.embed ||
            (srvIdx === 0 && ep.embed && !ep.embed.includes('.m3u8') ? ep.embed : '');
          const embedUrl = sanitizeAdapterEmbedUrl(rawEmbed);

          serverItems.push({
            name: epTitle,
            slug: epSlug,
            embed: embedUrl,
            m3u8: m3u8Url,
            season: seasonNum,
            episode: epNum,
            globalIndex,
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
          server_name: serverLabel || `Server VIP #${srvIdx + 1}`,
          items: serverItems,
        });
      }
    }
  } else {
    // Single movie without episode list: preserve ALL servers in `raw.servers`
    const serversList: (ServerSource | null)[] =
      Array.isArray(raw.servers) && raw.servers.length > 0 ? raw.servers : [null];

    episodeServers = serversList.map((srv, idx) => {
      const srvName = srv?.label || srv?.name || `Server VIP #${idx + 1}`;
      const streamUrl = normalizeStreamUrl(
        srv?.proxyStreamUrl || srv?.hlsUrl || srv?.url,
        slug,
        {
          epNum: 1,
          isSeries: false,
          serverIndex: idx,
        }
      );
      const embedUrl = sanitizeAdapterEmbedUrl(srv?.embed);

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

interface RawHomePayload {
  hero_banners?: MovieItem[];
  hero?: RawMovieRecord[];
  top?: RawMovieRecord[];
  new_series?: RawMovieRecord[];
  new_movies?: RawMovieRecord[];
  tv_shows?: RawMovieRecord[];
  anime?: RawMovieRecord[];
  list?: RawMovieRecord[];
}

function isAnimeGenre(genres?: string[]): boolean {
  if (!Array.isArray(genres)) return false;
  return genres.some((g) => /hoạt hình|hoat hinh|anime|animation/i.test(g));
}

function isTvShowGenre(genres?: string[], movieType?: string): boolean {
  if (movieType === 'tv_show' || movieType === 'tv-shows') return true;
  if (!Array.isArray(genres)) return false;
  return genres.some((g) =>
    /tv\s*show|gameshow|game\s*show|reality|truyền hình thực tế|talk\s*show/i.test(g)
  );
}

// PERF-03: Cache getHome() for 60s for instant navigation
export async function getHome(bypassCache = false): Promise<HomeResponse | null> {
  const fetcher = async (): Promise<HomeResponse | null> => {
    const raw = await fetchJson<RawHomePayload>(`${API_BASE}/home`);
    if (!raw) return null;

    if (raw.hero_banners) {
      return raw as unknown as HomeResponse;
    }

    const rawHero = raw.hero || [];
    const rawTop = raw.top || [];
    const rawSeries = raw.new_series || [];
    const rawMovies = raw.new_movies || [];
    const rawAll = raw.list || [];

    // Deduplicated pool of all raw movie records from `/api/home` BEFORE field stripping (`HIGH-08`)
    const uniqueRawBySlug = new Map<string, RawMovieRecord>();
    for (const group of [rawAll, rawTop, rawSeries, rawMovies, rawHero]) {
      for (const item of group) {
        if (item?.slug && !uniqueRawBySlug.has(item.slug)) {
          uniqueRawBySlug.set(item.slug, item);
        }
      }
    }
    const combinedRaw = Array.from(uniqueRawBySlug.values());

    const heroList = rawHero.map(summaryToMovieItem);
    const topList = rawTop.map(summaryToMovieItem);
    const allList = rawAll.map(summaryToMovieItem);

    const heroBanners = heroList.length > 0 ? heroList : topList.slice(0, 5);
    const latest = topList.length > 0 ? topList : allList.slice(0, 12);

    const series =
      rawSeries.length > 0
        ? rawSeries.map(summaryToMovieItem)
        : combinedRaw
            .filter((m) => (m.movie_type === 'tv' || m.type === 'tv') && !isAnimeGenre(m.genres))
            .slice(0, 12)
            .map(summaryToMovieItem);

    const single =
      rawMovies.length > 0
        ? rawMovies.map(summaryToMovieItem)
        : combinedRaw
            .filter(
              (m) =>
                (m.movie_type === 'movie' || m.type === 'movie' || (!m.movie_type && !m.type)) &&
                !isAnimeGenre(m.genres)
            )
            .slice(0, 12)
            .map(summaryToMovieItem);

    let animeItems: MovieItem[] = Array.isArray(raw.anime)
      ? raw.anime.map(summaryToMovieItem)
      : combinedRaw
          .filter((m) => isAnimeGenre(m.genres))
          .slice(0, 12)
          .map(summaryToMovieItem);

    // If `/api/home` window did not include anime rows, query `/api/movies?genre=Hoạt Hình` once;
    // never clone `single` when empty (`HIGH-08`)!
    if (animeItems.length === 0) {
      const animeRes = await getMovies({ category: 'hoat-hinh', limit: 12 });
      if (animeRes?.items && animeRes.items.length > 0) {
        animeItems = animeRes.items.slice(0, 12);
      }
    }

    const tvShows: MovieItem[] = Array.isArray(raw.tv_shows)
      ? raw.tv_shows.map(summaryToMovieItem)
      : combinedRaw
          .filter((m) => isTvShowGenre(m.genres, m.movie_type || m.type))
          .slice(0, 12)
          .map(summaryToMovieItem);

    return {
      hero_banners: heroBanners,
      latest,
      series,
      single,
      tv_shows: tvShows,
      anime: animeItems,
    };
  };

  if (bypassCache) {
    return fetcher();
  }
  return fetchWithCache<HomeResponse>('api_home', fetcher);
}

function normalizeCatalogSort(sort?: string): string {
  if (!sort || sort === 'latest') return 'latest';
  if (sort === 'year_desc' || sort === 'year') return 'year';
  if (sort === 'score') return 'score';
  if (sort === 'views') return 'views';
  if (sort === 'name_asc') return 'name_asc';
  return 'latest';
}

interface RawMoviesPayload {
  movies?: RawMovieRecord[];
  items?: RawMovieRecord[];
  total?: number;
  limit?: number;
  offset?: number;
  paginate?: FilmListResponse['paginate'];
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
  query.set('sort', normalizeCatalogSort(params.sort));
  if (params.keyword) {
    query.set('search', params.keyword);
  }

  const queryString = query.toString();
  const url = `${API_BASE}/movies?${queryString}`;

  const fetcher = async (): Promise<FilmListResponse | null> => {
    const raw = await fetchJson<RawMoviesPayload>(url);
    if (!raw) return null;

    if (raw.items && raw.paginate) {
      return {
        status: 'success',
        paginate: raw.paginate,
        items: raw.items.map(summaryToMovieItem),
      };
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
  const fetcher = async (): Promise<MovieDetail | null> => {
    const raw = await fetchJson<RawMovieRecord>(url);
    if (!raw) return null;
    try {
      return movieDetailAdapter(raw.movie || raw);
    } catch (err) {
      console.error(`Failed to adapt movie detail for ${slug}:`, err);
      return null;
    }
  };

  if (bypassCache) {
    return fetcher();
  }
  return fetchWithCache<MovieDetail>(`api_detail_${slug}`, fetcher);
}

export async function getMoviesBySlugs(slugs: string[]): Promise<MovieItem[]> {
  if (slugs.length === 0) return [];
  const res = await fetchJson<RawMovieRecord[] | { movies?: RawMovieRecord[] }>(
    `${API_BASE}/movies/by-slugs?slugs=${encodeURIComponent(slugs.join(','))}`
  );
  if (!res) return [];
  const rawList = Array.isArray(res) ? res : res.movies || [];
  return rawList.map(summaryToMovieItem);
}

interface RawSuggestPayload {
  results?: RawMovieRecord[];
}

export async function getSearchSuggestions(
  query: string,
  signal?: AbortSignal
): Promise<SearchSuggestion[]> {
  if (!query.trim()) return [];
  const res = await fetchJson<RawMovieRecord[] | RawSuggestPayload>(
    `${API_BASE}/search/suggest?q=${encodeURIComponent(query.trim())}`,
    signal ? { signal } : undefined
  );
  if (!res) return [];
  const rawList = Array.isArray(res) ? res : res.results || [];
  return rawList.map((item) => ({
    slug: item.slug || '',
    name: item.title_vi || item.name || item.title_en || item.slug || '',
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

interface RawRecommendationsPayload {
  recommendations?: RawMovieRecord[];
  movies?: RawMovieRecord[];
}

export async function getRelatedMovies(
  slug: string,
  genreHint?: string
): Promise<MovieItem[]> {
  const result = await fetchWithCache<MovieItem[]>(
    `api_related_${slug}`,
    async () => {
      let res = await fetchJson<RawMovieRecord[] | RawRecommendationsPayload>(
        `${API_BASE}/movies/${encodeURIComponent(slug)}/related`
      );
      if (!res) {
        res = await fetchJson<RawMovieRecord[] | RawRecommendationsPayload>(
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
