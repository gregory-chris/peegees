# Project: PostgreSQL Course — Static Website

## 0) Goals & Non‑Goals

**Goals**

* Deliver a fast, responsive, high‑quality static site that *feels* like a premium course/blog.
* Home page lists 10 lessons (title + short description), each linking to a dedicated lesson page.
* Each lesson page loads and renders an `.md` file (stored with the site) using `fetch()` at runtime.
* Rich Markdown rendering (headings, code blocks with syntax highlighting, tables, images, admonitions).
* First‑class SEO + Open Graph/Twitter previews for *every* page (pre‑rendered at build time so social bots see the correct tags).
* Clean, elegant UI; excellent accessibility; great performance (Lighthouse ≥ 95 across the board on desktop).

**Non‑Goals**

* No server‑side business logic beyond static hosting (no DB, no auth, no comments).
* No authoring UI/CMS (content edited as Markdown in the repo).

---

## 1) Tech Stack (concrete choices)

**Language & Framework**

* **React 18** + **TypeScript** (strict mode on).
* **Vite 5** for dev/build.

**Styling & UI**

* **Tailwind CSS 3.x** with **@tailwindcss/typography** for Markdown prose.
* **Heroicons** (outline/solid sets) for UI icons.
* **Google Fonts**: `Inter` (UI) and `JetBrains Mono` (code).

**Routing & Head Management**

* **react-router-dom 6** for client routing.
* **react-helmet-async** for dynamic `<head>` management in the SPA runtime **and** during SSG.

**Markdown & Syntax Highlighting**

* **react-markdown** + **remark-gfm** (tables/strikethrough/lists), **rehype-slug** (IDs on headings), **rehype-autolink-headings** (anchor links), **rehype-pretty-code** (Shiki‑based code highlighting).

**Static Site Generation & SEO**

* **vite-plugin-ssg** to pre‑render the home page and all 10 lesson routes to static HTML so Open Graph/Twitter bots read correct meta tags.
* **vite-plugin-sitemap** to emit `/sitemap.xml`.
* Hand‑rolled `robots.txt`.

**PWA / Performance (optional but recommended)**

* **vite-plugin-pwa** for offline caching of shell + MD files, with a lightweight service worker.

**Quality Tooling**

* **ESLint** (typescript-eslint) and **Prettier**.
* **Husky** + **lint-staged** for pre‑commit checks.

**Analytics & Telemetry**

* **Plausible** or **Google Analytics** (pluggable via env var).

**Hosting**

* Any static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages). Needs SPA redirects **and** static HTML file serving from SSG (no server code required).

---

## 2) Content Model & File Layout

```
repo/
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ routes/
│  │  ├─ Home.tsx
│  │  ├─ Lesson.tsx
│  │  └─ NotFound.tsx
│  ├─ components/
│  │  ├─ Layout/
│  │  │  ├─ SiteHeader.tsx
│  │  │  ├─ SiteFooter.tsx
│  │  │  └─ Container.tsx
│  │  ├─ LessonCard.tsx
│  │  ├─ MarkdownRenderer.tsx
│  │  ├─ TOC.tsx
│  │  └─ ShareButtons.tsx
│  ├─ lib/
│  │  ├─ content.ts (fetch helpers, cache, error mapping)
│  │  ├─ seo.ts (helpers for meta tags/OG)
│  │  └─ analytics.ts
│  ├─ styles/
│  │  └─ globals.css
│  └─ types/
│     └─ content.d.ts
├─ public/
│  ├─ content/
│  │  ├─ lessons/
│  │  │  ├─ 01-intro.md
│  │  │  ├─ 02-install-and-setup.md
│  │  │  ├─ ... (up to 10 files)
│  │  └─ media/ (images used in lessons)
│  ├─ og/
│  │  ├─ default.png
│  │  └─ lesson-*.png (optional, pre-generated)
│  ├─ favicon.ico
│  ├─ robots.txt
│  ├─ manifest.webmanifest
│  └─ apple-touch-icon.png
├─ content-manifest.json (build input; see schema below)
├─ tailwind.config.cjs
├─ postcss.config.cjs
├─ vite.config.ts
├─ ssg.config.ts (routes for vite-plugin-ssg)
├─ package.json
└─ README.md
```

**Markdown placement**

* Place all lesson `.md` files under `public/content/lessons/`. They are fetched at runtime via `/content/lessons/{slug}.md` and can be cached by the service worker.

**Images & media**

* Referenced from Markdown using relative URLs to `/content/media/...`.

---

## 3) Content Manifest (single source of truth)

A JSON file that drives the homepage list, routing, and SSG.

**File**: `content-manifest.json`

```json
{
  "course": {
    "title": "PostgreSQL Course",
    "tagline": "Hands-on, deep dives for engineers who already ship.",
    "description": "A 10-lesson, practical course covering Postgres internals, performance, and production patterns.",
    "coverImage": "/og/default.png"
  },
  "lessons": [
    {
      "order": 1,
      "slug": "intro",
      "title": "Introduction & Course Logistics",
      "description": "What you’ll learn, environment setup, and how to get the most out of this course.",
      "mdPath": "/content/lessons/01-intro.md",
      "ogImage": "/og/lesson-01.png",
      "estReadMinutes": 7,
      "tags": ["overview", "setup"]
    }
    // ... 9 more lessons
  ]
}
```

That file is already defined - [content manifest JSON](./content-manifest.json)

**Rules**

* `slug` is the route: `/lesson/:slug`.
* `order` controls homepage listing.
* `mdPath` must reside under `/public/content/lessons/`.
* Optional `ogImage` overrides default OG.

---

## 4) Routing Spec

* `/` → **Home** (lists lessons with `title`, `description`, `order`).
* `/lesson/:slug` → **Lesson** (fetch & render Markdown, generate TOC from headings `h2+`).
* Unknown paths → **NotFound**.
* Do not reload the page upon routing or pages changes.

**Linking behavior**

* Client‑side navigation using `<Link>`.
* Preserve scroll on same‑page anchor links; on route change, scroll to top and focus main heading for accessibility.

---

## 5) Markdown Rendering Rules

* Use `react-markdown` with plugins: `remark-gfm`, `rehype-slug`, `rehype-autolink-headings`.
* Code blocks highlighted via `rehype-pretty-code` (Shiki). Languages auto‑detected; fenced code with explicit language preferred (e.g., \`sql, \`bash, \`js, \`ts).
* Allow images, tables, block quotes, task lists.
* **Security**: Do **not** allow raw HTML by default (no `rehype-raw`).
* Map Markdown elements to Tailwind‑styled components within `MarkdownRenderer` (e.g., `prose prose-invert` for dark mode, or `prose` for light).
* Generate a Table of Contents client‑side by scanning headings provided by `react-markdown` AST (or by a custom pass) and render in a sticky sidebar on large screens and a dropdown on mobile.

---

## 6) SEO & Social Metadata

**Global defaults** (in `index.html`):

* `<meta name="description">` from `course.description`.
* Open Graph: `og:type=website`, `og:title`, `og:description`, `og:image`, `og:url`.
* Twitter Card: `summary_large_image`.
* Canonical `<link>`.

**Per‑route tags**

* Use `react-helmet-async` + **vite-plugin-ssg** to pre‑render each page’s `<head>` tags at build time using data from `content-manifest.json`.
* For `/lesson/:slug`, title format: `"{lesson.title} – PostgreSQL Course"`. Description pulled from manifest. OG image: `lesson.ogImage || course.coverImage`.

**Sitemap & robots**

* `vite-plugin-sitemap` configured with site URL (env var `VITE_SITE_URL`).
* `robots.txt` allows crawl; includes link to sitemap.

**OG Image Strategy**

* EITHER: Provide static PNGs in `/public/og/lesson-*.png`.
* OR: Add a Node script to pre‑generate from a template (Satori/ResVG) at build time to `/public/og`.

---

## 7) Accessibility (a11y)

* Color contrast ≥ WCAG AA.
* All interactive elements keyboard accessible; focus states visible.
* Skip‑to‑content link.
* Landmarks: `<header> <main> <nav> <footer>`.
* Semantic headings (one `h1` per page).
* Images in Markdown require alt text; linter check in CI to fail PRs if missing.

---

## 8) UI/UX Spec

**Look & Feel**

* Minimal, content‑first aesthetic; generous whitespace; readable line‑length.

**Home**

* Hero section with course title, tagline, CTA (scroll to lessons).
* Lessons list as responsive grid (cards). Each card shows: order index, title, description, estimated read time, and a chevron icon.
* Optional filters by tags (client‑side), and a small search box that filters by title/description.

**Lesson Page**

* Sticky header with lesson title, previous/next lesson nav.
* Two‑column on ≥ `lg`: main content + sticky TOC (generated from Markdown `h2`/`h3`).
* Code blocks: copy‑to‑clipboard button.
* Share buttons (copy link, Twitter, LinkedIn). Open in new tabs; `rel="noopener noreferrer"`.
* End‑of‑page next steps: previous/next links, back to home.

**Empty/Error States**

* If `fetch(mdPath)` fails (404, network): show friendly error with retry and link back home.

---

## 9) State, Data Fetching, and Caching

* On app init, fetch `content-manifest.json` once and keep in memory (React context) + `sessionStorage` for quick reloads.
* Lesson route loads `mdPath` using `fetch()`; cache responses via service worker (if PWA enabled). Also keep last‑rendered MD in memory so back/forward navigation is instant.
* Use AbortController to cancel in‑flight fetches on nav.

---

## 10) Service Worker (optional)

* Precache app shell, manifest JSON, and all `mdPath`s detected from `content-manifest.json` at install time.
* Runtime caching strategy: `StaleWhileRevalidate` for MD and images.
* Provide an “Offline” banner when network unavailable but cached content exists.

---

## 11) Components (contracts)

**`<Layout>`**

* Props: `{ children }`.
* Renders `<SiteHeader/>`, `<main>`, `<SiteFooter/>`.

**`<SiteHeader>`**

* Left: logo/title link to `/`.
* Right: theme toggle, (optional) search input.

**`<LessonCard>`**

* Props: `{ index: number, title: string, description: string, slug: string, estReadMinutes?: number, tags?: string[] }`.
* Click → navigate to `/lesson/:slug`.

**`<MarkdownRenderer>`**

* Props: `{ markdown: string }`.
* Internally configures `react-markdown` + plugins; wraps with `prose` classes; renders code block copy buttons.

**`<TOC>`**

* Props: `{ headings: Array<{ id: string; depth: 2|3; text: string }> }`.
* Highlights active section via IntersectionObserver.

**`<ShareButtons>`**

* Props: `{ title: string, url: string }`.

---

## 12) Theming & Tailwind

* Tailwind set up with CSS variables for colors (light/dark). Example palette: slate/indigo/emerald (adjustable).
* Typography plugin configured to style headings, code, tables nicely.
* Global CSS in `globals.css` only for resets and CSS variables; everything else via utility classes.

---

## 13) Build & SSG

**SSG route discovery**

* In `ssg.config.ts`, read `content-manifest.json` at build time and export routes: `/` + `/lesson/${slug}` for all lessons.

**Head tags during SSG**

* Each route renders with `Helmet` tags populated from manifest so the emitted HTML already contains OG/Twitter meta.

**Outputs**

* `/dist/` contains static HTML for all routes, JS/CSS assets, MD, images, sitemap, robots.

---

## 14) Commands & Scripts

* `dev`: `vite` (starts dev server).
* `build`: `tsc -b && vite build`.
* `preview`: `vite preview`.
* `lint`: `eslint . --ext .ts,.tsx`.
* `format`: `prettier --write .`.
* `generate:og` (optional): node script to generate OG images for lessons using title + index.
* `typecheck`: `tsc -p tsconfig.json --noEmit`.

---

## 15) Environment Variables

* `VITE_SITE_URL` (e.g., `https://peegees.greq.me`) used by sitemap and canonical URLs.
* `VITE_ANALYTICS=plausible|ga4|none` and related IDs.

---

## 16) CI/CD

* Not defined in this step

---

## 17) Acceptance Criteria

* **Content**: 10 Markdown lessons live under `/public/content/lessons/` with working images.
* **Homepage**: displays exactly 10 lesson cards from `content-manifest.json` in `order`.
* **Lesson page**: fetches MD, renders with TOC, code highlighting, copy buttons.
* **SEO**: Link shared on Twitter/LinkedIn for *any* lesson shows correct title/description/OG image because the lesson HTML is pre‑rendered with those tags.
* **Performance**: Lighthouse scores ≥ 95 for Performance, Accessibility, Best Practices, SEO on desktop (≥ 90 on mobile).
* **A11y**: Keyboard‑only navigation works; axe‑core scan shows no serious violations.
* **Resilience**: If an MD file is missing, the UI shows a helpful error and the app remains usable; 404 route renders.

---

## 18) Nice‑to‑Have Extensions (future)

* Local full‑text search (Lunr/TinySearch) over rendered Markdown.

---

## 19) Implementation Notes (to guide AI/codegen)

* Prefer composition over context where possible; a small `ContentContext` is fine for manifest + theme.
* Keep Markdown renderer isolated; its props accept raw markdown only.
* Avoid dangerouslySetInnerHTML; do not enable `rehype-raw`.
* Test with one large lesson to ensure TOC/anchors and code highlighting perform well.
* Ship with a sample `content-manifest.json` and two sample lessons so the bootstrap experience works end‑to‑end.

---

## 20) Example `MarkdownRenderer` behaviors

* Headings `h2`/`h3` get anchor links via `rehype-autolink-headings`.
* Code fences render `<pre><code>` with language label and a copy button.
* Images get `loading="lazy"`.
* External links: `target="_blank"` + `rel="noopener noreferrer"`.

---

## 21) Security

* Content served same‑origin; CORS disabled.
* No HTML injection from Markdown; sanitize link URLs; disallow `javascript:` URLs.
* Service worker caches only course assets; no opaque third‑party caches.

---

## 22) Deliverables

* Source repository matching the structure above.
* Working static build in `/dist` ready for deploy.
* README with setup, authoring guidelines for Markdown, and how to add a new lesson via `content-manifest.json`.
