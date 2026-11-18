// frontend/src/components/AdminDashboard.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { AdminLogEntry, AdminStats, MovieSummary } from '../types';
import { CrawlerMode } from '../crawlerStatus';
import { AdminConfirmDialog } from './admin/AdminConfirmDialog';
import { AdminCrawlerControls } from './admin/AdminCrawlerControls';
import { AdminHeader } from './admin/AdminHeader';
import { AdminMovieFormModal } from './admin/AdminMovieFormModal';
import { AdminMoviesSection } from './admin/AdminMoviesSection';
import { AdminStatsGrid } from './admin/AdminStatsGrid';
import { AdminTaskTerminal } from './admin/AdminTaskTerminal';
import { AdminToast } from './admin/AdminToast';
import {
  AdminFilterType,
  AdminSortOption,
  ConfirmDialogState,
  MovieCrudPayload,
  persistTableState,
  readInitialTableState,
  ToastState,
  ToastVariant,
} from './admin/adminTypes';

interface AdminDashboardProps {
  onNavigate: (path: string) => void;
}

const STORAGE_SESSION_FLAG = 'bofilm_admin_authenticated';
const LEGACY_TOKEN_KEY = 'bofilm_admin_token';
const MAX_LOG_ENTRIES = 200;

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function extractApiError(data: Record<string, unknown>, status: number, fallback: string): string {
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  return `${fallback} (HTTP ${status})`;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  // Auth state: supports HttpOnly SameSite=Strict cookie (`credentials: 'include'`)
  // and graceful Bearer token compatibility without storing raw token if cookie succeeds.
  const [authToken, setAuthToken] = useState<string | null>(() =>
    typeof window !== 'undefined' ? sessionStorage.getItem(LEGACY_TOKEN_KEY) : null
  );
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(
      sessionStorage.getItem(STORAGE_SESSION_FLAG) || sessionStorage.getItem(LEGACY_TOKEN_KEY)
    );
  });
  const isAuthenticatedRef = useRef<boolean>(isAuthenticated);
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Toast state with tracked timer ref to avoid premature dismissal
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback((variant: ToastVariant, message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ id: Date.now(), variant, message });
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 3800);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Stats state
  const [stats, setStats] = useState<AdminStats>({
    total_movies: 0,
    total_series: 0,
    total_single: 0,
    total_source_movies: null,
    remaining_movies: null,
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

  // Logs state
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logWriteError, setLogWriteError] = useState<string | null>(null);
  const [logsConnected, setLogsConnected] = useState(false);
  const [hasOlderLogs, setHasOlderLogs] = useState(false);
  const [olderLogsLoading, setOlderLogsLoading] = useState(false);
  const newestLogId = useRef(0);
  const oldestLogId = useRef<number | null>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  // Table & Pagination state (initialized from URL query or sessionStorage)
  const initialTable = useRef(readInitialTableState());
  const [moviesList, setMoviesList] = useState<MovieSummary[]>([]);
  const [moviesTotal, setMoviesTotal] = useState(0);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [moviesError, setMoviesError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialTable.current.q);
  const [filterType, setFilterType] = useState<AdminFilterType>(initialTable.current.type);
  const [sortBy, setSortBy] = useState<AdminSortOption>(initialTable.current.sort);
  const [currentPage, setCurrentPage] = useState(initialTable.current.page);
  const [pageSize, setPageSize] = useState<number>(initialTable.current.limit);
  const [jumpPageInput, setJumpPageInput] = useState('');
  const moviesAbortRef = useRef<AbortController | null>(null);

  // Action & Dialog states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [clearingCacheSlug, setClearingCacheSlug] = useState<string | null>(null);
  const [deletingMovieSlug, setDeletingMovieSlug] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Movie CRUD modal state
  const [crudModalOpen, setCrudModalOpen] = useState(false);
  const [crudModalMode, setCrudModalMode] = useState<'create' | 'edit'>('create');
  const [editingMovie, setEditingMovie] = useState<MovieSummary | null>(null);
  const [crudSubmitting, setCrudSubmitting] = useState(false);
  const [crudServerError, setCrudServerError] = useState<string | null>(null);

  // Persist pagination, search, filter & sort to URL query + sessionStorage
  useEffect(() => {
    persistTableState({
      page: currentPage,
      limit: pageSize,
      q: searchQuery,
      type: filterType,
      sort: sortBy,
    });
  }, [currentPage, pageSize, searchQuery, filterType, sortBy]);

  // Handle session expiration / 401 response cleanly
  const handleAuthExpired = useCallback((reason?: string) => {
    isAuthenticatedRef.current = false;
    sessionStorage.removeItem(STORAGE_SESSION_FLAG);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    setIsAuthenticated(false);
    setAuthToken(null);
    setPasswordInput('');
    setAuthError(
      reason ||
        'Phiên làm việc đã hết hạn hoặc mã xác thực không hợp lệ. Vui lòng đăng nhập lại.'
    );
    moviesAbortRef.current?.abort();
    setLogs([]);
    setLogsConnected(false);
    setMoviesList([]);
    setConfirmDialog(null);
    setCrudModalOpen(false);
  }, []);

  // Universal admin fetch wrapper: always sends credentials: 'include' + optional Bearer fallback
  const adminFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers || {});
      if (authToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${authToken}`);
      }
      const res = await fetch(input, {
        ...init,
        headers,
        credentials: 'include',
      });
      if ((res.status === 401 || res.status === 403) && isAuthenticatedRef.current) {
        handleAuthExpired(
          'Phiên làm việc đã hết hạn hoặc mã xác thực không hợp lệ. Vui lòng đăng nhập lại.'
        );
      }
      return res;
    },
    [authToken, handleAuthExpired]
  );

  // Add log entry (never posts to server when unauthenticated / logged out)
  const addLog = useCallback(
    (level: AdminLogEntry['level'], message: string) => {
      if (!isAuthenticatedRef.current) return;
      void adminFetch('/api/admin/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, message }),
      })
        .then((response) => {
          if (response.status === 401 || response.status === 403) return;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setLogWriteError(null);
        })
        .catch((error: unknown) => {
          if (!isAuthenticatedRef.current) return;
          setLogWriteError(
            error instanceof Error ? error.message : 'Không thể lưu nhật ký trên máy chủ'
          );
        });
    },
    [adminFetch]
  );

  const applyStatsPayload = useCallback((data: Partial<AdminStats>) => {
    setStats((prev) => ({
      ...prev,
      ...data,
      catalog_rows: data.catalog_rows ?? data.total_movies ?? prev.total_movies ?? 0,
      detail_rows: data.detail_rows ?? prev.detail_rows ?? 0,
      crawler_auto_enabled:
        data.crawler_auto_enabled !== undefined
          ? data.crawler_auto_enabled
          : (prev.crawler_auto_enabled ?? false),
      total_source_movies: data.total_source_movies,
      remaining_movies: data.remaining_movies,
    }));
  }, []);

  // Fetch Admin Stats
  const fetchStats = useCallback(async () => {
    if (!isAuthenticatedRef.current) return;
    setStatsLoading(true);
    try {
      const res = await adminFetch('/api/admin/stats', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) return;
      if (res.ok) {
        const data = (await res.json()) as AdminStats;
        applyStatsPayload(data);
      }
    } catch {
      // keep existing stats on transient network failure
    } finally {
      setStatsLoading(false);
    }
  }, [adminFetch, applyStatsPayload]);

  // Fetch Paginated Movies with AbortController
  const fetchMovies = useCallback(
    async (
      page = currentPage,
      limit = pageSize,
      q = searchQuery,
      type = filterType,
      sort = sortBy
    ) => {
      if (!isAuthenticatedRef.current) return;
      moviesAbortRef.current?.abort();
      const controller = new AbortController();
      moviesAbortRef.current = controller;

      setMoviesLoading(true);
      setMoviesError(null);

      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', String(limit));
        params.set('sort', sort);
        const trimmedQ = q.trim();
        if (trimmedQ) {
          params.set('q', trimmedQ);
          params.set('search', trimmedQ);
        }
        if (type === 'movie' || type === 'tv') {
          params.set('type', type);
        }

        const res = await adminFetch(`/api/admin/movies?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;
        if (res.status === 401 || res.status === 403) return;

        const data = await parseJsonSafe(res);
        if (!res.ok || data.success === false) {
          const errorMsg = extractApiError(
            data,
            res.status,
            'Không thể tải danh sách phim từ máy chủ'
          );
          setMoviesError(errorMsg);
          addLog('error', `Lỗi tải danh sách phim: ${errorMsg}`);
          return;
        }

        const rawList = Array.isArray(data.movies)
          ? data.movies
          : Array.isArray(data.items)
            ? data.items
            : [];

        const normalizedMovies: MovieSummary[] = rawList.map((rawItem: unknown) => {
          const m = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<
            string,
            unknown
          >;
          const totalEp = m.total_episodes;
          const inferredType =
            typeof m.movie_type === 'string' && m.movie_type
              ? m.movie_type
              : totalEp != null && Number(totalEp) > 1
                ? 'tv'
                : 'movie';

          return {
            id: typeof m.id === 'number' || typeof m.id === 'string' ? m.id : undefined,
            slug: typeof m.slug === 'string' ? m.slug : '',
            name:
              (typeof m.name === 'string' && m.name) ||
              (typeof m.title_vi === 'string' ? m.title_vi : ''),
            title_vi:
              (typeof m.title_vi === 'string' && m.title_vi) ||
              (typeof m.name === 'string' ? m.name : ''),
            original_name:
              (typeof m.original_name === 'string' && m.original_name) ||
              (typeof m.title_en === 'string' ? m.title_en : ''),
            title_en:
              (typeof m.title_en === 'string' && m.title_en) ||
              (typeof m.original_name === 'string' ? m.original_name : ''),
            year:
              typeof m.year === 'number' || typeof m.year === 'string' ? m.year : undefined,
            quality: typeof m.quality === 'string' ? m.quality : undefined,
            score: typeof m.score === 'number' ? m.score : undefined,
            genres: Array.isArray(m.genres)
              ? m.genres.filter((g): g is string => typeof g === 'string')
              : [],
            country: typeof m.country === 'string' ? m.country : undefined,
            poster:
              (typeof m.poster === 'string' && m.poster) ||
              (typeof m.poster_url === 'string' && m.poster_url) ||
              (typeof m.thumb_url === 'string' ? m.thumb_url : ''),
            backdrop: typeof m.backdrop === 'string' ? m.backdrop : undefined,
            total_episodes:
              typeof totalEp === 'number' || typeof totalEp === 'string'
                ? totalEp
                : undefined,
            movie_type: inferredType,
            has_cached_m3u8: Boolean(m.has_cached_m3u8),
          };
        });

        const paginateObj =
          data.paginate && typeof data.paginate === 'object'
            ? (data.paginate as Record<string, unknown>)
            : null;
        const resolvedTotal =
          typeof data.total === 'number'
            ? data.total
            : typeof paginateObj?.total_items === 'number'
              ? paginateObj.total_items
              : normalizedMovies.length;

        setMoviesList(normalizedMovies);
        setMoviesTotal(resolvedTotal);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
          return;
        }
        const errorMsg =
          err instanceof Error
            ? err.message
            : 'Không thể kết nối máy chủ để tải danh sách phim';
        setMoviesError(errorMsg);
        addLog('error', `Lỗi kết nối danh sách phim: ${errorMsg}`);
      } finally {
        if (moviesAbortRef.current === controller) {
          setMoviesLoading(false);
        }
      }
    },
    [adminFetch, addLog, currentPage, filterType, pageSize, searchQuery, sortBy]
  );

  useEffect(() => {
    return () => {
      moviesAbortRef.current?.abort();
    };
  }, []);

  // Merge server logs
  const mergeServerLogs = useCallback((incoming: AdminLogEntry[]) => {
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
      return sorted.length > MAX_LOG_ENTRIES
        ? sorted.slice(sorted.length - MAX_LOG_ENTRIES)
        : sorted;
    });
  }, []);

  // Visibility-aware Logs Polling
  useEffect(() => {
    if (!isAuthenticated) {
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
      if (
        !active ||
        !isAuthenticatedRef.current ||
        polling ||
        document.hidden ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      polling = true;
      try {
        let more = true;
        let first = initial;
        while (more && active && isAuthenticatedRef.current) {
          const url = first
            ? '/api/admin/logs?limit=100'
            : `/api/admin/logs?after_id=${newestLogId.current}&limit=500`;
          const response = await adminFetch(url, { cache: 'no-store' });
          if (response.status === 401 || response.status === 403) return;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = (await response.json()) as {
            logs: AdminLogEntry[];
            has_more: boolean;
          };
          if (!active || !isAuthenticatedRef.current) return;
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
      } catch (error: unknown) {
        if (active && isAuthenticatedRef.current) {
          setLogsConnected(false);
          setLogsError(error instanceof Error ? error.message : 'Không thể tải nhật ký');
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
      }, 2000);
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
  }, [isAuthenticated, adminFetch, mergeServerLogs]);

  // Auto-scroll terminal container
  useEffect(() => {
    if (autoScrollLogs && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScrollLogs]);

  // Visibility-aware Stats Polling
  useEffect(() => {
    if (!isAuthenticated) return;

    const pollInterval = stats.crawler_is_running
      ? 2000
      : stats.crawler_auto_enabled
        ? 4000
        : 8000;
    let timer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      void fetchStats();
      timer = setInterval(() => {
        if (document.hidden || document.visibilityState !== 'visible') return;
        void fetchStats();
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
  }, [isAuthenticated, stats.crawler_is_running, stats.crawler_auto_enabled, fetchStats]);

  // Debounced Movies Fetch
  useEffect(() => {
    if (!isAuthenticated) return;
    const timeout = setTimeout(() => {
      void fetchMovies(currentPage, pageSize, searchQuery, filterType, sortBy);
    }, 220);
    return () => clearTimeout(timeout);
  }, [isAuthenticated, currentPage, pageSize, searchQuery, filterType, sortBy, fetchMovies]);

  const loadOlderLogs = async () => {
    if (!isAuthenticated || oldestLogId.current === null || olderLogsLoading) return;
    setAutoScrollLogs(false);
    setOlderLogsLoading(true);
    try {
      const response = await adminFetch(
        `/api/admin/logs?before_id=${oldestLogId.current}&limit=100`,
        { cache: 'no-store' }
      );
      if (response.status === 401 || response.status === 403) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        logs: AdminLogEntry[];
        has_more: boolean;
      };
      mergeServerLogs(data.logs);
      for (const entry of data.logs) {
        if (typeof entry.id === 'number') {
          oldestLogId.current = Math.min(oldestLogId.current ?? entry.id, entry.id);
        }
      }
      setHasOlderLogs(data.has_more);
      setLogsError(null);
    } catch (error: unknown) {
      setLogsError(error instanceof Error ? error.message : 'Không thể tải nhật ký cũ');
    } finally {
      setOlderLogsLoading(false);
    }
  };

  const exportLogs = async () => {
    if (!isAuthenticated) return;
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
      showToast('success', 'Đã xuất tệp lịch sử nhật ký admin-task-logs.jsonl');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Không thể xuất nhật ký';
      setLogsError(msg);
      showToast('error', `Lỗi xuất nhật ký: ${msg}`);
    }
  };

  const handleCopyLogs = async () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLogs(true);
      showToast('success', `Đã sao chép ${logs.length} dòng nhật ký vào bộ nhớ tạm`);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch {
      setLogsError('Không thể sao chép nhật ký đã tải');
      showToast('error', 'Trình duyệt từ chối quyền sao chép vào clipboard');
    }
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput.trim() }),
      });

      const data = await parseJsonSafe(res);
      if (res.ok && data.success !== false) {
        const returnedToken = typeof data.token === 'string' ? data.token : null;

        // Verify if HttpOnly session cookie was set so we avoid storing raw token in sessionStorage
        const cookieProbe = await fetch('/api/admin/stats', {
          credentials: 'include',
          cache: 'no-store',
        }).catch(() => null);

        if (cookieProbe && cookieProbe.ok) {
          sessionStorage.removeItem(LEGACY_TOKEN_KEY);
          sessionStorage.setItem(STORAGE_SESSION_FLAG, '1');
          setAuthToken(null);
          isAuthenticatedRef.current = true;
          setIsAuthenticated(true);
          setPasswordInput('');
          const initialStats = (await cookieProbe.json().catch(() => null)) as AdminStats | null;
          if (initialStats) {
            applyStatsPayload(initialStats);
          }
          void fetch('/api/admin/logs', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              level: 'success',
              message: 'Đăng nhập phiên quản trị thành công (HttpOnly Session).',
            }),
          }).catch(() => undefined);
        } else if (returnedToken) {
          sessionStorage.setItem(STORAGE_SESSION_FLAG, '1');
          sessionStorage.setItem(LEGACY_TOKEN_KEY, returnedToken);
          setAuthToken(returnedToken);
          isAuthenticatedRef.current = true;
          setIsAuthenticated(true);
          setPasswordInput('');
          void fetch('/api/admin/logs', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${returnedToken}`,
            },
            body: JSON.stringify({
              level: 'success',
              message: 'Đăng nhập phiên quản trị thành công.',
            }),
          }).catch(() => undefined);
        } else {
          setAuthError('Không thể thiết lập phiên xác thực từ máy chủ.');
        }
      } else {
        setAuthError(extractApiError(data, res.status, 'Mật khẩu quản trị không chính xác'));
      }
    } catch {
      setAuthError('Không thể kết nối máy chủ quản trị. Vui lòng thử lại.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout: invalidate server session first, clear client state, NEVER fire post-logout addLog!
  const handleLogout = async () => {
    const tokenToRevoke = authToken;
    isAuthenticatedRef.current = false;
    sessionStorage.removeItem(STORAGE_SESSION_FLAG);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    moviesAbortRef.current?.abort();

    setIsAuthenticated(false);
    setAuthToken(null);
    setPasswordInput('');
    setAuthError(null);
    setLogs([]);
    setLogsConnected(false);
    setMoviesList([]);
    setConfirmDialog(null);
    setCrudModalOpen(false);
    dismissToast();

    try {
      const headers: Record<string, string> = {};
      if (tokenToRevoke) {
        headers.Authorization = `Bearer ${tokenToRevoke}`;
      }
      await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
    } catch {
      // ignore network error on logout
    }
  };

  // Crawler & Cache Operations (strictly checking !res.ok || data.success === false)
  const executeFullCrawl = async () => {
    setConfirmBusy(true);
    setActionLoading('start_full');
    addLog('info', 'Lệnh: Bắt đầu đồng bộ toàn bộ kho phim (mode: full)...');

    try {
      const res = await adminFetch('/api/admin/crawler/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await parseJsonSafe(res);
      if (!res.ok || data.success === false) {
        throw new Error(extractApiError(data, res.status, 'Không thể bắt đầu đồng bộ toàn bộ kho'));
      }

      const msg =
        typeof data.message === 'string' && data.message
          ? data.message
          : 'Đã kích hoạt đồng bộ toàn bộ kho phim (mode: full).';
      addLog('success', msg);
      showToast('success', msg);
      setConfirmDialog(null);
      await fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi kết nối máy chủ khi kích hoạt crawler';
      addLog('error', `Lỗi kích hoạt đồng bộ toàn bộ: ${msg}`);
      showToast('error', msg);
    } finally {
      setConfirmBusy(false);
      setActionLoading(null);
    }
  };

  const requestFullCrawlConfirm = useCallback(() => {
    const sourceText =
      stats.total_source_movies == null
        ? 'Kho nguồn: theo sitemap trực tiếp'
        : `Tổng kho nguồn: ${stats.total_source_movies.toLocaleString()} phim`;
    const remainText =
      stats.remaining_movies == null
        ? ''
        : ` • Còn thiếu: ${stats.remaining_movies.toLocaleString()} phim`;

    setConfirmDialog({
      title: 'Xác Nhận Đồng Bộ Toàn Bộ Kho Phim (Full)',
      subtitle: `${sourceText}${remainText}`,
      description:
        'Hệ thống sẽ duyệt toàn bộ danh sách phim trên sitemap nguồn, cập nhật thông tin và danh sách tập vào cơ sở dữ liệu SQLite ở chế độ chạy nền. Bạn có chắc chắn muốn bắt đầu ngay?',
      confirmLabel: 'Bắt đầu ngay',
      variant: 'primary',
      onConfirm: executeFullCrawl,
    });
  }, [stats.remaining_movies, stats.total_source_movies]);

  const handleTriggerMode = async (mode: CrawlerMode, label: string) => {
    setActionLoading(mode);
    addLog('info', `Lệnh: ${label} (mode: ${mode})...`);

    try {
      const res = await adminFetch('/api/admin/crawler/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await parseJsonSafe(res);
      if (!res.ok || data.success === false) {
        throw new Error(extractApiError(data, res.status, `Không thể kích hoạt ${label}`));
      }

      const msg =
        typeof data.message === 'string' && data.message
          ? data.message
          : `Đã kích hoạt ${label} thành công.`;
      addLog('success', msg);
      showToast('success', `${label} đang chạy`);
      await fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Lỗi khi chạy ${label}`;
      addLog('error', `Lỗi ${label}: ${msg}`);
      showToast('error', msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleWarmupHotMovies = async () => {
    setActionLoading('warmup');
    addLog('info', 'Lệnh: Nạp trước dữ liệu phim hot & làm nóng cache M3U8 (warmup)...');

    try {
      const res = await adminFetch('/api/admin/crawler/warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await parseJsonSafe(res);
      if (!res.ok || data.success === false) {
        throw new Error(
          extractApiError(data, res.status, 'Không thể kích hoạt nạp trước dữ liệu phim hot')
        );
      }

      const msg =
        typeof data.message === 'string' && data.message
          ? data.message
          : 'Đang làm nóng cache M3U8 cho các phim thịnh hành.';
      addLog('success', msg);
      showToast('success', msg);
      await fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi kích hoạt warmup cache';
      addLog('error', `Lỗi nạp trước phim hot: ${msg}`);
      showToast('error', msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStopCrawler = async () => {
    setActionLoading('stop');
    addLog('warn', 'Lệnh: Gửi tín hiệu dừng tiến trình crawler...');

    try {
      const res = await adminFetch('/api/admin/crawler/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await parseJsonSafe(res);
      if (!res.ok || data.success === false) {
        throw new Error(extractApiError(data, res.status, 'Không thể dừng tiến trình crawler'));
      }

      const msg =
        typeof data.message === 'string' && data.message
          ? data.message
          : 'Đã gửi tín hiệu dừng crawler.';
      addLog('info', msg);
      showToast('warning', 'Đã gửi yêu cầu dừng tiến trình crawler');
      setStats((s) => ({
        ...s,
        crawler_is_running: data.is_running === true,
        crawler_auto_enabled: false,
      }));
      await fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi dừng tiến trình crawler';
      addLog('error', `Lỗi dừng crawler: ${msg}`);
      showToast('error', msg);
    } finally {
      setActionLoading(null);
    }
  };

  // Global Cache Clear (Confirmation Gated)
  const executeClearAllCache = async () => {
    setConfirmBusy(true);
    setActionLoading('clear_all_cache');
    addLog('warn', 'Lệnh: Xóa toàn bộ thư mục cache playlist M3U8...');

    try {
      const res = await adminFetch('/api/admin/cache/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await parseJsonSafe(res);
      if (!res.ok || data.success === false) {
        throw new Error(extractApiError(data, res.status, 'Không thể xóa toàn bộ cache M3U8'));
      }

      const removedCount =
        typeof data.directories_removed === 'number' ? data.directories_removed : null;
      const msg =
        removedCount !== null
          ? `Đã dọn sạch toàn bộ cache M3U8 (${removedCount} thư mục đã xóa).`
          : typeof data.message === 'string' && data.message
            ? data.message
            : 'Đã dọn sạch toàn bộ cache playlist M3U8.';

      setMoviesList((prev) => prev.map((m) => ({ ...m, has_cached_m3u8: false })));
      addLog('success', msg);
      showToast('success', msg);
      setConfirmDialog(null);
      await fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi máy chủ khi xóa toàn bộ cache M3U8';
      addLog('error', `Lỗi xóa toàn bộ cache: ${msg}`);
      showToast('error', msg);
    } finally {
      setConfirmBusy(false);
      setActionLoading(null);
    }
  };

  const requestClearAllCacheConfirm = useCallback(() => {
    setConfirmDialog({
      title: 'Xác Nhận Xóa Toàn Bộ Cache M3U8',
      subtitle: `Hiện có ${stats.cached_m3u8_count.toLocaleString()} mục playlist cache trên đĩa`,
      description:
        'Toàn bộ các tệp master.m3u8, playlist phân giải và phụ đề lưu tạm trên ổ đĩa sẽ bị xóa hoàn toàn. Hệ thống sẽ tự tạo lại cache mới khi người xem phát phim.',
      confirmLabel: 'Xóa toàn bộ cache',
      variant: 'danger',
      onConfirm: executeClearAllCache,
    });
  }, [stats.cached_m3u8_count]);

  // Single Movie Cache Clear (encodeURIComponent + Confirmation Gated + HTTP 500 Safe)
  const executeClearMovieCache = async (movie: MovieSummary) => {
    const slug = movie.slug;
    setConfirmBusy(true);
    setClearingCacheSlug(slug);
    addLog('info', `Đang xóa cache M3U8 của phim: ${slug}...`);

    try {
      const res = await adminFetch(`/api/admin/cache/clear/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await parseJsonSafe(res);
      if (!res.ok || data.success === false) {
        throw new Error(
          extractApiError(data, res.status, `Không thể xóa cache M3U8 của phim ${slug}`)
        );
      }

      setMoviesList((prev) =>
        prev.map((item) => (item.slug === slug ? { ...item, has_cached_m3u8: false } : item))
      );
      const msg =
        typeof data.message === 'string' && data.message
          ? data.message
          : `Đã xóa cache M3U8 của phim: ${slug}`;
      addLog('success', msg);
      showToast('success', `Đã xóa cache M3U8: ${movie.title_vi || slug}`);
      setConfirmDialog(null);
      await fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Lỗi khi xóa cache phim ${slug}`;
      addLog('error', `Lỗi xóa cache ${slug}: ${msg}`);
      showToast('error', msg);
    } finally {
      setConfirmBusy(false);
      setClearingCacheSlug(null);
    }
  };

  const requestClearMovieCacheConfirm = useCallback((movie: MovieSummary) => {
    const label = movie.title_vi || movie.name || movie.slug;
    setConfirmDialog({
      title: 'Xác Nhận Xóa Cache M3U8 Của Phim',
      subtitle: `${label} (${movie.slug})`,
      description:
        'Thư mục playlist M3U8 đã lưu của bộ phim này sẽ bị xóa để máy chủ trích xuất lại luồng phát mới nhất từ nguồn.',
      confirmLabel: 'Xóa cache phim này',
      variant: 'danger',
      onConfirm: () => executeClearMovieCache(movie),
    });
  }, []);

  // Movie CRUD: Create & Update
  const handleSaveMovie = async (payload: MovieCrudPayload, editingSlug?: string) => {
    setCrudSubmitting(true);
    setCrudServerError(null);
    const isEdit = Boolean(editingSlug);
    const endpoint = isEdit
      ? `/api/admin/movies/${encodeURIComponent(editingSlug!)}`
      : '/api/admin/movies';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await adminFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await parseJsonSafe(res);
      if (!res.ok || data.success === false) {
        throw new Error(
          extractApiError(
            data,
            res.status,
            isEdit ? 'Không thể cập nhật thông tin phim' : 'Không thể tạo phim mới'
          )
        );
      }

      const successMsg = isEdit
        ? `Đã cập nhật phim "${payload.title_vi}" (${payload.slug})`
        : `Đã thêm phim mới "${payload.title_vi}" (${payload.slug})`;
      addLog('success', successMsg);
      showToast('success', successMsg);
      setCrudModalOpen(false);
      setEditingMovie(null);
      await Promise.all([
        fetchMovies(currentPage, pageSize, searchQuery, filterType, sortBy),
        fetchStats(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi kết nối máy chủ khi lưu phim';
      setCrudServerError(msg);
      addLog('error', `Lỗi lưu phim ${payload.slug}: ${msg}`);
      showToast('error', msg);
    } finally {
      setCrudSubmitting(false);
    }
  };

  // Movie CRUD: Delete (Confirmation Gated)
  const executeDeleteMovie = async (movie: MovieSummary) => {
    const slug = movie.slug;
    const label = movie.title_vi || movie.name || slug;
    setConfirmBusy(true);
    setDeletingMovieSlug(slug);
    addLog('warn', `Đang xóa phim khỏi cơ sở dữ liệu: ${slug}...`);

    try {
      const res = await adminFetch(`/api/admin/movies/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      });
      if (res.status === 401 || res.status === 403) return;
      const data = await parseJsonSafe(res);
      if (!res.ok || data.success === false) {
        throw new Error(extractApiError(data, res.status, `Không thể xóa phim ${slug}`));
      }

      const nextPage =
        moviesList.length <= 1 && currentPage > 1 ? currentPage - 1 : currentPage;
      setConfirmDialog(null);
      addLog('success', `Đã xóa phim "${label}" (${slug}) khỏi kho dữ liệu.`);
      showToast('success', `Đã xóa phim: ${label}`);
      if (nextPage !== currentPage) {
        setCurrentPage(nextPage);
      } else {
        await fetchMovies(nextPage, pageSize, searchQuery, filterType, sortBy);
      }
      await fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Lỗi khi xóa phim ${slug}`;
      addLog('error', `Lỗi xóa phim ${slug}: ${msg}`);
      showToast('error', msg);
    } finally {
      setConfirmBusy(false);
      setDeletingMovieSlug(null);
    }
  };

  const requestDeleteMovieConfirm = useCallback((movie: MovieSummary) => {
    const label = movie.title_vi || movie.name || movie.slug;
    setConfirmDialog({
      title: 'Xác Nhận Xóa Phim Khỏi Cơ Sở Dữ Liệu',
      subtitle: `${label} (${movie.slug})`,
      description:
        'Hành động này sẽ xóa vĩnh viễn bộ phim, danh sách tập liên kết trong SQLite và toàn bộ thư mục cache M3U8 của phim. Không thể hoàn tác sau khi xóa.',
      confirmLabel: 'Xóa vĩnh viễn',
      variant: 'danger',
      onConfirm: () => executeDeleteMovie(movie),
    });
  }, [currentPage, filterType, moviesList.length, pageSize, searchQuery, sortBy]);

  const totalPages = Math.max(1, Math.ceil(moviesTotal / pageSize));

  const handleJumpPageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = jumpPageInput.trim();
    const parsed = parseInt(raw, 10);
    if (!raw || Number.isNaN(parsed) || parsed < 1 || parsed > totalPages) {
      showToast('warning', `Vui lòng nhập số trang hợp lệ từ 1 đến ${totalPages}.`);
      return;
    }
    setCurrentPage(parsed);
    setJumpPageInput('');
  };

  // ==========================================
  // RENDER: LOGIN GATE WHEN NOT AUTHENTICATED
  // ==========================================
  if (!isAuthenticated) {
    const errorId = 'admin-auth-error';
    return (
      <main className="min-h-screen w-full bg-[#060b05] text-[#f4fbf0] font-sans flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-[440px] bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-7">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-lime-400/15 border border-lime-400/35 flex items-center justify-center">
              <img
                src="/logo-64.png"
                alt="Bơ Film"
                width={44}
                height={44}
                decoding="async"
                className="w-11 h-11 object-contain"
              />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#f4fbf0] flex items-center justify-center gap-1.5">
              <span className="text-lime-400">Bơ</span>
              <span>Film</span>
              <span className="text-[#9ab395] font-semibold">Admin</span>
            </h1>
            <p className="mt-1.5 text-[13px] text-[#9ab395] leading-relaxed">
              Cổng quản trị bảo mật • Điều khiển Crawler, Kho Phim &amp; Cache M3U8
            </p>
          </div>

          {authError && (
            <div
              id={errorId}
              role="alert"
              aria-live="assertive"
              className="mb-5 rounded-xl bg-red-500/15 border border-red-400/40 px-3.5 py-3 flex items-start gap-2.5 text-[13px] text-red-200 leading-snug"
            >
              <AlertTriangle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} noValidate>
            <input type="hidden" name="username" value="admin" autoComplete="username" />

            <div className="mb-5">
              <label
                htmlFor="admin-password"
                className="block text-xs font-semibold uppercase tracking-wider text-[#9ab395] mb-2"
              >
                Mật khẩu Quản trị
              </label>
              <div className="relative flex items-center">
                <Lock
                  className="w-4 h-4 text-[#9ab395] absolute left-3.5 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="admin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Nhập mật khẩu quản trị..."
                  aria-invalid={Boolean(authError)}
                  aria-describedby={authError ? errorId : undefined}
                  required
                  autoFocus
                  className="w-full min-h-[48px] pl-10 pr-12 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.2)] text-[#f4fbf0] placeholder-[#9ab395]/75 text-base sm:text-sm transition-colors motion-reduce:transition-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                  aria-pressed={showPassword}
                  aria-controls="admin-password"
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#9ab395] hover:text-[#f4fbf0] hover:bg-white/5 transition-colors motion-reduce:transition-none cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full min-h-[48px] rounded-xl bg-lime-400 enabled:hover:bg-lime-300 text-[#060b05] text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {authLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  <span>Đang xác thực...</span>
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4" aria-hidden="true" />
                  <span>Đăng Nhập Quản Trị</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="min-h-[44px] min-w-[44px] px-4 rounded-xl text-[13px] font-medium text-[#9ab395] hover:text-[#f4fbf0] hover:bg-white/5 inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Quay lại Trang Chủ Cinema</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  const sourceComparisonLabel =
    stats.remaining_movies == null
      ? 'Chưa có dữ liệu đối chiếu với kho nguồn'
      : `Chưa có catalog: ${stats.remaining_movies.toLocaleString()} phim`;

  // ==========================================
  // RENDER: AUTHENTICATED ADMIN DASHBOARD
  // ==========================================
  return (
    <div className="min-h-screen w-full max-w-[100vw] bg-[#060b05] text-[#f4fbf0] font-sans pb-16">
      <AdminToast toast={toast} onDismiss={dismissToast} />

      <AdminHeader onNavigate={onNavigate} onLogout={handleLogout} />

      <main className="admin-dashboard-main max-w-[1360px] min-w-0 mx-auto px-4 sm:px-6 pt-6">
        {/* Page H1 & Refresh */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#f4fbf0]">
              Bảng Điều Khiển Quản Trị
            </h1>
            <p className="mt-1 text-sm text-[#9ab395]">
              Giám sát tiến trình đồng bộ dữ liệu phim, quản lý danh mục CRUD và bộ nhớ đệm M3U8
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              void fetchStats();
              void fetchMovies(currentPage, pageSize, searchQuery, filterType, sortBy);
              showToast('success', 'Đã làm mới dữ liệu thống kê và danh sách phim');
            }}
            disabled={statsLoading}
            className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-[#0a170a] border border-[rgba(163,230,53,0.2)] text-[13px] font-semibold text-[#f4fbf0] enabled:hover:bg-lime-400/10 enabled:hover:border-lime-400/40 inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={`w-4 h-4 text-lime-400 ${statsLoading ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            <span>Làm Mới Số Liệu</span>
          </button>
        </div>

        {/* 1 & 2. Realtime Stat Cards + Crawler Progress Bar */}
        <AdminStatsGrid
          stats={stats}
          sourceComparisonLabel={sourceComparisonLabel}
          actionLoading={actionLoading}
          onRequestFullCrawl={requestFullCrawlConfirm}
        />

        {/* 3. Real Crawler Modes & Global Cache Controls */}
        <AdminCrawlerControls
          stats={stats}
          actionLoading={actionLoading}
          onRequestFullCrawl={requestFullCrawlConfirm}
          onTriggerMode={(mode, label) => {
            void handleTriggerMode(mode, label);
          }}
          onWarmupHotMovies={() => {
            void handleWarmupHotMovies();
          }}
          onStopCrawler={() => {
            void handleStopCrawler();
          }}
          onRequestClearAllCache={requestClearAllCacheConfirm}
        />

        {/* 4. Server Task Logs Terminal */}
        <AdminTaskTerminal
          logs={logs}
          logsConnected={logsConnected}
          logsError={logsError}
          logWriteError={logWriteError}
          hasOlderLogs={hasOlderLogs}
          olderLogsLoading={olderLogsLoading}
          autoScrollLogs={autoScrollLogs}
          copiedLogs={copiedLogs}
          logsContainerRef={logsContainerRef}
          onToggleAutoScroll={() => setAutoScrollLogs((prev) => !prev)}
          onCopyLogs={() => {
            void handleCopyLogs();
          }}
          onExportLogs={() => {
            void exportLogs();
          }}
          onLoadOlderLogs={() => {
            void loadOlderLogs();
          }}
        />

        {/* 5. Movie Catalog CRUD, Sortable Table & Responsive Mobile Cards */}
        <AdminMoviesSection
          movies={moviesList}
          moviesTotal={moviesTotal}
          moviesLoading={moviesLoading}
          moviesError={moviesError}
          searchQuery={searchQuery}
          filterType={filterType}
          sortBy={sortBy}
          currentPage={currentPage}
          pageSize={pageSize}
          totalPages={totalPages}
          jumpPageInput={jumpPageInput}
          clearingCacheSlug={clearingCacheSlug}
          deletingMovieSlug={deletingMovieSlug}
          onSearchChange={(q) => {
            setSearchQuery(q);
            setCurrentPage(1);
          }}
          onFilterTypeChange={(t) => {
            setFilterType(t);
            setCurrentPage(1);
          }}
          onSortChange={(s) => {
            setSortBy(s);
            setCurrentPage(1);
          }}
          onPageChange={(p) => setCurrentPage(p)}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
          onJumpPageInputChange={setJumpPageInput}
          onJumpPageSubmit={handleJumpPageSubmit}
          onRetryFetch={() => {
            void fetchMovies(currentPage, pageSize, searchQuery, filterType, sortBy);
          }}
          onOpenCreateMovie={() => {
            setCrudServerError(null);
            setEditingMovie(null);
            setCrudModalMode('create');
            setCrudModalOpen(true);
          }}
          onOpenEditMovie={(movie) => {
            setCrudServerError(null);
            setEditingMovie(movie);
            setCrudModalMode('edit');
            setCrudModalOpen(true);
          }}
          onRequestDeleteMovie={requestDeleteMovieConfirm}
          onRequestClearMovieCache={requestClearMovieCacheConfirm}
          onWatchMovie={(slug) => onNavigate(`/xem-phim/${encodeURIComponent(slug)}`)}
        />
      </main>

      {/* Accessible Native <dialog> Confirmation Modal */}
      <AdminConfirmDialog
        dialogState={confirmDialog}
        busy={confirmBusy}
        onClose={() => {
          if (!confirmBusy) setConfirmDialog(null);
        }}
      />

      {/* Accessible Native <dialog> Create / Edit Movie Modal */}
      <AdminMovieFormModal
        open={crudModalOpen}
        mode={crudModalMode}
        initialMovie={editingMovie}
        submitting={crudSubmitting}
        serverError={crudServerError}
        onClose={() => {
          if (!crudSubmitting) {
            setCrudModalOpen(false);
            setEditingMovie(null);
            setCrudServerError(null);
          }
        }}
        onSubmit={handleSaveMovie}
      />
    </div>
  );
};
