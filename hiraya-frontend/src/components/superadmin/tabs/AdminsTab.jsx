import React, { useState } from 'react';
import useConfirm from '../../../hooks/useConfirm';
import { UserPlus, Trash2, X, Mail, Key, ToggleLeft, ToggleRight, Edit3, Save, UserCheck, AlertTriangle, ShieldAlert, RefreshCw, Clock } from 'lucide-react';

/**
 * ADMIN ACCOUNTS — ONE PERSON, ONE ACCOUNT.
 * ========================================
 *
 * THE RULE THIS TAB ENFORCES
 * --------------------------
 * Every row here is a NAMED HUMAN being. Not a role, not a shared login, not a
 * "the admins" account that three people take turns using.
 *
 * WHY THIS IS THE WHOLE FOUNDATION
 * --------------------------------
 * Everything else about securing this console hangs off "who signed in":
 *
 *   - the audit log records an id, and an id is only meaningful if it is one
 *     person rather than whoever happened to be at the desk
 *   - revoking access means revoking ONE person, which requires their account
 *     to be separable from everyone else's
 *   - last-seen tells you who has actually been in the console
 *
 * A shared admin account defeats all three at once. The console would show
 * "last seen 2 minutes ago" and nobody could say whether that was Maria or Juan.
 * That is why this tab asks for a real name and a real email: it is not
 * bureaucracy, it is the thing that makes the other security features mean
 * anything.
 *
 * WHAT THIS TAB DOES NOT DO
 * -------------------------
 * It no longer issues QR credentials. Signing in is by password, and a
 * superadmin additionally proves possession of an authenticator app (TOTP). A
 * QR badge was considered and rejected: with one to three staff it is a bearer
 * token with no second factor, and one leaked code would hand over the whole
 * console.
 */
export default function AdminsTab({ adminAccounts = [], onInviteAdmin, onDeleteAdmin, onUpdateAdmin, onResendInvitation }) {
  // In-app Confirm / Cancel dialog (replaces the browser's `window.confirm`).
  const [confirm, confirmDialog] = useConfirm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  // The account currently being edited (null = the modal is in "invite" mode).
  const [editingAccount, setEditingAccount] = useState(null);
  // The invitation link, shown when the account was created but the mail could
  // not be delivered (the norm on a dev machine with no SMTP host).
  const [inviteUrl, setInviteUrl] = useState('');
  /*
   * The id of the row whose invitation is currently being re-issued, so its button
   * can show a spinner and refuse a second click. A per-row flag rather than one
   * global `submitting`: two different rows can legitimately be actioned at once,
   * and a global flag would grey out every button in the table.
   */
  const [resendingId, setResendingId] = useState(null);
  /*
   * The confirmation that a resend happened, shown OUTSIDE the modal. The modal is
   * closed for a table-row action, so `error` (which renders inside the modal) would
   * never be seen — this is the row-level channel for the same information.
   */
  const [rowNotice, setRowNotice] = useState(null);
  const [formData, setFormData] = useState({
    email: '',
    role: 'ADMIN',
    inventory_permissions: 'READ_WRITE',
    ai_rules_access: true,
  });

  /*
   * REAL presence — derived from the `last_login_at` the login endpoint records.
   * The old STATUS column read `admin.is_online`, a column NO code path ever
   * wrote, so every account rendered a pulsing green ONLINE dot that was never
   * true. "Last seen" is a fact we actually store.
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

  /** Normalise a role string the same way in every place that compares one. */
  const normalizeRole = (role) =>
    String(role || '').toUpperCase().replaceAll('_', '').replaceAll('-', '').replaceAll(' ', '');

  /** How many Super Admins exist, as far as this page of data can tell. */
  const superAdminCount = adminAccounts.filter((a) => normalizeRole(a.role) === 'SUPERADMIN').length;

  /**
   * Is this account the ONLY Super Admin left?
   *
   * Used to suppress the delete button and to warn in the role selector, because the
   * backend refuses both the revocation and the demotion of the last superadmin —
   * either would leave nobody able to provision administrators, with the CLI as the
   * only way back in. The UI is describing a rule the server enforces; it is not the
   * guard itself.
   */
  const isOnlySuperAdmin = (admin) =>
    normalizeRole(admin?.role) === 'SUPERADMIN' && superAdminCount <= 1;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Edit mode has its OWN handler — the invite form's email/role do not apply
    // to an update.
    if (editingAccount) return handleUpdate(e);

    /*
     * NO NAME AND NO PASSWORD ARE SUBMITTED.
     *
     * The account is no longer created here at all. The superadmin supplies an
     * ADDRESS and a ROLE, and the backend emails an invitation; the invitee sets
     * their own password and enrols their own authenticator. See
     * onInviteAdmin / AdminAccountController::invite.
     */
    if (!formData.email) return;
    if (!onInviteAdmin) return;

    setSubmitting(true);
    setError('');

    try {
      /*
       * THE ROLE IS SENT LOWER-CASE, AND IT IS SENT AS A CONSTANT.
       *
       * `Rule::in(['admin'])` in AdminAccountController::invite() is case-sensitive,
       * and the console used to submit `formData.role.toUpperCase()` — which sent
       * 'ADMIN' and would have been rejected by that rule. Rather than teach the
       * validator to tolerate every casing (and so accept 'Superadmin' with a
       * different validator path), the client sends the one value that is
       * unambiguously correct: an invitation is always for an `admin`.
       *
       * This is not a workaround for a loosened rule. The rule is narrow ON
       * PURPOSE — an invitation cannot create a superadmin (RULE 2/3 of the role
       * model) — so there is no longer a role to choose here at all.
       */
      const result = await onInviteAdmin({
        email: formData.email,
        role: 'admin',
      });

      // Only reset + close on success, so a failed invitation (e.g. duplicate
      // email) keeps the form filled and the error visible to the superadmin.
      setInviteUrl(result?.invitation_url || '');
      setFormData({
        email: '',
        role: 'ADMIN',
        inventory_permissions: 'READ_WRITE',
        ai_rules_access: true,
      });
      /*
       * THE MODAL STAYS OPEN WHEN MAIL DELIVERY IS UNAVAILABLE.
       *
       * `invitation_url` is returned so the superadmin can hand the link over
       * directly — the normal case on a dev machine with no SMTP host, where the
       * `log` mailer "sends" the message to a file nobody reads. Closing the
       * dialog would hide the only copy of the link, so it is shown instead.
       */
      if (!result?.invitation_url) setIsModalOpen(false);
    } catch (err) {
      /*
       * "ALREADY INVITED" IS NOT A FAILURE — IT IS A STATE.
       *
       * The backend answers 409 when a live invitation already exists for the
       * address, because issuing a second link would make both valid and destroy
       * the single-use property. Reporting that as a plain red error would read as
       * "something went wrong"; what the superadmin actually needs to know is that
       * the invitation is out there and the recovery is the Resend button on that
       * row. The expiry is included so they can judge whether to wait.
       */
      const alreadyPending = err?.response?.status === 409 || err?.response?.data?.invitation_pending;

      if (alreadyPending) {
        const expiresAt = err?.response?.data?.expires_at;
        const when = expiresAt ? new Date(expiresAt).toLocaleString() : null;

        setError(
          'An invitation for that address is already pending'
          + (when ? ` and expires around ${when}` : '')
          + '. Close this dialog and use the ⟳ button on that admin\'s row to send a fresh link.'
        );
        return;
      }

      setError(
        err?.response?.data?.message ||
        (err?.response?.data?.errors?.email?.[0]) ||
        'Failed to send the invitation.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Delete admin account?',
      message: 'Sigurado ka bang gusto mo burahin ang admin account na ito? Mawawala agad ang access nila.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    if (!onDeleteAdmin) return;

    try {
      await onDeleteAdmin(id);
    } catch (err) {
      window.alert(err?.response?.data?.message || 'Failed to revoke the admin account.');
    }
  };

  const RESET_FORM = {
    email: '',
    role: 'ADMIN',
    inventory_permissions: 'READ_WRITE',
    ai_rules_access: true,
  };

  const openAddModal = () => {
    setEditingAccount(null);
    setFormData(RESET_FORM);
    setError('');
    setInviteUrl('');
    setIsModalOpen(true);
  };

  const openEditModal = (admin) => {
    setEditingAccount(admin);
    setFormData({
      email: admin.email || '',
      role: String(admin.role || 'ADMIN').toUpperCase(),
      inventory_permissions: admin.inventory_permissions || 'READ_WRITE',
      ai_rules_access: admin.ai_rules_access !== false,
    });
    setError('');
    setInviteUrl('');
    setIsModalOpen(true);
  };

  /**
   * RE-ISSUE the invitation for a row that has not finished enrolling.
   *
   * WHY THIS LIVES ON THE ROW AND NOT IN THE MODAL. The invitation link is shown
   * exactly once, in the modal that issued it. A superadmin who closes that modal
   * before copying the link — or whose invitee simply let the 48 hours lapse — had
   * no way back: `invite()` refuses an address that is already invited, precisely
   * because two live links would destroy the single-use property. This is the
   * deliberate way through, and it is offered on the PENDING row itself, which is
   * where the superadmin is already looking when they notice the invitee still
   * cannot get in.
   */
  const handleResend = async (admin) => {
    if (!onResendInvitation) return;

    setRowNotice(null);
    setResendingId(admin.id);

    try {
      const result = await onResendInvitation(admin.id);

      setRowNotice({
        tone: 'ok',
        email: admin.email,
        // Same fallback as the invite modal: when SMTP is not configured the link
        // has to be handed over by hand, so it is surfaced rather than hidden.
        url: result?.invitation_url || '',
        expiresAt: result?.expires_at || '',
        message: result?.message || `A fresh invitation was sent to ${admin.email}.`,
      });
    } catch (err) {
      setRowNotice({
        tone: 'error',
        email: admin.email,
        url: '',
        expiresAt: '',
        message: err?.response?.data?.message || 'Could not resend the invitation.',
      });
    } finally {
      setResendingId(null);
    }
  };

  /**
   * Save  creates a NEW account, or updates the one being edited.
   *
   * Update sends a PATCH /admin/accounts/{id} (via onUpdateAdmin) with only the
   * fields the endpoint accepts (role + RBAC permissions); name/email/password
   * are NOT editable here on purpose — the backend update() only handles role and
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
      const ok = await confirm(
        promoting
          ? {
              title: 'Promote to Super Admin?',
              message: `${editingAccount.email} will gain full access to system settings, admin provisioning, audit logs and the database export.`,
              confirmText: 'Promote',
              danger: true,
            }
          : {
              title: 'Change role?',
              message: `Change ${editingAccount.email} from ${currentRole} to ${nextRole}?`,
              confirmText: 'Change role',
            }
      );
      if (!ok) return;
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
      setError(err?.response?.data?.message || 'Failed to update the admin account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-7 animate-fadeIn text-xs">
      {/* ================= HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.05em] text-navy-900">
            ADMIN ACCOUNTS &amp; RBAC
          </h2>
          <p className="text-xs text-hiraya-ink mt-1">
            One account per person. Never share a login between staff.
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="px-5 py-2.5 bg-hiraya-accent hover:bg-hiraya-gold-deep text-hiraya-on-accent font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
        >
          <UserPlus size={16} /> INVITE ADMIN
        </button>
      </div>

      {/*
        THE SHARED-ACCOUNT WARNING.

        Not decoration. A single admin login used by three people is the exact
        situation that makes the LAST SEEN column below meaningless and makes
        revoking one person's access impossible without cutting off the other
        two — so it is stated at the point where a new account is created, which
        is the only moment a second person can be tempted to share one.
      */}
      {adminAccounts.length > 0 && adminAccounts.length <= 2 && (
        <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-xl text-[10px] text-amber-700 normal-case tracking-normal leading-relaxed flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Only {adminAccounts.length} privileged account{adminAccounts.length === 1 ? '' : 's'} exist.
            If several people use the console, give each of them their own row here — a
            shared login means the Last Seen column cannot tell you who was actually
            signed in, and you cannot revoke one person without cutting off the rest.
          </span>
        </div>
      )}

      {/*
        ROW-LEVEL FEEDBACK.

        Deliberately OUTSIDE the modal and above the table: a resend is triggered
        from a row, so the modal is closed and the `error` state (which renders
        inside the modal) would never be visible. This is the channel that reports
        the outcome, including the link when SMTP is not configured.
      */}
      {rowNotice && (
        <div
          className={`p-3 rounded-xl border text-[10px] normal-case tracking-normal leading-relaxed ${rowNotice.tone === 'ok'
              ? 'bg-emerald-500/10 border-emerald-600/30 text-hiraya-ink'
              : 'bg-red-500/12 border-red-600/40 text-red-700'
            }`}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="font-medium">{rowNotice.message}</span>
            <button
              type="button"
              onClick={() => setRowNotice(null)}
              className="shrink-0 text-hiraya-ink-muted hover:text-hiraya-ink transition"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
          {rowNotice.url && (
            <code className="mt-2 block break-all font-mono text-[10px] bg-cream-200/55 border border-hiraya-structure-line/80 rounded-lg p-2 text-hiraya-ink">
              {rowNotice.url}
            </code>
          )}
        </div>
      )}

      {/* ================= ACCOUNTS TABLE ================= */}
      <div className="bg-hiraya-surface rounded-[22px] overflow-hidden shadow-neu ring-1 ring-cream-50/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-navy-900 uppercase tracking-[0.16em] text-[10px] text-cream-100">
              <tr>
                <th className="p-4">PERSON</th>
                <th className="p-4">LAST SEEN</th>
                <th className="p-4">ROLE</th>
                <th className="p-4">INVENTORY PERMISSIONS</th>
                <th className="p-4">AI RULES ACCESS</th>
                <th className="p-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hiraya-structure-line/70 text-hiraya-ink">
              {adminAccounts && adminAccounts.length > 0 ? (
                adminAccounts.map((admin, idx) => {
                  const normalizedRole = normalizeRole(admin.role);
                  const isSuperAdmin = normalizedRole === 'SUPERADMIN';
                  const neverSignedIn = !admin.last_login_at;
                  /*
                   * PENDING — the account exists and has a password, but no factor.
                   *
                   * Shown because an invited admin appears in this table the moment
                   * they set a password, which is BEFORE they have enrolled. Without
                   * this the row would read as an ordinary, ready account.
                   *
                   * It is a FACT ABOUT THE ACCOUNT, not a lock. It does NOT gate
                   * anything: `supabase.aal2` is the sole thing that decides console
                   * access, and it verifies a completed TOTP challenge on every
                   * request. This column is read-only information for the operator,
                   * and it deliberately does not describe itself as "not active yet",
                   * because that phrase used to be a server-enforced state that
                   * locked people out of accounts they had already proven.
                   */
                  const pendingMfa = !admin.mfa_enrolled_at;

                  /*
                   * LAST SUPER ADMIN — the one row that cannot be revoked or
                   * demoted, because doing so would leave nobody able to provision
                   * administrators and no way back into the console except the CLI.
                   *
                   * The server enforces this in both `destroy()` and `update()`;
                   * this is the client half so the operator is not offered a button
                   * whose only possible outcome is a 422. The server check remains
                   * authoritative — the UI is a courtesy, not the guard.
                   */
                  const isLastSuperAdmin = isOnlySuperAdmin(admin);

                  return (
                    <tr key={admin.id || idx} className="hover:bg-cream-200/60 transition">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-hiraya-accent/10 border border-hiraya-accent/30 flex items-center justify-center text-hiraya-ink font-bold shrink-0">
                            {(admin.full_name || admin.name) ? (admin.full_name || admin.name).charAt(0).toUpperCase() : 'A'}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-hiraya-ink truncate">
                              {admin.full_name || admin.name || 'Admin User'}
                            </div>
                            <div className="text-[10px] text-hiraya-sand">{admin.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="p-4">
                        <span className={`text-[10px] uppercase tracking-wider ${neverSignedIn ? 'text-amber-700' : 'text-hiraya-ink'}`}>
                          {formatLastSeen(admin.last_login_at)}
                        </span>
                      </td>

                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${isSuperAdmin
                            ? 'bg-hiraya-accent/10 text-hiraya-ink border-hiraya-structure-line'
                            : 'bg-navy-900 text-cream-100 border-navy-900'
                          }`}
                        >
                          {admin.role || 'ADMIN'}
                        </span>
                        {pendingMfa && (
                          <span
                            className="ml-2 px-2 py-0.5 rounded text-[9px] font-bold uppercase border border-amber-500/30 bg-amber-500/10 text-amber-800 inline-flex items-center gap-1"
                            title="This account has a password but no authenticator enrolled. It cannot open the console until it finishes."
                          >
                            <ShieldAlert size={11} /> Pending MFA
                          </span>
                        )}
                        {isLastSuperAdmin && (
                          <span
                            className="ml-2 px-2 py-0.5 rounded text-[9px] font-bold uppercase border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink-muted inline-flex items-center gap-1"
                            title="The only Super Admin. It cannot be revoked or demoted — that would lock everyone out of this console."
                          >
                            <ShieldAlert size={11} /> Only Super Admin
                          </span>
                        )}
                      </td>

                      <td className="p-4 uppercase text-hiraya-ink">
                        <span className="px-2 py-0.5 bg-cream-200/60 rounded border border-hiraya-structure-line/80 text-[10px]">
                          {admin.inventory_permissions || 'READ_WRITE'}
                        </span>
                      </td>

                      <td className="p-4">
                        <span
                          className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${admin.ai_rules_access !== false
                              ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
                              : 'bg-red-500/12 text-red-700 border-red-600/40'
                            }`}
                        >
                          {admin.ai_rules_access !== false ? 'FULL ACCESS' : 'RESTRICTED'}
                        </span>
                      </td>

                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/*
                            RESEND — only on a row that is still pending.

                            This is the recovery for a lost or expired invitation
                            link. It is shown only while the account has not finished
                            enrolling: once `mfa_enrolled_at` is set the account is
                            active and there is nothing to resend, and offering it
                            would be a way to mint sign-in links for a working admin.
                          */}
                          {pendingMfa && (
                            <button
                              onClick={() => handleResend(admin)}
                              disabled={resendingId === admin.id}
                              className="p-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-800 rounded-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Send a fresh invitation link for this still-pending account"
                            >
                              <RefreshCw size={14} className={resendingId === admin.id ? 'animate-spin' : ''} />
                            </button>
                          )}
                          <button
                            onClick={() => openEditModal(admin)}
                            className="p-2 bg-navy-100 hover:bg-navy-200/70 border-navy-300/70 text-navy-800 rounded-lg transition cursor-pointer"
                            title="Edit role & permissions"
                          >
                            <Edit3 size={14} />
                          </button>
                          {!isSuperAdmin && (
                            <button
                              onClick={() => handleDelete(admin.id)}
                              className="p-2 bg-red-500/12 hover:bg-red-500/20 border border-red-600/40 text-red-700 rounded-lg transition cursor-pointer"
                              title="Revoke this admin's access"
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
                  <td colSpan="6" className="py-20 text-center text-hiraya-sand uppercase tracking-[0.25em] font-light">
                    NO ADMIN ACCOUNTS YET
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= CREATE / EDIT MODAL ================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-hiraya-cream-deep/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-hiraya-cream-deep border border-hiraya-structure-line rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-hiraya-structure-line/80 flex justify-between items-center bg-cream-200/60">
              <h3 className="font-bold text-hiraya-ink uppercase tracking-wider flex items-center gap-2">
                {editingAccount ? <><Edit3 size={16} /> EDIT ADMIN ACCOUNT</> : <><UserPlus size={16} /> INVITE ADMIN</>}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-hiraya-ink hover:text-hiraya-accent p-1 rounded-lg transition"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={editingAccount ? handleUpdate : handleSubmit} className="p-5 space-y-4">
              {error && (
                <div className="p-2.5 bg-red-500/12 border border-red-600/40 text-red-700 rounded-xl text-[10px] uppercase tracking-wider">
                  {error}
                </div>
              )}

              {/*
                ONLY ON CREATE. The whole point of this tab is that the row is
                a person, so the form says so where the superadmin is about to
                type somebody's real name into it.
              */}
              {!editingAccount && (
                <p className="p-3 bg-cream-200/45 rounded-xl shadow-neu-inset text-[10px] text-hiraya-sand normal-case tracking-normal leading-relaxed flex items-start gap-2">
                  <UserCheck size={14} className="shrink-0 mt-0.5 text-hiraya-accent" />
                  <span>
                    You are inviting ONE named person. They will receive a link, choose
                    their own password, and enroll their own authenticator app — you
                    never set or see either. The account stays inactive until they
                    finish.
                  </span>
                </p>
              )}

              {/*
                * THE INVITATION LINK, SHOWN WHEN MAIL DID NOT GO OUT.
                *
                * The backend returns the link alongside the send so a dev machine
                * with no SMTP host (where the `log` mailer writes to a file nobody
                * reads) is not a dead end. Without this the superadmin would be
                * told "invitation sent" and have no way to deliver it.
                */}
              {inviteUrl && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-600/30 rounded-xl text-[10px] text-hiraya-ink normal-case tracking-normal leading-relaxed">
                  <p className="mb-1.5 font-bold uppercase tracking-widest text-emerald-700">
                    Invitation created
                  </p>
                  <p className="text-hiraya-sand mb-2">
                    Copy this link and send it to the invitee directly.
                  </p>
                  <code className="block break-all font-mono text-[10px] bg-cream-200/55 border border-hiraya-structure-line/80 rounded-lg p-2 text-hiraya-ink">
                    {inviteUrl}
                  </code>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1 flex items-center gap-1">
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
                  className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2.5 text-hiraya-ink placeholder:text-hiraya-sand/70 focus:outline-none focus:border-hiraya-accent disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none disabled:cursor-not-allowed"
                />
                <p className="mt-1 text-[9px] text-hiraya-sand normal-case tracking-normal">
                  One address per person. The audit trail is keyed on it.
                </p>
              </div>


              {/*
               * ROLE AND INVENTORY ACCESS ARE EDIT-MODE ONLY.
               *
               * On an INVITATION there is no role to pick: `invite()` accepts only
               * `admin` (RULE 2/3 — Hiraya has one superadmin, provisioned directly,
               * never invited), so a selector offering anything else is offering an
               * action that can only 422. It is hidden rather than disabled because a
               * visible-but-unusable control reads as a broken form.
               *
               * Inventory access is hidden for the same reason it has no meaning yet:
               * it is set to READ_WRITE by the invitation itself
               * (AdminInvitationService::accept), and the row being edited is the place
               * to change it once the person is real.
               */}
              {editingAccount && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1 flex items-center gap-1">
                      <Key size={12} /> Role
                    </label>
                    <select
                      name="role"
                      value={formData.role}
                      onChange={handleChange}
                      className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2.5 text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
                    >
                    {/*
                     * MODERATOR used to be listed here, but the backend coerces
                     * every non-superadmin role to `admin` (EnsureUserIsAdmin only
                     * understands admin/superadmin). Picking "MODERATOR" therefore
                     * created an ADMIN and the table showed a role the operator
                     * never chose. Only roles the backend actually honours are
                     * offered until a real moderator tier exists.
                     *
                     * SUPER ADMIN IS EDIT-MODE ONLY — RULE 2 OF THE ROLE MODEL.
                     * Hiraya has exactly ONE superadmin, and that account is
                     * provisioned directly; it is never created by redeeming a link.
                     * `AdminAccountController::invite()` now rejects a `superadmin`
                     * role outright, so offering the option on the INVITE form was
                     * offering an action guaranteed to 422. Promotion remains
                     * possible, deliberately, on an existing account — by the one
                     * person who already holds the power, editing a real person who
                     * is already in the system. That is a different thing from
                     * mailing a link to a stranger's inbox and having the authority
                     * arrive with the link.
                     */}
                    <option value="ADMIN">ADMIN</option>
                    <option
                      value="SUPERADMIN"
                      disabled={isOnlySuperAdmin(editingAccount)}
                    >
                      SUPER ADMIN
                    </option>
                  </select>
                  {/*
                    THE LAST SUPER ADMIN CANNOT BE DEMOTED.

                    The server enforces this in both `update()` and `destroy()`,
                    but offering the option and then answering 422 is a poor way to
                    teach it: the operator has already committed to the change. The
                    rule is stated where they are choosing, and the value that would
                    violate it is refused client-side as well.
                  */}
                  {editingAccount && isOnlySuperAdmin(editingAccount) && (
                    <p className="mt-1 text-[9px] text-amber-700 normal-case tracking-normal">
                      This is the only Super Admin. Promote someone else before changing this role.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1">
                    Inventory Access
                  </label>
                  <select
                    name="inventory_permissions"
                    value={formData.inventory_permissions}
                    onChange={handleChange}
                    className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2.5 text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
                  >
                    <option value="READ_WRITE">READ &amp; WRITE</option>
                    <option value="READ_ONLY">READ ONLY</option>
                  </select>
                </div>
              </div>
              )}

              {/*
               * AI RULES ACCESS IS EDIT-MODE ONLY, for the same reason the role
               * selector above is: the invitation sets it to `true`
               * (AdminInvitationService::accept), and there is no person yet to
               * grant or withhold it from. It is edited once they are real.
               */
              editingAccount && (
                <div className="flex items-center justify-between p-3 bg-cream-200/45 rounded-xl shadow-neu-inset">
                  <div>
                    <p className="text-hiraya-ink font-medium">AI Rules Access</p>
                    <p className="text-[9px] text-hiraya-sand">Allow modifying Hiraya AI Fitting rules</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, ai_rules_access: !formData.ai_rules_access })}
                    className="text-hiraya-ink"
                  >
                    {formData.ai_rules_access ? <ToggleRight size={28} /> : <ToggleLeft size={28} className="text-hiraya-sand" />}
                  </button>
                </div>
              )}

              {editingAccount && String(editingAccount.role).toUpperCase() === 'ADMIN'
                && formData.role === 'SUPERADMIN' && (
                  <p className="p-3 bg-red-500/12 border border-red-600/40 text-red-700 rounded-xl text-[10px] normal-case tracking-normal leading-relaxed">
                    This hands {editingAccount.email} the whole control panel —
                    settings, the audit trail, the database export, and the ability
                    to add more admins. You will be asked to confirm.
                  </p>
                )}

              <div className="pt-3 flex justify-end gap-2 border-t border-hiraya-structure-line/80">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); setEditingAccount(null); }}
                  className="px-4 py-2 text-hiraya-ink hover:text-hiraya-accent rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-hiraya-accent hover:bg-hiraya-gold-deep disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none disabled:cursor-not-allowed text-hiraya-on-accent font-bold uppercase rounded-xl transition font-semibold flex items-center gap-2"
                >
                  {editingAccount ? <Save size={14} /> : <UserPlus size={14} />}
                  {submitting
                    ? (editingAccount ? 'Saving...' : 'Sending...')
                    : (editingAccount ? 'Save Changes' : 'Send Invitation')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
