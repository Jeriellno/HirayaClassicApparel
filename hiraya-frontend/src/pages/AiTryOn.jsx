import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useTryOnState } from '../hooks/useTryOnState';
import { StyleStack } from '../components/tryon/StyleStack';
import { TryOnCanvas } from '../components/tryon/TryOnCanvas';
import { StylistChat } from '../components/tryon/StylistChat';
import SideDrawer from '../components/tryon/SideDrawer';
import TryOnHistoryPanel, { HISTORY_QUERY_KEY } from '../components/tryon/TryOnHistoryPanel';
import { useStylist } from '../hooks/useStylist';
import StylistConsultation from '../components/tryon/stylist/StylistConsultation';
import { LookbookOverlay, LookbookDetails } from '../components/tryon/stylist/Lookbook';
import { VerdictOverlay, VerdictDetails } from '../components/tryon/stylist/StylistVerdict';
import StylistStatus from '../components/tryon/stylist/StylistStatus';

const AiTryOn = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    bodySizes, measurements,
    garmentsByCategory, selectedGarments, toggleGarment, clearLayer, clearAllStack, wishlistLoading,
    applySavedOutfit,
    userPhotoPreview, handlePhotoUpload, removeUserPhoto, canGenerate, isGenerating, generatedImage,
    stackPlan, renderPass,
    handleGenerateFitting, handleRetryFitting, proceedToCheckout, addWornItemsToBag,
    cancelFitting,
    tryOnStatus, tryOnProgress, tryOnError, recommendedSize, aiFeedback, renderEngine, placedRegions,
    fitDiagnostics, fitCheck, vtonAssetWarning,
    photoVerification,
    photoRejection,
    dressLockedCategories,
    chatMessages, isChatTyping, handleSendMessage,
    sessionId, clearResult, userPhotoBase64,
  } = useTryOnState();

  /*
   * THE AI STYLIST — visible, photo-first. An accepted photo opens the
   * style-profile modal, the lookbook is drawn on the photo, and the verdict on
   * the render. It drives the Studio only through the hook's public functions.
   */
  const stylist = useStylist({
    userPhotoBase64,
    photoRejection,
    selectedGarments,
    applySavedOutfit,
    handleGenerateFitting,
    canGenerate,
    isGenerating,
    tryOnStatus,
    generatedImage,
    sessionId,
  });

  /*
   * FLOW GATE: a body photo comes FIRST.
   *
   * The fitting is drawn ONTO the customer's full-body photo, so selecting
   * garments before one exists can only produce a broken overlay. The Style
   * Stack is locked until the photo is present, which makes the required order
   * obvious instead of letting the customer build an outfit that cannot render.
   *
   * There is no body-profile form on this screen: the customer's sizing profile
   * is two size labels edited in Account Settings, and the centimetres the
   * render needs are derived from them by the backend.
   */
  const hasBodyPhoto = !!userPhotoPreview;

  /*
   * THE STYLIST DRAWER — UI state only.
   *
   * The AI Stylist & Size Suggester used to take a permanent 340px column. It
   * now lives in a side drawer, CLOSED by default, so the canvas owns the
   * floor. The chat stays mounted while closed (its messages live in the hook
   * anyway), and the edge tab shows a dot when the stylist has said something
   * new since the drawer was last open.
   */
  const reduce = useReducedMotion();
  const [stylistOpen, setStylistOpen] = useState(false);
  const [seenMessages, setSeenMessages] = useState(chatMessages.length);
  const closeStylist = useCallback(() => setStylistOpen(false), []);

  useEffect(() => {
    if (stylistOpen) setSeenMessages(chatMessages.length);
  }, [stylistOpen, chatMessages.length]);

  const lastMessage = chatMessages[chatMessages.length - 1];
  const hasUnread = !stylistOpen && chatMessages.length > seenMessages && lastMessage?.role === 'assistant';

  /*
   * THE HISTORY DRAWER — the customer's finished fittings, inside the Studio.
   *
   * It replaced the separate /try-on/history page (and its navbar link): the
   * history belongs to the fitting flow, so it opens beside the canvas and
   * "Use This Outfit" loads a past look straight into the Style Stack.
   * `/try-on?history=1` (the old page's redirect, the Home shortcut) opens it.
   * Only one drawer is open at a time.
   */
  const [historyOpen, setHistoryOpen] = useState(() => searchParams.get('history') === '1');
  const [newLooks, setNewLooks] = useState(0);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const openHistory = useCallback(() => {
    setStylistOpen(false);
    setNewLooks(0);
    setHistoryOpen(true);
  }, []);

  // Consume `?history=1` once so a refresh does not keep re-opening the drawer.
  useEffect(() => {
    if (searchParams.get('history') === null) return;
    const next = new URLSearchParams(searchParams);
    next.delete('history');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  /*
   * A FINISHED RENDER IS SAVED TO HISTORY BY THE BACKEND. When one completes,
   * the cached history is marked stale (so the drawer shows it next time) and
   * the header button counts it as a new look until the drawer is opened.
   */
  const lastSavedRef = useRef(null);
  useEffect(() => {
    if (tryOnStatus !== 'completed' || !generatedImage || lastSavedRef.current === generatedImage) return;
    lastSavedRef.current = generatedImage;
    queryClient.invalidateQueries({ queryKey: [HISTORY_QUERY_KEY] });
    if (!historyOpen) setNewLooks((n) => n + 1);
  }, [tryOnStatus, generatedImage, historyOpen, queryClient]);

  const anyDrawerOpen = stylistOpen || historyOpen;

  // While the lookbook is on the photo, "Try this look" is the one primary action.
  const lookbookShowing = stylist.lookbook.status === 'ready' && !!stylist.look && !generatedImage && !isGenerating;

  return (
    /*
     * THE STUDIO FLOOR ("Vintage Atelier").
     *
     * Two FLOATING panels on the cream canvas — the My Bag showcase and the
     * canvas — with the stylist in a side drawer that slides in on demand, so
     * the fitting canvas gets the whole remaining width.
     *
     * Desktop: one screen-high row, each panel scrolling on its own. Below
     * `lg` the floor stacks in the order the flow asks for: the canvas (photo
     * first), then the stack. Layout only — every prop below is unchanged.
     */
    <div className="flex min-h-screen w-full flex-col gap-4 px-3 pb-24 pt-24 lg:pb-4 text-hiraya-ink sm:px-4 lg:h-screen lg:flex-row lg:overflow-hidden lg:pt-[6.5rem]">
      {/* 1. LEFT PANEL: MY BAG STYLE STACK (locked until a body photo exists) */}
      <StyleStack
        garmentsByCategory={garmentsByCategory}
        selectedGarments={selectedGarments}
        toggleGarment={toggleGarment}
        clearLayer={clearLayer}
        /* Reuse the hook's own reset. `setSelectedGarments` is private to
           useTryOnState — referencing it here was a ReferenceError that crashed
           the Studio whenever"Clear Stack" was pressed. */
        clearAllStack={clearAllStack}
        isLoading={wishlistLoading}
        locked={!hasBodyPhoto}
        lockedMessage="Upload your full-body photo in the canvas first."
        /* Rows blocked by the dress/top-bottom exclusion (e.g. ['top','bottom']). */
        lockedCategories={dressLockedCategories}
      />

      {/* 2. CENTER PANEL: TRY-ON CANVAS */}
      <main className="order-first z-10 flex min-w-0 flex-col space-y-6 px-1 lg:order-none lg:flex-1 lg:overflow-y-auto lg:px-2 scrollbar-none">
        <TryOnCanvas
          selectedGarments={selectedGarments}
          userPhotoPreview={userPhotoPreview}
          bodySizes={bodySizes}
          generatedImage={generatedImage}
          isGenerating={isGenerating}
          canGenerate={canGenerate}
          /* Single / two-pass pair / unsupported (with the reason), and the running pass. */
          stackPlan={stackPlan}
          renderPass={renderPass}
          onPhotoUpload={handlePhotoUpload}
          onGenerate={handleGenerateFitting}
          /* Stop an in-flight render without discarding the customer's setup. */
          onCancel={cancelFitting}
          /* Clears ONLY the body photo — the Style Stack is left untouched. */
          onRemovePhoto={removeUserPhoto}
          measurements={measurements}
          /* Live pipeline telemetry for the Gold & Black loading / error states */
          tryOnStatus={tryOnStatus}
          tryOnProgress={tryOnProgress}
          tryOnError={tryOnError}
          recommendedSize={recommendedSize}
          aiFeedback={aiFeedback}
          onRetry={handleRetryFitting}
          onProceedToCheckout={proceedToCheckout}
          /*"Add Worn Item to Bag" trigger on the completed render. */
          onAddWornToBag={addWornItemsToBag}
          /* Honest provenance: 'ai' = server model, 'composite' = local render. */
          renderEngine={renderEngine}
          /* Which body regions the last render actually dressed. */
          placedRegions={placedRegions}
          /* How the fit was derived (posture, occlusion, silhouette). */
          fitDiagnostics={fitDiagnostics}
          /*
           * FIT CHECK — the advisory verdict (pose, posture, body-vs-garment
           * size, garment data, body profile).
           *
           * The hook already computes this and TryOnCanvas already renders the
           * panel, but this prop was never forwarded from the page, so the
           * whole Fit Check surface was dead code on the live /try-on route.
           */
          fitCheck={fitCheck}
          /* Set when the dispatched render used a non-cut-out garment asset. */
          vtonAssetWarning={vtonAssetWarning}
          /*
           * Body-photo verification from the upload — drives the small
           * checking/ready indicator on the canvas so an unfit photo is caught
           * BEFORE a render is spent on it.
           */
          photoVerification={photoVerification}
          /*
           * The GATE result. Non-null means the upload was refused before any
           * background removal, so the canvas must show the reason and ask for a
           * proper full-body photo rather than a preview.
           */
          photoRejection={photoRejection}
          /* Opens the try-on history drawer (button in the canvas header). */
          onOpenHistory={openHistory}
          newLooks={newLooks}
          /* AI Stylist: a live status pill in the header; one primary action at a time. */
          headerSlot={(
            <StylistStatus
              stylist={stylist}
              hasPhoto={hasBodyPhoto && !photoRejection}
              isGenerating={isGenerating}
              hasResult={!!generatedImage}
            />
          )}
          generateEmphasis={lookbookShowing ? 'secondary' : 'primary'}
          /* AI Stylist: lookbook on the photo, verdict on the render, details below. */
          photoOverlay={<LookbookOverlay stylist={stylist} photoSrc={userPhotoPreview} isGenerating={isGenerating} />}
          resultOverlay={<VerdictOverlay verdict={stylist.verdict} renderSrc={generatedImage} anchors={stylist.anchors} />}
          belowCanvas={generatedImage && !isGenerating ? (
            <VerdictDetails
              verdict={stylist.verdict}
              onAddLookToBag={addWornItemsToBag}
              onTryAnotherLook={clearResult}
              canTryAnother={stylist.lookbook.status === 'ready'}
            />
          ) : (
            <LookbookDetails stylist={stylist} />
          )}
          /*
           * NO `onRetry` HERE. The canvas opens its OWN file input for "Upload a
           * different photo" (via its local `fileInputRef`), so it needs nothing
           * passed — and setting `onRetry` here would collide with a separate
           * `onRetry` prop on this element (caught by the production build).
           */
        />
      </main>

      {/*
        * 3. THE STYLIST'S EDGE TAB. A vertical navy tab on the right edge on
        *    desktop, a round button bottom-right on phones. It steps aside
        *    while the drawer is open.
        */}
      <motion.button
        type="button"
        onClick={() => { setHistoryOpen(false); setStylistOpen(true); }}
        data-tour="stylist-toggle"
        aria-expanded={stylistOpen}
        aria-controls="stylist-drawer"
        aria-label={`Open the AI stylist and size suggester${hasUnread ? ' — new reply' : ''}`}
        initial={false}
        animate={{ x: anyDrawerOpen ? 90 : 0, opacity: anyDrawerOpen ? 0 : 1 }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}
        whileHover={reduce || anyDrawerOpen ? undefined : { x: -4 }}
        className="group fixed bottom-4 right-4 z-[75] flex h-12 w-12 sm:h-14 sm:w-14 cursor-pointer items-center justify-center rounded-full bg-navy-900 text-cream-100 shadow-[0_18px_36px_-14px_rgba(13,21,36,0.85)] ring-1 ring-cream-50/10 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy-600 lg:bottom-auto lg:right-0 lg:top-1/2 lg:h-auto lg:w-auto lg:-translate-y-1/2 lg:flex-col lg:gap-3 lg:rounded-l-[20px] lg:rounded-r-none lg:px-3 lg:py-5"
        style={{ pointerEvents: anyDrawerOpen ? 'none' : 'auto' }}
      >
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-cream-100 text-navy-900">
          <MessageCircle size={16} />
          {hasUnread && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-navy-900" />
            </span>
          )}
        </span>
        <span className="hidden text-[9.5px] font-semibold uppercase tracking-[0.24em] [writing-mode:vertical-rl] lg:block">
          Ask the stylist
        </span>
      </motion.button>

      {/* 4. THE DRAWER: AI STYLIST CHATBOT (hidden until the tab is pressed) */}
      <SideDrawer open={stylistOpen} onClose={closeStylist} label="AI Stylist and Size Suggester" id="stylist-drawer">
      <StylistChat
        className="flex h-full w-full flex-col overflow-hidden rounded-[26px] bg-hiraya-surface-raised shadow-[0_30px_60px_-24px_rgba(13,21,36,0.6)] ring-1 ring-cream-50/80"
        onClose={closeStylist}
        messages={chatMessages}
        isTyping={isChatTyping}
        onSendMessage={handleSendMessage}
        /*
         * The stylist's catalog matches are CLICKABLE. Navigation lives here
         * (not in the hook) because `useTryOnState` is deliberately router-free
         * — the same reason every other handler in this app navigates from the
         * component that owns the route.
         */
        onSelectProduct={(product) => navigate(`/product/${product.id}`)}
        /*
         * Deep links returned by the backend (`links`), e.g. a product page
         * for its live per-size stock, or the shop. Routed here for the same
         * reason as onSelectProduct: the hook stays router-free.
         */
        onNavigate={(url) => navigate(url)}
      />
      </SideDrawer>

      {/* 6. THE STYLIST CONSULTATION (opens when an accepted photo lands) */}
      <StylistConsultation
        open={stylist.modalOpen}
        onClose={stylist.closeModal}
        onSubmit={stylist.showLooks}
        analysis={stylist.analysis}
        answers={stylist.answers}
        setAnswer={stylist.setAnswer}
        occasions={stylist.profile?.occasions}
        photoSrc={userPhotoPreview}
      />

      {/* 5. THE DRAWER: TRY-ON HISTORY (opened from the canvas header) */}
      <SideDrawer
        open={historyOpen}
        onClose={closeHistory}
        label="Gallery"
        id="history-drawer"
        className="w-[min(430px,calc(100vw-1.5rem))]"
      >
        <TryOnHistoryPanel open={historyOpen} onClose={closeHistory} onUseOutfit={applySavedOutfit} />
      </SideDrawer>
    </div>
  );
};

export default AiTryOn;