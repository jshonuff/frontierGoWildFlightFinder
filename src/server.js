// Thin API server: serves the latest scrape to the Quasar front-end, triggers
// a background scrape when the data is stale (first open of the day), and runs
// an automatic refresh at 12:01 AM local time.
import express from "express";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runScrape, RESULTS_PATH } from "./scrape.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const WEB_DIST = resolve(__dirname, "../web/dist/spa");

// Scrape configuration the UI can tweak (date range). Origin is fixed to MSP.
const config = { origin: "MSP", days: Number(process.env.SCRAPE_DAYS) || 7, start: null };

// Don't re-scrape if we scraped within this window (protects against an
// itchy Refresh button hammering Frontier). The daily 12:01 run and the
// first-open-of-day run are already naturally limited to once per day.
const MIN_SCRAPE_INTERVAL_MS = (Number(process.env.MIN_SCRAPE_HOURS) || 6) * 3600_000;

// In-memory run state so we never start two scrapes at once.
const state = {
  running: false,
  startedAt: null,
  progress: null,
  lastError: null,
  completed: 0,
  total: 0,
  found: { flights: 0, goWild: 0 },
  failures: [],
};

// When the last completed scrape finished (from the results file mtime).
async function lastScrapeTime() {
  try {
    return (await stat(RESULTS_PATH)).mtime.getTime();
  } catch {
    return null;
  }
}

// Returns { started, running, skipped, reason, ageMinutes, waitMinutes }.
async function startScrape(reason, { force = false } = {}) {
  if (state.running) return { started: false, running: true };

  if (!force) {
    const last = await lastScrapeTime();
    if (last != null) {
      const age = Date.now() - last;
      if (age < MIN_SCRAPE_INTERVAL_MS) {
        return {
          started: false,
          skipped: true,
          reason: "cooldown",
          ageMinutes: Math.round(age / 60000),
          waitMinutes: Math.ceil((MIN_SCRAPE_INTERVAL_MS - age) / 60000),
        };
      }
    }
  }

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.lastError = null;
  // Fresh tallies for this run, consumed live by the UI's loading section.
  state.progress = { phase: "starting" };
  state.completed = 0;
  state.total = 0;
  state.found = { flights: 0, goWild: 0 };
  state.failures = [];
  console.log(`[scrape] starting (${reason})`);

  runScrape({
    ...config,
    onProgress: (p) => {
      state.progress = p;
      if (p.total) state.total = p.total;
      if (p.phase === "routeDone") {
        state.completed = p.index ?? state.completed + 1;
        state.found.flights += p.flights ?? 0;
        state.found.goWild += p.goWildHits ?? 0;
      } else if (p.phase === "error") {
        state.failures.push({ dest: p.dest, date: p.date ?? null, error: p.error });
      }
    },
  })
    .then((r) => {
      console.log(`[scrape] done: ${r.flightCount} flights, ${r.goWildCount} GoWild`);
    })
    .catch((err) => {
      state.lastError = err.message;
      console.error("[scrape] failed:", err.message);
    })
    .finally(() => {
      state.running = false;
      state.progress = null;
    });
  return { started: true, running: true };
}

// Most recent 12:01 AM boundary; data older than this is considered stale.
function lastRefreshBoundary() {
  const b = new Date();
  b.setHours(0, 1, 0, 0);
  if (Date.now() < b.getTime()) b.setTime(b.getTime() - 86400000);
  return b;
}

async function readResults() {
  try {
    return JSON.parse(await readFile(RESULTS_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function isStale() {
  try {
    const s = await stat(RESULTS_PATH);
    return s.mtime < lastRefreshBoundary();
  } catch {
    return true; // no file yet
  }
}

const app = express();
app.use(express.json());

// Latest data. If stale and not already running, kick off a background refresh
// and tell the client so it can poll /api/status.
app.get("/api/results", async (req, res) => {
  const data = await readResults();
  // First open of the day (data older than today's 12:01) triggers a refresh.
  // force:true is safe here because isStale() already limits this to once/day.
  if (await isStale()) await startScrape("stale on open", { force: true });
  res.json({ data, refreshing: state.running, config });
});

app.get("/api/status", (req, res) => {
  res.json({
    running: state.running,
    startedAt: state.startedAt,
    progress: state.progress,
    completed: state.completed,
    total: state.total,
    found: state.found,
    failures: state.failures,
    lastError: state.lastError,
    config,
  });
});

// Manual refresh (the UI's "Refresh" button); optional { days, start, force }.
// Respects the cooldown unless force:true is explicitly passed.
app.post("/api/scrape", async (req, res) => {
  if (typeof req.body?.days === "number") config.days = req.body.days;
  if (typeof req.body?.start === "string" || req.body?.start === null)
    config.start = req.body.start;
  const result = await startScrape("manual", { force: req.body?.force === true });
  res.json({ ...result, config });
});

// Serve the built Quasar SPA if present.
app.use(express.static(WEB_DIST));

const httpServer = app.listen(PORT, () => {
  console.log(`\n  Frontier GoWild Finder running →  http://localhost:${PORT}\n`);
  scheduleDailyRefresh();
});

httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${PORT} is already in use — the app is probably already running.\n` +
        `  Just open http://localhost:${PORT} in your browser.\n` +
        `  (To use a different port: set PORT, e.g.  $env:PORT=3001; npm run serve )\n`
    );
    process.exit(0);
  }
  throw err;
});

// Fire a scrape at the next 12:01 AM, then every 24h.
function scheduleDailyRefresh() {
  const next = new Date();
  next.setHours(0, 1, 0, 0);
  if (next.getTime() <= Date.now()) next.setTime(next.getTime() + 86400000);
  const wait = next.getTime() - Date.now();
  console.log(`[scheduler] next auto-refresh at ${next.toLocaleString()}`);
  setTimeout(() => {
    startScrape("daily 12:01 scheduler", { force: false });
    setInterval(() => startScrape("daily 12:01 scheduler"), 86400000);
  }, wait);
}
