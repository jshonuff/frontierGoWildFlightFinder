// Main scraper: discover MSP's destinations, then scan a date range for GoWild
// availability + pricing on every route, and write the results to JSON.
//
// Usage:
//   node src/scrape.js                      # MSP, next 7 days, all destinations
//   node src/scrape.js --days 14            # next 14 days
//   node src/scrape.js --start 2026-06-10   # start from a specific date
//   node src/scrape.js --limit 3            # only first 3 destinations (testing)
//   node src/scrape.js --dest DEN,LAS,MCO   # only these destinations
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSession,
  discoverMarkets,
  getSchedule,
  searchRoute,
  politePause,
} from "./lib/frontier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const RESULTS_PATH = resolve(__dirname, "../data/results.json");

function dateRange(start, days) {
  const out = [];
  const base = start ? new Date(start + "T00:00:00") : new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function runScrape({
  origin = "MSP",
  start = null,
  days = 7,
  limit = null,
  only = null,
  onProgress = () => {},
} = {}) {
  const startedAt = new Date();
  const session = createSession();

  onProgress({ phase: "discover", origin });
  const { markets } = await discoverMarkets(session, origin);
  let dests = only ? markets.filter((m) => only.includes(m)) : markets;
  if (limit) dests = dests.slice(0, limit);

  const dates = dateRange(start, days);
  const flights = [];
  const routeStatus = [];

  for (let i = 0; i < dests.length; i++) {
    const dest = dests[i];
    onProgress({ phase: "route", dest, index: i + 1, total: dests.length });

    let schedule;
    try {
      await politePause();
      schedule = await getSchedule(session, origin, dest);
    } catch (err) {
      routeStatus.push({ dest, error: `schedule: ${err.message}` });
      onProgress({ phase: "error", dest, error: `schedule lookup failed: ${err.message}` });
      continue;
    }

    const disabled = new Set(schedule.disabledDates);
    let routeFlights = 0;
    let goWildHits = 0;

    for (const date of dates) {
      if (disabled.has(date)) continue;
      if (schedule.lastAvailableDate && date > schedule.lastAvailableDate) continue;
      try {
        await politePause();
        const { flights: fs } = await searchRoute(session, origin, dest, date);
        for (const f of fs) {
          flights.push(f);
          routeFlights++;
          if (f.goWildAvailable) goWildHits++;
        }
      } catch (err) {
        routeStatus.push({ dest, date, error: err.message });
        onProgress({ phase: "error", dest, date, error: err.message });
      }
    }

    routeStatus.push({
      dest,
      flights: routeFlights,
      goWildAvailable: goWildHits,
      lastAvailableDate: schedule.lastAvailableDate,
    });
    onProgress({
      phase: "routeDone",
      dest,
      index: i + 1,
      total: dests.length,
      flights: routeFlights,
      goWildHits,
    });
  }

  const result = {
    scrapedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    origin,
    dates,
    destinationCount: dests.length,
    flightCount: flights.length,
    goWildCount: flights.filter((f) => f.goWildAvailable).length,
    flights,
    routeStatus,
  };

  await mkdir(dirname(RESULTS_PATH), { recursive: true });
  await writeFile(RESULTS_PATH, JSON.stringify(result, null, 2));
  return result;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") opts.days = Number(argv[++i]);
    else if (a === "--start") opts.start = argv[++i];
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--origin") opts.origin = argv[++i];
    else if (a === "--dest") opts.only = argv[++i].split(",").map((s) => s.trim());
  }
  return opts;
}

// Run directly (not when imported by the server).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  console.log("Scraping with options:", opts);
  const t0 = Date.now();
  runScrape({
    ...opts,
    onProgress: (p) => {
      if (p.phase === "discover") console.log(`Discovering destinations from ${p.origin}...`);
      else if (p.phase === "route")
        process.stdout.write(`[${p.index}/${p.total}] ${p.dest} `);
      else if (p.phase === "routeDone")
        console.log(`-> ${p.flights} flights, ${p.goWildHits} GoWild`);
    },
  })
    .then((r) => {
      console.log(
        `\nDone in ${((Date.now() - t0) / 1000).toFixed(0)}s: ` +
          `${r.flightCount} flights across ${r.destinationCount} destinations, ` +
          `${r.goWildCount} with GoWild fares.`
      );
      console.log(`Wrote ${RESULTS_PATH}`);
    })
    .catch((err) => {
      console.error("Scrape failed:", err);
      process.exit(1);
    });
}
