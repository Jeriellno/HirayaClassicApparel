# Hiraya: AI-Driven Smart Wardrobe Stylist & Virtual Fitting Room
### System Architecture, Project Progress, & Developer Execution Context for Claude Code

## 1. Project Vision & Core Strategy
Hiraya is an independent, high-end web application acting as an AI-driven smart wardrobe stylist and virtual fitting room. Designed specifically to run as a native full-stack application without heavy, volatile desktop machine-learning models or custom localized training libraries, Hiraya uses a clean, cloud-powered data architecture. The core user flow involves:
1. User authenticates securely.
2. User uploads a high-quality portrait photo which is converted directly into a Base64 string on the frontend.
3. User interacts with a chat-based AI styling interface, mixing and matching items from their curated catalog or cart using an absolute-positioned layering interface (Outfit Stack).
4. The backend dispatches these Base64 interactions asynchronously to an external cloud AI model (Gemini Multimodal API / Hugging Face Serverless Inference API) to return a structured fitting response.
5. Always explain your changes.

## 2. Technical Stack & State Management
- **Frontend Architecture:** React.js (Vite), Tailwind CSS, Framer Motion (for luxury glassmorphism aesthetics).
- **Backend Architecture:** Laravel (Stateless API endpoints, Laravel Sanctum token-based protection).
- **Database Engine:** MySQL / MariaDB (managed via phpMyAdmin).
- **Image Architecture:** High-capacity data streams. All image uploads bypass the filesystem entirely and are transmitted as raw Data URIs (Base64) stored inside `longText` fields within MySQL.
- **State & Data Caching:** `AuthContext.jsx` for global token management and `@tanstack/react-query` for handling asynchronous, real-time cart counts and layout invalidations.
- **AI Integration Protocol:** Pure serverless API calls utilizing the native Google Gemini PHP/Guzzle context or Hugging Face Inference Contracts. No heavy node modules or local vision dependencies allowed.
- **Asynchronous Pipeline:** All AI requests must be handled using non-blocking state flags (e.g., status fields: 'pending', 'processing', 'success') accompanied by frontend polling to prevent server-side request timeouts during panel presentations.

## 3. Project File Tree & Component Layout
```text
/ (Project Root)
├── hiraya-frontend/          # React + Vite Production Build
│   ├── src/
│   │   ├── components/       
│   │   │   └── Navbar.jsx    # Premium dynamic navbar with glassmorphism scroll logic and live useQuery cart counts
│   │   ├── context/          
│   │   │   └── AuthContext.jsx # Central axios interceptor and user authentication state provider
│   │   ├── pages/            
│   │   │   ├── Login.jsx     # Minimalist, glass-card sign-in module (strict request payload structure)
│   │   │   ├── Register.jsx  # Account creation engine generating hashed DB schemas
│   │   │   └── AiTryOn.jsx   # Pure React upload interface utilizing FileReader for instant Base64 transformation
│   │   └── index.css         # Custom core design variables (hiraya-charcoal, hiraya-gold, glass-card blueprints)
│   └── package.json
│
└── hiraya-backend/           # Laravel REST API Engine
    ├── app/
    │   ├── Http/Controllers/Api/   
    │   │   ├── AuthController.php   # Handles Bcrypt hashing comparisons and Sanctum token provisioning
    │   │   └── TryOnController.php  # Accepts incoming Base64 JSON payloads and records active styling data
    │   └── Models/                 
    │       └── User.php             # Core model exposing profile columns, roles (admin/user), and image payloads
    ├── database/
    │   └── migrations/             # Schemas designed with proper length allocations (VARCHAR(255) passwords, longText portrait blobs)
    └── routes/
        └── api.php                 # Token-gated endpoints protected via sanctum middleware handlers