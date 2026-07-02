# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

A Node.js CLI bot that scrapes rental listings from a Facebook group (CDMX rentals) using Playwright. It opens a persistent browser session, waits for the user to manually log in to Facebook, scrolls through group posts, and filters listings by price and neighborhood (colonia).

## Running the bot

```bash
node main.js
```

The bot will open a visible Chrome window. When prompted in the terminal, log in to Facebook, navigate to the group, then press Enter. The session is persisted in `./fb-session/` so subsequent runs may skip the login step.

## Configuration

All tunable parameters live in `config.js`:

- `GROUP_URL` — the Facebook group to scrape
- `MAX_POSTS` — how many posts to filter (default 20)
- `FILTROS.precio_max` — maximum monthly rent in MXN
- `FILTROS.zonas` — array of neighborhood strings to match (empty = accept any zone)

## Architecture

The entire logic is in two files:

- `main.js` — Playwright browser automation + DOM extraction + filtering + console output
- `config.js` — exported `CONFIG` object with all runtime parameters

**Session persistence:** Playwright's `launchPersistentContext("./fb-session")` stores cookies and browser state so Facebook login survives across runs. Do not delete `fb-session/` unless you want to re-authenticate.

**Post extraction:** Posts are found via `[role="article"]` selectors. Links are filtered to exclude comment anchors and CDN-tracking params (`__cft__`). Price extraction uses regex to handle formats like "$12,000", "12 mil", "12000 pesos/al mes/mensuales".

**Filtering logic** (`pasaFiltros`): A post passes if its price is at or below `precio_max` AND its text contains at least one zone from `zonas` (if `zonas` is non-empty).

## Dependencies

- `playwright` — browser automation (Chromium)
- `@anthropic-ai/sdk` — installed but not yet used in current code
- ESM modules (`"type": "module"` in package.json) — use `import`/`export` syntax throughout
