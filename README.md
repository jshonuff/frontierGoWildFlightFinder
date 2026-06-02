# Frontier GoWild Flight Finder

Scan **MSP → every Frontier destination** for [GoWild! Pass](https://www.flyfrontier.com/deals/gowild) availability and pricing, so you don't have to click through Frontier's site one route at a time. Results show in a sortable/filterable Quasar dashboard.

## How it works

Frontier has no public API, but its booking flow exposes the data we need:

1. `RetrieveSchedule` (JSON) → the valid booking window + disabled dates per route.
2. `InternalSelect` → 302 → `/Flight/Select` (a server-side session flow using
   `ASP.NET_SessionId` + `dotrez` cookies). The Select page embeds a JSON blob
   with every flight's times plus **`goWildFare`**, **`goWildFareSeatsRemaining`**,
   and **`isGoWildFareEnabled`**.
3. The same page embeds a `stations` array — each station's `markets` list is how
   we **auto-discover** the 70 destinations MSP serves (no hardcoded route list).

Plain Node HTTP requests reach all of this (no browser automation needed).
Playwright is kept only as a fallback if Frontier ever adds bot protection.

> Inspired by the Python project
> [fly-metothemoon/GWsearch](https://github.com/fly-metothemoon/GWsearch),
> ported to Node and given a Quasar front-end.

## Project layout

```
src/
  lib/session.js   cookie-jar fetch + manual redirect following
  lib/parse.js     decode entities, extract stations + journeys/flights JSON
  lib/frontier.js  discoverMarkets / getSchedule / searchRoute
  scrape.js        CLI + runScrape(): discover -> loop dates×routes -> results.json
  server.js        API + serves the SPA + 12:01 AM auto-refresh + freshness logic
  recon.js         dev/debug probe (kept for reference)
web/               Quasar (Vite) dashboard
data/results.json  generated scrape output
```

## Requirements

- **Node.js** 18+ (uses ES modules)
- **npm** 9+

## Installation & Setup

1. Install root dependencies:
```bash
npm install
```

2. Install front-end dependencies:
```bash
cd web && npm install && cd ..
```

## Usage

### Running a Scrape

Scrapes write results to `data/results.json`:

```bash
npm run scrape                       # MSP, next 7 days, all 70 destinations (~15–20 min)
node src/scrape.js --days 14         # next 14 days
node src/scrape.js --dest DEN,LAS    # just these routes (quick test)
node src/scrape.js --start 2026-06-10 --days 5
```

### Running the Server + Dashboard

Build the front-end and start the server on http://localhost:3000:

```bash
cd web && npm run build && cd ..
npm run serve
```

The server serves the latest results and **auto-refreshes** when you open the app if the data is older than today's 12:01 AM, plus on a daily 12:01 AM timer.

### Front-end Development Mode

Run both the API and Vite dev server with hot reload:

```bash
npm run serve            # terminal 1: API on :3000
cd web && npm run dev    # terminal 2: Vite on :9000, proxies /api -> :3000
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `SCRAPE_DAYS` | `7` | Default days ahead to scrape |
| `MIN_SCRAPE_HOURS` | `6` | Minimum hours between scrapes (prevents hammering Frontier) |

Example:
```bash
PORT=8080 SCRAPE_DAYS=14 npm run serve
```

## Notes

- Be a good citizen: the scraper paces requests with 0.5–1.5s jitter. A full run
  is ~560 requests for 7 days; keep it to a once-daily refresh.
- GoWild seat counts only appear when Frontier flags them low ("2 Seats Left!").
- Fares shown are the base GoWild fare (e.g. $15.41 MSP→DEN); taxes/fees add a
  couple dollars at checkout.
