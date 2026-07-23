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
- Shareable hunt links, agency boundary links, and a contact page for data
  corrections.

The app currently ingests data from:

- Utah Division of Wildlife Resources
- Colorado Parks and Wildlife
- Idaho Department of Fish and Game
- Wyoming Game and Fish Department

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
npm run ingest:all
```

Individual state and boundary importers are also available in `package.json`.

## Deployment

The app builds to static files in `dist/` and is configured for Firebase
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
