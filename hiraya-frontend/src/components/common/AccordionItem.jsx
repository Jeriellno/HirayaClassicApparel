import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Minimal, accessible accordion row for the product page.
 *
 * Deliberately dependency-free: a controlled button + region pair so keyboard
 * and screen-reader users get the same experience as mouse users.
 */
const AccordionItem = ({ title, subtitle, icon: Icon, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `accordion-panel-${String(title).replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="border-b border-hiraya-sand last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-4 py-4 text-left group"
      >
        <span className="flex items-center gap-3 min-w-0">
          {Icon && (
            <span className="text-hiraya-ink shrink-0">
              <Icon size={15} />
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[11px] uppercase tracking-[0.18em] font-bold text-hiraya-ink">
              {title}
            </span>
            {subtitle && (
              <span className="block text-[11px] text-hiraya-sand font-normal mt-0.5 truncate">
                {subtitle}
              </span>
            )}
          </span>
        </span>

        <ChevronDown
          size={16}
          className={`shrink-0 text-hiraya-sand transition-transform duration-300 group-hover:text-hiraya-ink ${open ? 'rotate-180 text-hiraya-ink' : ''
            }`}
        />
      </button>

      {/* Grid-rows trick animates height without measuring the DOM. */}
      <div
        id={panelId}
        role="region"
        className={`grid transition-all duration-300 ease-in-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
      >
        <div className="overflow-hidden">
          <div className="pb-5 text-[12.5px] text-hiraya-sand font-normal leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
};

export default AccordionItem;
