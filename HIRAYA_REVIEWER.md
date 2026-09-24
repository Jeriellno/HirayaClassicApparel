# Hiraya Code Reviewer

This is a study guide for the current Hiraya codebase. Read it in order. Every entry answers: **what is this file, what does it do, and what does it connect to?**

## 1. Whole-system flow

```text
Browser
  -> React starts at src/main.jsx
  -> App.jsx decides which page/route to show
  -> Pages compose components and hooks
  -> axios.js sends API calls to Laravel
  -> Laravel routes/api.php maps a request to a controller
  -> Controller validates/reads/writes Eloquent models
  -> MySQL stores users, products, wishlists, and try-on sessions

Separate Supabase flow:
  MainDashboard.jsx -> Supabase Storage uploads product images
  App.jsx -> Supabase system_settings reads maintenance mode
```

## 2. Read these foundation files first

| File | What to learn | Main connection |
|---|---|---|
| `hiraya-frontend/src/main.jsx` | React entry point; mounts the application into HTML. | Starts `App.jsx`. |
| `hiraya-frontend/src/App.jsx` | The central frontend router. It wraps the app in `AuthProvider`, checks maintenance mode from Supabase, protects member pages, and maps URL paths to pages. | Uses `AuthContext`, `Navbar`, every page. |
| `hiraya-frontend/src/api/axios.js` | The one HTTP client for Laravel. It uses `http://127.0.0.1:8000/api`, adds the Sanctum token, and logs out a user after a 401 response. | Used by pages and hooks making API calls. |
| `hiraya-frontend/src/context/AuthContext.jsx` | Global login state. `checkUser()` calls `/user`; `login()` calls `/login` and saves the token; `logout()` calls `/logout`, clears the token, then redirects. | Used by `App.jsx`, Login, Navbar, protected routes. |
| `hiraya-backend/routes/api.php` | Laravel’s API map. This is the first backend file to inspect when a frontend request fails. | Maps URLs to controllers. |

## 3. Frontend routes: what each page means

| Route | File | What happens |
|---|---|---|
| `/` | `pages/Home.jsx` | Landing page. It loads products and passes them to home/guest components. |
| `/login` | `pages/Login.jsx` | Collects credentials and calls `AuthContext.login()`. |
| `/register` | `pages/Register.jsx` | Sends registration data to `/register`. |
| `/shop` | `pages/Shop.jsx` | Catalog browsing, filters, and wishlist interaction. |
| `/product/:id` | `pages/ProductDetail.jsx` | Fetches one product, handles variants, canvas tracking, try-on tracking, and cart action. |
| `/wishlist` | `pages/Wishlist.jsx` | Protected saved-items / style-stack screen. |
| `/try-on` | `pages/AiTryOn.jsx` | Protected virtual try-on workspace. |
| `/settings` | `pages/AccountSettings.jsx` | Protected profile and body-measurement settings. |
| `/admin` | `pages/MainDashboard.jsx` | Admin inventory, insights, and stock alert container. |
| `/superadmin` | `components/superadmin/SuperAdmin.jsx` | Superadmin console UI. |

## 4. Authentication reviewer

### Frontend files

| File | Inside / key logic | Flow |
|---|---|---|
| `pages/Login.jsx` | Sends email/password through `login(credentials)`. | Login form -> AuthContext -> `/login` -> token in localStorage. |
| `pages/Register.jsx` | Posts `full_name`, email, password, and password confirmation. | Register form -> `/register` -> user created. |
| `context/AuthContext.jsx` | Holds `user`, `loading`, `login`, `logout`, `updateUser`. | All components can read the same signed-in user. |
| `components/common/Navbar.jsx` | Shows navigation based on authenticated user state. | Reads AuthContext. |

### Backend files

| File | Inside / key logic |
|---|---|
| `Api/AuthController.php` | `register()` validates and creates a default `user`; `login()` verifies password and creates Sanctum token; `logout()` revokes current token; `me()` returns logged-in user. |
| `Models/User.php` | Defines allowed user fields, hides password/token fields, and has cart and try-on relationships. |
| `database/migrations/0001_01_01_000000_create_users_table.php` | Creates the base `users` table. |
| `database/migrations/2026_04_26_073033_add_profile_fields_to_users_table.php` | Adds fit preferences and body data. |
| `database/migrations/2026_07_20_000001_add_portrait_base64_to_users_table.php` | Adds portrait data for virtual try-on. |
| `database/migrations/2026_04_13_093400_create_personal_access_tokens_table.php` | Creates Sanctum token storage. |

## 5. Product and Shop reviewer

### Frontend files

| File | Purpose | Important idea |
|---|---|---|
| `hooks/useShopData.js` | Fetches products and wishlist data and performs product/wishlist operations. | Central shop data hook. |
| `pages/Shop.jsx` | Assembles the shop page UI. | Uses shop hook and shop components. |
| `pages/ProductDetail.jsx` | Fetches one product by ID. Tracks Canvas and Try-On clicks. | Product detail is where a customer starts engagement. |
| `components/product/ProductCard.jsx` | Reusable catalog card. | Receives product data through props. |
| `components/product/ProductGallery.jsx` | Renders product image gallery. | Uses `image_url`/`images`. |
| `components/product/VariantSelector.jsx` | Selects color/size variant. | Supplies selected variant to actions. |
| `components/product/SizeTable.jsx` | Shows measurement/size reference. | Reads `size_measurements`. |
| `components/product/StylistBox.jsx` | Presents styling guidance. | Presentation component. |
| `components/shop/ShopHeader.jsx` | Header/search area for shop. | Shop presentation. |
| `components/shop/CategoryRow.jsx` | Category filter controls. | Changes displayed product group. |
| `components/shop/QuickViewModal.jsx` | Product preview modal. | Opens without leaving shop. |
| `components/common/SearchBar.jsx` | Reusable search input. | Parent owns filtering logic. |
| `utils/imageHelper.js` | Normalizes/falls back image URLs. | Prevents broken images. |
| `constants/config.js` | Shared constants/configuration. | Check this before duplicating constants. |

### Backend files

| File | Purpose | Important methods |
|---|---|---|
| `Api/ProductController.php` | Product REST controller. | `index`, `show`, `store`, `update`, `destroy`. |
| `Models/Product.php` | Product database representation. | Casts JSON fields; defines wishlist and try-on relations. |
| `database/migrations/2026_04_13_093654_create_products_table.php` | Creates product fields. | Images, variants, price, stock, metadata. |
| `database/migrations/2026_08_18_021612_add_analytics_counters_to_products_table.php` | Adds canvas and try-on counters. | Supports analytics. |
| `Api/GarmentController.php` | Separate garment taxonomy/catalog endpoint. | `index`, `catalog`. |
| `Models/Garment.php` | Garment layer/category data. | Used for clothing-stack concepts. |
| `database/migrations/2026_07_23_000001_create_garments_table.php` | Creates garment records. | Includes layer ordering. |
| `database/seeders/ProductSeeder.php` | Sample/default product data. | Use for local test data. |
| `database/seeders/GarmentSeeder.php` | Sample garment data. | Use for garment catalog testing. |
| `database/factories/ProductFactory.php` | Generates fake products in tests/seeders. | Testing support. |

### Product request flow

```text
Shop or Home
  -> useShopData/Home requests GET /products
  -> routes/api.php selects ProductController@index
  -> Product model reads MySQL products
  -> JSON returns to React
  -> ProductCard/Shop/ProductDetail renders the data
```

## 6. Wishlist reviewer

| File | What it does |
|---|---|
| `hooks/useWishlist.js` | Fetches saved items, adds items, removes items. This is the main customer-wishlist API hook. |
| `pages/Wishlist.jsx` | Builds the member’s saved-items screen and tracks selected item. |
| `components/wishlist/WishlistHeader.jsx` | Displays wishlist title/count. |
| `components/wishlist/WishlistItemCard.jsx` | Renders one saved item and remove action. |
| `components/wishlist/WishlistSummaryCard.jsx` | Shows saved-item totals. |
| `components/wishlist/OutfitStackPreview.jsx` | Visual preview of selected saved garment stack. |
| `Api/WishlistController.php` | Reads, adds, increments, updates, and deletes wishlist records. |
| `Models/Wishlist.php` | Connects a user and a product, including selected size/color and quantity. |
| `database/migrations/2026_08_12_125800_create_wishlists_table.php` | Creates wishlist table. |

### Wishlist flow

```text
Customer presses Save
  -> frontend POST /wishlist with product_id, selected_size, selected_color
  -> WishlistController checks whether same user/product/size/color exists
  -> existing item quantity increases OR a new Wishlist record is created
  -> GET /wishlist returns Wishlist records with related Product data
```

## 7. Admin reviewer

### Admin shell

| File | What it does |
|---|---|
| `pages/MainDashboard.jsx` | Owns Admin state: products, selected product, form data, selected image, Supabase upload, save/delete actions. |
| `components/admin/Admin.jsx` | Switches active tabs: Inventory, Wishlist Insights, Alerts. |
| `components/admin/AdminHeader.jsx` | Admin header and sidebar toggle. |
| `components/admin/AdminNav.jsx` | Admin navigation and low-stock badge. |
| `components/common/Modal.jsx` | Reusable confirm/information modal used in admin operations. |

### Inventory tab

| File | What it does |
|---|---|
| `admin/tabs/inventory/InventoryTab.jsx` | Main split-view Inventory screen. Left catalog, right editor. Calculates total stock from size stock. |
| `ProductCatalogList.jsx` | Scrollable, selectable catalog list. |
| `ProductBasicInfo.jsx` | Product name/category/price/basic fields. |
| `SizeInventoryManager.jsx` | UI for individual size stock values. |
| `useSizeInventory.js` | Converts and calculates sizes/stock. This is the inventory business-logic hook. |
| `ProductImageUpload.jsx` | Product image input and preview. |
| `BulkStockMatrixEditor.jsx` | Bulk inventory editor component. Check its parent use before changing it. |

### Wishlist Insights tab

| File | What it does |
|---|---|
| `admin/tabs/wishlist/WishlistTab.jsx` | Composes the split-panel Wishlist Insights screen. |
| `useWishlistAnalytics.js` | Fetches `/analytics/wishlist-engagement`, normalizes snake_case/camelCase counters, provides totals. |
| `DemandCatalog.jsx` | Left selectable product-demand catalog. |
| `GarmentInsights.jsx` | Right sticky selected-product analytics panel. |
| `MetricCard.jsx` | Small reusable card for one analytics metric. |

### Alerts tab

| File | What it does |
|---|---|
| `admin/tabs/alerts/AlertsTab.jsx` | Filters products whose stock is below 5. |
| `AlertItem.jsx` | Renders a single low-stock product. |

### Admin image/data flow

```text
Admin selects a file
  -> MainDashboard stores preview locally
  -> uploadImageToSupabase uploads to bucket product-images
  -> public URL is stored in the product payload
  -> Current create/update implementation writes the payload to Supabase products
  -> Laravel GET /products reads MySQL products

Important: these are currently two different data sources. Align them before calling
Admin inventory fully integrated.
```

## 8. Analytics reviewer

| File | What it does |
|---|---|
| `Api/AnalyticsController.php` | Calculates wishlist count and returns product engagement data; increments canvas/try-on counters. |
| `ProductDetail.jsx` | Sends tracking requests when Canvas or AI Try-On buttons are used. |
| `admin/tabs/wishlist/useWishlistAnalytics.js` | Requests and formats analytics for the admin console. |
| analytics-counter migration | Adds `canvas_drag_count` and `try_on_count` to products. |

### Analytics flow

```text
Product Detail action
  -> POST /products/{id}/track-canvas OR /track-tryon
  -> AnalyticsController increments Product counter
  -> Wishlist Insights GET /analytics/wishlist-engagement
  -> Admin sees wishlist saves, canvas uses, and AI try-ons
```

## 9. AI Try-On reviewer

| File | What it does |
|---|---|
| `pages/AiTryOn.jsx` | Screen that composes the virtual fitting workspace. |
| `hooks/useTryOnState.js` | Owns portrait, measurements, garment selection, request/polling state, and chat state. |
| `components/tryon/BodyProfileForm.jsx` | Form for height, waist, and chest. |
| `components/tryon/StyleStack.jsx` | Selected garments/layers UI. |
| `components/tryon/TryOnCanvas.jsx` | Displays the generated try-on result. |
| `components/tryon/StylistChat.jsx` | Chat UI for styling feedback. |
| `Api/TryOnController.php` | Active queued try-on API: initiate, check status, history. |
| `Models/TryOnSession.php` | Session state machine: queued, processing, completed, failed. |
| `Jobs/ProcessTryOnJob.php` | Background processor calling Replicate/Hugging Face or mock fallback. |
| `Api/AiTryOnController.php` | Older/upload-oriented controller; currently not registered in `routes/api.php`. |
| `Jobs/ProcessVirtualTryOn.php` | Additional try-on job; inspect if adding legacy feature back. |
| `Models/AiTryOnSession.php` | Additional legacy/alternate session model. |

### Intended Try-On flow

```text
User enters measurements and submits portrait + garment images
  -> POST /tryon/initiate
  -> TryOnController creates TryOnSession
  -> ProcessTryOnJob runs through queue
  -> frontend polls GET /tryon/status/{sessionId}
  -> TryOnCanvas displays result
```

### Current integration note

`useTryOnState.js` calls `/tryon/generate` and `/tryon/chat`, but those routes are not currently in `routes/api.php`. The active backend routes are `/tryon/initiate`, `/tryon/status/{sessionId}`, and `/tryon/history`.

## 10. Account settings reviewer

| File | What it does |
|---|---|
| `pages/AccountSettings.jsx` | Reads current user and updates profile preferences. |
| `components/settings/SettingsHeader.jsx` | Account settings header. |
| `components/settings/PersonalInfoSection.jsx` | Name and personal preference inputs. |
| `components/settings/VirtualTryOnSection.jsx` | Try-on/profile-related settings section. |
| `components/settings/Field.jsx` | Reusable settings field UI. |
| `hooks/useTryOnState.js` | Reads/saves `/user/measurements`. |

Backend profile routes are defined inline in `routes/api.php`:

```text
PUT /user/profile
GET /user/measurements
POST /user/measurements
```

## 11. Other frontend files

| File/group | What it does |
|---|---|
| `components/home/HeroSection.jsx` | Landing hero presentation. |
| `components/home/HowItWorksSection.jsx` | Explains product workflow visually. |
| `components/home/SpotlightSection.jsx` | Featured product/feature display. |
| `components/home/UserWelcomeBanner.jsx` | Signed-in welcome display. |
| `components/home/FooterCtaBanner.jsx` | Home call-to-action section. |
| `components/GuestHero.jsx` | Guest landing hero. |
| `components/GuestVisualAid.jsx` | Guest explanation/visual element. |
| `components/GarmentCard.jsx` | General garment display card. |
| `components/MeasurementModal.jsx` | Measurement capture modal. |
| `pages/MyOrders.jsx` | Orders UI; it requests `/orders`, which is not registered in backend routes yet. |
| `utils/stylistHelper.js` | Styling-related helper functions. Read it when studying styling suggestions. |
| `supabase.js` | Creates the Supabase client. It is used for maintenance mode and product image storage. |
| `index.css`, `App.css` | Global styles and shared visual rules. |

## 12. SuperAdmin reviewer

| File | What it does |
|---|---|
| `superadmin/SuperAdmin.jsx` | Main superadmin console container. |
| `SuperAdminHeader.jsx` | Superadmin header. |
| `SuperAdminNav.jsx` | Superadmin navigation. |
| `tabs/DashboardTab.jsx` | Superadmin overview UI. |
| `tabs/InventoryTab.jsx` | Superadmin inventory UI. |
| `tabs/AnalyticsTab.jsx` | Superadmin analytics UI. |
| `tabs/CanvasAssetsTab.jsx` | Canvas asset management UI. |
| `tabs/AiEngineTab.jsx` | AI engine configuration/status UI. |
| `tabs/AdminsTab.jsx` | Administrator-management UI. |
| `tabs/FeedbackTab.jsx` | Feedback-management UI. |
| `tabs/SettingsTab.jsx` | System-settings UI. |

Treat these as UI modules until their API calls are verified individually. There is no explicit superadmin route group in the current `routes/api.php`.

## 13. Backend support files

| File | What it does |
|---|---|
| `Api/CartController.php` | Contains cart methods: list, add, delete, clear. It is not currently connected to API routes. |
| `Models/CartItem.php` | Database model for one bag/cart entry. |
| `database/migrations/2026_04_13_093705_create_cart_items_table.php` | Creates cart table. |
| `database/seeders/UserSeeder.php` | Local seeded users. |
| `database/seeders/DatabaseSeeder.php` | Chooses which seeders run. |
| `database/factories/UserFactory.php` | Creates fake users for tests. |
| `app/Providers/AppServiceProvider.php` | Laravel app-level service configuration. |
| `routes/web.php` | Browser/web Laravel routes; not the React API route map. |
| `routes/console.php` | Laravel command scheduling/console routes. |

## 14. Important study checklist: working versus needing alignment

### Connected flows to study first

```text
Login -> Sanctum token -> AuthContext -> protected route
Products -> ProductController -> Product model -> Shop/Product Detail
Wishlist -> WishlistController -> Wishlist model -> Wishlist page
Analytics -> AnalyticsController -> Wishlist Insights UI
```

### Flows that need backend/frontend alignment

```text
Cart: ProductDetail posts /cart but cart routes are absent.
Orders: MyOrders requests /orders but orders backend is absent.
Try-On: useTryOnState calls /tryon/generate and /tryon/chat but routes are absent.
Admin save: create/update writes Supabase products while product fetch reads Laravel/MySQL.
Admin authorization: auth:sanctum exists, but role-based admin middleware does not.
Wishlist delete: route parameter naming and controller expectation differ.
```

## 15. How to study without getting overwhelmed

1. Start with `App.jsx`, `axios.js`, `AuthContext.jsx`, and `routes/api.php`.
2. Follow one simple feature: Login.
3. Follow Products from `Shop.jsx` -> `useShopData.js` -> `ProductController.php` -> `Product.php`.
4. Follow Wishlist next.
5. Then read Admin Inventory and Wishlist Insights.
6. Read Try-On last: it is the most advanced flow because it includes queues and external AI services.

Never edit a component before identifying its parent, its props, its API hook, and the matching backend route.
