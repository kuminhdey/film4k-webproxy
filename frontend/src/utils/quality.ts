export interface QualityLevel {
  id: number;
  height: number;
  width?: number;
  bitrate?: number;
}

export interface QualityDisplayInfo {
  label: string;
  badge: '4K' | 'HD';
  badgeColor: string;
  sortWeight: number;
  resolution: string;
}

/**
 * Normalizes video resolutions, particularly for 2.39:1 ultrawide cinema format:
 * - 3832x1600 (height ~1600): Displays as "1600p" with "4K" badge (#e11d2e)
 * - 1920x800 (height ~800): Displays as "1080p" with "HD" badge (var(--muted, #8b95ad)), replacing raw 800p
 * - 1920x1080: Displays as "1080p" with "HD" badge
 * - 3840x2160: Displays as "2160p" with "4K" badge
 * - 1280x720: Displays as "720p" with "HD" badge
 */
export function getQualityDisplayInfo(height: number, width?: number): QualityDisplayInfo {
  // 4K Ultrawide (2.39:1 scope, e.g. 3832x1600 or ~1600p)
  if (height >= 1500 && height <= 1650) {
    const w = width && width > 0 ? width : 3832;
    return {
      label: '1600p',
      badge: '4K',
      badgeColor: 'var(--accent, #aeea00)',
      sortWeight: 1600,
      resolution: `${w}x${height}`,
    };
  }

  // Standard 4K UHD (16:9, e.g. 3840x2160)
  if (height >= 2160) {
    const w = width && width > 0 ? width : 3840;
    return {
      label: `${height}p`,
      badge: '4K',
      badgeColor: 'var(--accent, #aeea00)',
      sortWeight: 2160,
      resolution: `${w}x${height}`,
    };
  }

  // 1080p Ultrawide (2.39:1 scope, e.g. 1920x800 or raw height 800p) or standard 1080p (1920x1080)
  if ((height >= 780 && height <= 840) || height === 1080) {
    const w = width && width > 0 ? width : 1920;
    return {
      label: '1080p',
      badge: 'HD',
      badgeColor: 'var(--muted, #8b95ad)',
      sortWeight: 1080,
      resolution: `${w}x${height}`,
    };
  }

  // 720p (HD, e.g. 1280x720 or 1280x536 scope)
  if (height === 720 || (height >= 500 && height <= 560)) {
    const w = width && width > 0 ? width : 1280;
    return {
      label: '720p',
      badge: 'HD',
      badgeColor: 'var(--muted, #8b95ad)',
      sortWeight: 720,
      resolution: `${w}x${height}`,
    };
  }

  // Fallback for other resolutions
  const w = width && width > 0 ? width : Math.round((height * 16) / 9);
  return {
    label: `${height}p`,
    badge: 'HD',
    badgeColor: 'var(--muted, #8b95ad)',
    sortWeight: height,
    resolution: `${w}x${height}`,
  };
}

/**
 * Sorts quality levels descending from highest quality to lowest quality:
 * e.g., 1600p (4K) -> 1080p (HD) -> 720p (HD)
 */
export function sortQualitiesDescending<T extends { height: number; width?: number }>(
  qualities: T[]
): T[] {
  return [...qualities].sort((a, b) => {
    const weightA = getQualityDisplayInfo(a.height, a.width).sortWeight;
    const weightB = getQualityDisplayInfo(b.height, b.width).sortWeight;
    return weightB - weightA;
  });
}

/**
 * Extracts normalized quality label from resolution string (e.g., "3832x1600" -> "1600p", "1920x800" -> "1080p")
 */
export function getLabelFromResolution(res: string): string {
  const parts = res.split('x');
  if (parts.length === 2) {
    const w = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    if (!isNaN(h)) {
      return getQualityDisplayInfo(h, !isNaN(w) ? w : undefined).label;
    }
  }
  return '1080p';
}
