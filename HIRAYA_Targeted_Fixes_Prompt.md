# HIRAYA — Targeted Fixes

Modify the existing HIRAYA codebase. Implement every requirement below using the smallest safe changes. Inspect relevant code and diagnose causes before editing; do not assume the reported loading issue means the server is down. Preserve unrelated features, authentication/MFA security, role permissions, existing data, and historical transactions. Reuse existing architecture and UI patterns; avoid broad refactors and new paid services. Make changes, not just recommendations.

## 1. Superadmin sign-in and dashboard loading
After successful sign-in/authentication, the screen sometimes keeps loading, redirects to Login, or eventually opens a dashboard whose data never finishes loading. Recovery currently requires opening the URL in another tab, signing out, and signing in again.
Reproduce and trace the authentication/session lifecycle, MFA state, route guards, token refresh, cookies, API responses, and dashboard requests. Fix the demonstrated cause, including any initialization race or repeated redirect/request loop. Wait for authentication initialization before deciding access; distinguish unauthorized responses from network/server/data errors. Provide recoverable error states instead of infinite loading. Do not bypass MFA or weaken authorization.
Acceptance: normal sign-in, reload, token refresh, and a second tab work without the workaround; valid sessions stay authenticated and dashboard data loads. Expired sessions and failed requests behave predictably.

## 2. Admin invitation URLs
Superadmin > Admin Management sends invitation emails successfully, but their links point to localhost. Generate invitation links from trusted environment-specific configuration using the existing framework/auth provider. Local development must keep working; future production configuration must use the deployed HTTPS frontend and correct acceptance route, with corresponding provider redirect allowlists where required. Do not hard-code an unknown production domain or derive trusted URLs from arbitrary request headers.
Preserve invitation token validation, expiry, and role assignment. Document required local/production variables and deployment steps in the existing example configuration/docs without exposing secrets. Do not deploy now.
Acceptance: local invitations work locally; with production configuration, generated links contain the deployed origin and no localhost. Test link generation and the acceptance flow where possible.

## 3. Admin Audit Logs
Remove Activity Logs from the Admin Audit Logs interface and navigation only. Retain Stock History and its existing functionality. Preserve underlying audit/security logging, stored history, and Superadmin behavior unless directly required for this UI change.

## 4. Order payment timeline — Admin and Superadmin
Order Details still shows “Downpayment Verified” after “Order Placed.” Align the timeline, labels, status mapping, and directly related transitions with HIRAYA's current single full-payment flow. Newly paid orders must show an accurate full-payment verification event; remove new-order downpayment/balance milestones and related split-payment assumptions wherever they affect this flow. Do not simply relabel a partial payment as fully paid.
Keep manual receipt verification and its existing authorization rules. Preserve truthful historical split-payment records. Leave unrelated fulfillment, shipping, cancellation, and order functionality unchanged.
Acceptance: pending and verified full-payment orders have correct timelines on both staff portals; historical partial payments are not misrepresented as fully paid.

## 5. Shop product-card listing
A product added through Superadmin Inventory appears on Home and in the Shop swipe feature, but is missing from the Shop's regular product-card listing. Trace the Shop query, eligibility/filtering, pagination, cache/state updates, and card data mapping. Ensure eligible newly added products appear in the regular Shop listing using the established card UI and consistent product data. Preserve intentional publication, availability, and user filters; do not expose draft/ineligible products or redesign Home/swipe functionality.
Acceptance: an eligible new product appears in Home, Shop swipe, and regular Shop cards after the intended update/refresh; images, price, and product actions work on mobile and desktop.

## 6. AI try-on rendering speed
Perform a focused review of the try-on request path. Measure available timings for upload/preprocessing, queueing, provider rendering, polling, and result retrieval. Reduce demonstrated avoidable latency through compatible changes such as removing redundant work, reusing safe existing results, parallelizing independent operations, and correcting polling/state handling. Preserve output quality, garment accuracy, privacy, credit accounting, and the existing provider unless a change is essential and authorized. Do not claim provider processing time can always be reduced.
Acceptance: compare timings before/after under comparable conditions where feasible; identify provider-bound limits. No duplicate render submissions, extra credit deductions, or unrelated changes.

## 7. Two-garment try-on
Selecting two garments in Style Stack currently renders only one. Trace selected-item state, payload construction, backend validation, category/slot mapping, and actual provider capabilities. For a supported compatible pair, both selected garments must reach the rendering pipeline and appear together in one resulting image, preserving garment identity and the source photo. Do not silently drop or overwrite an item.
Use the provider's supported multi-garment flow where available. If a safe sequential approach is necessary, verify its quality and maintain the established per-request credit policy; additional internal steps must not silently charge extra credits. Include all selected garment IDs/content versions and relevant configuration in existing reuse fingerprints, so a one-garment result is never reused for a two-garment request.
If the provider cannot support the requested combination reliably, implement clear validation and explain the exact limitation instead of claiming support. Keep single-garment rendering working and prevent incompatible selections from silently producing incomplete results.
Acceptance: test single-garment and supported two-garment requests, payload contents, visible results, credit handling, and result reuse.

## Completion
Run focused tests/checks for all seven requirements and regressions in affected flows. Do not claim untested email delivery, provider output, deployment, or performance results. Mark environment/credential blockers explicitly and finish all work that can be completed locally.
Provide a concise report: root causes supported by evidence; changed files and any migrations/configuration; fixes implemented; tests and results; measured rendering timings; invitation deployment settings; and remaining limitations. Preserve unrelated functionality and production data.
