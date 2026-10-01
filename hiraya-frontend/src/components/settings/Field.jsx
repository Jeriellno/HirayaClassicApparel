export const Field = ({ label, children }) => (
  <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
    <span className="mb-1.5 block">{label}</span>
    {children}
  </label>
);