export interface ServerSource {
  label: string;
  hlsUrl: string;
  proxyStreamUrl?: string;
}

export type Source = ServerSource;

export interface SubtitleTrack {
  id?: number | string;
  label?: string;
  name?: string;
  lang?: string;
  language?: string;
  url?: string;
  file?: string;
  src?: string;
  isDefault?: boolean;
}

export type SubtitleTrackInfo = SubtitleTrack;

export interface AudioTrack {
  id: number;
  name: string;
  lang?: string;
  groupId?: string;
}

export type AudioTrackItem = AudioTrack;

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
  id?: number;
  slug: string;
  type: string; // 'movie' | 'tv'
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
  audio_tracks?: (string | AudioTrack | { id?: number; name?: string; label?: string; lang?: string })[];
  episodes: Episode[];
}

export interface MovieSummary {
  id: number;
  slug: string;
  movie_type: string;
  title_vi?: string;
  title_en?: string;
  year?: number;
  quality?: string;
  score?: number;
  genres: string[];
  poster?: string;
  backdrop?: string;
  total_episodes?: number;
}

export interface MoviesResponse {
  movies: MovieSummary[];
  total: number;
  limit: number;
  offset: number;
}
