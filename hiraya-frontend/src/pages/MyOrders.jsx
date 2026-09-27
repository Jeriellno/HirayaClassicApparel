import { useNavigate } from 'react-router-dom';
import { Package, ShoppingBag } from 'lucide-react';

import OrdersTab from '../components/account/OrdersTab';

/**
 * Standalone"My Orders" page.
 *
 * WHY THIS EXISTS: orders used to be reachable only as a tab inside the
 * consolidated CustomerAccount dashboard (/account?tab=orders). With the
 * customer dashboard retired, orders needed a first-class destination that the
 * Navbar can deep-link to directly — hence /orders.
 *
 * WHY IT IS SO THIN: `OrdersTab` already owns its own data layer. It fetches
 * /orders itself, handles the 2-step payment flow (balance settlement, rejected
 * DP re-upload) and exposes its own refresh. This page deliberately adds ONLY
 * the shell that the dashboard used to provide — page padding, the Hiraya
 * heading and the return-to-bag affordance — so there is exactly one source of
 * truth for order state rather than a duplicate copy here.
 */
const MyOrders = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-hiraya-bg px-4 sm:px-6 md:px-16 pt-28 pb-20 text-hiraya-ink">
            <div className="max-w-5xl mx-auto">
                {/* PAGE HEADER */}
                <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
                    <div>
                        <span className="text-[10px] uppercase tracking-[0.4em] font-black text-hiraya-ink flex items-center gap-2">
                            <Package size={13} /> Hiraya Account
                        </span>
                        <h2 className="text-3xl md:text-4xl font-light uppercase tracking-[0.2em] mt-2 text-hiraya-ink">
                            My Orders
                        </h2>
                    </div>

                    <button
                        onClick={() => navigate('/cart')}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-hiraya-gold/50 bg-[#CB997E]/10 text-hiraya-ink text-[10px] font-black uppercase tracking-widest hover:bg-[#CB997E]/15 transition"
                    >
                        <ShoppingBag size={14} /> My Bag
                    </button>
                </div>

                {/* Order list, tracking and payment actions */}
                <OrdersTab />
            </div>
        </div>
    );
};

export default MyOrders;
