# Hunt Planner

An unofficial, data-driven website for comparing big-game hunts across Utah,
Colorado, Idaho, and Wyoming.

**Live site:** [huntplanner-66d5e.web.app](https://huntplanner-66d5e.web.app)

## What is included

- State-specific hunt filters, seasons, weapons, quotas, draw data, and harvest
  survey results where the wildlife agency publishes them.
- Preference-point draw curves with an estimated P50 draw time.
- An opportunity score that combines estimated draw time and harvest success.
- Interactive hunt-boundary maps colored by harvest, draw time, or opportunity.
- Full-screen 3D hunt maps with satellite/topographic basemaps, terrain, and
  BLM surface-management status.
- Shareable hunt links, agency boundary links, and a contact page for data
  corrections.

The app currently ingests data from:

- Utah Division of Wildlife Resources
- Colorado Parks and Wildlife
- Idaho Department of Fish and Game
- Wyoming Game and Fish Department

## Getting started

The generated hunt data and map boundaries are committed to the repository, so
you do not need to run the ingestion pipeline for normal development.

```bash
git clone https://github.com/SamuelSauce/hunt-planner.git
cd hunt-planner
npm ci
npm run dev
```

Other common commands:

```bash
npm run build
npm run lint
npm run content:validate
```

## Editorial publishing

The static content build turns the structured hunt datasets and Markdown files
in `content/journal/` into crawlable hunt pages, journal articles, disclosure
pages, an XML sitemap, and an RSS feed. It runs automatically after the Vite
build.

Each journal article must include a complete metadata block, an original image,
current official sources, clearly labeled anecdotal field reports, and a link
to a matching Hunt Planner record. Run the content validator before previewing
or publishing.

Set `SITE_URL` when building for a different canonical host. The Search Console
verification token is persisted in the application home page and static
generator. `GOOGLE_SITE_VERIFICATION` can override it for another deployment.

## Refreshing source data

The Utah and Colorado PDF importers require `pdftotext`, which is provided by
Poppler:

```bash
# macOS
brew install poppler

# Ubuntu or Debian
sudo apt install poppler-utils
```

Run every importer with:

```bash
npm run ingest:all
```

Individual state and boundary importers are also available in `package.json`.
Downloaded PDFs and web pages are cached in the ignored `work/` directory at
the repository root. A fresh clone creates and populates this directory
automatically as the importers run.

To share a cache between checkouts or Git worktrees, set
`HUNT_PLANNER_WORK_DIR` to an absolute path:

```bash
HUNT_PLANNER_WORK_DIR="$HOME/.cache/hunt-planner" npm run ingest:all
```

Without that environment variable, each checkout keeps an independent cache in
its own `work/` directory.

## Deployment

The app builds to static files in `dist/client/` and is configured for Firebase
Hosting:

```bash
npm run build
firebase deploy --only hosting
```

## Data notes

Draw odds and harvest reports are historical and do not guarantee future draw
or hunting outcomes. State systems differ, so the app preserves state-specific
terminology and displays only the fields supported by each source.

This project is not affiliated with any state wildlife agency. Always verify
current regulations, season dates, boundaries, and application rules with the
official agency before applying or hunting.
