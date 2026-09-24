import React, { useState, useEffect } from 'react';
import { Package, Image as ImageIcon, Ruler, Save, X, Trash2 } from 'lucide-react';

const ProductTabForm = ({
  productToEdit = null,
  defaultImageUrl = '',
  onSave,
  onCancel,
  onDelete,
}) => {
  const [activeTab, setActiveTab] = useState('basic');

  const [formData, setFormData] = useState({
    name: '',
    category: 'TOPS',
    price: '',
    description: '',
    image_url: '',
    sizes: {
      S: { stock: 0, chest: '', length: '', shoulder: '' },
      M: { stock: 0, chest: '', length: '', shoulder: '' },
      L: { stock: 0, chest: '', length: '', shoulder: '' },
      XL: { stock: 0, chest: '', length: '', shoulder: '' },
    },
  });

  useEffect(() => {
    if (productToEdit) {
      setFormData({
        name: productToEdit.name || '',
        category: productToEdit.category || 'TOPS',
        price: productToEdit.price || '',
        description: productToEdit.description || '',
        image_url: productToEdit.image_url || '',
        sizes: productToEdit.sizes || formData.sizes,
      });
    }
  }, [productToEdit]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSizeChange = (sizeKey, field, value) => {
    setFormData((prev) => ({
      ...prev,
      sizes: {
        ...prev.sizes,
        [sizeKey]: {
          ...prev.sizes[sizeKey],
          [field]: value,
        },
      },
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSave) {
      onSave(formData, !!productToEdit);
    }
  };

  return (
    <div className="w-full max-w-4xl bg-[#0D1017] border border-[#E9C46A]/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
      {/* Form Header */}
      <div className="px-6 py-4 bg-[#161B22] border-b border-white/10 flex justify-between items-center">
        <div>
          <h3 className="text-base font-bold font-mono text-white">
            {productToEdit ? 'Edit Garment Entry' : 'Add New Garment'}
          </h3>
          <p className="text-xs text-gray-400 font-mono">
            {productToEdit ? `Updating ID: #${productToEdit.id}` : 'Fill in the details to add to inventory'}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-gray-400 hover:text-white p-1 rounded-lg transition"
        >
          <X size={18} />
        </button>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-white/10 bg-[#0D1017] px-6 pt-3 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('basic')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-mono rounded-t-xl transition ${
            activeTab === 'basic'
              ? 'bg-[#161B22] text-[#E9C46A] border-t border-x border-[#E9C46A]/30 font-bold'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <Package size={14} /> Basic Info
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('media')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-mono rounded-t-xl transition ${
            activeTab === 'media'
              ? 'bg-[#161B22] text-[#E9C46A] border-t border-x border-[#E9C46A]/30 font-bold'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <ImageIcon size={14} /> Media & Asset
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('sizes')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-mono rounded-t-xl transition ${
            activeTab === 'sizes'
              ? 'bg-[#161B22] text-[#E9C46A] border-t border-x border-[#E9C46A]/30 font-bold'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <Ruler size={14} /> Sizes & Measurements
        </button>
      </div>

      {/* Form Body */}
      <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
        {/* TAB 1: BASIC INFO */}
        {activeTab === 'basic' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-gray-300 mb-1">Garment Name</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="e.g. Classic Barong Tagalog"
                className="w-full bg-[#161B22] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:border-[#E9C46A] focus:outline-none"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono text-gray-300 mb-1">Category</label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="w-full bg-[#161B22] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:border-[#E9C46A] focus:outline-none"
                >
                  <option value="TOPS">Tops / Shirts</option>
                  <option value="BARONG">Barong</option>
                  <option value="DRESS">Dress / Filipiniana</option>
                  <option value="BOTTOMS">Pants / Bottoms</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono text-gray-300 mb-1">Price (PHP)</label>
                <input
                  type="number"
                  name="price"
                  value={formData.price}
                  onChange={handleChange}
                  placeholder="0.00"
                  className="w-full bg-[#161B22] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:border-[#E9C46A] focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-gray-300 mb-1">Description</label>
              <textarea
                name="description"
                rows="4"
                value={formData.description}
                onChange={handleChange}
                placeholder="Enter garment details or material notes..."
                className="w-full bg-[#161B22] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:border-[#E9C46A] focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* TAB 2: MEDIA */}
        {activeTab === 'media' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-gray-300 mb-1">Image URL</label>
              <input
                type="text"
                name="image_url"
                value={formData.image_url}
                onChange={handleChange}
                placeholder="https://example.com/image.png"
                className="w-full bg-[#161B22] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:border-[#E9C46A] focus:outline-none"
              />
            </div>

            <div className="border border-dashed border-white/10 rounded-xl p-4 flex flex-col items-center justify-center bg-[#161B22]/50 min-h-[160px]">
              {formData.image_url ? (
                <img
                  src={formData.image_url}
                  alt="Preview"
                  className="max-h-40 object-contain rounded-lg border border-white/10"
                  onError={(e) => (e.target.src = defaultImageUrl)}
                />
              ) : (
                <div className="text-center text-gray-500 font-mono text-xs">
                  <ImageIcon size={28} className="mx-auto mb-2 opacity-50" />
                  Image Preview Will Appear Here
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SIZES & MEASUREMENTS */}
        {activeTab === 'sizes' && (
          <div className="space-y-4">
            <p className="text-xs text-gray-400 font-mono">
              Set stock inventory and specs for each standard garment size.
            </p>

            <div className="space-y-3">
              {Object.keys(formData.sizes).map((szKey) => (
                <div key={szKey} className="bg-[#161B22] p-3 rounded-xl border border-white/5 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-mono font-bold text-[#E9C46A]">Size {szKey}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-gray-400">Stock Qty:</span>
                      <input
                        type="number"
                        value={formData.sizes[szKey].stock}
                        onChange={(e) => handleSizeChange(szKey, 'stock', e.target.value)}
                        className="w-16 bg-[#0D1017] border border-white/10 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Chest (in)"
                      value={formData.sizes[szKey].chest}
                      onChange={(e) => handleSizeChange(szKey, 'chest', e.target.value)}
                      className="bg-[#0D1017] border border-white/10 rounded px-2 py-1 text-[11px] text-white"
                    />
                    <input
                      type="text"
                      placeholder="Length (in)"
                      value={formData.sizes[szKey].length}
                      onChange={(e) => handleSizeChange(szKey, 'length', e.target.value)}
                      className="bg-[#0D1017] border border-white/10 rounded px-2 py-1 text-[11px] text-white"
                    />
                    <input
                      type="text"
                      placeholder="Shoulder (in)"
                      value={formData.sizes[szKey].shoulder}
                      onChange={(e) => handleSizeChange(szKey, 'shoulder', e.target.value)}
                      className="bg-[#0D1017] border border-white/10 rounded px-2 py-1 text-[11px] text-white"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="pt-4 border-t border-white/10 flex items-center justify-between">
          {productToEdit && onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(productToEdit.id)}
              className="px-3.5 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono rounded-xl hover:bg-red-500/20 transition flex items-center gap-1.5"
            >
              <Trash2 size={14} /> Delete
            </button>
          ) : (
            <div></div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-[#161B22] text-gray-300 text-xs font-mono rounded-xl border border-white/10 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#E9C46A] hover:bg-[#D4A94F] text-black font-bold text-xs font-mono rounded-xl transition flex items-center gap-1.5"
            >
              <Save size={14} /> Save Garment
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default ProductTabForm;