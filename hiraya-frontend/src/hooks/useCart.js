import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { normalizeCartPayload } from '../utils/cartShape';

/**
 * Central cart data hook — the single source of truth for My Bag.
 */
export const useCart = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cart'],
    queryFn: async () => {
      const res = await api.get('/cart');
      return normalizeCartPayload(res.data);
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });

  const normalized = normalizeCartPayload(data);
  const items = normalized.items;

  const addItemMutation = useMutation({
    mutationFn: async ({ product_id, quantity = 1, selected_size, selected_color }) => {
      const res = await api.post('/cart', {
        product_id,
        quantity,
        selected_size,
        selected_color,
      });
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, quantity }) => {
      const res = await api.put(`/cart/${id}`, { quantity });
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });

  const removeItemMutation = useMutation({
    mutationFn: async (id) => api.delete(`/cart/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['cart'] });
      const previous = queryClient.getQueryData(['cart']);

      queryClient.setQueryData(['cart'], (old) => {
        if (!old?.items) return old;
        return { ...old, items: old.items.filter((i) => i.id !== id) };
      });

      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['cart'], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });

  const clearCartMutation = useMutation({
    mutationFn: async () => api.delete('/cart'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });

  const localTotal = useMemo(
    () =>
      items.reduce((acc, item) => {
        const raw = item?.product?.price ?? 0;
        const price = typeof raw === 'string' ? Number(raw.replace(/[^0-9.-]+/g, '')) : Number(raw);
        const qty = Number(item?.quantity || 1);
        return acc + (isNaN(price) ? 0 : price) * qty;
      }, 0),
    [items]
  );

  const total = normalized.total > 0 ? normalized.total : localTotal;

  return {
    cartItems: items,
    cartCount: normalized.count || items.reduce((a, i) => a + (i.quantity || 1), 0),
    total,
    dpAmount: Number((total / 2).toFixed(2)),
    balanceAmount: Number((total / 2).toFixed(2)),
    isLoading: isLoading && !!user,
    isError,

    addToCart: (payload) => addItemMutation.mutateAsync(payload),
    isAdding: addItemMutation.isPending,

    updateQuantity: (id, quantity) => updateItemMutation.mutate({ id, quantity }),
    isUpdating: updateItemMutation.isPending,

    removeItem: (id) => removeItemMutation.mutate(id),
    isRemoving: removeItemMutation.isPending,

    clearCart: () => clearCartMutation.mutate(),
    isClearing: clearCartMutation.isPending,
  };
};