import React, { useState } from 'react';
import { UserPlus, Trash2, X, Mail, User, Lock, Key, ToggleLeft, ToggleRight, Eye, EyeOff, Edit3, Save } from 'lucide-react';

export default function AdminsTab({ adminAccounts = [], onAddAdmin, onDeleteAdmin, onUpdateAdmin }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // The account currently being edited (null = the modal is in "add" mode).
  const [editingAccount, setEditingAccount] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'ADMIN',
    inventory_permissions: 'READ_WRITE',
    ai_rules_access: true,
  });

  /*
   * REAL presence — derived from the `last_login_at` the login endpoint now
   * records. The old STATUS column read `admin.is_online`, a column NO code path
   * ever wrote, so every account rendered a pulsing green ONLINE dot or a stale
   * flag that was never true. "Last seen" is a fact we actually store.
   */
  const formatLastSeen = (iso) => {
    if (!iso) return 'Never signed in';
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return 'Never signed in';
    const mins = Math.floor((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return then.toLocaleDateString();
  };

  const handleChange = (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setFormData({ ...formData, [e.target.name]: value });
  };

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Edit mode has its OWN handler  the create form's name/email/password do
    // not apply to an update.
    if (editingAccount) return handleUpdate(e);
    if (!formData.name || !formData.email || !formData.password) return;
    if (!onAddAdmin) return;

    setSubmitting(true);
    setError('');

    try {
      await onAddAdmin({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        role: formData.role.toUpperCase(),
        inventory_permissions: formData.inventory_permissions,
        ai_rules_access: formData.ai_rules_access,
      });

      // Only reset + close on success, so a failed provision (e.g. duplicate
      // email) keeps the form filled and the error visible to the superadmin.
      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'ADMIN',
        inventory_permissions: 'READ_WRITE',
        ai_rules_access: true,
      });
      setShowPassword(false);
      setIsModalOpen(false);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        (err?.response?.data?.errors?.email?.[0]) ||
        'Failed to provision the admin account.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Sigurado ka bang gusto mo burahin ang admin account na ito?')) return;
    if (!onDeleteAdmin) return;

    try {
      await onDeleteAdmin(id);
    } catch (err) {
      window.alert(err?.response?.data?.message || 'Failed to revoke the admin account.');
    }
  };

  const RESET_FORM = {
    name: '',
    email: '',
    password: '',
    role: 'ADMIN',
    inventory_permissions: 'READ_WRITE',
    ai_rules_access: true,
  };

  const openAddModal = () => {
    setEditingAccount(null);
    setFormData(RESET_FORM);
    setError('');
    setIsModalOpen(true);
  };

  const openEditModal = (admin) => {
    setEditingAccount(admin);
    setFormData({
      name: admin.full_name || admin.name || '',
      email: admin.email || '',
      password: '',
      role: String(admin.role || 'ADMIN').toUpperCase(),
      inventory_permissions: admin.inventory_permissions || 'READ_WRITE',
      ai_rules_access: admin.ai_rules_access !== false,
    });
    setError('');
    setIsModalOpen(true);
  };

  /**
   * Save  creates a NEW account, or updates the one being edited.
   *
   * Update sends a PATCH /admin/accounts/{id} (via onUpdateAdmin) with only the
   * fields the endpoint accepts (role + RBAC permissions); name/email/password
   * are NOT editable here on purpose  the backend update() only handles role and
   * permissions, so sending the others would silently no-op.
   */
  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editingAccount || !onUpdateAdmin) return;

    const nextRole = formData.role.toUpperCase();
    const currentRole = String(editingAccount.role || 'ADMIN').toUpperCase();

    /*
     * Confirm a role CHANGE before it is sent. Editing permissions is routine,
     * but changing the role alters what the account can reach — and promoting
     * someone to SUPERADMIN hands them the whole control panel. That escalation
     * previously applied instantly on Save with no confirmation, so a mis-click
     * could grant or strip the highest privilege in the system.
     */
    if (nextRole !== currentRole) {
      const promoting = nextRole === 'SUPERADMIN';
      const message = promoting
        ? `Promote ${editingAccount.email} to SUPER ADMIN?\n\nThey will gain full access to system settings, admin provisioning, audit logs and the database export.`
        : `Change ${editingAccount.email} from ${currentRole} to ${nextRole}?`;
      if (!window.confirm(message)) return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onUpdateAdmin(editingAccount.id, {
        role: nextRole,
        inventory_permissions: formData.inventory_permissions,
        ai_rules_access: formData.ai_rules_access,
      });
      setIsModalOpen(false);
      setEditingAccount(null);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        'Failed to update the admin account.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn font-mono text-xs">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-2xl font-light uppercase tracking-[0.2em] text-[#E9C46A]">
            ADMIN PRIVILEGES & RBAC ACCESS
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Super Admin exclusive: Provision system administrators and manage RBAC.
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="px-5 py-2.5 bg-[#E9C46A] hover:bg-[#D4A94F] text-black font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
        >
          <UserPlus size={16} /> ADD ADMIN ACCOUNT
        </button>
      </div>

      {/* RBAC TABLE */}
      <div className="bg-[#0A0D14] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#111622] border-b border-white/10 uppercase tracking-widest text-[10px] text-gray-400">
              <tr>
                <th className="p-4">USER DETAILS</th>
                <th className="p-4">LAST SEEN</th>
                <th className="p-4">ROLE</th>
                <th className="p-4">INVENTORY PERMISSIONS</th>
                <th className="p-4">AI RULES ACCESS</th>
                <th className="p-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-300">
              {adminAccounts && adminAccounts.length > 0 ? (
                adminAccounts.map((admin, idx) => {
                  const normalizedRole = String(admin.role || '').toUpperCase().replaceAll("_", '').replaceAll("-", '').replaceAll(" ", '');
                  const isSuperAdmin = normalizedRole === 'SUPERADMIN';
                  // (single declaration  no duplicate)
                  // no-op removed ' ');

                  return (
                    <tr key={admin.id || idx} className="hover:bg-white/5 transition">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#E9C46A]/10 border border-[#E9C46A]/30 flex items-center justify-center text-[#E9C46A] font-bold">
                            {(admin.full_name || admin.name) ? (admin.full_name || admin.name).charAt(0).toUpperCase() : 'A'}
                          </div>
                          <div>
                            <div className="font-semibold text-white">{admin.full_name || admin.name || 'Admin User'}</div>
                            <div className="text-[10px] text-gray-500">{admin.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="p-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] uppercase tracking-wider text-gray-300">
                            {formatLastSeen(admin.last_login_at)}
                          </span>
                        </div>
                      </td>

                      <td className="p-4">
                        <span
                          className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${
                            isSuperAdmin
                              ? 'bg-[#E9C46A]/10 text-stone-200 border-stone-300/30'
                              : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                          }`}
                        >
                          {admin.role || 'ADMIN'}
                        </span>
                      </td>

                      <td className="p-4 uppercase text-gray-400">
                        <span className="px-2 py-0.5 bg-white/5 rounded border border-white/10 text-[10px]">
                          {admin.inventory_permissions || 'READ_WRITE'}
                        </span>
                      </td>

                      <td className="p-4">
                        <span
                          className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${
                            admin.ai_rules_access !== false
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-red-500/10 text-red-400 border-red-500/30'
                          }`}
                        >
                          {admin.ai_rules_access !== false ? 'FULL ACCESS' : 'RESTRICTED'}
                        </span>
                      </td>

                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(admin)}
                          className="p-2 bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/30 text-blue-400 rounded-lg transition cursor-pointer"
                          title="Edit role & permissions"
                        >
                          <Edit3 size={14} />
                        </button>
                        {!isSuperAdmin && (
                          <button
                            onClick={() => handleDelete(admin.id)}
                            className="p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg transition cursor-pointer"
                            title="Delete Admin Account"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" className="py-20 text-center text-gray-500 uppercase tracking-[0.25em] font-light">
                    NO ACTIVE ADMINISTRATIVE ACCOUNTS FOUND
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* EXCLUSIVE ADMIN REGISTRATION MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-[#0A0D14] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
              <h3 className="font-bold text-[#E9C46A] uppercase tracking-wider flex items-center gap-2">
                {editingAccount ? <><Edit3 size={16} /> EDIT ADMIN ACCOUNT</> : <><UserPlus size={16} /> REGISTER ADMIN ACCOUNT</>}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg transition"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && (
                <div className="p-2.5 bg-red-500/10 border-red-500/30 text-red-400 rounded-xl text-[10px] uppercase tracking-wider">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-[10px] uppercase text-gray-400 tracking-wider mb-1 flex items-center gap-1">
                  <User size={12} /> Full Name
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  disabled={!!editingAccount}
                  placeholder="e.g. Maria Clara"
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full bg-black/50 border border-white/10 rounded-xl p-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-[#E9C46A]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase text-gray-400 tracking-wider mb-1 flex items-center gap-1">
                  <Mail size={12} /> Email
                </label>
                <input
                  type="email"
                  name="email"
                  required
                  disabled={!!editingAccount}
                  placeholder="admin@hiraya.com"
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full bg-black/50 border border-white/10 rounded-xl p-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-[#E9C46A]"
                />
              </div>


              {/* Password is create-only: the update endpoint does not change it. */}
              {!editingAccount && (
              <div>
                <label className="block text-[10px] uppercase text-gray-400 tracking-wider mb-1 flex items-center gap-1">
                  <Lock size={12} /> Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    required
                    placeholder=""
                    value={formData.password}
                    onChange={handleChange}
                    className="w-full bg-black/50 border border-white/10 rounded-xl p-2.5 pr-10 text-white placeholder-gray-600 focus:outline-none focus:border-[#E9C46A]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#E9C46A] transition cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase text-gray-400 tracking-wider mb-1 flex items-center gap-1">
                    <Key size={12} /> Role
                  </label>
                  <select
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                    className="w-full bg-black/50 border border-white/10 rounded-xl p-2.5 text-white focus:outline-none focus:border-[#E9C46A]"
                  >
                    {/*
                     * MODERATOR used to be listed here, but the backend coerces
                     * every non-superadmin role to `admin` (EnsureUserIsAdmin only
                     * understands admin/superadmin). Picking "MODERATOR" therefore
                     * created an ADMIN and the table showed a role the operator
                     * never chose. Only roles the backend actually honours are
                     * offered until a real moderator tier exists.
                     */}
                    <option value="ADMIN">ADMIN</option>
                    <option value="SUPERADMIN">SUPER ADMIN</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase text-gray-400 tracking-wider mb-1">
                    Inventory Access
                  </label>
                  <select
                    name="inventory_permissions"
                    value={formData.inventory_permissions}
                    onChange={handleChange}
                    className="w-full bg-black/50 border border-white/10 rounded-xl p-2.5 text-white focus:outline-none focus:border-[#E9C46A]"
                  >
                    <option value="READ_WRITE">READ & WRITE</option>
                    <option value="READ_ONLY">READ ONLY</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-black/40 border border-white/10 rounded-xl">
                <div>
                  <p className="text-white font-medium">AI Rules Access</p>
                  <p className="text-[9px] text-gray-500">Allow modifying Hiraya AI Fitting rules</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, ai_rules_access: !formData.ai_rules_access })}
                  className="text-[#E9C46A]"
                >
                  {formData.ai_rules_access ? <ToggleRight size={28} /> : <ToggleLeft size={28} className="text-gray-600" />}
                </button>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); setEditingAccount(null); }}
                  className="px-4 py-2 text-gray-400 hover:text-white rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#E9C46A] hover:bg-[#D4A94F] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold uppercase rounded-xl transition font-semibold flex items-center gap-2"
                >
                  {editingAccount ? <Save size={14} /> : <UserPlus size={14} />}
                  {submitting
                    ? (editingAccount ? 'Saving...' : 'Registering...')
                    : (editingAccount ? 'Save Changes' : 'Register Admin')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
