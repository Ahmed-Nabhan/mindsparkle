# MindSparkle Web

You now have **two web deliverables**:

1) **Marketing site (static HTML):** served from `docs/`
2) **Web version of the app (Expo Web):** exported to `docs/app/`

## Run locally (web app)

```bash
npm install
npm run web
```

This starts Expo and opens the app in your browser.

## Export a static web build (for hosting)

### Export to `dist/`

```bash
npm run export:web
```

Expo will generate a static build in `dist/`.

### Export into `docs/app/` (recommended for GitHub Pages via `/docs`)

```bash
npm run export:web:docs
```

This writes the web build to `docs/app/`, so it can be hosted alongside the marketing site.

After exporting:
- Marketing landing page: `docs/index.html`
- Web app entry: `docs/app/index.html`

## Hosting options

### GitHub Pages (simple)

- Configure GitHub Pages to serve from the repository’s `/docs` folder.
- Re-export whenever you change the app: `npm run export:web:docs`.

### Netlify / Vercel

- Build command: `npm run export:web`
- Publish directory: `dist`

If you host the marketing site separately, you can still link to the web app URL from `docs/index.html` (the “Try the Web App” button).
