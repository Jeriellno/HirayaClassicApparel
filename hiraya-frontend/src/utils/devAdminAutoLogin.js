/**
 * devAdminAutoLogin — DEV ONLY convenience for the local admin console.
 *
 * WHY THIS EXISTS
 * ---------------
 * The `/admin/*` API is genuinely gated (`auth:sanctum` + `admin` in
 * `routes/api.php`), so the console is only usable WITH a real token. Opening
 * `/admin` with no session therefore renders the UI shell while every request
 * 401s — "Add New Garment" opens, but the AI auto-fill (`analyze-image`) and
 * the save (`POST /admin/products`) both fail, so the product keeps the ORIGINAL
 * photo.
 *
 * This module removes that friction WITHOUT weakening the gate: instead of
 * bypassing the auth check, it performs a REAL login against `/api/login` and
 * stores the returned token. Every subsequent admin call then carries a valid
 * bearer token, exactly as a manual login would — the backend gate is untouched.
 *
 * SCOPE / SAFETY
 * --------------
 *  - Only runs in a Vite DEV build (`import.meta.env.DEV`). It is compiled out of
 *    a production bundle, so it can never ship.
 *  - Set `VITE_DEV_ADMIN_AUTOLOGIN=false` in `.env` to switch it off locally.
 *  - `ADMIN_PATHS` below limits it to the admin/superadmin console routes; the
 *    storefront is never auto-signed-in.
 *  - The credentials are the LOCAL DEV account created by
 *    `hiraya-backend/_set_dev_admin_password.php`. They are not a production
 *    secret and grant nothing beyond this local database.
 */

/*
 * Both console prefixes. /superadmin is included so the Super Admin console
 * also gets a real token: without it, "Add Garment" and "Auto-fill Details (AI)"
 * hit /api/admin/* with no bearer token and fail 401/403 (the reported
 * "Forbidden" / permission prompt) even though the UI gate is open.
 */
const ADMIN_PATHS = ['/admin', '/superadmin'];

/**
 * DISABLED per request — the dev admin account (admin@hiraya.com) was removed,
 * so there is nothing to auto-login with. The AI auto-fill no longer needs an
 * admin session (its endpoint is public), so this convenience is switched off
 * entirely until a real admin account exists.
 */
const isEnabled = () => false;

/** True when the current URL is the admin console. */
const isAdminPath = () => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  return ADMIN_PATHS.some((prefix) => path.startsWith(prefix));
};

const DEV_ADMIN = {
  email: import.meta.env?.VITE_DEV_ADMIN_EMAIL || '',
  password: import.meta.env?.VITE_DEV_ADMIN_PASSWORD || '',
};

/**
 * Attempt a silent dev admin login.
 *
 * @param {object} api   the shared axios instance (avoids a circular import)
 * @param {Function} persistSession  AuthContext's session writer
 * @returns {Promise<object|null>} the signed-in user, or null when not applied
 */
export const devAdminAutoLogin = async (api, persistSession) => {
  if (!isEnabled() || !isAdminPath()) return null;

  try {
    const res = await api.post('/login', {
      email: DEV_ADMIN.email,
      password: DEV_ADMIN.password,
    });

    const token = res.data?.token;
    const user = res.data?.user;

    if (!token || !user) return null;

    persistSession(token, user, true);

    console.info(
      '[Hiraya DEV] Auto-signed in as %s (admin console convenience). ' +
      'Unset VITE_DEV_ADMIN_AUTOLOGIN=false to disable.',
      user.email,
    );

    return user;
  } catch (error) {
    console.warn(
      '[Hiraya DEV] Admin auto-login failed — sign in manually. ' +
      'If the dev admin password changed, re-run ' +
      'hiraya-backend/_set_dev_admin_password.php.',
      error?.response?.status || error?.message,
    );
    return null;
  }
};

export default devAdminAutoLogin;
