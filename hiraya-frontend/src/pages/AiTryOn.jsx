import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTryOnState } from '../hooks/useTryOnState';
import { StyleStack } from '../components/tryon/StyleStack';
import { BodyProfileForm } from '../components/tryon/BodyProfileForm';
import { TryOnCanvas } from '../components/tryon/TryOnCanvas';
import { StylistChat } from '../components/tryon/StylistChat';

const AiTryOn = () => {
  const navigate = useNavigate();
  const {
    measurements, handleMeasurementChange, saveMeasurementsToDB, isSavingMeasurements, measurementStatus,
    garmentsByCategory, selectedGarments, toggleGarment, clearLayer, clearAllStack, wishlistLoading,
    userPhotoPreview, handlePhotoUpload, removeUserPhoto, canGenerate, isGenerating, generatedImage,
    handleGenerateFitting, handleRetryFitting, proceedToCheckout, addWornItemsToBag,
    cancelFitting,
    tryOnStatus, tryOnProgress, tryOnError, recommendedSize, aiFeedback, renderEngine, placedRegions,
    fitDiagnostics, fitCheck, vtonAssetWarning,
    photoVerification,
    photoRejection,
    dressLockedCategories,
    chatMessages, isChatTyping, handleSendMessage
  } = useTryOnState();

  /*
   * FLOW GATE: a body photo comes FIRST.
   *
   * The fitting is drawn ONTO the customer's full-body photo, so selecting
   * garments before one exists can only produce a broken overlay. The Style
   * Stack is locked until the photo is present, which makes the required order
   * obvious instead of letting the customer build an outfit that cannot render.
   */
  const hasBodyPhoto = !!userPhotoPreview;

  return (
    <div className="flex h-screen w-full bg-black text-hiraya-ink overflow-hidden pt-16">
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

      {/* 2. CENTER PANEL: BODY PROFILE & TRY-ON CANVAS */}
      <main className="flex-1 p-6 overflow-y-auto space-y-6 z-10 flex flex-col">
        <BodyProfileForm
          measurements={measurements}
          onChange={handleMeasurementChange}
          onSave={saveMeasurementsToDB}
          isSaving={isSavingMeasurements}
          status={measurementStatus}
        />

        <TryOnCanvas
          selectedGarments={selectedGarments}
          userPhotoPreview={userPhotoPreview}
          generatedImage={generatedImage}
          isGenerating={isGenerating}
          canGenerate={canGenerate}
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
          /*
           * NO `onRetry` HERE. The canvas opens its OWN file input for "Upload a
           * different photo" (via its local `fileInputRef`), so it needs nothing
           * passed — and setting `onRetry` here would collide with a separate
           * `onRetry` prop on this element (caught by the production build).
           */
        />
      </main>

      {/* 3. RIGHT PANEL: AI STYLIST CHATBOT */}
      <StylistChat
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
    </div>
  );
};

export default AiTryOn;