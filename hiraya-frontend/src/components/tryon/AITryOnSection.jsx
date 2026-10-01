/**
 * AITryOnSection — the AI Try-On workspace shell.
 *
 * Composes the restored "My Bag" categorical Style Stack with the try-on
 * canvas and stylist chat. This is the section-level entry
 * point that the AiTryOn page (and any future host) mounts; it exists so the
 * Style Stack can be dropped into other surfaces without re-wiring the whole
 * studio's state hook.
 *
 * There is no body-profile panel here. The customer's sizing profile is two
 * size labels edited in Account Settings; the Studio reads them off the hook
 * and derives the centimetres the renderer needs from the size chart.
 *
 * `useTryOnState` owns the studio state; this component is presentation-only
 * and forwards every prop straight through. When `withStyleStack` is true (the
 * default for the Studio) the left-hand stack is rendered — and because the
 * stack is fed from that same hook, it already reflects the user's bag with
 * each garment cut out via the background-removal pipeline.
 */
import { useTryOnState } from '../../hooks/useTryOnState';
import { StyleStack } from './StyleStack';
import { TryOnCanvas } from './TryOnCanvas';
import { StylistChat } from './StylistChat';

export const AITryOnSection = ({ withStyleStack = true, withChat = true }) => {
  const {
    bodySizes, measurements,
    garmentsByCategory, selectedGarments, toggleGarment, clearLayer, clearAllStack, wishlistLoading,
    userPhotoPreview, handlePhotoUpload, removeUserPhoto, canGenerate, isGenerating, generatedImage,
    handleGenerateFitting, handleRetryFitting, proceedToCheckout, addWornItemsToBag,
    cancelFitting,
    tryOnStatus, tryOnProgress, tryOnError, recommendedSize, aiFeedback,
    renderEngine, placedRegions, fitDiagnostics, fitCheck, vtonAssetWarning,
    photoVerification, photoRejection,
    chatMessages, isChatTyping, handleSendMessage,
  } = useTryOnState();

  return (
    <div className="flex h-screen w-full overflow-hidden pt-16 text-hiraya-ink">
      {/* 1. LEFT PANEL — MY BAG STYLE STACK (categorical rows + BG removal) */}
      {withStyleStack && (
        <StyleStack
          garmentsByCategory={garmentsByCategory}
          selectedGarments={selectedGarments}
          toggleGarment={toggleGarment}
          clearLayer={clearLayer}
          clearAllStack={clearAllStack}
          isLoading={wishlistLoading}
        />
      )}

      {/* 2. CENTER PANEL — TRY-ON CANVAS */}
      <main className="z-10 flex-1 flex-col space-y-6 overflow-y-auto p-6">
        <TryOnCanvas
          selectedGarments={selectedGarments}
          userPhotoPreview={userPhotoPreview}
          bodySizes={bodySizes}
          generatedImage={generatedImage}
          isGenerating={isGenerating}
          canGenerate={canGenerate}
          onPhotoUpload={handlePhotoUpload}
          onGenerate={handleGenerateFitting}
          /* Stop an in-flight render; the photo and stack are kept. */
          onCancel={cancelFitting}
          /* Clears ONLY the body photo — the Style Stack is left untouched. */
          onRemovePhoto={removeUserPhoto}
          measurements={measurements}
          tryOnStatus={tryOnStatus}
          tryOnProgress={tryOnProgress}
          tryOnError={tryOnError}
          recommendedSize={recommendedSize}
          aiFeedback={aiFeedback}
          renderEngine={renderEngine}
          placedRegions={placedRegions}
          fitDiagnostics={fitDiagnostics}
          fitCheck={fitCheck}
          /*
           * Non-fatal input-quality notice: set when the dispatched render used
           * a garment that is not a clean transparent cut-out. The hook has
           * always produced it and TryOnCanvas has always rendered it, but this
           * shell never forwarded it, so the warning was invisible here.
           */
          vtonAssetWarning={vtonAssetWarning}
          /*
           * Body-photo verification + the GATE result. `photoRejection` non-null
           * means the upload was refused before any background removal, so the
           * canvas shows the reason instead of a preview. Both were produced by the
           * hook but never forwarded here, so the canvas could not see either.
           */
          photoVerification={photoVerification}
          photoRejection={photoRejection}
          /*
           * NB: `onRetry` is deliberately NOT set to the canvas's file-picker
           * helper here — in this shell the name is already taken by
           * `handleRetryFitting` (re-run the render). The canvas opens its OWN
           * file input for "Upload a different photo", so it needs nothing passed.
           */
          onRetry={handleRetryFitting}
          onProceedToCheckout={proceedToCheckout}
          onAddWornToBag={addWornItemsToBag}
        />
      </main>

      {/* 3. RIGHT PANEL — AI STYLIST CHATBOT */}
      {withChat && (
        <StylistChat
          messages={chatMessages}
          isTyping={isChatTyping}
          onSendMessage={handleSendMessage}
        />
      )}
    </div>
  );
};

export default AITryOnSection;
