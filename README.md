# General Procurement Suite

A unified, cloud-backed procurement web app for the Egyptian market. It merges two pre-existing tools **without modifying them** (they run untouched inside isolated iframes) and adds six new modules on top of a Firebase Firestore database.

## Structure

```
/                                     ← GitHub Pages site root
├── index.html                        ← redirects to unified/index.html
├── .nojekyll                         ← disable Jekyll (serve files as-is)
├── order-generator-first update claude.html   ← LOCKED tool (untouched)
├── procurement supplier warehouse.html         ← LOCKED tool (untouched)
└── unified/
    ├── index.html                    ← app shell (hosts the tools + new modules)
    ├── css/
    │   └── theme.css                 ← premium design system (light + dark)
    └── js/
        ├── firebase-config.js        ← ⚠ paste your Firebase config here
        ├── auth.js                   ← Firebase Google sign-in gate
        ├── store.js                  ← Firestore data layer (+ localStorage fallback)
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

With auth enabled, use auth-based Firestore rules (`allow read, write: if request.auth != null;`) so only signed-in users reach the data.

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
