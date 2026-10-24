use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub label: String,
    #[serde(rename = "hlsUrl")]
    pub hls_url: String,
    #[serde(rename = "proxyStreamUrl", default)]
    pub proxy_stream_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(rename = "movieSlug", default)]
    pub movie_slug: String,
    #[serde(default = "default_one")]
    pub season: i32,
    pub episode: i32,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub runtime: Option<i32>,
    #[serde(default)]
    pub still: Option<String>,
    #[serde(default)]
    pub sources: Vec<Source>,
}

fn default_one() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Movie {
    #[serde(default)]
    pub id: Option<serde_json::Value>,
    pub slug: String,
    #[serde(rename = "type", default = "default_movie_type")]
    pub movie_type: String, // "movie" or "tv"
    #[serde(default)]
    pub title_vi: Option<String>,
    #[serde(default)]
    pub title_en: Option<String>,
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub poster: Option<String>,
    #[serde(default)]
    pub backdrop: Option<String>,
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(rename = "totalEpisodes", default)]
    pub total_episodes: Option<i32>,
    #[serde(default)]
    pub stream: Option<serde_json::Value>,
    #[serde(default)]
    pub episodes: Vec<Episode>,
}

fn default_movie_type() -> String {
    "movie".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MoviesQuery {
    pub search: Option<String>,
    pub genre: Option<String>,
    #[serde(rename = "type")]
    pub movie_type: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MoviesResponse {
    pub movies: Vec<MovieSummary>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovieSummary {
    pub id: i64,
    pub slug: String,
    pub movie_type: String,
    pub title_vi: Option<String>,
    pub title_en: Option<String>,
    pub year: Option<i32>,
    pub quality: Option<String>,
    pub score: Option<f64>,
    pub genres: Vec<String>,
    pub poster: Option<String>,
    pub backdrop: Option<String>,
    pub total_episodes: Option<i32>,
}
