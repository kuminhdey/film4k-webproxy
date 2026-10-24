import React, { useState } from 'react';

interface MobileNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onMoreClick?: () => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  activeTab,
  onTabChange,
  onMoreClick,
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  return (
    <>
      <nav className="mobile-nav" aria-label="Mobile Navigation">
        <a
          className={`mobile-nav-tab ${activeTab === 'all' ? 'on' : ''}`}
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('all');
          }}
        >
          <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
            <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"></path>
          </svg>
          <span>Trang chủ</span>
        </a>

        <a
          className={`mobile-nav-tab ${activeTab === 'explore' ? 'on' : ''}`}
          href="/?browse=1"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('explore');
          }}
        >
          <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 6.5-2 5-5 2 2-5z"></path>
          </svg>
          <span>Khám phá</span>
        </a>

        <a
          className={`mobile-nav-tab ${activeTab === 'television' ? 'on' : ''}`}
          href="/tv"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('television');
          }}
        >
          <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
            <path d="M4 8h16v10H4zM9 8 6 4M15 8l3-4M9 21h6"></path>
          </svg>
          <span>Truyền hình</span>
        </a>

        <a
          className={`mobile-nav-tab ${activeTab === 'sports' ? 'on' : ''}`}
          href="/sports"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('sports');
          }}
        >
          <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 2v20M2.5 9h19M2.5 15h19"></path>
          </svg>
          <span>Thể thao</span>
        </a>

        <a
          className={`mobile-nav-tab ${activeTab === 'favourites' ? 'on' : ''}`}
          href="/favourites"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('favourites');
          }}
        >
          <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
            <path d="M3 6h11M3 12h8M3 18h8M15 15l2.5 2.5L22 13"></path>
          </svg>
          <span>Danh sách</span>
        </a>

        <button
          type="button"
          className={`mobile-nav-tab mobile-nav-more ${showMoreMenu ? 'on' : ''}`}
          aria-expanded={showMoreMenu}
          onClick={() => {
            setShowMoreMenu((prev) => !prev);
            onMoreClick?.();
          }}
        >
          <svg viewBox="0 0 24 24" className="side-ico" aria-hidden="true">
            <path d="M5 12h.01M12 12h.01M19 12h.01"></path>
          </svg>
          <span>Thêm</span>
        </button>
      </nav>

      {/* More Menu Dropup for mobile */}
      {showMoreMenu && (
        <div
          style={{
            position: 'fixed',
            bottom: '68px',
            right: '16px',
            background: 'var(--panel, #111622)',
            border: '1px solid var(--border, #242b3c)',
            borderRadius: '12px',
            padding: '8px',
            zIndex: 100,
            boxShadow: 'var(--shadow-lg, 0 20px 40px rgba(0,0,0,0.8))',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minWidth: '150px',
          }}
        >
          <button
            type="button"
            className="chip"
            style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
            onClick={() => {
              onTabChange('movie');
              setShowMoreMenu(false);
            }}
          >
            Phim Lẻ
          </button>
          <button
            type="button"
            className="chip"
            style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
            onClick={() => {
              onTabChange('tv');
              setShowMoreMenu(false);
            }}
          >
            Phim Bộ
          </button>
          <button
            type="button"
            className="chip"
            style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
            onClick={() => {
              onTabChange('genres');
              setShowMoreMenu(false);
            }}
          >
            Thể Loại
          </button>
        </div>
      )}
    </>
  );
};
