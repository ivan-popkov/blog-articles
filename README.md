# Articles by Ivan Popkov

A small static archive of articles, built from Markdown and deployed to GitHub Pages.

**Live site:** https://ivan-popkov.github.io/blog-articles/

## How it works

Each article lives in its own folder under `content/`:

```
content/
  quantum-sudoku/
    index.md          # the article (Markdown, optional YAML frontmatter)
    cover.jpeg        # cover image + any other images, referenced relatively
    ...
```

`build.ts` (run by [Bun](https://bun.sh)) turns every folder into a standalone
HTML page, copies its images alongside, and generates `index.html` — a landing
page with one preview card (cover + title) per article. Output goes to `dist/`.

Frontmatter is optional. When absent, the title is taken from the first `#`
heading and the cover from the first image in the body.

## Local development

```sh
bun install
bun run build      # -> dist/
bun run preview    # build + serve dist/ locally
```

Or just open `dist/index.html` in a browser after building.

## Adding an article

1. Create `content/<slug>/index.md` with its images in the same folder.
2. (Optional) Add frontmatter — `title`, `date`, `thumbnail`, `seo_description`.
3. Commit and push to `main`. GitHub Actions rebuilds and redeploys.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds with Bun
and publishes `dist/` to GitHub Pages. No manual build step needed.
