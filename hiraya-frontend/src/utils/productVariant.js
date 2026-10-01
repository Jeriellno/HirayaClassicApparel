/**
 * COLOUR VARIANTS — resolve what a cart / order line's colour looks like.
 *
 * A product's extra colours live in `product.color_variants`, each with its own
 * photos (see ProductController::handleColorVariants). A line whose
 * `selected_color` names one of them should show THAT colour's photo, not the
 * main one; anything else (the main colour, "Standard") returns the product.
 */
export const variantForColor = (product, color) => {
  const needle = String(color || '').trim().toLowerCase();
  if (!needle || !Array.isArray(product?.color_variants)) return null;
  return product.color_variants.find((v) => String(v?.color || '').trim().toLowerCase() === needle) || null;
};

/** The product with the chosen colour's photos / name swapped in. */
export const productForColor = (product, color) => {
  const variant = variantForColor(product, color);
  if (!variant) return product;
  return {
    ...product,
    name: variant.name || product.name,
    description: variant.description || product.description,
    image_url: variant.image_url || variant.display_image_url || product.image_url,
    display_image_url: variant.display_image_url || product.display_image_url,
    ghost_mannequin_url: variant.ghost_mannequin_url || '',
    background_occasion: variant.background_occasion || product.background_occasion,
  };
};
