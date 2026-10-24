export interface Source {
  label: string;
  hlsUrl: string;
  proxyStreamUrl?: string;
}

export interface Episode {
  id?: number;
  movieSlug: string;
  season: number;
  episode: number;
  title?: string;
  runtime?: number;
  still?: string;
  sources: Source[];
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
  stream?: string;
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
