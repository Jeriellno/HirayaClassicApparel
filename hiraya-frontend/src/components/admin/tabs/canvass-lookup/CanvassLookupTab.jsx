import React, { useState } from 'react';
import api from '../../../../api/axios';
import { getProductImageUrl } from '../../../../utils/imageHelper';

export default function CanvassLookupTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [wishlistData, setWishlistData] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    setLoading(true);
    try {
      // NOTE: `api` already has `/api` as its baseURL — adding it here would
      // produce `/api/api/...` and 404. Route lives in routes/api.php.
      const res = await api.get('/admin/wishlist-lookup', {
        params: { query: searchQuery },
      });
      setWishlistData(res.data);
    } catch (err) {
      console.error(err);
      setWishlistData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 text-stone-200">
      <h2 className="text-xl font-bold mb-4 tracking-wider">CANVASS & FITTING LOOKUP</h2>
      
      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Enter Customer Name or Email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-neutral-900 border border-neutral-700 p-3 rounded text-sm w-full focus:outline-none focus:border-stone-300"
        />
        <button 
          type="submit" 
          disabled={loading}
          className="bg-[#E9C46A] hover:bg-[#d8b257] text-black px-6 py-3 rounded text-sm font-semibold tracking-wider transition disabled:opacity-50"
        >
          {loading ? 'SEARCHING...' : 'LOOKUP'}
        </button>
      </form>

      {/* Result View */}
      {wishlistData ? (
        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-lg">
          <div className="flex justify-between items-center border-b border-neutral-800 pb-3 mb-4">
            <div>
              <h3 className="font-bold text-lg">{wishlistData.user_name}</h3>
              <p className="text-xs text-neutral-400">Ref Code: {wishlistData.reference_code}</p>
            </div>
            <span className="bg-[#E9C46A]/10 text-stone-200 text-xs px-3 py-1 rounded border border-stone-300/20">
              {wishlistData.items?.length || 0} Items in Bag
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {wishlistData.items?.map((item) => {
              // I-resolve ang tamang proxied URL gamit ang imageHelper
              const imageUrl = getProductImageUrl(
                item.display_image_url || item.image_url || item.image_path || item.image
              );

              return (
                <div key={item.id} className="flex gap-4 bg-neutral-950 p-3 rounded border border-neutral-800">
                  <img 
                    src={imageUrl} 
                    alt={item.name || 'Garment'} 
                    className="w-16 h-20 object-cover rounded bg-neutral-900"
                    onError={(e) => {
                      // Fallback kapag nag-fail ang pag-load ng image
                      e.currentTarget.src = '/images/placeholder.svg';
                    }}
                  />
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm">{item.name}</h4>
                    <p className="text-xs text-neutral-400">Category: {item.category}</p>
                    <p className="text-xs text-stone-200 font-mono mt-1">Rack: {item.rack_location || 'Main Display'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-neutral-500 border border-dashed border-neutral-800 rounded">
          Enter a customer code or name above to pull up their online AI styling canvass.
        </div>
      )}
    </div>
  );
}