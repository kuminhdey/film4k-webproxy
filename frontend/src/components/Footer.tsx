import React from 'react';
import { SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION, CATEGORIES, GENRES, COUNTRIES } from '../constants';
import { Heart } from 'lucide-react';

interface FooterProps {
  onNavigate: (path: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="bg-[#050905] border-t border-lime-500/20 text-[#a3c49e] text-xs pt-12 pb-24 sm:pb-12 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-10 border-b border-lime-500/10">
          {/* Col 1: Brand */}
          <div className="space-y-3 md:col-span-1">
            <div
              onClick={() => onNavigate('/')}
              className="flex items-center gap-2.5 cursor-pointer group"
            >
              <div className="w-10 h-10 rounded-xl overflow-hidden p-0.5 bg-gradient-to-br from-lime-400 to-[#1e3a1b] shadow-[0_0_15px_rgba(132,204,22,0.3)]">
                <img
                  src="/logo.png"
                  alt="Bơ Film Avocado Cinema"
                  className="w-full h-full object-cover rounded-[10px]"
                />
              </div>
              <div>
                <span className="text-xl font-black text-[#f4fbf0] group-hover:text-lime-300 transition-colors">
                  {SITE_NAME}
                </span>
                <span className="block text-[9px] font-bold text-lime-400 tracking-widest uppercase">
                  Avocado Cinema
                </span>
              </div>
            </div>
            <p className="text-xs text-[#8aa885] leading-relaxed">
              {SITE_DESCRIPTION}
            </p>
            <div className="pt-1 text-[11px] text-[#708c6b]">
              Domain chính thức: <span className="text-lime-400 font-semibold">secret1.dangducminh.io.vn</span>
            </div>
          </div>

          {/* Col 2: Categories */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-lime-300 uppercase tracking-wider">
              Danh Mục Phim
            </h4>
            <ul className="space-y-2">
              {CATEGORIES.map((cat) => (
                <li key={cat.slug}>
                  <button
                    onClick={() => onNavigate(`/danh-sach/${cat.slug}`)}
                    className="hover:text-lime-300 transition-colors text-left"
                  >
                    {cat.name}
                  </button>
                </li>
              ))}
              <li>
                <button
                  onClick={() => onNavigate('/yeu-thich')}
                  className="hover:text-lime-300 transition-colors text-left"
                >
                  Phim Đã Lưu
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('/lich-su')}
                  className="hover:text-lime-300 transition-colors text-left"
                >
                  Lịch Sử Xem
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Popular Genres */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-lime-300 uppercase tracking-wider">
              Thể Loại Hot
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {GENRES.slice(0, 8).map((g) => (
                <button
                  key={g.slug}
                  onClick={() => onNavigate(`/the-loai/${g.slug}`)}
                  className="hover:text-lime-300 transition-colors text-left truncate"
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>

          {/* Col 4: Countries */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-lime-300 uppercase tracking-wider">
              Quốc Gia
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {COUNTRIES.slice(0, 8).map((c) => (
                <button
                  key={c.slug}
                  onClick={() => onNavigate(`/quoc-gia/${c.slug}`)}
                  className="hover:text-lime-300 transition-colors text-left truncate"
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Disclaimer & Copyright */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left text-[#708c6b] text-[11px]">
          <p>
            © 2026 <span className="text-[#cbe1c8] font-bold">Bơ Film (Avocado Cinema)</span>. Mọi nội dung phim được tổng hợp tự động từ nguồn mở trên internet. Chúng tôi không lưu trữ bất kỳ tệp video nào trên máy chủ của mình.
          </p>
          <p className="flex items-center gap-1 flex-shrink-0">
            <span>Crafted with</span>
            <Heart className="w-3.5 h-3.5 text-lime-400 fill-lime-400" />
            <span>for avocado film lovers</span>
          </p>
        </div>
      </div>
    </footer>
  );
};
