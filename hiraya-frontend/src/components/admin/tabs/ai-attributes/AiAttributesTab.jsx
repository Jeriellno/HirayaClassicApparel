import React, { useState, useEffect } from 'react';
import api from '../../../../api/axios';
// Shared vocabulary so the Admin console and the Super Admin console tag
// garments identically (previously each had its OWN, conflicting occasion list).
import { BODY_SHAPES, UNDERTONES, OCCASIONS, FIT_TYPES } from '../../../../constants/productOptions';

export default function AiAttributesTab({ products = [], onSaved }) {
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '');
  const [attributes, setAttributes] = useState({
    body_shapes: [],
    undertone: 'NEUTRAL',
    occasions: [],
    fit_type: 'REGULAR',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selectedProduct = products.find((p) => String(p.id) === String(selectedProductId));

  // Sync state whenever selected product changes
  useEffect(() => {
    if (selectedProduct) {
      const existingTags = selectedProduct.ai_tags || {};
      setAttributes({
        body_shapes: existingTags.body_shapes || [],
        undertone: existingTags.undertone || 'NEUTRAL',
        occasions: existingTags.occasions || [],
        fit_type: existingTags.fit_type || 'REGULAR',
      });
      setMessage('');
    }
  }, [selectedProductId, selectedProduct]);

  const toggleArrayItem = (key, value) => {
    setAttributes((prev) => {
      const currentList = prev[key] || [];
      const exists = currentList.includes(value);
      return {
        ...prev,
        [key]: exists ? currentList.filter((item) => item !== value) : [...currentList, value],
      };
    });
  };

  const handleSave = async () => {
    if (!selectedProductId) return;
    setSaving(true);
    setMessage('');

    try {
      // NOTE: `api` already has `/api` as its baseURL — adding it here would
      // produce `/api/api/...` and 404.
      await api.patch(`/products/${selectedProductId}/ai-tags`, attributes);

      // Update local object representation so changes persist in view
      if (selectedProduct) {
        selectedProduct.ai_tags = { ...attributes };
      }

      setMessage('AI attributes successfully updated!');

      // Ask the parent to re-fetch the catalog so this edit is not silently
      // lost the next time another admin reloads the list.
      if (onSaved) await onSaved();
    } catch (err) {
      console.error(err);
      setMessage('Failed to save AI attributes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 text-hiraya-ink">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-wider uppercase">Garment AI Styling Tags</h2>
        <p className="text-xs text-hiraya-olive/70 mt-1">
          Configure physical attributes so the AI Assistant knows when to recommend this item to users.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Product Selector */}
        <div className="bg-hiraya-cream-deep/90 border border-hiraya-sand/30 p-4 rounded-lg self-start">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-hiraya-ink">
            Select Garment
          </label>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="w-full bg-hiraya-olive border border-hiraya-sand/40 p-2.5 rounded text-sm mb-4 focus:outline-none focus:border-hiraya-gold"
          >
            {products.length === 0 ? (
              <option value="">No products available</option>
            ) : (
              products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.title} ({p.category || 'General'})
                </option>
              ))
            )}
          </select>

          {selectedProduct && (
            <div className="bg-hiraya-olive p-3 rounded border border-hiraya-sand/30 flex gap-3 items-center">
              {(selectedProduct.display_image_url || selectedProduct.image_url) && (
                <img
                  // The AI cut-out, so the tag editor previews the real catalog image.
                  src={selectedProduct.display_image_url || selectedProduct.image_url}
                  alt={selectedProduct.name}
                  className="w-16 h-20 object-cover rounded"
                />
              )}
              <div>
                <h4 className="font-bold text-sm">{selectedProduct.name || selectedProduct.title}</h4>
                <p className="text-xs text-hiraya-ink font-mono mt-1">
                  ₱{Number(selectedProduct.price || 0).toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: AI Tagging Form */}
        <div className="lg:col-span-2 bg-hiraya-cream-deep/90 border border-hiraya-sand/30 p-5 rounded-lg space-y-6">
          {/* Target Body Shapes */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-hiraya-ink">
              Compatible Body Shapes
            </label>
            <div className="flex flex-wrap gap-2">
              {BODY_SHAPES.map(({ value, label }) => {
                const active = attributes.body_shapes?.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleArrayItem('body_shapes', value)}
                    className={`px-3 py-1.5 rounded text-xs transition font-medium border ${
                      active
                        ? 'bg-[#CB997E] border-hiraya-gold text-hiraya-olive font-bold'
                        : 'bg-hiraya-olive border-hiraya-sand/40 text-hiraya-ink hover:border-hiraya-sand/50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color Undertone */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-hiraya-ink">
              Color Undertone Match
            </label>
            <div className="flex flex-wrap gap-4">
              {UNDERTONES.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="undertone"
                    value={value}
                    checked={attributes.undertone === value}
                    onChange={(e) => setAttributes({ ...attributes, undertone: e.target.value })}
                    className="accent-stone-200"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Occasion & Style Vibe */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-hiraya-ink">
              Style Vibe / Occasion
            </label>
            <div className="flex flex-wrap gap-2">
              {OCCASIONS.map(({ value, label }) => {
                const active = attributes.occasions?.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleArrayItem('occasions', value)}
                    className={`px-3 py-1.5 rounded text-xs transition font-medium border ${
                      active
                        ? 'bg-[#CB997E] border-hiraya-gold text-hiraya-olive font-bold'
                        : 'bg-hiraya-olive border-hiraya-sand/40 text-hiraya-ink hover:border-hiraya-sand/50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fit Type */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-hiraya-ink">
              Fit Type
            </label>
            <select
              value={attributes.fit_type}
              onChange={(e) => setAttributes({ ...attributes, fit_type: e.target.value })}
              className="bg-hiraya-olive border border-hiraya-sand/40 p-2.5 rounded text-sm w-full focus:outline-none focus:border-hiraya-gold"
            >
              {FIT_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Action & Feedback */}
          <div className="pt-4 border-t border-hiraya-sand/30 flex items-center justify-between">
            <span className="text-xs text-hiraya-ink font-mono">{message}</span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !selectedProductId}
              className="bg-[#CB997E] hover:bg-[#CB997E] text-hiraya-olive font-semibold px-6 py-2.5 rounded text-xs tracking-wider uppercase transition disabled:opacity-50"
            >
              {saving ? 'SAVING...' : 'SAVE AI TAGS'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}