import React from 'react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onPairDevice?: () => void;
  onSettings?: () => void;
  onQuickCode?: () => void;
  onSignIn?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  onPairDevice,
  onSettings,
  onQuickCode,
  onSignIn,
}) => {
  return (
    <nav className="side" aria-label="Main">
      <a
        className="side-brand"
        href="/"
        onClick={(e) => {
          e.preventDefault();
          onTabChange('all');
        }}
        style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}
      >
        <img
          src="/logo.png"
          alt="Bơ Film"
          className="h-9 w-auto object-contain drop-shadow"
          style={{ height: '36px', width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(174, 234, 0, 0.4))' }}
        />
        <span style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', display: 'inline-flex', gap: '4px' }}>
          <span style={{ color: '#aeea00' }}>Bơ</span>
          <span style={{ color: '#fcfdf7' }}>Film</span>
        </span>
      </a>

      <ul className="side-list">
        <li>
          <a
            className={`side-link ${activeTab === 'all' ? 'on' : ''}`}
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('all');
            }}
          >
            <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
              <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"></path>
            </svg>
            <span className="side-label">Trang chủ</span>
          </a>
        </li>
        <li>
          <a
            className={`side-link ${activeTab === 'explore' ? 'on' : ''}`}
            href="/?browse=1"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('explore');
            }}
          >
            <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 6.5-2 5-5 2 2-5z"></path>
            </svg>
            <span className="side-label">Khám phá</span>
          </a>
        </li>
        <li>
          <a
            className={`side-link ${activeTab === 'movie' ? 'on' : ''}`}
            href="/?type=movie"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('movie');
            }}
          >
            <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
              <path d="M4 4h16v16H4zM4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4"></path>
            </svg>
            <span className="side-label">Phim lẻ</span>
          </a>
        </li>
        <li>
          <a
            className={`side-link ${activeTab === 'tv' ? 'on' : ''}`}
            href="/?type=tv"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('tv');
            }}
          >
            <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
              <path d="M8 5h13v11H8zM3 8v11h13"></path>
            </svg>
            <span className="side-label">Phim bộ</span>
          </a>
        </li>
        <li>
          <a
            className={`side-link ${activeTab === 'genres' ? 'on' : ''}`}
            href="/genres"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('genres');
            }}
          >
            <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h10"></path>
            </svg>
            <span className="side-label">Thể loại</span>
          </a>
        </li>
        <li>
          <a
            className={`side-link ${activeTab === 'television' ? 'on' : ''}`}
            href="/tv"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('television');
            }}
          >
            <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
              <path d="M4 8h16v10H4zM9 8 6 4M15 8l3-4M9 21h6"></path>
            </svg>
            <span className="side-label">Truyền hình</span>
          </a>
        </li>
        <li>
          <a
            className={`side-link ${activeTab === 'sports' ? 'on' : ''}`}
            href="/sports"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('sports');
            }}
          >
            <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 2v20M2.5 9h19M2.5 15h19"></path>
            </svg>
            <span className="side-label">Thể thao</span>
          </a>
        </li>
        <li>
          <a
            className={`side-link ${activeTab === 'favourites' ? 'on' : ''}`}
            href="/favourites"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('favourites');
            }}
          >
            <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
              <path d="M3 6h11M3 12h8M3 18h8M15 15l2.5 2.5L22 13"></path>
            </svg>
            <span className="side-label">Danh sách của tôi</span>
          </a>
        </li>
      </ul>

      <div className="side-foot">
        <a
          className="side-link"
          href="/pair"
          onClick={(e) => {
            e.preventDefault();
            onPairDevice?.();
          }}
        >
          <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
            <path d="M4 6h16v10H4zM9 8 6 4M15 8l3-4M9 21h6M8 11h8M12 9v4"></path>
          </svg>
          <span className="side-label">Ghép nối TV</span>
        </a>
        <a
          className="side-link"
          href="/settings"
          onClick={(e) => {
            e.preventDefault();
            onSettings?.();
          }}
        >
          <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
            <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4-2-1 .2-2.2-2-1.2-1.7 1.4-2-.8L13 4h-2l-.5 2.2-2 .8L6.8 5.6l-2 1.2L5 9l-2 1v2l2 1-.2 2.2 2 1.2 1.7-1.4 2 .8L11 20h2l.5-2.2 2-.8 1.7 1.4 2-1.2L19 15l2-1z"></path>
          </svg>
          <span className="side-label">Cài đặt</span>
        </a>
        <a
          className="side-link"
          href="/admin"
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState({}, '', '/admin');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        >
          <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
            <path d="M12 2 3 7v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V7l-9-5zm0 18c-4.1-1.2-7-5.3-7-9.5V8.3l7-3.9 7 3.9v2.2c0 4.2-2.9 8.3-7 9.5z"></path>
          </svg>
          <span className="side-label">Quản trị</span>
        </a>
        <div className="side-account">
          <div className="auth-btns">
            <a
              className="ghost side-pair"
              title="Đăng nhập bằng mã TV"
              href="/login?mode=code"
              onClick={(e) => {
                e.preventDefault();
                onQuickCode?.();
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M4 6h16v10H4zM9 8 6 4M15 8l3-4M9 21h6M8 11h8M12 9v4"></path>
              </svg>
              <span>Mã nhanh TV</span>
            </a>
            <a
              className="ghost side-signin"
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                onSignIn?.();
              }}
            >
              Đăng nhập
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
};
