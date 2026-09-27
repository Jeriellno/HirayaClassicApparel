import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Sparkles, ShoppingBag, ArrowUpRight } from 'lucide-react';
import logoImg from '../../assets/logo.png';

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

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onSelectProduct(product)}
      className={`w-full flex items-center gap-2 rounded-xl border-hiraya-olive/15 bg-hiraya-cream/60 p-2 text-left transition ${
        clickable ? 'hover:border-[#CB997E]/40 hover:bg-hiraya-cream/60' : 'cursor-default'
      }`}
    >
      {product.image_url ? (
        <img
          src={product.image_url}
          alt={product.name}
          className="h-10 w-10 shrink-0 rounded-lg object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-hiraya-cream/60">
          <ShoppingBag size={14} className="text-hiraya-sand" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-hiraya-ink">{product.name}</p>
        <p className="text-[10px] text-hiraya-sand">
          {product.category}
          {product.price ? ` · ₱${Number(product.price).toLocaleString()}` : ''}
          {product.in_stock === false ? ' · out of stock' : ''}
        </p>
      </div>
    </button>
  );
};

export const StylistChat = ({ messages, isTyping, onSendMessage, onSelectProduct, onNavigate }) => {
  const [inputQuery, setInputQuery] = useState('');
  const chatBottomRef = useRef(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    <aside className="w-[340px] border-l border-hiraya-olive/15 bg-hiraya-cream/50 backdrop-blur-2xl flex flex-col z-10 shrink-0">
      <div className="p-4 border-b border-hiraya-olive/15 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HirayaMark size={18} />
          <span className="text-xs font-black uppercase tracking-[0.2em] text-hiraya-ink">
            AI Stylist &amp; Size Suggester
          </span>
        </div>
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      </div>

      <div className="flex-1 p-4 space-y-3 overflow-y-auto">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-[#CB997E]/20 border border-[#CB997E]/40 text-hiraya-ink flex items-center justify-center shrink-0 mt-1">
                <HirayaMark size={14} />
              </div>
            )}
            <div className={`p-3 rounded-2xl text-[11px] leading-relaxed border max-w-[85%] whitespace-pre-line ${
              msg.role === 'user'
                ? 'bg-[#CB997E] text-hiraya-olive border-[#CB997E] font-medium self-end'
                : 'bg-hiraya-cream/60 text-hiraya-ink border-hiraya-olive/15'
            }`}>
              {msg.role === 'assistant' ? renderRich(msg.text) : msg.text}
            </div>
          </div>
        ))}

        {/* Catalog matches for the size just recommended — a shopping surface. */}
        {products.length > 0 && (
          <div className="space-y-1.5 pl-8">
            <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.2em] text-hiraya-olive/70">
              <Sparkles size={10} /> Available in your size
            </p>
            {products.map((p) => (
              <ProductCard key={p.id} product={p} onSelectProduct={onSelectProduct} />
            ))}
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
            <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.2em] text-hiraya-olive/70">
              <ArrowUpRight size={10} /> See the full details
            </p>
            {links.map((l) => (
              <button
                key={l.url}
                type="button"
                disabled={typeof onNavigate !== 'function'}
                onClick={() => typeof onNavigate === 'function' && onNavigate(l.url)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border-[#CB997E]/20 bg-[#CB997E]/5 px-3 py-2 text-left text-[11px] text-hiraya-ink transition ${
                  typeof onNavigate === 'function' ? 'hover:bg-[#CB997E]/15' : 'cursor-default opacity-70'
                }`}
              >
                <span className="truncate">{l.label}</span>
                <ArrowUpRight size={12} className="shrink-0" />
              </button>
            ))}
          </div>
        )}

        {isTyping && (
          <div className="flex items-center gap-2 text-hiraya-sand text-[10px] italic">
            <Loader2 size={12} className="animate-spin text-hiraya-ink" /> Hiraya stylist is calculating your fit…
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* Quick-reply chips — the fastest path from question to answer. */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-hiraya-olive/15 px-3 pt-2.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSendMessage(s)}
              className="rounded-full border-[#CB997E]/30 bg-[#CB997E]/10 px-2.5 py-1 text-[10px] text-hiraya-ink transition hover:bg-[#CB997E]/20"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-3 border-t border-hiraya-olive/15 flex gap-2">
        <input
          type="text"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          placeholder="Ask AI about fit, sizing, or styling..."
          className="flex-1 bg-hiraya-cream/60 border border-hiraya-olive/15 rounded-xl px-3 py-2 text-xs text-hiraya-ink outline-none focus:border-[#CB997E]"
        />
        <button type="submit" className="p-2 bg-[#CB997E] text-hiraya-ink rounded-xl hover:bg-hiraya-cream-deep transition font-bold">
          <Send size={14} />
        </button>
      </form>
    </aside>
  );
};

export default StylistChat;