import React from 'react';
import { LayoutDashboard, Package, LogOut, Truck, Search, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const adminNavLinks = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
  { id: 'inventory', name: 'Inventory Catalog', icon: Package },
  { id: 'orders', name: 'Order Management', icon: Truck },
  { id: 'canvass-lookup', name: 'Canvass Lookup', icon: Search },
  // Stock Alerts moved OUT of the sidebar into a navbar icon (left of Logout).
];

const AdminLayout = ({ activeTab, setActiveTab, ordersBadge = 0, stockAlertsCount = 0, children }) => {
  const navigate = useNavigate();

  const handleExit = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-[#07090D] text-white flex font-sans">
      {/* Permanent Sidebar — always visible */}
      <aside className="fixed inset-y-0 left-0 z-40 w-64 bg-[#0A0D14] border-r border-[#E9C46A]/20 pt-24 px-4 overflow-y-auto">
        <p className="text-[10px] text-[#E9C46A]/70 uppercase tracking-widest px-3 mb-4 font-semibold">
          Control Panel Subsystems
        </p>
        <nav className="space-y-1">
          {adminNavLinks.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs uppercase tracking-wider transition-all ${
                  isActive
                    ? 'bg-[#E9C46A]/15 text-[#E9C46A] border border-[#E9C46A]/40 font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon size={16} className={isActive ? 'text-[#E9C46A]' : 'text-gray-400'} />
                  {item.name}
                </div>

                {item.id === 'orders' && ordersBadge > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1.5 flex items-center justify-center rounded-full bg-[#E9C46A]/15 text-stone-200 border-stone-300/30 text-[9px] font-bold">
                    {ordersBadge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — fixed */}
        <header className="fixed top-0 left-0 w-full bg-[#07090D]/95 backdrop-blur-md border-b border-[#E9C46A]/30 z-50 px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-light tracking-[0.2em] text-[#E9C46A] uppercase font-serif">
                  Hiraya Admin Console
                </h1>
              </div>
              <span className="text-[10px] bg-[#E9C46A]/20 text-[#E9C46A] px-2 py-0.5 rounded border border-[#E9C46A]/40 uppercase tracking-widest font-semibold">
                Admin Level
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Stock Alerts icon — opens the same alerts view that used to live in
                the sidebar. A badge appears when items are below the healthy threshold. */}
            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              title="Stock Alerts"
              className={`relative flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-all uppercase tracking-wider ${
                activeTab === 'alerts'
                  ? 'text-[#E9C46A] bg-[#E9C46A]/15 border-[#E9C46A]/40'
                  : 'text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 border-white/10'
              }`}
            >
              <AlertTriangle size={14} />
              <span className="hidden sm:inline">Alerts</span>
              {stockAlertsCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold">
                  {stockAlertsCount}
                </span>
              )}
            </button>

            <button
              onClick={handleExit}
            className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-lg transition-all uppercase tracking-wider"
          >
              <LogOut size={14} /> Logout
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="pt-24 pb-16 px-6 md:px-12 ml-64">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;