export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export const SAMPLE_SUBTITLES: Record<string, SubtitleCue[]> = {
  'spider-man-brand-new-day': [
    { start: 0, end: 4, text: "Tôi từng nghĩ sau tất cả những gì xảy ra..." },
    { start: 4.5, end: 9, text: "Tôi có thể bắt đầu lại từ con số không." },
    { start: 9.5, end: 15, text: "Không còn ai nhớ tôi là Peter Parker nữa." },
    { start: 15.5, end: 20, text: "Hoặc cậu có thể coi đó là một cơ hội." },
    { start: 20.5, end: 25, text: "Đã có bốn vụ rồi, đúng không ạ?" },
    { start: 25.5, end: 31, text: "Một thế lực mới đang trỗi dậy dưới lòng thành phố New York." },
    { start: 31.5, end: 37, text: "Và lần này, tôi sẽ phải đơn độc chiến đấu." },
    { start: 37.5, end: 43, text: "Dù có chuyện gì xảy ra... sức mạnh càng lớn, trách nhiệm càng cao." },
    { start: 43.5, end: 50, text: "Bởi vì tôi là Spider-Man!" },
  ],
  'street-fighter': [
    { start: 0, end: 4, text: "Chào mừng các chiến binh đến với giải đấu Street Fighter!" },
    { start: 4.5, end: 9, text: "Ở đây, chỉ có kẻ mạnh nhất mới có quyền sống sót." },
    { start: 9.5, end: 14, text: "Ryu: 'Ta tìm kiếm câu trả lời nằm sâu trong nắm đấm này!'" },
    { start: 14.5, end: 19, text: "Ken: 'Đừng lo Ryu, tớ luôn sẵn sàng yểm trợ cậu!'" },
    { start: 19.5, end: 25, text: "Tổ chức Shadaloo đang toan tính điều gì đen tối?" },
    { start: 25.5, end: 30, text: "Hadouken! Cú đấm thức tỉnh nguồn năng lượng vô tận!" },
    { start: 31, end: 37, text: "Film4k.Net — Phim võ thuật đỉnh cao với chuẩn hình ảnh 4K HDR." },
    { start: 38, end: 45, text: "Trận chiến sinh tử thực sự... giờ mới chính thức bắt đầu!" },
  ],
};

export function getSubtitleForTime(slug: string, currentTime: number): string | null {
  const cues = SAMPLE_SUBTITLES[slug] || [
    { start: 0, end: 5, text: "Film4k.Net — Trình phát phim 4K Ultra HD đỉnh cao." },
    { start: 6, end: 12, text: "Đang phát luồng dữ liệu trực tiếp tốc độ cao từ cụm CDN quốc tế." },
    { start: 13, end: 19, text: "Hoặc cậu có thể coi đó là một cơ hội." },
    { start: 20, end: 26, text: "Âm thanh vòm Dolby Atmos 5.1 sống động như tại rạp chiếu phim." },
    { start: 27, end: 35, text: "Chúc bạn có những giây phút thưởng thức phim tuyệt vời cùng Film4k!" },
  ];

  const cycleTime = cues.length > 0 ? currentTime % (cues[cues.length - 1].end + 5) : 0;
  const match = cues.find((c) => cycleTime >= c.start && cycleTime <= c.end);
  return match ? match.text : null;
}
