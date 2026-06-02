// Recon v3: pin down the embedded JSON envelope so the parser is robust.
// Saves the raw /Flight/Select HTML and the decoded JSON region for inspection.
import { writeFile } from "node:fs/promises";

const ORIGIN = "MSP";
const DEST = "DEN";
const DATE = "2026-06-02";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const jar = new Map();
const storeCookies = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

let res = await fetch(
  `https://booking.flyfrontier.com/Flight/InternalSelect?o1=${ORIGIN}&d1=${DEST}&dd1=${DATE}&ADT=1&mon=true&promo=`,
  { headers: HEADERS, redirect: "manual" }
);
storeCookies(res);
const loc = res.headers.get("location");
res = await fetch(new URL(loc, "https://booking.flyfrontier.com").href, {
  headers: { ...HEADERS, Cookie: cookieHeader() },
});
const html = await res.text();
await writeFile("data/select.html", html);

// The embedded data is HTML-entity-escaped JSON. Decode the whole doc, then
// find the object that holds "journeys".
const decoded = html
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .replaceAll("&amp;", "&");

const key = '"journeys"';
const k = decoded.indexOf(key);
console.log("journeys at:", k);

// Walk outward to the enclosing top-level object by brace-matching backward
// from the key to its opening, then forward to its close.
function extractObjectAround(str, pos) {
  // find start: scan back to the matching '{' for the object containing pos
  let depth = 0,
    start = -1;
  for (let i = pos; i >= 0; i--) {
    if (str[i] === "}") depth++;
    else if (str[i] === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  // find end from start
  depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

const objStr = extractObjectAround(decoded, k);
console.log("extracted object length:", objStr?.length);
if (objStr) {
  await writeFile("data/journeys.json", objStr);
  try {
    const obj = JSON.parse(objStr);
    const journeys = obj.journeys ?? obj.Journeys;
    console.log("journeys count:", journeys?.length);
    const first = journeys?.[0];
    console.log("journey[0] keys:", first && Object.keys(first));
    const flights = first?.flights ?? first?.Flights;
    console.log("flights in journey[0]:", flights?.length);
    if (flights?.[0]) {
      console.log("flight[0] keys:", Object.keys(flights[0]));
      console.log(
        "flight[0] sample:",
        JSON.stringify(
          {
            goWildFare: flights[0].goWildFare,
            goWildFareSeatsRemaining: flights[0].goWildFareSeatsRemaining,
            isGoWildFareEnabled: flights[0].isGoWildFareEnabled,
          },
          null,
          2
        )
      );
    }
  } catch (e) {
    console.log("JSON.parse failed:", e.message);
    console.log("head:", objStr.slice(0, 300));
  }
}
