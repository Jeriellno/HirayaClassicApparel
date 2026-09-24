import { useState, useMemo, useCallback } from 'react';

const AVAILABLE_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

const MEASUREMENT_FIELDS = [
  { key: 'chest_bust', label: 'Chest / Bust' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'shoulder_width', label: 'Shoulder Width' },
  { key: 'sleeve_length', label: 'Sleeve Length' },
];

const isObject = (val) => typeof val === 'object' && val !== null && !Array.isArray(val);

export const useSizeInventory = (formData, setFormData) => {
  const [bulkStock, setBulkStock] = useState('');

  const getParsedSizesObject = useCallback((sizesData) => {
    if (!sizesData) return {};

    let parsed = sizesData;

    if (typeof sizesData === 'string') {
      try {
        parsed = JSON.parse(sizesData);
      } catch {
        return {};
      }
    }

    const normalized = {};

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      AVAILABLE_SIZES.forEach((size) => {
        if (Object.prototype.hasOwnProperty.call(parsed, size)) {
          const value = parsed[size];
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            normalized[size] = {
              stock: Number(value.stock) || 0,
              measurements: value.measurements || {},
            };
          } else if (typeof value === 'number') {
            normalized[size] = { stock: value, measurements: {} };
          } else {
            const quantity = Number(value);
            normalized[size] = {
              stock: Number.isNaN(quantity) || quantity < 0 ? 0 : quantity,
              measurements: {},
            };
          }
        }
      });
      return normalized;
    }

    if (Array.isArray(parsed)) {
      parsed.forEach((size) => {
        if (typeof size === 'string' && AVAILABLE_SIZES.includes(size)) {
          normalized[size] = { stock: 0, measurements: {} };
        } else if (isObject(size) && (size.size_label || size.label || size.size)) {
          const label = size.size_label || size.label || size.size;
          if (AVAILABLE_SIZES.includes(label)) {
            const measurements = {};
            MEASUREMENT_FIELDS.forEach((field) => {
              const minKey = `${field.key}_min`;
              const maxKey = `${field.key}_max`;
              if (size[minKey] !== undefined && size[minKey] !== null && size[minKey] !== '') {
                measurements[minKey] = size[minKey];
              }
              if (size[maxKey] !== undefined && size[maxKey] !== null && size[maxKey] !== '') {
                measurements[maxKey] = size[maxKey];
              }
            });
            normalized[label] = {
              stock: Number(size.stock) || 0,
              measurements: measurements,
            };
          }
        }
      });
      return normalized;
    }

    return {};
  }, []);

  const currentSizesObj = useMemo(
    () => getParsedSizesObject(formData?.sizes || formData?.size_stocks),
    [formData?.sizes, formData?.size_stocks, getParsedSizesObject]
  );

  const calculateTotalStock = useCallback((sizesObject) => {
    if (!sizesObject || typeof sizesObject !== 'object') return 0;
    return Object.values(sizesObject).reduce((total, sz) => {
      const quantity = typeof sz === 'object' ? (Number(sz.stock) || 0) : Number(sz);
      if (Number.isNaN(quantity) || quantity < 0) return total;
      return total + quantity;
    }, 0);
  }, []);

  const calculatedStock = useMemo(
    () => calculateTotalStock(currentSizesObj),
    [currentSizesObj, calculateTotalStock]
  );

  const configuredSizeCount = useMemo(
    () => AVAILABLE_SIZES.filter((size) => Object.prototype.hasOwnProperty.call(currentSizesObj, size)).length,
    [currentSizesObj]
  );

  const allSizesSelected = configuredSizeCount === AVAILABLE_SIZES.length;

  const updateFormDataSizes = useCallback((updatedSizes) => {
    const total = calculateTotalStock(updatedSizes);
    setFormData((prev) => ({
      ...prev,
      sizes: updatedSizes,
      size_stocks: updatedSizes,
      stock: total,
    }));
  }, [calculateTotalStock, setFormData]);

  const handleToggleSize = (size) => {
    const updatedSizes = { ...currentSizesObj };
    if (Object.prototype.hasOwnProperty.call(updatedSizes, size)) {
      delete updatedSizes[size];
    } else {
      const defaultVal = bulkStock !== '' && !Number.isNaN(Number(bulkStock)) && Number(bulkStock) >= 0
        ? Number(bulkStock)
        : 0;
      updatedSizes[size] = { stock: defaultVal, measurements: {} };
    }
    updateFormDataSizes(updatedSizes);
  };

  const handleSizeStockChange = (size, stockValue) => {
    if (stockValue === '') {
      const existing = currentSizesObj[size] || {};
      updateFormDataSizes({ ...currentSizesObj, [size]: { ...existing, stock: 0 } });
      return;
    }

    const quantity = Number(stockValue);
    if (Number.isNaN(quantity) || quantity < 0) return;

    const existing = currentSizesObj[size] || { measurements: {} };
    updateFormDataSizes({
      ...currentSizesObj,
      [size]: { ...existing, stock: quantity },
    });
  };

  // TINANGGAL ANG PARSEFLOAT DITO PARA HINDI MAG-LOCK ANG TYPING
  const handleMeasurementChange = useCallback((size, field, value) => {
    setFormData((prev) => {
      let sizes = prev?.sizes || prev?.size_stocks || {};
      if (typeof sizes === 'string') {
        try { sizes = JSON.parse(sizes); } catch { sizes = {}; }
      }

      const existingSize = sizes[size] || { stock: 0, measurements: {} };

      const updatedMeasurements = {
        ...(existingSize.measurements || {}),
        [field]: value, // Binibigay nang direkta ang raw text input
      };

      const updatedSizes = {
        ...sizes,
        [size]: {
          ...existingSize,
          measurements: updatedMeasurements,
        },
      };

      const total = Object.values(updatedSizes).reduce((sum, sz) => {
        const qty = typeof sz === 'object' ? Number(sz.stock) || 0 : Number(sz);
        return sum + (Number.isNaN(qty) ? 0 : qty);
      }, 0);

      return {
        ...prev,
        sizes: updatedSizes,
        size_stocks: updatedSizes,
        stock: total,
      };
    });
  }, [setFormData]);

  const handleApplyBulkStock = () => {
    if (bulkStock === '') return;
    const quantity = Number(bulkStock);
    if (Number.isNaN(quantity) || quantity < 0) return;

    const updatedSizes = { ...currentSizesObj };
    const targetSizes = configuredSizeCount === 0 ? AVAILABLE_SIZES : Object.keys(updatedSizes);

    targetSizes.forEach((size) => {
      const existing = updatedSizes[size] || { measurements: {} };
      updatedSizes[size] = { ...existing, stock: quantity };
    });

    updateFormDataSizes(updatedSizes);
  };

  const handleToggleAllSizes = () => {
    if (allSizesSelected) {
      updateFormDataSizes({});
      return;
    }

    const updatedSizes = { ...currentSizesObj };
    const defaultVal = bulkStock !== '' && !Number.isNaN(Number(bulkStock)) && Number(bulkStock) >= 0
      ? Number(bulkStock)
      : 0;

    AVAILABLE_SIZES.forEach((size) => {
      if (!Object.prototype.hasOwnProperty.call(updatedSizes, size)) {
        updatedSizes[size] = { stock: defaultVal, measurements: {} };
      }
    });

    updateFormDataSizes(updatedSizes);
  };

  const handleClearBulkStock = () => setBulkStock('');

  return {
    AVAILABLE_SIZES,
    MEASUREMENT_FIELDS,
    currentSizesObj,
    calculatedStock,
    configuredSizeCount,
    allSizesSelected,
    bulkStock,
    setBulkStock,
    handleToggleSize,
    handleSizeStockChange,
    handleMeasurementChange,
    handleApplyBulkStock,
    handleToggleAllSizes,
    handleClearBulkStock,
    getParsedSizesObject,
  };
};