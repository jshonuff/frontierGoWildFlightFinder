// High-level Frontier booking client built on the session + parse helpers.
import { createSession } from "./session.js";
import { parseStations, parseFlights } from "./parse.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Polite jitter between requests so we look like a human, not a firehose.
// 1.5–3.5s per request keeps a full daily scan slow and low-impact on Frontier.
export const politePause = () => sleep(1500 + Math.random() * 2000);

// Discover which destinations an origin serves, straight off Frontier's site.
// We load one real Select page (any served route works) and read the embedded
// `stations` array, then return the origin's `markets`.
export async function discoverMarkets(session, origin, seedDest = "DEN") {
  const today = new Date();
  const dd = new Date(today.getTime() + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  const url = `/Flight/InternalSelect?o1=${origin}&d1=${seedDest}&dd1=${dd}&ADT=1&mon=true&promo=`;
  const { body } = await session.get(url);
  const stations = parseStations(body) ?? [];
  const station = stations.find((s) => s.code === origin);
  if (!station) {
    throw new Error(`Could not find station ${origin} in embedded stations data`);
  }
  return { markets: station.markets ?? [], stations };
}

// Valid booking window + disabled dates for a route.
export async function getSchedule(session, origin, destination) {
  const url = `/Flight/RetrieveSchedule?calendarSelectableDays.Origin=${origin}&calendarSelectableDays.Destination=${destination}`;
  const { body } = await session.get(url);
  try {
    const data = JSON.parse(body).calendarSelectableDays ?? {};
    return {
      lastAvailableDate: data.lastAvailableDate
        ? data.lastAvailableDate.slice(0, 10)
        : null,
      disabledDates: (data.disabledDates ?? []).map((d) => d.slice(0, 10)),
      note: data.marketNoteMessage ?? null,
    };
  } catch {
    return { lastAvailableDate: null, disabledDates: [], note: null };
  }
}

// Flights (with GoWild fares) for one origin/destination/date.
export async function searchRoute(session, origin, destination, date) {
  const url = `/Flight/InternalSelect?o1=${origin}&d1=${destination}&dd1=${date}&ADT=1&mon=true&promo=`;
  const { body, status } = await session.get(url);
  if (status !== 200) return { status, flights: [] };
  return { status, flights: parseFlights(body, { origin, destination, date }) };
}

export { createSession };
