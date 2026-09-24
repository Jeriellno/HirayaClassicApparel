import {
  LayoutDashboard,
  Shirt,
  Package,
  BarChart3,
  MessageSquare,
  Sliders,
  Users,
  UserCog,
  History,
  KeyRound,
  LogOut,
  Radio,
} from 'lucide-react';

/*
 * "Canvas Assets" and "AI Stylist Config" were REMOVED.
 *
 * Both were write-only subsystems: their tables (canvas_assets, ai_rules) had a
 * controller that stored rows and no reader anywhere in the application. The
 * try-on pipeline never consulted either, so uploading a cutout or building a
 * pairing rule changed nothing a customer would ever see. A control that looks
 * live but is inert is worse than no control at all, so the tabs — and their
 * backend — are gone rather than left in place as decoration.
 *
 * "Orders" and "Customers" REPLACED them: real surfaces the highest-privilege
 * role needs and previously had no access to at all.
 */
export const superAdminNavLinks = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
  { id: 'inventory', name: 'Inventory Catalog', icon: Shirt },
  { id: 'orders', name: 'Orders', icon: Package },
  { id: 'customers', name: 'Customers', icon: Users },
  { id: 'api-status', name: 'API & AI Status', icon: KeyRound },
  { id: 'analytics', name: 'Canvas Analytics', icon: BarChart3 },
  { id: 'feedback', name: 'User Feedback', icon: MessageSquare },
  { id: 'admins', name: 'Admin Accounts', icon: UserCog },
  { id: 'audit-logs', name: 'Audit Logs', icon: History },
  { id: 'settings', name: 'System Settings', icon: Sliders },
];

const SuperadminLayout = ({ activeTab, setActiveTab, onLogout, children }) => {
  return (
    <div className="min-h-screen bg-[#07090D] text-white flex font-sans">
      {/* Permanent Sidebar — always visible, no burger menu */}
      <aside className="fixed inset-y-0 left-0 z-40 w-64 bg-[#0A0D14] border-r border-[#E9C46A]/20 pt-24 px-4 overflow-y-auto">
        <p className="text-[10px] text-[#E9C46A]/70 uppercase tracking-widest px-3 mb-4 font-semibold">
          Control Panel Subsystems
        </p>
        <nav className="space-y-1">
          {superAdminNavLinks.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs uppercase tracking-wider transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#E9C46A]/15 text-[#E9C46A] border border-[#E9C46A]/40 font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-[#E9C46A]' : 'text-gray-400'} />
                {item.name}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — fixed, no burger toggle */}
        <header className="fixed top-0 left-0 w-full bg-[#07090D]/95 backdrop-blur-md border-b border-[#E9C46A]/30 z-50 px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-light tracking-[0.15em] sm:tracking-[0.2em] text-[#E9C46A] uppercase font-serif truncate">
                  Hiraya Master Console
                </h1>
                <span className="flex items-center gap-1 text-[9px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full border border-green-500/40 font-mono animate-pulse whitespace-nowrap">
                  <Radio size={10} /> Live Database Synced
                </span>
              </div>
              <span className="text-[10px] bg-[#E9C46A]/20 text-[#E9C46A] px-2 py-0.5 rounded border border-[#E9C46A]/40 uppercase tracking-widest font-semibold">
                Super Admin Level
              </span>
            </div>
          </div>

          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-lg transition-all uppercase tracking-wider"
          >
            <LogOut size={14} /> Exit Console
          </button>
        </header>

        {/*
         * Page Content
         *
         * The console body is offset by the FIXED 16rem sidebar. Previously this
         * was `ml-64 max-w-7xl w-full mx-auto`: the left margin AND the centered
         * 1280px cap stacked, so on an ordinary 1366px laptop the content was
         * pushed right and clipped past the viewport.
         *
         * `md:pl-64` keeps the sidebar offset as PADDING (so it can never collide
         * with the width cap), and `max-w-7xl mx-auto` centers the readings panel
         * inside whatever space is left. The container is only widened, never
         * forced, so it fits every normal screen.
         */}
        <main className="pt-24 pb-12 px-4 sm:px-6 md:pl-72 md:pr-8 w-full max-w-[1400px] mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

export default SuperadminLayout;
