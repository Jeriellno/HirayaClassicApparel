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
    <div className="p-6 text-hiraya-ink">
      <h2 className="text-xl font-bold mb-4 tracking-wider">CANVASS & FITTING LOOKUP</h2>
      
      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Enter Customer Name or Email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-hiraya-cream-deep/90 border border-hiraya-sand/40 p-3 rounded text-sm w-full focus:outline-none focus:border-hiraya-gold"
        />
        <button 
          type="submit" 
          disabled={loading}
          className="bg-[#CB997E] hover:bg-[#d8b257] text-hiraya-olive px-6 py-3 rounded text-sm font-semibold tracking-wider transition disabled:opacity-50"
        >
          {loading ? 'SEARCHING...' : 'LOOKUP'}
        </button>
      </form>

      {/* Result View */}
      {wishlistData ? (
        <div className="bg-hiraya-cream-deep/90 border border-hiraya-sand/30 p-5 rounded-lg">
          <div className="flex justify-between items-center border-b border-hiraya-sand/30 pb-3 mb-4">
            <div>
              <h3 className="font-bold text-lg">{wishlistData.user_name}</h3>
              <p className="text-xs text-hiraya-sand">Ref Code: {wishlistData.reference_code}</p>
            </div>
            <span className="bg-[#CB997E]/10 text-hiraya-ink text-xs px-3 py-1 rounded border border-hiraya-olive/15">
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
                <div key={item.id} className="flex gap-4 bg-hiraya-olive p-3 rounded border border-hiraya-sand/30">
                  <img 
                    src={imageUrl} 
                    alt={item.name || 'Garment'} 
                    className="w-16 h-20 object-cover rounded bg-hiraya-cream-deep/90"
                    onError={(e) => {
                      // Fallback kapag nag-fail ang pag-load ng image
                      e.currentTarget.src = '/images/placeholder.svg';
                    }}
                  />
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm">{item.name}</h4>
                    <p className="text-xs text-hiraya-sand">Category: {item.category}</p>
                    <p className="text-xs text-hiraya-ink font-mono mt-1">Rack: {item.rack_location || 'Main Display'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-neutral-500 border border-dashed border-hiraya-sand/30 rounded">
          Enter a customer code or name above to pull up their online AI styling canvass.
        </div>
      )}
    </div>
  );
}