// frontend/src/crawlerStatus.ts

export type CrawlerMode = 'latest' | 'full' | 'force' | 'prewarm';

export interface CrawlerModeMeta {
  mode: CrawlerMode;
  label: string;
  shortLabel: string;
  description: string;
}

export const SUPPORTED_CRAWLER_MODES: readonly CrawlerModeMeta[] = [
  {
    mode: 'latest',
    label: 'Quét Cập Nhật Phim Mới',
    shortLabel: 'Mới nhất (Latest)',
    description: 'Đồng bộ nhanh 100 phim và tập mới nhất ở đầu sitemap nguồn.',
  },
  {
    mode: 'full',
    label: 'Đồng Bộ Toàn Bộ Kho',
    shortLabel: 'Toàn bộ (Full)',
    description: 'Duyệt toàn bộ danh mục sitemap nguồn và bổ sung chi tiết tập phim.',
  },
  {
    mode: 'force',
    label: 'Làm Mới Bắt Buộc (Force)',
    shortLabel: 'Làm mới (Force)',
    description: 'Quét lại toàn bộ thông tin phim và luồng phát kể cả mục đã tồn tại.',
  },
  {
    mode: 'prewarm',
    label: 'Nạp Trước Dữ Liệu Phim Hot',
    shortLabel: 'Làm nóng M3U8 (Prewarm)',
    description: 'Đồng bộ phim thịnh hành và dựng sẵn cache playlist M3U8 trên ổ đĩa.',
  },
] as const;

export function isValidCrawlerMode(mode: string): mode is CrawlerMode {
  return mode === 'latest' || mode === 'full' || mode === 'force' || mode === 'prewarm';
}

export function crawlerStatusLabel(
  isRunning: boolean,
  autoEnabled: boolean,
  activeMode?: string
): string {
  if (isRunning) {
    if (activeMode && isValidCrawlerMode(activeMode)) {
      const found = SUPPORTED_CRAWLER_MODES.find((m) => m.mode === activeMode);
      if (found) {
        return `Đang chạy: ${found.shortLabel}`;
      }
    }
    return autoEnabled ? 'Đang tự động cào...' : 'Đang chạy crawler...';
  }
  return autoEnabled ? 'Chế độ nghỉ (Tự động mỗi 1 giờ)' : 'Sẵn sàng (Chờ lệnh)';
}
