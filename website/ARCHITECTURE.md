# Website Architecture

> Last reviewed: 2026-06-16. This document describes the website as it
> actually exists in `website/`, not the original `SPEC.md` plan.
> Use it as the source of truth for the current layout, data flow,
> and conventions. See `SPEC.md` for the product-level requirements
> and design tokens.

## 1. Purpose & Scope

The `website/` directory is a **standalone Next.js 16 (App Router)**
landing page for the Pipi Shrimp Agent desktop app. It is a static,
read-only site that:

- Presents the product (hero, features, about, changelog).
- Links to the GitHub repository and the release page for downloads.
- Is fully localizable in **5 languages** (en, fr, zh, ko, vi) via a
  hand-rolled in-app i18n context (no `next-intl` despite what `SPEC.md`
  suggests).

It does **not** host the desktop app, any backend, telemetry, or auth.
There is no SSR data layer beyond the GitHub REST call from the
changelog page.

## 2. Tech Stack

| Layer            | Choice                                                    |
|------------------|-----------------------------------------------------------|
| Framework        | Next.js `16.1.6` (App Router)                             |
| UI library       | React `19.2.3`                                            |
| Language         | TypeScript (`strict: true`)                               |
| Styling          | Tailwind CSS v4 (`@tailwindcss/postcss`), inline `style=` |
| Fonts            | Google Fonts via `<link rel="preconnect">` (Notion Sans)  |
| i18n             | Custom React context (in-memory + `localStorage`)        |
| External data    | GitHub REST `/repos/{owner}/{repo}/commits`               |
| Lint             | `eslint` + `eslint-config-next` (core-web-vitals + ts)    |
| Build target     | `next build` → static / SSR hybrid                        |
| Package manager  | npm (lockfile: `package-lock.json`); pnpm works too       |

Node version is not pinned in `package.json`. The CI image used `node:20`.

## 3. Top-Level Layout

```
website/
├── ARCHITECTURE.md          ← this file
├── README.md                ← default create-next-app stub
├── SPEC.md                  ← product/design spec (planned, not authoritative)
├── package.json
├── package-lock.json
├── next.config.ts           ← image domains, compression
├── postcss.config.mjs       ← Tailwind v4 plugin
├── eslint.config.mjs        ← Next core-web-vitals + TS
├── tsconfig.json            ← strict, @/* → src/* paths
├── .gitignore
├── public/                  ← static assets (avatars, svgs)
│   ├── shrimp-avatar-256.png
│   ├── shrimp-avatar-128.webp
│   ├── shrimp-avatar.webp
│   ├── file.svg
│   ├── vercel.svg
│   └── window.svg
├── .vscode/
│   └── tasks.json           ← ci-website-{install,lint,build}
└── src/
    ├── app/                 ← App Router pages & layout
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── globals.css
    │   ├── about/page.tsx
    │   ├── features/page.tsx
    │   └── changelog/page.tsx
    ├── components/
    │   ├── index.ts
    │   ├── Header.tsx
    │   ├── Footer.tsx
    │   └── LanguageSwitcher.tsx
    ├── contexts/
    │   └── LanguageContext.tsx
    └── translations/
        └── index.ts         ← TranslationKeys type + 5-language map
```

> Note: `SPEC.md §5.2` describes an i18n-router structure
> (`/`, `/[lang]`, `/[lang]/features`, …) with JSON locale files.
> The implementation went a different way: **single-locale-agnostic
> routes** (`/`, `/about`, `/features`, `/changelog`) and a client
> context that swaps copy on the fly. `SPEC.md` is out of date here.

## 4. Routing Model

The site is **not locale-prefixed**. All pages live at the App
Router's default paths:

| URL          | File                                | Role                                  |
|--------------|-------------------------------------|---------------------------------------|
| `/`          | `src/app/page.tsx`                  | Home: hero + feature cards + CTA      |
| `/about`     | `src/app/about/page.tsx`            | About: description, 3 key features, thanks, tech stack |
| `/features`  | `src/app/features/page.tsx`         | 11-card feature grid + CTA            |
| `/changelog` | `src/app/changelog/page.tsx`        | Timeline of recent GitHub commits     |

`layout.tsx` (root) wraps every page with `LanguageProvider`,
`Header`, `<main>`, `Footer`. `app/page.tsx`, `about`, `features`,
`changelog` are all marked `"use client"` because they read from
`useLanguage()` and most pages are also heavily styled with inline
`style={{ ... }}` (see §6).

There is **no `loading.tsx`, `error.tsx`, `not-found.tsx`**, and no
route-segment metadata beyond the root `metadata` export.

## 5. Data Flow

### 5.1 Language

```
localStorage["language"]   ←────  LanguageContext initial state
                                  (defaults to "en" if absent)
                                       │
                                       ▼
                            React useState<Language>
                                       │
                       useLanguage() ──┴── t, language, setLanguage
                                       │
            ┌──────────┬───────────────┼─────────────────┐
            ▼          ▼               ▼                 ▼
         Header   page.tsx      LanguageSwitcher    Footer
```

- `LanguageProvider` (`src/contexts/LanguageContext.tsx`) keeps a
  single `useState<Language>` and exposes
  `{ language, setLanguage, t }`.
- `setLanguage` writes `localStorage["language"]` and sets
  `document.documentElement.lang`. It does **not** read localStorage
  on mount — the initial value is hard-coded to `"en"`. This is a
  known bug (see §9 / known issues).
- `t` is just `translations[language]`, so the entire translated
  payload ships in the initial JS bundle. There is no locale file
  fetching or splitting.
- `translations/index.ts` is a single 600+ line file with
  `TranslationKeys` (the source of truth for keys) and the
  `Record<Language, TranslationKeys>` payload for `en`, `fr`, `zh`,
  `ko`, `vi`.

### 5.2 Changelog

`src/app/changelog/page.tsx` calls
`https://api.github.com/repos/mammut001/pipi-shrimp-agent/commits?per_page=20`
in a `useEffect`. The site has **no GitHub token, no caching layer,
and no rate-limit handling**. Failures are surfaced as the
`changelog.error` translation key.

The image domain `avatars.githubusercontent.com` is the only entry
in `next.config.ts → images.remotePatterns`.

## 6. Styling System

The site uses **two parallel styling mechanisms**:

1. **Tailwind CSS v4** (loaded via `@import "tailwindcss"` in
   `globals.css` and `@tailwindcss/postcss` in `postcss.config.mjs`).
   It is used in the `about`, `features`, `changelog`, and `Footer`
   pages for layout (`grid`, `flex`, `gap-8`, `md:grid-cols-3`,
   `max-w-[1200px]`, etc.).
2. **Inline `style={{ ... }}` everywhere else**, especially in
   `Header`, `LanguageSwitcher`, and the home page. This includes a
   large amount of custom layout, animations, and hover effects.

The design tokens from `SPEC.md §2.2` are exposed as CSS variables
in `:root` and re-declared in Tailwind's `@theme inline` block so
both mechanisms see them:

```css
:root {
  --background: #ffffff;
  --background-secondary: #f7f7f5;
  --text-primary: #37352f;
  --text-secondary: #787774;
  --accent: #ff4757;
  --accent-hover: #ff6b7a;
  --border: #e9e9e7;
  --code-background: #f1f1ef;
}
```

Custom utility classes in `globals.css`:

- `.container` — 1200px max width, centered.
- `.page-enter` — fade-in animation for page transitions.
- `.section-padding`, `.hero-padding`, `.main-content-padding`,
  `.bg-secondary`, `.stack-reset` — layout helpers used by pages.

Conventions:

- **Hex / inline-style for visual polish** (hover, focus, blur,
  transitions): kept in `style={...}` near the JSX.
- **Tailwind for layout and responsive breakpoints** (grid, flex,
  `md:` / `lg:`).

This is intentional but messy. Keep the two worlds in sync when
adding pages, and prefer the existing convention of the file you
are editing.

## 7. Build & Tooling

### 7.1 `package.json` scripts

```json
"dev":   "next dev"
"build": "next build"
"start": "next start"
"lint":  "eslint"
```

There are no tests in this directory.

### 7.2 `next.config.ts`

- `images.formats: ['image/avif', 'image/webp']`
- `images.remotePatterns` allows `avatars.githubusercontent.com`
  (changelog avatars).
- `compress: true`.
- `productionBrowserSourceMaps: false` (smaller bundles, no
  shipping of source maps).

### 7.3 VS Code tasks

`.vscode/tasks.json` exposes three tasks used by the removed GitHub
Actions workflow (`ci-website-install`, `ci-website-lint`,
`ci-website-build`). They are still valid; run them via
`Tasks: Run Task`.

### 7.4 Lint

`npm run lint` uses the flat config in `eslint.config.mjs`:
`eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`.
Default Next ignores (`.next`, `out`, `build`, `next-env.d.ts`)
are preserved.

## 8. Conventions

- All page and component files are `"use client"` even when they
  don't strictly need to be, because they consume `useLanguage()`.
  Keep this pattern; do not introduce server components for pages
  unless the i18n story is reworked.
- `src/components/index.ts` is the barrel for shared components
  (`Header`, `Footer`, `LanguageSwitcher`). Add new shared
  components there.
- Translations: when adding a key, update `TranslationKeys` in
  `translations/index.ts` first — TypeScript will flag any missing
  locale entry. All five languages must be filled in.
- Hard-coded external URLs: `Header.tsx`, `Footer.tsx`,
  `app/page.tsx`, and `changelog/page.tsx` all reference
  `mammut001/pipi-shrimp-agent` and
  `https://github.com/.../releases`. There is no central
  `lib/constants.ts` yet — consider extracting one if the URL
  surface grows.
- Use `<picture>` + `<Image>` for shrimp avatars (`.webp` first,
  `.png` fallback). The home page also uses WebP for the 128px
  variant in the CTA section.

## 9. Known Issues / Follow-ups

- **`LanguageProvider` ignores `localStorage` on init.** A returning
  user with `localStorage["language"] = "zh"` still sees English on
  first paint. The state is only persisted, never restored.
  Fix: hydrate from `localStorage` in a `useEffect` (or use
  `next-themes`-style SSR-safe hydration).
- **Hard-coded `0.1.0` version** on the home page
  (`app/page.tsx:100`). Should come from a constant or env var.
- **No `lib/` directory.** GitHub URL, repo, version, and any
  feature flags are inlined. Worth introducing
  `src/lib/siteConfig.ts`.
- **Changelog page has no caching.** Every visit hits GitHub's
  unauthenticated rate limit (60/h). Add `sessionStorage` cache or
  Next's `revalidate` if traffic grows.
- **Styling split between Tailwind and inline `style=`.** Picking
  one would shrink the bundle and improve diff readability. Not
  urgent; the SPEC tokens already work in both worlds.
- **`SPEC.md` is stale** regarding i18n routing and file layout.
  Treat `ARCHITECTURE.md` as authoritative for what the code does
  today; treat `SPEC.md` as the design intent to converge on.
- **No tests, no CI, no deploy config.** Deploy is done manually to
  Vercel per the default `README.md`.

## 10. Related Docs

- `website/SPEC.md` — product requirements, design tokens, i18n
  intent, page-by-page copy plans.
- `website/README.md` — boilerplate `create-next-app` notes.
- `../AGENTS.md` — workspace rules for AI agents.
