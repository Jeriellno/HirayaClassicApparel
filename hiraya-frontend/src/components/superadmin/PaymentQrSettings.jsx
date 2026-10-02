import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, QrCode, Trash2, Upload } from 'lucide-react';
import api, { parseApiError } from '../../api/axios';
import { shrinkForUpload } from '../../utils/shrinkForUpload';

const toDataUri = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

/**
 * The store's GCash / bank QR. Customers see it wherever they pay (Checkout,
 * the balance screen) and must also enter the reference number from their
 * receipt, which staff then match in the store's app before approving.
 */
const PaymentQrSettings = () => {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['payment-instructions'],
    queryFn: async () => (await api.get('/payment-instructions')).data,
    staleTime: 30 * 60 * 1000,
  });
  const current = data?.qr_image_url || null;

  const save = async (image) => {
    setBusy(true);
    setMessage({ type: '', text: '' });
    try {
      await api.put('/admin/payment-qr', { image });
      await queryClient.invalidateQueries({ queryKey: ['payment-instructions'] });
      setMessage({ type: 'ok', text: image ? 'Payment QR updated. Customers will see it when they pay.' : 'Payment QR removed.' });
    } catch (error) {
      setMessage({ type: 'error', text: parseApiError(error).message });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setMessage({ type: 'error', text: 'Choose a PNG, JPG or WebP image of your QR code.' });
      return;
    }
    save(await toDataUri(await shrinkForUpload(file, { maxDim: 1200, maxDimPng: 1200 })));
  };

  return (
    <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-4 pt-6 mt-6">
      <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center gap-2">
        <QrCode size={16} className="text-hiraya-ink" /> Payment QR
      </h3>
      <p className="text-[11px] text-hiraya-sand normal-case tracking-normal leading-relaxed">
        Upload your GCash or bank QR. Customers scan it to pay their down payment and balance, then enter the
        reference number from their receipt — check that number in your GCash or bank app before approving.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-xl border border-hiraya-structure-line bg-white">
          {isLoading ? (
            <Loader2 size={18} className="animate-spin text-hiraya-sand" />
          ) : current ? (
            <img src={current} alt="Store payment QR code" className="h-full w-full object-contain" />
          ) : (
            <span className="px-3 text-center text-[10px] uppercase tracking-widest text-hiraya-sand">No QR yet</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-xs font-semibold text-cream-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {current ? 'Replace QR' : 'Upload QR'}
          </button>
          {current && (
            <button
              type="button"
              onClick={() => save(null)}
              disabled={busy}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-red-600/40 px-4 py-2 text-xs text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 size={14} /> Remove
            </button>
          )}
        </div>
      </div>

      {message.text && (
        <p className={`text-[11px] ${message.type === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{message.text}</p>
      )}
    </div>
  );
};

export default PaymentQrSettings;
