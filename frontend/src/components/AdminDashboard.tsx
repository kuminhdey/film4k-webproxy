import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Film,
  Zap,
  Activity,
  Clock,
  Play,
  Square,
  RefreshCw,
  Flame,
  Shield,
  Lock,
  Eye,
  EyeOff,
  Search,
  Trash2,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  LogOut,
  ArrowLeft,
  ExternalLink,
  Loader2,
  Radio,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  HardDrive,
  Download,
} from 'lucide-react';
import { AdminStats, AdminLogEntry, MovieSummary, MoviesResponse } from '../types';
import { crawlerStatusLabel } from '../crawlerStatus';

interface AdminDashboardProps {
  onNavigate: (path: string) => void;
}

const STORAGE_AUTH_KEY = 'bofilm_admin_token';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  // Authentication state (bounded to active browser session/tab, avoiding persistent localStorage)
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(STORAGE_AUTH_KEY));
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Handle session expiration / unauthorized response: reset state and redirect immediately to login gate
  const handleAuthExpired = useCallback((reason?: string) => {
    sessionStorage.removeItem(STORAGE_AUTH_KEY);
    setToken(null);
    setPasswordInput('');
    setAuthError(reason || 'Phiên làm việc đã hết hạn hoặc máy chủ đã được khởi động lại. Vui lòng đăng nhập lại.');
    setLogs([]);
    setLogsConnected(false);
    setMoviesList([]);
  }, []);

  // Universal admin fetch wrapper that automatically appends Authorization header
  // and catches 401/403 status to instantly redirect to the login gate.
  const adminFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers || {});
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      try {
        const res = await fetch(input, { ...init, headers });
        if (res.status === 401 || res.status === 403) {
          handleAuthExpired('Phiên làm việc đã hết hạn hoặc mã xác thực không hợp lệ. Vui lòng đăng nhập lại.');
        }
        return res;
      } catch (err) {
        throw err;
      }
    },
    [token, handleAuthExpired]
  );

  // Stats & Progress state (initialized empty, populated from live /api/admin/stats)
  const [stats, setStats] = useState<AdminStats>({
    total_movies: 0,
    total_series: 0,
    total_single: 0,
    total_source_movies: 0,
    remaining_movies: 0,
    cached_m3u8_count: 0,
    crawler_is_running: false,
    crawler_auto_enabled: false,
    crawler_progress_percent: 0,
    crawler_processed: 0,
    crawler_total: 0,
    crawler_current_movie: '',
    crawler_last_run: '',
    crawler_last_status: 'Sẵn sàng',
  });
  const [statsLoading, setStatsLoading] = useState(false);

  // Confirmation modal state
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Logs state
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsConnected, setLogsConnected] = useState(false);
  const [hasOlderLogs, setHasOlderLogs] = useState(false);
  const [olderLogsLoading, setOlderLogsLoading] = useState(false);
  const newestLogId = useRef(0);
  const oldestLogId = useRef<number | null>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const terminalLogsEndRef = useRef<HTMLDivElement>(null);

  // Movie table state
  const [moviesList, setMoviesList] = useState<MovieSummary[]>([]);
  const [moviesTotal, setMoviesTotal] = useState(0);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [moviesError, setMoviesError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'movie' | 'tv' | 'cached' | 'uncached'>('all');
  const [clearingCacheSlug, setClearingCacheSlug] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [jumpPageInput, setJumpPageInput] = useState('');

  // Live clock
  const [currentTimeStr, setCurrentTimeStr] = useState(new Date().toLocaleTimeString('vi-VN'));

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeStr(new Date().toLocaleTimeString('vi-VN'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const MAX_LOG_ENTRIES = 200;

  // Helper to add log
  const addLog = (level: AdminLogEntry['level'], message: string) => {
    const newEntry: AdminLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString('vi-VN'),
      level,
      message,
    };
    setLogs((prev) => {
      const next = [...prev, newEntry];
      return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
    });
  };

  const mergeServerLogs = (incoming: AdminLogEntry[]) => {
    const visible = incoming.filter((entry) => typeof entry.id === 'number');
    if (visible.length === 0) return;
    setLogs((previous) => {
      const byId = new Map<string | number, AdminLogEntry>();
      for (const log of previous) byId.set(log.id, log);
      for (const log of visible) byId.set(log.id, log);
      const sorted = [...byId.values()].sort((a, b) => {
        if (typeof a.id === 'number' && typeof b.id === 'number') return a.id - b.id;
        return typeof a.id === 'number' ? -1 : 1;
      });
      return sorted.length > MAX_LOG_ENTRIES ? sorted.slice(sorted.length - MAX_LOG_ENTRIES) : sorted;
    });
  };

  useEffect(() => {
    if (!token) {
      setLogs([]);
      setLogsConnected(false);
      return;
    }
    let active = true;
    let polling = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    newestLogId.current = 0;
    oldestLogId.current = null;
    setLogs([]);
    setLogsConnected(false);
    setLogsError(null);
    setHasOlderLogs(false);

    const loadNew = async (initial: boolean) => {
      if (!active || polling || document.hidden || document.visibilityState !== 'visible') return;
      polling = true;
      try {
        let more = true;
        let first = initial;
        while (more && active) {
          const url = first ? '/api/admin/logs?limit=100' : `/api/admin/logs?after_id=${newestLogId.current}&limit=500`;
          const response = await adminFetch(url, { cache: 'no-store' });
          if (response.status === 401 || response.status === 403) return;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data: { logs: AdminLogEntry[]; has_more: boolean } = await response.json();
          if (!active) return;
          mergeServerLogs(data.logs);
          for (const entry of data.logs) {
            if (typeof entry.id !== 'number') continue;
            newestLogId.current = Math.max(newestLogId.current, entry.id);
            oldestLogId.current = Math.min(oldestLogId.current ?? entry.id, entry.id);
          }
          if (first) setHasOlderLogs(data.has_more);
          more = !first && data.has_more && data.logs.length > 0;
          first = false;
        }
        setLogsConnected(true);
        setLogsError(null);
      } catch (error) {
        if (active) {
          setLogsConnected(false);
          setLogsError(error instanceof Error ? error.message : 'Không thể tải logs');
        }
      } finally {
        polling = false;
      }
    };

    const startPolling = (isInitial: boolean) => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      void loadNew(isInitial);
      pollTimer = setInterval(() => {
        if (document.hidden || document.visibilityState !== 'visible') return;
        void loadNew(false);
      }, 1500);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden || document.visibilityState !== 'visible') {
        stopPolling();
      } else {
        startPolling(false);
      }
    };

    if (!document.hidden && document.visibilityState === 'visible') {
      startPolling(true);
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [token, adminFetch]);

  const loadOlderLogs = async () => {
    if (!token || oldestLogId.current === null || olderLogsLoading) return;
    setAutoScrollLogs(false);
    setOlderLogsLoading(true);
    try {
      const response = await adminFetch(`/api/admin/logs?before_id=${oldestLogId.current}&limit=100`, { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: { logs: AdminLogEntry[]; has_more: boolean } = await response.json();
      mergeServerLogs(data.logs);
      for (const entry of data.logs) if (typeof entry.id === 'number') oldestLogId.current = Math.min(oldestLogId.current ?? entry.id, entry.id);
      setHasOlderLogs(data.has_more);
      setLogsError(null);
    } catch (error) {
      setLogsError(error instanceof Error ? error.message : 'Không thể tải logs cũ');
    } finally {
      setOlderLogsLoading(false);
    }
  };

  const exportLogs = async () => {
    if (!token) return;
    try {
      const response = await adminFetch('/api/admin/logs/export', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'admin-task-logs.jsonl';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setLogsError(error instanceof Error ? error.message : 'Không thể xuất logs');
    }
  };

  // Auto scroll logs inside container without scrolling window/viewport
  useEffect(() => {
    if (autoScrollLogs && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScrollLogs]);

  // Show toast notification
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Auth Submit
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) {
      setAuthError('Vui lòng nhập mật khẩu quản trị');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        const savedToken = data.token;
        if (savedToken) {
          sessionStorage.setItem(STORAGE_AUTH_KEY, savedToken);
          setToken(savedToken);
          addLog('success', 'Đăng nhập phiên quản trị thành công.');
        } else {
          setAuthError('Không nhận được token xác thực từ máy chủ.');
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setAuthError(errData.message || 'Mật khẩu quản trị không chính xác.');
        addLog('error', 'Xác thực quản trị thất bại: Mật khẩu không đúng.');
      }
    } catch {
      setAuthError('Không thể kết nối máy chủ quản trị. Vui lòng thử lại.');
      addLog('error', 'Lỗi kết nối API máy chủ quản trị.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout with server-side session invalidation
  const handleLogout = async () => {
    if (token) {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore network errors on logout
      }
    }
    sessionStorage.removeItem(STORAGE_AUTH_KEY);
    setToken(null);
    setPasswordInput('');
    addLog('info', 'Đã đăng xuất khỏi tài khoản quản trị.');
  };

  // Fetch Admin Stats
  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      const res = await adminFetch('/api/admin/stats');
      if (res.status === 401 || res.status === 403) return;
      if (res.ok) {
        const data: AdminStats = await res.json();
        setStats((prev) => ({
          ...prev,
          ...data,
          catalog_rows: data.catalog_rows ?? data.total_movies ?? 0,
          detail_rows: data.detail_rows ?? 0,
          crawler_auto_enabled:
            data.crawler_auto_enabled !== undefined
              ? data.crawler_auto_enabled
              : prev.crawler_auto_enabled ?? false,
          total_source_movies: data.total_source_movies ?? prev.total_source_movies ?? 0,
          remaining_movies:
            data.remaining_movies !== undefined
              ? data.remaining_movies
              : Math.max(0, (data.total_source_movies ?? prev.total_source_movies ?? 0) - (data.catalog_rows ?? data.total_movies ?? 0)),
        }));
      }
    } catch {
      // Keep existing stats silently on error
    } finally {
      setStatsLoading(false);
    }
  };

  // Format bytes helper for storage card
  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Fetch Movies list via internal admin endpoint
  const fetchMovies = async (
    page = currentPage,
    limit = pageSize,
    search = searchQuery,
    type = filterType
  ) => {
    setMoviesLoading(true);
    setMoviesError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (search.trim()) {
        params.set('search', search.trim());
      }
      if (type === 'movie' || type === 'tv') {
        params.set('type', type);
      }

      const res = await adminFetch(`/api/admin/movies?${params.toString()}`);
      if (res.status === 401 || res.status === 403) {
        // Token expired/invalid, adminFetch has already triggered handleAuthExpired()
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const rawMovies: any[] = data.movies || data.items || [];
        const normalizedMovies: MovieSummary[] = rawMovies.map((m) => ({
          ...m,
          name: m.name || m.title_vi || '',
          title_vi: m.title_vi || m.name || '',
          original_name: m.original_name || m.title_en || '',
          title_en: m.title_en || m.original_name || '',
          poster: m.poster || m.poster_url || m.thumb_url || '',
          movie_type: m.movie_type || (m.total_episodes && Number(m.total_episodes) > 1 ? 'tv' : 'movie'),
          has_cached_m3u8: Boolean(m.has_cached_m3u8),
        }));
        setMoviesList(normalizedMovies);
        setMoviesTotal(data.total || data.paginate?.total_items || normalizedMovies.length);
      } else {
        const errData = await res.json().catch(() => ({}));
        const errorMsg =
          errData.message ||
          errData.error ||
          `Máy chủ trả về mã lỗi ${res.status} (${res.statusText || 'Lỗi kết nối'})`;
        setMoviesError(errorMsg);
        addLog('error', `Lỗi tải danh sách phim từ /api/admin/movies: ${errorMsg}`);
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Không thể kết nối máy chủ để tải danh sách phim';
      setMoviesError(errorMsg);
      console.error('Failed to load movies list:', err);
      addLog('error', `Lỗi kết nối máy chủ: ${errorMsg}`);
    } finally {
      setMoviesLoading(false);
    }
  };

  // Total pages
  const totalPages = Math.max(1, Math.ceil(moviesTotal / pageSize));

  // Generate page numbers array for pagination bar
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) {
        pages.push('...');
      }
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) {
        pages.push('...');
      }
      pages.push(totalPages);
    }
    return pages;
  };

  // Polling stats
  useEffect(() => {
    if (!token) return;

    const pollInterval = stats.crawler_is_running ? 2000 : stats.crawler_auto_enabled ? 4000 : 8000;
    let timer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      fetchStats();
      timer = setInterval(() => {
        if (document.hidden || document.visibilityState !== 'visible') return;
        fetchStats();
      }, pollInterval);
    };

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden || document.visibilityState !== 'visible') {
        stopPolling();
      } else {
        startPolling();
      }
    };

    if (!document.hidden && document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [token, stats.crawler_is_running, stats.crawler_auto_enabled]);

  // Re-fetch movies when search, filter, page or pageSize changes
  useEffect(() => {
    if (!token) return;
    const timeout = setTimeout(() => {
      fetchMovies(currentPage, pageSize, searchQuery, filterType);
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchQuery, filterType, currentPage, pageSize, token]);

  // Crawler Controls
  const handleStartFullCrawl = async () => {
    setConfirmModalOpen(false);
    setActionLoading('start_full');
    const remainingCount =
      stats.remaining_movies !== undefined
        ? stats.remaining_movies
        : Math.max(0, (stats.total_source_movies ?? 0) - (stats.catalog_rows ?? stats.total_movies));
    const countText = remainingCount > 0 ? `${remainingCount.toLocaleString()} phim còn lại ` : '';
    addLog('info', `Lệnh: Bắt đầu Crawl Mở Rộng ${countText}(tổng kho phim ${(stats.total_source_movies ?? 0).toLocaleString()} phim)...`);

    try {
      const res = await adminFetch('/api/admin/crawler/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        addLog('success', data.message || 'Đã kích hoạt quét tự động mở rộng toàn bộ kho phim thành công.');
        showToast(`🚀 Đã kích hoạt cào dữ liệu mở rộng ${countText}!`);
        setStats((s) => ({ ...s, crawler_is_running: data.is_running === true, crawler_auto_enabled: data.auto_enabled === true }));
      } else {
        const errorMsg = data.message || data.error || 'Không thể bắt đầu crawl.';
        addLog('warn', errorMsg);
        showToast(`⚠️ ${errorMsg}`);
      }
      fetchStats();
    } catch (e: any) {
      addLog('error', `Lỗi khi kích hoạt crawler: ${e.message || 'Network error'}`);
      showToast('❌ Lỗi kết nối máy chủ');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateCrawl = async () => {
    setActionLoading('update');
    addLog('info', 'Lệnh: Quét Cập Nhật Phim Mới & Tập Mới...');

    try {
      const res = await adminFetch('/api/admin/crawler/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success !== true) throw new Error(data.message || data.error || 'Không thể bắt đầu cập nhật');
      addLog('success', data.message || 'Đang quét cập nhật các phim mới.');
      showToast('🔄 Đang quét cập nhật phim mới!');
      fetchStats();
    } catch (e: any) {
      addLog('error', `Lỗi quét cập nhật: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleWarmupCache = async () => {
    handleTriggerMode('stage3_m3u8', 'Làm nóng cache M3U8 (Stage 3 Scanner)');
  };

  const handleTriggerMode = async (mode: string, label: string) => {
    setActionLoading(mode);
    addLog('info', `Lệnh: ${label}...`);

    try {
      const res = await adminFetch('/api/admin/crawler/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode }),
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success !== true) throw new Error(data.message || data.error || `Không thể bắt đầu ${label}`);
      addLog('success', data.message || `Đã kích hoạt ${label}.`);
      showToast(`🚀 ${label} đang chạy!`);
      fetchStats();
    } catch (e: any) {
      addLog('error', `Lỗi ${label}: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStopCrawler = async () => {
    setActionLoading('stop');
    addLog('warn', 'Lệnh: Yêu cầu Dừng Tiến Trình Crawler...');

    try {
      const res = await adminFetch('/api/admin/crawler/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success !== true) throw new Error(data.message || data.error || 'Không thể dừng crawler');
      addLog('info', data.message || 'Đã gửi tín hiệu dừng crawler.');
      showToast('🛑 Đã yêu cầu dừng crawler');
      setStats((s) => ({ ...s, crawler_is_running: data.is_running === true, crawler_auto_enabled: false }));
      fetchStats();
    } catch (e: any) {
      addLog('error', `Lỗi dừng crawler: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearMovieCache = async (slug: string) => {
    setClearingCacheSlug(slug);
    addLog('info', `Đang xóa cache M3U8 của phim: ${slug}...`);

    try {
      const res = await adminFetch(`/api/admin/cache/clear/${slug}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await res.json().catch(() => ({}));
      addLog('success', data.message || `Đã xóa sạch cache M3U8 của ${slug}`);
      showToast(`🗑️ Đã xóa cache M3U8: ${slug}`);
      fetchStats();
    } catch (e: any) {
      addLog('error', `Lỗi khi xóa cache ${slug}: ${e.message}`);
    } finally {
      setClearingCacheSlug(null);
    }
  };

  const handleCopyLogs = async () => {
    const text = logs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch {
      setLogsError('Không thể sao chép logs đã tải');
    }
  };

  // Filtered movies
  const filteredMovies = useMemo(() => {
    return moviesList.filter((m) => {
      if (filterType === 'movie') return m.movie_type === 'movie';
      if (filterType === 'tv') return m.movie_type === 'tv';
      return true;
    });
  }, [moviesList, filterType]);

  // ==========================================
  // RENDER: AUTH GATE IF NOT LOGGED IN
  // ==========================================
  if (!token) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'radial-gradient(ellipse at 50% 20%, #171c2b 0%, #090b10 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          color: '#fff',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '440px',
            background: 'rgba(20, 24, 38, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(20px)',
            borderRadius: '16px',
            padding: '36px 32px',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.7), 0 0 1px rgba(255, 255, 255, 0.2)',
            position: 'relative',
          }}
        >
          {/* Top Logo Badge */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div
              style={{
                width: '68px',
                height: '68px',
                margin: '0 auto 16px',
                borderRadius: '18px',
                background: 'linear-gradient(135deg, rgba(174, 234, 0, 0.25), rgba(132, 204, 22, 0.2))',
                border: '1px solid rgba(174, 234, 0, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(174, 234, 0, 0.3)',
              }}
            >
              <img src="/logo.png" alt="Bơ Film" style={{ width: '44px', height: '44px', objectFit: 'contain' }} />
            </div>
            <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 6px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <span style={{ color: '#aeea00' }}>Bơ</span>
              <span style={{ color: '#fcfdf7' }}>Film</span>
              <span style={{ color: '#cbd8cb', fontWeight: 600 }}>Admin</span>
            </h1>
            <p style={{ fontSize: '13px', color: '#94a896', margin: 0, lineHeight: 1.5 }}>
              Cổng quản trị bảo mật • Điều khiển Crawler & Cache Playlist M3U8
            </p>
          </div>

          {/* Error Message */}
          {authError && (
            <div
              style={{
                background: 'rgba(229, 9, 20, 0.15)',
                border: '1px solid rgba(229, 9, 20, 0.4)',
                borderRadius: '10px',
                padding: '12px 14px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '13px',
                color: '#ff6b6b',
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <span>{authError}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#b3b9c9',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Mật khẩu Quản trị
              </label>
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Lock
                  size={18}
                  style={{
                    position: 'absolute',
                    left: '14px',
                    color: '#6b7280',
                  }}
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Nhập mật khẩu quản trị..."
                  autoFocus
                  style={{
                    width: '100%',
                    height: '46px',
                    padding: '0 44px 0 42px',
                    background: 'rgba(10, 14, 23, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '10px',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#84cc16')}
                  onBlur={(e) => (e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    color: '#8b95ad',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              style={{
                width: '100%',
                height: '46px',
                background: 'linear-gradient(135deg, #aeea00 0%, #84cc16 100%)',
                border: 'none',
                borderRadius: '10px',
                color: '#070e08',
                fontSize: '14px',
                fontWeight: 700,
                cursor: authLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 6px 20px rgba(174, 234, 0, 0.4)',
                transition: 'all 0.2s',
              }}
            >
              {authLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Đang xác thực...</span>
                </>
              ) : (
                <>
                  <Shield size={18} />
                  <span>Đăng Nhập Quản Trị</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Back to Cinema */}
          <div style={{ marginTop: '24px', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => onNavigate('/')}
              style={{
                background: 'none',
                border: 'none',
                color: '#8b95ad',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#8b95ad')}
            >
              <ArrowLeft size={14} />
              <span>Quay lại Trang Chủ Cinema</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: MAIN ADMIN DASHBOARD
  // ==========================================
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        maxWidth: '100vw',
        background: '#090b10',
        color: '#e2e8f0',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        paddingBottom: '60px',
      }}
    >
      <style>{`
        @media (max-width: 640px) {
          .admin-dashboard-header { height: auto !important; min-height: 64px; flex-wrap: wrap; gap: 10px; padding: 10px 16px !important; }
          .admin-dashboard-header-left, .admin-dashboard-header-right { min-width: 0; flex-wrap: wrap; }
          .admin-dashboard-header-right { width: 100%; justify-content: space-between; gap: 8px !important; }
          .admin-dashboard-header-live, .admin-dashboard-header-clock { display: none !important; }
          .admin-dashboard-main { padding: 0 16px !important; }
          .admin-dashboard-title, .admin-dashboard-progress-head { flex-wrap: wrap; gap: 12px; }
          .admin-dashboard-terminal-bar { height: auto !important; min-height: 40px; flex-wrap: wrap; gap: 6px; padding: 8px 12px !important; }
          .admin-dashboard-terminal-bar > div:first-child { min-width: 0; max-width: 100%; }
          .admin-dashboard-terminal-label { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        }
      `}</style>
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '24px',
            zIndex: 9999,
            background: 'rgba(20, 24, 38, 0.95)',
            border: '1px solid rgba(132, 204, 22, 0.3)',
            borderRadius: '10px',
            padding: '12px 20px',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6)',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 500,
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <CheckCircle2 size={18} color="#10b981" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navbar */}
      <header
        className="admin-dashboard-header"
        style={{
          height: '64px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(15, 18, 29, 0.85)',
          backdropFilter: 'blur(16px)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
        }}
      >
        <div className="admin-dashboard-header-left" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('/')}
          >
            <img
              src="/logo.png"
              alt="Bơ Film"
              style={{ width: '34px', height: '34px', objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(174, 234, 0, 0.4))' }}
            />
            <div>
              <span style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em', display: 'inline-flex', gap: '4px' }}>
                <span style={{ color: '#aeea00' }}>Bơ</span>
                <span style={{ color: '#fcfdf7' }}>Film</span>
                <span style={{ color: '#cbd8cb', fontWeight: 600 }}>Admin</span>
              </span>
              <span
                style={{
                  marginLeft: '8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  background: 'rgba(174, 234, 0, 0.15)',
                  color: '#aeea00',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  border: '1px solid rgba(174, 234, 0, 0.3)',
                }}
              >
                PRO CONTROL
              </span>
            </div>
          </div>

          {/* Live indicator */}
          <div
            className="admin-dashboard-header-live"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              background: 'rgba(16, 185, 129, 0.1)',
              borderRadius: '20px',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              fontSize: '12px',
              color: '#10b981',
              fontWeight: 500,
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 8px #10b981',
              }}
            />
            <span>Hệ Thống Trực Tuyến</span>
          </div>
        </div>

        {/* Right Nav actions */}
        <div className="admin-dashboard-header-right" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            className="admin-dashboard-header-clock"
            style={{
              fontSize: '13px',
              color: '#8b95ad',
              fontVariantNumeric: 'tabular-nums',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Clock size={15} />
            <span>{currentTimeStr}</span>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('/')}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#e2e8f0',
              padding: '7px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
          >
            <ExternalLink size={14} />
            <span>Xem Web Cinema</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              padding: '7px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#ef4444';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)';
              e.currentTarget.style.color = '#f87171';
            }}
          >
            <LogOut size={14} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="admin-dashboard-main" style={{ maxWidth: '1320px', minWidth: 0, margin: '28px auto 0', padding: '0 24px' }}>
        {/* Title & Refresh */}
        <div
          className="admin-dashboard-title"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '24px',
          }}
        >
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 6px', color: '#fff' }}>
              Bảng Điều Khiển Quản Trị
            </h2>
            <p style={{ fontSize: '14px', color: '#8b95ad', margin: 0 }}>
              Giám sát tiến trình nạp dữ liệu phim, tự động tạo cache playlist M3U8 và quản lý máy chủ streaming
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              fetchStats();
              fetchMovies();
              showToast('Đã làm mới dữ liệu thống kê');
            }}
            disabled={statsLoading}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <RefreshCw size={15} className={statsLoading ? 'animate-spin' : ''} />
            <span>Làm Mới Số Liệu</span>
          </button>
        </div>

        {/* 1. Realtime Stat Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          {/* Card 1: Total Movies */}
          <div
            style={{
              background: 'rgba(20, 24, 38, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '20px 22px',
              backdropFilter: 'blur(10px)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#8b95ad', textTransform: 'uppercase' }}>
                Tổng Số Phim
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '20px',
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stats.total_source_movies ? Math.min(100, (((stats.catalog_rows ?? stats.total_movies) / stats.total_source_movies) * 100)).toFixed(1) : '0.0'}% tổng kho phim
                </span>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Film size={20} color="#38bdf8" />
                </div>
              </div>
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
              Catalog: {(stats.catalog_rows ?? stats.total_movies).toLocaleString()} / {(stats.total_source_movies ?? 0).toLocaleString()} phim
            </div>
            <div style={{ marginTop: '6px', fontSize: '13px', fontWeight: 700, color: '#38bdf8' }}>
              Đủ chi tiết / tập: {(stats.detail_rows ?? 0).toLocaleString()} phim ({stats.total_source_movies ? Math.min(100, ((stats.detail_rows ?? 0) / stats.total_source_movies) * 100).toFixed(1) : '0.0'}% bao phủ)
            </div>
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>
              Phim lẻ: {stats.total_single.toLocaleString()} • Phim bộ: {stats.total_series.toLocaleString()}
            </div>
            <div style={{ marginTop: '6px', fontSize: '13px', fontWeight: 700, color: '#a3e635' }}>
              {(stats.remaining_movies ?? Math.max(0, (stats.total_source_movies ?? 0) - (stats.catalog_rows ?? stats.total_movies))) === 0
                ? 'Còn lại chưa có catalog: 0 phim (Đã bao phủ 100% tổng kho phim)'
                : `Còn lại chưa có catalog: ${(stats.remaining_movies ?? Math.max(0, (stats.total_source_movies ?? 0) - (stats.catalog_rows ?? stats.total_movies))).toLocaleString()} phim`}
            </div>
          </div>

          {/* Card 2: Cached M3U8 */}
          <div
            style={{
              background: 'rgba(20, 24, 38, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '20px 22px',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#8b95ad', textTransform: 'uppercase' }}>
                Playlist cache trong SQLite
              </span>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'rgba(132, 204, 22, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Zap size={20} color="#a3e635" />
              </div>
            </div>
            <div style={{ fontSize: '30px', fontWeight: 800, color: '#a3e635', lineHeight: 1 }}>
              {stats.cached_m3u8_count.toLocaleString()}
            </div>
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>Số mục bắt đầu bằng #EXTM3U; chưa xác minh phát lại hoặc chất lượng 4K.</span>
            </div>
          </div>

          {/* Card 3: Storage / Disk Usage */}
          <div
            style={{
              background: 'rgba(20, 24, 38, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '20px 22px',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#8b95ad', textTransform: 'uppercase' }}>
                Dung Lượng Đĩa
              </span>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'rgba(132, 204, 22, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <HardDrive size={20} color="#a3e635" />
              </div>
            </div>
            <div style={{ fontSize: '30px', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
              {stats.disk_usage?.human_readable || '0 B'}
            </div>
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#94a3b8' }}>
              {stats.disk_usage?.playlists_bytes !== undefined && stats.disk_usage?.database_bytes !== undefined ? (
                <span>
                  Cache: <strong style={{ color: '#a3e635' }}>{formatBytes(stats.disk_usage.playlists_bytes)}</strong> • DB:{' '}
                  <strong style={{ color: '#cbd5e1' }}>{formatBytes(stats.disk_usage.database_bytes)}</strong>
                </span>
              ) : (
                'Playlist Cache & SQLite Database'
              )}
            </div>
          </div>

          {/* Card 4: Crawler Status */}
          <div
            style={{
              background: 'rgba(20, 24, 38, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '20px 22px',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#8b95ad', textTransform: 'uppercase' }}>
                Trạng Thái Crawler
              </span>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: stats.crawler_is_running ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Activity size={20} color={stats.crawler_is_running ? '#10b981' : '#94a3b8'} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: stats.crawler_is_running ? '#10b981' : '#64748b',
                  boxShadow: stats.crawler_is_running ? '0 0 12px #10b981' : 'none',
                }}
              />
              <div style={{ fontSize: '17px', fontWeight: 800, color: stats.crawler_is_running ? '#10b981' : '#fff', lineHeight: 1.2 }}>
                {crawlerStatusLabel(stats.crawler_is_running, Boolean(stats.crawler_auto_enabled))}
              </div>
            </div>
            <div style={{ marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setConfirmModalOpen(true)}
                disabled={actionLoading !== null || stats.crawler_is_running || stats.crawler_auto_enabled}
                title={stats.crawler_is_running ? 'Crawler đang chạy, vui lòng đợi...' : stats.crawler_auto_enabled ? 'Chế độ tự động đã bật' : 'Kích hoạt crawler'}
                style={{
                  width: '100%',
                  background: stats.crawler_is_running ? 'rgba(255, 255, 255, 0.05)' : 'rgba(16, 185, 129, 0.12)',
                  border: `1px solid ${stats.crawler_is_running ? 'rgba(255, 255, 255, 0.1)' : 'rgba(16, 185, 129, 0.3)'}`,
                  color: stats.crawler_is_running ? '#94a3b8' : '#10b981',
                  padding: '6px 10px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: (stats.crawler_is_running || stats.crawler_auto_enabled) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  transition: 'all 0.2s',
                }}
              >
                {stats.crawler_is_running ? (
                  <>
                    <Lock size={12} />
                    <span>Crawler đang chạy, vui lòng đợi...</span>
                  </>
                ) : (
                  <>
                    <Play size={11} fill="currentColor" />
                    <span>{stats.crawler_auto_enabled ? 'Đã bật tự động' : 'Kích hoạt cào dữ liệu'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card 5: Last Run */}
          <div
            style={{
              background: 'rgba(20, 24, 38, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '20px 22px',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#8b95ad', textTransform: 'uppercase' }}>
                Lần Chạy Gần Nhất
              </span>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'rgba(168, 85, 247, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Clock size={20} color="#a855f7" />
              </div>
            </div>
            <div style={{ fontSize: '19px', fontWeight: 700, color: '#fff', lineHeight: 1.3, marginBottom: '6px' }}>
              {stats.crawler_last_run && stats.crawler_last_run.trim()
                ? stats.crawler_last_run.substring(0, 19).replace('T', ' ')
                : 'Chưa chạy'}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              {stats.crawler_processed > 0
                ? `Vị trí/đã duyệt ${stats.crawler_processed.toLocaleString()} phim`
                : 'Chu kỳ đồng bộ tự động mỗi 6 giờ'}
            </div>
          </div>
        </div>

        {/* 2. Dynamic Progress Bar */}
        {(() => {
          const crawlerPercent =
            stats.crawler_percent !== undefined ? stats.crawler_percent : (stats.crawler_progress_percent ?? 0);
          const totalDiscoveredCount = stats.crawler_total_discovered ?? stats.crawler_total ?? 0;
          const totalDiscoveredStr = totalDiscoveredCount > 0 ? totalDiscoveredCount.toLocaleString() : '0';

          return (
            <div
              style={{
                background: 'rgba(20, 24, 38, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '20px 24px',
                marginBottom: '24px',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div className="admin-dashboard-progress-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>
                    Tiến Trình Job Crawler
                  </span>
                  {stats.crawler_is_running ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        background: 'rgba(132, 204, 22, 0.15)',
                        color: '#a3e635',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        border: '1px solid rgba(132, 204, 22, 0.3)',
                      }}
                    >
                      <Loader2 size={12} className="animate-spin" />
                      Đang đồng bộ...
                    </span>
                  ) : crawlerPercent >= 100 ? (
                    <span
                      style={{
                        padding: '2px 8px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#10b981',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        border: '1px solid rgba(16, 185, 129, 0.25)',
                      }}
                    >
                      Hoàn tất 100%
                    </span>
                  ) : (
                    <span
                      style={{
                        padding: '2px 8px',
                        background: crawlerPercent > 0 ? 'rgba(234, 179, 8, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                        color: crawlerPercent > 0 ? '#facc15' : '#94a3b8',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        border: `1px solid ${
                          crawlerPercent > 0 ? 'rgba(234, 179, 8, 0.3)' : 'rgba(148, 163, 184, 0.25)'
                        }`,
                      }}
                    >
                      {crawlerPercent > 0 ? `Tạm dừng (${Math.round(crawlerPercent)}%)` : (stats.crawler_last_status || 'Sẵn sàng')}
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '13px', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                  <strong style={{ color: '#fff' }}>
                  {stats.crawler_processed.toLocaleString()} / {totalDiscoveredStr}
                  </strong>{' '}
                  phim ({Math.round(crawlerPercent)}%)
                </div>
              </div>

              {/* Progress Bar Track */}
              <div
                style={{
                  width: '100%',
                  height: '10px',
                  background: 'rgba(10, 14, 23, 0.8)',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.max(crawlerPercent > 0 ? 2 : 0, crawlerPercent))}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #aeea00, #84cc16)',
                    borderRadius: '6px',
                    transition: 'width 0.4s ease-out',
                    boxShadow: stats.crawler_is_running ? '0 0 12px rgba(174, 234, 0, 0.5)' : 'none',
                  }}
                />
              </div>

              {stats.crawler_is_running && stats.crawler_current_movie && (
                <div style={{ marginTop: '10px', fontSize: '12px', color: '#8b95ad', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Radio size={14} color="#aeea00" className="animate-pulse" />
                  <span>Đang xử lý phim: <code style={{ color: '#aeea00' }}>{stats.crawler_current_movie}</code></span>
                </div>
              )}
            </div>
          );
        })()}

        {/* 3. Action Control Cluster */}
        <div
          style={{
            background: 'rgba(20, 24, 38, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '14px',
            padding: '22px 24px',
            marginBottom: '24px',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#fff', marginBottom: '14px' }}>
            Trung Tâm Điều Khiển Crawler & Cache
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {/* Action 1: Start Full Crawl */}
            <button
              type="button"
              onClick={() => setConfirmModalOpen(true)}
              disabled={actionLoading !== null || stats.crawler_is_running || stats.crawler_auto_enabled}
              title={stats.crawler_is_running ? 'Crawler đang chạy, vui lòng đợi...' : stats.crawler_auto_enabled ? 'Chế độ tự động đã bật' : undefined}
              style={{
                background: (stats.crawler_is_running || stats.crawler_auto_enabled)
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'linear-gradient(135deg, #aeea00 0%, #84cc16 100%)',
                border: 'none',
                color: (stats.crawler_is_running || stats.crawler_auto_enabled) ? '#64748b' : '#070e08',
                padding: '11px 20px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: (stats.crawler_is_running || stats.crawler_auto_enabled) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: (stats.crawler_is_running || stats.crawler_auto_enabled) ? 'none' : '0 4px 16px rgba(174, 234, 0, 0.35)',
                transition: 'all 0.2s',
              }}
            >
              {actionLoading === 'start_full' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : stats.crawler_is_running ? (
                <Lock size={16} />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              <span>
                {stats.crawler_is_running
                  ? 'Crawler đang chạy, vui lòng đợi...'
                  : stats.crawler_auto_enabled
                  ? 'Đã bật tự động, chờ đợt tiếp theo'
                  : `Cào tự động phim còn lại (${(stats.remaining_movies ?? 0).toLocaleString()} phim)`}
              </span>
            </button>

            {/* Stage 1: Catalog Sync */}
            <button
              type="button"
              onClick={() => handleTriggerMode('stage1_catalog', 'Stage 1: Đồng bộ Catalog')}
              disabled={actionLoading !== null || stats.crawler_is_running}
              style={{
                background: stats.crawler_is_running ? 'rgba(255, 255, 255, 0.04)' : 'rgba(168, 85, 247, 0.15)',
                border: `1px solid ${stats.crawler_is_running ? 'rgba(255, 255, 255, 0.08)' : 'rgba(168, 85, 247, 0.4)'}`,
                color: stats.crawler_is_running ? '#64748b' : '#c084fc',
                padding: '11px 18px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: stats.crawler_is_running ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
              }}
            >
              {actionLoading === 'stage1_catalog' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <HardDrive size={16} />
              )}
              <span>Stage 1: Đồng bộ Catalog</span>
            </button>

            {/* Stage 2: Detail Sync */}
            <button
              type="button"
              onClick={() => handleTriggerMode('stage2_detail', 'Stage 2: Cào Chi Tiết')}
              disabled={actionLoading !== null || stats.crawler_is_running}
              style={{
                background: stats.crawler_is_running ? 'rgba(255, 255, 255, 0.04)' : 'rgba(56, 189, 248, 0.15)',
                border: `1px solid ${stats.crawler_is_running ? 'rgba(255, 255, 255, 0.08)' : 'rgba(56, 189, 248, 0.4)'}`,
                color: stats.crawler_is_running ? '#64748b' : '#38bdf8',
                padding: '11px 18px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: stats.crawler_is_running ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
              }}
            >
              {actionLoading === 'stage2_detail' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Zap size={16} />
              )}
              <span>Stage 2: Cào Chi Tiết Đồng Thời</span>
            </button>

            {/* Stage 3: M3U8 Scanner */}
            <button
              type="button"
              onClick={() => handleTriggerMode('stage3_m3u8', 'Stage 3: Quét Cache M3U8')}
              disabled={actionLoading !== null || stats.crawler_is_running}
              style={{
                background: 'rgba(132, 204, 22, 0.15)',
                border: '1px solid rgba(132, 204, 22, 0.4)',
                color: '#a3e635',
                padding: '11px 18px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
              }}
            >
              {actionLoading === 'stage3_m3u8' || actionLoading === 'warmup' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Flame size={16} />
              )}
              <span>Stage 3: Quét Cache M3U8</span>
            </button>

            {/* Action 2: Update Crawl */}
            <button
              type="button"
              onClick={handleUpdateCrawl}
              disabled={actionLoading !== null || stats.crawler_is_running}
              title={stats.crawler_is_running ? 'Crawler đang chạy, vui lòng đợi...' : undefined}
              style={{
                background: stats.crawler_is_running ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.08)',
                border: `1px solid ${stats.crawler_is_running ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.2)'}`,
                color: stats.crawler_is_running ? '#64748b' : '#e2e8f0',
                padding: '11px 18px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: stats.crawler_is_running ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!stats.crawler_is_running) e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)';
              }}
              onMouseLeave={(e) => {
                if (!stats.crawler_is_running) e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)';
              }}
            >
              {actionLoading === 'update' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : stats.crawler_is_running ? (
                <Lock size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              <span>
                {stats.crawler_is_running ? 'Crawler đang chạy, vui lòng đợi...' : 'Quét Cập Nhật Phim Mới'}
              </span>
            </button>

            {/* Action 3: Warmup Hot Cache */}
            <button
              type="button"
              onClick={handleWarmupCache}
              disabled={actionLoading !== null || stats.crawler_is_running}
              style={{
                background: 'rgba(132, 204, 22, 0.12)',
                border: '1px solid rgba(132, 204, 22, 0.3)',
                color: '#a3e635',
                padding: '11px 18px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(132, 204, 22, 0.22)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(132, 204, 22, 0.12)')}
            >
              {actionLoading === 'warmup' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Flame size={16} />
              )}
              <span>Nạp Trước Dữ Liệu Phim Hot</span>
            </button>

            {/* Action 4: Stop Crawler */}
            <button
              type="button"
              onClick={handleStopCrawler}
              disabled={actionLoading !== null || (!stats.crawler_is_running && !stats.crawler_auto_enabled)}
              style={{
                background: (stats.crawler_is_running || stats.crawler_auto_enabled) ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                border: `1px solid ${(stats.crawler_is_running || stats.crawler_auto_enabled) ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                color: (stats.crawler_is_running || stats.crawler_auto_enabled) ? '#f87171' : '#64748b',
                padding: '11px 18px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: (stats.crawler_is_running || stats.crawler_auto_enabled) ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
              }}
            >
              {actionLoading === 'stop' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Square size={16} />
              )}
              <span>{stats.crawler_auto_enabled ? 'Tắt tự động & Dừng' : 'Dừng Crawler'}</span>
            </button>
          </div>
        </div>

        {/* 4. Live Terminal Logs Box */}
        <div
          style={{
            background: '#080b11',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '14px',
            overflow: 'hidden',
            marginBottom: '32px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.5)',
          }}
        >
          {/* Terminal Bar */}
          <div
            className="admin-dashboard-terminal-bar"
            style={{
              height: '40px',
              background: '#0d111a',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#ff5f56' }} />
              <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#ffbd2e' }} />
              <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#27c93f' }} />
              <span
                className="admin-dashboard-terminal-label"
                style={{
                  marginLeft: '10px',
                  fontSize: '12px',
                  fontFamily: 'JetBrains Mono, Menlo, monospace',
                  color: '#8b95ad',
                }}
              >
                Bơ Film admin task logs — server history
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setAutoScrollLogs(!autoScrollLogs)}
                title="Tự động cuộn theo log mới"
                style={{
                  background: autoScrollLogs ? 'rgba(56, 189, 248, 0.15)' : 'none',
                  border: 'none',
                  color: autoScrollLogs ? '#38bdf8' : '#8b95ad',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '6px',
                }}
              >
                Auto-scroll {autoScrollLogs ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={handleCopyLogs}
                title="Sao chép logs đã tải trên màn hình"
                style={{
                  background: 'none',
                  border: 'none',
                  color: copiedLogs ? '#10b981' : '#8b95ad',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                }}
              >
                {copiedLogs ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedLogs ? 'Đã sao chép' : `Copy ${logs.length} đã tải`}</span>
              </button>

              <button
                type="button"
                onClick={() => { void exportLogs(); }}
                title="Xuất toàn bộ lịch sử logs từ máy chủ"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8b95ad',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Download size={14} />
                <span style={{ fontSize: '11px' }}>Xuất tất cả</span>
              </button>
            </div>
          </div>

          {/* Terminal Body */}
          <div
            ref={logsContainerRef}
            style={{
              padding: '16px 20px',
              fontFamily: 'JetBrains Mono, Menlo, Courier New, monospace',
              fontSize: '12px',
              lineHeight: 1.6,
              height: '240px',
              overflowY: 'auto',
              color: '#cbd5e1',
            }}
          >
            <div style={{ color: logsError ? '#f87171' : logsConnected ? '#10b981' : '#94a3b8', marginBottom: '8px' }}>
              {logsError ? `Mất kết nối logs: ${logsError}` : logsConnected ? '● Logs đã kết nối' : 'Đang kết nối logs...'}
            </div>
            {hasOlderLogs && (
              <button type="button" onClick={() => { void loadOlderLogs(); }} disabled={olderLogsLoading}
                style={{ color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '8px' }}>
                {olderLogsLoading ? 'Đang tải...' : 'Tải logs cũ hơn'}
              </button>
            )}
            {logs.length === 0 ? (
              <div style={{ color: '#475569', fontStyle: 'italic' }}>Không có log ghi nhận...</div>
            ) : (
              logs.map((item) => {
                let badgeColor = '#38bdf8';
                if (item.level === 'success') badgeColor = '#10b981';
                if (item.level === 'warn') badgeColor = '#a3e635';
                if (item.level === 'error') badgeColor = '#ef4444';

                return (
                  <div key={item.id} style={{ marginBottom: '4px', wordBreak: 'break-all' }}>
                    <span style={{ color: '#64748b', marginRight: '10px' }}>[{typeof item.id === 'number' ? new Date(item.timestamp).toLocaleString('vi-VN') : item.timestamp}]</span>
                    <span
                      style={{
                        color: badgeColor,
                        fontWeight: 600,
                        marginRight: '8px',
                        textTransform: 'uppercase',
                      }}
                    >
                      [{item.level}]
                    </span>
                    <span>{item.message}</span>
                  </div>
                );
              })
            )}
            <div ref={terminalLogsEndRef} />
          </div>
        </div>

        {/* 5. Movie List & Cache Management */}
        <div
          style={{
            background: 'rgba(20, 24, 38, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '14px',
            padding: '24px',
            backdropFilter: 'blur(10px)',
          }}
        >
          {/* Header & Controls */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              marginBottom: '20px',
            }}
          >
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>
                Quản Lý Danh Sách Phim & Cache M3U8
              </div>
              <div style={{ fontSize: '13px', color: '#8b95ad' }}>
                Tổng cộng {moviesTotal.toLocaleString()} dòng phim trong cơ sở dữ liệu (gồm phim chỉ có thông tin tóm tắt)
              </div>
            </div>

            {/* Filter buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {(
                [
                  { id: 'all', label: 'Tất cả' },
                  { id: 'movie', label: 'Phim lẻ' },
                  { id: 'tv', label: 'Phim bộ' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setFilterType(tab.id);
                    setCurrentPage(1);
                  }}
                  style={{
                    background: filterType === tab.id ? 'rgba(132, 204, 22, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${filterType === tab.id ? 'rgba(132, 204, 22, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                    color: filterType === tab.id ? '#a3e635' : '#cbd5e1',
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Search bar */}
          <div style={{ position: 'relative', marginBottom: '20px' }}>
            <Search
              size={18}
              style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#64748b',
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Tìm kiếm phim theo tên tiếng Việt, tên gốc hoặc slug..."
              style={{
                width: '100%',
                height: '42px',
                padding: '0 16px 0 42px',
                background: 'rgba(10, 14, 23, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          {/* Movie List Table */}
          {moviesLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#8b95ad' }}>
              <Loader2 size={28} className="animate-spin" style={{ margin: '0 auto 12px', color: '#a3e635' }} />
              <div>Đang tải danh sách phim...</div>
            </div>
          ) : moviesError ? (
            <div
              style={{
                textAlign: 'center',
                padding: '36px 20px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '12px',
                margin: '10px 0 20px',
              }}
            >
              <AlertTriangle size={36} color="#ef4444" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#fca5a5', marginBottom: '6px' }}>
                Không thể tải danh sách phim từ máy chủ
              </div>
              <p style={{ fontSize: '13px', color: '#f87171', margin: '0 0 16px', maxWidth: '480px', marginLeft: 'auto', marginRight: 'auto' }}>
                {moviesError}
              </p>
              <button
                type="button"
                onClick={() => fetchMovies(currentPage, pageSize, searchQuery, filterType)}
                style={{
                  background: 'linear-gradient(135deg, #aeea00 0%, #84cc16 100%)',
                  border: 'none',
                  color: '#070e08',
                  padding: '9px 20px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(174, 234, 0, 0.3)',
                }}
              >
                <RefreshCw size={14} />
                <span>Thử lại</span>
              </button>
            </div>
          ) : filteredMovies.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
              Không tìm thấy phim phù hợp với từ khóa tìm kiếm.
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                  fontSize: '13px',
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      color: '#8b95ad',
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    <th style={{ padding: '12px 14px' }}>Phim</th>
                    <th style={{ padding: '12px 14px' }}>Loại & Thể loại</th>
                    <th style={{ padding: '12px 14px' }}>Năm</th>
                    <th style={{ padding: '12px 14px' }}>Trạng Thái Cache M3U8</th>
                    <th style={{ padding: '12px 14px', textAlign: 'right' }}>Hành Động</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovies.map((m) => {
                    const isClearing = clearingCacheSlug === m.slug;
                    return (
                      <tr
                        key={m.id || m.slug}
                        style={{
                          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(174, 234, 0, 0.05)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        {/* Title & Poster */}
                        <td style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <img
                            src={m.poster || '/placeholder.png'}
                            alt={m.title_vi || m.slug}
                            style={{
                              width: '38px',
                              height: '52px',
                              objectFit: 'cover',
                              borderRadius: '4px',
                              background: '#161b2a',
                            }}
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <div>
                            <div style={{ fontWeight: 600, color: '#fff', marginBottom: '2px' }}>
                              {m.title_vi || m.title_en || m.slug}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {m.title_en || m.slug}
                            </div>
                          </div>
                        </td>

                        {/* Type & Genres */}
                        <td style={{ padding: '12px 14px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: m.movie_type === 'tv' ? 'rgba(56, 189, 248, 0.12)' : 'rgba(132, 204, 22, 0.15)',
                              color: m.movie_type === 'tv' ? '#38bdf8' : '#a3e635',
                              marginRight: '6px',
                            }}
                          >
                            {m.movie_type === 'tv' ? 'Phim bộ' : 'Phim lẻ'}
                          </span>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                            {m.genres && m.genres.length > 0 ? m.genres.slice(0, 2).join(', ') : 'Điện ảnh'}
                          </span>
                        </td>

                        {/* Year */}
                        <td style={{ padding: '12px 14px', color: '#cbd5e1' }}>
                          {m.year || 2026}
                        </td>

                        {/* Cache status */}
                        <td style={{ padding: '12px 14px' }}>
                          {m.has_cached_m3u8 ? (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '4px 10px',
                                borderRadius: '20px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: 'rgba(132, 204, 22, 0.15)',
                                color: '#a3e635',
                                border: '1px solid rgba(132, 204, 22, 0.3)',
                              }}
                            >
                              <Zap size={12} />
                              <span>Có mục playlist cache</span>
                            </div>
                          ) : (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '4px 10px',
                                borderRadius: '20px',
                                fontSize: '11px',
                                fontWeight: 500,
                                background: 'rgba(148, 163, 184, 0.08)',
                                color: '#94a3b8',
                                border: '1px solid rgba(148, 163, 184, 0.18)',
                              }}
                            >
                              <Square size={10} style={{ opacity: 0.6 }} />
                              <span>Chưa có cache</span>
                            </div>
                          )}
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            {/* Play button */}
                            <button
                              type="button"
                              onClick={() => onNavigate(`/watch/${m.slug}`)}
                              title="Xem thử phim"
                              style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: 'none',
                                color: '#fff',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Play size={12} fill="currentColor" />
                              <span>Xem</span>
                            </button>

                            {/* Clear cache button */}
                            <button
                              type="button"
                              onClick={() => handleClearMovieCache(m.slug)}
                              disabled={isClearing}
                              title="Xóa cache M3U8 để hệ thống tải lại stream mới"
                              style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                color: '#f87171',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                cursor: isClearing ? 'not-allowed' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              {isClearing ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                              <span>Xóa Cache</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls Bar */}
            <div
              style={{
                marginTop: '20px',
                paddingTop: '16px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                fontSize: '13px',
                color: '#8b95ad',
              }}
            >
              {/* Left: Info text & Page Size Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ color: '#cbd5e1' }}>
                  Hiển thị trang <span style={{ color: '#fff', fontWeight: 600 }}>{currentPage}</span> /{' '}
                  <span style={{ color: '#fff', fontWeight: 600 }}>{totalPages}</span> (Tổng cộng{' '}
                  <span style={{ color: '#a3e635', fontWeight: 600 }}>{moviesTotal.toLocaleString()}</span> phim)
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Hiển thị:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    style={{
                      background: 'rgba(10, 14, 23, 0.8)',
                      color: '#cbd5e1',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '6px',
                      padding: '5px 10px',
                      fontSize: '12px',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <option value={25}>25 phim</option>
                    <option value={50}>50 phim</option>
                    <option value={100}>100 phim</option>
                  </select>
                </div>
              </div>

              {/* Right: Page Navigation Buttons & Jump to Page */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {/* Trang đầu */}
                <button
                  type="button"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage <= 1}
                  title="Trang đầu"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: currentPage <= 1 ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <ChevronsLeft size={14} />
                  <span>Trang đầu</span>
                </button>

                {/* Trang trước */}
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  title="Trang trước"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: currentPage <= 1 ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <ChevronLeft size={14} />
                  <span>Trang trước</span>
                </button>

                {/* Page numbers [1, 2, 3 ... N] */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {getPageNumbers().map((p, idx) => {
                    if (p === '...') {
                      return (
                        <span key={`ellipsis-${idx}`} style={{ padding: '0 4px', color: '#64748b' }}>
                          ...
                        </span>
                      );
                    }
                    const isCurrent = p === currentPage;
                    return (
                      <button
                        key={`page-${p}`}
                        type="button"
                        onClick={() => setCurrentPage(Number(p))}
                        style={{
                          background: isCurrent ? 'rgba(132, 204, 22, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                          border: `1px solid ${isCurrent ? 'rgba(132, 204, 22, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                          color: isCurrent ? '#a3e635' : '#cbd5e1',
                          borderRadius: '6px',
                          minWidth: '32px',
                          height: '32px',
                          fontSize: '12px',
                          fontWeight: isCurrent ? 700 : 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 6px',
                        }}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>

                {/* Trang sau */}
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  title="Trang sau"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: currentPage >= totalPages ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>Trang sau</span>
                  <ChevronRight size={14} />
                </button>

                {/* Trang cuối */}
                <button
                  type="button"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  title="Trang cuối"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: currentPage >= totalPages ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>Trang cuối</span>
                  <ChevronsRight size={14} />
                </button>

                {/* Jump to page */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const p = parseInt(jumpPageInput.trim(), 10);
                    if (!isNaN(p) && p >= 1 && p <= totalPages) {
                      setCurrentPage(p);
                      setJumpPageInput('');
                    }
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '6px' }}
                >
                  <span style={{ fontSize: '12px', color: '#8b95ad' }}>Đến:</span>
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={jumpPageInput}
                    onChange={(e) => setJumpPageInput(e.target.value)}
                    placeholder={String(currentPage)}
                    style={{
                      width: '48px',
                      height: '32px',
                      background: 'rgba(10, 14, 23, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '6px',
                      color: '#fff',
                      textAlign: 'center',
                      fontSize: '12px',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#fff',
                      borderRadius: '6px',
                      padding: '0 8px',
                      height: '32px',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Chuyển
                  </button>
                </form>
              </div>
            </div>
            </>
          )}
        </div>
      </main>

      {/* Confirmation Modal Dialog */}
      {confirmModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '480px',
              background: '#141824',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '16px',
              padding: '28px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'rgba(132, 204, 22, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={24} color="#a3e635" />
              </div>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 4px', color: '#fff' }}>
                  Xác Nhận Cào Tự Động Phim Còn Lại
                </h3>
                <p style={{ fontSize: '13px', color: '#8b95ad', margin: 0 }}>
                  Tổng kho hệ thống: {(stats.total_source_movies ?? 0).toLocaleString()} phim • Còn lại: {(stats.remaining_movies ?? 0).toLocaleString()} phim
                </p>
              </div>
            </div>

            <p style={{ fontSize: '13px', lineHeight: 1.6, color: '#cbd5e1', marginBottom: '24px' }}>
              Hệ thống sẽ tiếp tục cào theo từng đợt, lưu vị trí trang để tiếp tục sau khi khởi động lại và bỏ qua phim đã có tập.
              Tiến trình chạy ngầm cho đến khi bạn bấm dừng. Bạn có chắc chắn muốn bắt đầu ngay?
            </p>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setConfirmModalOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  color: '#fff',
                  padding: '9px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>

              <button
                type="button"
                onClick={handleStartFullCrawl}
                disabled={actionLoading !== null || stats.crawler_is_running || stats.crawler_auto_enabled}
                style={{
                  background: stats.crawler_is_running
                    ? 'rgba(255, 255, 255, 0.05)'
                    : 'linear-gradient(135deg, #aeea00 0%, #84cc16 100%)',
                  border: 'none',
                  color: stats.crawler_is_running ? '#64748b' : '#070e08',
                  padding: '9px 20px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: stats.crawler_is_running ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: stats.crawler_is_running ? 'none' : '0 4px 14px rgba(174, 234, 0, 0.4)',
                }}
              >
                {stats.crawler_is_running ? <Lock size={14} /> : <Play size={14} fill="currentColor" />}
                <span>
                  {stats.crawler_is_running ? 'Crawler đang chạy, vui lòng đợi...' : 'Bắt đầu ngay'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
