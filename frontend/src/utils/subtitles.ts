export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export const SAMPLE_SUBTITLES: Record<string, SubtitleCue[]> = {
  'spider-man-brand-new-day': [
    { start: 0, end: 4, text: "Tôi từng nghĩ sau tất cả những gì xảy ra..." },
    { start: 4.5, end: 8, text: "Tôi có thể bắt đầu lại từ con số không." },
    { start: 8.5, end: 13, text: "Không còn ai nhớ tôi là Peter Parker nữa." },
    { start: 13.5, end: 17, text: "Nhưng thành phố này... chưa bao giờ để tôi nghỉ ngơi." },
    { start: 17.5, end: 22, text: "Một thế lực mới đang trỗi dậy dưới lòng New York." },
    { start: 22.5, end: 27, text: "Và lần này, tôi sẽ phải đơn độc chiến đấu." },
    { start: 27.5, end: 32, text: "Film4k.Net — Chuẩn âm thanh Dolby Atmos 5.1 & hình ảnh 4K HDR." },
    { start: 33, end: 38, text: "Dù có chuyện gì xảy ra... sức mạnh càng lớn, trách nhiệm càng cao." },
    { start: 39, end: 45, text: "Bởi vì tôi là Spider-Man!" },
  ],
  'street-fighter': [
    { start: 0, end: 4, text: "Chào mừng các chiến binh đến với giải đấu Street Fighter!" },
    { start: 4.5, end: 9, text: "Ở đây, chỉ có kẻ mạnh nhất mới có quyền sống sót." },
    { start: 9.5, end: 14, text: "Ryu: 'Ta tìm kiếm câu trả lời nằm sâu trong nắm đấm này!'" },
    { start: 14.5, end: 19, text: "Ken: 'Đừng lo Ryu, tớ luôn sẵn sàng yểm trợ cậu!'" },
    { start: 19.5, end: 25, text: "Tổ chức Shadaloo đang toan tính điều gì đen tối?" },
    { start: 25.5, end: 30, text: "Hadouken! Cú đấm thức tỉnh nguồn năng lượng vô tận!" },
    { start: 31, end: 37, text: "Film4k.Net — Phim võ thuật đỉnh cao với tốc độ phát 300+ Mbps." },
    { start: 38, end: 45, text: "Trận chiến sinh tử thực sự... giờ mới chính thức bắt đầu!" },
  ],
};

export function getSubtitleForTime(slug: string, currentTime: number): string | null {
  const cues = SAMPLE_SUBTITLES[slug] || [
    { start: 0, end: 5, text: "Film4k.Net — Trình phát phim 4K Ultra HD đỉnh cao." },
    { start: 6, end: 12, text: "Đang phát luồng dữ liệu trực tiếp tốc độ cao từ cụm CDN quốc tế." },
    { start: 13, end: 19, text: "Âm thanh vòm Dolby Atmos 5.1 sống động như tại rạp chiếu phim." },
    { start: 20, end: 26, text: "Phụ đề Tiếng Việt được dịch thuật và biên tập chuẩn xác." },
    { start: 27, end: 35, text: "Chúc bạn có những giây phút thưởng thức phim tuyệt vời cùng Film4k!" },
  ];

  // Loop subtitle cues so even after 35s, it loops or maps smoothly
  const cycleTime = cues.length > 0 ? currentTime % (cues[cues.length - 1].end + 5) : 0;
  const match = cues.find((c) => cycleTime >= c.start && cycleTime <= c.end);
  return match ? match.text : null;
}
