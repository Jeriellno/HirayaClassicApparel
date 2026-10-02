# CHAPTER 1 — Introduction and Background of the Study

## 1.1 Introduction

Hiraya is a full-stack e-commerce and artificial-intelligence (AI) system developed for
**Hiraya Classic Apparel**, a Filipino apparel shop. The system combines a conventional
online storefront with an **AI-assisted virtual fitting room** that allows a customer to
preview how a garment would look on their own body before committing to a purchase.

The title of this study is **"AI Assisted Styling for Hiraya."** The phrase captures the
system's two integrated halves: a normal apparel store, and an AI layer that assists the
customer in choosing what to wear and how it will fit.

The system was built and is hosted as a live web application. It is deployed on
Render.com as a Dockerised Laravel API (`https://hiraya-classicapparel.onrender.com`)
plus a static React single-page application
(`https://hirayaclassicapparel-1.onrender.com`).

## 1.2 Background of the Study

### 1.2.1 The problem in apparel retail

Apparel e-commerce in the Philippines — and in most markets where garments are bought
infrequently and in person — suffers from a persistent problem: **customers cannot
evaluate fit from product photography.** A flat-lay photo or a ghost-mannequin shot
tells a customer the colour, the fabric, and the cut, but not how the garment drapes
over *their* proportions. The consequences are predictable:

- high return rates caused by fit dissatisfaction;
- repeated store visits before purchase;
- abandoned carts where the customer was "not sure about the size";
- lost sales for pieces that the customer would have bought had they felt confident.

For a small independent shop, this is not an abstract cost. It is a direct loss of
revenue and of repeat customers.

### 1.2.2 Existing solutions and their limits

Three categories of solutions exist today:

1. **Size charts and measurement guides.** Cheap and universal, but static. They ask the
   customer to measure themselves, and they still cannot answer "how does this look on
   me?"
2. **Manual staff fitting.** Accurate but scarce, slow, and unscalable.
3. **Existing online try-on services.** These exist, but they are generally oriented to
   cosmetics or to head-wear. Purpose-built garment virtual try-on (VTON) is a recent
   development, and the strongest models are expensive, credit-metered, and — critically —
   many of the strongest open research models are licensed non-commercially.

### 1.2.3 Why an AI-assisted approach

An AI-assisted system attacks the problem at the point of doubt. Instead of asking the
customer to trust a photograph, the system shows the customer the garment *on their own
photograph*. This directly addresses the primary cause of abandonment.

The word **assisted** in the title is deliberate and is used in its strongest, most honest
sense. Hiraya does not attempt to be an autonomous stylist that invents outfits from
scratch, nor does it claim photorealism in arbitrary poses — that remains an open
research problem. What the system does is:

- render a **single, most significant garment** onto the customer's real photograph;
- state plainly in the interface which garment was actually rendered;
- provide a **guaranteed non-AI fallback** so the feature never simply fails;
- give the customer a **stylist chat** and a **fit-match signal** to support the decision.

This honesty is a design requirement, not a courtesy: the project's own handoff
documentation records repeated incidents of overpromising rendering quality, and treats
"say what was not verified" as a hard rule.

## 1.3 Objectives of the Study

The general objective is to develop and evaluate an AI-assisted styling and virtual
fitting system for a small apparel business.

The specific objectives are:

1. To analyse the requirements of an apparel store that supports a virtual try-on
   experience, and to document those requirements as user and system requirements.
2. To design a system architecture that supports a multi-provider AI rendering chain with
   graceful degradation, an asynchronous job pipeline, and verified-purchase reviews.
3. To implement the system as a full-stack web application with a customer storefront, a
   staff console, and role-based access control with multi-factor authentication.
4. To implement an AI-assisted styling feature comprising a virtual try-on studio, an
   outfit-stack interface, a stylist assistant, and a fit-match indication.
5. To verify the implementation through automated tests, smoke tests, and a manual
   evaluation, and to document honestly which claims are supported by evidence and which
   are not.

## 1.4 Significance of the Study

**For the business (Hiraya Classic Apparel).** A customer who has seen a garment on
their own body is a customer who buys. The system protects stock by reserving inventory
at checkout, records every stock movement with an auditable reason, and surfaces
conversion-relevant analytics to the owner.

**For the customer.** Reduced risk of purchasing the wrong size; a faster path from
browsing to decision; a clear, visible order tracker; and a review system gated on
verified purchase so that ratings reflect real buyers only.

**For developers and future researchers.** The repository documents a real, working
pattern for building a commercial VTON storefront without hosting any machine-learning
model: a provider-neutral renderer interface, a fallback chain, and an honest
capability boundary. The limitations documented here are reusable knowledge.

## 1.5 Scope and Deletion of the Study

**In scope.**

- The customer-facing storefront: catalog browsing, product detail, cart, checkout,
  order tracking, reviews, notifications.
- The AI try-on studio: photo upload and validation, garment selection and stacking,
  rendering, and the history of past looks.
- The staff console: inventory, orders, customers, feedback, stock history, audit logs,
  analytics, administration, and system settings.
- Access control: customer accounts, staff accounts, and superadmin privileges, including
  TOTP-based multi-factor authentication for staff.
- Deployment on Render.com with a shared Supabase PostgreSQL database.

**Out of scope.**

- Any locally hosted or fine-tuned machine-learning model. The system calls cloud
  provider APIs only; no GPU is required and no custom training is performed.
- Multi-vendor marketplace behaviour, subscription billing, and international shipping.
- Native mobile applications. The frontend is a responsive web application only.
- Automated garment manufacturing or inventory logistics.

## 1.6 Definitions of Terms

For clarity, the following terms are used throughout this document.

| Term | Meaning as used in this document |
|---|---|
| **AI-assisted styling** | The use of a cloud AI model to help a customer evaluate and choose apparel — principally by rendering a garment onto the customer's own photograph. It does not mean autonomous outfit invention. |
| **Virtual try-on (VTON)** | The generation of an image showing a person wearing a specific garment, generated from a photograph of that person. |
| **Ghost mannequin** | A product photograph of a garment with the mannequin removed, leaving the garment's shape. This is the documented input format expected by the VTON providers used here. |
| **Base64 data URI** | A binary image encoded as text, so it can travel inside a JSON request. Hiraya uses these for try-on portraits and renders. |
| **Provider chain / fallback chain** | An ordered list of renderers tried in sequence until one succeeds. Hiraya's order is VTON API → Gemini → Replicate → 2D composite. |
| **2D composite fallback** | A browser-side canvas routine that pastes a garment cutout onto the customer's photograph. Free, offline, guaranteed — but flat and not photorealistic. |
| **Assurance level (aal)** | Supabase Auth's measure of session strength. `aal2` means the session was elevated by a second factor. Staff sessions must be `aal2`. |
| **Cut-off** | The 15:00 Asia/Manila deadline before which an order is processed the same day. |
| **Down payment** | A 50% payment that reserves stock; the balance is due before courier pickup. |
| **Verified purchase** | An order that reached `delivered` status. Only such orders may leave a product review or an order rating. |
| **Style stack** | The interface in which the customer layers a small number of garments before rendering. |
| **Fit-match badge** | A heuristic indication of how a garment's measurements compare with the customer's stored measurements. |
| **Provider health event** | A record of a renderer failing or recovering, used by the console's health display. |
| **Hot path** | A code path that must not block on an external, slow, or unreliable service. |

## 1.7 Summary

This chapter established the business problem (fit uncertainty in apparel e-commerce), the
gap it creates, and the honest boundary of what an AI-assisted styling system can
currently promise. It defined the objectives, the scope, and the vocabulary used in
Chapters 2 to 5.
