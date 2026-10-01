/**
 * SkeletonLoader — the soft, pulsing placeholder used while real content loads.
 *
 * WHY IT EXISTS
 * -------------
 * A spinner tells the customer "something is happening"; a skeleton tells them
 * WHAT is coming. On a product grid the difference matters: the page keeps its
 * final shape, so nothing jumps when the data lands, and the wait reads as
 * "loading this card" rather than "the app is thinking".
 *
 * The pulse is Tailwind's `animate-pulse` on a LIGHT GREY fill, per spec, so the
 * animation is a gentle opacity breath rather than a hard shimmer — it stays
 * quiet behind text and never competes with the brand accent.
 *
 * LIGHT GREY — A TRUE NEUTRAL, ON PURPOSE.
 * ---------------------------------------
 * The spec asks for a LIGHT GREY skeleton, so these blocks are genuinely grey
 * (`gray-200` / `gray-300`), not a palette tint. A placeholder is a deliberate
 * EXCEPTION to the brand palette: it must read as "content is missing here", and
 * a warm cream or sage block reads as "a surface exists here" — which is exactly
 * the wrong message while loading.
 *
 * It stays legible against every surface in the system because the CARD it sits
 * on is always the light one (vintage white or the raised parchment), and neutral
 * grey is unambiguous against both.
 *
 * WHAT WAS WRONG BEFORE
 * --------------------
 * The card carried `bg-hiraya-cream-deep` — the SAME value as the `hiraya-surface`
 * token, i.e. the identical colour the real ProductCard paints — plus
 * `border-hiraya-olive/15` (the retired indigo hairline) and
 * `shadow-lg shadow-hiraya-navy/25/30`, a malformed arbitrary shadow whose alpha
 * segment (`25/30`) is not something Tailwind can parse, so it silently emitted
 * nothing. It now uses the real `.card` primitive and the obsidian image well the
 * loaded card uses, so the swap does not shift a pixel.
 *
 * SHAPES
 * ------
 * The base `Skeleton` is a single grey block. The composed exports below mirror
 * the layouts actually used in the app:
 *
 *   <SkeletonProductCard />  image block + title line + two text lines
 *   <SkeletonProductGrid />  a 4-up row of the above
 *
 * Every block is `aria-hidden` and the wrapper announces itself once with
 * `role="status"`, so a screen reader hears "Loading”¦" instead of reading a
 * dozen meaningless grey boxes.
 */

const cx = (...parts) => parts.filter(Boolean).join(' ');

/**
 * The single grey block every skeleton is built from.
 *
 * @param {Object} props
 * @param {string} [props.className] Tailwind sizing/rounding for this block.
 */
export const Skeleton = ({ className = '' }) => (
  <div
    aria-hidden="true"
    className={cx('animate-pulse rounded-sm bg-gray-200', className)}
  />
);

/**
 * A product-card skeleton: image placeholder, title, and two lines of text —
 * the exact anatomy of `<ProductCard>` in this app, on the same `.card` surface
 * and with the same obsidian image well.
 */
export const SkeletonProductCard = ({ count = 1, className = '' }) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        role="status"
        aria-label="Loading content"
        className={cx('card animate-pulse overflow-hidden', className)}
      >
        {/* IMAGE PLACEHOLDER — the obsidian well the real card uses, so the grid
            does not change tone when the images arrive. */}
        <div className="h-72 w-full bg-black/85" />

        {/* DETAILS — title + two text lines, matching the real card rhythm. */}
        <div className="space-y-2.5 px-4 py-4">
          <div className="h-4 w-3/4 rounded-sm bg-gray-300" />
          <div className="h-3 w-full rounded-sm bg-gray-200" />
          <div className="h-3 w-5/6 rounded-sm bg-gray-200" />

          <div className="flex items-center justify-between border-t border-hiraya-structure-line pt-3">
            <div className="h-4 w-20 rounded-sm bg-gray-300" />
            <div className="h-3 w-12 rounded-sm bg-gray-200" />
          </div>
        </div>
      </div>
    ))}
  </>
);

/**
 * A grid of product skeletons — drop-in for a collection row while it loads.
 */
export const SkeletonProductGrid = ({ count = 4, className = '' }) => (
  <div
    className={cx(
      'grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4',
      className
    )}
  >
    <SkeletonProductCard count={count} />
  </div>
);

/**
 * A generic content skeleton: a heading block plus a few text lines. Used for
 * panels that are not product cards (dashboards, detail panes, list rows).
 */
export const SkeletonText = ({ lines = 2, className = '' }) => (
  <div role="status" aria-label="Loading content" className={cx('space-y-2.5', className)}>
    <div className="h-4 w-1/2 animate-pulse rounded-sm bg-gray-300" />
    {Array.from({ length: lines }).map((_, i) => (
      <div
        key={i}
        className={cx(
          'h-3 animate-pulse rounded-sm bg-gray-200',
          i === lines - 1 ? 'w-4/5' : 'w-full'
        )}
      />
    ))}
  </div>
);

export default SkeletonProductCard;