/**
 * Minimal static-site builder.
 *
 * Reads every article folder under content/, turns its index.md into a
 * standalone HTML page (images copied alongside), and emits an index.html
 * landing page with one preview card (cover + title) per article.
 *
 * Run with: bun run build.ts  ->  output in dist/
 */
import { readdirSync, statSync, mkdirSync, rmSync, copyFileSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const CONTENT_DIR = "content";
const OUT_DIR = "dist";
const SITE_TITLE = "Ivan Popkov — Articles";
// Absolute base URL of the published site (no trailing slash). Used for
// canonical links, Open Graph image URLs, and the sitemap.
const SITE_URL = "https://ivan-popkov.github.io/blog-articles";

marked.setOptions({ gfm: true, breaks: false });

type Article = {
  slug: string;
  title: string;
  cover: string | null; // filename relative to the article folder
  date: string | null; // ISO date or null when unknown
  description: string | null;
  bodyHtml: string;
};

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

/**
 * Shift markdown heading levels so the shallowest heading in the body becomes
 * an <h2> (the page <h1> is the article title rendered by the template).
 * The two articles disagree — one starts sections at `#`, the other at `##` —
 * so this gives both a consistent hierarchy. Lines inside fenced code blocks
 * are left untouched.
 */
function normalizeHeadings(md: string): string {
  const lines = md.split("\n");
  let fenced = false;
  let min = Infinity;
  for (const line of lines) {
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = line.match(/^(#{1,6})\s/);
    if (m) min = Math.min(min, m[1].length);
  }
  if (!isFinite(min)) return md;
  const offset = 2 - min;
  if (offset === 0) return md;
  fenced = false;
  return lines
    .map((line) => {
      if (/^```/.test(line)) { fenced = !fenced; return line; }
      if (fenced) return line;
      const m = line.match(/^(#{1,6})(\s.*)$/);
      if (!m) return line;
      const level = Math.max(1, Math.min(6, m[1].length + offset));
      return "#".repeat(level) + m[2];
    })
    .join("\n");
}

/** First image referenced in markdown body, normalised to a bare filename. */
function firstImage(md: string): string | null {
  const m = md.match(/!\[[^\]]*\]\(([^)\s]+)/);
  return m ? basename(m[1]) : null;
}

/** First non-empty paragraph of plain text, for the preview blurb. */
function firstParagraph(md: string): string | null {
  for (const block of md.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || t.startsWith("#") || t.startsWith("![") || t.startsWith("|")) continue;
    // strip markdown links/emphasis for a clean blurb
    const plain = t
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain) return plain.length > 200 ? plain.slice(0, 197) + "…" : plain;
  }
  return null;
}

function parseArticle(slug: string): Article {
  const dir = join(CONTENT_DIR, slug);
  const text = readFileSync(join(dir, "index.md"), "utf8");
  const { data, content } = matter(text);

  let title: string = data.title;
  let body = content;

  // No frontmatter title -> use the first H1 and strip it from the body.
  if (!title) {
    const h1 = body.match(/^#\s+(.+)$/m);
    title = h1 ? h1[1].trim() : slug;
    if (h1) body = body.replace(h1[0], "");
  }

  // Cover: frontmatter thumbnail, else the first image in the body
  // (which we then strip so it isn't duplicated under the title).
  let cover: string | null = data.thumbnail ? basename(data.thumbnail) : null;
  if (!cover) {
    cover = firstImage(body);
    if (cover) {
      body = body.replace(/!\[[^\]]*\]\([^)]*\)\s*/, ""); // drop first image
    }
  }

  const date: string | null = data.date
    ? new Date(data.date).toISOString().slice(0, 10)
    : null;
  const description: string | null =
    data.seo_description?.trim() || data.thumbnail_alt?.trim() || firstParagraph(body);

  const bodyHtml = marked.parse(normalizeHeadings(body)) as string;
  return { slug, title, cover, date, description, bodyHtml };
}

// --- tiny helpers -----------------------------------------------------------
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function page(opts: {
  title: string;
  description: string | null;
  cssHref: string;
  body: string;
  canonical: string; // absolute URL of this page
  ogType: "website" | "article";
  image?: string | null; // absolute URL of the social-preview image
  publishedTime?: string | null; // ISO date for articles
}): string {
  const head: string[] = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(opts.title)}</title>`,
  ];
  if (opts.description) head.push(`<meta name="description" content="${esc(opts.description)}">`);
  head.push(`<link rel="canonical" href="${esc(opts.canonical)}">`);

  // Open Graph (Facebook, LinkedIn, Slack, iMessage, …)
  head.push(
    `<meta property="og:type" content="${opts.ogType}">`,
    `<meta property="og:title" content="${esc(opts.title)}">`,
    `<meta property="og:url" content="${esc(opts.canonical)}">`,
    `<meta property="og:site_name" content="${esc(SITE_TITLE)}">`,
  );
  if (opts.description) head.push(`<meta property="og:description" content="${esc(opts.description)}">`);
  if (opts.image) head.push(`<meta property="og:image" content="${esc(opts.image)}">`);
  if (opts.publishedTime) head.push(`<meta property="article:published_time" content="${esc(opts.publishedTime)}">`);

  // Twitter / X card
  head.push(`<meta name="twitter:card" content="${opts.image ? "summary_large_image" : "summary"}">`);
  head.push(`<meta name="twitter:title" content="${esc(opts.title)}">`);
  if (opts.description) head.push(`<meta name="twitter:description" content="${esc(opts.description)}">`);
  if (opts.image) head.push(`<meta name="twitter:image" content="${esc(opts.image)}">`);

  head.push(`<link rel="stylesheet" href="${opts.cssHref}">`);

  return `<!doctype html>
<html lang="en">
<head>
${head.join("\n")}
</head>
<body>
${opts.body}
</body>
</html>
`;
}

// --- build ------------------------------------------------------------------
function copyAssets(slug: string) {
  const srcDir = join(CONTENT_DIR, slug);
  const dstDir = join(OUT_DIR, slug);
  mkdirSync(dstDir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (IMAGE_RE.test(f)) copyFileSync(join(srcDir, f), join(dstDir, f));
  }
}

function renderArticle(a: Article): string {
  const meta = a.date ? `<p class="meta">${fmtDate(a.date)}</p>` : "";
  const cover = a.cover
    ? `<img class="hero" src="${a.cover}" alt="${esc(a.title)}">`
    : "";
  const body = `<a class="back" href="../index.html">← All articles</a>
<article>
<h1>${esc(a.title)}</h1>
${meta}
${cover}
${a.bodyHtml}
</article>
<footer><a class="back" href="../index.html">← All articles</a></footer>`;
  return page({
    title: a.title,
    description: a.description,
    cssHref: "../style.css",
    body,
    canonical: `${SITE_URL}/${a.slug}/`,
    ogType: "article",
    image: a.cover ? `${SITE_URL}/${a.slug}/${a.cover}` : null,
    publishedTime: a.date,
  });
}

function renderIndex(articles: Article[]): string {
  const cards = articles
    .map((a) => {
      const cover = a.cover
        ? `<img src="${a.slug}/${a.cover}" alt="${esc(a.title)}" loading="lazy">`
        : `<div class="noimg"></div>`;
      const meta = a.date ? `<span class="meta">${fmtDate(a.date)}</span>` : "";
      const blurb = a.description ? `<p>${esc(a.description)}</p>` : "";
      return `<a class="card" href="${a.slug}/index.html">
  <div class="thumb">${cover}</div>
  <div class="card-body">
    <h2>${esc(a.title)}</h2>
    ${meta}
    ${blurb}
  </div>
</a>`;
    })
    .join("\n");

  const body = `<header class="site-head">
  <h1>Articles by Ivan Popkov</h1>
  <p class="tagline">A small archive of things I've written.</p>
</header>
<main class="grid">
${cards}
</main>`;
  // Use the newest article's cover as the homepage social-preview image.
  const featured = articles.find((a) => a.cover);
  const image = featured ? `${SITE_URL}/${featured.slug}/${featured.cover}` : null;
  return page({
    title: SITE_TITLE,
    description: "Articles written by Ivan Popkov.",
    cssHref: "style.css",
    body,
    canonical: `${SITE_URL}/`,
    ogType: "website",
    image,
  });
}

function renderSitemap(articles: Article[]): string {
  const urls = [
    `  <url><loc>${SITE_URL}/</loc></url>`,
    ...articles.map((a) => {
      const lastmod = a.date ? `<lastmod>${a.date}</lastmod>` : "";
      return `  <url><loc>${SITE_URL}/${a.slug}/</loc>${lastmod}</url>`;
    }),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

// run
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const slugs = readdirSync(CONTENT_DIR).filter((s) =>
  statSync(join(CONTENT_DIR, s)).isDirectory()
);

const articles: Article[] = [];
for (const slug of slugs) {
  const a = parseArticle(slug);
  copyAssets(slug);
  await Bun.write(join(OUT_DIR, slug, "index.html"), renderArticle(a));
  articles.push(a);
  console.log(`built ${slug}  (cover: ${a.cover ?? "none"}, date: ${a.date ?? "none"})`);
}

// newest first; undated articles sort last
articles.sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));

await Bun.write(join(OUT_DIR, "index.html"), renderIndex(articles));
copyFileSync("style.css", join(OUT_DIR, "style.css"));

// Sitemap + robots.txt for search engines.
await Bun.write(join(OUT_DIR, "sitemap.xml"), renderSitemap(articles));
await Bun.write(
  join(OUT_DIR, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`,
);

// Passthrough verification files (e.g. Google Search Console's
// google<token>.html). Google checks for the file at the exact URL-prefix of
// the property being verified, so drop a copy at the site root AND inside each
// article folder — that way any property under the site verifies, and the
// files survive every rebuild.
const verifyFiles = readdirSync(".").filter((f) => /^google[0-9a-f]+\.html$/i.test(f));
for (const f of verifyFiles) {
  copyFileSync(f, join(OUT_DIR, f));
  for (const slug of slugs) copyFileSync(f, join(OUT_DIR, slug, f));
  console.log(`copied verification file ${f} to root + ${slugs.length} article folders`);
}

console.log(`\n✓ built ${articles.length} articles -> ${OUT_DIR}/`);
