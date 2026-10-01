import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { BookOpen, Search, ChevronDown } from 'lucide-react';

/*
 * USER MANUAL — step-by-step guides for the console, shown per role (an admin
 * does not see guides for sections only the super admin has). Plain content,
 * searchable; nothing here calls the API.
 */

const GUIDES = [
  {
    id: 'start',
    title: 'Getting started',
    roles: ['admin', 'superadmin'],
    steps: [
      'Sign in at the shop’s login page with your e-mail and password, then enter the 6-digit code from your authenticator app.',
      'On your first sign-in you will be asked to set up the authenticator app (Google Authenticator, Microsoft Authenticator, etc.).',
      'Use the menu on the left to move between sections. The section you are in is shown at the top.',
      'Click “Exit Console” and confirm to sign out. Always sign out on shared computers.',
    ],
  },
  {
    id: 'dashboard',
    title: 'Reading the dashboard',
    roles: ['admin', 'superadmin'],
    steps: [
      'Pick a period at the top right: Today, 7 days, 30 days or All time. Every chart follows it.',
      'The top row shows revenue, orders, AI try-ons, customers and the average ratings.',
      'Hover a chart to see exact numbers.',
      'The Work queue card lists what needs action now (payments to verify, orders to ship, low stock). Click a line to open that section.',
    ],
  },
  {
    id: 'add-product',
    title: 'Adding a product',
    roles: ['admin', 'superadmin'],
    steps: [
      'Open Inventory Management and click “Add Product”.',
      'Drop a clear, front-facing photo of the garment into step 1 and check that it is the right item.',
      'Click “Auto-fill with AI”. The AI fills in the name, description, category and price and removes the photo background. Correct anything it got wrong in step 2.',
      'In step 3, tap every size the garment comes in and type how many you have of each (or use “Same quantity for all”).',
      'Optional — step 4: drop one photo per extra colour. Backgrounds, colour names and quantities are filled in for you; tap “Change” to fix a colour.',
      'Optional — step 5: pair it with pieces that complete the look (e.g. a polo with a coat).',
      'When the checklist at the bottom is green, click “Save product”.',
    ],
  },
  {
    id: 'orders',
    title: 'Processing an order (payment flow)',
    roles: ['admin', 'superadmin'],
    steps: [
      'Open Orders Management. New orders show “Awaiting down payment” once the customer uploads the 50% receipt.',
      'Open the order, check the receipt and reference number, then click “Approve down payment” (or reject it with a reason — the customer can re-upload).',
      'The customer then pays the balance and uploads the second receipt. Check it and click “Confirm full payment”.',
      'Add the LBC tracking number or Lalamove booking, then mark the order “Shipped”, and “Delivered” once received.',
      'The customer is notified by e-mail and in-app at every step. After delivery they can review the products.',
    ],
  },
  {
    id: 'demo',
    title: 'Demonstrating the payment flow',
    roles: ['admin', 'superadmin'],
    steps: [
      'In Orders Management click “Create demo order”. A demo order from “Demo Customer” appears with a sample down-payment receipt.',
      'Walk through the normal steps: approve the down payment, then click “Simulate customer balance payment” in the order to stand in for the customer’s second upload.',
      'Confirm the full payment, add tracking, ship and deliver. Customer e-mails go to the shop inbox (+demo).',
      'Demo orders never change stock and are left out of the dashboard. Click “Clear demo orders” when you are done.',
    ],
  },
  {
    id: 'customers',
    title: 'Customers and restoring a deleted try-on',
    roles: ['admin', 'superadmin'],
    steps: [
      'Open Customers Management and click a customer to see their details, orders and try-on history.',
      'Looks the customer deleted are marked “Deleted”. If a customer writes in asking for one back, click “Restore”.',
      'The look returns to their try-on history and they are notified by e-mail and in the app.',
    ],
  },
  {
    id: 'feedback',
    title: 'Customers feedback',
    roles: ['admin', 'superadmin'],
    steps: [
      'Customers Feedback lists ratings and comments from signed-in customers, with their names.',
      'Use the star filter to focus on low ratings that may need a follow-up.',
    ],
  },
  {
    id: 'audit',
    title: 'Audit logs and stock history',
    roles: ['admin', 'superadmin'],
    steps: [
      'Activity Log records who did what and when: sign-ins, sections opened, product and order changes, and customer account activity.',
      'Filter by person, area or date, and click a row to read the full details.',
      'Stock History (second tab) shows every stock count change and what caused it.',
    ],
  },
  {
    id: 'admins',
    title: 'Managing admins',
    roles: ['superadmin'],
    steps: [
      'Open Admin Management and click “Add admin”. Enter the name, e-mail and contact number.',
      'Type a password or leave it blank to generate one. It is shown ONCE — copy it and give it to the admin privately.',
      'The admin signs in with it and sets up their authenticator app on the first sign-in.',
      'Forgot it? Use “Reset password” to set a new one.',
      'When an admin leaves, click “Remove”, choose the reason (e.g. resigned) and confirm. Their sign-in stops working immediately; the audit history is kept.',
    ],
  },
  {
    id: 'settings',
    title: 'Settings and database backup',
    roles: ['superadmin'],
    steps: [
      'System Settings holds the store switches (e.g. maintenance mode).',
      'Database Backup downloads a full copy of the store’s data. Keep a JSON backup regularly, somewhere safe.',
      'If data is ever damaged, the SQL restore script can be run in the Supabase SQL editor to put missing rows back.',
      'The status pill at the top shows whether the AI and other services are working. Click it for details.',
    ],
  },
  {
    id: 'help',
    title: 'Getting help',
    roles: ['admin', 'superadmin'],
    steps: [
      'Open Contact Support, choose a topic, describe the problem and send. The reply comes to your e-mail.',
      'Include what you clicked and any message shown on screen — it helps solve the issue faster.',
    ],
  },
];

export default function UserManualTab({ role = 'admin' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState('start');

  const guides = useMemo(() => {
    const term = query.trim().toLowerCase();
    return GUIDES.filter((g) => g.roles.includes(role)).filter(
      (g) => !term || g.title.toLowerCase().includes(term) || g.steps.some((s) => s.toLowerCase().includes(term))
    );
  }, [role, query]);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-xl uppercase tracking-[0.05em] text-navy-900">
          <BookOpen size={20} /> User Manual
        </h2>
        <div className="relative w-full max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-hiraya-sand" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the manual…"
            aria-label="Search the manual"
            className="w-full rounded-xl border border-hiraya-structure-line bg-hiraya-surface py-2 pl-8 pr-3 text-[12px] text-hiraya-ink focus:border-hiraya-accent focus:outline-none"
          />
        </div>
      </div>

      {guides.length === 0 ? (
        <p className="rounded-xl bg-cream-200/50 px-4 py-6 text-center text-[11px] text-charcoal-500">Nothing matches “{query}”.</p>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {guides.map((g) => {
            const isOpen = open === g.id || query.trim() !== '';
            return (
              <section key={g.id} className="rounded-[18px] bg-hiraya-surface shadow-neu ring-1 ring-cream-50/80">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen && open === g.id ? null : g.id)}
                  aria-expanded={isOpen}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="text-[12px] font-bold text-hiraya-ink">{g.title}</span>
                  <ChevronDown size={15} className={`shrink-0 text-charcoal-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <ol className="space-y-2 border-t border-hiraya-structure-line/70 px-4 py-3">
                    {g.steps.map((step, i) => (
                      <li key={i} className="flex gap-2.5 text-[11.5px] leading-relaxed text-charcoal-700">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[9px] font-bold text-cream-100">{i + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

UserManualTab.propTypes = { role: PropTypes.string };
