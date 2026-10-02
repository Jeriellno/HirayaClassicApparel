/**
 * Order Guidelines §1 — the same-day cut-off, shared by Checkout and both
 * order lists. The backend is the source of truth for a placed order (its
 * `processing_date` / `placed_after_cutoff`); these helpers only label it and
 * preview the outcome for an order that is about to be placed.
 */
export const DEFAULT_POLICY = { cutoff: '15:00', timezone: 'Asia/Manila', store_hours: [] };

/** Y-m-d of `date` in the store's timezone. */
export const storeDate = (date = new Date(), timezone = DEFAULT_POLICY.timezone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/** Minutes since midnight of `date` in the store's timezone. */
const storeMinutes = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return get('hour') * 60 + get('minute');
};

const cutoffMinutes = (cutoff = DEFAULT_POLICY.cutoff) => {
  const [h, m] = String(cutoff).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const isAfterCutoff = (date = new Date(), policy = DEFAULT_POLICY) =>
  storeMinutes(date, policy.timezone || DEFAULT_POLICY.timezone) >= cutoffMinutes(policy.cutoff);

/** "3:00 PM" from "15:00". */
export const formatCutoff = (cutoff = DEFAULT_POLICY.cutoff) => {
  const total = cutoffMinutes(cutoff);
  const h = Math.floor(total / 60);
  const m = String(total % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
};

const addDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** "Today", "Tomorrow" or "Fri, Oct 3" for a store-local Y-m-d. */
export const describeProcessingDate = (ymd, timezone = DEFAULT_POLICY.timezone) => {
  if (!ymd) return '';
  const today = storeDate(new Date(), timezone);
  if (ymd === today) return 'Today';
  if (ymd === addDays(today, 1)) return 'Tomorrow';
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
};
