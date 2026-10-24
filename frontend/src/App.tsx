import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { Navbar } from './components/Navbar';
import { Billboard } from './components/Billboard';
import { MovieCard } from './components/MovieCard';
import { MovieGridSkeleton, BillboardSkeleton } from './components/MovieSkeleton';
import { MovieSummary, MoviesResponse } from './types';
import { Sparkles, Clapperboard, Tv } from 'lucide-react';

const PlayerModal = React.lazy(() =>
  import('./components/PlayerModal').then((m) => ({ default: m.PlayerModal }))
);

export const App: React.FC = () => {
  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMovieSlug, setSelectedMovieSlug] = useState<string | null>(null);

  // Load movies from API
  const fetchMovies = (tab: string, search: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'all') {
      params.set('type', tab);
    }
    if (search.trim()) {
      params.set('search', search.trim());
    }
    params.set('limit', '48');

    fetch(`/api/movies?${params.toString()}`)
      .then((res) => res.json())
      .then((data: MoviesResponse) => {
        setMovies(data.movies || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch movies:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchMovies(activeTab, searchQuery);
  }, [activeTab, searchQuery]);

  // Featured movie for the Billboard banner
  const featuredMovie = useMemo(() => {
    if (movies.length === 0) return null;
    // Prefer highest score 4K movie or first one
    return movies.find((m) => m.backdrop) || movies[0];
  }, [movies]);

  const handlePlayMovie = (movie: MovieSummary) => {
    setSelectedMovieSlug(movie.slug);
  };

  const handleMoreInfo = (movie: MovieSummary) => {
    setSelectedMovieSlug(movie.slug);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0c', paddingBottom: '80px' }}>
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        onSearch={(q) => setSearchQuery(q)}
        totalMovies={total}
      />

      {/* Hero Billboard Banner */}
      {!searchQuery && (
        loading && !featuredMovie ? (
          <BillboardSkeleton />
        ) : (
          <Billboard movie={featuredMovie} onPlay={handlePlayMovie} onMoreInfo={handleMoreInfo} />
        )
      )}

      {/* Movie Section / Catalog */}
      <main style={{ maxWidth: '1440px', margin: '0 auto', padding: searchQuery ? '90px 32px 0' : '20px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {activeTab === 'all' && <Sparkles size={22} color="#e50914" />}
            {activeTab === 'movie' && <Clapperboard size={22} color="#e50914" />}
            {activeTab === 'tv' && <Tv size={22} color="#e50914" />}
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff' }}>
              {searchQuery
                ? `Kết quả tìm kiếm cho "${searchQuery}" (${total})`
                : activeTab === 'all'
                ? 'Kho Phim 4K Đỉnh Cao'
                : activeTab === 'movie'
                ? 'Phim Lẻ 4K Chiếu Rạp'
                : 'Phim Bộ Đang Hot'}
            </h2>
          </div>
          <span style={{ fontSize: '0.85rem', color: '#9494a8' }}>
            {loading ? 'Đang tải...' : `Hiển thị ${movies.length} / ${total} phim`}
          </span>
        </div>

        {/* Loading state: Netflix Skeleton Grid */}
        {loading && <MovieGridSkeleton count={24} />}

        {/* Empty state */}
        {!loading && movies.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#9494a8' }}>
            <p style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Không tìm thấy phim phù hợp</p>
            <p style={{ fontSize: '0.85rem' }}>Thử tìm kiếm với từ khóa khác xem sao bạn nhé</p>
          </div>
        )}

        {/* Movie Grid */}
        {!loading && movies.length > 0 && (
          <div
            className="animate-fade-in"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '20px',
            }}
          >
            {movies.map((movie) => (
              <MovieCard key={movie.id} movie={movie} onClick={handlePlayMovie} />
            ))}
          </div>
        )}
      </main>

      {/* Cinematic Player Modal */}
      {selectedMovieSlug && (
        <Suspense fallback={null}>
          <PlayerModal
            slug={selectedMovieSlug}
            onClose={() => setSelectedMovieSlug(null)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;
