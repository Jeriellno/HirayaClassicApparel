import { useEffect, useState } from 'react';
import { Landmark, Smartphone, QrCode, Loader2 } from 'lucide-react';
import api from '../../api/axios';
import Currency from './Currency';

/**
 * Renders where the customer should send their payment (the full order amount, or the
 * remaining balance). Fetches the store's payout accounts from the backend so
 * the account details live in one place instead of being hard-coded per page.
 *
 * This is the missing piece that turns the balance screen from a dead end
 * ("pay X" with no destination) into a complete instruction.
 */
const ICONS = {
  gcash: Smartphone,
  maya: Smartphone,
  bank: Landmark,
};

const iconFor = (type = '') => {
  const key = type.toLowerCase();
  if (key.includes('bank')) return ICONS.bank;
  if (key.includes('gcash') || key.includes('maya')) return ICONS.gcash;
  return Landmark;
};

const PaymentInstructions = ({ amount = null, amountLabel = 'Amount to send', className = '' }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .get('/payment-instructions')
      .then((res) => {
        if (alive) setData(res.data);
      })
      .catch(() => {
        /* Non-fatal: the surrounding action still works without instructions. */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-[11px] text-hiraya-ink-muted ${className}`}>
        <Loader2 size={13} className="animate-spin" /> Loading payment details...
      </div>
    );
  }

  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];

  if (!data || accounts.length === 0) {
    return null;
  }

  /*
   * THE PAYMENT PANEL IS A TINTED, RULED PLATE.
   *
   * It used to be `rounded-xl border-[#541A1A]/25 bg-[#541A1A]/5` — a raw accent
   * hex in two places, and a 12px radius that contradicted every other panel in
   * the system (which are `rounded-sm` cut-cloth plates). The accent wash is
   * unchanged in MEANING — "this is the money panel" — but it now comes from the
   * `accent-wash` token, so the tint tracks the palette instead of a literal.
   *
   * THE AMOUNT IS ROUTED THROUGH <Currency>.
   * While this file carried the peso as a bare `` character, the symbol was
   * stored as a mojibake sequence and every caller rendered the two junk
   * characters instead of the sign. <Currency> pins the glyph-safe stack
   * (see the note in that component), which is the whole reason it exists.
   */
  return (
    <div className={`rounded-sm border border-hiraya-accent/25 bg-hiraya-accent-wash p-4 ${className}`}>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-accent">
        How to Pay
      </p>

      {amount != null && (
        <div className="mb-3 flex items-center justify-between border-b border-hiraya-accent/20 pb-3">
          <span className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">{amountLabel}</span>
          <Currency amount={amount} className="text-sm font-semibold text-hiraya-ink" />
        </div>
      )}

      {data.instructions && (
        <p className="mb-3 text-[11px] leading-relaxed text-hiraya-ink">{data.instructions}</p>
      )}

      <div className="space-y-2">
        {accounts.map((account, index) => {
          const Icon = iconFor(account.type);
          return (
            <div
              key={`${account.type}-${index}`}
              className="flex items-start gap-3 rounded-sm border border-hiraya-structure-line bg-hiraya-surface px-3 py-2.5"
            >
              <Icon size={15} className="mt-0.5 shrink-0 text-hiraya-accent" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                  {account.type}
                </p>
                <p className="text-[11px] font-semibold tracking-wide text-hiraya-ink">
                  {account.number}
                </p>
                <p className="text-[10px] text-hiraya-ink">{account.name}</p>
                {account.note && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-hiraya-ink-muted">{account.note}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {data.qr_image_url && (
        <div className="mt-3 flex flex-col items-center gap-2 border-t border-hiraya-accent/20 pt-3 text-center">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-accent">
            <QrCode size={13} /> Scan to pay
          </p>
          <img
            src={data.qr_image_url}
            alt="Store payment QR code"
            className="h-44 w-44 rounded-sm border border-hiraya-structure-line bg-white object-contain"
          />
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-hiraya-ink-muted">
        After paying the <strong className="text-hiraya-ink">full amount</strong>, upload a clear screenshot of your receipt. The store confirms every payment in its own GCash / bank transaction history before your order is prepared.
      </p>
    </div>
  );
};

export default PaymentInstructions;
