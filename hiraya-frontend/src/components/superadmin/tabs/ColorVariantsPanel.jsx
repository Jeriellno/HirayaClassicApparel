import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Palette, Trash2, Loader2, ImagePlus, Check, RotateCcw, AlertTriangle } from 'lucide-react';
import { generateGarmentCatalogImage } from '../../../utils/removeBackground';
import { releaseCompositeUrl } from '../../../utils/garmentCompositor';
import { getProductImageUrl } from '../../../utils/imageHelper';
import { detectGarmentColor, rankColorNames, QUICK_COLORS } from '../../../utils/detectGarmentColor';

/*
 * PRODUCT COLOURS — "this same garment also comes in Navy and Maroon".
 *
 * ONE PHOTO PER COLOUR, AND THE REST IS AUTOMATIC.
 * ------------------------------------------------
 * Adding a colour used to be a three-step card per colour (upload, press
 * "Remove background", pick the colour, type every size), repeated for each
 * colour. Now the admin drops ALL the colour photos at once, and for each one:
 *
 *   1. a colour row appears immediately with the photo,
 *   2. its background is removed automatically (one photo at a time, so the
 *      browser is never asked to run several cut-outs at once),
 *   3. its colour is DETECTED from the cut-out and named ("Navy", #1F2A44),
 *   4. its quantities start as a copy of the main stock per size.
 *
 * The admin only corrects what is wrong: tap the swatch to change the colour,
 * edit a number, or remove the row. Rows are compact so ten colours still fit.
 *
 * The backend (ProductController::handleColorVariants) refuses a colour with
 * no background-removed photo; `validateVariants` says so before the save.
 */

const MAX_VARIANTS = 12;

const newId = () => `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** A variant row as loaded from the API, in the panel's editable shape. */
export const variantFromApi = (v) => ({
  id: v.id || newId(),
  color: v.color || '',
  hex: v.hex || '#1A1A1A',
  name: v.name || '',
  description: v.description || '',
  size_stocks: v.size_stocks && typeof v.size_stocks === 'object' ? { ...v.size_stocks } : {},
  storedDisplayUrl: v.display_image_url ? getProductImageUrl(v.display_image_url) : '',
  storedOriginalUrl: v.image_url ? getProductImageUrl(v.image_url) : '',
  file: null,
  originalUrl: '',
  displayBlob: null,
  displayUrl: '',
  tryonBlob: null,
  processing: false,
  queued: false,
  colorTouched: Boolean(v.color),
  error: '',
});

/** Problems that must be fixed before saving, or '' when the colours are fine. */
export const validateVariants = (variants, primaryColor = '') => {
  const seen = new Set([String(primaryColor || '').trim().toLowerCase()].filter(Boolean));
  for (const [i, v] of variants.entries()) {
    const label = v.color.trim() || `colour ${i + 1}`;
    if (v.processing || v.queued) return `Wait for the ${label} photo to finish processing.`;
    if (!v.displayBlob && !v.storedDisplayUrl) {
      return v.file
        ? `The background of the ${label} photo could not be removed — press Retry or remove that colour.`
        : `Upload a photo for ${label}.`;
    }
    if (!v.color.trim()) return `Choose the colour for product colour ${i + 1}.`;
    if (seen.has(v.color.trim().toLowerCase())) return `The colour "${v.color.trim()}" is listed more than once.`;
    seen.add(v.color.trim().toLowerCase());
    const total = Object.values(v.size_stocks).reduce((a, n) => a + (Number(n) || 0), 0);
    if (total <= 0) return `Enter the quantity available for ${label}.`;
  }
  return '';
};

/** Appends the colours (JSON + files) to the product's multipart payload. */
export const appendVariantsToPayload = (payload, variants) => {
  payload.append(
    'color_variants',
    JSON.stringify(
      variants.map((v) => ({
        id: v.id,
        color: v.color.trim(),
        hex: v.hex,
        name: v.name.trim() || null,
        description: v.description.trim() || null,
        size_stocks: v.size_stocks,
      }))
    )
  );
  variants.forEach((v) => {
    if (v.file) payload.append(`variant_image_files[${v.id}]`, v.file);
    if (v.displayBlob) payload.append(`variant_display_files[${v.id}]`, v.displayBlob, `${v.id}-card.png`);
    if (v.tryonBlob) payload.append(`variant_tryon_files[${v.id}]`, v.tryonBlob, `${v.id}-matte.png`);
  });
};

const isPhoto = (file) => /^image\/(png|jpe?g|webp)$/i.test(file.type) && file.size <= 10 * 1024 * 1024;

export default function ColorVariantsPanel({ variants, onChange, offeredSizes, mainSizeStocks = {}, primaryColor = '', themeKey, disabled }) {
  const [zoom, setZoom] = useState(null);
  const [pickerFor, setPickerFor] = useState(null);
  const [dropError, setDropError] = useState('');

  // The latest rows, so the background queue can skip a row removed mid-wait.
  const latestRef = useRef(variants);
  useEffect(() => {
    latestRef.current = variants;
  }, [variants]);
  // One cut-out at a time: each job is chained onto the previous one.
  const queueRef = useRef(Promise.resolve());

  const patch = (id, changes) =>
    onChange((list) => list.map((v) => (v.id === id ? { ...v, ...(typeof changes === 'function' ? changes(v) : changes) } : v)));

  /** Removes the background, then names the colour from the cut-out. */
  const processRow = async (id, file) => {
    if (!latestRef.current.some((v) => v.id === id)) return;
    patch(id, { queued: false, processing: true, error: '' });
    try {
      const { display, matte, ok } = await generateGarmentCatalogImage(file, { occasion: themeKey, strictOccasion: true });
      if (!ok || !display.blob) throw new Error('no cut-out');
      const detected = await detectGarmentColor(matte.blob || display.blob);
      patch(id, (v) => {
        const base = { processing: false, displayBlob: display.blob, displayUrl: display.url, tryonBlob: matte.blob || null };
        if (v.colorTouched || !detected) return base;
        // Prefer the nearest colour name not already used by another row.
        const taken = new Set(
          [primaryColor, ...latestRef.current.filter((o) => o.id !== id).map((o) => o.color)]
            .map((c) => String(c || '').trim().toLowerCase())
            .filter(Boolean)
        );
        const name = rankColorNames(detected.hex).map(([n]) => n).find((n) => !taken.has(n.toLowerCase())) || detected.name;
        return { ...base, color: name, hex: detected.hex };
      });
    } catch {
      patch(id, { processing: false, error: 'Background could not be removed. Retry, or use a clearer photo.' });
    }
  };

  const enqueue = (id, file) => {
    queueRef.current = queueRef.current.then(() => processRow(id, file)).catch(() => {});
  };

  const addPhotos = (fileList) => {
    setDropError('');
    const files = Array.from(fileList || []);
    const good = files.filter(isPhoto);
    if (good.length < files.length) setDropError('Some files were skipped: use PNG, JPG or WEBP under 10 MB.');
    const room = MAX_VARIANTS - variants.length;
    if (good.length > room) setDropError(`Only ${MAX_VARIANTS} colours fit on one product; the extra photos were skipped.`);

    // Quantities start as a copy of the main stock, per offered size.
    const startingStock = Object.fromEntries(
      offeredSizes.map((size) => [size, Math.max(0, Number(mainSizeStocks[size]) || 0)])
    );

    const rows = good.slice(0, Math.max(0, room)).map((file) => ({
      ...variantFromApi({}),
      id: newId(),
      colorTouched: false,
      file,
      originalUrl: URL.createObjectURL(file),
      size_stocks: { ...startingStock },
      queued: true,
    }));
    if (rows.length === 0) return;
    onChange((list) => [...list, ...rows]);
    rows.forEach((row) => enqueue(row.id, row.file));
  };

  const retry = (v) => {
    if (!v.file) return;
    patch(v.id, { queued: true, error: '' });
    enqueue(v.id, v.file);
  };

  const removeVariant = (id) =>
    onChange((list) => {
      const gone = list.find((v) => v.id === id);
      if (gone) {
        releaseCompositeUrl(gone.displayUrl);
        if (gone.originalUrl) URL.revokeObjectURL(gone.originalUrl);
      }
      return list.filter((v) => v.id !== id);
    });

  const busyCount = variants.filter((v) => v.processing || v.queued).length;

  return (
    <section className="p-4 bg-cream-200/50 border border-hiraya-structure-line/80 rounded-2xl space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[10px] font-bold text-cream-100">4</span>
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-hiraya-ink">
              <Palette size={12} /> Other colours <span className="font-normal normal-case tracking-normal text-hiraya-ink-muted">(optional)</span>
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-hiraya-ink-muted">
              Drop one photo per colour — you can select several at once. Backgrounds, colour names and quantities are filled in for you.
            </p>
          </div>
        </div>
        {variants.length > 0 && (
          <span className="shrink-0 text-[10px] text-hiraya-ink-muted">
            {busyCount > 0 ? <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> {busyCount} processing</span> : `${variants.length} added`}
          </span>
        )}
      </div>

      {variants.length > 0 && (
        <ul className="space-y-2">
          {variants.map((v, index) => {
            const shownCard = v.displayUrl || (!v.file ? v.storedDisplayUrl : '');
            const shownOriginal = v.originalUrl || v.storedOriginalUrl;
            const thumb = shownCard || shownOriginal;
            const total = Object.values(v.size_stocks).reduce((a, n) => a + (Number(n) || 0), 0);
            const busy = v.processing || v.queued;
            return (
              <li key={v.id} className="rounded-xl border border-hiraya-structure-line bg-hiraya-surface p-2.5 animate-fadeIn">
                <div className="flex items-start gap-3">
                  {/* Photo — the cut-out once ready. */}
                  <button
                    type="button"
                    onClick={() => thumb && setZoom(thumb)}
                    className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg border border-hiraya-structure-line/80 bg-cream-200/60"
                    title="Click to enlarge"
                  >
                    {thumb && <img src={thumb} alt={v.color || `Colour ${index + 1}`} className={`h-full w-full object-contain ${busy ? 'opacity-50' : ''}`} />}
                    {busy && (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-navy-900">
                        <Loader2 size={14} className="animate-spin" /> {v.queued ? 'Queued' : 'Removing bg'}
                      </span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Colour: swatch + name; tap to change. */}
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setPickerFor(pickerFor === v.id ? null : v.id)}
                        disabled={disabled}
                        className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-cream-200/70 cursor-pointer"
                        aria-expanded={pickerFor === v.id}
                      >
                        <span className="h-5 w-5 shrink-0 rounded-full border border-hiraya-ink/20" style={{ backgroundColor: v.color ? v.hex : 'transparent' }} />
                        <span className="truncate text-[12px] font-semibold text-hiraya-ink">
                          {v.color || (busy ? 'Detecting colour…' : 'Choose colour')}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider text-hiraya-ink-muted">Change</span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {v.error && v.file && (
                          <button
                            type="button"
                            onClick={() => retry(v)}
                            disabled={disabled}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-navy-900 hover:bg-cream-200 cursor-pointer"
                          >
                            <RotateCcw size={11} /> Retry
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeVariant(v.id)}
                          disabled={disabled || v.processing}
                          aria-label={`Remove ${v.color || `colour ${index + 1}`}`}
                          className="p-1.5 rounded-lg text-red-700 hover:bg-red-500/10 transition cursor-pointer disabled:opacity-40"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {pickerFor === v.id && (
                      <div className="space-y-2 rounded-lg bg-cream-200/50 p-2">
                        <div className="flex flex-wrap gap-1.5">
                          {QUICK_COLORS.map(([name, hex]) => {
                            const active = v.color.toLowerCase() === name.toLowerCase();
                            return (
                              <button
                                key={name}
                                type="button"
                                title={name}
                                aria-label={name}
                                aria-pressed={active}
                                onClick={() => {
                                  patch(v.id, { color: name, hex, colorTouched: true });
                                  setPickerFor(null);
                                }}
                                className={`relative h-6 w-6 rounded-full border transition cursor-pointer ${active ? 'ring-2 ring-hiraya-accent ring-offset-1' : 'border-hiraya-ink/20 hover:scale-110'}`}
                                style={{ backgroundColor: hex }}
                              >
                                {active && <Check size={11} className={`absolute inset-0 m-auto ${['White', 'Cream', 'Beige', 'Pink', 'Yellow'].includes(name) ? 'text-navy-900' : 'text-white'}`} />}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={50}
                            value={v.color}
                            onChange={(e) => patch(v.id, { color: e.target.value, colorTouched: true })}
                            placeholder="Or type a colour, e.g. Sage Green"
                            className="min-w-0 flex-1 rounded-lg border border-hiraya-structure-line bg-hiraya-surface px-2 py-1.5 text-[11px] text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
                          />
                          <input
                            type="color"
                            aria-label="Colour swatch"
                            value={v.hex}
                            onChange={(e) => patch(v.id, { hex: e.target.value, colorTouched: true })}
                            className="h-8 w-10 cursor-pointer rounded-lg border border-hiraya-ink/15 bg-transparent"
                          />
                        </div>
                      </div>
                    )}

                    {/* Quantities — prefilled from the main stock. */}
                    {offeredSizes.length > 0 ? (
                      <div className="flex flex-wrap items-end gap-1.5">
                        {offeredSizes.map((size) => (
                          <label key={size} className="w-12 text-center">
                            <span className="block text-[8px] font-bold uppercase text-hiraya-ink-muted">{size}</span>
                            <input
                              type="number"
                              min={0}
                              max={100000}
                              value={v.size_stocks[size] ?? 0}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) =>
                                patch(v.id, { size_stocks: { ...v.size_stocks, [size]: Math.max(0, parseInt(e.target.value, 10) || 0) } })
                              }
                              disabled={disabled}
                              className="w-full rounded-md border border-hiraya-structure-line bg-cream-200/50 py-1 text-center text-[11px] tabular-nums text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
                            />
                          </label>
                        ))}
                        <span className="pb-1 text-[10px] text-hiraya-ink-muted">= <strong className="text-hiraya-ink tabular-nums">{total}</strong> pcs</span>
                      </div>
                    ) : (
                      <p className="text-[10px] text-hiraya-ink-muted">Choose the sizes in step 3 to set quantities.</p>
                    )}

                    {v.error && (
                      <p className="flex items-center gap-1 text-[10px] text-red-700"><AlertTriangle size={11} /> {v.error}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* The drop zone: one photo per colour, many at once. */}
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled) addPhotos(e.dataTransfer.files);
        }}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-3.5 text-center transition ${
          disabled || variants.length >= MAX_VARIANTS
            ? 'cursor-not-allowed border-hiraya-structure-line opacity-50'
            : 'cursor-pointer border-hiraya-accent/40 hover:border-hiraya-accent hover:bg-hiraya-surface'
        }`}
      >
        <ImagePlus size={16} className="text-hiraya-accent" />
        <span className="text-[11px] font-semibold text-hiraya-ink">
          {variants.length ? 'Add more colour photos' : 'Add colour photos'}
          <span className="ml-1 font-normal text-hiraya-ink-muted">— drop or click, several at once</span>
        </span>
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={disabled || variants.length >= MAX_VARIANTS}
          onChange={(e) => {
            addPhotos(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {dropError && <p className="text-[10px] text-amber-800">{dropError}</p>}

      {zoom && (
        <div
          role="dialog"
          aria-label="Colour photo preview"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm animate-fadeIn cursor-zoom-out"
        >
          <img src={zoom} alt="" className="max-h-[85vh] max-w-full rounded-xl bg-cream-100 object-contain shadow-2xl" />
        </div>
      )}
    </section>
  );
}

ColorVariantsPanel.propTypes = {
  variants: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
  offeredSizes: PropTypes.arrayOf(PropTypes.string).isRequired,
  mainSizeStocks: PropTypes.object,
  primaryColor: PropTypes.string,
  themeKey: PropTypes.string,
  disabled: PropTypes.bool,
};
