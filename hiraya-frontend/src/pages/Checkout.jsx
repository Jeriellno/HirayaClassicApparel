import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, AlertTriangle, CheckCircle2, Truck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import Currency from '../components/common/Currency';
import PaymentInstructions from '../components/common/PaymentInstructions';

const Checkout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Optional product context passed from ProductDetail's"Proceed to Checkout".
  const prefill = location.state || {};
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [formData, setFormData] = useState({
    customer_name: '',
    contact_number: '',
    delivery_address: '',
    courier: 'lbc',
  });

  const [dpProof, setDpProof] = useState(null);
  const [dpReference, setDpReference] = useState('');
  const [agreed, setAgreed] = useState(false);

  // The backend prices the order server-side, so what we forward is the
  // *intent* (which product/size/color, how many), never the price.
  //
  // Cart path:   location.state.items = [{ product_id, quantity, size, color }]
  // Buy-now path: location.state = { product_id, selected_size, selected_color, quantity }
  const lineItems = Array.isArray(prefill.items)
    ? prefill.items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity ?? 1,
        size: item.size ?? null,
        color: item.color ?? null,
      }))
    : null;

  const buyNowItem = prefill.product_id
    ? {
        product_id: prefill.product_id,
        quantity: prefill.quantity ?? 1,
        size: prefill.selected_size ?? null,
        color: prefill.selected_color ?? null,
      }
    : null;

  const fromCart = Array.isArray(prefill.items) && prefill.items.length > 0;

  // Display-only mirror of what the server will compute; never sent as truth.
  const estimatedTotal = fromCart
    ? prefill.items.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 1), 0)
    : buyNowItem
      ? Number(prefill.total_amount || 0)
      : 0;

  const total = estimatedTotal || 0;
  const dpAmount = total ? (total / 2).toFixed(2) : '0.00';
  const balance = total ? (total / 2).toFixed(2) : '0.00';

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!agreed) {
      setErrorMessage('Please agree to the order guidelines before proceeding.');
      return;
    }
    if (!dpProof) {
      setErrorMessage('Please upload your 50% down payment receipt.');
      return;
    }
    if (dpReference.trim().length < 4) {
      setErrorMessage('Please enter the reference number from your GCash or bank receipt.');
      return;
    }

    // Guard: checkout needs something to actually order. Without this the
    // backend rejects the request with a confusing 422.
    if (!lineItems && !buyNowItem) {
      setErrorMessage(
        'Your bag is empty or this product is missing. Please add an item before checking out.'
      );
      return;
    }

    setLoading(true);
    try {
      // Multipart FormData because we are uploading the DP proof image.
      const payload = new FormData();
      payload.append('customer_name', formData.customer_name);
      payload.append('contact_number', formData.contact_number);
      payload.append('delivery_address', formData.delivery_address);
      payload.append('courier', formData.courier);
      payload.append('dp_proof_image', dpProof);
      payload.append('dp_reference_number', dpReference.trim());

      // Tell the backend which path this is, so it clears the bag only for
      // genuine cart checkouts.
      payload.append('source', fromCart ? 'cart' : 'direct');
      if (fromCart && Array.isArray(prefill.cart_item_ids)) {
        prefill.cart_item_ids.forEach((id) => payload.append('cart_item_ids[]', id));
      }

      // Forward the line items. The server ignores any client price and reads
      // products.price from the database, then decrements stock per line.
      if (lineItems) {
        lineItems.forEach((item, index) => {
          payload.append(`items[${index}][product_id]`, item.product_id);
          payload.append(`items[${index}][quantity]`, item.quantity);
          if (item.size) payload.append(`items[${index}][size]`, item.size);
          if (item.color) payload.append(`items[${index}][color]`, item.color);
        });
      } else if (buyNowItem) {
        payload.append('product_id', buyNowItem.product_id);
        payload.append('quantity', buyNowItem.quantity);
        if (buyNowItem.size) payload.append('size', buyNowItem.size);
        if (buyNowItem.color) payload.append('color', buyNowItem.color);
      }

      await api.post('/checkout', payload);
      // The bag may have changed server-side; immediately discard stale cached
      // totals/items before the success screen offers navigation back to it.
      if (fromCart) await queryClient.invalidateQueries({ queryKey: ['cart'] });
      setSuccess(true);
    } catch (err) {
      const validation = err.response?.data?.errors;
      const firstError = validation ? Object.values(validation)[0][0] : null;
      setErrorMessage(firstError || err.response?.data?.message || 'Checkout failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 pb-20 pt-24 text-hiraya-ink">
        <div className="glass w-full max-w-md p-10 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-cream-100 shadow-neu ring-1 ring-cream-50">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-hiraya-accent text-hiraya-on-accent">
              <CheckCircle2 className="h-6 w-6" />
            </span>
          </div>
          <h2 className="display-md text-hiraya-ink">Order Received</h2>
          <p className="mt-3 text-xs leading-relaxed text-hiraya-ink-soft">
            We have received your down payment proof. Our team will verify it and update your order
            status within the 3:00 PM same-day processing cutoff.
          </p>

          <PaymentInstructions amount={dpAmount} amountLabel="Down payment sent" className="mb-8 mt-6 text-left" />

          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <button
              onClick={() => navigate('/orders')}
              className="btn-primary w-full rounded-full sm:w-auto"
            >
              Track My Order
            </button>
            <button
              onClick={() => navigate('/')}
              className="btn-secondary w-full rounded-full sm:w-auto"
            >
              Back to Store
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page min-h-screen pb-24 pt-32 text-hiraya-ink">
      <div className="mx-auto max-w-6xl">
        {/*
         * THE PAGE HEADING, ON THE SHARED EDITORIAL DEVICE.
         *
         * This was a 4xl/-font-light heading with 0.3em tracking sitting above a
         * second `font-black` uppercase line — neither of which the rest of the
         * app uses any more. It is now the same `.kicker` + `.display-lg` pair
         * every other page opens with, so Checkout reads as part of the house.
         */}
        <div className="section-head mb-10 border-b border-hiraya-structure-line pb-8">
          <span className="kicker text-hiraya-ink-muted">Secure your order with a 50% down payment</span>
          <h1 className="display-section mt-2 text-navy-900">Checkout</h1>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* ORDER GUIDELINES CARD */}
          <div className="lg:col-span-1">
            <div data-tour="checkout-guidelines" className="card-raised rounded-[24px] p-6 sm:p-7 lg:sticky lg:top-28">
              <h3 className="mb-4 border-b border-hiraya-structure-line pb-3 text-xs font-semibold uppercase tracking-[0.18em] text-hiraya-ink">
                Order Guidelines
              </h3>
              <ul className="space-y-3 text-[11px] leading-relaxed text-hiraya-ink-soft">
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  Orders placed before <strong className="text-hiraya-ink">3:00 PM</strong> are processed the same day.
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  A <strong className="text-hiraya-ink">50% down payment (PAYO)</strong> is required to secure your order.
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  The remaining balance must be settled <strong className="text-hiraya-ink">before shipping</strong>.
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  Down payments are <strong className="text-hiraya-ink">non-refundable</strong>.
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  All sales are <strong className="text-hiraya-ink">final</strong> once payment is confirmed.
                </li>
              </ul>

              {/**
                * THE GUIDELINES CHECKBOX USES THE SAME NATIVE-CONTROL TREATMENT
                * AS THE AUTH FORMS.
                *
                * `accent-[#541A1A]` was a raw hex in a className; it is now
                * `accent-hiraya-accent`, which is the identical colour through the
                * token. The `focus:ring-0` is kept so the browser's default blue
                * focus halo never fights the system's maroon ring.
                */}
              <label className="mt-6 flex cursor-pointer items-start gap-3 border-t border-hiraya-structure-line pt-5">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 cursor-pointer accent-hiraya-accent focus:ring-0"
                />
                <span className="text-[11px] leading-relaxed text-hiraya-ink">
                  I have read and agree to the order guidelines above.
                </span>
              </label>
            </div>
          </div>

          {/* CHECKOUT FORM */}
          <form onSubmit={handleSubmit} className="space-y-6 lg:col-span-2">
            {/* Shipping Details */}
            <div data-tour="checkout-shipping" className="card-raised rounded-[24px] p-6 sm:p-7">
              <h3 className="mb-6 flex items-center gap-3 border-b border-hiraya-structure-line pb-4 text-xs font-semibold uppercase tracking-[0.18em] text-hiraya-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 font-serif text-[0.8rem] text-cream-100">1</span>
                Shipping Details
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                    Full Name
                  </label>
                  <input
                    name="customer_name"
                    value={formData.customer_name}
                    onChange={handleChange}
                    required
                    className="field"
                    placeholder="Juan Dela Cruz"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                    Contact Number
                  </label>
                  <input
                    name="contact_number"
                    value={formData.contact_number}
                    onChange={handleChange}
                    required
                    className="field"
                    placeholder="09XX XXX XXXX"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                    Complete Delivery Address
                  </label>
                  <textarea
                    name="delivery_address"
                    value={formData.delivery_address}
                    onChange={handleChange}
                    required
                    rows={3}
                    className="field resize-none"
                    placeholder="House No., Street, Barangay, City, Province, ZIP"
                  />
                </div>
              </div>
            </div>

            {/* Courier Selection */}
            <div data-tour="checkout-courier" className="card-raised rounded-[24px] p-6 sm:p-7">
              <h3 className="mb-6 flex items-center gap-3 border-b border-hiraya-structure-line pb-4 text-xs font-semibold uppercase tracking-[0.18em] text-hiraya-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 font-serif text-[0.8rem] text-cream-100">2</span>
                <Truck className="h-4 w-4 text-hiraya-accent" /> Courier
              </h3>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { value: 'lbc', label: 'LBC' },
                  { value: 'lalamove', label: 'Lalamove' },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-2xl border px-4 py-5 text-center transition-all duration-300 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-hiraya-focus ${formData.courier === option.value
                        ? 'border-hiraya-accent-deep bg-hiraya-accent text-hiraya-on-accent shadow-[0_12px_24px_-14px_rgba(21,32,54,0.8)]'
                        : 'border-cream-50/80 bg-hiraya-surface text-hiraya-ink shadow-neu-sm hover:-translate-y-0.5'
                      }`}
                  >
                    <input
                      type="radio"
                      name="courier"
                      value={option.value}
                      checked={formData.courier === option.value}
                      onChange={handleChange}
                      className="sr-only"
                    />
                    <span className="text-xs font-semibold uppercase tracking-[0.16em]">{option.label}</span>
                  </label>
                ))}
              </div>

              {formData.courier === 'lalamove' && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-hiraya-accent/20 bg-hiraya-accent-wash px-4 py-3 text-[11px] text-hiraya-ink">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-hiraya-accent" />
                  <span>
                    Note: You will be responsible for booking the courier once the item is ready.
                  </span>
                </div>
              )}
            </div>

            {/* Payment */}
            <div data-tour="checkout-payment" className="card-raised rounded-[24px] p-6 sm:p-7">
              <h3 className="mb-6 flex items-center gap-3 border-b border-hiraya-structure-line pb-4 text-xs font-semibold uppercase tracking-[0.18em] text-hiraya-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 font-serif text-[0.8rem] text-cream-100">3</span>
                Payment
              </h3>

              <div className="mb-5">
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                  Your Items
                </label>

                {/* Read-only: the price is computed and locked on the server. */}
                <ul className="space-y-2">
                  {(lineItems || (buyNowItem ? [buyNowItem] : [])).map((item, index) => {
                    const label =
                      lineItems?.[index]?.name ??
                      prefill.product_name ??
                      `Product #${item.product_id}`;
                    const unitPrice = lineItems?.[index]?.price ?? prefill.total_amount ?? 0;

                    return (
                      <li
                        key={`${item.product_id}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-xl bg-cream-200/60 px-4 py-3 text-[11px] shadow-neu-inset"
                      >
                        <span className="min-w-0 truncate text-hiraya-ink">
                          {label}
                          <span className="text-hiraya-ink-muted">
                            {' '}
                            {item.size ? `· ${item.size}` : ''}
                            {item.color ? ` · ${item.color}` : ''}
                            {` × ${item.quantity}`}
                          </span>
                        </span>
                        {/*
                          * THE PESO IS ROUTED THROUGH <Currency>.
                          *
                          * This line hard-coded `` as a literal, and the file
                          * had stored it as a mojibake pair — so the line total
                          * rendered as two junk glyphs rather than a peso sign.
                          * <Currency> pins the glyph-safe stack, which is exactly
                          * the problem that component was written to solve.
                          */}
                        <Currency
                          amount={Number(unitPrice) * Number(item.quantity)}
                          className="shrink-0 text-hiraya-ink"
                        />
                      </li>
                    );
                  })}
                </ul>

                <p className="mt-3 text-[10px] leading-relaxed text-hiraya-ink-muted">
                  Your total is verified against live prices on our server when you submit.
                </p>
              </div>

              <div className="mb-5 grid grid-cols-2 gap-4 text-center">
                <div className="rounded-2xl bg-navy-900 py-4 shadow-[0_12px_24px_-14px_rgba(21,32,54,0.8)]">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.16em] text-cream-400">
                    50% Down Payment
                  </p>
                  <Currency amount={dpAmount} className="text-lg font-semibold text-cream-50" />
                </div>
                <div className="rounded-2xl bg-cream-200/60 py-4 shadow-neu-inset">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                    Balance Before Shipping
                  </p>
                  <Currency amount={balance} className="text-lg font-semibold text-hiraya-ink" />
                </div>
              </div>

              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                Upload Down Payment Receipt
              </label>
              {/*
                * THE FILE INPUT STILL USES THE NATIVE `file:` BUTTON, because a
                * visually-hidden input plus a styled label would have changed the
                * control's behaviour (drag-and-drop, keyboard focus order). Only
                * its COLOURS moved onto tokens: `file:bg-[#541A1A]` is now
                * `file:bg-hiraya-accent`, and the raw `border-hiraya-olive/15`
                * ground is the shared `.field` surface.
                */}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setDpProof(e.target.files[0])}
                className="field cursor-pointer text-xs file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-hiraya-accent file:px-4 file:py-2 file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.16em] file:text-hiraya-on-accent hover:file:bg-hiraya-accent-deep"
              />

              <label
                htmlFor="dp_reference_number"
                className="mb-2 mt-5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted"
              >
                Payment Reference Number
              </label>
              <input
                id="dp_reference_number"
                type="text"
                value={dpReference}
                onChange={(e) => setDpReference(e.target.value)}
                required
                minLength={4}
                maxLength={64}
                autoComplete="off"
                className="field"
                placeholder="e.g. GCash Ref. No. 1234 567 890123"
              />
              <p className="mt-2 text-[10px] text-hiraya-ink-muted">
                Printed on your GCash or bank receipt. We match it against our records to verify your payment.
              </p>
            </div>

            {errorMessage && (
              <div className="rounded-xl border border-red-600/40 bg-red-500/12 px-4 py-3 text-[11px] text-red-700">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              data-tour="checkout-submit"
              disabled={loading}
              className="btn-primary w-full rounded-full py-4"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Submitting Order...' : 'Submit Order & Down Payment'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
