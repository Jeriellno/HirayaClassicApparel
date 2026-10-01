import React from 'react';
import { useTransparentImage } from '../hooks/useTransparentImage';
import { Loader2 } from 'lucide-react';

export const StyleStackGarmentCard = ({ item, onSelect }) => {
  const originalImageUrl = item?.product?.image_url || item?.image_url || item?.image;
  const productName = item?.product?.name || item?.name || 'Garment Item';

  const { transparentUrl, isProcessing } = useTransparentImage(originalImageUrl);

  return (
    <div 
      onClick={() => onSelect && onSelect(item)}
      className="group relative flex flex-col items-center justify-between p-3 rounded-xl border border-hiraya-olive/25 bg-hiraya-cream-deep/90/50 hover:border-hiraya-gold/50 transition-all cursor-pointer"
    >
      {/* Container para sa Transparent Garment Image */}
      <div className="relative w-full h-36 flex items-center justify-center overflow-hidden rounded-lg bg-transparent">
        {isProcessing ? (
          <div className="flex flex-col items-center gap-2 text-hiraya-sand">
            <Loader2 className="w-5 h-5 animate-spin text-hiraya-ink" />
            <span className="text-[10px] tracking-wider uppercase">Isolating Garment...</span>
          </div>
        ) : (
          <img
            src={transparentUrl || originalImageUrl}
            alt={productName}
            className="max-h-full max-w-full object-contain drop-shadow-md group-hover:scale-105 transition-transform duration-300"
            style={{ backgroundColor: 'transparent' }}
          />
        )}
      </div>

      {/* Garment Details sa ilalim */}
      <div className="w-full mt-2 text-center">
        <p className="text-xs font-medium text-hiraya-ink truncate">{productName}</p>
        {(item?.size || item?.color) && (
          <span className="text-[10px] text-hiraya-sand block">
            {item?.size} {item?.color ? `· ${item.color}` : ''}
          </span>
        )}
      </div>
    </div>
  );
};