export const Field = ({ label, children }) => (
  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
    <span className="mb-1.5 block">{label}</span>
    {children}
  </label>
);