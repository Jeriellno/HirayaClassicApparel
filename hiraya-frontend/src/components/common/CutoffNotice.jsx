import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import api from '../../api/axios';
import { DEFAULT_POLICY, formatCutoff, isAfterCutoff } from '../../utils/orderPolicy';

/** The store's cut-off, timezone and hours (served with the payment details). */
export const useOrderPolicy = () => {
  const { data } = useQuery({
    queryKey: ['payment-instructions'],
    queryFn: async () => (await api.get('/payment-instructions')).data,
    staleTime: 30 * 60 * 1000,
  });

  return {
    cutoff: data?.cutoff || DEFAULT_POLICY.cutoff,
    timezone: data?.timezone || DEFAULT_POLICY.timezone,
    store_hours: Array.isArray(data?.store_hours) ? data.store_hours : DEFAULT_POLICY.store_hours,
  };
};

/**
 * Live "order now → processed today / tomorrow" line for Checkout, plus the
 * store hours. Re-evaluated every minute so a page left open across the
 * cut-off flips on its own.
 */
const CutoffNotice = ({ className = '' }) => {
  const policy = useOrderPolicy();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const late = isAfterCutoff(now, policy);

  return (
    <div className={`rounded-xl border border-hiraya-structure-line bg-hiraya-surface px-4 py-3 ${className}`}>
      <p className="flex items-center gap-2 text-[11px] font-semibold text-hiraya-ink">
        <Clock size={13} className="shrink-0 text-hiraya-accent" />
        {late
          ? `Past the ${formatCutoff(policy.cutoff)} cut-off — your order will be processed tomorrow.`
          : `Order before ${formatCutoff(policy.cutoff)} — your order will be processed today.`}
      </p>
      {policy.store_hours.length > 0 && (
        <dl className="mt-2 space-y-0.5 text-[10px] text-hiraya-ink-muted">
          {policy.store_hours.map((row) => (
            <div key={row.days} className="flex justify-between gap-3">
              <dt>{row.days}</dt>
              <dd className="text-hiraya-ink">{row.hours}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
};

CutoffNotice.propTypes = { className: PropTypes.string };

export default CutoffNotice;
