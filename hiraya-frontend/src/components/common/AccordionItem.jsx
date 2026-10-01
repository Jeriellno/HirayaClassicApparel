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
    /*
     * THE RULE IS THE SYSTEM HAIRLINE.
     *
     * Every divider in this component was `border-hiraya-sand`, which is now
     * INDIGO — so a stack of accordions drew full-strength dark bars between each
     * row instead of ruled stock. The dividers are the parchment hairline, and
     * the row divider on hover gains the accent only on the ACTIVE row.
     */
    <div className="border-b border-hiraya-structure-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="group flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className={`shrink-0 transition-colors ${open ? 'text-hiraya-accent' : 'text-hiraya-ink-muted group-hover:text-hiraya-accent'}`}>
              <Icon size={15} />
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-hiraya-ink">
              {title}
            </span>
            {subtitle && (
              <span className="mt-0.5 block truncate text-[11px] font-normal text-hiraya-ink-muted">
                {subtitle}
              </span>
            )}
          </span>
        </span>

        <ChevronDown
          size={16}
          className={`shrink-0 text-hiraya-ink-muted transition-transform duration-300 group-hover:text-hiraya-accent ${open ? 'rotate-180 text-hiraya-accent' : ''
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
          <div className="pb-5 text-[12.5px] font-normal leading-relaxed text-hiraya-ink-soft">{children}</div>
        </div>
      </div>
    </div>
  );
};

export default AccordionItem;
