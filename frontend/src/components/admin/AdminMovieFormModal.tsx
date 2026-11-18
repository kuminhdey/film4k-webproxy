// frontend/src/components/admin/AdminMovieFormModal.tsx
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Film, Loader2, Save, Wand2, X } from 'lucide-react';
import { MovieSummary } from '../../types';
import {
  isValidHttpOrRelativeUrl,
  MovieCrudFormValues,
  MovieCrudPayload,
  SLUG_PATTERN,
  slugifyVietnamese,
} from './adminTypes';

interface AdminMovieFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialMovie: MovieSummary | null;
  submitting: boolean;
  serverError: string | null;
  onClose: () => void;
  onSubmit: (payload: MovieCrudPayload, editingSlug?: string) => Promise<void>;
}

type FieldErrors = Partial<Record<keyof MovieCrudFormValues, string>>;

function createDefaultFormValues(): MovieCrudFormValues {
  return {
    slug: '',
    title_vi: '',
    title_en: '',
    movie_type: 'movie',
    year: String(new Date().getFullYear()),
    quality: 'FHD',
    score: '',
    country: 'Âu Mỹ',
    genresText: 'Hành Động, Phiêu Lưu',
    poster: '',
    backdrop: '',
    overview: '',
    total_episodes: '1',
    stream: '',
  };
}

function buildValuesFromSummary(movie: MovieSummary): MovieCrudFormValues {
  return {
    slug: movie.slug || '',
    title_vi: movie.title_vi || movie.name || '',
    title_en: movie.title_en || movie.original_name || '',
    movie_type: movie.movie_type === 'tv' ? 'tv' : 'movie',
    year: movie.year != null ? String(movie.year) : '',
    quality: movie.quality || 'FHD',
    score: movie.score != null ? String(movie.score) : '',
    country: movie.country || '',
    genresText: Array.isArray(movie.genres) ? movie.genres.join(', ') : '',
    poster: movie.poster || movie.poster_url || movie.thumb_url || '',
    backdrop: movie.backdrop || '',
    overview: '',
    total_episodes: movie.total_episodes != null ? String(movie.total_episodes) : '1',
    stream: '',
  };
}

function extractPrimaryStreamUrl(raw: Record<string, unknown>): string {
  const direct = raw.stream;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  if (direct && typeof direct === 'object') {
    const obj = direct as Record<string, unknown>;
    if (typeof obj.hlsUrl === 'string' && obj.hlsUrl.trim()) return obj.hlsUrl.trim();
    if (typeof obj.url === 'string' && obj.url.trim()) return obj.url.trim();
  }
  if (Array.isArray(raw.servers) && raw.servers.length > 0) {
    const first = raw.servers[0] as Record<string, unknown>;
    if (typeof first?.hlsUrl === 'string' && first.hlsUrl.trim()) return first.hlsUrl.trim();
    if (typeof first?.url === 'string' && first.url.trim()) return first.url.trim();
  }
  return '';
}

export const AdminMovieFormModal: React.FC<AdminMovieFormModalProps> = ({
  open,
  mode,
  initialMovie,
  submitting,
  serverError,
  onClose,
  onSubmit,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [values, setValues] = useState<MovieCrudFormValues>(createDefaultFormValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [detailHydrating, setDetailHydrating] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (mode === 'edit' && initialMovie) {
      setValues(buildValuesFromSummary(initialMovie));
      setSlugManuallyEdited(true);

      const controller = new AbortController();
      setDetailHydrating(true);
      fetch(`/api/movies/${encodeURIComponent(initialMovie.slug)}`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) return;
          const detail = (await res.json()) as Record<string, unknown>;
          setValues((prev) => ({
            ...prev,
            country:
              typeof detail.country === 'string' && detail.country.trim()
                ? detail.country
                : prev.country,
            backdrop:
              typeof detail.backdrop === 'string' && detail.backdrop.trim()
                ? detail.backdrop
                : prev.backdrop,
            overview: typeof detail.overview === 'string' ? detail.overview : prev.overview,
            stream: extractPrimaryStreamUrl(detail) || prev.stream,
          }));
        })
        .catch(() => {
          // keep summary values if detail endpoint unavailable
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setDetailHydrating(false);
          }
        });

      return () => controller.abort();
    }

    setValues(createDefaultFormValues());
    setSlugManuallyEdited(false);
    setDetailHydrating(false);
  }, [open, mode, initialMovie]);

  if (!open) return null;

  const updateField = <K extends keyof MovieCrudFormValues>(
    field: K,
    nextVal: MovieCrudFormValues[K]
  ) => {
    setValues((prev) => {
      const updated = { ...prev, [field]: nextVal };
      if (mode === 'create' && field === 'title_vi' && !slugManuallyEdited) {
        updated.slug = slugifyVietnamese(String(nextVal));
      }
      return updated;
    });
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const validate = (): MovieCrudPayload | null => {
    const nextErrors: FieldErrors = {};
    const cleanSlug = values.slug.trim().toLowerCase();
    const cleanTitleVi = values.title_vi.trim();

    if (!cleanSlug) {
      nextErrors.slug = 'Vui lòng nhập định danh slug cho phim.';
    } else if (!SLUG_PATTERN.test(cleanSlug)) {
      nextErrors.slug = 'Slug chỉ được gồm chữ thường (a-z), chữ số (0-9) và dấu gạch ngang (-).';
    }

    if (!cleanTitleVi) {
      nextErrors.title_vi = 'Vui lòng nhập tên phim tiếng Việt.';
    }

    let parsedYear: number | null = null;
    if (values.year.trim()) {
      const y = Number(values.year.trim());
      if (!Number.isInteger(y) || y < 1900 || y > 2100) {
        nextErrors.year = 'Năm phát hành phải là số nguyên từ 1900 đến 2100.';
      } else {
        parsedYear = y;
      }
    }

    let parsedScore: number | null = null;
    if (values.score.trim()) {
      const sc = Number(values.score.trim());
      if (!Number.isFinite(sc) || sc < 0 || sc > 10) {
        nextErrors.score = 'Điểm đánh giá phải nằm trong khoảng từ 0 đến 10.';
      } else {
        parsedScore = Math.round(sc * 10) / 10;
      }
    }

    let parsedEpisodes: number | null = null;
    if (values.total_episodes.trim()) {
      const ep = Number(values.total_episodes.trim());
      if (!Number.isInteger(ep) || ep < 1 || ep > 10000) {
        nextErrors.total_episodes = 'Tổng số tập phải là số nguyên từ 1 trở lên.';
      } else {
        parsedEpisodes = ep;
      }
    }

    if (!isValidHttpOrRelativeUrl(values.poster)) {
      nextErrors.poster = 'URL ảnh poster phải bắt đầu bằng https://, http:// hoặc đường dẫn /...';
    }
    if (!isValidHttpOrRelativeUrl(values.backdrop)) {
      nextErrors.backdrop = 'URL ảnh nền phải bắt đầu bằng https://, http:// hoặc đường dẫn /...';
    }
    if (!isValidHttpOrRelativeUrl(values.stream)) {
      nextErrors.stream = 'URL luồng phát M3U8 phải bắt đầu bằng https://, http:// hoặc đường dẫn /...';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return null;
    }

    const genres = values.genresText
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);

    return {
      slug: cleanSlug,
      title_vi: cleanTitleVi,
      title_en: values.title_en.trim(),
      movie_type: values.movie_type,
      year: parsedYear,
      quality: values.quality.trim() || 'FHD',
      score: parsedScore,
      country: values.country.trim(),
      genres,
      poster: values.poster.trim(),
      backdrop: values.backdrop.trim(),
      overview: values.overview.trim(),
      total_episodes: parsedEpisodes,
      stream: values.stream.trim(),
    };
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = validate();
    if (!payload) return;
    await onSubmit(payload, mode === 'edit' ? initialMovie?.slug : undefined);
  };

  const inputBaseClass =
    'w-full min-h-[44px] px-3.5 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.18)] text-[#f4fbf0] placeholder-[#9ab395]/70 text-base sm:text-sm transition-colors motion-reduce:transition-none';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="movie-crud-modal-title"
      onCancel={(e) => {
        if (submitting) {
          e.preventDefault();
          return;
        }
        onClose();
      }}
      onClick={(e) => {
        if (!submitting && e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 m-0 w-screen h-screen max-w-none max-h-none bg-black/80 backdrop-blur-sm p-3 sm:p-6 z-50 flex items-center justify-center border-0 text-[#f4fbf0]"
    >
      <div className="w-full max-w-2xl max-h-[92vh] rounded-2xl bg-[#0a170a] border border-[rgba(163,230,53,0.2)] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-[#060b05] border-b border-[rgba(163,230,53,0.14)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-lime-400/15 border border-lime-400/30 flex items-center justify-center shrink-0">
              <Film className="w-5 h-5 text-lime-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="movie-crud-modal-title" className="text-base sm:text-lg font-bold text-[#f4fbf0] truncate">
                {mode === 'create' ? 'Thêm Phim Mới Vào Kho' : `Chỉnh Sửa Phim: ${initialMovie?.title_vi || initialMovie?.slug || ''}`}
              </h2>
              <p className="text-xs text-[#9ab395] truncate">
                {detailHydrating
                  ? 'Đang nạp chi tiết mô tả & luồng phát từ cơ sở dữ liệu...'
                  : 'Cập nhật trực tiếp vào cơ sở dữ liệu SQLite của Bơ Film'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Đóng biểu mẫu phim"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#9ab395] enabled:hover:text-[#f4fbf0] enabled:hover:bg-white/5 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} noValidate className="flex-1 overflow-y-auto p-5 space-y-4">
          {serverError && (
            <div
              role="alert"
              className="rounded-xl bg-red-500/15 border border-red-400/40 px-4 py-3 flex items-start gap-2.5 text-[13px] text-red-200"
            >
              <AlertCircle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{serverError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Title VI */}
            <div>
              <label htmlFor="crud-title-vi" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Tên phim tiếng Việt <span className="text-red-300">*</span>
              </label>
              <input
                id="crud-title-vi"
                type="text"
                value={values.title_vi}
                onChange={(e) => updateField('title_vi', e.target.value)}
                placeholder="Ví dụ: Hành Tinh Cát: Phần Hai"
                aria-invalid={Boolean(errors.title_vi)}
                aria-describedby={errors.title_vi ? 'err-title-vi' : undefined}
                required
                className={inputBaseClass}
              />
              {errors.title_vi && (
                <p id="err-title-vi" role="alert" className="mt-1 text-xs text-red-300">
                  {errors.title_vi}
                </p>
              )}
            </div>

            {/* Title EN */}
            <div>
              <label htmlFor="crud-title-en" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Tên gốc / Tiếng Anh
              </label>
              <input
                id="crud-title-en"
                type="text"
                value={values.title_en}
                onChange={(e) => updateField('title_en', e.target.value)}
                placeholder="Ví dụ: Dune: Part Two"
                className={inputBaseClass}
              />
            </div>
          </div>

          {/* Slug + Movie Type */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="crud-slug" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Định danh đường dẫn (Slug `a-z0-9-`) <span className="text-red-300">*</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="crud-slug"
                  type="text"
                  value={values.slug}
                  readOnly={mode === 'edit'}
                  onChange={(e) => {
                    setSlugManuallyEdited(true);
                    updateField('slug', e.target.value);
                  }}
                  placeholder="vi-du-hanh-tinh-cat-2"
                  aria-invalid={Boolean(errors.slug)}
                  aria-describedby={errors.slug ? 'err-slug' : undefined}
                  required
                  className={`${inputBaseClass} font-mono ${
                    mode === 'edit' ? 'opacity-75 cursor-not-allowed' : ''
                  }`}
                />
                {mode === 'create' && (
                  <button
                    type="button"
                    onClick={() => {
                      const generated = slugifyVietnamese(values.title_vi || values.title_en);
                      setSlugManuallyEdited(true);
                      updateField('slug', generated);
                    }}
                    title="Tạo slug tự động từ tên phim"
                    aria-label="Tạo slug tự động từ tên phim"
                    className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-lime-400/15 border border-lime-400/35 text-xs font-semibold text-lime-300 hover:bg-lime-400/25 inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Wand2 className="w-4 h-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Tạo slug</span>
                  </button>
                )}
              </div>
              {errors.slug ? (
                <p id="err-slug" role="alert" className="mt-1 text-xs text-red-300">
                  {errors.slug}
                </p>
              ) : (
                mode === 'edit' && (
                  <p className="mt-1 text-xs text-[#9ab395]">
                    Slug cố định theo bản ghi đang chỉnh sửa.
                  </p>
                )
              )}
            </div>

            <div>
              <label htmlFor="crud-movie-type" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Định dạng phim
              </label>
              <select
                id="crud-movie-type"
                value={values.movie_type}
                onChange={(e) =>
                  updateField('movie_type', e.target.value === 'tv' ? 'tv' : 'movie')
                }
                className={`${inputBaseClass} cursor-pointer`}
              >
                <option value="movie">Phim lẻ (Movie)</option>
                <option value="tv">Phim bộ (TV Series)</option>
              </select>
            </div>
          </div>

          {/* Year, Quality, Score, Total Episodes */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label htmlFor="crud-year" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Năm phát hành
              </label>
              <input
                id="crud-year"
                type="number"
                min={1900}
                max={2100}
                value={values.year}
                onChange={(e) => updateField('year', e.target.value)}
                placeholder="2026"
                aria-invalid={Boolean(errors.year)}
                aria-describedby={errors.year ? 'err-year' : undefined}
                className={`${inputBaseClass} tabular-nums`}
              />
              {errors.year && (
                <p id="err-year" role="alert" className="mt-1 text-xs text-red-300">
                  {errors.year}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="crud-quality" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Chất lượng
              </label>
              <input
                id="crud-quality"
                type="text"
                value={values.quality}
                onChange={(e) => updateField('quality', e.target.value)}
                placeholder="FHD / 4K"
                className={inputBaseClass}
              />
            </div>

            <div>
              <label htmlFor="crud-score" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Điểm IMDb/TMDB
              </label>
              <input
                id="crud-score"
                type="number"
                step="0.1"
                min={0}
                max={10}
                value={values.score}
                onChange={(e) => updateField('score', e.target.value)}
                placeholder="8.5"
                aria-invalid={Boolean(errors.score)}
                aria-describedby={errors.score ? 'err-score' : undefined}
                className={`${inputBaseClass} tabular-nums`}
              />
              {errors.score && (
                <p id="err-score" role="alert" className="mt-1 text-xs text-red-300">
                  {errors.score}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="crud-episodes" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Tổng số tập
              </label>
              <input
                id="crud-episodes"
                type="number"
                min={1}
                max={10000}
                value={values.total_episodes}
                onChange={(e) => updateField('total_episodes', e.target.value)}
                placeholder="1"
                aria-invalid={Boolean(errors.total_episodes)}
                aria-describedby={errors.total_episodes ? 'err-episodes' : undefined}
                className={`${inputBaseClass} tabular-nums`}
              />
              {errors.total_episodes && (
                <p id="err-episodes" role="alert" className="mt-1 text-xs text-red-300">
                  {errors.total_episodes}
                </p>
              )}
            </div>
          </div>

          {/* Country & Genres */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="crud-country" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Quốc gia
              </label>
              <input
                id="crud-country"
                type="text"
                value={values.country}
                onChange={(e) => updateField('country', e.target.value)}
                placeholder="Âu Mỹ, Hàn Quốc, Nhật Bản..."
                className={inputBaseClass}
              />
            </div>

            <div>
              <label htmlFor="crud-genres" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                Thể loại (phân cách bằng dấu phẩy)
              </label>
              <input
                id="crud-genres"
                type="text"
                value={values.genresText}
                onChange={(e) => updateField('genresText', e.target.value)}
                placeholder="Hành Động, Viễn Tưởng, Chính Kịch"
                className={inputBaseClass}
              />
            </div>
          </div>

          {/* Poster & Backdrop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="crud-poster" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                URL Ảnh Poster
              </label>
              <input
                id="crud-poster"
                type="url"
                value={values.poster}
                onChange={(e) => updateField('poster', e.target.value)}
                placeholder="https://image.tmdb.org/t/p/w500/..."
                aria-invalid={Boolean(errors.poster)}
                aria-describedby={errors.poster ? 'err-poster' : undefined}
                className={inputBaseClass}
              />
              {errors.poster && (
                <p id="err-poster" role="alert" className="mt-1 text-xs text-red-300">
                  {errors.poster}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="crud-backdrop" className="block text-xs font-bold text-[#9ab395] mb-1.5">
                URL Ảnh Nền (Backdrop)
              </label>
              <input
                id="crud-backdrop"
                type="url"
                value={values.backdrop}
                onChange={(e) => updateField('backdrop', e.target.value)}
                placeholder="https://image.tmdb.org/t/p/original/..."
                aria-invalid={Boolean(errors.backdrop)}
                aria-describedby={errors.backdrop ? 'err-backdrop' : undefined}
                className={inputBaseClass}
              />
              {errors.backdrop && (
                <p id="err-backdrop" role="alert" className="mt-1 text-xs text-red-300">
                  {errors.backdrop}
                </p>
              )}
            </div>
          </div>

          {/* Stream URL */}
          <div>
            <label htmlFor="crud-stream" className="block text-xs font-bold text-[#9ab395] mb-1.5">
              URL Luồng Phát Chính (HLS `.m3u8` hoặc Embed)
            </label>
            <input
              id="crud-stream"
              type="url"
              value={values.stream}
              onChange={(e) => updateField('stream', e.target.value)}
              placeholder="https://.../master.m3u8"
              aria-invalid={Boolean(errors.stream)}
              aria-describedby={errors.stream ? 'err-stream' : undefined}
              className={`${inputBaseClass} font-mono`}
            />
            {errors.stream && (
              <p id="err-stream" role="alert" className="mt-1 text-xs text-red-300">
                {errors.stream}
              </p>
            )}
          </div>

          {/* Overview */}
          <div>
            <label htmlFor="crud-overview" className="block text-xs font-bold text-[#9ab395] mb-1.5">
              Tóm tắt nội dung phim
            </label>
            <textarea
              id="crud-overview"
              rows={3}
              value={values.overview}
              onChange={(e) => updateField('overview', e.target.value)}
              placeholder="Nhập mô tả nội dung phim..."
              className="w-full min-h-[88px] p-3.5 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.18)] text-[#f4fbf0] placeholder-[#9ab395]/70 text-base sm:text-sm leading-relaxed transition-colors motion-reduce:transition-none"
            />
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 border-t border-[rgba(163,230,53,0.12)] flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.18)] text-[13px] font-semibold text-[#f4fbf0] enabled:hover:bg-white/5 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Hủy bỏ
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] min-w-[44px] px-5 rounded-xl bg-lime-400 enabled:hover:bg-lime-300 text-[#060b05] text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" aria-hidden="true" />
                  <span>{mode === 'create' ? 'Tạo Phim Mới' : 'Lưu Thay Đổi'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
};
