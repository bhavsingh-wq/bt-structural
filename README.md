# Hollowcore Slab & Column Calculator

Internal structural engineering tool for PCI / CPCI non-composite hollowcore slab
design, RC column P–M interaction, and hollowcore end-crushing capacity.
Built with React + Vite. Runs as a static site — no backend required.

## What's inside

- `src/App.jsx` — the entire application (all four calculation modules, the
  structural diagrams, the login gate, and the print logic).
- `src/main.jsx` — mounts the app to the page.
- `index.html` — the HTML shell.
- `vite.config.js` — build configuration.

## Local development

Requires Node.js 18+ and npm.

```bash
npm install
npm run dev
```

This starts a local dev server (Vite will print the URL, typically
`http://localhost:5173`). Edit `src/App.jsx` and the browser updates live.

## Production build

```bash
npm run build
```

This outputs a fully static site into `dist/`. That folder is the entire
deployable artifact — `index.html` plus bundled, minified JS/CSS. No server-side
code, no database, no environment variables required for the current version.

To sanity-check the build locally before deploying:

```bash
npm run preview
```

## Deploying

Because this is a static build, it runs on **any** static host. A few options,
roughly in order of "least setup":

### Vercel
1. Push this folder to a GitHub/GitLab repo (or use the Vercel CLI directly on
   the folder).
2. Import the repo in Vercel, or run `npx vercel` from this directory.
3. Vercel auto-detects Vite. Build command: `npm run build`. Output directory:
   `dist`.
4. Attach a custom domain in the Vercel dashboard once deployed.

### Netlify
1. Drag-and-drop the `dist/` folder onto Netlify's deploy UI after running
   `npm run build` locally, **or** connect the repo and let Netlify run the
   build (Build command: `npm run build`, Publish directory: `dist`).
2. Attach a custom domain in the Netlify dashboard.

### Any other static host (S3 + CloudFront, GitHub Pages, internal IIS/Nginx, etc.)
Run `npm run build` and upload the contents of `dist/` to the host. There is
nothing else to configure — it's plain HTML/CSS/JS.

## Printing

The "Print This Tab" and "Print Full Report" buttons call the browser's native
`window.print()`. Print-specific CSS rules live inside `App.jsx` in a
`@media print` block, which:

- Hides the navigation tabs, sign-out button, and print buttons themselves.
- Forces a clean white background and preserves diagram colors
  (`print-color-adjust: exact`).
- Prevents calculation cards and structural diagrams from being split across a
  page break.
- "Print Full Report" temporarily renders all four modules (PCI, CPCI, Column,
  HC End Crushing) stacked with page breaks between them, then reverts to the
  single-tab view automatically once the print dialog closes.

This works reliably because, once deployed, the page runs as a normal
top-level browser tab — unlike a sandboxed preview, there are no iframe
permission restrictions blocking the print API.

## Employee access (current state)

Login is a **client-side password gate** — credentials live in a JavaScript
object (`EMPLOYEES`) near the top of `src/App.jsx`:

```js
const EMPLOYEES = {
  "admin":    { pass: "admin123",   name: "Administrator" },
  "bhavjeet": { pass: "bt2026",     name: "Bhavjeet Singh Hora" },
  "engineer": { pass: "design2026", name: "Engineer" },
};
```

**This is a visibility gate, not real security.** Anyone who opens browser
DevTools or views the page source can read these credentials directly out of
the shipped JavaScript bundle. It's adequate for keeping casual/unauthenticated
visitors out of an internal tool, but it should **not** be treated as
protecting sensitive or proprietary calculation data on its own.

To add real authentication later (recommended before this tool is used for
anything client-facing or containing confidential project data), reasonable
upgrade paths, roughly in order of effort:

1. **Host-level password protection** — Vercel and Netlify both offer
   built-in basic-auth / password-protect features on paid tiers, sitting in
   front of the entire deployed site. Zero code changes required.
2. **SSO via the hosting platform** — if your company already uses
   Google Workspace or Microsoft 365, both Vercel and Netlify support gating
   deployments behind that identity provider.
3. **A real backend** — a small serverless function (Vercel Functions,
   Netlify Functions, or a lightweight Node/Express service) backed by a
   proper user table with hashed passwords, issuing a session token/JWT after
   login. This is the right long-term answer if engineers need individual
   accounts, audit trails of who ran which calculation, or role-based access.

## Editing the calculation logic

Each calculation module is a self-contained function component in
`src/App.jsx`:

- `PCITab()` — PCI non-composite hollowcore design (transfer stresses, losses,
  service stresses, flexural strength by both ACI Method #1 and strain
  compatibility, shear, camber/deflection).
- `CPCITab()` — CPCI (metric, CSA A23.3) hollowcore design.
- `ColTab()` — rectangular RC column design and P–M interaction diagram.
- `CrushTab()` — hollowcore core/end crushing capacity.

Section property data (slab dimensions, section moduli, etc.) lives in the
`PCI_SLABS`, `CPCI_SLABS`, `HC_CRUSH`, and `REBAR` constants at the top of the
file. Every input field tagged with the orange "editable" styling
(`<OI .../>` component) is a value an engineer can override; everything else
(`<CI .../>` component) is computed and read-only. Formula reference tags next
to each equation cite the governing code clause (ACI 318-19, CSA A23.3-19, PCI
Design Handbook 8th Ed., or CPCI Design Manual 5th Ed.) so reviewers can trace
every number back to its source.
