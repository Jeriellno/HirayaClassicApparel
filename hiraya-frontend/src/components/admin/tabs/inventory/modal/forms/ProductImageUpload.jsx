import React, { useState } from 'react';
import { ImageIcon, X, UploadCloud, CheckCircle2, Sparkles, Loader2 } from 'lucide-react';

const ProductImageUpload = ({ previewUrl, formData, imageFile, isEditMode, isAnalyzingImage, imageAnalysisError, onAnalyzeImage, onRegenerateCutout, onFileChange, onRemoveImage, compositeUrl, backgroundMeta }) => {
  const [isDragging, setIsDragging] = useState(false);

  const displayUrl = previewUrl || formData?.image_url;
  // STAGE 1 result — when present, this background-replaced image is what the
  // catalog shows. The original upload stays visible beside it for comparison.
  const hasComposite = Boolean(compositeUrl);

  /*
   * Edit mode + an existing photo + no catalog image = this product is showing
   * its RAW, uncut original to customers on every surface. Offer the one action
   * that fixes it, without forcing a re-upload of the photo (which would also
   * re-run Gemini and overwrite the admin's curated details).
   */
  const canRegenerateCutout = Boolean(isEditMode && displayUrl && onRegenerateCutout);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        onFileChange({ target: { files: [file] } });
      }
    }
  };

  return (
    <div className="space-y-3">
      {/* Step guide — malinaw na dalawang hakbang ang flow. */}
      <div className="rounded-xl border-[#CB997E]/25 bg-[#CB997E]/5 p-3">
        <p className="text-[11px] font-mono uppercase tracking-wider text-hiraya-ink font-bold">
          Step 1 - Upload the garment photo
        </p>
        <p className="mt-1 text-[11px] text-hiraya-ink leading-relaxed">
          I-upload ang larawan ng damit. Kapag may larawan na, lalabas ang “Auto-fill details (AI)”
          button — ito ang maglalagay ng damit sa default HIRAYA frame at magfi-fill ng
          Basic Details at Sizes &amp; Stock.
        </p>
      </div>

      <label className="block text-[11px] font-mono uppercase tracking-wider text-hiraya-ink font-medium">
        Garment Image / Catalog Preview
        {isAnalyzingImage && <span className="ml-2 text-hiraya-ink normal-case">Analyzing image...</span>}
        {imageAnalysisError && <span className="ml-2 text-red-400 normal-case">{imageAnalysisError}</span>}
      </label>

      {imageFile && onAnalyzeImage && (
        <button
          type="button"
          onClick={onAnalyzeImage}
          disabled={isAnalyzingImage}
          className="inline-flex items-center gap-2 rounded-lg border border-[#CB997E]/50 bg-[#CB997E]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-hiraya-ink transition hover:bg-[#CB997E]/20 disabled:cursor-wait disabled:opacity-50"
        >
          {isAnalyzingImage ? (<>
              <Loader2 size={14} className="animate-spin" /> Framing &amp; filling details...
            </>) : (<>
              <Sparkles size={14} /> Auto-fill details (AI)
            </>)}
        </button>
      )}

      {canRegenerateCutout && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onRegenerateCutout}
            disabled={isAnalyzingImage}
            className="inline-flex items-center gap-2 rounded-lg border-[#CB997E]/50 bg-[#CB997E]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-hiraya-ink transition hover:bg-[#CB997E]/20 disabled:cursor-wait disabled:opacity-50"
          >
            {isAnalyzingImage ? (<>
                <Loader2 size={14} className="animate-spin" /> Removing background...
              </>) : (<>
                <Sparkles size={14} />
                {hasComposite ? 'Regenerate catalog image (AI)' : 'Create catalog image (AI)'}
              </>)}
          </button>
          <p className="text-[10px] text-hiraya-ink leading-relaxed">
            {hasComposite
              ? 'Gagawa ng bagong display image mula sa kasalukuyang larawan. Hindi nito babaguhin ang basic details at sizes.'
              : 'Walang display image ang produktong ito — ang ORIGINAL (hindi cut) ang nakikita ng customers. Pindutin ito para i-cut ang background at i-save ang display image.'}
          </p>
        </div>
      )}

      {/* Occasion / vibe the AI detected — stored as PRODUCT DETAIL and shown
          on the customer's shop surfaces. Every garment shares ONE frame. */}
      {backgroundMeta?.occasion && (
        <p className="text-[10px] font-mono uppercase tracking-wider text-hiraya-ink">
          Occasion: {backgroundMeta.label || backgroundMeta.occasion}
        </p>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
        {/* Background-replaced catalog preview (STAGE 1 result) */}
        {hasComposite && (
          <div className="relative w-24 h-24 shrink-0 rounded-lg border-[#CB997E]/50 overflow-hidden flex items-center justify-center shadow-inner">
            <img
              src={compositeUrl}
              alt="Background-replaced catalog preview"
              className="w-full h-full object-cover"
            />
            <span className="absolute bottom-0 inset-x-0 bg-[#CB997E] text-hiraya-olive text-[7px] font-black uppercase tracking-wider text-center py-0.5">
              Display
            </span>
          </div>
        )}

        {/* Original admin photo Preview Box */}
        <div className="relative group w-24 h-24 shrink-0 bg-hiraya-cream/40 rounded-lg border border-hiraya-olive/20 overflow-hidden flex items-center justify-center shadow-inner">
          {hasComposite && (
            <span className="absolute bottom-0 inset-x-0 z-10 bg-hiraya-cream-deep/80 text-hiraya-ink text-[7px] font-black uppercase tracking-wider text-center py-0.5">
              Original
            </span>
          )}
          {displayUrl ? (
            <>
              <img
                src={displayUrl}
                alt="Garment preview"
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {onRemoveImage && (
                <button
                  type="button"
                  onClick={onRemoveImage}
                  title="Remove image"
                  className="absolute top-1.5 right-1.5 p-1.5 bg-hiraya-cream-deep/80 hover:bg-red-500 text-hiraya-ink rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer shadow"
                >
                  <X size={12} />
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-hiraya-sand space-y-1 p-2 text-center">
              <ImageIcon size={22} />
              <span className="text-[9px] font-mono uppercase tracking-wider">No Image</span>
            </div>
          )}
        </div>

        {/* Drag & Drop Upload Zone */}
        <label
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex-1 border-2 border-dashed rounded-xl p-4 cursor-pointer text-center transition-all duration-200 flex flex-col items-center justify-center min-h-[96px] ${
            isDragging
              ? 'border-[#CB997E] bg-[#CB997E]/15'
              : 'border-hiraya-olive/20 hover:border-[#CB997E]/60 bg-hiraya-cream/60 hover:bg-white/[0.08]'
          }`}
        >
          {imageFile ? (
            <div className="flex items-center gap-3 text-hiraya-ink">
              <CheckCircle2 size={20} className="shrink-0" />
              <div className="text-left overflow-hidden">
                <p className="text-xs font-mono font-medium truncate max-w-[220px] sm:max-w-[300px] text-hiraya-ink">
                  {imageFile.name}
                </p>
                <p className="text-[10px] font-mono text-hiraya-ink mt-0.5">
                  {(imageFile.size / (1024 * 1024)).toFixed(2)} MB • Handa nang i-upload
                </p>
              </div>
            </div>
          ) : (
            <>
              <UploadCloud
                size={22}
                className={`mb-1.5 transition-colors ${
                  isDragging ? 'text-hiraya-ink' : 'text-hiraya-ink'
                }`}
              />
              <span className="text-xs font-mono text-hiraya-ink font-medium">
                {isDragging ? 'I-drop ang larawan dito' : 'I-click o i-drag ang larawan ng damit dito'}
              </span>
              <span className="text-[10px] font-mono text-hiraya-ink mt-1">
                PNG, JPG, WEBP up to 5MB · details will be suggested automatically
              </span>
            </>
          )}

          <input
            type="file"
            accept="image/*"
            onChange={onFileChange}
            className="hidden"
          />
        </label>
      </div>
    </div>
  );
};

export default ProductImageUpload;