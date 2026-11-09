# Binderlog (working name)

Phase 1 of the card portfolio app: an installable web app that identifies cards on the device.
Cards and photos are stored only in the user's browser (IndexedDB). Accounts, cloud sync, social and listings are later phases.

## Run locally
    npm ci
    npm run dev

The repo ships a demo index of invented cards. To match real cards:

    npm run build:index

This downloads card thumbnails from TCGdex to `.cache` and writes fingerprints to `public/index/cards.json`.

## Test
    npm test
    npm run build && npm run e2e

## Deploy
`.github/workflows/deploy.yml` builds the real index and deploys to GitHub Pages on each push and weekly.
Enable Pages with source "GitHub Actions". Camera capture on phones requires HTTPS.

## Before any public release
Complete the IP review and get written confirmation of price-data rights (see the plan). Rename the app after a trademark check.

## Not built yet
Embedding model, collector-number OCR, live video scanning, accounts and cloud photo storage, social features, listings, location search.
