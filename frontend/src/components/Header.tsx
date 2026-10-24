import React, { useState } from 'react';

interface HeaderProps {
  onSearch: (query: string) => void;
  onBrandClick?: () => void;
  onPairClick?: () => void;
  onAppClick?: () => void;
  onSignInClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onSearch,
  onBrandClick,
  onPairClick,
  onAppClick,
  onSignInClick,
}) => {
  const [searchValue, setSearchValue] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchValue(val);
    onSearch(val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchValue);
  };

  return (
    <header className="site">
      <div className="wrap">
        <a
          className="brand side-only-hidden"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onBrandClick?.();
          }}
        >
          Film4k
        </a>

        <form className="search" onSubmit={handleSubmit}>
          <input
            inputMode="search"
            autoComplete="off"
            placeholder="Search…"
            aria-label="Search movies"
            type="search"
            value={searchValue}
            onChange={handleChange}
            name="q"
          />
        </form>

        <span className="spacer"></span>

        <a
          className="app-soon"
          title="Download the Film4k app"
          href="/app"
          onClick={(e) => {
            e.preventDefault();
            onAppClick?.();
          }}
        >
          Get the app
        </a>

        <a
          className="side-pair header-pair-btn"
          title="Pair TV / Device"
          href="/login?mode=code"
          onClick={(e) => {
            e.preventDefault();
            onPairClick?.();
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M4 6h16v10H4zM9 8 6 4M15 8l3-4M9 21h6M8 11h8M12 9v4"></path>
          </svg>
          <span>Pair TV / Device</span>
        </a>

        <button className="ghost locale" type="button" aria-label="Change language">
          VI
        </button>

        <div className="header-account side-only-hidden">
          <div className="auth-btns">
            <a
              className="ghost side-pair"
              title="Quick Code Login"
              href="/login?mode=code"
              onClick={(e) => {
                e.preventDefault();
                onPairClick?.();
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M4 6h16v10H4zM9 8 6 4M15 8l3-4M9 21h6M8 11h8M12 9v4"></path>
              </svg>
              <span>Quick Code Login</span>
            </a>
            <a
              className="ghost side-signin"
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                onSignInClick?.();
              }}
            >
              Sign in
            </a>
          </div>
        </div>
      </div>
    </header>
  );
};
