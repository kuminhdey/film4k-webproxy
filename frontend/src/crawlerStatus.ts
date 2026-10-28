export function crawlerStatusLabel(isRunning: boolean, autoEnabled: boolean): string {
  if (isRunning) return autoEnabled ? 'Đang tự động cào...' : 'Đang chạy crawler...';
  return autoEnabled ? 'Chế độ nghỉ (Tự động kích hoạt)' : 'Chế độ tự động đã tắt';
}
