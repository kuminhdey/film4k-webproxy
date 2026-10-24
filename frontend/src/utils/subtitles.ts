import spiderManData from './spiderManBrandNewDaySubtitles.json';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type SubtitleTrackMap = Record<string, SubtitleCue[]>;

// Exact 1777 cues from original Film4k WebVTT subtitle track
export const SPIDER_MAN_1777_CUES: SubtitleCue[] = spiderManData['Film4k.net'] as SubtitleCue[];

// Full multi-track subtitle database (Film4k.net, Tiếng Việt, English)
export const SUBTITLE_TRACKS: Record<string, SubtitleTrackMap> = {
  'spider-man-brand-new-day': spiderManData as SubtitleTrackMap,
  'street-fighter': spiderManData as SubtitleTrackMap,
};

// Fallback sample subtitles mapped by slug
export const SAMPLE_SUBTITLES: Record<string, SubtitleCue[]> = {
  'spider-man-brand-new-day': SPIDER_MAN_1777_CUES,
  'street-fighter': SPIDER_MAN_1777_CUES,
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
  return ['Film4k.net', 'Tiếng Việt', 'English'];
}

/**
 * Returns the active subtitle text string for the current video playback time.
 * Synchronized with video time (no loop / cycle hacks), using binary search.
 */
export function getSubtitleForTime(
  slug: string,
  currentTime: number,
  trackName: string = 'Film4k.net'
): string | null {
  if (trackName === 'Tắt' || currentTime < 0) {
    return null;
  }

  const movieTracks = SUBTITLE_TRACKS[slug];
  let cues: SubtitleCue[] | undefined;

  if (movieTracks) {
    cues = movieTracks[trackName] || movieTracks['Film4k.net'] || movieTracks['Tiếng Việt'];
  }

  if (!cues || cues.length === 0) {
    cues = SAMPLE_SUBTITLES[slug] || SPIDER_MAN_1777_CUES;
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
 * Loads a remote WebVTT file and caches its parsed cues.
 */
export async function loadVttTrack(url: string): Promise<SubtitleCue[]> {
  if (vttUrlCache.has(url)) {
    return vttUrlCache.get(url)!;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
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

