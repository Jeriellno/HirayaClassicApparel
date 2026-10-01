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
        <div className="container-page min-h-screen pb-24 pt-32 text-hiraya-ink">
            <div className="mx-auto max-w-5xl">
                {/* PAGE HEADER */}
                <div className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-hiraya-structure-line pb-8">
                    <div data-tour="orders-header" className="section-head">
                        <span className="kicker text-hiraya-ink-muted">
                            <Package size={13} /> Hiraya Account
                        </span>
                        <h1 className="display-section mt-2 text-navy-900">
                            My Orders
                        </h1>
                    </div>

                    <button
                        onClick={() => navigate('/cart')}
                        data-tour="orders-bag"
                        className="btn-secondary cursor-pointer rounded-full"
                    >
                        <ShoppingBag size={14} /> My Bag
                    </button>
                </div>

                {/* Order list, tracking and payment actions */}
                <div data-tour="orders-list">
                    <OrdersTab />
                </div>
            </div>
        </div>
    );
};

export default MyOrders;
