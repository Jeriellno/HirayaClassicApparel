import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Heart, LoaderCircle, RotateCcw, Share2, Sparkles, Trash2, X } from 'lucide-react';
import api from '../api/axios';

const formatDate = (value) => new Intl.DateTimeFormat('en-PH', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

const imageSrc = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const source = value.trim();
  return source.startsWith('data:') || /^https?:\/\//i.test(source) || source.startsWith('/')
    ? source
    : `data:image/png;base64,${source}`;
};

const historyItems = (payload) => {
  // Laravel pagination normally returns { data: [...] }, but older API versions
  // returned the array directly. Accept both without allowing a malformed
  // response to crash the history grid.
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.history)) return payload.history;
  return [];
};

function EmptyState({ favoritesOnly, onReset }) {
  return (
    <div className="col-span-full rounded-3xl border border-hiraya-olive/15 bg-white/[0.03] px-6 py-16 text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#CB997E]/30 bg-[#CB997E]/10 text-hiraya-ink">
        {favoritesOnly ? <Heart size={28} /> : <Sparkles size={28} />}
      </div>
      <h2 className="font-serif text-xl text-hiraya-ink">{favoritesOnly ? 'No favorites yet' : 'No try-ons yet'}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-hiraya-sand">
        {favoritesOnly ? 'Tap the heart on a result to keep your best looks here.' : 'Your completed virtual try-ons will appear here automatically.'}
      </p>
      <button onClick={favoritesOnly ? onReset : () => window.location.assign('/try-on')} className="mt-6 rounded-full bg-[#CB997E] px-5 py-2.5 text-xs font-black uppercase tracking-widest text-hiraya-olive">
        {favoritesOnly ? 'View All Try-Ons' : 'Start a Try-On'}
      </button>
    </div>
  );
}

export default function TryOnHistory() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState('after');
  const [busy, setBusy] = useState('');

  const load = async (favoritesOnly = tab === 'favorites') => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/tryon/history', { params: { favorites: favoritesOnly ? 1 : 0, per_page: 50 } });
      setItems(historyItems(data));
    } catch {
      setError("We couldn't load your try-on history.");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(false); }, []);

  const changeTab = (next) => { setTab(next); setItems([]); load(next === 'favorites'); };

  const toggleFavorite = async (event, item) => {
    event?.stopPropagation();
    setItems((current) => current.map((row) => row.session_id === item.session_id ? { ...row, is_favorite: !row.is_favorite } : row));
    if (selected?.session_id === item.session_id) setSelected((row) => ({ ...row, is_favorite: !row.is_favorite }));
    try {
      await api.patch(`/tryon/history/${item.session_id}/favorite`, { is_favorite: !item.is_favorite });
    } catch {
      setItems((current) => current.map((row) => row.session_id === item.session_id ? { ...row, is_favorite: item.is_favorite } : row));
      setSelected((row) => row?.session_id === item.session_id ? { ...row, is_favorite: item.is_favorite } : row);
    }
  };

  const reuseOutfit = async () => {
    setBusy('reuse');
    try {
      const { data } = await api.get(`/tryon/history/${selected.session_id}/outfit`);
      sessionStorage.setItem('hiraya:reuse-outfit', JSON.stringify(data.garments));
      navigate('/try-on');
    } catch { setError('This saved outfit is no longer available.'); }
    finally { setBusy(''); }
  };

  const download = () => {
    const link = document.createElement('a'); link.href = imageSrc(selected.result_image_base64); link.download = `Hiraya_TryOn_${selected.session_id}.png`; link.click();
  };

  const share = async () => {
    const blob = await (await fetch(imageSrc(selected.result_image_base64))).blob();
    const file = new File([blob], 'Hiraya_TryOn.png', { type: blob.type || 'image/png' });
    if (navigator.share) await navigator.share({ files: [file], title: selected.title });
    else { await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]); setSelected((s) => ({ ...s, copied: true })); }
  };

  const remove = async () => {
    if (!window.confirm('Delete this try-on and its saved images? This cannot be undone.')) return;
    setBusy('delete');
    try {
      await api.delete(`/tryon/history/${selected.session_id}`);
      setItems((current) => current.filter((row) => row.session_id !== selected.session_id));
      setSelected(null);
    } catch { setError("We couldn't delete this try-on. Please try again."); }
    finally { setBusy(''); }
  };

  const rendered = useMemo(() => items
    .filter((item) => item && (item.session_id ?? item.id) && imageSrc(item.result_image_base64))
    .map((item) => ({ ...item, resultSrc: imageSrc(item.result_image_base64) })), [items]);

  return (
    <div className="min-h-screen bg-black px-4 pb-20 pt-28 text-hiraya-ink sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div><p className="mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-hiraya-ink">Virtual Wardrobe</p><h1 className="font-serif text-3xl sm:text-4xl">Try-On History</h1><p className="mt-2 text-sm text-hiraya-sand">Revisit, save, and try your looks again.</p></div>
          <div className="flex rounded-full border border-hiraya-olive/15 bg-white/[0.04] p-1">
            {['all', 'favorites'].map((key) => <button key={key} onClick={() => changeTab(key)} className={`rounded-full px-5 py-2 text-xs font-bold capitalize transition ${tab === key ? 'bg-[#CB997E] text-hiraya-olive' : 'text-hiraya-ink hover:bg-hiraya-cream/60'}`}>{key === 'all' ? 'All Try-Ons' : 'Favorites'}</button>)}
          </div>
        </div>

        {error && <div className="mb-5 flex items-center justify-between rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200"><span>{error}</span><button onClick={() => setError('')}><X size={18} /></button></div>}
        {loading ? (
          <div className="flex min-h-72 items-center justify-center gap-3 text-hiraya-sand"><LoaderCircle className="animate-spin text-hiraya-ink" /> Loading your looks…</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
            {rendered.length === 0 ? <EmptyState favoritesOnly={tab === 'favorites'} onReset={() => changeTab('all')} /> : rendered.map((item) => (
              <button key={item.session_id} onClick={() => { setSelected(item); setPreview('after'); }} className="group overflow-hidden rounded-2xl border border-hiraya-olive/15 bg-hiraya-olive text-left transition hover:-translate-y-1 hover:border-[#CB997E]/40">
                <div className="relative aspect-[4/5] overflow-hidden bg-hiraya-sand"><img src={item.resultSrc} alt={item.title} className="h-full w-full object-contain transition group-hover:scale-[1.03]" /><span onClick={(e) => toggleFavorite(e, item)} className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-hiraya-olive/60 text-hiraya-ink backdrop-blur" role="button" aria-label="Toggle favorite">{item.is_favorite ? <Heart size={19} fill="#CB997E" className="text-hiraya-ink" /> : <Heart size={19} />}</span></div>
                <div className="p-4"><h2 className="truncate text-sm font-bold text-hiraya-ink">{item.title}</h2><p className="mt-1 text-[11px] text-hiraya-sand">{formatDate(item.created_at)}</p></div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && <div className="fixed inset-0 z-50 overflow-y-auto bg-hiraya-cream-deep/85 px-4 py-6 backdrop-blur-md" role="dialog" aria-modal="true">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-center justify-between"><button onClick={() => setSelected(null)} className="flex items-center gap-2 text-sm text-hiraya-ink"><ArrowLeft size={18} /> Back</button><button onClick={() => setSelected(null)} className="rounded-full border border-hiraya-olive/15 p-2"><X size={20} /></button></div>
          <div className="grid gap-6 lg:grid-cols-[1.3fr_.7fr]">
            <div className="rounded-3xl border border-hiraya-olive/15 bg-hiraya-olive p-3"><img src={imageSrc(preview === 'before' ? selected.original_image_base64 : selected.result_image_base64)} alt={preview === 'before' ? 'Original photo' : 'Generated result'} className="mx-auto max-h-[72vh] w-full rounded-2xl object-contain" /><div className="mx-auto mt-4 flex w-fit rounded-full bg-white/[0.06] p-1">{['before', 'after'].map((key) => <button key={key} onClick={() => setPreview(key)} className={`rounded-full px-5 py-2 text-xs font-bold capitalize ${preview === key ? 'bg-hiraya-cream text-hiraya-olive' : 'text-hiraya-sand'}`}>{key}</button>)}</div></div>
            <aside className="rounded-3xl border border-hiraya-olive/15 bg-white/[0.03] p-6"><p className="text-[10px] font-black uppercase tracking-[0.25em] text-hiraya-ink">Completed</p><h2 className="mt-3 font-serif text-2xl">{selected.title}</h2><p className="mt-2 text-sm text-hiraya-sand">{formatDate(selected.created_at)}</p><button onClick={(e) => toggleFavorite(e, selected)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full border border-hiraya-olive/20 py-3 text-sm font-bold">{selected.is_favorite ? <Heart size={18} fill="#CB997E" className="text-hiraya-ink" /> : <Heart size={18} />} {selected.is_favorite ? 'Saved to Favorites' : 'Save to Favorites'}</button><button onClick={reuseOutfit} disabled={busy === 'reuse'} className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[#CB997E] py-3 text-sm font-black text-hiraya-olive disabled:opacity-60">{busy === 'reuse' ? <LoaderCircle size={18} className="animate-spin" /> : <RotateCcw size={18} />} Use This Outfit</button><div className="mt-3 grid grid-cols-2 gap-3"><button onClick={download} className="flex items-center justify-center gap-2 rounded-full border border-hiraya-olive/20 py-3 text-xs font-bold"><Download size={16} /> Download</button><button onClick={share} className="flex items-center justify-center gap-2 rounded-full border border-hiraya-olive/20 py-3 text-xs font-bold"><Share2 size={16} /> {selected.copied ? 'Copied' : 'Share'}</button></div><button onClick={remove} disabled={busy === 'delete'} className="mt-7 flex w-full items-center justify-center gap-2 py-2 text-xs font-bold text-red-400 disabled:opacity-50"><Trash2 size={15} /> Delete Try-On</button></aside>
          </div>
        </div>
      </div>}
    </div>
  );
}
