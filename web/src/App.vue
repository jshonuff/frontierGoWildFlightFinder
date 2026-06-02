<template>
  <div class="app">
    <!-- Top nav -->
    <header class="nav">
      <div class="nav__brand">
        <q-icon name="flight_takeoff" size="20px" class="nav__logo" />
        <span class="nav__name">GoWild&nbsp;Finder</span>
      </div>

      <nav class="nav__tabs">
        <button :class="['tab', { active: view === 'cards' }]" @click="view = 'cards'">
          Deals
        </button>
        <button :class="['tab', { active: view === 'table' }]" @click="view = 'table'">
          All flights
        </button>
      </nav>

      <div class="nav__right">
        <div class="pill pill--gold">
          <q-icon name="sell" size="15px" />
          <span class="mono">{{ cheapest != null ? "$" + cheapest.toFixed(2) : "—" }}</span>
        </div>
        <div class="pill pill--origin">
          <q-icon name="my_location" size="14px" />
          <span class="mono">MSP</span>
        </div>
        <button class="icon-btn" :disabled="running" @click="refresh">
          <q-spinner v-if="running" size="16px" />
          <q-icon v-else name="refresh" size="18px" />
        </button>
      </div>
    </header>

    <main class="wrap">
      <!-- Loading / status panel -->
      <section v-if="running" class="panel loadbar">
        <div class="loadbar__head">
          <q-spinner-gears size="20px" class="accent" />
          <div class="loadbar__title">
            Scanning Frontier
            <span class="dim mono">{{ progressText }}</span>
          </div>
          <div class="loadbar__counts mono">
            <b>{{ scanCompleted }}</b><span class="dim">/{{ scanTotal || "…" }} routes</span>
          </div>
        </div>

        <q-linear-progress
          :value="progressPct / 100"
          :indeterminate="!scanTotal"
          color="teal-4"
          track-color="grey-10"
          rounded
          size="9px"
          class="loadbar__bar"
        />

        <div class="loadbar__stats mono">
          <span><b class="accent">{{ scanFound.flights }}</b> flights</span>
          <span><b class="accent">{{ scanFound.goWild }}</b> GoWild</span>
          <span v-if="liveFailures.length"><b class="alert">{{ liveFailures.length }}</b> failed</span>
          <span class="dim loadbar__hint">existing results stay below · ~{{ progressPct }}%</span>
        </div>

        <div v-if="liveFailures.length" class="failures">
          <div v-for="(f, i) in liveFailures.slice(-6)" :key="i" class="failure mono">
            <q-icon name="error_outline" size="13px" class="alert" />
            <span class="alert">{{ f.dest }}</span>
            <span v-if="f.date" class="dim">{{ f.date }}</span>
            <span class="dim failure__msg">{{ f.error }}</span>
          </div>
        </div>
      </section>

      <!-- Persistent "routes had issues" notice from the last completed scan -->
      <section v-else-if="failedRoutes.length" class="panel notice">
        <button class="notice__head" @click="showFailures = !showFailures">
          <q-icon name="warning_amber" size="18px" class="warn" />
          <span>
            {{ failedRoutes.length }} route{{ failedRoutes.length > 1 ? "s" : "" }}
            had issues during the last scan
          </span>
          <q-icon :name="showFailures ? 'expand_less' : 'expand_more'" size="18px" class="dim" />
        </button>
        <div v-if="showFailures" class="failures failures--persist">
          <div v-for="(f, i) in failedRoutes" :key="i" class="failure mono">
            <q-icon name="error_outline" size="13px" class="warn" />
            <span class="warn">MSP → {{ f.dest }}</span>
            <span v-if="f.date" class="dim">{{ f.date }}</span>
            <span class="dim failure__msg">{{ f.error }}</span>
          </div>
        </div>
      </section>

      <!-- Hero row: welcome panel + best deal panel -->
      <section class="hero-grid">
        <div class="panel panel--welcome">
          <div class="badge">
            <q-icon name="bolt" size="14px" /> GoWild Pass
          </div>
          <h1 class="welcome">Where can GoWild take you?</h1>
          <p class="welcome__sub">
            Live Frontier GoWild fares from
            <span class="hl mono">MSP</span> — Minneapolis–St.&nbsp;Paul
          </p>

          <div class="metrics">
            <div class="metric">
              <span class="metric__label">Destinations</span>
              <span class="metric__value mono">{{ destinationsWithGoWild }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">GoWild flights</span>
              <span class="metric__value mono">{{ goWildFlights.length }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">Cheapest</span>
              <span class="metric__value mono accent">
                {{ cheapest != null ? "$" + cheapest.toFixed(2) : "—" }}
              </span>
            </div>
            <div class="metric">
              <span class="metric__label">Nonstop</span>
              <span class="metric__value mono">{{ nonstopCount }}</span>
            </div>
          </div>
        </div>

        <div class="panel panel--deal" v-if="topDeal">
          <div class="panel__head">
            <span class="panel__title">Cheapest deal</span>
            <q-icon name="trending_down" size="16px" class="accent" />
          </div>
          <div class="deal-hero">
            <div class="deal-hero__route mono">
              <span class="accent">MSP</span>
              <q-icon name="trending_flat" size="18px" />
              <span class="accent">{{ topDeal.destination }}</span>
            </div>
            <div class="deal-hero__city">{{ cityOf(topDeal) }}</div>
            <div class="deal-hero__price mono">${{ topDeal.goWildFare.toFixed(2) }}</div>
            <div class="deal-hero__meta">
              <span class="chip" :class="topDeal.stops === 0 ? 'chip--ok' : 'chip--warn'">
                {{ topDeal.stopsText }}
              </span>
              <span class="mono dim">{{ topDeal.departTime }} → {{ topDeal.arriveTime }}</span>
            </div>
            <div class="deal-hero__date mono dim">{{ prettyDate(topDeal.date) }}</div>
          </div>
        </div>
        <div class="panel panel--deal panel--empty" v-else>
          <q-icon name="travel_explore" size="34px" class="dim" />
          <span class="dim">No GoWild fares yet — hit refresh</span>
        </div>
      </section>

      <!-- Filters -->
      <section class="filters">
        <q-input
          v-model="search" dense outlined dark
          placeholder="Search destination…" class="f-search"
        >
          <template #prepend><q-icon name="search" size="18px" /></template>
        </q-input>
        <q-select
          v-model="dateFilter" :options="dateOptions" dense outlined dark clearable
          label="Date" emit-value map-options class="f-field"
        />
        <q-input
          v-model.number="maxPrice" type="number" dense outlined dark clearable
          label="Max $" class="f-price"
        />
        <q-toggle v-model="nonstopOnly" label="Nonstop only" color="teal-4" dark />
        <div class="filters__spacer" />
        <q-input
          v-model.number="days" type="number" dense outlined dark
          label="Days" class="f-days" :disable="running"
        />
        <span v-if="meta.scrapedAt" class="updated mono">
          updated {{ formatWhen(meta.scrapedAt) }}
        </span>
      </section>

      <!-- Empty -->
      <div v-if="!filteredFlights.length && !running" class="empty">
        <q-icon name="travel_explore" size="56px" class="dim" />
        <div class="empty__title">No flights match your filters</div>
        <div class="dim">Adjust filters or hit refresh to scan Frontier.</div>
      </div>

      <!-- Deals cards -->
      <section v-else-if="view === 'cards'" class="cards">
        <button
          v-for="d in bestPerDestination" :key="d.destination"
          class="deal" @click="openDest(d.destination)"
        >
          <div class="deal__row1">
            <div class="deal__route mono">
              <span class="accent">MSP</span>
              <q-icon name="trending_flat" size="15px" class="dim" />
              <span class="accent">{{ d.destination }}</span>
            </div>
            <div class="deal__price mono">${{ d.goWildFare.toFixed(0) }}<span class="cents">.{{ centsOf(d.goWildFare) }}</span></div>
          </div>
          <div class="deal__city">{{ cityOf(d) }}</div>
          <div class="deal__row2">
            <span class="chip" :class="d.stops === 0 ? 'chip--ok' : 'chip--warn'">
              {{ d.stopsText }}
            </span>
            <span class="mono dim deal__time">{{ d.departTime }} → {{ d.arriveTime }}</span>
          </div>
          <div class="deal__row3">
            <span class="mono dim">{{ prettyDate(d.date) }}</span>
            <span v-if="d.goWildSeats" class="chip chip--alert">{{ d.goWildSeats }}</span>
            <span class="mono dim deal__count">{{ d.count }} flight{{ d.count > 1 ? "s" : "" }}</span>
          </div>
        </button>
      </section>

      <!-- All flights table -->
      <section v-else class="panel panel--table">
        <div class="panel__head panel__head--table">
          <span class="panel__title">All GoWild flights</span>
          <span class="dim mono">{{ filteredFlights.length }} flights</span>
        </div>
        <q-table
          :rows="filteredFlights" :columns="columns" row-key="rowKey"
          :pagination="pagination" :rows-per-page-options="[15, 30, 50, 0]"
          flat dark class="gw-table"
        >
          <template #body-cell-route="props">
            <q-td :props="props">
              <div class="mono accent t-route">MSP → {{ props.row.destination }}</div>
              <div class="dim t-city">{{ cityOf(props.row) }}</div>
            </q-td>
          </template>
          <template #body-cell-departTime="props">
            <q-td :props="props"><span class="mono">{{ props.row.departTime }}</span></q-td>
          </template>
          <template #body-cell-arriveTime="props">
            <q-td :props="props"><span class="mono">{{ props.row.arriveTime }}</span></q-td>
          </template>
          <template #body-cell-duration="props">
            <q-td :props="props"><span class="mono dim">{{ props.row.duration }}</span></q-td>
          </template>
          <template #body-cell-stopsText="props">
            <q-td :props="props">
              <span class="chip" :class="props.row.stops === 0 ? 'chip--ok' : 'chip--warn'">
                {{ props.row.stopsText }}
              </span>
            </q-td>
          </template>
          <template #body-cell-goWildSeats="props">
            <q-td :props="props">
              <span v-if="props.row.goWildSeats" class="chip chip--alert">{{ props.row.goWildSeats }}</span>
              <span v-else class="dim">—</span>
            </q-td>
          </template>
          <template #body-cell-goWildFare="props">
            <q-td :props="props"><span class="mono fare">${{ props.row.goWildFare.toFixed(2) }}</span></q-td>
          </template>
        </q-table>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useQuasar } from "quasar";

const $q = useQuasar();

const rows = ref([]);
const meta = ref({});
const running = ref(false);
const progress = ref(null);

// live scrape status (from /api/status)
const scanCompleted = ref(0);
const scanTotal = ref(0);
const scanFound = ref({ flights: 0, goWild: 0 });
const liveFailures = ref([]);
const routeStatus = ref([]);
const showFailures = ref(false);

const search = ref("");
const dateFilter = ref(null);
const maxPrice = ref(null);
const nonstopOnly = ref(false);
const days = ref(7);
const view = ref("cards");

const pagination = { rowsPerPage: 15, sortBy: "goWildFare", descending: false };

const columns = [
  { name: "route", label: "Destination", field: "destination", align: "left", sortable: true },
  { name: "date", label: "Date", field: "date", align: "left", sortable: true, format: (v) => prettyDate(v) },
  { name: "departTime", label: "Depart", field: "departIso", align: "left", sortable: true },
  { name: "arriveTime", label: "Arrive", field: "arriveTime", align: "left" },
  { name: "duration", label: "Duration", field: "duration", align: "left", sortable: true },
  { name: "stopsText", label: "Stops", field: "stops", align: "left", sortable: true },
  { name: "goWildSeats", label: "Seats", field: "goWildSeats", align: "left" },
  { name: "goWildFare", label: "GoWild", field: "goWildFare", align: "right", sortable: true },
];

const goWildFlights = computed(() => rows.value.filter((r) => r.goWildAvailable));

const filteredFlights = computed(() => {
  const q = (search.value || "").trim().toUpperCase();
  return goWildFlights.value
    .filter((r) => (nonstopOnly.value ? r.stops === 0 : true))
    .filter((r) =>
      q ? r.destination.includes(q) || (r.destinationName || "").toUpperCase().includes(q) : true
    )
    .filter((r) => (dateFilter.value ? r.date === dateFilter.value : true))
    .filter((r) => (maxPrice.value != null ? r.goWildFare <= maxPrice.value : true));
});

const bestPerDestination = computed(() => {
  const byDest = new Map();
  for (const f of filteredFlights.value) {
    const cur = byDest.get(f.destination);
    if (!cur) byDest.set(f.destination, { ...f, count: 1 });
    else {
      cur.count++;
      if (f.goWildFare < cur.goWildFare) byDest.set(f.destination, { ...f, count: cur.count });
    }
  }
  return [...byDest.values()].sort((a, b) => a.goWildFare - b.goWildFare);
});

const topDeal = computed(() => bestPerDestination.value[0] || null);
const cheapest = computed(() =>
  filteredFlights.value.length ? Math.min(...filteredFlights.value.map((f) => f.goWildFare)) : null
);
const destinationsWithGoWild = computed(() => new Set(goWildFlights.value.map((f) => f.destination)).size);
const nonstopCount = computed(() => filteredFlights.value.filter((f) => f.stops === 0).length);

const dateOptions = computed(() => {
  const set = [...new Set(goWildFlights.value.map((r) => r.date))].sort();
  return set.map((d) => ({ label: prettyDate(d), value: d }));
});

const progressText = computed(() => {
  const p = progress.value;
  if (!p) return "";
  if (p.phase === "discover" || p.phase === "starting") return "discovering destinations…";
  if (p.dest) return `${p.dest}`;
  return "";
});
const progressPct = computed(() =>
  scanTotal.value ? Math.round((scanCompleted.value / scanTotal.value) * 100) : 0
);
const failedRoutes = computed(() => routeStatus.value.filter((r) => r.error));

function cityOf(r) {
  return (r.destinationName || r.destination).replace(/\s*\([A-Z]{3}\)\s*$/, "");
}
function centsOf(n) {
  return Math.round((n % 1) * 100).toString().padStart(2, "0");
}
function prettyDate(d) {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}
function openDest(dest) {
  search.value = dest;
  view.value = "table";
}
function setData(data) {
  if (!data) return;
  meta.value = { scrapedAt: data.scrapedAt };
  routeStatus.value = data.routeStatus ?? [];
  rows.value = (data.flights ?? []).map((f, i) => ({
    ...f,
    rowKey: `${f.destination}-${f.date}-${f.departTime}-${i}`,
  }));
}
function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
function ageLabel(min) {
  return min < 60 ? `${min} min` : `${Math.round(min / 60)}h`;
}

async function load() {
  const res = await fetch("/api/results");
  const json = await res.json();
  if (json.config?.days) days.value = json.config.days;
  setData(json.data);
  if (json.refreshing) {
    running.value = true;
    poll();
  }
}

let pollTimer = null;
async function poll() {
  const res = await fetch("/api/status");
  const s = await res.json();
  running.value = s.running;
  progress.value = s.progress;
  scanCompleted.value = s.completed ?? 0;
  scanTotal.value = s.total ?? 0;
  scanFound.value = s.found ?? { flights: 0, goWild: 0 };
  liveFailures.value = s.failures ?? [];
  if (s.running) pollTimer = setTimeout(poll, 3000);
  else {
    progress.value = null;
    if (s.lastError) $q.notify({ type: "negative", message: "Scrape failed: " + s.lastError });
    else {
      await load();
      $q.notify({ type: "positive", message: "Results updated", icon: "check" });
    }
  }
}

async function refresh() {
  const res = await fetch("/api/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days: days.value }),
  });
  const json = await res.json();
  if (json.started || json.running) {
    running.value = true;
    poll();
  } else if (json.skipped && json.reason === "cooldown") {
    const hrs = Math.max(1, Math.round(json.waitMinutes / 60));
    $q.notify({
      type: "info", icon: "schedule",
      message: `Data is fresh (scanned ${ageLabel(json.ageMinutes)} ago).`,
      caption: `Next scan available in ~${hrs}h. Also auto-refreshes at 12:01 AM.`,
      timeout: 6000,
    });
  }
}

onMounted(load);
onUnmounted(() => clearTimeout(pollTimer));
</script>

<style scoped>
.app {
  --bg: #0a0e13;
  --panel: rgba(18, 24, 32, 0.66);
  --panel-2: rgba(26, 33, 43, 0.55);
  --border: rgba(255, 255, 255, 0.07);
  --border-2: rgba(255, 255, 255, 0.12);
  --text: #e6edf3;
  --muted: #8b97a5;
  --accent: #5ec9b8;
  --accent-dim: #2f8073;
  --gold: #e3b341;
  --mono: ui-monospace, "JetBrains Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace;

  min-height: 100vh;
  color: var(--text);
  font-family: system-ui, "Inter", "Segoe UI", Roboto, sans-serif;
  background:
    radial-gradient(1100px 520px at 72% -8%, rgba(70, 120, 150, 0.22), transparent 60%),
    radial-gradient(900px 480px at 8% -4%, rgba(40, 80, 100, 0.18), transparent 60%),
    linear-gradient(180deg, #0c131b 0%, #0a0e13 55%, #080b10 100%);
  background-attachment: fixed;
}
.mono { font-family: var(--mono); font-feature-settings: "tnum"; letter-spacing: 0.3px; }
.accent { color: var(--accent); }
.dim { color: var(--muted); }
.hl { color: var(--accent); }

/* Nav */
.nav {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 22px;
  background: rgba(10, 14, 19, 0.72);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
}
.nav__brand { display: flex; align-items: center; gap: 9px; font-weight: 700; }
.nav__logo { color: var(--accent); }
.nav__name { letter-spacing: 0.2px; }
.nav__tabs { display: flex; gap: 4px; background: rgba(255,255,255,0.04); padding: 4px; border-radius: 10px; }
.tab {
  border: 0; background: transparent; color: var(--muted);
  padding: 6px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.tab:hover { color: var(--text); }
.tab.active { background: rgba(255,255,255,0.10); color: #fff; }
.nav__right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.pill {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 9px; font-size: 13px;
  background: rgba(255,255,255,0.05); border: 1px solid var(--border);
}
.pill--gold { color: var(--gold); }
.pill--origin { color: var(--accent); }
.icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 9px; cursor: pointer;
  background: rgba(255,255,255,0.05); border: 1px solid var(--border); color: var(--text);
  transition: all 0.15s;
}
.icon-btn:hover:not(:disabled) { background: rgba(94,201,184,0.16); border-color: var(--accent-dim); color: var(--accent); }
.icon-btn:disabled { opacity: 0.6; cursor: default; }

/* Layout */
.wrap { max-width: 1180px; margin: 0 auto; padding: 22px; }

.alert { color: #ff9d7a; }
.warn { color: var(--gold); }

/* Loading / status panel */
.loadbar { margin-bottom: 18px; padding: 18px 20px; }
.loadbar__head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.loadbar__title { font-weight: 700; font-size: 15px; display: flex; align-items: baseline; gap: 10px; }
.loadbar__title .dim { font-size: 13px; font-weight: 500; }
.loadbar__counts { margin-left: auto; font-size: 14px; }
.loadbar__bar { border-radius: 6px; }
.loadbar__stats {
  display: flex; align-items: center; gap: 18px; margin-top: 12px; font-size: 13px;
}
.loadbar__hint { margin-left: auto; font-size: 12px; }

/* Failure lists */
.failures {
  margin-top: 14px; display: flex; flex-direction: column; gap: 6px;
  max-height: 180px; overflow-y: auto;
}
.failures--persist { margin-top: 12px; }
.failure {
  display: flex; align-items: center; gap: 8px; font-size: 12px;
  background: rgba(255,255,255,0.03); border: 1px solid var(--border);
  border-radius: 7px; padding: 6px 10px;
}
.failure__msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Persistent notice */
.notice { margin-bottom: 18px; padding: 0; overflow: hidden; }
.notice__head {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; background: rgba(227,179,65,0.06);
  border: 0; color: var(--text); font-size: 14px; font-weight: 600;
  cursor: pointer; text-align: left;
}
.notice__head:hover { background: rgba(227,179,65,0.1); }
.notice__head > span { flex: 1; }
.notice .failures { padding: 0 18px 16px; max-height: 260px; }

/* Panels */
.panel {
  background: var(--panel); backdrop-filter: blur(8px);
  border: 1px solid var(--border); border-radius: 16px; padding: 22px;
  box-shadow: 0 12px 34px rgba(0,0,0,0.35);
}
.panel__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.panel__title { font-size: 12px; text-transform: uppercase; letter-spacing: 1.4px; color: var(--muted); font-weight: 700; }

.hero-grid {
  display: grid; grid-template-columns: 1.5fr 1fr; gap: 18px; margin-bottom: 18px;
}
@media (max-width: 800px) { .hero-grid { grid-template-columns: 1fr; } }

.badge {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(94,201,184,0.14); color: var(--accent);
  border: 1px solid rgba(94,201,184,0.3); border-radius: 7px;
  padding: 3px 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
}
.welcome { font-size: 28px; font-weight: 700; margin: 14px 0 6px; line-height: 1.15; }
.welcome__sub { color: var(--muted); margin: 0; font-size: 14px; }
.metrics { display: flex; flex-wrap: wrap; gap: 26px; margin-top: 22px; }
.metric { display: flex; flex-direction: column; gap: 3px; }
.metric__label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }
.metric__value { font-size: 22px; font-weight: 700; }

/* Best-deal panel */
.panel--deal { display: flex; flex-direction: column; }
.panel--empty { align-items: center; justify-content: center; gap: 12px; text-align: center; }
.deal-hero__route { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; }
.deal-hero__route .q-icon { color: var(--muted); }
.deal-hero__city { color: var(--muted); margin-top: 4px; font-size: 13px; }
.deal-hero__price { font-size: 40px; font-weight: 800; color: var(--accent); margin: 12px 0 8px; }
.deal-hero__meta { display: flex; align-items: center; gap: 10px; }
.deal-hero__date { margin-top: 10px; font-size: 12px; }

/* Filters */
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 18px; }
.f-search { min-width: 220px; flex: 1 1 220px; }
.f-field { width: 150px; }
.f-price { width: 110px; }
.f-days { width: 92px; }
.filters__spacer { flex: 1 1 auto; }
.updated { font-size: 11px; color: var(--muted); }

/* Cards */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); gap: 14px; }
.deal {
  text-align: left; cursor: pointer;
  background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
  padding: 16px; transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
  color: var(--text);
}
.deal:hover { transform: translateY(-3px); border-color: var(--accent-dim); box-shadow: 0 12px 26px rgba(94,201,184,0.12); }
.deal__row1 { display: flex; align-items: flex-start; justify-content: space-between; }
.deal__route { display: flex; align-items: center; gap: 7px; font-size: 16px; font-weight: 700; }
.deal__price { font-size: 26px; font-weight: 800; color: var(--accent); line-height: 1; }
.cents { font-size: 13px; vertical-align: super; }
.deal__city { color: var(--muted); font-size: 13px; margin: 4px 0 14px; }
.deal__row2 { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.deal__time { font-size: 12px; }
.deal__row3 {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  border-top: 1px solid var(--border); padding-top: 11px; font-size: 12px;
}
.deal__count { font-size: 11px; }

/* Chips */
.chip {
  display: inline-block; padding: 2px 9px; border-radius: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.3px; font-family: var(--mono);
}
.chip--ok { background: rgba(94,201,184,0.14); color: var(--accent); border: 1px solid rgba(94,201,184,0.25); }
.chip--warn { background: rgba(255,255,255,0.06); color: var(--muted); border: 1px solid var(--border); }
.chip--alert { background: rgba(240,120,90,0.14); color: #ff9d7a; border: 1px solid rgba(240,120,90,0.3); }

/* Table */
.panel--table { padding: 0; overflow: hidden; }
.panel__head--table { padding: 18px 20px 0; }
.fare { color: var(--accent); font-weight: 700; }
.t-route { font-size: 13px; }
.t-city { font-size: 11px; }
.gw-table { background: transparent; }
.gw-table :deep(.q-table__top),
.gw-table :deep(thead tr),
.gw-table :deep(tbody td) { border-color: var(--border); }
.gw-table :deep(thead th) {
  color: var(--muted); text-transform: uppercase; font-size: 11px; letter-spacing: 0.6px; font-weight: 700;
}
.gw-table :deep(tbody tr:hover) { background: rgba(94,201,184,0.05); }
.gw-table :deep(.q-table__bottom) { color: var(--muted); border-color: var(--border); }

/* Empty */
.empty { text-align: center; padding: 70px 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.empty__title { font-size: 18px; font-weight: 600; margin-top: 8px; }
</style>
