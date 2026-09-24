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

### Step 2: User Records Body Measurements

User visits **Account Settings** (`/settings`) → `AccountSettings.jsx` →
`PUT /user/measurements` → `UserController::updateMeasurements`.

The 5 fields are stored directly on the `users` table:
`chest_bust`, `waist`, `hips`, `shoulder_width`, `sleeve_length`

### Step 3: Spotlight Recommendation Cross-Reference

```
Client: SpotlightSection.jsx
  → useOutfitRecommendations.hook (8 items)
    → api.get('/outfits/recommended?limit=8')
      → OutfitRecommendationController::index
        → OutfitRecommendationService::getRecommendations($user)
          → Product::whereNotNull('size_measurements')->get()
            → evaluateProductFit($userMetrics, $sizeChart)
              [Tolerance: ±2.5cm per measurement]
              [Threshold: >= 70% match score]
          → Returns { has_measurements, recommendations[] }
        → SpotlightSection renders ProductCard[] with FitMatchBadge
```

**Key files in the chain:**

| File | Role |
|---|---|
| `src/components/product/SpotlightSection.jsx` | Renders the "Your Size Spotlight" / "Curated Spotlight" section |
| `src/hooks/useOutfitRecommendations.js` | React Query hook; calls `/outfits/recommended`; invalidates on measurement changes |
| `app/Http/Controllers/Api/OutfitRecommendationController.php` | Controller; returns `{ has_measurements, recommendations }` |
| `app/Services/OutfitRecommendationService.php` | Service; queries products, evaluates fit per size using ±2.5cm tolerance |
| `app/Models/User.php:29-33` | The 5 core measurement fields on the user |
| `app/Models/Product.php:22` | The `size_measurements` JSON column |

**Alignment fix applied**: `OutfitRecommendationController` now returns `recommendations`
(previously `outfits`), matching the key expected by `SpotlightSection.jsx:41`.

### Step 4: Frontend Display

`SpotlightSection.jsx` reads:
- `recPayload.has_measurements` — controls the "Set My Measurements" fallback CTA
- `recPayload.recommendations` — array of products with `match_score` and `recommended_size`
- `FitMatchBadge` shows the score and matched size on each `ProductCard`

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
