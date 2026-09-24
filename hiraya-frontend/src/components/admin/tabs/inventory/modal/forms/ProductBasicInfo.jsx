import React from 'react';

const ProductBasicInfo = ({ formData, handleBasicChange }) => {
  return (
    <div className="space-y-4">
      {/* 1. Product Name (Dito nangyayari yung error mo kaya siniguro nating tama ang name at onChange) */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-mono uppercase text-[#E9C46A] font-bold">
            Garment Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          name="name"
          value={formData.name || ''}
          onChange={handleBasicChange}
          placeholder="e.g. Classic White Linen Button-Down"
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm font-sans text-white focus:outline-none focus:border-[#E9C46A] transition-colors"
          required
        />
      </div>

      <div className="flex gap-4">
        {/* 2. Price */}
        <div className="flex flex-col gap-1 w-1/3">
          <label className="text-[10px] font-mono uppercase text-gray-400">Price (₱)</label>
          <input
            type="number"
            name="price"
            min="0"
            step="0.01"
            value={formData.price || ''}
            onChange={handleBasicChange}
            placeholder="0.00"
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm font-sans text-white focus:outline-none focus:border-[#E9C46A] transition-colors"
          />
        </div>

        {/* 3. Category */}
        <div className="flex flex-col gap-1 w-1/3">
          <label className="text-[10px] font-mono uppercase text-gray-400">Category</label>
          <select
            name="category"
            value={formData.category || 'TOPS'}
            onChange={handleBasicChange}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-[#E9C46A] transition-colors appearance-none"
            >
            <option value="TOPS">Tops</option>
            <option value="BOTTOMS">Bottoms</option>
            <option value="DRESSES">Dresses</option>
            <option value="OUTERWEAR">Outerwear</option>
            <option value="FORMAL_MEN">Formal (Men)</option>
            <option value="FORMAL_WOMEN">Formal (Women)</option>
            <option value="FULL_BODY">Full Body</option>
          </select>
        </div>

        {/* 4. Gender */}
        <div className="flex flex-col gap-1 w-1/3">
          <label className="text-[10px] font-mono uppercase text-gray-400">Gender Target</label>
          <select
            name="gender"
            value={formData.gender || 'Men'}
            onChange={handleBasicChange}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-[#E9C46A] transition-colors appearance-none"
            >
            <option value="Men">Men</option>
            <option value="Women">Women</option>
            <option value="Unisex">Unisex</option>
          </select>
        </div>
      </div>

      {/* 5. Description */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-mono uppercase text-gray-400">Description</label>
        <textarea
          name="description"
          value={formData.description || ''}
          onChange={handleBasicChange}
          placeholder="Enter garment details, fabric info, etc."
          rows="3"
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm font-sans text-white focus:outline-none focus:border-[#E9C46A] transition-colors resize-none"
        />
      </div>
    </div>
  );
};

export default ProductBasicInfo;
