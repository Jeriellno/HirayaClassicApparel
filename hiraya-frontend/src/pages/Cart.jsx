import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Trash2, Minus, Plus, ShoppingBag, Truck, AlertTriangle, Sparkles } from 'lucide-react';
import { useCart } from '../hooks/useCart';
import { getProductImageUrl } from '../utils/imageHelper';
import { themeSurfaceFor } from '../utils/framePresets';
import Currency from '../components/common/Currency';
import { productForColor } from '../utils/productVariant';
import { useT } from '../context/PreferencesContext';

/*
 * NOTE: the My Bag STYLE STACK (coverflow carousel) was removed from this page.
 *
 * That carousel ran the in-browser AI background-removal model
 * (`@imgly/background-removal`) on EVERY bag tile, so opening My Bag kicked off a
 * ~95 MB model download on first use and then seconds-to-tens-of-seconds of CPU
 * inference per garment — the bag looked frozen before any item appeared. The
 * bag is a checkout surface: it now renders plain product photos and nothing
 * else. The AI Studio keeps the cut-out styling where it actually belongs.
 */

// Price fallback — keeps subtotal math finite even if a legacy row stores
//"1,299.00" or an empty string instead of a raw number.
const toPrice = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? '').replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const Cart = () => {
  const t = useT();
  const navigate = useNavigate();
  const {
    cartItems,
    isLoading,
    isError,
    updateQuantity,
    removeItem,
    clearCart,
    isClearing,
  } = useCart();

  const [busyId, setBusyId] = useState(null);
  const [error] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [allInitialized, setAllInitialized] = useState(false);

  // Defensive: `cartItems` should always be an array, but a failed/partial
  // payload must never be able to crash the page on `.length`/`.map`.
  const items = Array.isArray(cartItems) ? cartItems : [];

  /*
   * LINE COUNT vs UNIT COUNT.
   *
   * The backend's `count` is the SUM of every line's quantity, so a bag holding
   * one garment at quantity 11 read as "11 items selected" while the list below
   * showed a single row — it looked like items had disappeared. The header now
   * reports the number of distinct lines, and the unit total is shown separately
   * so both numbers are honest.
   */
  const safeCount = items.length;
  const lineCount = items.reduce((acc, it) => acc + Number(it?.quantity || 1), 0);
  // Total units in the bag (sum of quantities), shown beside the line count so
  // "1 item · 11 units" is unambiguous instead of showing 11 as the item count.
  const unitCount = lineCount;

  // Select all by default, but keep the selection in sync when rows are removed.
  if (!allInitialized && items.length > 0) {
    setSelectedIds(new Set(items.map((item) => item.id)));
    setAllInitialized(true);
  }
  if (allInitialized && items.length === 0) setAllInitialized(false);

  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const selectedTotal = selectedItems.reduce((sum, item) => sum + toPrice(item.product?.price) * Number(item.quantity || 1), 0);
  const selectedUnitCount = selectedItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  const allSelected = items.length > 0 && selectedItems.length === items.length;

  const toggleSelected = (id) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.id)));

  const handleQuantityChange = (item, nextQty) => {
    // 1 is the floor — removing is an explicit action, not a side effect of -1.
    if (nextQty < 1) return;
    setBusyId(item.id);
    updateQuantity(item.id, nextQty);
    // The cache invalidation resolves quickly; clear the spinner either way.
    setTimeout(() => setBusyId(null), 400);
  };

  const handleRemove = (item) => {
    setBusyId(item.id);
    removeItem(item.id);
  };

  /**
   * Hand the bag over to the existing 2-step checkout.
   *
   * We forward the LINE ITEMS and let the server re-price everything from the
   * products table — `total_amount` here is display-only context. `price` is
   * included per line purely so the checkout summary can render instantly
   * before the server responds.
   */
  const handleProceed = () => {
    if (selectedItems.length === 0) return;

    navigate('/checkout', {
      state: {
        total_amount: Number(selectedTotal.toFixed(2)),
        source: 'cart',
        cart_item_ids: selectedItems.map((item) => item.id),
        items: selectedItems.map((item) => ({
          product_id: item.product_id,
          name: item.product?.name,
          size: item.selected_size,
          color: item.selected_color,
          quantity: item.quantity,
          price: toPrice(item.product?.price),
        })),
      },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="glass w-full max-w-xs px-8 py-10 text-center">
          <Loader2 className="mx-auto mb-4 h-6 w-6 animate-spin text-hiraya-accent" />
          <p className="text-hiraya-ink-muted uppercase tracking-[0.3em] text-[11px]">{t('cart.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page min-h-screen pt-32 pb-24 text-hiraya-ink">
      <div className="max-w-6xl mx-auto">
        {/* Header — title with the line count stamped beside it, the unit
            total and the studio hand-off underneath, Clear Bag opposite. */}
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-hiraya-structure-line pb-8" data-tour="cart-header">
          <div className="section-head">
            <span className="kicker text-hiraya-ink-muted">{t('cart.kicker')}</span>
            <h2 className="display-section mt-2 flex items-center gap-4 text-navy-900">
              My Bag
              <span className="inline-flex h-11 min-w-11 items-center justify-center rounded-2xl bg-navy-900 px-3 font-serif text-lg text-cream-100 shadow-neu-sm">
                {String(safeCount).padStart(2, '0')}
              </span>
            </h2>
            <p className="text-[10px] text-hiraya-ink font-semibold uppercase tracking-[0.2em]">
              {safeCount} item{safeCount !== 1 ? 's' : ''} selected
              {/* Surface the unit total only when it actually differs, so
                  "1 item · 3 units" is clear but "1 item · 1 unit" is not noise. */}
              {unitCount > safeCount && (
                <span className="text-hiraya-ink-muted font-semibold"> · {unitCount} units</span>
              )}
            </p>
            {/* Everything saved, hearted or added now lives here — this single
                container is the product source for the AI Try-On studio. */}
            <Link
              to="/try-on"
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-hiraya-ink-muted hover:text-hiraya-accent transition mt-1"
            >
              <Sparkles size={12} /> Try these on in the Studio
            </Link>
          </div>

          {items.length > 0 && (
            <button
              onClick={() => clearCart()}
              disabled={isClearing}
              className="btn-quiet hover:text-red-700 hover:border-red-700 disabled:cursor-not-allowed"
            >
              {isClearing ? 'Clearing...' : 'Clear Bag'}
            </button>
          )}
        </div>

        {(isError || error) && (
          <div className="mt-6 text-[11px] text-red-700 bg-red-500/12 border border-red-600/40 rounded-xl px-4 py-3">
            {error || 'Failed to load your bag. Please refresh.'}
          </div>
        )}

        {items.length === 0 ? (
          <div className="text-center py-20 px-6 card-raised mt-10">
            <span className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-cream-100 shadow-neu ring-1 ring-cream-50">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy-900 text-cream-100">
                <ShoppingBag className="w-5 h-5" />
              </span>
            </span>
            <p className="text-xs text-hiraya-ink tracking-[0.2em] uppercase">{t('cart.empty')}</p>
            <p className="text-[11px] text-hiraya-ink-muted max-w-sm mx-auto mt-3 leading-relaxed normal-case tracking-normal">
              Every piece you save, heart, or add to bag lands here — and flows straight
              into the AI Try-On studio.
            </p>
            {/* `flex` was missing here too, so the two CTAs stacked full-width
                and collided instead of sitting side by side on larger screens. */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => navigate('/shop')}
                className="btn-primary w-full rounded-full sm:w-auto"
              >
                <ShoppingBag size={13} /> Browse the Shop
              </button>
              <button
                onClick={() => navigate('/try-on')}
                className="btn-secondary w-full rounded-full sm:w-auto"
              >
                <Sparkles size={13} /> Open AI Try-On
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Item list */}
            <div className="lg:col-span-2 space-y-5" data-tour="cart-list">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-4 rounded-[22px] bg-hiraya-surface p-3 pr-4 shadow-neu transition-[box-shadow,opacity] duration-300 sm:gap-5 ${selectedIds.has(item.id) ? 'ring-1 ring-navy-800/40' : 'opacity-80 ring-1 ring-cream-50/80'}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    className="ml-1 mt-2 h-4 w-4 accent-hiraya-accent shrink-0 cursor-pointer"
                    aria-label={`Select ${item.product?.name || 'item'} for checkout`}
                  />
                  <img
                    src={getProductImageUrl(productForColor(item.product, item.selected_color)?.display_image_url || item.product?.image_url)}
                    alt={item.product?.name || 'Garment'}
                    onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/images/placeholder.svg'; }}
                    className="w-24 h-28 object-contain rounded-2xl bg-black shrink-0 shadow-[0_12px_24px_-14px_rgba(0,0,0,0.8)]"
                    // The well matches the product's background theme (black for legacy cards).
                    style={{ backgroundColor: themeSurfaceFor(item.product) }}
                  />

                  {/* Details column — price sits with the name so the row reads
                      top-to-bottom, and the qty stepper aligns to the bottom. */}
                  <div className="flex flex-1 min-w-0 flex-col justify-between self-stretch">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.06em] truncate">
                        {item.product?.name || 'Garment'}
                      </h3>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-hiraya-ink-muted mt-1">
                        Size {item.selected_size || '—'} · {item.selected_color || '—'}
                      </p>
                      {/*
                       * Routed through <Currency>, which pins a glyph-safe font
                       * stack. Hard-coding the peso sign here both corrupted it
                       * (the ★ sequence on the old line) and bypassed the component
                       * built precisely because neither display face carries U+20B1.
                       */}
                      <Currency amount={toPrice(item.product?.price)} className="text-hiraya-ink text-sm mt-1.5 block" />
                    </div>

                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex items-center gap-1 rounded-full bg-cream-200/70 p-1 shadow-neu-inset">
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-cream-50 shadow-neu-sm hover:bg-hiraya-accent hover:text-hiraya-on-accent transition disabled:bg-transparent disabled:shadow-none disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          aria-label={`Decrease quantity of ${item.product?.name || 'item'}`}
                        >
                          <Minus size={13} />
                        </button>
                        <span className="px-2 text-xs min-w-[34px] text-center font-semibold">
                          {busyId === item.id ? (
                            <Loader2 size={12} className="animate-spin mx-auto" />
                          ) : (
                            item.quantity
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item, item.quantity + 1)}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-cream-50 shadow-neu-sm hover:bg-hiraya-accent hover:text-hiraya-on-accent transition cursor-pointer"
                          aria-label={`Increase quantity of ${item.product?.name || 'item'}`}
                        >
                          <Plus size={13} />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemove(item)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-hiraya-ink-muted hover:bg-red-500/10 hover:text-red-700 transition cursor-pointer"
                        aria-label={`Remove ${item.product?.name || 'item'} from bag`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Subtotal pinned right and vertically centred. The old
                      `w-full sm:w-auto` made it drop to a new line on mobile AND
                      fight `sm:ml-auto`, so the number floated away from its
                      row. */}
                  <div className="shrink-0 text-right self-center">
                    <p className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">{t('cart.subtotal')}</p>
                    <Currency
                      amount={toPrice(item.product?.price) * Number(item.quantity || 1)}
                      className="text-sm font-semibold text-hiraya-ink"
                    />
                  </div>
                </div>
              ))}
            </div>

              {/* summary */}
              <div className="lg:col-span-1">
                <div className="card-raised rounded-[24px] p-6 sm:p-7 lg:sticky lg:top-28" data-tour="cart-summary">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-hiraya-ink mb-5 pb-3 border-b border-hiraya-structure-line">
                  Order Summary
                </h3>

                {/* BREAKDOWN — lines (distinct garments) vs units (sum of
                    quantities). The old row printed only ONE number labelled
                    "Items", which was actually the unit total, so a bag of one
                    garment at qty 3 read "Items 3" beside a single card. */}
                <div className="space-y-3 text-[11px] pb-5 border-b border-hiraya-structure-line">
                  <div className="flex justify-between">
                    <span className="text-hiraya-ink-muted uppercase tracking-[0.16em] text-[9px]">Pieces selected</span>
                    <span>{selectedItems.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-hiraya-ink-muted uppercase tracking-[0.16em] text-[9px]">Total units</span>
                    <span>{selectedUnitCount}</span>
                  </div>
                  <div className="flex justify-between text-base pt-1">
                    <span className="text-hiraya-ink uppercase tracking-[0.16em] text-[9px] self-center">{t('cart.total')}</span>
                    <Currency amount={selectedTotal} className="text-hiraya-ink font-semibold" />
                  </div>
                </div>

                {/* One full payment per order (the 50% down payment was retired). */}
                <div className="my-5 rounded-2xl bg-navy-900 py-3.5 text-center shadow-[0_10px_20px_-12px_rgba(21,32,54,0.8)]">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-cream-400 mb-1">{t('cart.fullPayment')}</p>
                  <Currency amount={selectedTotal} className="text-sm font-semibold text-cream-50" />
                </div>

                <p className="text-[10px] text-hiraya-ink-muted leading-relaxed mb-5 flex gap-2">
                  <AlertTriangle size={13} className="text-hiraya-accent shrink-0 mt-0.5" />
                  {t('cart.paymentNote')}
                </p>

                <button
                  onClick={toggleAll}
                  className="w-full mb-4 py-2 text-[10px] uppercase tracking-[0.16em] text-hiraya-ink-muted hover:text-hiraya-accent transition cursor-pointer"
                >
                  {allSelected ? 'Unselect all items' : 'Select all items'}
                </button>

                <button
                  onClick={handleProceed}
                  disabled={selectedItems.length === 0}
                  className="btn-primary w-full rounded-full py-3.5"
                >
                  Proceed to Checkout ({selectedItems.length})
                </button>

                {/* Bag -> AI Try-On handoff. The Studio reads these same bag
                    items, so this is a straight navigation, no re-fetch dance. */}
                <button
                  onClick={() => navigate('/try-on')}
                  data-tour="cart-studio"
                  className="btn-secondary w-full mt-3 rounded-full py-3.5"
                >
                  <Sparkles size={13} /> Try These On
                </button>

                <p className="text-[9px] text-hiraya-ink-muted text-center mt-4 flex items-center justify-center gap-1.5">
                  <Truck size={11} /> LBC or Lalamove — chosen at checkout
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Cart;
