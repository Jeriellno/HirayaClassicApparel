import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { Link2, ArrowRight } from 'lucide-react';
import { getProductImageUrl } from '../../utils/imageHelper';
import { formatPeso } from '../common/Currency';

/**
 * COMPLETE THE LOOK — the customer half of garment pairing.
 *
 * Shows the pieces an admin paired with this product in the Inventory form
 * (a polo's coat, a top's trousers). Each card opens that piece's page, where
 * the customer picks a size and adds it to the bag; once both pieces are in
 * the bag, the try-on Style Stack offers to wear them together.
 *
 * Renders nothing when the product has no pairs, so unpaired products look
 * exactly as before.
 */
const CompleteTheLook = ({ pairs = [] }) => {
  const navigate = useNavigate();
  if (!Array.isArray(pairs) || pairs.length === 0) return null;

  return (
    <section className="mt-12" aria-labelledby="complete-the-look-title">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-hiraya-ink-muted">
            <Link2 size={12} /> Paired by our stylists
          </p>
          <h2 id="complete-the-look-title" className="mt-1 font-serif text-2xl uppercase tracking-[0.05em] text-hiraya-ink">
            Complete the Look
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {pairs.map((pair) => {
          const raw = pair.display_image_url || pair.image_url;
          const soldOut = Number(pair.stock) <= 0;
          return (
            <button
              key={pair.id}
              type="button"
              onClick={() => navigate(`/product/${pair.id}`)}
              className="card group flex cursor-pointer flex-col overflow-hidden p-0 text-left transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-accent"
            >
              <div className="aspect-[3/4] w-full overflow-hidden bg-cream-200">
                <img
                  src={raw ? getProductImageUrl(raw) : '/images/placeholder.svg'}
                  alt={pair.name}
                  loading="lazy"
                  className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = '/images/placeholder.svg';
                  }}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <span className="text-[9px] uppercase tracking-[0.18em] text-hiraya-ink-muted">
                  {String(pair.category || '').replace(/_/g, ' ')}
                </span>
                <span className="line-clamp-2 text-sm font-semibold text-hiraya-ink">{pair.name}</span>
                <span className="mt-auto flex items-center justify-between pt-1 text-xs">
                  <span className="font-semibold tabular-nums text-hiraya-ink">
                    {soldOut ? 'Sold out' : formatPeso(pair.price)}
                  </span>
                  <ArrowRight size={14} className="text-hiraya-accent transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};

CompleteTheLook.propTypes = {
  pairs: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
      name: PropTypes.string,
      price: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      category: PropTypes.string,
      stock: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      image_url: PropTypes.string,
      display_image_url: PropTypes.string,
    })
  ),
};

export default CompleteTheLook;
