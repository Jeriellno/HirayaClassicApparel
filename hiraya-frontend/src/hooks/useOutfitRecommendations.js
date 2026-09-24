import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

/**
 * useOutfitRecommendations
 * Fetches /api/outfits/recommended and exposes the result in a shape
 * that the Spotlight section can render directly.
 */
export const useOutfitRecommendations = (limit = 8) => {
    const { user, refreshUser } = useAuth();

    const queryKey = [
        'outfits-recommended',
        user?.id ?? 'guest',
        user?.chest_bust ?? null,
        user?.waist ?? null,
        user?.hips ?? null,
        user?.shoulder_width ?? null,
        user?.sleeve_length ?? null,
    ];

    return useQuery({
        queryKey,
        enabled: !!user,
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: false,
        queryFn: async () => {
            try {
                const res = await api.get(`/outfits/recommended?limit=${limit}`);
                return res.data;
            } catch (err) {
                if (err.response?.status === 401 && typeof refreshUser === 'function') {
                    await refreshUser();
                }
                throw err;
            }
        },
    });
};