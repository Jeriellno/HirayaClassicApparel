# Product Creation & Body Measurement Technical Guide

## Overview

This document covers the two product creation surfaces in the Admin and SuperAdmin panels, the
`size_measurements` field that drives the Spotlight recommendation engine, and the components
needed to capture per-size measurement ranges (S/M/L/XL/Custom) during product entry.

---

## 1. Product Addition Locations

There are **two parallel product systems** in this codebase. Both must be understood when working
with measurements.

### System A — `products` table (Laravel API + Supabase)

This is the primary product catalog used by the Admin and SuperAdmin UI surfaces and by the
Spotlight recommendation engine.

| Component | File | Role |
|---|---|---|
| **Admin Panel** | `src/pages/MainDashboard.jsx` | Page wrapper; manages form state, calls `api.post('/admin/products')` |
| **Admin Tabs** | `src/components/admin/Admin.jsx` | Tab controller; renders `InventoryTab` inside `AdminLayout` |
| **Admin Inventory Tab** | `src/components/admin/tabs/inventory/InventoryTab.jsx` | Inline product form with `ProductBasicInfo`, `SizeInventoryManager`, `ProductImageUpload` |
| **SuperAdmin Inventory** | `src/components/superadmin/tabs/InventoryTab.jsx` | Supabase-backed product table + inline modal form |

**API route**: `POST /api/admin/products` → `ProductController::store`
**Model**: `App\Models\Product` — has `size_measurements` (JSON/array cast)
**Migration**: `2026_09_05_010000_add_garment_specifications_to_products_table.php`

### System B — `garments` + `garment_sizes` tables (Laravel only)

This is a secondary system with its own migration and controller. The `garment_sizes` table stores
measurement ranges as individual decimal columns (`chest_bust_min`, `waist_max`, etc.).

| Component | File | Role |
|---|---|---|
| **GarmentController** | `app/Http/Controllers/Api/GarmentController.php` | `storeOrUpdate()` validates 5 measurement ranges per size |
| **GarmentSize Model** | `app/Models/GarmentSize.php` | Fillable includes `chest_bust_min`, `waist_max`, etc. |
| **Migration** | `2026_09_06_024043_add_measurements_to_garment_sizes_table.php` | Creates `garment_sizes` table with min/max columns |

**API route**: `POST /api/admin/garments` → `GarmentController::storeOrUpdate`

> **Note**: System B's `index` and `catalog` methods were added to close the gap with existing
> routes in `api.php` (lines 30-31) that previously called methods that did not exist.

---

## 2. Where to Add Body Measurement Fields

### Currently Missing

Neither the Admin `InventoryTab` (inline form) nor the SuperAdmin `InventoryTab` (inline modal)
has UI for entering measurement ranges. The `size_measurements` field exists on the `Product`
model (see `app/Models/Product.php:22`) and is parsed in `MainDashboard.jsx:107-110`, but no
form inputs populate it.

### New Components Created

Two standalone modal components were created in the admin inventory folder with full measurement
range input support:

| Component | File | Description |
|---|---|---|
| **AddProductModal** | `src/components/admin/tabs/inventory/AddProductModal.jsx` | Modal for creating new products with S/M/L/XL/Custom size measurement ranges |
| **EditProductModal** | `src/components/admin/tabs/inventory/EditProductModal.jsx` | Modal for editing existing products with pre-populated measurements + delete action |
| **MeasurementFields** | `src/components/admin/tabs/inventory/MeasurementFields.jsx` | Shared component: `SizeMeasurementPanel` renders the 5 core measurement min/max inputs per size |

**Size variants**: `S`, `M`, `L`, `XL`, `Custom`
**5 Core measurements per size** (all in cm):

| Measurement Key | Label |
|---|---|
| `chest_bust_min` / `chest_bust_max` | Chest / Bust |
| `waist_min` / `waist_max` | Waist |
| `hips_min` / `hips_max` | Hips |
| `shoulder_width_min` / `shoulder_width_max` | Shoulder Width |
| `sleeve_length_min` / `sleeve_length_max` | Sleeve Length |

### How to Wire Into Existing Panels

**Admin panel** (`MainDashboard.jsx`): The `AddProductModal` and `EditProductModal` can replace
the inline form in `InventoryTab.jsx`. Pass the `onSave` callback that calls:
```js
// For Admin panel (System A — ProductController)
await api.post('/admin/products', payload)   // or api.put for edits
```

The `payload.sizes` array should be structured as:
```json
[
  {
    "size_label": "S",
    "stock": 10,
    "chest_bust_min": 80,
    "chest_bust_max": 85,
    "waist_min": 70,
    "waist_max": 75,
    "hips_min": 85,
    "hips_max": 90,
    "shoulder_width_min": 35,
    "shoulder_width_max": 38,
    "sleeve_length_min": 60,
    "sleeve_length_max": 65
  }
]
```

**SuperAdmin panel** (`SuperAdmin.jsx` → `tabs/InventoryTab.jsx`): The SuperAdmin InventoryTab
already has an inline modal. The `AddProductModal`/`EditProductModal` components can be dropped in
as a replacement, wiring `onSave` to the Supabase `upsert` or the Laravel API.

---

## 3. Measurement Data Flow — How Spotlight Recommendations Work

### Step 1: Admin Captures Product Measurements

When a product is saved via `AddProductModal`/`EditProductModal`, the 5 measurement ranges per size
are included in the payload. The backend `ProductController::store` (`/api/admin/products`) accepts
any fields in the validated list (`sizes`, `size_measurements`, etc.) and stores them as JSON on
the `products.size_measurements` column.

**To add validation for measurement fields in the ProductController**, update the `$validated`
array in `app/Http/Controllers/Api/ProductController.php:45-62`:
```php
'size_measurements' => 'nullable|array',
```
The existing JSON-decoding loop at lines 73-79 already handles this.

### Step 2: User Records Their Sizes

User visits **Account Settings** (`/settings`) → `AccountSettings.jsx` →
`VirtualTryOnSection.jsx` → `PUT /user/sizes` → `UserController::updateSizes`.

> **CHANGED (2026-09-29).** The 5 Core Body *Measurements* the customer used to type
> (`chest_bust`, `waist`, `hips`, `shoulder_width`, `sleeve_length`) are **gone**.
> The user table now carries two size labels — `upper_body_size` and
> `lower_body_size` (e.g. both `M`). Centimetres are no longer stored per user:
> they are resolved on demand from `App\Services\SizeChart`, so there is exactly
> one set of numbers in the system and it cannot drift from the catalogue.
>
> GARMENT measurements (`products.size_measurements`, `garment_sizes.*_min/_max`)
> are unaffected — those describe the garment, not the person.

### Step 3: Spotlight Recommendation Cross-Reference

```
Client: SpotlightSection.jsx
  → useOutfitRecommendations.hook (8 items)
    → api.get('/outfits/recommended?limit=8')
      → OutfitRecommendationController::index
        → OutfitRecommendationService::getRecommendations($user)
          → Product::whereNotNull('sizes')->get()
            → matchedSizeFor(product.sizes, axis, upper, lower)
              [Axis by category: lower body for pants/skirts/shorts,
               upper body for everything else]
              [A product matches when its stock includes the customer's size]
          → Returns { has_sizes, recommendations[] }
        → SpotlightSection renders ProductCard[] with FitMatchBadge
```

**Key files in the chain:**

| File | Role |
|---|---|
| `src/components/product/SpotlightSection.jsx` | Renders the "Your Slim Fit Spotlight" / "Curated Spotlight" section |
| `src/hooks/useOutfitRecommendations.js` | React Query hook; calls `/outfits/recommended`; keyed on the two size labels |
| `app/Http/Controllers/Api/OutfitRecommendationController.php` | Controller; returns `{ has_sizes, fit_style, recommendations }` |
| `app/Services/OutfitRecommendationService.php` | Service; SIZE is the gate, FIT STYLE is the ranking (see below) |
| `app/Services/SizeChart.php` | The single size ladder; `normaliseLabel()` guards every stored label |
| `app/Models/User.php` | `upper_body_size` / `lower_body_size` / `preferred_fit` on the user |
| `app/Models/Product.php:22` | The `size_measurements` JSON column; `ai_tags->fit_type` holds the cut |

### The two gates: size is the gate, fit style is the ranking

A product is RECOMMENDED only if it clears **both**:

1. **SIZE (the gate).** The product is stocked in a size the shopper actually
   wears. The axis is chosen by category — bottoms use `lower_body_size`,
   everything else `upper_body_size`. No size match means no recommendation,
   whatever the cut.
2. **FIT STYLE (the ranking).** The shopper's `preferred_fit` (lowercase:
   `slim` / `regular` / `oversized`) is compared with the product's AI-tagged
   `ai_tags->fit_type` (uppercase: `SLIM` / `REGULAR` / `LOOSE`).
   `OutfitRecommendationService::FIT_STYLE` is the only place that translates
   between the two vocabularies.

Scores: same cut **100**, one rung away **80/70**, the far end **60**, and a
product with **no** `fit_type` **70** — deliberately mid-pack, so an untagged
garment can never outrank one a stylist explicitly tagged for that shopper.
With no `preferred_fit` on file every match scores a flat **70**, which restores
the old size-only behaviour rather than guessing a silhouette.

### A garment with no `fit_type` is invisible to this feed

This is why the add/edit product form requires a fit type to be a real
decision. `InventoryTab.jsx` offers **"Not set — no fit recommendation"** as a
first-class option and warns under it, because an untagged garment reads as
score 70 and will be pushed below every tagged match. The AI auto-fill is the
intended way to avoid that state: it tags the cut from the photo.

### Step 4: Frontend Display

`SpotlightSection.jsx` reads:
- `recPayload.has_sizes` — controls the "Set Your Sizes" fallback CTA
- `recPayload.fit_style` — the shopper's own fit in catalog vocabulary
  (SLIM / REGULAR / LOOSE), or null when they have no fit preference on file
- `recPayload.recommendations` — products with `fit_score`, `recommended_size`,
  `customer_fit`, `garment_fit` and `fit_reference`
- `FitMatchBadge` shows "Recommended for slims · Size M" when
  `customer_fit === garment_fit`, and falls back to score bands otherwise

---

## 4. Summary of All Modified/Created Files

### Backend
| File | Change |
|---|---|
| `routes/api.php` | Added `POST /admin/garments`, `PUT /admin/garments/{id}`, `GET /admin/garments/spotlight-recommendations` |
| `app/Http/Controllers/Api/GarmentController.php` | Fixed namespace, added `index()`/`catalog()`, fixed `category_id`→`category`, wrapped spotlight response |
| `app/Http/Controllers/Api/OutfitRecommendationController.php` | `outfits`→`recommendations` key fix |
| `database/migrations/2026_09_06_024043_...` | Verified correct (kept); deleted 2 duplicate migrations |

### Frontend
| File | Change |
|---|---|
| `Admin.jsx` | Refactored to use `AdminLayout`; removed burger menu state |
| `SuperAdmin.jsx` | Refactored to use `SuperadminLayout`; removed burger menu state |
| `AdminLayout.jsx` | New — permanent sidebar + header, no burger menu |
| `SuperadminLayout.jsx` | New — permanent sidebar + header, no burger menu |
| `AddProductModal.jsx` | New — product creation modal with 5 measurement ranges per S/M/L/XL/Custom |
| `EditProductModal.jsx` | New — product edit modal with measurement ranges + delete action |
| `MeasurementFields.jsx` | New — shared `SizeMeasurementPanel` with 5 measurement min/max inputs |
| Deleted | `AdminHeader.jsx`, `AdminNav.jsx`, `SuperAdminHeader.jsx`, `SuperAdminNav.jsx` |
