const parseStockData = (value) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const isStockValue = (value) => {
  if (typeof value === 'number' || typeof value === 'string') {
    return value !== '' && Number.isFinite(Number(value));
  }
  return Boolean(
    value &&
    typeof value === 'object' &&
    (Number.isFinite(Number(value.stock)) || Number.isFinite(Number(value.quantity)))
  );
};

const isStockMap = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0 &&
  Object.values(value).every(isStockValue);

export const getLowStockVariants = (products, threshold) => products.flatMap((product) => {
  const sizeStocks = parseStockData(product.size_stocks);
  const sizes = parseStockData(product.sizes);
  const stockMap = isStockMap(sizeStocks)
    ? sizeStocks
    : isStockMap(sizes)
      ? sizes
      : null;

  if (!stockMap) {
    const stock = Number(product.stock || 0);
    return Number.isFinite(stock) && stock <= threshold ? [{ product, size: 'All sizes', stock }] : [];
  }

  return Object.entries(stockMap).flatMap(([size, data]) => {
    const stock = Number(
      data && typeof data === 'object'
        ? data.stock ?? data.quantity ?? 0
        : data ?? 0
    );
    return Number.isFinite(stock) && stock <= threshold ? [{ product, size, stock }] : [];
  });
});

export const countLowStockVariants = (products, threshold = 5) =>
  getLowStockVariants(products, threshold).length;
