/**
 * StyleStackGarmentCard — one garment tile inside a categorical Style Stack row.
 *
 * RENDERS THE GARMENT PHOTO DIRECTLY — no in-browser AI processing at all.
 *
 * This card used to run `@imgly/background-removal` on every tile. That engine
 * needed a ~95 MB model download AND threw an unrecoverable
 *
 *   TypeError: Cannot read properties of undefined (reading 'startTime')
 *
 * out of its own animation-frame callback — which crashed the entire Studio
 * render tree (the whole page went blank). The cut-out is the ADMIN PIPELINE's
 * job (`display_image_url`), so this tile simply paints the image it was given:
 * instant, offline, and crash-free.
 */
import { Check, Lock } from 'lucide-react';

const StyleStackGarmentCard = ({ garment, isSelected, onToggle, disabled = false, disabledReason = null }) => {
  // Prefer the prepared catalog cut-out, fall back to the raw photo.
  const image = garment?.display_image_url || garment?.image_url;

  if (!garment) return null;

  return (
    <button
      type="button"
      onClick={() => !disabled && onToggle?.(garment)}
      disabled={disabled}
      aria-pressed={isSelected}
      /*
       * The reason a tile is unavailable is CALLER-SUPPLIED when the row is
       * blocked by the dress rule, because the default copy ("Upload a body photo
       * first") would be wrong and misleading in that case — the photo is already
       * uploaded, the garment just cannot coexist with what is worn.
       */
      title={disabled ? (disabledReason || 'Upload a body photo first') : garment.name}
      className={[
        'group relative flex h-[168px] w-[132px] shrink-0 flex-col items-center justify-between',
        'overflow-hidden rounded-2xl border p-2.5 text-left transition-all duration-300',
        isSelected
          ? 'border-[#E9C46A] bg-[#E9C46A]/10 shadow-[0_0_22px_rgba(233,196,106,0.35)]'
          : 'border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-black/80 hover:border-[#E9C46A]/50',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      ].join(' ')}
    >
      {/* Tier badge — names WHICH feed tile came from, so a recommended
          piece is never mistaken for something already in the bag. The old
          'Saved' tier is gone with the wishlist; only bag + recommended remain. */}
      {garment.source && (
        <span
          className={[
            'absolute left-2 top-2 z-10 rounded-full border px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider',
            garment.source === 'bag'
              ? 'border-[#E9C46A]/40 bg-[#E9C46A]/15 text-[#E9C46A]'
              : 'border-sky-400/40 bg-sky-400/10 text-sky-300',
          ].join(' ')}
        >
          {garment.source === 'bag' ? 'Bag' : 'For You'}
        </span>
      )}

      {/* Selected check */}
      {isSelected && (
        <div className="absolute -right-1.5 -top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#E9C46A] text-black shadow-lg shadow-[#E9C46A]/25">
          <Check size={13} strokeWidth={3} />
        </div>
      )}

      {/* Locked state — shown while no body photo has been uploaded yet. */}
      {disabled && (
        <div className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-zinc-400">
          <Lock size={10} />
        </div>
      )}

      {/* Garment image — painted straight from the catalog asset. */}
      <div className="relative mt-4 flex w-full flex-1 items-center justify-center">
        <img
          src={image}
          alt={garment.name}
          draggable={false}
          loading="lazy"
          className="max-h-full max-w-full object-contain drop-shadow-lg transition-transform duration-300 group-hover:scale-105"
          style={{ backgroundColor: 'transparent' }}
        />
      </div>

      {/* Label + price */}
      <div className="w-full text-center">
        <p className="truncate text-[10px] font-bold text-zinc-200">{garment.name}</p>
        <p className="mt-0.5 text-[9px] uppercase tracking-widest text-zinc-500">
          {garment.selected_size || 'Size —'} · {garment.selected_color || 'Colour —'}
        </p>
        <p className="mt-0.5 text-[10px] font-extrabold text-[#E9C46A]">
          ₱{Number(garment.price || 0).toLocaleString()}
        </p>
      </div>
    </button>
  );
};

export default StyleStackGarmentCard;
