# HIRAYA System Fixes and Feature Changes — Master Implementation Prompt

You are modifying an existing working HIRAYA system. Implement **all requirements below** using the **smallest safe changes possible**.

## Global Implementation Rules

- Preserve all existing working features unless a change is explicitly required below.
- Do not redesign, rename, remove, or refactor unrelated modules.
- Reuse the current architecture, database structure, components, routes, services, and UI patterns whenever possible.
- Apply proper backend validation, authorization, database constraints, and error handling. Do not rely only on frontend validation.
- Maintain responsive behavior on desktop and mobile.
- Prevent duplicate records, unintended credit deductions, broken redirects, and inconsistent state.
- Before changing database schemas, inspect existing relationships and migrations. Use non-destructive migrations and preserve existing production data.
- Existing accounts/data must remain valid unless a requirement explicitly states otherwise.
- After implementation, test affected customer/user, admin, and superadmin flows and report:
  1. files/modules changed,
  2. migrations/configuration added,
  3. logic removed or replaced,
  4. security changes,
  5. any behavior that intentionally remains unchanged.

---

# 1. Superadmin / Admin

## Add Product — AI Autofill

Keep the existing **Auto Fill with AI** feature and its current behavior except:

- **Product Name must NOT be generated or overwritten by AI.**
- The user must manually enter the Product Name.
- All other currently supported AI-autofilled product fields must continue working exactly as before.

## Product Reviews

The existing separate **Product Reviews** area is broken.

- Remove the broken/duplicate Product Reviews section.
- Keep a single review interface.
- Place the **Product Reviews** heading/content under the existing review filters:
  - All
  - 5 Star
  - 4 Star
  - 3 Star
  - 2 Star
  - 1 Star
- Feedback and product reviews must be treated as one unified review system, including mobile.

## Customer Management

### Superadmin

Inside a customer's profile:

- Remove **Try-On History** from the admin-visible customer profile for privacy.
- Remove customer **Active/Inactive** status from the profile.

### Admin

- Completely remove the **Customer Management** tab from the Admin panel only.
- Do not remove it from Superadmin unless already required elsewhere.

## Admin Management — Authenticator Status

In Superadmin > Admin Management:

- Fix authenticator/2FA status tracking.
- If an admin has already completed authenticator setup and can access the Admin-only panel, Superadmin must no longer show that account as **On First Sign-In**.
- Show the correct current authentication/setup state based on the real backend security state, not a stale UI value.

## Inventory Management Permissions

### Admin side

For every product in Admin > Inventory Management:

- Remove/hide:
  - Add Product
  - Edit button / pencil icon
  - Delete button
- Admin may retain allowed read/view/inventory operations that already exist.

### Superadmin side

Retain full existing product controls:

- Add Product
- Edit Product
- Delete Product

Enforce these restrictions server-side as well as in the UI.

---

# 2. Login and Registration

Apply these rules to **future customer/user accounts only**. Do not alter or invalidate existing accounts.

## Verified Gmail Requirement

For new registrations:

- Require a real, accessible **@gmail.com** account.
- Verify ownership through an email verification link or one-time verification code before activating the account.
- Do not accept a Gmail-format address as “verified” merely because its syntax is valid.
- Login must require an existing verified account.
- Preserve existing accounts without forcing migration unless already supported safely.

## Password Validation

Keep all existing password validation rules and additionally require:

- At least one special character.

Apply the same rule consistently in frontend and backend validation.

---

# 3. Customer / User Side

## Personalized Recommendations vs Style Stack

Keep the current personalized outfit recommendations shown after registration/login based on profile information such as:

- fit preference,
- size,
- relevant style information.

However:

- Recommended items must **NOT automatically enter the Style Stack**.
- The Style Stack must remain empty until the user explicitly performs the existing **Bag/Add to Style Stack** action.
- Existing recommendation logic must otherwise remain unchanged.

## Stylist Chat

Fix the Stylist Chat so it behaves contextually.

### Normal conversation

The assistant may answer questions related to:

- HIRAYA,
- HIRAYA garments/products,
- styling,
- garment combinations,
- fit combinations,
- sizing guidance,
- seasonal styling,
- closely related fashion guidance within the HIRAYA experience.

Do **not** automatically display recommendation cards for every message.

Recommendation cards should appear only when they are relevant to the user's request or the current try-on/render context.

### After a rendered try-on image exists

When the user has rendered a photo using a selected garment:

- Do not make the response primarily about “matched size.”
- Analyze the resulting look at a high level using available system data/context.
- Give useful styling observations.
- Recommend complementary HIRAYA garments/outfits that fit the selected garment/look.
- Seasonal recommendations may be used when relevant.
- Keep recommendations in the current card-style UI.
- Do not recommend unrelated products randomly.

## “What Makes a Good Photo” UI

Fix the output/display of the **What Makes a Good Photo** button.

- Make the content readable, properly spaced, responsive, and visually consistent with the current HIRAYA design.
- Keep the guidance concise and useful.
- Do not redesign unrelated areas.

## Try-On History → Gallery + Recently Deleted

Before making any changes, activate and follow the ui-ux-pro-max skill fist on this part. Analyze the current interface using its UI/UX guidelines, then implement the improvements.

For this feature:

- Rename **History** to **Gallery**.
- Keep the existing rendered try-on photos in the Gallery.
- Add a **Recently Deleted** area/button.
- Deleting a rendered photo must perform a **soft delete**, not immediate permanent deletion.
- Recently Deleted must allow the user to:
  - view deleted renders,
  - restore them,
  - permanently delete them.
- Ensure users can access only their own images.
- Use a safe retention period if the project already has one; otherwise implement a reasonable configurable retention policy instead of hard-coding behavior throughout the app.
- Maintain mobile and desktop responsiveness.

## Duplicate Try-On Render Prevention / Credit Protection

Before starting a paid render:

- Check whether the same user already has a valid completed render using the **same source photo and same garment/configuration**.
- If an identical reusable render exists, return/show the existing result instead of rendering again.
- Do not deduct credits again.
- Use a reliable server-side fingerprint/hash or equivalent deterministic identification method.
- Do not rely only on filenames.
- If the source image, garment, relevant render configuration, or required version changes, treat it as a new render.
- Do not expose one user's cached render to another user.

## Payment Tab

- Remove the displayed **Reference Number** field/value from the customer Payment tab only.
- Do not change unrelated payment information or functionality unless required by the payment security/full-payment changes below.

## Feedback and Reviews

- Merge **Feedback** into **Product Reviews**.
- There must be one unified rating/review flow on desktop and mobile.
- Do not show a separate Feedback feature when it represents the same product review data.

## My Orders

Fix both responsive and desktop behavior:

- Product image must display correctly on mobile and desktop.
- Orders must initially appear as compact **rows/cards**, not with all details expanded.
- Users may open/expand/view an order to see full details.
- Keep current order actions and data unless explicitly affected by another requirement.

## Review Product

- Rating and review content must be part of **one unified review form/component**.
- Do not separate rating into a disconnected flow.
- Keep validation and submission consistent across mobile and desktop.

## Delete Account

Fix the Delete Account feature.

Current bug: it redirects to Home without deleting the account.

Required behavior:

- Require appropriate confirmation/re-authentication if supported by the project.
- Perform the intended account deletion/deactivation flow securely.
- Invalidate the user's active sessions after success.
- Handle dependent records safely according to existing project/business rules.
- Do not silently redirect to Home on failure.
- Show clear success/error feedback.
- Do not delete data that must legally/business-wise be retained; anonymize or soft-delete where the existing architecture requires it.

---

# 4. Remove the 50% Downpayment Flow — All Sides

Apply this consistently to Customer/User, Admin, and Superadmin.

Remove the entire **50% downpayment / remaining 50% balance** concept.

The order/payment flow must use **one full payment for the total order price**.

Update all directly related logic, including where present:

- checkout/payment calculations,
- payment amount validation,
- order payment status,
- remaining balance calculations,
- payment labels,
- admin/superadmin payment views,
- customer payment views,
- receipt validation,
- notifications,
- reports,
- database/service logic that explicitly represents the split-payment flow.

Rules:

- Do not remove unrelated order/payment features.
- Preserve historical payment records safely.
- If old records contain 50% payment data, keep them readable and do not corrupt historical transactions.
- New transactions must use the new full-payment flow only.
- Remove obsolete split-payment conditions only when they are confirmed to belong exclusively to the old 50/50 flow.
- In the final implementation report, explicitly state which 50% downpayment-related logic was removed, migrated, retained for history, or replaced.

---

# 5. System-Wide Language Switching

Fix language switching so the selected language applies throughout the entire supported application, not only the navbar or isolated cards.

Apply localization consistently to supported user-facing text in:

- Customer/User portal
- Admin portal
- Superadmin portal
- navigation
- forms
- validation messages where localization is supported
- buttons
- headings
- cards
- dialogs/modals
- status labels
- empty states
- notifications/toasts
- relevant review/order/payment/gallery screens

Requirements:

- Use the project's existing localization/i18n architecture where available.
- Avoid hard-coded translated strings scattered across components.
- Persist the selected language using the project's appropriate account/session/local storage mechanism.
- Do not translate database values that are intended to remain canonical identifiers.

---

# 6. Rendered Photo Security / Database and Storage

Secure user-rendered photos against unauthorized access, including if application/database data is exposed.

Implement defense in depth:

- Do not store rendered photos in a publicly browsable directory/bucket.
- Use private object/file storage.
- Store only protected storage identifiers/paths in the database rather than permanently public URLs when possible.
- Require authenticated, authorized access before a user can retrieve a render.
- Enforce ownership checks server-side.
- Use short-lived signed URLs or an authenticated streaming endpoint for image delivery.
- Apply least-privilege storage permissions.
- Prevent predictable object paths where practical.
- Encrypt data in transit using HTTPS/TLS.
- Use encryption at rest from the storage provider/platform; if the current architecture supports application-managed encryption safely, follow the project's established key-management approach rather than hard-coding encryption keys.
- Never store encryption keys or storage secrets in source code or the database beside the encrypted data.
- Keep secrets in environment/secret management.
- Ensure logs do not expose private image URLs, tokens, secrets, or image contents.
- Recently Deleted images must remain protected by the same rules.
- Permanent deletion must remove the underlying stored object when appropriate.

Important:
Database encryption alone does not protect a photo if a public storage URL remains accessible. Secure both metadata and the actual stored file.

In the final implementation report, explain:
- where the file is stored,
- what the database stores,
- how authorization is checked,
- how the image is delivered,
- what happens on soft delete and permanent delete.

---

# 7. Manual Payment Security — Receipt Fraud Protection

Keep the current **manual payment** model. Do not convert the project to an automatic payment gateway unless one already exists and is required elsewhere.

The system must not automatically trust a receipt image simply because it looks legitimate.

## Required secure flow

1. Customer places an order and pays the **full order amount**.
2. Customer uploads the payment receipt/proof.
3. Store the receipt privately using the same protected-file principles described above.
4. Validate basic file properties:
   - allowed image/file type,
   - MIME type,
   - file size,
   - safe filename/storage key,
   - malware/file safety checks where supported.
5. Extract useful receipt information using the project's available OCR/AI capability where appropriate, such as:
   - amount,
   - date/time,
   - recipient/merchant,
   - payment method/provider,
   - visible transaction details.
6. Compare extracted data with the actual order:
   - expected full amount,
   - merchant/payment destination,
   - plausible transaction date/time,
   - order/user relationship.
7. Detect obvious anomalies, duplicate receipt uploads, reused images, altered metadata, inconsistent amounts, or suspicious mismatches.
8. AI/image analysis may return a **risk signal**, but it must **not be the sole authority** for declaring a receipt genuine.
9. Final payment approval must use a reliable verification step available to the business, such as checking the merchant's actual payment transaction history/dashboard or another trusted transaction record.
10. Payment statuses should clearly distinguish states such as:
    - Pending Verification
    - Verified/Paid
    - Verification Failed / Needs Review
11. Do not mark an order Paid solely because OCR or AI says the image appears authentic.
12. Ensure only authorized staff can approve/reject payment proof.
13. Log payment verification actions in an audit trail.
14. Prevent the same receipt/payment proof from being reused across multiple orders where detectable.
15. Do not expose sensitive receipt information publicly.

### Important Security Principle

AI-generated/fake receipt detection is probabilistic and can be bypassed. Use AI/OCR as an assisting fraud/risk layer, not as the final source of truth. A trusted transaction record or authorized manual reconciliation must determine final payment approval.

Do not reintroduce the removed customer-facing Reference Number field merely to satisfy this requirement. If an internal transaction identifier is available from trusted payment records, it may be stored internally without restoring the removed UI field.

---

# 8. Acceptance Checklist

Before considering the task complete, confirm all items below:

- [ ] AI Autofill no longer fills Product Name but still fills its other supported fields.
- [ ] Product Reviews/Feedback are unified.
- [ ] Try-On History is removed from staff-visible customer profile.
- [ ] Customer Active/Inactive label is removed from that profile.
- [ ] Customer Management is removed from Admin only.
- [ ] Admin authenticator status is accurate in Superadmin Admin Management.
- [ ] Admin cannot add/edit/delete inventory products.
- [ ] Superadmin retains add/edit/delete inventory controls.
- [ ] Future registrations require verified @gmail.com ownership.
- [ ] Future passwords require a special character.
- [ ] Recommendations do not automatically enter Style Stack.
- [ ] Stylist Chat no longer shows unrelated recommendation cards.
- [ ] Post-render stylist recommendations are contextual to the rendered garment/look.
- [ ] “What Makes a Good Photo” output is fixed.
- [ ] History is renamed Gallery.
- [ ] Recently Deleted supports restore and permanent deletion.
- [ ] Duplicate same-photo/same-garment renders reuse the existing result and do not charge credits again.
- [ ] Customer Payment tab no longer displays Reference Number.
- [ ] My Orders images work on mobile/desktop and orders start collapsed/compact.
- [ ] Product rating + written review are one flow.
- [ ] Delete Account works securely.
- [ ] New orders use 100% full payment only.
- [ ] Old 50/50 records remain historically safe/readable.
- [ ] Language switching affects the whole supported system.
- [ ] Rendered images are private and authorization-protected.
- [ ] Receipt uploads are privately stored and securely validated.
- [ ] AI/OCR fraud checks are advisory, not final proof.
- [ ] Payment is marked Paid only after trusted/manual verification.
- [ ] Unrelated existing functionality remains unchanged.

## Final Output Required From You

After completing the implementation, provide a concise technical summary containing:

1. Changes made per module.
2. Exact files/components/controllers/services/migrations changed.
3. Database changes and backward-compatibility handling.
4. Security changes.
5. How full-payment verification now works.
6. How duplicate render reuse prevents unnecessary credit deductions.
7. How Gallery/Recently Deleted works.
8. What was removed from the former 50% downpayment system.
9. Tests performed and any remaining limitations.
