import React from 'react';

export const MovieCardSkeleton: React.FC = () => {
  return (
    <div
      className="skeleton-card"
      style={{
        aspectRatio: '2/3',
        position: 'relative',
        borderRadius: '12px',
        overflow: 'hidden',
        background: '#14141c',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '12px',
      }}
    >
      {/* Background Shimmer */}
      <div
        className="skeleton-shimmer"
        style={{
          position: 'absolute',
          inset: 0,
        }}
      />

      {/* Top badges placeholder */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div
          className="skeleton-line"
          style={{ width: '36px', height: '18px', borderRadius: '4px' }}
        />
        <div
          className="skeleton-line"
          style={{ width: '48px', height: '18px', borderRadius: '4px' }}
        />
      </div>

      {/* Bottom info placeholder */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          position: 'relative',
          zIndex: 2,
          paddingTop: '30px',
        }}
      >
        <div
          className="skeleton-line"
          style={{ width: '85%', height: '14px', borderRadius: '4px' }}
        />
        <div
          className="skeleton-line"
          style={{ width: '55%', height: '11px', borderRadius: '4px' }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '4px',
          }}
        >
          <div
            className="skeleton-line"
            style={{ width: '40%', height: '11px', borderRadius: '4px' }}
          />
          <div
            className="skeleton-line"
            style={{ width: '28px', height: '28px', borderRadius: '50%' }}
          />
        </div>
      </div>
    </div>
  );
};

export const MovieGridSkeleton: React.FC<{ count?: number }> = ({ count = 18 }) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '20px',
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <MovieCardSkeleton key={i} />
      ))}
    </div>
  );
};

export const BillboardSkeleton: React.FC = () => {
  return (
    <div
      style={{
        position: 'relative',
        height: '70vh',
        minHeight: '480px',
        maxHeight: '700px',
        width: '100%',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-end',
        padding: '0 48px 60px',
        background: '#0e0e14',
      }}
    >
      <div
        className="skeleton-shimmer"
        style={{
          position: 'absolute',
          inset: 0,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to top, #0a0a0c 10%, rgba(10,10,12,0.6) 50%, rgba(10,10,12,0.2) 100%)',
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          maxWidth: '640px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <div className="skeleton-line" style={{ width: '80px', height: '20px', borderRadius: '4px' }} />
          <div className="skeleton-line" style={{ width: '50px', height: '20px', borderRadius: '4px' }} />
          <div className="skeleton-line" style={{ width: '45px', height: '20px', borderRadius: '4px' }} />
        </div>
        <div className="skeleton-line" style={{ width: '80%', height: '48px', borderRadius: '8px' }} />
        <div className="skeleton-line" style={{ width: '45%', height: '20px', borderRadius: '6px' }} />
        <div style={{ display: 'flex', gap: '8px', margin: '8px 0' }}>
          <div className="skeleton-line" style={{ width: '65px', height: '24px', borderRadius: '12px' }} />
          <div className="skeleton-line" style={{ width: '80px', height: '24px', borderRadius: '12px' }} />
          <div className="skeleton-line" style={{ width: '70px', height: '24px', borderRadius: '12px' }} />
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div className="skeleton-line" style={{ width: '150px', height: '42px', borderRadius: '8px' }} />
          <div className="skeleton-line" style={{ width: '120px', height: '42px', borderRadius: '8px' }} />
        </div>
      </div>
    </div>
  );
};
