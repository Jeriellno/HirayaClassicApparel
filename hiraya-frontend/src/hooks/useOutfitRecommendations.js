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
        /*
         * The sizing profile is two labels now, so those are the only two values
         * that can change the result. Listing five measurement columns that no
         * longer exist only produced cache keys that were unique per null.
         */
        user?.upper_body_size ?? null,
        user?.lower_body_size ?? null,
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