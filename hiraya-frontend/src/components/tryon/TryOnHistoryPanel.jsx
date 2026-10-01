import { useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Download, Heart, History, LoaderCircle, RotateCcw, Share2, Sparkles, Trash2, X,
} from 'lucide-react';
import api, { parseApiError } from '../../api/axios';
import useConfirm from '../../hooks/useConfirm';

export const HISTORY_QUERY_KEY = 'tryon-history';
const DETAIL_QUERY_KEY = 'tryon-history-detail';
const PAGE_SIZE = 12;

const formatDate = (value) => (value
  ? new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
  : '');

const imageSrc = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const source = value.trim();
  return source.startsWith('data:') || /^https?:\/\//i.test(source) || source.startsWith('/')
    ? source
    : `data:image/png;base64,${source}`;
};

/*
 * ONE SILENT RETRY, ONLY FOR A SERVER THAT FAILED RATHER THAN REFUSED.
 * The database is a remote pooler that occasionally drops a connection (a
 * one-off 500); the very next request answers. A 401/404 is a real answer and
 * is never retried.
 */
const retryTransient = (failureCount, error) => {
  const { isNetworkError, isServerError } = parseApiError(error);
  return failureCount < 1 && (isNetworkError || isServerError);
};

/* A segmented control: a pressed-in track with one navy pill. */
const Segmented = ({ options, value, onChange, layoutId, label }) => (
  <div role="tablist" aria-label={label} className="flex w-fit rounded-full bg-cream-200/70 p-1 shadow-neu-inset">
    {options.map((opt) => (
      <button
        key={opt.key}
        type="button"
        role="tab"
        aria-selected={value === opt.key}
        onClick={() => onChange(opt.key)}
        className={`relative cursor-pointer rounded-full px-4 py-1.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus ${
          value === opt.key ? 'text-hiraya-on-accent' : 'text-hiraya-ink-muted hover:text-hiraya-accent'
        }`}
      >
        {value === opt.key && (
          <motion.span
            layoutId={layoutId}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="absolute inset-0 rounded-full bg-hiraya-accent shadow-[0_8px_16px_-8px_rgba(21,32,54,0.7)]"
          />
        )}
        <span className="relative">{opt.label}</span>
      </button>
    ))}
  </div>
);

Segmented.propTypes = {
  options: PropTypes.arrayOf(PropTypes.shape({ key: PropTypes.string, label: PropTypes.string })).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  layoutId: PropTypes.string.isRequired,
  label: PropTypes.string,
};

const Notice = ({ children, onRetry, tone = 'error' }) => (
  <div
    className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs ${
      tone === 'error' ? 'border border-red-600/40 bg-red-500/10 text-red-700' : 'bg-cream-200/55 text-hiraya-ink shadow-neu-inset'
    }`}
  >
    <span>{children}</span>
    {onRetry && (
      <button type="button" onClick={onRetry} className="btn-quiet shrink-0 cursor-pointer">Try again</button>
    )}
  </div>
);

Notice.propTypes = { children: PropTypes.node, onRetry: PropTypes.func, tone: PropTypes.oneOf(['error', 'info']) };

/* ------------------------------------------------------------------ list -- */

const HistoryList = ({ open, filter, setFilter, onOpen, onToggleFavorite }) => {
  const favorites = filter === 'favorites';
  const query = useInfiniteQuery({
    queryKey: [HISTORY_QUERY_KEY, filter],
    queryFn: async ({ pageParam }) => (await api.get('/tryon/history', {
      params: { favorites: favorites ? 1 : 0, per_page: PAGE_SIZE, page: pageParam },
    })).data,
    initialPageParam: 1,
    getNextPageParam: (last) => (last?.current_page < last?.last_page ? last.current_page + 1 : undefined),
    enabled: open,
    staleTime: 60 * 1000,
    retry: retryTransient,
  });

  const items = (query.data?.pages ?? []).flatMap((page) => (Array.isArray(page?.data) ? page.data : []));
  const total = query.data?.pages?.[0]?.total ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pb-4">
        <Segmented
          label="Which try-ons to show"
          layoutId="studio-history-filter"
          value={filter}
          onChange={setFilter}
          options={[{ key: 'all', label: 'All Try-Ons' }, { key: 'favorites', label: 'Favorites' }]}
        />
        {!query.isLoading && total > 0 && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
            {total} {total === 1 ? 'look' : 'looks'}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 scrollbar-none">
        {query.isError && items.length === 0 ? (
          <Notice onRetry={() => query.refetch()}>We couldn&apos;t load your try-on history.</Notice>
        ) : query.isLoading ? (
          <div className="grid grid-cols-2 gap-3" aria-label="Loading your looks">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-[18px] bg-hiraya-surface p-1.5 shadow-neu">
                <div className="aspect-[4/5] rounded-xl bg-cream-200/70" />
                <div className="mx-1 my-2.5 h-2.5 w-3/4 rounded-full bg-cream-200/80" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-navy-900 text-cream-100 shadow-neu">
              {favorites ? <Heart size={24} /> : <Sparkles size={24} />}
            </div>
            <h3 className="font-serif text-lg text-hiraya-ink">{favorites ? 'No favorites yet' : 'No try-ons yet'}</h3>
            <p className="mt-2 max-w-[16rem] text-xs leading-5 text-hiraya-ink-muted">
              {favorites
                ? 'Tap the heart on a look to keep your best fittings here.'
                : 'Generate a fitting on the canvas — every finished render is saved here automatically.'}
            </p>
            {favorites && (
              <button type="button" onClick={() => setFilter('all')} className="btn-secondary mt-5 cursor-pointer rounded-full">
                View All Try-Ons
              </button>
            )}
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3">
              {items.map((item) => (
                <li key={item.session_id} className="relative">
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="group w-full cursor-pointer rounded-[18px] bg-hiraya-surface p-1.5 text-left shadow-neu ring-1 ring-cream-50/80 transition-[translate,box-shadow] duration-300 hover:-translate-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
                  >
                    <div className="aspect-[4/5] overflow-hidden rounded-xl bg-black">
                      {item.thumbnail ? (
                        <img
                          src={imageSrc(item.thumbnail)}
                          alt={item.title}
                          loading="lazy"
                          className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-cream-400"><Sparkles size={20} /></div>
                      )}
                    </div>
                    <div className="px-1.5 pb-1 pt-2.5">
                      <p className="truncate text-xs font-semibold text-hiraya-ink">{item.title}</p>
                      <p className="mt-0.5 text-[10px] text-hiraya-ink-muted">{formatDate(item.created_at)}</p>
                    </div>
                  </button>
                  {/* A sibling of the card button (never nested inside it). */}
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(item)}
                    aria-pressed={!!item.is_favorite}
                    aria-label={item.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                    className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-cream-100 backdrop-blur-sm transition-colors hover:bg-hiraya-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100"
                  >
                    <Heart size={15} className={item.is_favorite ? 'fill-current' : ''} />
                  </button>
                </li>
              ))}
            </ul>

            {query.hasNextPage && (
              <button
                type="button"
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="btn-secondary mx-auto mt-5 flex cursor-pointer rounded-full disabled:cursor-wait"
              >
                {query.isFetchingNextPage ? <LoaderCircle size={14} className="animate-spin" /> : null}
                {query.isFetchingNextPage ? 'Loading…' : 'Load more looks'}
              </button>
            )}
            {query.isError && items.length > 0 && (
              <div className="mt-4">
                <Notice onRetry={() => query.fetchNextPage()}>Couldn&apos;t load more looks.</Notice>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

HistoryList.propTypes = {
  open: PropTypes.bool.isRequired,
  filter: PropTypes.string.isRequired,
  setFilter: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  onToggleFavorite: PropTypes.func.isRequired,
};

/* ---------------------------------------------------------------- detail -- */

const HistoryDetail = ({ item, onBack, onToggleFavorite, onUseOutfit, onDelete }) => {
  const [view, setView] = useState('after');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null); // { tone, text }

  const detail = useQuery({
    queryKey: [DETAIL_QUERY_KEY, item.session_id],
    queryFn: async () => (await api.get(`/tryon/history/${item.session_id}`)).data,
    staleTime: 5 * 60 * 1000,
    retry: retryTransient,
  });

  const look = detail.data;
  const after = imageSrc(look?.result_image_base64);
  const before = imageSrc(look?.original_image_base64);
  const shown = view === 'before' ? before : after;
  const placeholder = imageSrc(item.thumbnail);

  const useOutfit = async () => {
    setBusy('reuse');
    setMessage(null);
    try {
      const { data } = await api.get(`/tryon/history/${item.session_id}/outfit`);
      onUseOutfit(data.garments || []);
    } catch (err) {
      setMessage({ tone: 'error', text: parseApiError(err).message || 'This saved outfit is no longer available.' });
    } finally {
      setBusy('');
    }
  };

  const download = () => {
    if (!after) return;
    const link = document.createElement('a');
    link.href = after;
    link.download = `Hiraya_TryOn_${item.session_id}.png`;
    link.click();
  };

  const share = async () => {
    if (!after) return;
    try {
      const blob = await (await fetch(after)).blob();
      const file = new File([blob], 'Hiraya_TryOn.png', { type: blob.type || 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: item.title });
      } else {
        await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]);
        setMessage({ tone: 'info', text: 'Image copied to your clipboard.' });
      }
    } catch (err) {
      if (err?.name !== 'AbortError') setMessage({ tone: 'error', text: 'Sharing is not available in this browser.' });
    }
  };

  const remove = async () => {
    setBusy('delete');
    const deleted = await onDelete(item);
    if (!deleted) setBusy('');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 scrollbar-none">
      <button type="button" onClick={onBack} className="btn-quiet mb-3 w-fit cursor-pointer">
        <ArrowLeft size={14} /> All looks
      </button>

      <div className="rounded-[20px] bg-hiraya-surface p-2 shadow-neu ring-1 ring-cream-50/80">
        <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-2xl bg-black">
          {shown ? (
            <img src={shown} alt={view === 'before' ? 'Your original photo' : 'Your try-on result'} className="h-full w-full object-contain" />
          ) : placeholder && view === 'after' ? (
            <img src={placeholder} alt="" className="h-full w-full object-contain opacity-70 blur-[1px]" />
          ) : null}
          {detail.isLoading && (
            <span className="absolute inset-x-0 bottom-3 mx-auto flex w-fit items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-cream-100">
              <LoaderCircle size={12} className="animate-spin" /> Loading full image
            </span>
          )}
          {!detail.isLoading && view === 'before' && !before && (
            <span className="text-xs text-cream-300">The original photo was not kept for this look.</span>
          )}
        </div>
        <div className="mt-2.5 flex justify-center">
          <Segmented
            label="Compare before and after"
            layoutId="studio-history-compare"
            value={view}
            onChange={setView}
            options={[{ key: 'before', label: 'Before' }, { key: 'after', label: 'After' }]}
          />
        </div>
      </div>

      {detail.isError && (
        <div className="mt-3">
          <Notice onRetry={() => detail.refetch()}>Couldn&apos;t load the full images for this look.</Notice>
        </div>
      )}

      <div className="mt-5">
        <h3 className="font-serif text-lg leading-snug text-hiraya-ink">{look?.title || item.title}</h3>
        <p className="mt-1 text-[11px] text-hiraya-ink-muted">{formatDate(item.created_at)}</p>
        {look?.garments?.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Garments in this look">
            {look.garments.map((g) => (
              <li key={g.name} className="rounded-full bg-cream-200/70 px-2.5 py-1 text-[10px] font-semibold text-navy-800 shadow-neu-inset">
                {g.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {message && (
        <div className="mt-4">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <div className="mt-5 space-y-2.5">
        <button type="button" onClick={useOutfit} disabled={busy === 'reuse'} className="btn-primary w-full cursor-pointer rounded-full disabled:cursor-wait">
          {busy === 'reuse' ? <LoaderCircle size={16} className="animate-spin" /> : <RotateCcw size={16} />}
          Use This Outfit
        </button>
        <button type="button" onClick={() => onToggleFavorite(item)} className="btn-secondary w-full cursor-pointer rounded-full">
          <Heart size={16} className={item.is_favorite ? 'fill-current' : ''} />
          {item.is_favorite ? 'Saved to Favorites' : 'Save to Favorites'}
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={download} disabled={!after} className="btn-secondary w-full cursor-pointer rounded-full disabled:cursor-not-allowed disabled:opacity-60">
            <Download size={15} /> Download
          </button>
          <button type="button" onClick={share} disabled={!after} className="btn-secondary w-full cursor-pointer rounded-full disabled:cursor-not-allowed disabled:opacity-60">
            <Share2 size={15} /> Share
          </button>
        </div>
        <button type="button" onClick={remove} disabled={busy === 'delete'} className="btn-danger mt-2 w-full cursor-pointer rounded-full disabled:cursor-wait">
          {busy === 'delete' ? <LoaderCircle size={15} className="animate-spin" /> : <Trash2 size={15} />}
          Delete Try-On
        </button>
      </div>
    </div>
  );
};

HistoryDetail.propTypes = {
  item: PropTypes.object.isRequired,
  onBack: PropTypes.func.isRequired,
  onToggleFavorite: PropTypes.func.isRequired,
  onUseOutfit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

/* ----------------------------------------------------------------- panel -- */

/**
 * TRY-ON HISTORY — the Studio's own record of finished fittings.
 *
 * Lives in a SideDrawer on the AI Try-On page (it used to be a separate page
 * linked from the navbar), so the customer can look back, compare before and
 * after, and load a past outfit into the Style Stack without leaving the
 * canvas. The list is light (thumbnails only); a look's full images are
 * fetched when it is opened.
 */
const TryOnHistoryPanel = ({ open, onClose, onUseOutfit, className = '' }) => {
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();
  const [confirm, confirmDialog] = useConfirm();
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  // Patch one look in every cached list (All and Favorites) and the open detail.
  const patchLook = (sessionId, patch) => {
    queryClient.setQueriesData({ queryKey: [HISTORY_QUERY_KEY] }, (data) => (data?.pages
      ? {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          data: (page.data || []).map((row) => (row.session_id === sessionId ? { ...row, ...patch } : row)),
        })),
      }
      : data));
    setSelected((row) => (row?.session_id === sessionId ? { ...row, ...patch } : row));
  };

  const toggleFavorite = async (item) => {
    const next = !item.is_favorite;
    setError('');
    patchLook(item.session_id, { is_favorite: next });
    try {
      await api.patch(`/tryon/history/${item.session_id}/favorite`, { is_favorite: next });
      // The Favorites list gains or loses this look; re-read it next time it shows.
      queryClient.invalidateQueries({ queryKey: [HISTORY_QUERY_KEY, 'favorites'] });
    } catch {
      patchLook(item.session_id, { is_favorite: item.is_favorite });
      setError("We couldn't update this favorite. Please try again.");
    }
  };

  const deleteLook = async (item) => {
    const ok = await confirm({
      title: 'Delete try-on?',
      message: 'This try-on and its saved images will be deleted. This cannot be undone.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return false;
    try {
      await api.delete(`/tryon/history/${item.session_id}`);
      queryClient.removeQueries({ queryKey: [DETAIL_QUERY_KEY, item.session_id] });
      await queryClient.invalidateQueries({ queryKey: [HISTORY_QUERY_KEY] });
      setSelected(null);
      return true;
    } catch {
      setError("We couldn't delete this try-on. Please try again.");
      return false;
    }
  };

  const useOutfit = (garments) => {
    onUseOutfit(garments);
    setSelected(null);
    onClose();
  };

  return (
    <div className={`flex h-full w-full flex-col overflow-hidden rounded-[26px] bg-hiraya-surface-raised shadow-[0_30px_60px_-24px_rgba(13,21,36,0.6)] ring-1 ring-cream-50/80 ${className}`}>
      <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
        <h2 className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-navy-900 text-cream-100 shadow-neu-sm">
            <History size={15} />
          </span>
          Try-On History
        </h2>
        <button type="button" onClick={onClose} aria-label="Close try-on history" className="btn-icon h-9 w-9 cursor-pointer rounded-full">
          <X size={17} />
        </button>
      </div>

      {error && (
        <div className="px-5 pb-3">
          <Notice>{error}</Notice>
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {selected ? (
          <motion.div
            key={`detail-${selected.session_id}`}
            className="flex min-h-0 flex-1 flex-col"
            initial={reduce ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={{ duration: 0.2 }}
          >
            <HistoryDetail
              item={selected}
              onBack={() => setSelected(null)}
              onToggleFavorite={toggleFavorite}
              onUseOutfit={useOutfit}
              onDelete={deleteLook}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="flex min-h-0 flex-1 flex-col"
            initial={reduce ? false : { opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
          >
            <HistoryList
              open={open}
              filter={filter}
              setFilter={setFilter}
              onOpen={setSelected}
              onToggleFavorite={toggleFavorite}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        * The confirm dialog is portalled to <body> and lifted above the drawer
        * (z-90): rendered in place it would sit under it, and the drawer's
        * transform would also trap its `fixed` overlay inside the panel.
        */}
      {confirmDialog && createPortal(<div className="relative z-[100]">{confirmDialog}</div>, document.body)}
    </div>
  );
};

TryOnHistoryPanel.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onUseOutfit: PropTypes.func.isRequired,
  className: PropTypes.string,
};

export default TryOnHistoryPanel;
