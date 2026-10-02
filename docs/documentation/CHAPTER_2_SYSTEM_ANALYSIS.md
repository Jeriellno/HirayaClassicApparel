# CHAPTER 2 â€” System Analysis and Requirements

## 2.1 Introduction

This chapter presents the analysis stage of the study: the current situation the system
addresses, the problems identified, the stakeholders, and the functional and
non-functional requirements that the design in Chapter 3 must satisfy.

## 2.2 Present State Analysis

Hiraya Classic Apparel is an independent apparel shop selling garments that customers
normally buy after trying them on â€” suits, formal sets, and related pieces. Before this
system, the selling process depended on physical inspection: a customer who wanted to
know how a jacket would look on them had to visit the store.

The shop's sizing policy existed as a fixed set of bands, but a customer could not relate
those bands to their own body without a fitting. Product photography showed colour, fabric
and cut, but not drape or proportion.

## 2.3 Problems Identified

**P1 â€” Fit uncertainty is the primary cause of lost sales.**
A product photograph cannot communicate how a garment sits on a particular body.
Customers who cannot visualise the garment defer the purchase, visit the store, or
abandon it entirely.

**P2 â€” The shop cannot demonstrate value online.**
Because fit cannot be shown, the online presence is limited to a catalogue of
photographs. There is no way for a customer to see a garment on themselves before
committing.

**P3 â€” Sizing advice is static and unverifiable.**
A customer must measure themselves and interpret the size bands themselves, with no check
on whether they measured correctly.

**P4 â€” Staff time is spent on repetitive questions.**
Staff repeatedly answer "will this fit me?" and "what size should I get?" Selling time
goes to explanation rather than to service.

**P5 â€” Returns consume revenue.**
Garments bought on a guess about fit are frequently returned or exchanged. Each return
costs stock, staff time, and a customer relationship.

**P6 â€” No measurable link between the try-on feature and sales.**
Without analytics on the try-on flow, the shop cannot know whether the feature helps, nor
which garments benefit most from it.

**P7 â€” Sensitive data must be access-controlled.**
The staff console exposes orders, customer records, third-party API credentials, and a
full database export. Access must be gated by role and elevated by a second factor.

**P8 â€” Order, payment, and stock integrity.**
The shop accepts a 50% down payment, so an order can exist in a partly paid state. Stock
is per colour and per size, must be reserved when the order is placed, must be returned
if the order is cancelled, and every movement must be attributable to a person and a
reason.

**P9 â€” The system must not depend on a single external service.**
The AI rendering path calls third-party providers. Those providers charge per render,
queue requests, rate-limit, and occasionally fail. A storefront whose central feature
disappears when a vendor is down is not usable.

## 2.4 Stakeholders

| Stakeholder | Description | Primary interest |
|---|---|---|
| **Customer** | A signed-in shopper browsing and purchasing | Seeing the garment on their own body; confidence in size; a clear, honest order status |
| **Guest visitor** | An unauthenticated visitor | Browsing the catalogue; reading the payment policy, cut-off, and store hours |
| **Staff (admin)** | An employee of the shop | Verifying payments, managing inventory, viewing customers and feedback |
| **Superadmin (owner)** | The shop owner | Full analytics, staff account management, system settings, API credentials, database export |
| **Courier partner** | LBC, or a Lalamove rider booked by the customer | Accurate delivery details and tracking numbers recorded against the order |

## 2.5 Functional Requirements

Requirements are numbered `FR-n`.

### 2.5.1 Catalog and product information

| ID | Requirement |
|---|---|
| FR-1 | The system shall display the catalogue on a shop page with categories, search, and a star rating on every product card. |
| FR-2 | The system shall display a product detail page showing images, colour variants, sizes, live per-variant stock, fabric details, and the store's size chart. |
| FR-3 | The system shall show `0.0 (0 reviews)` on a product with no reviews, and the real average once reviews exist. |
| FR-4 | The system shall support colour variants, each with its own photographs and its own per-size stock. |
| FR-5 | The system shall let a customer view garments suggested to complete a look, and outfits recommended from their stored measurements. |

### 2.5.2 Accounts and access control

| ID | Requirement |
|---|---|
| FR-6 | The system shall allow a visitor to register an account, and to sign in and sign out. |
| FR-7 | The system shall hash customer passwords and shall never store or log a plaintext password. |
| FR-8 | The system shall authenticate customers with bearer tokens rather than server sessions, so the frontend can remain a stateless single-page application. |
| FR-9 | The system shall require a TOTP authenticator challenge for every staff session, so that a staff session must reach assurance level 2 (`aal2`) before any console route answers it. |
| FR-10 | The system shall support three roles â€” customer, admin, superadmin â€” and shall enforce the distinction in the backend, not only in the interface. |
| FR-11 | The system shall let the superadmin invite a staff member by email link rather than by setting a password on the staff member's behalf. |
| FR-12 | The system shall allow a customer to request a password reset by email and to set a new password through a single-use, expiring, signed link. |
| FR-13 | The system shall allow a signed-in customer to permanently delete their own account, after re-verifying their current password. |

### 2.5.3 AI try-on studio

| ID | Requirement |
|---|---|
| FR-14 | The system shall let a customer upload a full-body photograph for use in the studio. |
| FR-15 | The system shall validate the uploaded photograph client-side for framing, lighting and resolution before submitting it. |
| FR-16 | The system shall verify that a real person is present in the photograph before allowing the studio to proceed. |
| FR-17 | The system shall let the customer select garments and layer them in a style stack before rendering. |
| FR-18 | The system shall render the selected garment onto the customer's photograph and return the result asynchronously, with a visible status. |
| FR-19 | The system shall state in the interface which garment was actually rendered, and shall not imply that a multi-garment stack was fully rendered. |
| FR-20 | The system shall always produce a result, degrading to a non-AI local composite when no AI renderer is available. |
| FR-21 | The system shall keep a history of the customer's past looks, with the ability to favourite, re-open, delete, and restore a look. |
| FR-22 | The system shall provide a stylist chat in which the customer can ask about styling and sizing. |
| FR-23 | The system shall display a fit-match indication comparing the garment's measurements with the customer's stored measurements. |
| FR-24 | The system shall indicate which renderer produced a result, and shall record renderer failures and recoveries as provider health events. |

### 2.5.4 Cart, checkout, and orders

| ID | Requirement |
|---|---|
| FR-25 | The system shall let a customer add, update, remove and clear items in a bag that persists server-side. |
| FR-26 | The system shall offer two payment options: a 50% down payment, or payment in full. |
| FR-27 | The system shall display the store's payment accounts, a scan-to-pay QR code, and a required reference number. |
| FR-28 | The system shall refuse a payment reference number that has already been used on a different order. |
| FR-29 | The system shall display the 15:00 Asia/Manila cut-off and the store hours, and shall state the processing date an order will receive. |
| FR-30 | The system shall require a complete address â€” street, barangay, city, province and four-digit ZIP â€” for LBC delivery. |
| FR-31 | The system shall require the customer to submit Lalamove booking details when Lalamove is chosen as the courier. |
| FR-32 | The system shall reserve stock per size and colour at checkout, and return it automatically if the order is cancelled or its down payment is rejected. |
| FR-33 | The system shall record a required reference number, receipt proof, and a staff verification decision against the down payment. |
| FR-34 | The system shall not allow an order to become ready to ship, shipped, or delivered until it is fully paid. |
| FR-35 | The system shall refuse cancellation of a fully paid order. |
| FR-36 | The system shall let staff record courier tracking details, or the customer's Lalamove booking reference, before marking an order shipped. |
| FR-37 | The system shall show the customer a visual order tracker with dates, status, and any outstanding balance. |
| FR-38 | The system shall let the customer pay the outstanding balance against an order. |
| FR-39 | The system shall notify the customer when an order's status changes. |
| FR-40 | The system shall let the customer mark notifications as read individually or all at once. |

### 2.5.5 Reviews and feedback

| ID | Requirement |
|---|---|
| FR-41 | The system shall allow a product review only from the owner of a delivered order line, and only one review per order line. |
| FR-42 | The system shall allow a 1â€“5 star rating of the overall order experience for a delivered order. |
| FR-43 | The system shall display the average rating and review count on the product page and the product card. |
| FR-44 | The system shall accept customer feedback only from a signed-in account, recording the sender's real name and email. |
| FR-45 | The system shall let staff read and respond to customer feedback and support requests. |

### 2.5.6 Staff console

| ID | Requirement |
|---|---|
| FR-46 | The system shall restrict the console to staff, and restrict superadmin-only sections to the superadmin. |
| FR-47 | The system shall provide admins with a work queue covering payments awaiting verification and stock needing attention, and with inventory management. |
| FR-48 | The system shall provide a quick stock adjust of Â± units for one size and colour, with a required reason. |
| FR-49 | The system shall record every stock movement with the person, the time, the quantity, and the reason, and shall display this as stock history. |
| FR-50 | The system shall let staff view customers and customer try-on history, with customer addresses masked for admins and unmasked for the superadmin. |
| FR-51 | The system shall let staff read product reviews, customer feedback, and support requests. |
| FR-52 | The system shall let the superadmin suspend and reactivate a customer account. |
| FR-53 | The system shall let the superadmin manage staff accounts: invite, create, reset a password, change role, re-issue a pending invitation, and revoke. |
| FR-54 | The system shall let the superadmin change system settings, including the payment QR image, cut-off, and public feature toggles. |
| FR-55 | The system shall let the superadmin put the storefront into maintenance mode, and shall have the storefront honour that state. |
| FR-56 | The system shall let the superadmin store, activate, verify and delete third-party API credentials, and shall never return a stored secret to the client. |
| FR-57 | The system shall report the health of the external AI and storage services, and shall allow a live probe of a single provider. |
| FR-58 | The system shall provide a superadmin-only analytics dashboard with revenue trend, top products, order statuses, try-on activity, and ratings. |
| FR-59 | The system shall let the superadmin export the database. |
| FR-60 | The system shall write an audit trail for console section views, sign-in and sign-out events, and staff account changes. |


## 2.6 Non-Functional Requirements

| ID | Requirement | How it is met |
|---|---|---|
| NFR-1 | **Availability.** The storefront shall remain usable when an AI provider is unavailable. | A fallback chain ending in a local, offline 2D composite. |
| NFR-2 | **Responsiveness.** No AI operation shall block an HTTP request. | Rendering runs in a queued job; the client polls a status endpoint. |
| NFR-3 | **Security — staff access.** No console route shall answer without an `aal2` Supabase session resolved to a staff user. | Three chained middleware: `supabase.aal2`, `supabase.user`, `admin`/`superadmin`. |
| NFR-4 | **Security — secrets.** No service-role key or provider secret shall ever be serialised into the frontend bundle or returned by an API. | Uploads and provider calls happen server-side; credentials are write-only over the API. |
| NFR-5 | **Security — rate limiting.** Authentication, password reset, and any endpoint that consumes a paid provider shall be rate limited. | Laravel throttle middleware sized per endpoint. |
| NFR-6 | **Integrity — money.** Money shall be stored and computed in integer minor units, not floats. | A dedicated migration adding money-integrity columns to orders. |
| NFR-7 | **Integrity — stock.** Stock shall never be silently changed. | A stock-movements table is the only writer; the quantity is derived from it. |
| NFR-8 | **Auditability.** Every privileged action shall be attributable. | An audit-log table with actor, subject, action, and detail. |
| NFR-9 | **Privacy.** Customer personal data shall be masked for staff who do not need it. | Role-based field reduction in the customer controller. |
| NFR-10 | **Usability — connection loss.** A dropped connection shall be visible and shall recover without a manual refresh. | A connection watcher that surfaces a *Reconnecting…* pill and invalidates queries on recovery. |
| NFR-11 | **Portability.** The system shall run on a developer machine and in the cloud from the same code. | A Docker image, environment-variable configuration, and a shared managed PostgreSQL database. |
| NFR-12 | **Maintainability.** Adding a second AI provider shall be a configuration change, not a rewrite. | One provider-neutral renderer class driven entirely by a config slot. |
| NFR-13 | **Honesty of output.** The system shall not claim a capability it did not deliver. | The renderer names the garment it actually rendered; the console states what is unverified. |

## 2.7 Constraints

| ID | Constraint |
|---|---|
| C-1 | No locally hosted or fine-tuned machine-learning model. All AI capability comes from cloud provider APIs, so no GPU is required. |
| C-2 | Commercial licensing only. Non-commercial research licences (for example CC BY-NC-SA try-on models) are excluded. |
| C-3 | AI providers are metered. Each render costs credits, and free-tier quotas are finite. |
| C-4 | Rendering is inherently slow. A single render can take well over a minute, far beyond a normal request budget. |
| C-5 | Third-party providers serialise work. A provider that runs one job at a time will refuse or fold concurrent submissions. |
| C-6 | Deployment budget is a free-tier hosting plan that sleeps after roughly fifteen minutes of inactivity. |
| C-7 | The system must work on mobile browsers, since customers photograph themselves on a phone. |
| C-8 | Philippine logistics: LBC and Lalamove, PHP pricing, and Asia/Manila as the store timezone. |

## 2.8 Assumptions

| ID | Assumption |
|---|---|
| A-1 | The customer has a smartphone or laptop with a camera and a modern browser. |
| A-2 | The customer's photograph is of the customer themselves, and they consent to it being processed for the try-on. |
| A-3 | Garment photography follows the ghost-mannequin convention, which is the documented input format for the VTON providers used. |
| A-4 | A customer is willing to sign in before using the try-on studio. |
| A-5 | Staff can be trusted to verify payments honestly; the system records and audits their actions. |
| A-6 | At least one AI provider remains available and within quota; if none is, the fallback still satisfies FR-20. |
| A-7 | The shop's catalogue is small enough that in-memory operations on it are acceptable. |

## 2.9 Conclusion of Chapter 2

This chapter set out the problems the study addresses, the stakeholder groups, the
functional and non-functional requirements, and the constraints and assumptions. Chapter 3
presents the design that satisfies them.
