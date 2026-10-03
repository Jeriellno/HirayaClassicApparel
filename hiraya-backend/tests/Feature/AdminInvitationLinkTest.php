<?php

namespace Tests\Feature;

use App\Mail\AdminInvitationMail;
use App\Services\AdminInvitationService;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Admin invitation links: built only from FRONTEND_URL, https + not localhost in
 * production, and the token in the link still validates (and expires) as before.
 * Mail is faked and no Supabase identity is created.
 */
class AdminInvitationLinkTest extends TestCase
{
    private const EMAIL = 'new.admin@example.test';

    protected function setUp(): void
    {
        parent::setUp();

        Schema::create('users', function (Blueprint $table): void {
            $table->id();
            $table->string('full_name')->nullable();
            $table->string('email')->unique();
            $table->string('password')->nullable();
            $table->string('role')->default('user');
            $table->timestamps();
        });

        Mail::fake();
    }

    /** Build + mail an invitation through the service's own issuing path. */
    private function issue(): array
    {
        $service = app(AdminInvitationService::class);

        return (new \ReflectionMethod($service, 'issue'))->invoke($service, self::EMAIL, 'admin', 'owner@example.test');
    }

    private function useFrontend(?string $url, string $env): void
    {
        $this->app['env'] = $env;
        config(['app.frontend_url' => $url ?? 'http://localhost', 'app.frontend_url_configured' => $url !== null]);
    }

    private function tokenFrom(string $url): string
    {
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

        return $query['token'];
    }

    public function test_local_link_points_at_the_local_frontend_and_its_token_validates(): void
    {
        $this->useFrontend('http://localhost:5173', 'local');

        $url = $this->issue()['url'];

        $this->assertStringStartsWith('http://localhost:5173/accept-invitation?email=new.admin%40example.test&token=', $url);
        Mail::assertSent(AdminInvitationMail::class, fn ($mail) => $mail->url === $url && $mail->role === 'admin');

        $service = app(AdminInvitationService::class);
        $token = $this->tokenFrom($url);
        $this->assertTrue($service->tokenIsValid(self::EMAIL, $token));
        $this->assertSame('admin', $service->roleFromToken(self::EMAIL, $token));
        $this->assertFalse($service->tokenIsValid('someone.else@example.test', $token));
        $this->assertFalse($service->tokenIsValid(self::EMAIL, $token . 'x'));

        $this->travel(AdminInvitationService::TTL_MINUTES + 1)->minutes();
        $this->assertFalse($service->tokenIsValid(self::EMAIL, $token), 'expired links stay dead');
    }

    public function test_production_link_uses_the_deployed_https_frontend(): void
    {
        $this->useFrontend('https://hirayaclassicapparel-1.onrender.com', 'production');

        $url = $this->issue()['url'];

        $this->assertStringStartsWith('https://hirayaclassicapparel-1.onrender.com/accept-invitation?email=', $url);
        $this->assertTrue(app(AdminInvitationService::class)->tokenIsValid(self::EMAIL, $this->tokenFrom($url)));
    }

    public function test_request_headers_never_change_the_link(): void
    {
        $this->useFrontend('https://hirayaclassicapparel-1.onrender.com', 'production');
        $this->app->instance('request', Request::create('https://evil.example/api/x', 'POST', [], [], [], [
            'HTTP_HOST' => 'evil.example',
            'HTTP_X_FORWARDED_HOST' => 'evil.example',
            'HTTP_ORIGIN' => 'https://evil.example',
        ]));

        $this->assertStringStartsWith('https://hirayaclassicapparel-1.onrender.com/', $this->issue()['url']);
    }

    public function test_production_refuses_unusable_frontend_urls_before_any_mail(): void
    {
        foreach ([null, 'http://localhost:5173', 'https://localhost', 'https://127.0.0.1:5173', 'http://hirayaclassicapparel-1.onrender.com'] as $bad) {
            $this->useFrontend($bad, 'production');

            try {
                $this->issue();
                $this->fail('Expected a refusal for FRONTEND_URL=' . var_export($bad, true));
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('FRONTEND_URL', $e->getMessage());
            }
        }

        Mail::assertNothingSent();
    }

    public function test_frontend_url_must_be_an_origin_only(): void
    {
        foreach (['https://shop.example/app', 'https://shop.example?x=1', 'https://shop.example#top', 'shop.example', 'ftp://shop.example'] as $bad) {
            $this->useFrontend($bad, 'local');

            try {
                $this->issue();
                $this->fail('Expected a refusal for FRONTEND_URL=' . $bad);
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('origin only', $e->getMessage());
            }
        }

        // A trailing slash is tolerated and normalised.
        $this->useFrontend('https://shop.example/', 'production');
        $this->assertStringStartsWith('https://shop.example/accept-invitation?', $this->issue()['url']);
    }
}
