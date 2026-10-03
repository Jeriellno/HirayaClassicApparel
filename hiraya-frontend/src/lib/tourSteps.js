/*
 * ============================================================================
 * TOUR STEP REGISTRY — one guide per page, sized by what the page really shows
 * ============================================================================
 *
 * NO PAGE HAS A FIXED NUMBER OF STEPS
 * -----------------------------------
 * Each list below names EVERY control on its page that is worth explaining. The
 * engine (lib/walkthrough.js) then resolves the list against the live DOM when
 * the tour starts and keeps only the steps whose component is actually on
 * screen — an empty bag has no summary, a studio with no photo has no generate
 * button, a closed drawer is not highlighted. The "01 / 05" counter and the
 * progress segments are built from what survives, so the Shop guide can be
 * five stops on a wide screen and four while the catalogue is still loading.
 *
 * WHY STEPS ARE KEYED BY ROUTE
 * -----------------------------
 * Each entry in `TOUR_ROUTES` declares the route it belongs to, a short label
 * for the card header, and one list per audience. A page with no `guest` list
 * simply has no tour for signed-out visitors — most signed-in surfaces (the
 * bag, the studio, the measurements form) are walls to a guest, and a tour
 * that walks toward a wall is worse than none.
 *
 * AUDIENCE-SPECIFIC COPY
 * ----------------------
 * Public pages share one list between audiences. A step can carry `guestText`
 * when the control behaves differently for a visitor (every "Add to Bag" sends
 * a guest to Sign In first), so the guide never promises something the button
 * will not do.
 *
 * EVERY CONTROL NAMED HERE MUST EXIST
 * -----------------------------------
 * Each step describes one real control, in the words the UI itself uses. When
 * a control is renamed, the step beside it must be renamed too. Anchors are
 * plain `data-tour="…"` attributes on the component itself.
 */

const anchor = (name) => `[data-tour="${name}"]`;

/* -------------------------------------------------------------- HOME */

/**
 * Home — the GUEST landing page. `Home.jsx` returns `<GuestHome />` for a
 * signed-out visitor, so none of the member anchors exist for them.
 */
const GUEST_HOME_STEPS = [
    {
        element: anchor('guest-hero'),
        placement: 'bottom',
        title: 'Welcome to Hiraya',
        text: 'A virtual fitting room: you upload one photo, choose garments, and see the fit rendered on your own frame before you buy anything.',
    },
    {
        element: anchor('guest-intro'),
        placement: 'top',
        title: 'How it works',
        text: 'Three steps, in the order you will actually perform them — browse, upload, and see the fit. No account needed to read this page.',
    },
    {
        element: anchor('guest-account'),
        placement: 'top',
        title: 'What an account adds',
        text: 'The fitting studio itself, plus your saved measurements and a wardrobe stack you can re-render later. Browsing stays open to everyone.',
    },
    {
        element: anchor('guest-cta'),
        placement: 'top',
        title: 'Create an account',
        text: 'This is the only step that needs one. Everything above it you can already do.',
    },
];

/** Home — the member dashboard. */
const MEMBER_HOME_STEPS = [
    {
        element: anchor('member-greeting'),
        placement: 'bottom',
        title: 'Your atelier',
        text: 'A personal greeting and the state of your fitting room at a glance — what is in your bag and whether your sizing profile is complete.',
    },
    {
        element: anchor('home-shortcuts'),
        placement: 'bottom',
        title: 'Shortcuts',
        text: 'The four places members go most: the AI Studio, the Shop, your Bag and your try-on Gallery. One tap each.',
    },
    {
        element: anchor('studio-cta'),
        placement: 'auto',
        title: 'Open the AI Studio',
        text: 'One button, and it tells you what is still missing. A body photo, a garment, and your core measurements are all the studio needs before it can render.',
    },
    {
        element: anchor('rail-picks'),
        placement: 'top',
        title: 'Picked for you',
        text: 'Save your measurements and this rail fills with pieces that match your size, each with its fit badge. Scroll it sideways; each card opens the piece.',
    },
    {
        element: anchor('rail-new'),
        placement: 'top',
        title: 'New in the collection',
        text: 'The latest garments added to the catalogue, in the order they arrived.',
    },
    {
        element: anchor('how-it-works'),
        placement: 'top',
        title: 'How the fitting works',
        text: 'The three steps behind every render, in the order you will actually perform them.',
    },
];

/* -------------------------------------------------------------- SHOP */

const SHOP_STEPS = [
    {
        element: anchor('shop-header'),
        placement: 'bottom',
        title: 'The Collection',
        text: 'Every garment Hiraya sells, grouped by the category it belongs to. Nothing here is hidden behind a sign-up.',
    },
    {
        element: anchor('shop-stage'),
        placement: 'auto',
        title: 'Featured pieces',
        text: 'A slow rotation of highlighted garments. Use the arrows or swipe to move through them, and View Piece opens the one on stage.',
    },
    {
        element: anchor('shop-filters'),
        placement: 'auto',
        title: 'Filter by garment type',
        text: 'Narrow to tops, bottoms, footwear, outerwear or dresses. The filter is a view, not a search — it never changes what is in stock.',
    },
    {
        element: anchor('shop-search'),
        placement: 'auto',
        title: 'Search by name',
        text: 'Type any part of a garment name to narrow the grid as you type.',
    },
    {
        element: anchor('shop-grid'),
        placement: 'top',
        title: 'Act on any card',
        text: 'Open a piece for sizes and measurements, save it to your bag, or send it straight to the AI studio to see it on you.',
        guestText: 'Open any piece for its sizes, colours and measurements. Saving to a bag or trying it on asks you to sign in first.',
    },
];

/* ----------------------------------------------------------- PRODUCT */

const PRODUCT_STEPS = [
    {
        element: anchor('product-gallery'),
        placement: 'right',
        title: 'Every angle of the piece',
        text: 'The thumbnails and arrows switch between shots. The frame is fixed at 3:4 so a garment is never stretched to fill it.',
    },
    {
        element: anchor('product-variants'),
        placement: 'left',
        title: 'Size and colour',
        text: 'Pick both before anything else unlocks. Sizes shown are the ones actually in stock, and the first in-stock size is pre-selected for you.',
    },
    {
        element: anchor('product-actions'),
        placement: 'top',
        title: 'Add to Bag',
        text: 'Takes the chosen size and colour straight to your bag, with the real price from the catalogue rather than a guess.',
        guestText: 'Adding to a bag needs an account — this button takes you to Sign In first, then back to shopping.',
    },
    {
        element: anchor('product-tryon'),
        placement: 'left',
        title: 'Try in Virtual Try-On',
        text: 'Sends this exact variant to the studio with your selection pre-loaded, so you see the fit on you before you pay.',
        guestText: 'The AI studio is for members. Sign in and this button opens it with this exact piece pre-loaded.',
    },
];

/* -------------------------------------------------------------- CART */

const CART_STEPS = [
    {
        element: anchor('cart-header'),
        placement: 'bottom',
        title: 'My Bag',
        text: 'Everything you saved, hearted or added, in one place. The count shows distinct pieces, with total units beside it.',
    },
    {
        element: anchor('cart-list'),
        placement: 'top',
        title: 'Select what you are buying',
        text: 'Tick a row to include it in the order, adjust the quantity, or remove it entirely. Only ticked pieces are charged.',
    },
    {
        element: anchor('cart-summary'),
        placement: 'left',
        title: 'Order summary',
        text: 'Your total — paid in full with one payment at checkout. Proceed to Checkout carries only the pieces you ticked.',
    },
    {
        element: anchor('cart-studio'),
        placement: 'left',
        title: 'Try them on first',
        text: 'Not sure? Send the whole bag to the AI studio and see the fit before you pay.',
    },
];

/* ---------------------------------------------------------- CHECKOUT */

const CHECKOUT_STEPS = [
    {
        element: anchor('checkout-guidelines'),
        placement: 'right',
        title: 'Order guidelines',
        text: 'Cut-off times, the full-payment rule and how delivery works. Worth one read before you fill anything in.',
    },
    {
        element: anchor('checkout-shipping'),
        placement: 'top',
        title: '1 · Shipping details',
        text: 'Who receives the order, how to reach them and where it goes.',
    },
    {
        element: anchor('checkout-courier'),
        placement: 'top',
        title: '2 · Courier',
        text: 'Choose who delivers the parcel. The choice is saved with the order.',
    },
    {
        element: anchor('checkout-payment'),
        placement: 'top',
        title: '3 · Payment',
        text: 'Review your items, pay the full amount (scan the store QR), then attach your receipt. We verify every payment against our records before shipping.',
    },
    {
        element: anchor('checkout-submit'),
        placement: 'top',
        title: 'Submit the order',
        text: 'Sends the order and your payment receipt together. You can follow its verification and delivery in My Orders.',
    },
];

/* ----------------------------------------------------------- TRY-ON */

const TRYON_STEPS = [
    {
        element: anchor('fitting-canvas'),
        placement: 'auto',
        title: 'The fitting canvas',
        text: 'This is where the render appears. Your photo is checked for full-body framing before any processing is spent on it.',
    },
    {
        element: anchor('upload-photo'),
        placement: 'auto',
        title: 'Upload one full-body photo',
        text: 'One standing, front-on shot in good light. If the photo is rejected the canvas tells you why instead of rendering a broken result.',
    },
    {
        element: anchor('style-stack'),
        placement: 'right',
        title: 'My Bag, on display',
        text: 'The garments you have chosen to wear, grouped by where they sit on the body. It stays locked until a body photo exists — the fitting is drawn onto you, not onto a model.',
    },
    {
        element: anchor('stylist-toggle'),
        placement: 'auto',
        title: 'AI Stylist & sizing',
        text: 'The stylist chat and the size suggester live in a side drawer so the canvas keeps the whole stage. Open it whenever you want advice; close it to get back to the fit.',
    },
    {
        element: anchor('generate-fitting'),
        placement: 'top',
        title: 'Generate the fit',
        text: 'The button unlocks only when there is a photo and at least one garment. It also reports which body regions were actually dressed, so a partial render is never passed off as a full one.',
    },
    {
        element: anchor('history-toggle'),
        placement: 'auto',
        title: 'Your Gallery',
        text: 'Every finished render is saved automatically. Open Gallery to compare before and after, keep favourites, or load a past outfit straight back into your stack. Deleted looks wait in Recently Deleted, where you can restore them.',
    },
];

/* ------------------------------------------------------------ ORDERS */

const ORDERS_STEPS = [
    {
        element: anchor('orders-header'),
        placement: 'bottom',
        title: 'My Orders',
        text: 'Every order you have placed, with its current stage from payment check to delivery.',
    },
    {
        element: anchor('orders-list'),
        placement: 'top',
        title: 'Track and settle',
        text: 'Each order starts as a compact row — open it for details, payment verification and delivery. If a payment could not be verified, upload the correct receipt from the order itself.',
    },
    {
        element: anchor('orders-bag'),
        placement: 'left',
        title: 'Back to your bag',
        text: 'Jump straight to the pieces you have saved but not yet ordered.',
    },
];

/* ----------------------------------------------------------- ACCOUNT */

const ACCOUNT_STEPS = [
    {
        element: anchor('account-profile'),
        placement: 'bottom',
        title: 'Personal information',
        text: 'Your name and contact details, used for order delivery and notifications.',
    },
    {
        element: anchor('account-measurements'),
        placement: 'top',
        title: 'Sizing profile',
        text: 'Your upper and lower body size, plus how you like garments to fit. These drive your size suggestions, recommendations and AI try-on fits.',
    },
    {
        element: anchor('account-security'),
        placement: 'top',
        title: 'Password',
        text: 'Changing your password updates this form only when you press Save Settings — the button below covers the whole page.',
    },
    {
        element: anchor('account-save'),
        placement: 'left',
        title: 'Save Settings',
        text: 'One button saves the profile, the measurements and the password together. Nothing on this page is stored until you press it.',
    },
];

/* ---------------------------------------------------------- REGISTRY */

/**
 * Keyed by ROUTE PATTERN, not exact pathname: `/product/:id` is still "the
 * product page". (Try-on history is a drawer inside `/try-on`, covered there.)
 * `guest` is present only on the pages a signed-out visitor can actually use.
 */
export const TOUR_ROUTES = [
    { label: 'Home', test: (p) => p === '/home' || p === '/', member: MEMBER_HOME_STEPS, guest: GUEST_HOME_STEPS },
    { label: 'Shop', test: (p) => p === '/shop', member: SHOP_STEPS, guest: SHOP_STEPS },
    { label: 'Product', test: (p) => p.startsWith('/product/'), member: PRODUCT_STEPS, guest: PRODUCT_STEPS },
    { label: 'My Bag', test: (p) => p === '/cart', member: CART_STEPS },
    { label: 'Checkout', test: (p) => p === '/checkout', member: CHECKOUT_STEPS },
    { label: 'AI Studio', test: (p) => p === '/try-on', member: TRYON_STEPS },
    { label: 'My Orders', test: (p) => p === '/orders', member: ORDERS_STEPS },
    { label: 'Account', test: (p) => p === '/settings', member: ACCOUNT_STEPS },
];

const normalise = (pathname) => (pathname || '/').toLowerCase().replace(/(.)\/+$/, '$1');

/**
 * The guide for a pathname and audience: `{ label, steps }`, or null when the
 * page has no guide for that audience. Guest copy is swapped in here, so the
 * engine only ever sees plain `text`.
 */
export const getTourForPath = (pathname, isGuest = false) => {
    const entry = TOUR_ROUTES.find((e) => e.test(normalise(pathname)));
    const steps = entry && (isGuest ? entry.guest : entry.member);
    if (!steps || steps.length === 0) return null;

    return {
        label: entry.label,
        steps: isGuest ? steps.map((s) => (s.guestText ? { ...s, text: s.guestText } : s)) : steps,
    };
};

/** Backwards-compatible: just the step list. */
export const getStepsForPath = (pathname, isGuest = false) => getTourForPath(pathname, isGuest)?.steps || null;

/** True when the page has a guide for this audience. */
export const hasTourForPath = (pathname, isGuest = false) => Boolean(getTourForPath(pathname, isGuest));
