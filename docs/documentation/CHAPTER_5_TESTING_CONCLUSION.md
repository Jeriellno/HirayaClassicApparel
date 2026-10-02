# CHAPTER 5 — Testing, Evaluation, and Conclusion

## 5.1 Introduction

This chapter presents the verification of the implemented system, an honest assessment
of what was and was not verified, the evaluation against the objectives, the limitations,
and the conclusion.

This chapter follows the project's own rule: an unverified claim is never presented as a
fact. Where something was not verified, this chapter says so explicitly rather than
omitting it.

## 5.2 Testing Approach

Three complementary methods were used, chosen because each covers a different kind of
defect.

| Method | What it catches | What it cannot catch |
|---|---|---|
| **Automated feature and unit tests** (PHPUnit) | Logic errors, regressions in rules, authorisation mistakes | Anything involving a real third-party service; visual quality |
| **Smoke tests** against the live container | Whether a subsystem is actually wired up and reachable | Correctness of the output |
| **Manual review of real output** | Whether the feature produces what it claims to produce | Coverage; it is slow and does not scale |

The third method is the one that matters most for the AI feature, and the project has
recorded why in unusually blunt terms: the numbers produced by an automated harness can
look authoritative while describing something other than what the user sees. A render
must be looked at.

## 5.3 Automated Testing

### 5.3.1 Backend test suite

The backend carries a PHPUnit suite run against an in-memory SQLite database, so tests
do not touch the shared Supabase instance. The test files are:

| Test | Coverage |
|---|---|
| `tests/Unit/SizeChartTest.php` | The store's sizing bands and the mapping from body sizes to a recommended garment size |
| `tests/Feature/OrderVisibilityTest.php` | That a customer can only see and act on their own orders |
| `tests/Feature/AdminOperationsSnapshotTest.php` | Staff operational endpoints and the shape of their responses |
| `tests/Feature/DevAuthBypassTest.php` | That the development authentication bypass is refused outside its opt-in condition |
| `tests/Feature/ExampleTest.php`, `tests/Unit/ExampleTest.php` | Baseline framework checks |

Run with:

```bash
cd hiraya-backend
php artisan test
```

### 5.3.2 QA harness for try-on constraints

A measurement harness (`qa_tryon_constraints.mjs`) was written to check try-on renders
against geometric constraints — that a garment does not float above the shoulder line,
that no sticker-like overlay is present, and so on. Three real defects in the harness
itself were found and fixed, and the findings are recorded here because they are part of
the study's results:

1. The "no misplacement" check bounded only one side of the shoulder line, so a garment
   anchored *above* the shoulder passed. It now bounds both sides.
2. The "no sticker overlay" check was circular: it compared the garment against a body
   envelope derived from the rendered output itself, so it was incapable of failing. It
   now reads the envelope from the input portrait.
3. Vignette modelling in the mask-difference calculation is approximate.

### 5.3.3 Smoke tests for the renderer

A dedicated smoke script exercises the renderer's provider protocol — payload shape,
category mapping, synchronous and asynchronous response handling, and the
`not_configured` path when no token is present — without performing a billed render.
A stale assertion in this suite was found and corrected during verification: it expected
an `auto` category value that one vendor's API does not accept, which had been silently
returning a 422 in production. The corrected expectation matches what the renderer
deliberately sends and documents.

A path-resolution bug in an archived copy of the suite was also found and fixed: it
resolved the backend relative to its own directory, so moving the file broke it.

## 5.4 Manual and Visual Verification

### 5.4.1 Verified: a real end-to-end AI render

A genuine end-to-end render was performed through the application's own queue, with a
real person photograph and a real garment. The outcome:

- The try-on session reached `completed` status and produced a large result image.
- The rendered image was reviewed **by eye**, and confirmed to show: the correct body and
  pose preserved, the jeans preserved, the garment correctly positioned on the
  shoulders, and the face and background intact.
- The output was confirmed to be a real AI try-on and **not** the older 2D canvas
  composite, whose artefacts are visually distinct (a flat envelope shape and a printed
  colour label) and are still visible in archived QA output.

This is the strongest positive evidence in the study, and it was obtained by looking at
the image, not by reading a success flag.

### 5.4.2 Verified: the fallback is genuinely available

The 2D composite path was confirmed to run and produce output. It is free, offline, and
always available. It is explicitly **not** photorealistic, and this limitation is stated
in the interface rather than concealed.

### 5.4.3 Verified: end-to-end commerce flow

The storefront, cart, checkout, down payment, staff payment verification, balance
payment, order status transitions, courier tracking, delivery, and verified-purchase
review were exercised as a complete flow, consistent with the order state machine in
§3.5.3.

### 5.4.4 Verified: staff console access control

The console was confirmed to be unreachable without a valid session, and to require an
assurance-level-2 session for staff access. A staff session survives a page reload. The
customer-facing data returned to an admin is reduced and masked relative to what the
superadmin receives.

### 5.4.5 Verified: deployment

The system is deployed and reachable in both environments: the Laravel API as a Docker
web service and the frontend as a static site, with catalog images resolving through the
same-origin storage proxy.

## 5.5 Not Verified

The following are stated plainly because presenting them as verified would be false.

**N-1 — The QA harness has not been shown to score an AI render meaningfully.**
The harness was built for the 2D canvas composite and reads landmarks from a body
envelope. The AI render described in §5.4.1 was assessed by eye. The harness's numbers
should not be presented as evidence of AI output quality until this is demonstrated, and
the residual-vignette approximation noted in §5.3.2 should be checked empirically before
any mask-derived number is trusted.

**N-2 — Five failed try-on sessions were not root-caused.**
Several sessions failed with no output image during the same period in which successful
renders completed. The chain has retries, so this does not indicate a broken pipeline,
but the cause was not identified and is therefore not claimed to be fixed.

**N-3 — Load and performance testing was not performed.**
No concurrent-user or sustained-load test was run. The claim that the system handles
production traffic is therefore not made. What is documented is a measured local
observation: the single-threaded development server queues requests under several open
tabs, which is why the deployed image runs four workers.

**N-4 — No user acceptance testing with real customers was conducted.**
The evaluation is technical. No claim is made about conversion improvement, return-rate
reduction, or customer satisfaction, because no data on those was collected.

**N-5 — Provider cost per render was measured in one session only.**
A single measured worst-case render time and the resulting credit consumption were
recorded. That is sufficient to characterise the order of magnitude, not to project
monthly cost at scale.

**N-6 — Some quality limitations are inherent, not defects.**
The system does not achieve a natural fit in arbitrary poses and body orientations; hand
occlusion and pose generalisation remain open problems in the research literature as of
the most recent literature available to this study. The strongest open models found were
either non-commercially licensed or required GPU hardware the project does not have. This
is a boundary of the available technology, and the system is designed to state it rather
than to imply otherwise.

## 5.6 Requirement Traceability

| Requirement group | Status | Evidence |
|---|---|---|
| FR-1 – FR-5 (catalog) | Met | Storefront exercised end to end |
| FR-6 – FR-13 (accounts) | Met | Feature tests; console access verified |
| FR-14 – FR-24 (try-on) | Met, with the stated boundary | A real end-to-end AI render was produced and reviewed; N-1 and N-6 apply to quality measurement |
| FR-25 – FR-40 (orders) | Met | Full payment and delivery flow exercised |
| FR-41 – FR-45 (reviews) | Met | Reviews are gated on delivered order lines |
| FR-46 – FR-60 (console) | Met | Console access and role separation verified |
| NFR-1 (availability) | Met | Fallback confirmed available |
| NFR-2 (responsiveness) | Met | Rendering is queued; the client polls |
| NFR-3 – NFR-5 (security) | Met | Access chain verified; throttles in place |
| NFR-6 – NFR-8 (integrity, audit) | Met | Money, stock-movement, and audit designs in place |
| NFR-9 – NFR-13 | Met | Masking, connection recovery, config-driven providers, and honest output labelling in place |
| NFR-11 (portability) | Met | Same code runs locally and deployed |
| NFR-3 case: dev bypass | Met | `DevAuthBypassTest` covers the refusal |

Two requirements are met in a narrower sense than the wording implies, and are recorded
as such rather than claimed in full:

- **FR-16** (verify a person is present) is delegated to a vision model. It is a
  judgement call by a model, not a deterministic check, and the controller records the
  reasoning for why client-side alternatives were rejected.
- **FR-20** (always produce a result) is satisfied by a fallback that is explicitly not
  photorealistic. The requirement is met; the customer's expectation of quality is
  managed by the interface, not by the fallback itself.

## 5.7 Evaluation Against the Objectives

**Objective 1 — Analyse and document requirements.** Met. Nine problems, five stakeholder
groups, sixty functional requirements, thirteen non-functional requirements, eight
constraints, and seven assumptions are recorded in Chapter 2.

**Objective 2 — Design an architecture supporting a multi-provider chain with graceful
degradation, an asynchronous pipeline, and verified-purchase reviews.** Met. The design
in Chapter 3 and the implementation in Chapter 4 provide a config-driven provider chain
ending in an offline fallback, a queued render pipeline, and reviews gated on delivery.

**Objective 3 — Implement the system as a full-stack application with a storefront, a
staff console, and role-based access control with multi-factor authentication.** Met. The
system is implemented and deployed, with the console gated behind a three-stage
middleware chain and staff sessions required to reach assurance level 2.

**Objective 4 — Implement the AI-assisted styling feature.** Met. The studio, style
stack, render pipeline, stylist chat, fit-match indication, and history are implemented,
and a real end-to-end AI render was produced and reviewed.

**Objective 5 — Verify honestly and document what is not supported.** Met, and this is
the objective the study treats as most important. §5.5 records six items as not
verified, including the harness's applicability to AI renders, five unrooted session
failures, the absence of load testing, the absence of user acceptance testing, and the
inherent pose-generalisation limits of current try-on models.

## 5.8 Limitations

**Technical limitations.**

1. Rendering quality is bounded by third-party models the project does not control, and
   pose generalisation remains an open problem.
2. Each render consumes provider credits, so cost scales linearly with usage; free-tier
   quotas are finite.
3. A provider that serialises work will refuse or fold concurrent submissions, so peak
   throughput is bounded by the vendor, not by the application.
4. Try-on images are stored as Base64 in the database, which makes rows large. GD
   mitigates this for the history endpoint but does not remove the underlying cost.
5. The database export loads records into memory before streaming, so a very large
   catalogue would exhaust memory — the opposite of what its own comment claims.
6. A system-settings read has no cold-read timeout guard, so a slow connection pooler can
   make that endpoint hang.

**Study limitations.**

7. Verification was technical; no user acceptance testing with real customers was done.
8. No load or performance testing was done.
9. The QA harness's validity against AI renders is unproven.
10. Five session failures remain unrooted.

**Product limitations.**

11. Only the most significant garment in a stack is rendered, so a full layered outfit is
    not shown as a single image.
12. Reviews require a delivered order, so a new store has no ratings until orders are
    fulfilled.
13. The system is single-store and single-currency.

## 5.9 Recommendations

**For the shop.**

1. Use the try-on studio on high-uncertainty garments first — those where fit is the
   main reason for hesitation — and measure conversion on those products specifically.
2. Keep garment photography to the ghost-mannequin convention, which is the documented
   input format for the renderers and measurably improves the result.
3. Encourage customers to record their body sizes, since the fit-match badge and
   recommendations both depend on them.
4. Monitor the provider health panel before a promotional period; a rendering outage
   during a sale is the most likely way for the feature to become a liability.

**For a future developer or researcher.**

5. Add a second paid renderer slot in configuration, not in code, and confirm the
   provider-neutral renderer handles the difference as designed.
6. Root-cause the remaining failed sessions before enabling a retry-heavy workload, so
   the failure mix is understood rather than merely absorbed.
7. Replace the memory-resident export with a chunked one if the catalogue grows.
8. Rebuild the QA harness against AI output, or replace it with human review, rather
   than continuing to report its numbers as a quality signal.
9. Investigate pose-generalisation limits; this is the highest-value research direction
   for the system.
10. Add the remaining load and acceptance testing before treating the system as
    production-proven at scale.

**For the study's own integrity.**

11. Do not extend any claim in this document beyond what §5.5 records. The system's most
    valuable property is that it tells the truth about its own capability; that property
    is worth more to a reader than an inflated claim, and it is worth more to the shop
    than a customer who was promised a perfect fit and was not given one.

## 5.10 Conclusion

This study analysed, designed, implemented, and verified **Hiraya**, an AI-assisted
styling and virtual fitting system for a Filipino apparel business.

The analysis identified nine problems, of which fit uncertainty was the primary cause of
lost sales. The design responded with a three-tier architecture, a config-driven
provider chain ending in a guaranteed offline fallback, an asynchronous render pipeline,
and a three-stage access-control chain that requires a second factor for staff. The
implementation delivered a deployed storefront, a staff console, and a try-on studio
that produced a verified real AI render.

The strongest evidence gathered is a single end-to-end render that was reviewed by eye
and confirmed genuine. The most important result, however, is methodological: the study
distinguishes rigorously between what was verified and what was not, and it declines to
claim photorealism, arbitrary-pose accuracy, load capacity, or customer impact, because
none of those were demonstrated.

Within the honest boundary of current try-on technology, the system does what the shop
needs: it lets a customer see a garment on themselves before buying, it never silently
fails when a vendor is unavailable, and it does not promise more than it delivers.
