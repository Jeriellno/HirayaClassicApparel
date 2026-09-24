import { useEffect, useState } from 'react';
import { Landmark, Smartphone, QrCode, Loader2 } from 'lucide-react';
import api from '../../api/axios';

/**
 * Renders where the customer should send their payment (down payment or the
 * remaining balance). Fetches the store's payout accounts from the backend so
 * the account details live in one place instead of being hard-coded per page.
 *
 * This is the missing piece that turns the balance screen from a dead end
 * ("pay ₱X" with no destination) into a complete instruction.
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
      <div className={`flex items-center gap-2 text-[11px] text-gray-500 ${className}`}>
        <Loader2 size={13} className="animate-spin" /> Loading payment details...
      </div>
    );
  }

  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];

  if (!data || accounts.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-xl border-[#E9C46A]/25 bg-[#E9C46A]/5 p-4 ${className}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E9C46A] mb-2">
        How to Pay
      </p>

      {amount != null && (
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/10">
          <span className="text-[9px] uppercase tracking-widest text-gray-400">{amountLabel}</span>
          <span className="text-sm font-bold text-[#E9C46A]">₱{Number(amount).toFixed(2)}</span>
        </div>
      )}

      {data.instructions && (
        <p className="text-[11px] text-gray-300 leading-relaxed mb-3">{data.instructions}</p>
      )}

      <div className="space-y-2">
        {accounts.map((account, index) => {
          const Icon = iconFor(account.type);
          return (
            <div
              key={`${account.type}-${index}`}
              className="flex items-start gap-3 bg-black/30 rounded-lg px-3 py-2.5"
            >
              <Icon size={15} className="text-[#E9C46A] mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest text-gray-400">
                  {account.type}
                </p>
                <p className="text-[11px] text-white font-bold tracking-wide">
                  {account.number}
                </p>
                <p className="text-[10px] text-gray-400">{account.name}</p>
                {account.note && (
                  <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{account.note}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {data.qr_image_url && (
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-3">
          <QrCode size={15} className="text-[#E9C46A] shrink-0" />
          <img
            src={data.qr_image_url}
            alt="Payment QR code"
            className="w-28 h-28 rounded-lg border-white/10 object-contain bg-white"
          />
        </div>
      )}

      <p className="text-[10px] text-gray-500 mt-3 leading-relaxed">
        After sending, upload your receipt below. Keep the reference number until your payment is confirmed.
      </p>
    </div>
  );
};

export default PaymentInstructions;
