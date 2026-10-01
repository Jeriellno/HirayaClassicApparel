<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AdminAccountController;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * THE DEV AUTH BYPASS MUST BE OFF UNLESS A HUMAN TURNS IT ON.
 * ==========================================================
 *
 * These tests exist because the previous implementation was
 *
 *     return !app()->isProduction();
 *
 * which is a NEGATIVE test: it enables the bypass for every environment that is
 * not the single literal string `production`. That includes `local`, `testing`,
 * `staging`, a misspelling, and any deployment that leaves `APP_ENV` unset.
 * `AdminAccountController` provisions, promotes and revokes staff accounts, so in
 * each of those environments its superadmin guard silently stopped applying.
 *
 * The bug was invisible in production and invisible in a correctly-configured
 * local setup, which is exactly why it needs a test rather than a comment: the
 * failure mode is silent privilege escalation in the environments nobody checks.
 *
 * WHAT IS ASSERTED
 * ----------------
 *   1. By default, in a non-production environment, the bypass is OFF.
 *   2. It can be turned on deliberately.
 *   3. It is REFUSED in production even when the flag says otherwise.
 *
 * The tests reach `devAuthBypass()` through reflection because it is private —
 * deliberately so. It is not part of the controller's API, and the point of the
 * test is precisely that the guard's behaviour is not negotiable from outside.
 */
class DevAuthBypassTest extends TestCase
{
    private function bypassEnabled(): bool
    {
        $controller = new AdminAccountController();
        $method = new \ReflectionMethod($controller, 'devAuthBypass');
        $method->setAccessible(true);

        return (bool) $method->invoke($controller);
    }

    public function test_bypass_is_off_by_default(): void
    {
        config(['app.allow_dev_auth_bypass' => false]);

        $this->assertFalse(
            $this->bypassEnabled(),
            'The dev auth bypass must default to OFF — this controller can provision and '
            . 'revoke staff accounts, so an unset flag must fail closed.'
        );
    }

    public function test_bypass_is_off_when_the_config_key_is_absent_entirely(): void
    {
        /*
         * The strongest form of "defaults to false": the key does not exist at all,
         * which is what an older cached config or a deployment that never updated
         * `config/app.php` would look like. `config()` returns null and the cast
         * must still yield false rather than a truthy null-coercion surprise.
         */
        config(['app' => array_diff_key(config('app'), ['allow_dev_auth_bypass' => null])]);

        $this->assertFalse($this->bypassEnabled());
    }

    public function test_bypass_can_be_enabled_deliberately(): void
    {
        config(['app.allow_dev_auth_bypass' => true]);
        app()['env'] = 'local';

        $this->assertTrue(
            $this->bypassEnabled(),
            'An explicit opt-in must work, or the console cannot be developed without a '
            . 'live Supabase session.'
        );
    }

    public function test_bypass_is_refused_in_production_even_when_enabled(): void
    {
        /*
         * Belt and braces. Even if `ALLOW_DEV_AUTH_BYPASS=true` leaks into a
         * production environment — committed by mistake, copied between .env files,
         * or set by a shared deployment template — the bypass must still not apply.
         * Both conditions are required, so a single mistake cannot open the door.
         */
        config(['app.allow_dev_auth_bypass' => true]);
        app()['env'] = 'production';

        $this->assertFalse(
            $this->bypassEnabled(),
            'Production must ignore ALLOW_DEV_AUTH_BYPASS entirely.'
        );
    }

    public function test_staging_does_not_get_the_bypass_by_accident(): void
    {
        /*
         * THE REGRESSION THIS WHOLE TEST CLASS EXISTS FOR.
         *
         * Under `!app()->isProduction()` this returned TRUE — a staging deployment
         * with an unauthenticated caller could reach admin provisioning. It must now
         * be false unless the flag is set.
         */
        config(['app.allow_dev_auth_bypass' => false]);
        app()['env'] = 'staging';

        $this->assertFalse($this->bypassEnabled());
    }
}