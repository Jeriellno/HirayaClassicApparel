import React from 'react';
import { X, Check, Package, Edit3, Ruler, Image as ImageIcon, Trash2 } from 'lucide-react';
import { useProductModalForm } from './useProductModalForm';
import SizesInventoryTab from './SizesInventoryTab';
import ProductBasicInfo from './forms/ProductBasicInfo';
import ProductImageUpload from './forms/ProductImageUpload';

const ProductModal = ({ isOpen, onClose, onSave, onDelete, productToEdit = null, defaultImageUrl = '' }) => {
  const form = useProductModalForm({ isOpen, productToEdit, defaultImageUrl, onSave, onClose });

  if (!isOpen) return null;

  const isNameMissing = !String(
    form.formData.name || form.formData.title || form.formData.product_name || ''
  ).trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#0D1017] border border-[#E9C46A]/30 rounded-2xl shadow-2xl w-full max-w-4xl font-sans text-sm max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5 shrink-0">
          <h3 className="font-serif font-semibold text-[#E9C46A] uppercase tracking-wider flex items-center gap-2">
            {form.isEditMode ? <Edit3 size={16} /> : <Package size={16} />}
            {form.isEditMode ? 'Edit Garment Details' : 'Add New Garment'}
          </h3>
          <div className="flex items-center gap-3">
            {form.isEditMode && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(productToEdit.id)}
                className="text-red-400 hover:text-red-300 text-[10px] uppercase font-bold px-2.5 py-1 bg-red-500/10 border border-red-500/20 rounded flex items-center gap-1 transition cursor-pointer"
              >
                <Trash2 size={12} /> Delete
              </button>
            )}
            <button type="button" onClick={() => !form.isSubmitting && onClose()} className="text-gray-400 hover:text-white p-1">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="flex border-b border-white/10 bg-[#0D1017] px-5 pt-3 gap-2 shrink-0">
          {[
            // Image first: the flow is upload photo -> AI auto-fill -> review.
            { id: 'media', label: '1. Garment Image', icon: ImageIcon },
            { id: 'basic', label: '2. Basic Details', icon: Package, hasError: isNameMissing },
            { id: 'sizes', label: `3. Sizes & Stock (${form.totalStock})`, icon: Ruler },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = form.activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => form.setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-xl transition cursor-pointer relative ${
                  isActive ? 'bg-white/5 text-[#E9C46A] border-t border-x border-[#E9C46A]/40 font-bold' : 'text-gray-400'
                }`}
              >
                <Icon size={14} /> {tab.label}
                {tab.hasError && (
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" title="Product name required" />
                )}
              </button>
            );
          })}
        </div>

        {/* Form Body */}
        <form onSubmit={form.handleSubmit} className="p-5 flex-1 overflow-y-auto space-y-5 flex flex-col justify-between">
          <div className="flex-1">
            {form.activeTab === 'basic' && (
              <ProductBasicInfo
                formData={form.formData}
                handleBasicChange={form.handleBasicChange}
              />
            )}

            {form.activeTab === 'sizes' && (
              <SizesInventoryTab
                category={form.formData.category}
                gender={form.formData.gender}
                sizeVariants={form.SIZE_VARIANTS}
                selectedSizes={form.selectedSizes}
                totalStock={form.totalStock}
                onSizeToggle={form.handleSizeToggle}
                onAutoFillDefaults={form.handleAutoFillDefaults}
                onResetSizeDefaults={form.handleResetSizeDefaults}
                onStockChange={form.handleSizeStockChange}
                onMeasurementChange={form.handleMeasurementChange}
              />
            )}

            {form.activeTab === 'media' && (
              <ProductImageUpload
                formData={form.formData}
                imageFile={form.imageFile}
                isEditMode={form.isEditMode}
                onRegenerateCutout={form.regenerateDisplayCutout}
                previewUrl={form.previewUrl}
                isAnalyzingImage={form.isAnalyzingImage}
                imageAnalysisError={form.imageAnalysisError}
                onAnalyzeImage={() => form.analyzeImage()}
                compositeUrl={form.compositeUrl}
                backgroundMeta={form.backgroundMeta}
                fileInputRef={form.fileInputRef}
                onChange={form.handleBasicChange}
                onFileChange={form.handleFileChange}
                onRemoveImage={form.handleRemoveImage}
              />
            )}
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 flex justify-end gap-2 border-t border-white/10 shrink-0">
            <button type="button" disabled={form.isSubmitting} onClick={onClose} className="px-4 py-2.5 text-gray-400 uppercase">
              Cancel
            </button>
            <button
              type="submit"
              disabled={form.isSubmitting || form.isAnalyzingImage}
              className="px-5 py-2.5 bg-[#E9C46A] text-black font-bold uppercase rounded-xl flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={14} /> {form.isEditMode ? 'Update Garment' : 'Save Garment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProductModal;