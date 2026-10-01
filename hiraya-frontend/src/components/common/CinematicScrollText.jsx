import { useLayoutEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/*
 * ============================================================================
 * CINEMATIC SCROLL TEXT
 * ============================================================================
 *
 * WHAT IT IS
 * ---------
 * A block of display copy that is scrubbed by the scrollbar rather than played
 * once on enter. Every word rises, blurs and dims as the block passes through the
 * viewport, so the paragraph reads as a camera move down the page instead of a
 * paragraph that appeared.
 *
 * WHY THE WORDS ARE SPLIT
 * ------------------------
 * Word-by-word is the whole effect. A line-level or block-level reveal can only
 * translate as a unit, which reads as a slide; only per-WORD motion produces the
 * staggered "type arriving" cadence that makes the text feel alive. The split is
 * done in JS (from a plain text prop) rather than with a markup-splitting library
 * so this component has no dependencies beyond the GSAP already used by
 * `GuestHero`.
 *
 * WHY THE TIMELINE IS PAUSED AND SCRUBBED
 * ---------------------------------------
 * One paused timeline, whose progress is bound to the scrollbar via
 * ScrollTrigger with `scrub: 1`. Consequences that matter:
 *
 *   - Scrolling UP runs the exact same tweens backwards. There is no second
 *     "reverse" animation to keep in sync with the forward one, so the two can
 *     never drift apart.
 *   - The text is a pure function of scroll position. A user who lands mid-page
 *     sees the correct mid-animation state rather than a blank block waiting
 *     for a trigger that already fired.
 *
 * REDUCED MOTION
 * --------------
 * `prefers-reduced-motion: reduce` skips the ScrollTrigger entirely and clears
 * every transform, so the copy rests fully visible. The worst case is a plain
 * static paragraph — never invisible text.
 *
 * TEARDOWN
 * --------
 * The timeline is built inside `gsap.context()`, which registers every tween and
 * ScrollTrigger created in the callback and reverts them together on unmount.
 * That is what prevents a pinned trigger or an orphaned scrub from surviving a
 * route change.
 */

gsap.registerPlugin(ScrollTrigger);

/**
 * Splits a string into word spans, preserving the spaces between them.
 * Words are `inline-block` so each can be transformed independently; the
 * whitespace between them stays as real text so the line still wraps and
 * still reads correctly to a screen reader and to find-in-page.
 */
const splitWords = (text) =>
    text.split(' ').map((word, index, all) => (
        <span key={`${word}-${index}`} className="inline-block whitespace-pre">
            {word}
            {index < all.length - 1 ? ' ' : ''}
        </span>
    ));

/**
 * @param {object}  props
 * @param {string}  props.text       The paragraph to animate. Plain text only —
 *                                    it is split into words here.
 * @param {'lead'|'sub'|'display'} [props.variant]
 *                                    `lead` (default) is body copy, `sub` is a
 *                                    larger supporting line, `display` is a
 *                                    heading-scale line. Only the type scale and
 *                                    colour change — the motion is identical.
 * @param {string}  [props.className] Extra classes on the wrapper.
 * @param {number}  [props.start]    ScrollTrigger start, e.g. 'top 85%'.
 * @param {number}  [props.end]      ScrollTrigger end. Defaults to 'bottom top',
 *                                    i.e. the text is fully revealed by the time
 *                                    it has scrolled past the top edge.
 */
const CinematicScrollText = ({
    text,
    variant = 'lead',
    className = '',
    start = 'top 88%',
    end = 'bottom top',
}) => {
    const rootRef = useRef(null);
    const wordsRef = useRef(null);

    useLayoutEffect(() => {
        const root = rootRef.current;
        const words = wordsRef.current;
        if (!root || !words) return undefined;

        const prefersReduced =
            typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        const ctx = gsap.context(() => {
            const wordNodes = words.querySelectorAll('span');

            if (prefersReduced) {
                gsap.set(wordNodes, { clearProps: 'all' });
                return;
            }

            /*
             * INITIAL STATE — set in JS, not CSS.
             *
             * If the "hidden" state lived in a stylesheet, it would apply during
             * the first paint too, which means a slow first frame briefly shows
             * the paragraph blurred and offset. Setting it here (which runs
             * before paint, in a layout effect) makes the very first visible
             * frame already match the timeline's t=0.
             */
            gsap.set(wordNodes, {
                opacity: 0,
                yPercent: 60,
                filter: 'blur(6px)',
            });

            const tl = gsap.timeline({
                defaults: { ease: 'none' },
                scrollTrigger: {
                    trigger: root,
                    start,
                    end,
                    scrub: 1,
                    /*
                     * `once: false` (the default) is required, not incidental:
                     * this text must be able to REPLAY on the way back up, which
                     * is what makes the effect reversible rather than a one-shot.
                     */
                    invalidateOnRefresh: true,
                },
            });

            /*
             * The stagger is what turns a uniform fade into a travelling wave.
             * Each word's own tween occupies 0.6 of the timeline and is offset
             * progressively, so word 1 starts at 0, the last word starts at 0.4
             * and all of them are finished by 1.0.
             */
            tl.to(
                wordNodes,
                {
                    opacity: 1,
                    yPercent: 0,
                    filter: 'blur(0px)',
                    duration: 0.6,
                    stagger: 0.4 / Math.max(wordNodes.length - 1, 1),
                },
                0
            );

            /*
             * THE DEPARTURE. After the words have all landed, the block keeps
             * travelling up and dims as it leaves — so a long paragraph does not
             * just sit there fully opaque after its entrance. The opacity stops
             * at 0.15 rather than 0: the text is still readable as a ghost rather
             * than vanishing outright, which keeps the page from flickering
             * between "full paragraph" and "nothing" at the boundary.
             */
            tl.to(
                words,
                { yPercent: -22, opacity: 0.15, duration: 0.4 },
                0.6
            );

            // Keep the measured trigger distance honest across resize / rotate.
            const onResize = () => ScrollTrigger.refresh();
            window.addEventListener('resize', onResize);
            root.__hirayaResize = onResize;
        }, root);

        return () => {
            if (root?.__hirayaResize) {
                window.removeEventListener('resize', root.__hirayaResize);
                delete root.__hirayaResize;
            }
            ctx.revert();
        };
    }, [start, end]);

    const VARIANT_CLASS = {
        lead: 'text-sm leading-relaxed text-hiraya-ink-soft md:text-base',
        sub: 'text-lg leading-snug text-hiraya-ink md:text-2xl',
        display: 'display-lg text-hiraya-ink',
    };

    return (
        <p
            ref={rootRef}
            className={`max-w-2xl ${VARIANT_CLASS[variant] || VARIANT_CLASS.lead} ${className}`}
        >
            {/*
             * `inline-block` is REQUIRED here, not cosmetic. This span is the
             * element the departure tween translates, and a transform on an
             * `inline` box is simply dropped by the layout engine — the whole
             * exit move would silently do nothing while still costing a scroll
             * listener.
             */}
            <span ref={wordsRef} className="inline-block">
                {splitWords(text)}
            </span>
        </p>
    );
};

export default CinematicScrollText;

/*
 * `text` is required because the component has nothing to render without it —
 * an empty string would produce a ScrollTrigger measuring a zero-height
 * paragraph, which is a valid-looking trigger that never fires.
 */
CinematicScrollText.propTypes = {
    text: PropTypes.string.isRequired,
    variant: PropTypes.oneOf(['lead', 'sub', 'display']),
    className: PropTypes.string,
    start: PropTypes.string,
    end: PropTypes.string,
};
CinematicScrollText.defaultProps = {
    variant: 'lead',
    className: '',
    start: 'top 88%',
    end: 'bottom top',
};

