<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'admin' => \App\Http\Middleware\EnsureUserIsAdmin::class,
            'superadmin' => \App\Http\Middleware\EnsureUserIsSuperAdmin::class,
        ]);

        /*
         * Make `auth:sanctum` answer 401 on API routes.
         *
         * By default the Authenticate middleware calls `redirectTo()`, which
         * resolves the named `login` route. This backend exposes no web login
         * route (it is a stateless JSON API consumed by a separate SPA), so any
         * unauthenticated hit on a protected endpoint raised:
         *
         *   RouteNotFoundException: Route [login] not defined.   -> HTTP 500
         *
         * That turned a normal "you are not signed in" into a server error on
         * every token-gated route, and made 401-handling on the client (which
         * forces a refresh and re-login) impossible to reach. Returning null
         * makes the middleware throw a plain 401 AuthenticationException
         * instead, which the JSON renderer above turns into { message: ... }.
         */
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        /**
         * Guarantee JSON for every API route.
         *
         * Laravel only auto-returns JSON when the request "expects" it. If a
         * client (curl, a proxy, a misconfigured fetch) hits /api/* without an
         * Accept header, validation and auth failures would otherwise render as
         * an HTML 302/419 page — which Axios happily parses into a response with
         * no `data.errors`, producing the "generic validation failure" symptom.
         * Forcing JSON here removes that entire class of bug.
         */
        $exceptions->shouldRenderJsonWhen(function ($request) {
            return $request->is('api/*') || $request->expectsJson();
        });
    })->create();
