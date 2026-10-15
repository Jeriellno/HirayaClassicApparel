/*
 * EVERY SIGN-OUT ENDS IN A FULL PAGE LOAD OF /login — customer, admin and
 * superadmin alike.
 *
 * Sign-out used to navigate in-app, which left the old tab's memory alive
 * behind the login form: the react-query cache, the Supabase client, the
 * console's polling timers, and the router state that remembered `/superadmin`
 * (the customer-login loop `postLoginPath` guards against came from exactly
 * that). A fresh document is the one reset that cannot miss anything.
 *
 * It must stay ONE navigation, not two. The old double refresh came from doing
 * both: the route guards redirected in-app the moment the session read as gone,
 * and then a hard load landed on top. So every caller runs AuthContext's
 * `beginSignOut()` FIRST — the app swaps to a "Signing out..." screen and
 * unmounts the routes, leaving no guard to redirect — and only this function
 * moves the page.
 */
export const reloadToLogin = () => {
    // Back must not restore the signed-in page from the back/forward cache with
    // its old React state; reload it so it reads the now-empty storage.
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) window.location.reload();
    });
    // `replace`: Back should not lead to the page that was just signed out of.
    window.location.replace('/login');
};
