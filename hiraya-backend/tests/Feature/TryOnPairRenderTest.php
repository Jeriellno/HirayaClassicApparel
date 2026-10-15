<?php

namespace Tests\Feature;

use App\Models\TryOnSession;
use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Two-garment try-on (top + bottom in one image), its credit safety, the
 * unsupported-combination validation, render reuse and the cached matte fetch.
 * The provider is faked: no real render is made and no credit is spent.
 */
class TryOnPairRenderTest extends TestCase
{
    private const SUBMIT = 'https://vton.test/v1/virtual-tryon';
    private const PORTRAIT = 'data:image/png;base64,UE9SVFJBSVQ=';     // "PORTRAIT"
    private const TOP = 'data:image/png;base64,VE9QLUdBUk1FTlQ=';       // "TOP-GARMENT"
    private const BOTTOM = 'data:image/png;base64,Qk9UVE9NLUdBUk1FTlQ='; // "BOTTOM-GARMENT"

    private User $user;

    /** Provider submissions seen so far: [garment_image, person_image, category]. */
    private array $submits = [];

    /** Queued answers for the next provider submissions ('ok' or an HTTP status). */
    private array $answers = [];

    protected function setUp(): void
    {
        parent::setUp();

        Schema::create('users', function (Blueprint $table): void {
            $table->id();
            $table->string('full_name')->nullable();
            $table->string('email')->unique();
            $table->string('password');
            $table->string('role')->default('user');
            $table->string('upper_body_size')->nullable();
            $table->string('lower_body_size')->nullable();
            $table->longText('portrait_base64')->nullable();
            $table->timestamps();
        });

        Schema::create('products', function (Blueprint $table): void {
            $table->id();
            $table->string('name');
            $table->string('category')->nullable();
            $table->string('ghost_mannequin_url')->nullable();
            $table->timestamps();
        });

        Schema::create('system_settings', function (Blueprint $table): void {
            $table->id();
            $table->string('key');
            $table->text('value')->nullable();
            $table->timestamps();
        });

        Schema::create('try_on_sessions', function (Blueprint $table): void {
            $table->id();
            $table->string('session_id', 64)->unique();
            $table->foreignId('user_id');
            $table->longText('user_photo_base64');
            $table->longText('garment_photos_json');
            $table->json('garment_categories_json')->nullable();
            $table->json('garment_metadata_json')->nullable();
            $table->string('history_title')->nullable();
            $table->json('measurements_json')->nullable();
            $table->json('render_plan_json')->nullable();
            $table->string('status')->default('queued');
            $table->boolean('is_favorite')->default(false);
            $table->longText('result_image_base64')->nullable();
            $table->string('result_image_path')->nullable();
            $table->string('render_fingerprint', 64)->nullable();
            $table->text('ai_feedback')->nullable();
            $table->text('error_message')->nullable();
            $table->softDeletes();
            $table->timestamps();
        });

        config([
            'queue.default' => 'sync',
            'services.supabase.url' => '',          // RenderVault -> private local disk (faked below)
            'services.fashn.token' => '',            // only the PixelAPI slot is in play
            'services.vton.endpoint' => self::SUBMIT,
            'services.vton.token' => 'test-token',
            'services.vton.model_name' => '',
            'services.vton.person_field' => 'person_image',
            'services.vton.garment_field' => 'garment_image',
            'services.vton.category_field' => 'category',
            'services.vton.status_endpoint' => 'https://vton.test/v1/jobs/{id}',
            'services.huggingface.vton_space' => null,
            'services.huggingface.vton_base' => null,
        ]);

        Storage::fake('local');

        $this->user = User::forceCreate([
            'full_name' => 'Test Customer',
            'email' => 'customer@example.test',
            'password' => bcrypt('secret-password'),
            'role' => 'user',
        ]);
        Sanctum::actingAs($this->user);

        // Each submit answers synchronously with an output URL whose bytes name the
        // render ("RENDER-1", "RENDER-2", ...), so chaining can be asserted.
        Http::fake(function (HttpRequest $request) {
            if ($request->method() === 'POST' && $request->url() === self::SUBMIT) {
                $this->submits[] = [
                    'garment' => $request['garment_image'],
                    'person' => $request['person_image'],
                    'category' => $request['category'],
                ];
                $answer = array_shift($this->answers) ?? 'ok';
                if ($answer !== 'ok') {
                    return Http::response(['detail' => 'busy'], $answer);
                }

                return Http::response(['output_url' => 'https://cdn.test/render-' . count($this->submits) . '.png', 'credits_used' => 40]);
            }

            if (str_starts_with($request->url(), 'https://cdn.test/render-')) {
                $n = basename($request->url(), '.png');

                return Http::response(strtoupper($n), 200, ['Content-Type' => 'image/png']);
            }

            if (str_starts_with($request->url(), 'https://storage.test/')) {
                return Http::response('MATTE-' . basename($request->url()), 200, ['Content-Type' => 'image/png']);
            }

            return Http::response('unexpected ' . $request->url(), 500);
        });
    }

    private function generate(array $garments, string $photo = self::PORTRAIT)
    {
        return $this->postJson('/api/tryon/generate', ['user_photo_base64' => $photo, 'garments' => $garments]);
    }

    private function dataUriOf(string $bytes): string
    {
        return 'data:image/png;base64,' . base64_encode($bytes);
    }

    public function test_top_and_bottom_render_in_one_image_with_two_provider_passes(): void
    {
        $res = $this->generate([
            ['category' => 'FORMAL_MEN', 'name' => 'Barong Tagalog', 'image' => self::TOP],
            ['category' => 'BOTTOMS', 'name' => 'Brown Formal Trousers', 'image' => self::BOTTOM],
        ]);

        $res->assertOk()->assertJsonPath('status', 'completed')->assertJsonPath('render_passes', 2);

        $this->assertCount(2, $this->submits, 'a pair is exactly two provider jobs');
        // Pass 1: the customer's photo + the BOTTOM.
        $this->assertSame(self::PORTRAIT, $this->submits[0]['person']);
        $this->assertSame(self::BOTTOM, $this->submits[0]['garment']);
        $this->assertSame('lowerbody', $this->submits[0]['category']);
        // Pass 2: pass 1's output + the TOP.
        $this->assertSame($this->dataUriOf('RENDER-1'), $this->submits[1]['person']);
        $this->assertSame(self::TOP, $this->submits[1]['garment']);
        $this->assertSame('upperbody', $this->submits[1]['category']);

        $session = TryOnSession::firstOrFail();
        $this->assertSame($this->dataUriOf('RENDER-2'), $session->resultImage());
        $this->assertTrue($session->isPairRender());
        $this->assertNull($session->pipeline()['first_pass']);
        $this->assertStringContainsString('Barong Tagalog + Brown Formal Trousers', $session->ai_feedback);
        $this->assertSame($this->dataUriOf('RENDER-2'), $res->json('result_image_base64'));
        // The intermediate image was removed from the vault once the fitting finished.
        $this->assertCount(1, Storage::disk('local')->allFiles('renders'));
    }

    public function test_a_top_over_a_dress_renders_the_dress_first_then_the_top_on_it(): void
    {
        // The Studio sends the stack in slot order: the top before the dress.
        $res = $this->generate([
            ['category' => 'TOPS', 'name' => 'Lace Bolero', 'image' => self::TOP],
            ['category' => 'DRESSES', 'name' => 'Strapless Dress', 'image' => self::BOTTOM],
        ]);

        $res->assertOk()->assertJsonPath('status', 'completed')->assertJsonPath('render_passes', 2);

        $this->assertCount(2, $this->submits, 'a top over a dress is exactly two provider jobs');
        // Pass 1: the customer's photo + the DRESS.
        $this->assertSame(self::PORTRAIT, $this->submits[0]['person']);
        $this->assertSame(self::BOTTOM, $this->submits[0]['garment']);
        $this->assertSame('dress', $this->submits[0]['category']);
        // Pass 2: the dressed render + the TOP, so the top is the outer layer.
        $this->assertSame($this->dataUriOf('RENDER-1'), $this->submits[1]['person']);
        $this->assertSame(self::TOP, $this->submits[1]['garment']);
        $this->assertSame('upperbody', $this->submits[1]['category']);

        $session = TryOnSession::firstOrFail();
        $this->assertSame($this->dataUriOf('RENDER-2'), $session->resultImage());
        $this->assertSame([1, 0], $session->pipeline()['order']);
        $this->assertSame(\App\Support\TryOnGarmentPlan::LAYERING_OVER_DRESS, $session->pipeline()['layering']);
        $this->assertStringContainsString('the dress first, then the top layered over it', $session->ai_feedback);
    }

    public function test_outerwear_over_a_dress_renders_the_dress_first_then_the_outerwear_on_it(): void
    {
        // Slot order again puts the upper piece first: the outerwear before the dress.
        $res = $this->generate([
            ['category' => 'OUTERWEAR', 'name' => 'Cropped Denim Jacket', 'image' => self::TOP],
            ['category' => 'DRESSES', 'name' => 'Slip Dress', 'image' => self::BOTTOM],
        ]);

        $res->assertOk()->assertJsonPath('status', 'completed')->assertJsonPath('render_passes', 2);

        $this->assertCount(2, $this->submits, 'outerwear over a dress is exactly two provider jobs');
        // Pass 1: the customer's photo + the DRESS.
        $this->assertSame(self::PORTRAIT, $this->submits[0]['person']);
        $this->assertSame(self::BOTTOM, $this->submits[0]['garment']);
        $this->assertSame('dress', $this->submits[0]['category']);
        // Pass 2: the dressed render + the OUTERWEAR, dressed as an upper-body piece.
        $this->assertSame($this->dataUriOf('RENDER-1'), $this->submits[1]['person']);
        $this->assertSame(self::TOP, $this->submits[1]['garment']);
        $this->assertSame('upperbody', $this->submits[1]['category']);

        $session = TryOnSession::firstOrFail();
        $this->assertSame($this->dataUriOf('RENDER-2'), $session->resultImage());
        $this->assertSame([1, 0], $session->pipeline()['order']);
        $this->assertSame(\App\Support\TryOnGarmentPlan::LAYERING_OVER_DRESS, $session->pipeline()['layering']);
        $this->assertSame(\App\Support\TryOnGarmentPlan::OUTER_OUTERWEAR, $session->pipeline()['outer']);
        $this->assertSame(['the dress', 'the outerwear'], \App\Support\TryOnGarmentPlan::passLabels($session->pipeline()));
        $this->assertStringContainsString('Cropped Denim Jacket + Slip Dress (the dress first, then the outerwear layered over it)', $session->ai_feedback);
    }

    public function test_a_retry_after_a_busy_second_pass_resumes_without_rendering_the_first_again(): void
    {
        $this->answers = ['ok', 503]; // pass 1 renders, pass 2 is refused (busy)

        $res = $this->generate([
            ['category' => 'TOPS', 'name' => 'Linen Polo', 'image' => self::TOP],
            ['category' => 'PANTS', 'name' => 'Chinos', 'image' => self::BOTTOM],
        ]);
        $res->assertStatus(202);

        $session = TryOnSession::firstOrFail();
        $this->assertNotSame(TryOnSession::STATUS_COMPLETED, $session->status);
        $this->assertNotEmpty($session->pipeline()['first_pass']['path'], 'pass 1 is kept for the retry');
        $this->assertCount(2, $this->submits);

        $this->postJson('/api/tryon/retry/' . $session->session_id)->assertStatus(202);

        $this->assertCount(3, $this->submits, 'the retry renders pass 2 only');
        $this->assertSame(self::TOP, $this->submits[2]['garment']);
        $this->assertSame($this->dataUriOf('RENDER-1'), $this->submits[2]['person']);
        $session->refresh();
        $this->assertSame(TryOnSession::STATUS_COMPLETED, $session->status);
        $this->assertSame($this->dataUriOf('RENDER-3'), $session->resultImage());
    }

    public function test_unsupported_combinations_are_refused_before_any_render(): void
    {
        $cases = [
            ['two_upper', [['category' => 'TOPS', 'image' => self::TOP], ['category' => 'Outerwear', 'image' => self::BOTTOM]]],
            // A dress already covers the bottom; only a top or outerwear may be layered over it.
            ['dress_combo', [['category' => 'DRESSES', 'image' => self::TOP], ['category' => 'BOTTOMS', 'image' => self::BOTTOM]]],
            ['dress_combo', [['category' => 'DRESSES', 'image' => self::TOP], ['category' => 'Footwear', 'image' => self::BOTTOM]]],
            // One piece over a dress, not two.
            ['too_many', [
                ['category' => 'TOPS', 'image' => self::TOP],
                ['category' => 'OUTERWEAR', 'image' => self::BOTTOM],
                ['category' => 'DRESSES', 'image' => self::TOP],
            ]],
            ['footwear_combo', [['category' => 'TOPS', 'image' => self::TOP], ['category' => 'Footwear', 'image' => self::BOTTOM]]],
            ['two_lower', [['category' => 'PANTS', 'image' => self::TOP], ['category' => 'SKIRT', 'image' => self::BOTTOM]]],
            ['too_many', [
                ['category' => 'TOPS', 'image' => self::TOP],
                ['category' => 'BOTTOMS', 'image' => self::BOTTOM],
                ['category' => 'Footwear', 'image' => self::TOP],
            ]],
        ];

        foreach ($cases as [$reason, $garments]) {
            $this->generate($garments)
                ->assertStatus(422)
                ->assertJsonPath('code', 'unsupported_garment_combination')
                ->assertJsonPath('reason', $reason)
                ->assertJsonStructure(['message', 'errors' => ['garments']]);
        }

        $this->assertSame([], $this->submits);
        $this->assertSame(0, TryOnSession::count());
    }

    public function test_a_single_garment_still_renders_once_without_a_pipeline(): void
    {
        $this->generate([['category' => 'DRESSES', 'name' => 'Filipiniana', 'image' => self::TOP]])
            ->assertOk()
            ->assertJsonPath('render_passes', 1);

        $this->assertCount(1, $this->submits);
        $this->assertSame('dress', $this->submits[0]['category']);
        $session = TryOnSession::firstOrFail();
        $this->assertFalse($session->isPairRender());
        $this->assertSame($this->dataUriOf('RENDER-1'), $session->resultImage());
    }

    public function test_reuse_matches_the_exact_pair_only(): void
    {
        $pair = [
            ['category' => 'TOPS', 'name' => 'Polo', 'image' => self::TOP],
            ['category' => 'BOTTOMS', 'name' => 'Trousers', 'image' => self::BOTTOM],
        ];

        $this->generate($pair)->assertOk();
        $this->assertCount(2, $this->submits);

        // The identical pair is served from the saved render: no provider job.
        $this->generate($pair)->assertOk()->assertJsonPath('reused', true);
        $this->assertCount(2, $this->submits);

        // The top alone is a different render.
        $this->generate([$pair[0]])->assertOk()->assertJsonMissingPath('reused');
        $this->assertCount(3, $this->submits);

        // A different bottom is a different render.
        $this->generate([$pair[0], ['category' => 'BOTTOMS', 'name' => 'Shorts', 'image' => self::TOP]])->assertOk();
        $this->assertCount(5, $this->submits);
    }

    public function test_an_old_one_garment_render_of_the_same_stack_is_not_reused_for_the_pair(): void
    {
        $garments = [
            ['category' => 'TOPS', 'image' => self::TOP],
            ['category' => 'BOTTOMS', 'image' => self::BOTTOM],
        ];

        // Fingerprint the stack exactly as the previous code did (no pipeline part).
        $controller = app(\App\Http\Controllers\Api\TryOnController::class);
        $fingerprint = (new \ReflectionMethod($controller, 'renderFingerprint'))
            ->invoke($controller, self::PORTRAIT, [self::TOP, self::BOTTOM], ['tops', 'bottoms'], [null, null], [], null);

        TryOnSession::create([
            'session_id' => 'tryon_legacy',
            'user_id' => $this->user->id,
            'user_photo_base64' => self::PORTRAIT,
            'garment_photos_json' => [self::TOP, self::BOTTOM],
            'garment_categories_json' => ['tops', 'bottoms'],
            'measurements_json' => [],
            'status' => TryOnSession::STATUS_COMPLETED,
            'result_image_base64' => $this->dataUriOf('ONLY-THE-TOP'),
            'render_fingerprint' => $fingerprint,
        ]);

        $this->generate($garments)->assertOk()->assertJsonMissingPath('reused');
        $this->assertCount(2, $this->submits);
    }

    public function test_ghost_mattes_are_fetched_once_and_reused_from_the_cache(): void
    {
        // Inserted directly: the Product model's stock-history hook is not under test.
        $topId = \Illuminate\Support\Facades\DB::table('products')->insertGetId(['name' => 'Polo', 'category' => 'TOPS', 'ghost_mannequin_url' => 'https://storage.test/polo.png']);
        $bottomId = \Illuminate\Support\Facades\DB::table('products')->insertGetId(['name' => 'Trousers', 'category' => 'BOTTOMS', 'ghost_mannequin_url' => 'https://storage.test/trousers.png']);
        $garments = [
            ['category' => 'TOPS', 'product_id' => $topId, 'image' => self::TOP],
            ['category' => 'BOTTOMS', 'product_id' => $bottomId, 'image' => self::BOTTOM],
        ];

        $this->generate($garments)->assertOk();
        // The server used its own mattes (not the client's bytes) for both passes.
        $this->assertSame($this->dataUriOf('MATTE-trousers.png'), $this->submits[0]['garment']);
        $this->assertSame($this->dataUriOf('MATTE-polo.png'), $this->submits[1]['garment']);

        // A second look with a different photo needs the same mattes: cache hit.
        $this->generate($garments, $this->dataUriOf('ANOTHER-PORTRAIT'))->assertOk();

        $matteFetches = collect(Http::recorded())->filter(fn ($pair) => str_starts_with($pair[0]->url(), 'https://storage.test/'));
        $this->assertCount(2, $matteFetches, 'each matte is downloaded once across both requests');
    }
}
