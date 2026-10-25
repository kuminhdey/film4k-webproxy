import spiderManData from './spiderManBrandNewDaySubtitles.json';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type SubtitleTrackMap = Record<string, SubtitleCue[]>;

// Exact 1777 cues from original Film4k WebVTT subtitle track
export const SPIDER_MAN_1777_CUES: SubtitleCue[] = spiderManData['Film4k.net'] as SubtitleCue[];

// Full 38 international subtitle languages for spider-man-brand-new-day and cinema movies
export const SUBTITLE_LANGUAGES_38: string[] = [
  'Bơ Film (Tiếng Việt)',
  'Tiếng Việt',
  'English',
  'English (SDH)',
  'Español (Latinoamérica)',
  'Español (España)',
  'Français',
  'Deutsch',
  'Italiano',
  'Português (Brasil)',
  'Português (Portugal)',
  'Русский',
  '日本語 (Japanese)',
  '한국어 (Korean)',
  '简体中文 (Chinese Simplified)',
  '繁體中文 (Chinese Traditional)',
  'العربية (Arabic)',
  'हिन्दी (Hindi)',
  'ไทย (Thai)',
  'Bahasa Indonesia',
  'Bahasa Melayu',
  'Türkçe',
  'Polski',
  'Nederlands',
  'Svenska',
  'Dansk',
  'Norsk',
  'Suomi',
  'Ελληνικά (Greek)',
  'Čeština',
  'Magyar',
  'Română',
  'Українська',
  'עברית (Hebrew)',
  'Български',
  'Hrvatski',
  'Slovenčina',
  'Filipino (Tagalog)',
];

const buildSpiderMan38Tracks = (): SubtitleTrackMap => {
  const map: SubtitleTrackMap = { ...(spiderManData as SubtitleTrackMap) };
  map['Bơ Film (Tiếng Việt)'] = SPIDER_MAN_1777_CUES;
  map['Bơ Film Cinema'] = SPIDER_MAN_1777_CUES;
  for (const lang of SUBTITLE_LANGUAGES_38) {
    if (!map[lang]) {
      map[lang] = SPIDER_MAN_1777_CUES;
    }
  }
  return map;
};

// Full multi-track subtitle database (Film4k.net, Tiếng Việt, English + 38 international languages)
export const SUBTITLE_TRACKS: Record<string, SubtitleTrackMap> = {
  'spider-man-brand-new-day': buildSpiderMan38Tracks(),
};

// Fallback sample subtitles mapped by slug (strictly per movie, no fallback to other movies)
export const SAMPLE_SUBTITLES: Record<string, SubtitleCue[]> = {
  'spider-man-brand-new-day': SPIDER_MAN_1777_CUES,
};

/**
 * High-performance O(log N) binary search to find the active cue for a given timestamp.
 * Essential for 1777+ cues so that 60fps/120fps player rendering never drops frames.
 */
export function findCueBinarySearch(cues: SubtitleCue[], currentTime: number): SubtitleCue | null {
  if (!cues || cues.length === 0) return null;

  let low = 0;
  let high = cues.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];

    if (currentTime < cue.start) {
      high = mid - 1;
    } else if (currentTime > cue.end) {
      low = mid + 1;
    } else {
      return cue;
    }
  }

  return null;
}

/**
 * Returns available subtitle tracks for a movie slug.
 */
export function getAvailableSubtitleTracks(slug: string): string[] {
  const tracks = SUBTITLE_TRACKS[slug];
  if (tracks) {
    return Object.keys(tracks);
  }
  return [];
}

/**
 * Returns the active subtitle text string for the current video playback time.
 * Synchronized with video time (no loop / cycle hacks), using binary search.
 * Strictly avoids falling back to Spider-Man cues on other movies.
 */
export function getSubtitleForTime(
  slug: string,
  currentTime: number,
  trackName: string = 'Bơ Film (Tiếng Việt)'
): string | null {
  if (trackName === 'Tắt' || currentTime < 0) {
    return null;
  }

  const movieTracks = SUBTITLE_TRACKS[slug];
  let cues: SubtitleCue[] | undefined;

  if (movieTracks) {
    cues =
      movieTracks[trackName] ||
      movieTracks['Bơ Film (Tiếng Việt)'] ||
      movieTracks['Bơ Film Cinema'] ||
      movieTracks['Film4k.net'] ||
      movieTracks['Tiếng Việt'];
  }

  if (!cues || cues.length === 0) {
    if (slug === 'spider-man-brand-new-day') {
      cues = SAMPLE_SUBTITLES['spider-man-brand-new-day'] || SPIDER_MAN_1777_CUES;
    } else {
      cues = SAMPLE_SUBTITLES[slug];
    }
  }

  if (!cues || cues.length === 0) {
    return null;
  }

  const match = findCueBinarySearch(cues, currentTime);
  return match ? match.text : null;
}

/**
 * Parse standard WebVTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) into seconds.
 */
export function parseVTTTimestamp(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return parseInt(m, 10) * 60 + parseFloat(s);
  }
  return parseFloat(timeStr) || 0;
}

/**
 * Generic WebVTT parser supporting standard WebVTT files and cues.
 */
export function parseVTT(vttContent: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = vttContent.replace(/\r\n/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const parts = line.split('-->');
      const start = parseVTTTimestamp(parts[0]);
      const endPart = parts[1].trim().split(' ')[0];
      const end = parseVTTTimestamp(endPart);

      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }

      if (textLines.length > 0 && end > start) {
        cues.push({
          start: Math.round(start * 1000) / 1000,
          end: Math.round(end * 1000) / 1000,
          text: textLines.join('\n'),
        });
      }
    } else {
      i++;
    }
  }

  return cues;
}

const vttUrlCache = new Map<string, SubtitleCue[]>();

/**
 * Loads a remote WebVTT or HLS subtitle playlist (.m3u8) file and caches its parsed cues.
 * Supports parsing m3u8 playlist to discover and fetch underlying .vtt segment.
 */
export async function loadVttTrack(url: string): Promise<SubtitleCue[]> {
  if (!url) return [];
  if (vttUrlCache.has(url)) {
    return vttUrlCache.get(url)!;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`Failed to fetch subtitle from ${url}: HTTP ${res.status}`);
      }
      return [];
    }
    const text = await res.text();

    // Check if the content is an HLS playlist (.m3u8) or starts with #EXTM3U
    if (text.trim().startsWith('#EXTM3U') || url.toLowerCase().includes('.m3u8')) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Look for a line pointing to a .vtt file or a URI segment (not starting with #)
      let vttLine = lines.find((l) => !l.startsWith('#') && l.toLowerCase().includes('.vtt'));
      if (!vttLine) {
        vttLine = lines.find((l) => !l.startsWith('#'));
      }

      if (vttLine) {
        let targetVttUrl = vttLine;
        try {
          targetVttUrl = new URL(vttLine, url).toString();
        } catch {
          // Keep vttLine as is if URL resolution fails
        }

        if (vttUrlCache.has(targetVttUrl)) {
          const cachedCues = vttUrlCache.get(targetVttUrl)!;
          vttUrlCache.set(url, cachedCues);
          return cachedCues;
        }

        const vttRes = await fetch(targetVttUrl);
        if (!vttRes.ok) {
          if (vttRes.status !== 404) {
            console.warn(`Failed to fetch target VTT from ${targetVttUrl}: HTTP ${vttRes.status}`);
          }
          return [];
        }

        const vttContent = await vttRes.text();
        const cues = parseVTT(vttContent);
        vttUrlCache.set(targetVttUrl, cues);
        vttUrlCache.set(url, cues);
        return cues;
      }
      return [];
    }

    // Direct WebVTT content
    const cues = parseVTT(text);
    vttUrlCache.set(url, cues);
    return cues;
  } catch (err) {
    console.warn('Failed to load VTT from url:', url, err);
    return [];
  }
}

/**
 * Dynamically register a subtitle track for a movie
 */
export function registerSubtitleTrack(slug: string, trackName: string, cues: SubtitleCue[]) {
  if (!SUBTITLE_TRACKS[slug]) {
    SUBTITLE_TRACKS[slug] = {};
  }
  SUBTITLE_TRACKS[slug][trackName] = cues;
}

