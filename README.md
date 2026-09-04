# AISLS Lab Website

Website for the AI Laboratory for Sustainable Livestock Systems (AISLS), Texas A&M University. Static multi-page site (plain HTML/CSS/JS) served by a small Express server.

## Quick start

1. Node 18+ recommended. Install deps:
```
npm install
```
2. Start the server:
```
npm run start
```
(or `npm run dev` for auto-reload via nodemon)
3. Open the site:
```
http://localhost:3000/index.html
```

## Site structure

- `index.html` — homepage (hero banner, vision/mission)
- `research.html` — research overview
- `team.html` + `team-<name>.html` — team roster and one project page per member
- `publications-and-awards.html` — publications list, rendered from `data/publications.json`
- `videos_podcasts.html` — video/podcast content, with a photo gallery rendered from `data/gallery.json`
- `photos.html` — photo gallery page
- `news.html` — lab news
- `aisfs.html` — AISFS Club page
- `contact.html` — contact info
- `styles.css`, `script.js` — shared site styling/behavior; `gallery.js`, `publications.js` render their respective data-driven sections

Navigation is defined per-page in each HTML file's `<nav>` — there is no shared templating layer.

## Content pipeline scripts

Two Python helper scripts (re-run by hand as content changes; not part of the build):

- `scripts/fetch_publications.py` — pulls a Google Scholar author profile into `data/publications.json`. See the script's docstring for usage; Scholar has no official API, so this is meant to be run occasionally by hand, not on a schedule.
  ```
  python scripts/fetch_publications.py
  ```
- `scripts/extract_pptx_photos.py` — extracts photos from a PowerPoint deck into `images/gallery/` plus a manifest at `data/gallery.json` that `gallery.js` reads.
  ```
  python scripts/extract_pptx_photos.py Presentation.pptx
  ```

## Legacy files

`server.js`, `dashboard.html`, `dashboard.js`, `property.html`, `property.js`, and the `data/mock-hostaway-reviews.json` / `data/approvals.json` files implement an unrelated mock "Hostaway reviews" API/dashboard from an earlier assignment template. They aren't linked from the live site's navigation and aren't part of the lab website content — the Express app in `server.js` is still what serves the static site, but its `/api/reviews/*` routes are unused here.
