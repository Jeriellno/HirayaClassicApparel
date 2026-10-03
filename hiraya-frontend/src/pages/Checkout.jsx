import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, AlertTriangle, CheckCircle2, Truck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import Currency from '../components/common/Currency';
import PaymentInstructions from '../components/common/PaymentInstructions';
import CutoffNotice from '../components/common/CutoffNotice';
import { useT } from '../context/PreferencesContext';

const Checkout = () => {
  const t = useT();
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
    // LBC needs the complete address in parts (Order Guidelines §4).
    address_line: '',
    barangay: '',
    city: '',
    province: '',
    postal_code: '',
  });

  // The receipt of the FULL payment. The 50% down-payment option and the
  // customer-typed Reference Number were removed: one full payment per order,
  // verified by the store against its own transaction records.
  const [dpProof, setDpProof] = useState(null);
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
        // Display-only (the server re-prices): without these the summary read
        // "Product #49" and fell back to the order total for each line.
        name: item.name ?? null,
        price: item.price ?? null,
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
  const payAmount = total ? total.toFixed(2) : '0.00';

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (loading) return;
    if (formData.customer_name.trim().length < 2) {
      setErrorMessage('Please enter the full name of the person receiving the order.');
      return;
    }
    // PH mobile: 09XXXXXXXXX or +639XXXXXXXXX (spaces / dashes allowed).
    if (!/^(\+?63|0)9\d{9}$/.test(formData.contact_number.replace(/[\s-]/g, ''))) {
      setErrorMessage('Please enter a valid mobile number, e.g. 0917 123 4567.');
      return;
    }
    if (formData.courier === 'lbc') {
      const missing = [
        ['address_line', 'house no. and street'],
        ['barangay', 'barangay'],
        ['city', 'city or municipality'],
        ['province', 'province'],
      ].find(([key]) => formData[key].trim().length < 2);
      if (missing) {
        setErrorMessage(`Please enter your ${missing[1]} — LBC needs your complete delivery details.`);
        return;
      }
      if (!/^\d{4}$/.test(formData.postal_code.trim())) {
        setErrorMessage('Please enter your 4-digit ZIP code for LBC.');
        return;
      }
    } else if (formData.delivery_address.trim().length < 10) {
      setErrorMessage('Please enter the complete drop-off address for your Lalamove rider.');
      return;
    }
    if (!agreed) {
      setErrorMessage('Please agree to the order guidelines before proceeding.');
      return;
    }
    if (dpProof && (!/^image\/(png|jpe?g|webp)$/i.test(dpProof.type) || dpProof.size > 5 * 1024 * 1024)) {
      setErrorMessage('The receipt must be a PNG, JPG or WEBP image under 5 MB.');
      return;
    }
    if (!dpProof) {
      setErrorMessage('Please upload the receipt of your full payment.');
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
      // Multipart FormData because we are uploading the payment receipt.
      const payload = new FormData();
      payload.append('customer_name', formData.customer_name);
      payload.append('contact_number', formData.contact_number);
      payload.append('courier', formData.courier);
      payload.append('payment_option', 'full');
      if (formData.courier === 'lbc') {
        ['address_line', 'barangay', 'city', 'province', 'postal_code'].forEach((key) =>
          payload.append(key, formData[key].trim()));
      } else {
        payload.append('delivery_address', formData.delivery_address.trim());
      }
      payload.append('dp_proof_image', dpProof);

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
          <h2 className="display-md text-hiraya-ink">{t('checkout.received')}</h2>
          <p className="mt-3 text-xs leading-relaxed text-hiraya-ink-soft">
            We received your payment receipt. Your payment is <strong className="text-hiraya-ink">pending verification</strong>:
            our team matches it against our payment records before your order is prepared. Orders placed before
            3:00 PM are processed the same day.
          </p>

          <PaymentInstructions amount={payAmount} amountLabel="Payment sent" className="mb-8 mt-6 text-left" />

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
          <span className="kicker text-hiraya-ink-muted">One full payment secures your order</span>
          <h1 className="display-section mt-2 text-navy-900">{t('checkout.title')}</h1>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* ORDER GUIDELINES CARD */}
          <div className="lg:col-span-1">
            <div data-tour="checkout-guidelines" className="card-raised rounded-[24px] p-6 sm:p-7 lg:sticky lg:top-28">
              <h3 className="mb-4 border-b border-hiraya-structure-line pb-3 text-xs font-semibold uppercase tracking-[0.18em] text-hiraya-ink">
                Order Guidelines
              </h3>
              <CutoffNotice className="mb-4" />
              <ul className="space-y-3 text-[11px] leading-relaxed text-hiraya-ink-soft">
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  <span>Pay the <strong className="text-hiraya-ink">full order amount</strong> in one payment and upload the receipt.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  <span>We <strong className="text-hiraya-ink">verify every payment against our own GCash / bank records</strong> before preparing your order. A receipt image alone does not confirm payment.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  <span>We ship via <strong className="text-hiraya-ink">LBC</strong> or <strong className="text-hiraya-ink">Lalamove</strong> once your payment is verified.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  <span>Give your complete name, contact number and address. For <strong className="text-hiraya-ink">Lalamove</strong>, you book the rider and send us the booking/tracking details from My Orders.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-accent">·</span>
                  <span>Once payment is confirmed the order is <strong className="text-hiraya-ink">final</strong> — no cancellations or refunds.</span>
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

              {/* DELIVERY DETAILS — what each courier needs (Order Guidelines §4). */}
              {formData.courier === 'lbc' ? (
                <div className="mt-5 space-y-3">
                  <p className="text-[11px] text-hiraya-ink-soft">
                    We book your LBC shipment, so please give your <strong className="text-hiraya-ink">complete delivery details</strong>.
                  </p>
                  {[
                    { name: 'address_line', label: 'House No. & Street', placeholder: '12 Riverside St' },
                    { name: 'barangay', label: 'Barangay', placeholder: 'San Roque' },
                    { name: 'city', label: 'City / Municipality', placeholder: 'Marikina City' },
                    { name: 'province', label: 'Province', placeholder: 'Metro Manila' },
                    { name: 'postal_code', label: 'ZIP Code', placeholder: '1801', inputMode: 'numeric', maxLength: 4 },
                  ].map((field) => (
                    <div key={field.name}>
                      <label htmlFor={field.name} className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                        {field.label}
                      </label>
                      <input
                        id={field.name}
                        name={field.name}
                        value={formData[field.name]}
                        onChange={handleChange}
                        required
                        inputMode={field.inputMode}
                        maxLength={field.maxLength}
                        className="field"
                        placeholder={field.placeholder}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <div className="flex items-start gap-2 rounded-xl border border-hiraya-accent/20 bg-hiraya-accent-wash px-4 py-3 text-[11px] text-hiraya-ink">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-hiraya-accent" />
                    <span>
                      With Lalamove, <strong>you book the rider</strong>. Once your order is fully paid and ready, book a Lalamove
                      pickup from our store and send us the booking / tracking details from <strong>My Orders</strong>.
                    </span>
                  </div>
                  <div>
                    <label htmlFor="delivery_address" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                      Drop-off Address
                    </label>
                    <textarea
                      id="delivery_address"
                      name="delivery_address"
                      value={formData.delivery_address}
                      onChange={handleChange}
                      required
                      rows={2}
                      className="field resize-none"
                      placeholder="Where the rider will deliver: unit / house no., street, barangay, city"
                    />
                  </div>
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

              {/* ONE FULL PAYMENT — the whole order total, no down payment. */}
              <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-hiraya-accent-deep bg-hiraya-accent px-5 py-4 text-hiraya-on-accent shadow-[0_12px_24px_-14px_rgba(21,32,54,0.8)]">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.16em] opacity-80">Full Payment</p>
                  <p className="mt-0.5 text-[10px] opacity-80">The whole order total, paid once.</p>
                </div>
                <Currency amount={payAmount} className="text-lg font-semibold" />
              </div>

              <PaymentInstructions
                amount={payAmount}
                amountLabel="Send now (full payment)"
                className="mb-5"
              />

              <label htmlFor="payment_receipt" className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                Upload Payment Receipt
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
                id="payment_receipt"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setDpProof(e.target.files[0])}
                className="field cursor-pointer text-xs file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-hiraya-accent file:px-4 file:py-2 file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.16em] file:text-hiraya-on-accent hover:file:bg-hiraya-accent-deep"
              />

              <p className="mt-2 text-[10px] text-hiraya-ink-muted">
                A clear screenshot of your GCash, Maya or bank receipt (PNG, JPG or WEBP, up to 5 MB).
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
              {loading ? 'Submitting Order...' : 'Submit Order & Payment'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
