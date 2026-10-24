import React, { useState } from 'react';
import { Film, Search, Tv, Clapperboard, Sparkles } from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onSearch: (query: string) => void;
  totalMovies: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  onSearch,
  totalMovies,
}) => {
  const [searchValue, setSearchValue] = useState('');

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchValue(val);
    onSearch(val);
  };

  return (
    <header className="glass-nav fixed top-0 left-0 right-0 z-40 px-6 py-3 flex items-center justify-between" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 32px' }}>
      {/* Brand Logo */}
      <div
        className="flex items-center gap-3 cursor-pointer"
        style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
        onClick={() => {
          onTabChange('all');
          setSearchValue('');
          onSearch('');
        }}
      >
        <div style={{ background: '#e50914', borderRadius: '8px', padding: '6px', display: 'flex' }}>
          <Film size={22} color="#ffffff" />
        </div>
        <div>
          <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.03em', color: '#fff' }}>
            FILM<span style={{ color: '#e50914' }}>4K</span>
          </span>
          <span style={{ fontSize: '0.65rem', marginLeft: '6px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: '#9494a8' }}>
            CINEMA
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={() => onTabChange('all')}
          style={{
            background: activeTab === 'all' ? 'rgba(229, 9, 20, 0.15)' : 'transparent',
            color: activeTab === 'all' ? '#ff4d58' : '#9494a8',
            border: activeTab === 'all' ? '1px solid rgba(229, 9, 20, 0.4)' : '1px solid transparent',
            borderRadius: '8px',
            padding: '6px 14px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s',
          }}
        >
          <Sparkles size={16} />
          Tất cả ({totalMovies})
        </button>

        <button
          onClick={() => onTabChange('movie')}
          style={{
            background: activeTab === 'movie' ? 'rgba(229, 9, 20, 0.15)' : 'transparent',
            color: activeTab === 'movie' ? '#ff4d58' : '#9494a8',
            border: activeTab === 'movie' ? '1px solid rgba(229, 9, 20, 0.4)' : '1px solid transparent',
            borderRadius: '8px',
            padding: '6px 14px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s',
          }}
        >
          <Clapperboard size={16} />
          Phim Lẻ
        </button>

        <button
          onClick={() => onTabChange('tv')}
          style={{
            background: activeTab === 'tv' ? 'rgba(229, 9, 20, 0.15)' : 'transparent',
            color: activeTab === 'tv' ? '#ff4d58' : '#9494a8',
            border: activeTab === 'tv' ? '1px solid rgba(229, 9, 20, 0.4)' : '1px solid transparent',
            borderRadius: '8px',
            padding: '6px 14px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s',
          }}
        >
          <Tv size={16} />
          Phim Bộ
        </button>
      </nav>

      {/* Search Input */}
      <div style={{ position: 'relative', width: '280px' }}>
        <Search
          size={16}
          color="#9494a8"
          style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
        />
        <input
          type="text"
          value={searchValue}
          onChange={handleSearchChange}
          placeholder="Tìm phim, diễn viên..."
          style={{
            width: '100%',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '20px',
            padding: '8px 16px 8px 36px',
            color: '#fff',
            fontSize: '0.85rem',
            outline: 'none',
            transition: 'border 0.2s, background 0.2s',
          }}
        />
      </div>
    </header>
  );
};
