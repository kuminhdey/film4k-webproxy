import React from 'react';
import {
  SITE_NAME,
  SITE_DESCRIPTION,
  SITE_URL,
  CATEGORIES,
  GENRES,
  COUNTRIES,
} from '../constants';
import { Heart } from 'lucide-react';

interface FooterProps {
  onNavigate: (path: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const handleLinkClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    path: string
  ) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.shiftKey
    ) {
      return;
    }
    e.preventDefault();
    onNavigate(path);
  };

  const displayDomain =
    typeof window !== 'undefined' && window.location.host
      ? window.location.host
      : SITE_URL.replace(/^https?:\/\//, '');

  return (
    <footer className="bg-[#050905] border-t border-lime-500/20 text-[#a3c49e] text-xs pt-12 pb-24 sm:pb-12 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-10 border-b border-lime-500/10">
          {/* Col 1: Brand */}
          <div className="space-y-3 md:col-span-1">
            <a
              href="/"
              onClick={(e) => handleLinkClick(e, '/')}
              className="inline-flex items-center gap-2.5 cursor-pointer group rounded-xl min-h-[44px]"
            >
              <div className="w-10 h-10 rounded-xl overflow-hidden p-0.5 bg-gradient-to-br from-lime-400 to-[#1e3a1b] shadow-[0_0_12px_rgba(132,204,22,0.25)]">
                <img
                  src="/logo.png"
                  alt="Bơ Film Avocado Cinema"
                  width={40}
                  height={40}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover rounded-[10px]"
                />
              </div>
              <div>
                <span className="text-xl font-extrabold text-[#f4fbf0] group-hover:text-lime-300 transition-colors">
                  {SITE_NAME}
                </span>
                <span className="block text-[11px] font-bold text-lime-400 tracking-wider uppercase">
                  Avocado Cinema
                </span>
              </div>
            </a>
            <p className="text-xs text-[#9ab395] leading-relaxed">
              {SITE_DESCRIPTION}
            </p>
            <div className="pt-1 text-xs text-[#8aa885]">
              Máy chủ hiện tại:{' '}
              <span className="text-lime-400 font-semibold">{displayDomain}</span>
            </div>
          </div>

          {/* Col 2: Categories */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-lime-300 uppercase tracking-wider">
              Danh Mục Phim
            </h4>
            <ul className="space-y-1">
              {CATEGORIES.map((cat) => {
                const path = `/danh-sach/${cat.slug}`;
                return (
                  <li key={cat.slug}>
                    <a
                      href={path}
                      onClick={(e) => handleLinkClick(e, path)}
                      className="min-h-[32px] inline-flex items-center hover:text-lime-300 transition-colors text-left"
                    >
                      {cat.name}
                    </a>
                  </li>
                );
              })}
              <li>
                <a
                  href="/yeu-thich"
                  onClick={(e) => handleLinkClick(e, '/yeu-thich')}
                  className="min-h-[32px] inline-flex items-center hover:text-lime-300 transition-colors text-left"
                >
                  Phim Đã Lưu
                </a>
              </li>
              <li>
                <a
                  href="/lich-su"
                  onClick={(e) => handleLinkClick(e, '/lich-su')}
                  className="min-h-[32px] inline-flex items-center hover:text-lime-300 transition-colors text-left"
                >
                  Lịch Sử Xem
                </a>
              </li>
            </ul>
          </div>

          {/* Col 3: Popular Genres */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-lime-300 uppercase tracking-wider">
              Thể Loại Hot
            </h4>
            <div className="grid grid-cols-2 gap-1">
              {GENRES.slice(0, 8).map((g) => {
                const path = `/the-loai/${g.slug}`;
                return (
                  <a
                    key={g.slug}
                    href={path}
                    onClick={(e) => handleLinkClick(e, path)}
                    className="min-h-[32px] inline-flex items-center hover:text-lime-300 transition-colors text-left truncate"
                  >
                    {g.name}
                  </a>
                );
              })}
            </div>
          </div>

          {/* Col 4: Countries */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-lime-300 uppercase tracking-wider">
              Quốc Gia
            </h4>
            <div className="grid grid-cols-2 gap-1">
              {COUNTRIES.slice(0, 8).map((c) => {
                const path = `/quoc-gia/${c.slug}`;
                return (
                  <a
                    key={c.slug}
                    href={path}
                    onClick={(e) => handleLinkClick(e, path)}
                    className="min-h-[32px] inline-flex items-center hover:text-lime-300 transition-colors text-left truncate"
                  >
                    {c.name}
                  </a>
                );
              })}
            </div>
          </div>
        </div>

        {/* Disclaimer & Copyright */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left text-[#8aa885] text-xs">
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
