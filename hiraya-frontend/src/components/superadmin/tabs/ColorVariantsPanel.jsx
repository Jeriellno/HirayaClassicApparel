import { useState } from 'react';
import PropTypes from 'prop-types';
import { Palette, Plus, Trash2, Loader2, Sparkles, ImagePlus, Check } from 'lucide-react';
import { generateGarmentCatalogImage } from '../../../utils/removeBackground';
import { releaseCompositeUrl } from '../../../utils/garmentCompositor';
import { getProductImageUrl } from '../../../utils/imageHelper';

/*
 * PRODUCT COLOURS — "this same garment also comes in Navy and Maroon".
 *
 * One card per extra colour, filled in the order the admin works:
 *   1. upload THAT colour's photo (background removed on the same backdrop as
 *      the main photo),
 *   2. choose the colour (a quick pick or a custom name + swatch),
 *   3. set its own quantity per offered size — separate from the main stock.
 *
 * The backend (ProductController::handleColorVariants) refuses a colour with no
 * background-removed photo, so the panel asks for one before the save.
 */

const FIELD =
  'w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2 text-hiraya-ink focus:outline-none focus:border-hiraya-accent';

/** The colours the shop most often stocks, as one-tap picks. */
const QUICK_COLORS = [
  ['Black', '#1A1A1A'],
  ['White', '#F7F7F5'],
  ['Cream', '#F5F0EB'],
  ['Beige', '#E8DCC8'],
  ['Brown', '#6B4F3A'],
  ['Navy', '#1F2A44'],
  ['Blue', '#3B5B8C'],
  ['Gray', '#8A8A8A'],
  ['Green', '#4B6E4F'],
  ['Maroon', '#6E2A2A'],
  ['Red', '#A63A3A'],
  ['Pink', '#E5A8B8'],
];

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
  error: '',
});

/** Problems that must be fixed before saving, or '' when the colours are fine. */
export const validateVariants = (variants, primaryColor = '') => {
  const seen = new Set([String(primaryColor || '').trim().toLowerCase()].filter(Boolean));
  for (const [i, v] of variants.entries()) {
    const label = v.color.trim() || `colour ${i + 1}`;
    if (!v.displayBlob && !v.storedDisplayUrl) {
      return v.file
        ? `Press "Remove background" on the ${label} photo before saving.`
        : `Upload a photo for ${label}.`;
    }
    if (v.processing) return `Wait for the ${label} photo to finish processing.`;
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

const Step = ({ n, children }) => (
  <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-hiraya-ink">
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-navy-900 text-[8px] text-cream-100">{n}</span>
    {children}
  </p>
);

Step.propTypes = { n: PropTypes.number.isRequired, children: PropTypes.node };

export default function ColorVariantsPanel({ variants, onChange, offeredSizes, themeKey, disabled }) {
  const [zoom, setZoom] = useState(null);

  const patch = (id, changes) =>
    onChange((list) => list.map((v) => (v.id === id ? { ...v, ...changes } : v)));

  const addVariant = () => onChange((list) => [...list, { ...variantFromApi({}), id: newId() }]);

  const removeVariant = (id) =>
    onChange((list) => {
      const gone = list.find((v) => v.id === id);
      if (gone) {
        releaseCompositeUrl(gone.displayUrl);
        if (gone.originalUrl) URL.revokeObjectURL(gone.originalUrl);
      }
      return list.filter((v) => v.id !== id);
    });

  const pickFile = (variant, file) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type) || file.size > 10 * 1024 * 1024) {
      patch(variant.id, { error: 'Please choose a PNG, JPG or WEBP image under 10 MB.' });
      return;
    }
    releaseCompositeUrl(variant.displayUrl);
    if (variant.originalUrl) URL.revokeObjectURL(variant.originalUrl);
    // Like the main photo: shown first, processed only when the admin asks.
    patch(variant.id, { file, originalUrl: URL.createObjectURL(file), displayBlob: null, displayUrl: '', tryonBlob: null, error: '' });
  };

  const removeBackground = async (variant) => {
    if (!variant.file) return;
    patch(variant.id, { processing: true, error: '' });
    try {
      // Same backdrop as the main photo, so the colours read as one product.
      const { display, matte, ok } = await generateGarmentCatalogImage(variant.file, {
        occasion: themeKey,
        strictOccasion: true,
      });
      if (!ok || !display.blob) throw new Error('no cut-out');
      patch(variant.id, { processing: false, displayBlob: display.blob, displayUrl: display.url, tryonBlob: matte.blob || null });
    } catch {
      patch(variant.id, { processing: false, error: 'The background could not be removed from this photo. Try again or use a clearer photo.' });
    }
  };

  return (
    <div className="p-3 bg-cream-200/60 border border-hiraya-structure-line/80 rounded-xl space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-hiraya-structure-line/80 pb-1.5">
        <span className="text-[10px] uppercase text-hiraya-ink font-bold flex items-center gap-1.5">
          <Palette size={12} /> 3. Product Colours
        </span>
        <span className="text-[9px] text-hiraya-ink-muted">{variants.length} added</span>
      </div>

      {variants.length === 0 && (
        <p className="text-[9px] text-hiraya-ink-muted leading-snug">
          Does this piece come in other colours? Add each one with its own photo, colour and quantity.
        </p>
      )}

      {variants.map((v, index) => {
        const shownCard = v.displayUrl || (!v.file ? v.storedDisplayUrl : '');
        const shownOriginal = v.originalUrl || v.storedOriginalUrl;
        const total = Object.values(v.size_stocks).reduce((a, n) => a + (Number(n) || 0), 0);
        return (
          <div key={v.id} className="rounded-xl border border-hiraya-structure-line bg-hiraya-surface p-3 space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-hiraya-ink">
                <span className="h-3.5 w-3.5 rounded-full border border-hiraya-ink/20" style={{ backgroundColor: v.color ? v.hex : 'transparent' }} />
                {v.color || `Product colour ${index + 1}`}
              </span>
              <button
                type="button"
                onClick={() => removeVariant(v.id)}
                disabled={disabled || v.processing}
                aria-label={`Remove ${v.color || `product colour ${index + 1}`}`}
                className="p-1 rounded-lg text-red-700 hover:bg-red-500/10 transition cursor-pointer disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </div>

            {/* 1 — the photo of THIS colour. */}
            <div className="space-y-1.5">
              <Step n={1}>Upload the photo of this colour</Step>
              <div className="grid grid-cols-2 gap-2 max-w-[280px]">
                <button
                  type="button"
                  onClick={() => shownOriginal && setZoom(shownOriginal)}
                  className="aspect-[4/5] rounded-lg overflow-hidden border border-hiraya-structure-line/80 bg-cream-200/60 flex items-center justify-center text-[9px] uppercase tracking-wider text-hiraya-ink-muted"
                >
                  {shownOriginal ? <img src={shownOriginal} alt="Original" className="w-full h-full object-contain" /> : 'Original'}
                </button>
                <button
                  type="button"
                  onClick={() => shownCard && setZoom(shownCard)}
                  className="aspect-[4/5] rounded-lg overflow-hidden border border-hiraya-accent/40 bg-cream-200/60 flex flex-col items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-hiraya-ink-muted"
                >
                  {v.processing ? (
                    <><Loader2 size={14} className="animate-spin" /> Processing…</>
                  ) : shownCard ? (
                    <img src={shownCard} alt="Background removed" className="w-full h-full object-contain" />
                  ) : (
                    'Background removed'
                  )}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="px-2.5 py-1.5 bg-charcoal-100 hover:bg-charcoal-200/70 border border-charcoal-300 text-charcoal-800 font-bold uppercase tracking-wider rounded-lg text-[9px] flex items-center gap-1 cursor-pointer">
                  <ImagePlus size={11} /> {shownOriginal ? 'Change photo' : 'Upload photo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={disabled || v.processing}
                    onChange={(e) => {
                      pickFile(v, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeBackground(v)}
                  disabled={disabled || v.processing || !v.file || Boolean(v.displayBlob)}
                  className="px-2.5 py-1.5 bg-hiraya-accent hover:bg-hiraya-gold-deep text-hiraya-on-accent font-bold uppercase tracking-wider rounded-lg text-[9px] flex items-center gap-1 transition cursor-pointer disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:cursor-not-allowed"
                >
                  <Sparkles size={11} /> {v.displayBlob ? 'Background removed' : 'Remove background'}
                </button>
              </div>
            </div>

            {/* 2 — which colour it is. */}
            <div className="space-y-1.5">
              <Step n={2}>Choose the colour</Step>
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
                      disabled={disabled}
                      onClick={() => patch(v.id, { color: name, hex })}
                      className={`relative h-7 w-7 rounded-full border transition cursor-pointer ${active ? 'ring-2 ring-hiraya-accent ring-offset-2 ring-offset-hiraya-surface' : 'border-hiraya-ink/20 hover:scale-110'}`}
                      style={{ backgroundColor: hex }}
                    >
                      {active && <Check size={12} className={`absolute inset-0 m-auto ${['White', 'Cream', 'Beige', 'Pink'].includes(name) ? 'text-navy-900' : 'text-white'}`} />}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 items-center max-w-sm">
                <input
                  type="text"
                  maxLength={50}
                  value={v.color}
                  onChange={(e) => patch(v.id, { color: e.target.value })}
                  placeholder="Or type a colour, e.g. Sage Green"
                  disabled={disabled}
                  className={FIELD}
                />
                <input
                  type="color"
                  aria-label="Colour swatch"
                  value={v.hex}
                  onChange={(e) => patch(v.id, { hex: e.target.value })}
                  disabled={disabled}
                  className="h-9 w-11 cursor-pointer rounded-lg border border-hiraya-ink/15 bg-transparent"
                />
              </div>
            </div>

            {/* 3 — its own quantity, separate from the main stock. */}
            <div className="space-y-1.5">
              <Step n={3}>Quantity for this colour — {total} pcs</Step>
              {offeredSizes.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {offeredSizes.map((size) => (
                    <label key={size} className="text-center">
                      <span className="block text-[9px] font-bold text-hiraya-ink">{size}</span>
                      <input
                        type="number"
                        min={0}
                        max={100000}
                        value={v.size_stocks[size] ?? 0}
                        onChange={(e) =>
                          patch(v.id, { size_stocks: { ...v.size_stocks, [size]: Math.max(0, parseInt(e.target.value, 10) || 0) } })
                        }
                        disabled={disabled}
                        className={`${FIELD} p-1 text-center`}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-[9px] text-hiraya-ink-muted">Turn on the sizes this garment comes in (section 2) first.</p>
              )}
            </div>

            {v.error && <p className="text-[10px] text-red-700">{v.error}</p>}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addVariant}
        disabled={disabled || variants.length >= 12}
        className="w-full py-2.5 border border-dashed border-hiraya-accent/50 text-hiraya-ink hover:bg-hiraya-accent hover:text-hiraya-on-accent font-bold uppercase rounded-xl text-[10px] tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus size={13} /> Add Product Colour
      </button>

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
    </div>
  );
}

ColorVariantsPanel.propTypes = {
  variants: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
  offeredSizes: PropTypes.arrayOf(PropTypes.string).isRequired,
  themeKey: PropTypes.string,
  disabled: PropTypes.bool,
};
