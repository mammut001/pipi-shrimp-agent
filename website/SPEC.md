# Pipi Shrimp Agent Website Specification

## 1. Project Overview

**Project Name:** Pipi Shrimp Agent Website
**Project Type:** Multi-language product landing page
**Core Functionality:** A showcase website for the Pipi Shrimp Agent AI assistant application, featuring multi-language support, feature highlights, and GitHub-powered changelog.
**Target Users:** Developers, AI enthusiasts, and potential users looking to learn about or download Pipi Shrimp Agent.

---

## 2. UI/UX Specification

### 2.1 Design Philosophy

**Style:** Notion + Vercel hybrid - clean, minimal, content-focused with subtle animations

**Core Principles:**
- Generous whitespace
- Clear typography hierarchy
- Subtle hover states and micro-interactions
- No clutter - every element has purpose

### 2.2 Color Palette

```css
--background: #FFFFFF;
--background-secondary: #F7F7F5;  /* Notion-style subtle gray */
--text-primary: #37352F;          /* Notion dark */
--text-secondary: #787774;       /* Muted text */
--accent: #FF4757;                /* Pipi Shrimp brand color (coral red) */
--accent-hover: #FF6B7A;
--border: #E9E9E7;
--code-background: #F1F1EF;
```

**Dark Mode Colors (optional future enhancement):**
```css
--background-dark: #191919;
--background-secondary-dark: #252525;
--text-primary-dark: #FFFFFF;
--text-secondary-dark: #A0A0A0;
```

### 2.3 Typography

**Font Family:**
- **Headings:** "Notion Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- **Body:** "Notion Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- **Code:** "JetBrains Mono", "Fira Code", monospace

**Font Sizes:**
```css
--font-hero: 4rem (64px)      /* Hero title */
--font-h1: 2.5rem (40px)      /* Page titles */
--font-h2: 1.75rem (28px)     /* Section titles */
--font-h3: 1.25rem (20px)     /* Subsection */
--font-body: 1rem (16px)      /* Body text */
--font-small: 0.875rem (14px) /* Caption, metadata */
--font-tiny: 0.75rem (12px)   /* Small labels */
```

**Font Weights:**
- Regular: 400
- Medium: 500
- Semibold: 600
- Bold: 700

### 2.4 Spacing System

```css
--space-xs: 0.25rem (4px)
--space-sm: 0.5rem (8px)
--space-md: 1rem (16px)
--space-lg: 1.5rem (24px)
--space-xl: 2rem (32px)
--space-2xl: 3rem (48px)
--space-3xl: 4rem (64px)
--space-4xl: 6rem (96px)
```

### 2.5 Layout Structure

**Max Content Width:** 1200px
**Responsive Breakpoints:**
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px

**Page Sections:**
1. **Navigation Bar** (sticky)
   - Logo (left)
   - Nav links (center)
   - Language selector + GitHub link (right)
   - Height: 64px
   - Blur backdrop on scroll

2. **Hero Section**
   - Centered layout
   - Large title with accent color highlight
   - Tagline/subtitle
   - CTA buttons (Download, GitHub)
   - Subtle floating animation on logo

3. **Features Section**
   - 2-3 column grid on desktop
   - Single column on mobile
   - Icon + title + description per feature
   - Subtle hover lift effect

4. **About Section**
   - Split layout (text + image/graphic)
   - Tech stack showcase
   - Progress/roadmap visual

5. **Changelog Section**
   - Auto-fetched from GitHub API
   - Timeline-style layout
   - Commit message, date, author avatar

6. **Download Section**
   - macOS Apple Silicon + Intel buttons
   - Version number display
   - System requirements

7. **Footer**
   - Copyright
   - GitHub link
   - Language switcher

### 2.6 Components

**Navigation:**
- Logo: Text "Pipi Shrimp" with shrimp emoji 🦐
- Links: Home, Features, About, Changelog
- States: Default, hover (underline), active (accent color)
- Mobile: Hamburger menu with slide-out drawer

**Language Selector:**
- Dropdown with flag icons
- Options: EN 🇫🇷, FR 🇫🇷, 中文 🇨🇳, 한국어 🇰🇷, Tiếng Việt 🇻🇳
- Note: EN and FR both show Canadian flag 🇨🇳 (user specified)
- Persists selection in localStorage

**Buttons:**
- Primary: Accent background, white text, rounded-md
- Secondary: Transparent, accent text, accent border
- States: Default, hover (darken 10%), active (scale 0.98), disabled (opacity 0.5)
- Transition: 150ms ease

**Feature Cards:**
- White background
- Subtle border
- Icon (emoji or SVG)
- Title + description
- Hover: translateY(-2px), shadow increase

**Changelog Entry:**
- Date (formatted per locale)
- Commit message
- Author avatar (circular)
- Click to view on GitHub

**Download Buttons:**
- macOS icon + "Download for macOS (Apple Silicon)" / "macOS (Intel)"
- Direct download link

---

## 3. Functionality Specification

### 3.1 Multi-language Support

**Supported Languages:**
| Code | Language | Flag |
|------|----------|------|
| en | English | 🇨🇦 |
| fr | French (Canadian) | 🇨🇦 |
| zh | Chinese (Simplified) | 🇨🇳 |
| ko | Korean | 🇰🇷 |
| vi | Vietnamese | 🇻🇳 |

**Implementation:**
- Use Next.js App Router i18n
- JSON files for translations: `locales/{lang}.json`
- Detect browser language on first visit
- Store preference in localStorage
- SSR for SEO

**Translatable Content:**
- All UI text (navigation, buttons, labels)
- Page content (hero, features, about)
- Dates and numbers formatting
- Meta tags (title, description)

### 3.2 GitHub Changelog Integration

**API Endpoint:** `https://api.github.com/repos/{owner}/{repo}/commits`

**Fetch Strategy:**
- Client-side fetch on page load
- Cache results in sessionStorage (5 min TTL)
- Display last 20 commits
- Show: commit message, date, author, SHA (short)

**Fallback:**
- If API fails, show static message "Changelog unavailable"
- Link to GitHub repo directly

### 3.3 Download Functionality

**Platforms:**
1. macOS Apple Silicon (arm64) - `.dmg` or `.app`
2. macOS Intel (x64) - `.dmg` or `.app`

**Implementation:**
- Direct links to GitHub Releases
- Version display from package.json or GitHub API

### 3.4 Routing Structure

```
/                   # Home (redirects to /{lang})
/[lang]             # Localized home
/[lang]/features    # Features page
/[lang]/about       # About page
/[lang]/changelog   # Changelog page
```

### 3.5 SEO Requirements

- Static metadata for each language
- Open Graph tags
- JSON-LD structured data
- Sitemap generation

---

## 4. Page Specifications

### 4.1 Home Page (`/[lang]`)

**Hero Section:**
- Title: "Pipi Shrimp Agent" (with 🦐 emoji)
- Subtitle: Brief description in current language
- CTA: "Download for macOS" + "View on GitHub"
- Background: Subtle gradient or pattern

**Quick Features Preview:**
- 3-4 key features with icons
- "Learn more" link to features page

### 4.2 Features Page (`/[lang]/features`)

**Feature Cards:**
1. ⚡ Lightweight - Fast startup, minimal memory
2. 🔧 Workflow System - Task automation
3. 🧠 Smart Context - Project-level conversation memory
4. 🔒 Secure - Rust-based security

### 4.3 About Page (`/[lang]/about`)

**Content:**
- Project description
- Tech stack: Tauri, React, TypeScript, Rust, Zustand
- Current progress/status
- Future plans

### 4.4 Changelog Page (`/[lang]/changelog`)

**Display:**
- Timeline of recent commits
- Auto-fetched from GitHub
- Pagination or "Load more"
- Link to full GitHub history

---

## 5. Technical Implementation

### 5.1 Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **i18n:** next-intl or custom implementation
- **Icons:** Lucide React
- **Animations:** Framer Motion (optional, minimal)

### 5.2 File Structure

```
website/
├── src/
│   ├── app/
│   │   ├── [lang]/
│   │   │   ├── page.tsx          # Home
│   │   │   ├── features/
│   │   │   │   └── page.tsx
│   │   │   ├── about/
│   │   │   │   └── page.tsx
│   │   │   └── changelog/
│   │   │       └── page.tsx
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── Navigation.tsx
│   │   ├── Footer.tsx
│   │   ├── LanguageSelector.tsx
│   │   ├── Hero.tsx
│   │   ├── FeatureCard.tsx
│   │   ├── Changelog.tsx
│   │   └── DownloadButton.tsx
│   ├── lib/
│   │   ├── i18n.ts
│   │   ├── github.ts
│   │   └── utils.ts
│   └── locales/
│       ├── en.json
│       ├── fr.json
│       ├── zh.json
│       ├── ko.json
│       └── vi.json
├── public/
├── tailwind.config.ts
└── next.config.ts
```

### 5.3 Environment Variables

```env
NEXT_PUBLIC_GITHUB_REPO=mammut001/pipi-shrimp-agent
NEXT_PUBLIC_APP_VERSION=0.1.0
```

---

## 6. Acceptance Criteria

### Visual Checkpoints
- [ ] Clean, minimal Notion-style aesthetic
- [ ] Responsive on mobile, tablet, desktop
- [ ] Smooth page transitions
- [ ] Language switcher works correctly
- [ ] Canadian flag shown for EN and FR
- [ ] All 5 languages have complete translations

### Functional Checkpoints
- [ ] Home page loads with hero section
- [ ] Features page shows all feature cards
- [ ] About page displays tech stack
- [ ] Changelog fetches from GitHub API
- [ ] Download buttons link to correct platforms
- [ ] GitHub link works
- [ ] Language persists across page navigation
- [ ] No console errors

### Performance
- [ ] First Contentful Paint < 1.5s
- [ ] Lighthouse score > 90
- [ ] No layout shift on load

---

## 7. Out of Scope (v1)

- Dark mode
- Blog/news section
- User documentation pages
- Mobile app stores (iOS/Android)
- Windows/Linux downloads
- Authentication/user accounts
- Search functionality
