use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ServerSource {
    #[serde(default)]
    pub id: Option<serde_json::Value>,
    #[serde(default, alias = "name")]
    pub label: String,
    #[serde(rename = "hlsUrl", alias = "hls_url", alias = "url", default)]
    pub hls_url: String,
    #[serde(rename = "proxyStreamUrl", alias = "proxy_stream_url", default)]
    pub proxy_stream_url: Option<String>,
    #[serde(default)]
    pub quality: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SubtitleTrack {
    #[serde(default)]
    pub id: Option<serde_json::Value>,
    #[serde(default, alias = "name", alias = "title")]
    pub label: String,
    #[serde(default, alias = "language")]
    pub lang: Option<String>,
    #[serde(default, alias = "src", alias = "file", alias = "vtt_url", alias = "vttUrl")]
    pub url: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(rename = "default", alias = "is_default", default)]
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AudioTrack {
    #[serde(default)]
    pub id: Option<serde_json::Value>,
    #[serde(default, alias = "name", alias = "title")]
    pub label: String,
    #[serde(default, alias = "language")]
    pub lang: Option<String>,
    #[serde(default, alias = "src", alias = "url", alias = "hls_url", alias = "hlsUrl")]
    pub url: Option<String>,
    #[serde(rename = "default", alias = "is_default", default)]
    pub is_default: Option<bool>,
}

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
    #[serde(default)]
    pub servers: Vec<ServerSource>,
    #[serde(default)]
    pub subtitles: Vec<SubtitleTrack>,
    #[serde(default, alias = "audioTracks")]
    pub audio_tracks: Vec<AudioTrack>,
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
    #[serde(default)]
    pub servers: Vec<ServerSource>,
    #[serde(default)]
    pub subtitles: Vec<SubtitleTrack>,
    #[serde(default, alias = "audioTracks")]
    pub audio_tracks: Vec<AudioTrack>,
}

impl Movie {
    pub fn get_primary_hls_url(&self) -> Option<String> {
        self.servers
            .first()
            .map(|s| s.hls_url.clone())
            .or_else(|| {
                self.stream.as_ref().and_then(|st| match st {
                    serde_json::Value::String(s) => Some(s.clone()),
                    serde_json::Value::Object(obj) => obj
                        .get("hlsUrl")
                        .or_else(|| obj.get("proxyStreamUrl"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    _ => None,
                })
            })
    }
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
    pub page: Option<i64>,
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
