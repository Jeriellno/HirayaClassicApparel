import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Send, Loader2, Sparkles, ShoppingBag, ArrowUpRight, X } from 'lucide-react';
import Currency from '../common/Currency';
import logoImg from '../../assets/logo.png';
import { getProductImageUrl } from '../../utils/imageHelper';

/**
 * The Hiraya mark, used wherever the stylist identifies itself.
 *
 * The panel previously showed a generic robot glyph for both the header badge
 * and every assistant avatar, which read as "a bot" rather than "Hiraya" — and
 * contradicted the brand everywhere else in the app. The logo is the identity
 * here, so it replaces the robot entirely.
 */
const HirayaMark = ({ size = 16, className = '' }) => (
 <img
    src={logoImg}
    alt="Hiraya"
    style={{ width: size, height: size }}
    className={`object-contain ${className}`}
    onError={(e) => {
      // A missing logo asset must never blank the header — hide the image and
      // fall back to the wordmark text that already sits beside it.
      e.currentTarget.style.display = 'none';
    }}
  />
);

/**
 * Render a stylist message as light markdown.
 *
 * The backend emits `**bold**` for emphasis (sizes, colours). Rendering it as
 * literal asterisks looked broken, so the two supported spans — `**bold**` and
 * `*italic*` — are converted to real elements. Everything else is plain text,
 * deliberately: a chat that rendered arbitrary HTML from a vendor would be an
 * injection surface.
 */
const renderRich = (text) => {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);

  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return (
        <strong key={i} className="font-semibold text-hiraya-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (/^\*[^*]+\*$/.test(part)) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

/**
 * A catalog piece the stylist matched to the shopper's size.
 *
 * Clickable by design: the point of the chat is to turn a size answer into a
 * purchase, so each card navigates to the product. `onSelectProduct` is passed
 * by the host (the Studio wires it to navigation); without it the card renders
 * as a non-interactive tile rather than a dead link.
 */
const ProductCard = ({ product, onSelectProduct }) => {
  const clickable = typeof onSelectProduct === 'function';
  const src = product.image_url ? getProductImageUrl(product.image_url) : '';

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onSelectProduct(product)}
      className={`group flex w-[132px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-hiraya-structure-line bg-hiraya-surface-raised text-left shadow-neu-sm transition ${
        clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:border-hiraya-accent/45' : 'cursor-default'
      }`}
    >
      {/* The garment PHOTO is the point of a recommendation, so it is large. */}
      <div className="flex aspect-[4/5] w-full items-center justify-center bg-hiraya-surface-sunken">
        {src ? (
          <img
            src={src}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
            onError={(e) => {
              e.currentTarget.src = '/images/placeholder.svg';
            }}
          />
        ) : (
          <ShoppingBag size={18} className="text-hiraya-ink-muted" />
        )}
      </div>
      <div className="min-w-0 p-2">
        <p className="line-clamp-2 text-[10.5px] font-semibold leading-snug text-hiraya-ink">{product.name}</p>
        <p className="mt-0.5 text-[10px] text-hiraya-ink-muted">
          {product.price ? <Currency amount={product.price} decimals={false} /> : null}
          {product.in_stock === false ? ' · out of stock' : ''}
        </p>
      </div>
    </button>
  );
};

/*
 * `onClose` and `className` exist for the Studio's side drawer: the drawer
 * passes a close handler (rendered as an × in the header) and a class that
 * lets the panel fill the drawer. Without them the panel renders as before.
 */
const DEFAULT_PANEL =
  'z-10 flex h-[75vh] w-full shrink-0 flex-col overflow-hidden rounded-[24px] bg-hiraya-surface-raised shadow-neu ring-1 ring-cream-50/80 lg:h-auto lg:w-[340px]';

export const StylistChat = ({ messages, isTyping, onSendMessage, onSelectProduct, onNavigate, onClose, className = DEFAULT_PANEL }) => {
  const [inputQuery, setInputQuery] = useState('');
  const listRef = useRef(null);

  /*
   * Keep the newest turn in view by scrolling the MESSAGE LIST, not the page.
   * This used `scrollIntoView` on a sentinel, which also scrolls every
   * scrollable ancestor — on a phone, where the chat sits in the page flow,
   * each reply yanked the whole page down to the chat.
   */
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputQuery.trim()) return;
    onSendMessage(inputQuery);
    setInputQuery('');
  };

  /*
   * The chips + product cards come from the MOST RECENT assistant message, and
   * only while it is the last thing said: once the shopper asks something else,
   * the previous chips are stale and are dropped rather than left clickable.
   */
  const last = messages[messages.length - 1];
  const showSuggestions = !isTyping && last?.role === 'assistant';
  const suggestions = showSuggestions ? last?.suggestions ?? [] : [];
  const products = showSuggestions ? last?.products ?? [] : [];
  const links = showSuggestions ? last?.links ?? [] : [];

  return (
    <aside className={className}>
      <div className="flex items-center justify-between border-b border-hiraya-structure-line px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 text-cream-100 shadow-neu-sm">
            <HirayaMark size={18} />
          </span>
          <span className="text-[11px] font-semibold uppercase leading-snug tracking-[0.16em] text-hiraya-ink">
            AI Stylist &amp; Size Suggester
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5" title="Stylist online">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
          </span>
          {typeof onClose === 'function' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the AI stylist"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-hiraya-ink transition-colors hover:bg-navy-900 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-hiraya-accent/35 bg-hiraya-accent-wash text-hiraya-accent">
                <HirayaMark size={14} />
              </div>
            )}
            {/**
              * THE BUBBLES ARE ROUNDED MESSAGES, NOT CARDS.
              *
              * A chat bubble is one of the few places a generous radius is
              * genuinely correct — it is the conventional shape for a spoken turn
              * — so `rounded-2xl` stays. What changed is the PAINT: the assistant
              * turn was `bg-hiraya-peach/70 ... text-hiraya-on-accent`, i.e.
              * vintage-white ink on a PALE fill, measured ~1.2:1 — every stylist
              * reply was rendering effectively invisible. The assistant bubble is
              * now a raised surface with full ink.
              */}
            <div className={`max-w-[85%] whitespace-pre-line rounded-2xl border p-3 text-[11px] leading-relaxed ${
              msg.role === 'user'
                ? 'self-end rounded-br-md border-hiraya-accent-deep bg-hiraya-accent font-medium text-hiraya-on-accent shadow-[0_8px_16px_-10px_rgba(21,32,54,0.7)]'
                : 'rounded-bl-md border-cream-50/80 bg-hiraya-surface text-hiraya-ink shadow-neu-sm'
            }`}>
              {msg.role === 'assistant' ? renderRich(msg.text) : msg.text}
            </div>
          </div>
        ))}

        {/* Catalog matches for the size just recommended — a shopping surface. */}
        {products.length > 0 && (
          <div className="space-y-1.5 pl-8 animate-fadeIn">
            <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-accent">
              <Sparkles size={10} /> {last?.intent === 'look_analysis' ? 'Completes this look' : 'Recommended for you'}
            </p>
            <div className="-mr-4 flex snap-x gap-2 overflow-x-auto pb-2 pr-4 [scrollbar-width:thin]">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} onSelectProduct={onSelectProduct} />
              ))}
            </div>
          </div>
        )}

        {/*
         * Deep links to the page that owns the full answer.
         *
         * Used for things a chat should not recite: the live per-size stock
         * list, the complete size guide. Rendered as navigation, not as a claim
         * inside the reply, so the customer always sees current numbers.
         */}
        {links.length > 0 && (
          <div className="space-y-1.5 pl-8">
            <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-accent">
              <ArrowUpRight size={10} /> See the full details
            </p>
            {links.map((l) => (
              <button
                key={l.url}
                type="button"
                disabled={typeof onNavigate !== 'function'}
                onClick={() => typeof onNavigate === 'function' && onNavigate(l.url)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border border-hiraya-accent/25 bg-hiraya-accent-wash px-3 py-2 text-left text-[11px] text-hiraya-ink transition ${
                  typeof onNavigate === 'function' ? 'cursor-pointer hover:bg-hiraya-accent/15' : 'cursor-default opacity-70'
                }`}
              >
                <span className="truncate">{l.label}</span>
                <ArrowUpRight size={12} className="shrink-0" />
              </button>
            ))}
          </div>
        )}

        {isTyping && (
          <div className="flex items-center gap-2 text-[10px] italic text-hiraya-ink-muted">
            <Loader2 size={12} className="animate-spin text-hiraya-accent" /> Hiraya stylist is calculating your fit…
          </div>
        )}
      </div>

      {/* Quick-reply chips — the fastest path from question to answer. */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-hiraya-structure-line px-3 pt-2.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSendMessage(s)}
              className="cursor-pointer rounded-full border border-cream-50/80 bg-hiraya-surface px-3 py-1.5 text-[10px] font-medium text-hiraya-accent shadow-neu-sm transition hover:bg-hiraya-accent hover:text-hiraya-on-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-hiraya-structure-line p-3">
        <input
          type="text"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          placeholder="Ask AI about fit, sizing, or styling..."
          aria-label="Message the AI stylist"
          className="field flex-1 rounded-full px-4 py-2.5 text-xs"
        />
        <button type="submit" aria-label="Send message" className="btn-primary h-10 w-10 shrink-0 cursor-pointer rounded-full p-0">
          <Send size={14} />
        </button>
      </form>
    </aside>
  );
};

HirayaMark.propTypes = {
  size: PropTypes.number,
  className: PropTypes.string,
};

ProductCard.propTypes = {
  product: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    name: PropTypes.string,
    category: PropTypes.string,
    price: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    image_url: PropTypes.string,
    in_stock: PropTypes.bool,
  }).isRequired,
  onSelectProduct: PropTypes.func,
};

StylistChat.propTypes = {
  messages: PropTypes.arrayOf(
    PropTypes.shape({
      role: PropTypes.string,
      text: PropTypes.string,
      suggestions: PropTypes.array,
      products: PropTypes.array,
      links: PropTypes.array,
      intent: PropTypes.string,
    })
  ).isRequired,
  isTyping: PropTypes.bool,
  onSendMessage: PropTypes.func.isRequired,
  onSelectProduct: PropTypes.func,
  onNavigate: PropTypes.func,
  onClose: PropTypes.func,
  className: PropTypes.string,
};

export default StylistChat;