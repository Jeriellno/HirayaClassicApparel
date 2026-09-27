import { useMemo, useState } from 'react';
import { Compass, X } from 'lucide-react';
import { startWalkthrough } from '../../lib/walkthrough';

/**
 * TourButton — the launcher for the spotlight walkthrough.
 *
 * WHY IT EXISTS
 * -------------
 * The walkthrough engine (src/lib/walkthrough.js) is framework-free on purpose:
 * it manipulates plain DOM, so it needs no portal, no context and no re-render
 * to work. React's only job is the BUTTON that starts it and the dismissal state
 * for the small hint card.
 *
 * The steps are resolved at CLICK TIME, not at mount, because the sections they
 * point at can appear or disappear with the data (the spotlight row is only
 * rendered once products load). Querying late means the tour always targets
 * something that exists; `walkthrough.js` skips any step whose target is missing.
 */
const TourButton = () => {
  const [dismissedHint, setDismissedHint] = useState(false);

  const steps = useMemo(
    () => [
      {
        element: '[data-tour="hero"]',
        placement: 'bottom',
        title: 'Welcome to Hiraya',
        text: 'This is your virtual fitting room. Let us point out the three things you will use most.',
      },
      {
        element: '[data-tour="browse"]',
        placement: 'right',
        title: 'Browse the collection',
        text: 'Every garment here can be worn in the fitting studio — tops, bottoms, footwear and full outfits.',
      },
      {
        element: '[data-tour="studio-cta"]',
        placement: 'bottom',
        title: 'Open the AI fitting studio',
        text: 'Upload one full-body photo, pick your garments, and see the fit rendered on your own frame.',
      },
      {
        element: '[data-tour="spotlight"]',
        placement: 'top',
        title: 'Picked for you',
        text: 'Once you save your measurements, this row highlights the pieces that fit you best.',
      },
    ],
    []
  );

  const start = () => {
    startWalkthrough(steps, {
      padding: 10,
      onFinish: () => setDismissedHint(true),
      onClose: () => setDismissedHint(true),
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        data-tour="tour-launcher"
        className="fixed bottom-6 right-6 z-[70] flex items-center gap-2 rounded-full border border-hiraya-olive/15 bg-hiraya-cream/90 px-5 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFE8D6] shadow-2xl backdrop-blur-md transition-colors hover:border-[#CB997E]/50 hover:text-hiraya-ink cursor-pointer"
      >
        <Compass size={14} /> Take a tour
      </button>

      {/*
        * A quiet one-line hint, shown once per visit, so the tour is discoverable
        * without a modal demanding attention. Dismissing it hides it for the
        * session; the launcher above stays available either way.
        */}
      {!dismissedHint && (
        <div className="fixed bottom-6 right-6 z-[69] hidden w-72 translate-y-[-4.5rem] rounded-2xl border border-hiraya-olive/15 bg-hiraya-cream p-4 pr-9 text-[11px] leading-relaxed text-[#A5A58D] shadow-2xl md:block">
          New here? The tour walks you through the studio in four steps.
          <button
            type="button"
            onClick={() => setDismissedHint(true)}
            aria-label="Dismiss the tour hint"
            className="absolute right-3 top-3 text-hiraya-sand transition-colors hover:text-hiraya-ink cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </>
  );
};

export default TourButton;