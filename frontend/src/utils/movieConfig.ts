/**
 * Utility: Per-Movie Playback Configuration and Global Subtitle Settings for Bơ Film
 *
 * 1. Per-Movie Config:
 *    LocalStorage key: bofilm_movie_config_${slug}
 *    Stores: selectedCaption, selectedAudioName, selectedQualityId, playbackSpeed, serverLabel
 *
 * 2. Global Subtitle Appearance:
 *    LocalStorage key: bofilm_subtitle_settings
 *    Stores: fontSize, fontColor, bgStyle (shared universally across all movies)
 */

export interface MoviePlaybackConfig {
  selectedCaption?: string;
  selectedAudioName?: string;
  selectedQualityId?: number;
  playbackSpeed?: number;
  serverLabel?: string;
}

export function getMovieConfigKey(slug: string): string {
  return `bofilm_movie_config_${slug}`;
}

export function getMovieConfig(slug: string): MoviePlaybackConfig {
  if (!slug) return {};
  try {
    const raw = localStorage.getItem(getMovieConfigKey(slug));
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[MovieConfig] Failed to read config for ${slug}:`, err);
    return {};
  }
}

export function saveMovieConfig(slug: string, updates: Partial<MoviePlaybackConfig>): MoviePlaybackConfig {
  if (!slug) return {};
  try {
    const current = getMovieConfig(slug);
    const updated: MoviePlaybackConfig = { ...current, ...updates };
    localStorage.setItem(getMovieConfigKey(slug), JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.warn(`[MovieConfig] Failed to save config for ${slug}:`, err);
    return {};
  }
}

export interface SubtitleSettings {
  fontSize: 'small' | 'medium' | 'large';
  fontColor: string;
  bgStyle: 'outline' | 'semi' | 'solid';
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  fontSize: 'medium',
  fontColor: '#ffffff',
  bgStyle: 'outline',
};

export const SUBTITLE_SETTINGS_STORAGE_KEY = 'bofilm_subtitle_settings';

export function getGlobalSubtitleSettings(): SubtitleSettings {
  try {
    const saved = localStorage.getItem(SUBTITLE_SETTINGS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        fontSize: ['small', 'medium', 'large'].includes(parsed.fontSize) ? parsed.fontSize : 'medium',
        fontColor: parsed.fontColor || '#ffffff',
        bgStyle: ['outline', 'semi', 'solid'].includes(parsed.bgStyle) ? parsed.bgStyle : 'outline',
      };
    }
  } catch (e) {
    console.warn('[SubtitleSettings] Failed to parse subtitle settings from localStorage', e);
  }
  return DEFAULT_SUBTITLE_SETTINGS;
}

export function saveGlobalSubtitleSettings(updates: Partial<SubtitleSettings>): SubtitleSettings {
  try {
    const current = getGlobalSubtitleSettings();
    const updated: SubtitleSettings = { ...current, ...updates };
    localStorage.setItem(SUBTITLE_SETTINGS_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn('[SubtitleSettings] Failed to save subtitle settings to localStorage', e);
    return DEFAULT_SUBTITLE_SETTINGS;
  }
}
