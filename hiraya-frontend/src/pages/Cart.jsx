import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Trash2, Minus, Plus, ShoppingBag, Truck, AlertTriangle, Sparkles } from 'lucide-react';
import { useCart } from '../hooks/useCart';
import { getProductImageUrl } from '../utils/imageHelper';

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
  const navigate = useNavigate();
  const {
    cartItems,
    total,
    dpAmount,
    balanceAmount,
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
  const safeTotal = Number.isFinite(Number(total)) ? Number(total) : 0;
  const safeDp = Number.isFinite(Number(dpAmount)) ? Number(dpAmount) : safeTotal / 2;
  const safeBalance = Number.isFinite(Number(balanceAmount)) ? Number(balanceAmount) : safeTotal / 2;
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
  const selectedDp = selectedTotal / 2;
  const selectedBalance = selectedTotal - selectedDp;
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
      <div className="min-h-screen bg-hiraya-bg flex items-center justify-center text-hiraya-ink italic tracking-[0.5em] uppercase animate-pulse">
        Loading Your Bag...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-hiraya-bg px-4 sm:px-6 md:px-20 pt-28 md:pt-32 pb-20 text-hiraya-ink">
      <div className="max-w-5xl mx-auto">
        {/* Header — `flex` was missing, so `justify-between` never applied and
            the Clear Bag button wrapped under the title instead of sitting
            opposite it. */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl md:text-4xl font-light uppercase tracking-[0.2em] md:tracking-[0.3em] text-hiraya-ink">
              My Bag
            </h2>
            <p className="text-[10px] text-hiraya-ink font-black uppercase tracking-widest mt-2">
              {safeCount} item{safeCount !== 1 ? 's' : ''} selected
              {/* Surface the unit total only when it actually differs, so
                  "1 item · 3 units" is clear but "1 item · 1 unit" is not noise. */}
              {unitCount > safeCount && (
                <span className="text-hiraya-sand font-bold"> · {unitCount} units</span>
              )}
            </p>
            {/* Everything saved, hearted or added now lives here — this single
                container is the product source for the AI Try-On studio. */}
            <Link
              to="/try-on"
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-hiraya-sand hover:text-hiraya-ink transition mt-3"
            >
              <Sparkles size={12} /> Try these on in the Studio
            </Link>
          </div>

          {items.length > 0 && (
            <button
              onClick={() => clearCart()}
              disabled={isClearing}
              className="text-[10px] uppercase tracking-widest text-hiraya-sand hover:text-red-400 border-hiraya-olive/15 hover:border-red-500/30 px-4 py-2 rounded-lg transition disabled:opacity-50"
            >
              {isClearing ? 'Clearing...' : 'Clear Bag'}
            </button>
          )}
        </div>

        {(isError || error) && (
          <div className="mb-6 text-[11px] text-red-400 bg-red-500/10 border-red-500/30 rounded-lg px-4 py-3">
            {error || 'Failed to load your bag. Please refresh.'}
          </div>
        )}

        {items.length === 0 ? (
          <div className="text-center py-20 px-6 border-hiraya-olive/15 rounded-2xl bg-white/[0.02]">
            <ShoppingBag className="w-10 h-10 text-hiraya-sand mx-auto mb-4" />
            <p className="text-xs text-hiraya-ink tracking-widest uppercase">Your bag is empty.</p>
            <p className="text-[11px] text-hiraya-sand max-w-sm mx-auto mt-3 leading-relaxed normal-case tracking-normal">
              Every piece you save, heart, or add to bag lands here — and flows straight
              into the AI Try-On studio.
            </p>
            {/* `flex` was missing here too, so the two CTAs stacked full-width
                and collided instead of sitting side by side on larger screens. */}
            <div className="mt-8 flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => navigate('/shop')}
                className="w-full sm:w-auto px-8 py-3 bg-[#CB997E] text-hiraya-ink text-[10px] font-black uppercase tracking-[0.2em] rounded-lg hover:bg-hiraya-cream-deep transition flex items-center justify-center gap-2"
              >
                <ShoppingBag size={13} /> Browse the Shop
              </button>
              <button
                onClick={() => navigate('/try-on')}
                className="w-full sm:w-auto px-8 py-3 border-[#CB997E]/40 text-hiraya-ink text-[10px] font-black uppercase tracking-[0.2em] rounded-lg hover:bg-[#CB997E]/10 transition flex items-center justify-center gap-2"
              >
                <Sparkles size={13} /> Open AI Try-On
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Item list */}
            <div className="lg:col-span-2 space-y-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-4 bg-white/[0.03] border-hiraya-olive/15 rounded-2xl p-4"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    className="mt-1 accent-[#CB997E] shrink-0"
                    aria-label={`Select ${item.product?.name || 'item'} for checkout`}
                  />
                  <img
                    src={getProductImageUrl(item.product?.display_image_url || item.product?.image_url)}
                    alt={item.product?.name || 'Garment'}
                    onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/images/placeholder.svg'; }}
                    className="w-20 h-24 object-cover rounded-lg bg-hiraya-cream/30 shrink-0"
                  />

                  {/* Details column — price sits with the name so the row reads
                      top-to-bottom, and the qty stepper aligns to the bottom. */}
                  <div className="flex flex-1 min-w-0 flex-col justify-between self-stretch">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium uppercase tracking-wide truncate">
                        {item.product?.name || 'Garment'}
                      </h3>
                      <p className="text-[10px] uppercase tracking-widest text-hiraya-olive/70 mt-1">
                        Size {item.selected_size || '—'} · {item.selected_color || '—'}
                      </p>
                      <p className="text-hiraya-ink text-sm mt-1.5">
                        ₱{toPrice(item.product?.price).toFixed(2)}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex items-center border-hiraya-olive/20 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          className="px-3 py-2 hover:bg-hiraya-cream/60 transition disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label={`Decrease quantity of ${item.product?.name || 'item'}`}
                        >
                          <Minus size={13} />
                        </button>
                        <span className="px-3 text-xs min-w-[34px] text-center font-bold">
                          {busyId === item.id ? (
                            <Loader2 size={12} className="animate-spin mx-auto" />
                          ) : (
                            item.quantity
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item, item.quantity + 1)}
                          className="px-3 py-2 hover:bg-hiraya-cream/60 transition"
                          aria-label={`Increase quantity of ${item.product?.name || 'item'}`}
                        >
                          <Plus size={13} />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemove(item)}
                        className="text-hiraya-sand hover:text-red-400 transition p-2"
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
                    <p className="text-[9px] uppercase tracking-widest text-hiraya-sand">Subtotal</p>
                    <p className="text-sm text-hiraya-ink">
                      ₱{(toPrice(item.product?.price) * Number(item.quantity || 1)).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="lg:col-span-1">
              <div className="bg-white/[0.03] border-[#CB997E]/20 rounded-2xl p-6 lg:sticky lg:top-28">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-hiraya-ink mb-5">
                  Order Summary
                </h3>

                {/* BREAKDOWN — lines (distinct garments) vs units (sum of
                    quantities). The old row printed only ONE number labelled
                    "Items", which was actually the unit total, so a bag of one
                    garment at qty 3 read "Items 3" beside a single card. */}
                <div className="space-y-3 text-[11px] pb-5 border-b border-hiraya-olive/15">
                  <div className="flex justify-between">
                    <span className="text-hiraya-sand uppercase tracking-widest text-[9px]">Pieces selected</span>
                    <span>{selectedItems.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-hiraya-sand uppercase tracking-widest text-[9px]">Total units</span>
                    <span>{selectedUnitCount}</span>
                  </div>
                  <div className="flex justify-between text-base pt-1">
                    <span className="text-hiraya-ink uppercase tracking-widest text-[9px] self-center">Total</span>
                    <span className="text-hiraya-ink">₱{selectedTotal.toFixed(2)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 my-5">
                  <div className="bg-[#CB997E]/10 border-[#CB997E]/30 rounded-xl py-3 text-center">
                    <p className="text-[9px] uppercase tracking-widest text-hiraya-ink mb-1">50% DP</p>
                    <p className="text-sm text-hiraya-ink">₱{safeDp.toFixed(2)}</p>
                  </div>
                  <div className="bg-hiraya-cream/30 border-hiraya-olive/15 rounded-xl py-3 text-center">
                    <p className="text-[9px] uppercase tracking-widest text-hiraya-ink mb-1">Balance</p>
                    <p className="text-sm">₱{safeBalance.toFixed(2)}</p>
                  </div>
                </div>

                <p className="text-[10px] text-hiraya-sand leading-relaxed mb-5 flex gap-2">
                  <AlertTriangle size={13} className="text-hiraya-ink shrink-0 mt-0.5" />
                  A 50% down payment secures your order. The balance must be settled before shipping.
                  Down payments are non-refundable.
                </p>

                <button
                  onClick={toggleAll}
                  className="w-full mb-4 py-2 text-[10px] uppercase tracking-widest text-hiraya-ink hover:text-hiraya-ink transition"
                >
                  {allSelected ? 'Unselect all items' : 'Select all items'}
                </button>

                <button
                  onClick={handleProceed}
                  disabled={selectedItems.length === 0}
                  className="w-full py-4 bg-[#CB997E] text-hiraya-olive text-[11px] font-black uppercase tracking-[0.2em] rounded-lg hover:bg-hiraya-cream-deep transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Proceed to Checkout ({selectedItems.length})
                </button>

                {/* Bag -> AI Try-On handoff. The Studio reads these same bag
                    items, so this is a straight navigation, no re-fetch dance. */}
                <button
                  onClick={() => navigate('/try-on')}
                  className="w-full mt-3 py-3 border-[#CB997E]/40 text-hiraya-ink text-[10px] font-black uppercase tracking-[0.2em] rounded-lg hover:bg-[#CB997E]/10 transition flex items-center justify-center gap-2"
                >
                  <Sparkles size={13} /> Try These On
                </button>

                <p className="text-[9px] text-hiraya-sand text-center mt-4 flex items-center justify-center gap-1.5">
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
