export interface MovieItem {
  name: string;
  original_name: string;
  slug: string;
  year: string | number;
  description: string;
  total_episodes: number | string;
  current_episode: string;
  time: string;
  quality: string;
  language: string;
  director?: string;
  casts?: string;
  thumb_url: string;
  poster_url: string;
  created?: string;
  modified?: string;
}

export interface Paginate {
  current_page: number;
  total_page: number;
  total_items: number;
  items_per_page: number;
}

export interface SubtitleTrack {
  id?: number | string;
  label?: string;
  name?: string;
  lang?: string;
  language?: string;
  url?: string;
  file?: string;
  src?: string;
  kind?: string;
  default?: boolean;
  isDefault?: boolean;
}

export interface AudioTrack {
  id?: number | string;
  name?: string;
  label?: string;
  lang?: string;
  url?: string;
  groupId?: string;
  default?: boolean;
  isDefault?: boolean;
}

export interface ServerSource {
  id?: string | number;
  label?: string;
  name?: string;
  hlsUrl?: string;
  url?: string;
  proxyStreamUrl?: string;
  quality?: string;
}

export interface EpisodeItem {
  name: string;
  slug: string;
  embed: string;
  m3u8?: string;
  subtitles?: SubtitleTrack[];
  audio_tracks?: AudioTrack[];
}

export interface EpisodeServer {
  server_name: string;
  items: EpisodeItem[];
}

export interface CategoryGroup {
  group: {
    id: string;
    name: string;
  };
  list: Array<{
    id: string;
    name: string;
  }>;
}

export interface MovieDetail {
  id: string | number;
  name: string;
  original_name: string;
  slug: string;
  year: number | string;
  description: string;
  total_episodes: number | string;
  current_episode: string;
  time: string;
  quality: string;
  language: string;
  director: string;
  casts: string;
  category: Record<string, CategoryGroup>;
  thumb_url: string;
  poster_url: string;
  episodes: EpisodeServer[];
  subtitles?: SubtitleTrack[];
  audio_tracks?: AudioTrack[];
}

export interface FilmListResponse {
  status: string;
  paginate: Paginate;
  items: MovieItem[];
  message?: string;
}

export interface FilmDetailResponse {
  status: string;
  movie: MovieDetail;
  message?: string;
}

export interface HomeResponse {
  hero_banners: MovieItem[];
  latest: MovieItem[];
  series: MovieItem[];
  single: MovieItem[];
  tv_shows: MovieItem[];
  anime: MovieItem[];
}

export interface FilterOptions {
  page?: number;
  category?: string;
  genre?: string;
  country?: string;
  year?: string;
  sort?: string;
  keyword?: string;
}

export interface SearchSuggestion {
  slug: string;
  name: string;
  original_name?: string;
  year?: string;
  quality?: string;
  current_episode?: string;
  thumb_url?: string;
}

export interface HistoryItem {
  slug: string;
  name: string;
  episodeName?: string;
  episodeSlug?: string;
  posterUrl: string;
  timestamp: number;
  time?: number;
  duration?: number;
}

export interface DiskUsageInfo {
  playlists_bytes?: number;
  database_bytes?: number;
  total_bytes?: number;
  human_readable?: string;
}

export interface AdminStats {
  total_movies: number;
  total_series: number;
  total_single: number;
  catalog_rows?: number;
  detail_rows?: number;
  total_source_movies?: number;
  remaining_movies?: number;
  cached_m3u8_count: number;
  crawler_is_running: boolean;
  crawler_auto_enabled?: boolean;
  crawler_progress_percent: number;
  crawler_percent?: number;
  crawler_processed: number;
  crawler_total: number;
  crawler_total_discovered?: number;
  crawler_current_movie?: string;
  crawler_last_run?: string;
  crawler_last_status?: string;
  disk_usage?: DiskUsageInfo;
}

export interface AdminLogEntry {
  id: string | number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  task?: string;
  source?: string;
}

export interface Episode {
  id?: number;
  movieSlug: string;
  season: number;
  episode: number;
  title?: string;
  runtime?: number;
  still?: string;
  sources: ServerSource[];
  servers?: ServerSource[];
  subtitles?: (string | SubtitleTrack)[];
  audio_tracks?: (string | AudioTrack)[];
}

export interface Movie {
  id?: number | string;
  slug: string;
  type?: string;
  movie_type?: string;
  title_vi?: string;
  title_en?: string;
  year?: number;
  quality?: string;
  score?: number;
  genres: string[];
  country?: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  totalEpisodes?: number;
  stream?: string | { hlsUrl?: string; [key: string]: any };
  servers?: ServerSource[];
  subtitles?: (string | SubtitleTrack)[];
  audio_tracks?: (string | AudioTrack | { id?: number | string; name?: string; label?: string; lang?: string })[];
  episodes: Episode[];
}

export interface MovieSummary {
  id?: number | string;
  slug: string;
  name?: string;
  original_name?: string;
  movie_type?: string;
  title_vi?: string;
  title_en?: string;
  year?: number | string;
  quality?: string;
  score?: number;
  genres?: string[];
  country?: string;
  poster?: string;
  poster_url?: string;
  thumb_url?: string;
  backdrop?: string;
  total_episodes?: number | string;
  current_episode?: string;
  has_cached_m3u8?: boolean;
}

export interface MoviesResponse {
  movies?: MovieSummary[];
  items?: MovieItem[];
  total?: number;
  limit?: number;
  offset?: number;
  paginate?: Paginate;
}
