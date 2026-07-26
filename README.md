# General Procurement Suite

A unified, cloud-backed procurement web app for the Egyptian market. It merges two pre-existing tools **without modifying them** (they run untouched inside isolated iframes) and adds six new modules on top of a Firebase Firestore database.

## Structure

```
/                                     ← GitHub Pages site root
├── index.html                        ← redirects to unified/index.html
├── .nojekyll                         ← disable Jekyll (serve files as-is)
├── .gitignore                        ← ignores serviceAccountKey.json + node_modules
├── firestore.rules                   ← RBAC security rules (paste into console)
├── firestore.indexes.json            ← composite indexes for pagination
├── functions/                        ← Cloud Function: setUserRole (optional)
├── admin/                            ← local role bootstrap script (set-role.js)
├── order-generator-first update claude.html   ← LOCKED tool (untouched)
├── procurement supplier warehouse.html         ← LOCKED tool (untouched)
└── unified/
    ├── index.html                    ← app shell (hosts the tools + new modules)
    ├── css/
    │   └── theme.css                 ← premium design system (light + dark)
    └── js/
        ├── firebase-config.js        ← ⚠ paste your Firebase config here
        ├── auth.js                   ← Firebase Google sign-in + role claim
        ├── rbac.js                   ← client role/permission matrix
        ├── store.js                  ← Firestore data layer (mirror, RBAC guard, pagination)
        ├── seasonality.js            ← Egypt seasonality engine
        ├── forecasting.js            ← forecast, smart order, slab optimiser
        ├── pricing.js                ← discount cascade + true margin
        ├── contracts.js              ← rebate contracts + target tracker
        ├── offers.js                 ← offers/redemption ROI
        ├── sellout.js                ← sellout upload + demo seeder
        ├── dashboard.js              ← master dashboard KPIs
        ├── bridge.js                 ← non-invasive import from the locked tools
        └── app.js                    ← shell UI, routing, theme toggle, budgets
```

The UI has a **light/dark theme toggle** (🌙/☀️ in the top bar); the choice persists and defaults to your OS preference. The theme wraps the shell only — the locked tools keep their own original styling inside their frames.

## 1. Connect Firebase (Firestore)

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Firestore Database → Create database** (test mode while developing).
3. **Project settings → Your apps → Web app** → copy the config object.
4. Paste it into [`unified/js/firebase-config.js`](unified/js/firebase-config.js).
5. Reload — the top bar shows **● Firestore (cloud)**. Until then it runs **● Local (offline)** on localStorage, so you can develop with no account.

The Firestore web config is **not secret** (it ships in client code by design); real security comes from **Firestore Rules**. Starter rules are documented in `firebase-config.js`. Lock them down before making the site public.

### Enable Google sign-in
1. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.**
2. **Authentication → Settings → Authorized domains → Add domain** and add `<you>.github.io` (and `localhost` for local testing) so the sign-in popup is allowed.
3. Once real config is present, the app shows a **Sign in with Google** gate; after sign-in the top bar shows your account chip and a sign-out button. In offline mode (placeholder config) the gate is skipped.

## Roles & security (RBAC)

Access is driven by a Firebase Auth **custom claim** `role`, one of `manager | specialist | warehouse | finance` — mirroring the roles already in the locked PRO-TRACK tool. The client matrix lives in [`unified/js/rbac.js`](unified/js/rbac.js); the **authoritative** enforcement is [`firestore.rules`](firestore.rules).

| Role | Reads | Writes |
|---|---|---|
| Procurement Manager | all | everything + **role management** |
| Procurement Specialist | all | suppliers, branches, sellout, orders, contracts, offers |
| Warehouse Operator | all | sellout, orders |
| Finance Analyst | all | budgets, contracts |

### Apply the security rules
Firebase console → **Firestore Database → Rules** → paste [`firestore.rules`](firestore.rules) → **Publish** (or `firebase deploy --only firestore:rules`).

### Bootstrap the first manager (no Functions needed)
Custom claims must be set with the Admin SDK. Fastest path:
1. Sign into the app once so your Auth account exists.
2. Console → **Project settings → Service accounts → Generate new private key** → save as `admin/serviceAccountKey.json` (**secret — it's git-ignored, never commit it**).
3. `cd admin && npm install && node set-role.js you@email.com manager`
4. Sign out/in. You're now a manager and can assign everyone else from **Administration → Users & Roles** in the app.

### In-app role management (optional — needs Cloud Functions)
Deploy [`functions/`](functions/index.js) (`firebase deploy --only functions`, Blaze plan) to enable the manager-only **Users & Roles** screen, which calls the `setUserRole` callable (verified server-side). Without it, use the admin script above.

## Performance as data grows

- **Scoped subscriptions:** `sellout` and `orders` (the unbounded collections) are subscribed only for an active **month window** (default last 24 months). The Master Dashboard's **Data horizon** selector calls `Store.setWindow(...)` so Firestore reads stay proportional to what you view. Small collections stay fully mirrored.
- **Cursor pagination:** `Store.pageQuery(collection, {where, orderBy, dir, limit, cursor})` browses large collections without loading them into memory (works in cloud with `startAfter`, and falls back to offset slicing offline).
- **Composite indexes:** [`firestore.indexes.json`](firestore.indexes.json) covers `supplierId + month` (and `branchId + month`) queries. Deploy with `firebase deploy --only firestore:indexes`, or click the auto-generated index link Firestore prints the first time such a query runs. The month-range subscriptions need only auto-created single-field indexes.

### Collections (schema)
`suppliers`, `branches`, `sellout`, `orders`, `contracts`, `offers`, `budgets`, and a single `meta/app` doc. One document per record; the app mirrors them into memory and keeps them live via realtime `onSnapshot`.

## 2. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "General Procurement Suite"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then: **Repo → Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save.**

Your app will be live at `https://<you>.github.io/<repo>/`. The root `index.html` redirects into `unified/`, and the iframes reach the two locked tools via relative `../` paths — all same-origin, which is what lets the Data Bridge read their live state.

## 3. Data Bridge

- **Order Generator → Sellout:** open that tab, upload stock + sellout files, then **Data Bridge → Bridge Order Generator**. It calls the tool's own `aggregateSellout()` and writes per-branch/SKU sellout to Firestore.
- **PRO-TRACK → Orders:** open that tab, seed/commit POs, then **Data Bridge → Bridge PRO-TRACK**. Purchase orders + received values flow into the `orders` collection so forecasting runs on live history.

Bridged rows use deterministic IDs, so re-running updates in place instead of duplicating.
