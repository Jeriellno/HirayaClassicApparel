import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, AlertTriangle, CheckCircle2, Truck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
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
      <div className="min-h-screen bg-hiraya-bg flex items-center justify-center px-6 pt-24 pb-20 text-hiraya-ink">
        <div className="max-w-md w-full glass-card bg-white/[0.03] border-[#CB997E]/20 rounded-2xl p-10 text-center">
          <CheckCircle2 className="w-14 h-14 text-hiraya-ink mx-auto mb-6" />
          <h2 className="text-2xl font-light uppercase tracking-[0.2em] mb-3 text-hiraya-ink">Order Received</h2>
          <p className="text-xs text-hiraya-ink leading-relaxed mb-6">
            We have received your down payment proof. Our team will verify it and update your order
            status within the 3:00 PM same-day processing cutoff.
          </p>

          <PaymentInstructions amount={dpAmount} amountLabel="Down payment sent" className="text-left mb-8" />

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/orders')}
              className="px-8 py-3 bg-[#CB997E] text-hiraya-ink text-[10px] font-black uppercase tracking-[0.2em] rounded-lg hover:bg-hiraya-cream-deep transition"
            >
              Track My Order
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-8 py-3 border-hiraya-olive/20 text-hiraya-ink text-[10px] font-black uppercase tracking-[0.2em] rounded-lg hover:border-hiraya-olive/60 transition"
            >
              Back to Store
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-hiraya-bg px-6 md:px-20 pt-32 pb-20 text-hiraya-ink">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <h2 className="text-4xl font-light uppercase tracking-[0.3em] text-hiraya-ink">Checkout</h2>
          <p className="text-[10px] text-hiraya-ink font-black uppercase tracking-widest mt-2">
            Secure your order with a 50% down payment
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ORDER GUIDELINES CARD */}
          <div className="lg:col-span-1">
            <div className="glass-card bg-white/[0.03] border-[#CB997E]/20 rounded-2xl p-6 sticky top-28">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-hiraya-ink mb-4">
                Order Guidelines
              </h3>
              <ul className="space-y-3 text-[11px] text-hiraya-ink leading-relaxed">
                <li className="flex gap-2">
                  <span className="text-hiraya-ink">•</span>
                  Orders placed before <strong className="text-hiraya-ink">3:00 PM</strong> are processed the same day.
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-ink">•</span>
                  A <strong className="text-hiraya-ink">50% down payment (PAYO)</strong> is required to secure your order.
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-ink">•</span>
                  The remaining balance must be settled <strong className="text-hiraya-ink">before shipping</strong>.
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-ink">•</span>
                  Down payments are <strong className="text-hiraya-ink">non-refundable</strong>.
                </li>
                <li className="flex gap-2">
                  <span className="text-hiraya-ink">•</span>
                  All sales are <strong className="text-hiraya-ink">final</strong> once payment is confirmed.
                </li>
              </ul>

              <label className="flex items-start gap-3 mt-6 pt-5 border-t border-hiraya-olive/15 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 accent-[#CB997E]"
                />
                <span className="text-[11px] text-hiraya-ink leading-relaxed">
                  I have read and agree to the order guidelines above.
                </span>
              </label>
            </div>
          </div>

          {/* CHECKOUT FORM */}
          <form onSubmit={handleSubmit} className="lg:col-span-2 space-y-6">
            {/* Shipping Details */}
            <div className="glass-card bg-white/[0.03] border-hiraya-olive/15 rounded-2xl p-6">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-hiraya-ink mb-5">
                Shipping Details
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-hiraya-ink mb-2">
                    Full Name
                  </label>
                  <input
                    name="customer_name"
                    value={formData.customer_name}
                    onChange={handleChange}
                    required
                    className="w-full bg-hiraya-cream/30 border-hiraya-olive/15 rounded-lg px-4 py-3 text-sm focus:border-[#CB997E] outline-none transition"
                    placeholder="Juan Dela Cruz"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-hiraya-ink mb-2">
                    Contact Number
                  </label>
                  <input
                    name="contact_number"
                    value={formData.contact_number}
                    onChange={handleChange}
                    required
                    className="w-full bg-hiraya-cream/30 border-hiraya-olive/15 rounded-lg px-4 py-3 text-sm focus:border-[#CB997E] outline-none transition"
                    placeholder="09XX XXX XXXX"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-hiraya-ink mb-2">
                    Complete Delivery Address
                  </label>
                  <textarea
                    name="delivery_address"
                    value={formData.delivery_address}
                    onChange={handleChange}
                    required
                    rows={3}
                    className="w-full bg-hiraya-cream/30 border-hiraya-olive/15 rounded-lg px-4 py-3 text-sm focus:border-[#CB997E] outline-none transition resize-none"
                    placeholder="House No., Street, Barangay, City, Province, ZIP"
                  />
                </div>
              </div>
            </div>

            {/* Courier Selection */}
            <div className="glass-card bg-white/[0.03] border-hiraya-olive/15 rounded-2xl p-6">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-hiraya-ink mb-5 flex items-center gap-2">
                <Truck className="w-4 h-4" /> Courier
              </h3>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { value: 'lbc', label: 'LBC' },
                  { value: 'lalamove', label: 'Lalamove' },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-xl border px-4 py-4 text-center transition ${formData.courier === option.value
                        ? 'border-[#CB997E] bg-[#CB997E]/10'
                        : 'border-hiraya-olive/15 bg-hiraya-cream/30 hover:border-hiraya-olive/30'
                      }`}
                  >
                    <input
                      type="radio"
                      name="courier"
                      value={option.value}
                      checked={formData.courier === option.value}
                      onChange={handleChange}
                      className="hidden"
                    />
                    <span className="text-xs font-bold uppercase tracking-widest">{option.label}</span>
                  </label>
                ))}
              </div>

              {formData.courier === 'lalamove' && (
                <div className="mt-4 flex items-start gap-2 text-[11px] text-hiraya-ink/90 bg-hiraya-cream/10 border-hiraya-olive/15 rounded-lg px-4 py-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Note: You will be responsible for booking the courier once the item is ready.
                  </span>
                </div>
              )}
            </div>

            {/* Payment */}
            <div className="glass-card bg-white/[0.03] border-hiraya-olive/15 rounded-2xl p-6">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-hiraya-ink mb-5">
                Payment
              </h3>

              <div className="mb-5">
                <label className="block text-[10px] uppercase tracking-widest text-hiraya-ink mb-2">
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
                        className="flex items-center justify-between gap-3 bg-hiraya-cream/30 rounded-lg px-3 py-2.5 text-[11px]"
                      >
                        <span className="text-hiraya-ink min-w-0 truncate">
                          {label}
                          <span className="text-hiraya-sand">
                            {' '}
                            {item.size ? `· ${item.size}` : ''}
                            {item.color ? ` · ${item.color}` : ''}
                            {` × ${item.quantity}`}
                          </span>
                        </span>
                        <span className="text-hiraya-ink shrink-0">
                          ₱{(Number(unitPrice) * Number(item.quantity)).toFixed(2)}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <p className="text-[10px] text-hiraya-sand mt-3 leading-relaxed">
                  Your total is verified against live prices on our server when you submit.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-5 text-center">
                <div className="bg-[#CB997E]/10 border-[#CB997E]/30 rounded-xl py-4">
                  <p className="text-[9px] uppercase tracking-widest text-hiraya-ink mb-1">
                    50% Down Payment
                  </p>
                  <p className="text-lg font-light text-hiraya-ink">₱{dpAmount}</p>
                </div>
                <div className="bg-hiraya-cream/30 border-hiraya-olive/15 rounded-xl py-4">
                  <p className="text-[9px] uppercase tracking-widest text-hiraya-ink mb-1">
                    Balance Before Shipping
                  </p>
                  <p className="text-lg font-light">₱{balance}</p>
                </div>
              </div>

              <label className="block text-[10px] uppercase tracking-widest text-hiraya-ink mb-2">
                Upload Down Payment Receipt
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setDpProof(e.target.files[0])}
                className="w-full bg-hiraya-cream/30 border-hiraya-olive/15 rounded-lg px-4 py-3 text-xs file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#CB997E] file:text-hiraya-olive file:text-[10px] file:font-black file:uppercase file:tracking-widest hover:file:bg-hiraya-cream-deep transition"
              />
            </div>

            {errorMessage && (
              <div className="text-[11px] text-red-400 bg-red-500/10 border-red-500/30 rounded-lg px-4 py-3">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-[#CB997E] text-hiraya-olive text-xs font-black uppercase tracking-[0.2em] rounded-lg hover:bg-hiraya-cream-deep transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Submitting Order...' : 'Submit Order & Down Payment'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
