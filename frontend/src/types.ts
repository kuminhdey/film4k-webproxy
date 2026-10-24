export interface ServerSource {
  id?: string | number;
  label?: string;
  name?: string;
  hlsUrl?: string;
  url?: string;
  proxyStreamUrl?: string;
  quality?: string;
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
  kind?: string;
  default?: boolean;
  isDefault?: boolean;
}

export type SubtitleTrackInfo = SubtitleTrack;

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
  id?: number | string;
  slug: string;
  type: string;
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

