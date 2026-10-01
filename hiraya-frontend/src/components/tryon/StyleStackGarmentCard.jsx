/**
 * StyleStackGarmentCard — one garment in the My Bag showcase.
 *
 * NO IN-BROWSER ML. This card used to run `@imgly/background-removal`, which
 * needed a ~95 MB model and threw an uncaught `startTime` TypeError that
 * blanked the whole Studio. It now uses the small canvas cut-out in
 * utils/garmentCutout.js (shared with the Shop, cached per image): the
 * catalogue card's flat background is keyed away so the garment stands on the
 * tile's own vitrine. If an image is not a flat card, the original is shown.
 *
 * Behaviour is unchanged: the tile toggles the garment on the canvas, is
 * disabled while locked or excluded by the dress rule, and names the reason.
 */
import PropTypes from 'prop-types';
import { Check, Lock } from 'lucide-react';
import Currency from '../common/Currency';
import { useFloatingCutouts } from '../../hooks/useFloatingCutouts';

const StyleStackGarmentCard = ({ garment, isSelected, onToggle, disabled = false, disabledReason = null }) => {
  // Prefer the prepared catalog asset, fall back to the raw photo.
  const image = garment?.display_image_url || garment?.image_url;
  const cutouts = useFloatingCutouts(image ? [image] : []);
  const cutout = image ? cutouts[image] : null;

  if (!garment) return null;

  return (
    <button
      type="button"
      onClick={() => !disabled && onToggle?.(garment)}
      disabled={disabled}
      aria-pressed={isSelected}
      /*
       * The reason a tile is unavailable is CALLER-SUPPLIED when the row is
       * blocked by the dress rule, because the default copy would be wrong
       * there — the photo is already uploaded, the garment just cannot
       * coexist with what is worn.
       */
      title={disabled ? (disabledReason || 'Upload a body photo first') : garment.name}
      /*
       * A SHOWCASE TILE. A worn piece INVERTS to navy with cream type, so the
       * outfit on the canvas can be read straight off the shelf; everything
       * else is a raised cream tile whose garment lifts on hover.
       */
      className={[
        'group relative flex h-[184px] w-[134px] shrink-0 flex-col rounded-[22px] p-2 text-left transition-[translate,box-shadow,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus',
        isSelected
          ? 'bg-navy-900 text-cream-100 shadow-[0_18px_30px_-18px_rgba(13,21,36,0.9)] ring-1 ring-navy-700'
          : 'bg-hiraya-surface text-hiraya-ink shadow-neu-sm ring-1 ring-cream-50/80 hover:-translate-y-1 hover:shadow-neu',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
      ].join(' ')}
    >
      {/* The vitrine: a pressed-in well with a lamp-light above the piece. */}
      <span
        className={[
          'relative flex w-full flex-1 items-center justify-center overflow-hidden rounded-[16px]',
          isSelected
            ? 'bg-[radial-gradient(90%_70%_at_50%_20%,#364A6A_0%,#1D2C45_60%,#152036_100%)]'
            : 'bg-[radial-gradient(90%_70%_at_50%_20%,#FCFAF5_0%,#EFE6D2_100%)] shadow-neu-inset',
        ].join(' ')}
      >
        {/* Tier badge — bag piece or recommendation, never confused. */}
        {garment.source && (
          <span
            className={[
              'absolute left-1.5 top-1.5 z-10 rounded-full px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-[0.14em]',
              garment.source === 'bag'
                ? isSelected ? 'bg-cream-100/15 text-cream-100' : 'bg-navy-900/8 text-navy-800'
                : 'bg-cream-400/30 text-navy-900',
            ].join(' ')}
          >
            {garment.source === 'bag' ? 'Bag' : 'For You'}
          </span>
        )}

        {/* Worn / locked status marks. */}
        {isSelected && (
          <span className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-cream-100 text-navy-900">
            <Check size={11} strokeWidth={3} />
          </span>
        )}
        {disabled && (
          <span className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-hiraya-disabled-bg text-hiraya-disabled-ink">
            <Lock size={10} />
          </span>
        )}

        {/* The ground shadow under the lifted piece. */}
        <span
          aria-hidden="true"
          className={`absolute bottom-2 left-1/2 h-2.5 w-3/5 -translate-x-1/2 rounded-[50%] blur-[5px] transition-[transform,opacity] duration-300 group-hover:scale-x-90 group-hover:opacity-60 ${
            isSelected ? 'bg-black/45' : 'bg-navy-950/20'
          }`}
        />

        {cutout === undefined ? (
          <span aria-hidden="true" className="h-3/5 w-1/2 animate-pulse rounded-[40%] bg-cream-300/50 blur-md" />
        ) : (
          <img
            src={cutout ? cutout.src : image}
            alt={garment.name}
            draggable={false}
            loading="lazy"
            className={[
              'relative max-h-[86%] max-w-[86%] object-contain transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1 group-hover:scale-[1.05]',
              cutout ? 'drop-shadow-[0_10px_10px_rgba(13,21,36,0.25)]' : 'rounded-lg',
            ].join(' ')}
          />
        )}
      </span>

      {/* Label + size/colour + price */}
      <span className="block w-full px-1 pb-0.5 pt-2 text-center">
        <span className="block truncate text-[10px] font-semibold">{garment.name}</span>
        <span className={`mt-0.5 block text-[8.5px] uppercase tracking-[0.14em] ${isSelected ? 'text-cream-300' : 'text-hiraya-ink-muted'}`}>
          {garment.selected_size || 'Size —'} · {garment.selected_color || 'Colour —'}
        </span>
        <Currency amount={garment.price || 0} decimals={false} className="mt-0.5 block text-[10px] font-semibold" />
      </span>
    </button>
  );
};

StyleStackGarmentCard.propTypes = {
  garment: PropTypes.shape({
    name: PropTypes.string,
    price: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    source: PropTypes.string,
    display_image_url: PropTypes.string,
    image_url: PropTypes.string,
    selected_size: PropTypes.string,
    selected_color: PropTypes.string,
  }),
  isSelected: PropTypes.bool,
  onToggle: PropTypes.func,
  disabled: PropTypes.bool,
  disabledReason: PropTypes.string,
};

export default StyleStackGarmentCard;
