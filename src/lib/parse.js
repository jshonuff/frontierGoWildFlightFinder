// Parsing helpers for Frontier's booking pages.
//
// The data we want is embedded in the page as HTML-entity-escaped JSON. We
// decode the entities, then brace/bracket-match outward from a known key to
// pull a valid JSON fragment we can JSON.parse.

export function decodeEntities(html) {
  return html
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

// Given decoded text and the byte index of a key, walk back to the opening
// `open` char of the structure that contains it, then forward to its match.
function matchEnclosing(str, pos, open, close) {
  let depth = 0;
  let start = -1;
  for (let i = pos; i >= 0; i--) {
    if (str[i] === close) depth++;
    else if (str[i] === open) {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === open) depth++;
    else if (str[i] === close) {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

// Extract the JSON object that directly contains "key": ... .
export function extractObjectContaining(decoded, key) {
  const k = decoded.indexOf(`"${key}"`);
  if (k < 0) return null;
  const frag = matchEnclosing(decoded, k, "{", "}");
  return frag ? JSON.parse(frag) : null;
}

// Extract the JSON array assigned to "key": [ ... ].
export function extractArrayForKey(decoded, key) {
  const k = decoded.indexOf(`"${key}"`);
  if (k < 0) return null;
  const start = decoded.indexOf("[", k);
  if (start < 0) return null;
  const frag = matchEnclosing(decoded, start, "[", "]");
  return frag ? JSON.parse(frag) : null;
}

// The Select page embeds a `stations` array; each station lists the `markets`
// (destination IATA codes) it serves. This is our route auto-discovery source.
export function parseStations(html) {
  const decoded = decodeEntities(html);
  return extractArrayForKey(decoded, "stations");
}

// Normalize the embedded journeys object into a flat list of flight records.
export function parseFlights(html, { origin, destination, date } = {}) {
  const decoded = decodeEntities(html);
  const obj = extractObjectContaining(decoded, "journeys");
  const journeys = obj?.journeys ?? [];
  const flights = [];

  for (const j of journeys) {
    for (const f of j.flights ?? []) {
      const legs = f.legs ?? [];
      const first = legs[0];
      const last = legs[legs.length - 1] || first;
      flights.push({
        origin: origin ?? j.departureStation,
        destination: destination ?? j.arrivalStation,
        destinationName: j.arrivalStationFormatted ?? null,
        originName: j.departureStationFormatted ?? null,
        date: date ?? (j.departureDate || "").slice(0, 10),
        departTime: first?.departureDateFormatted ?? null,
        arriveTime: last?.arrivalDateFormatted ?? null,
        departIso: first?.departureDate ?? null,
        arriveIso: last?.arrivalDate ?? null,
        duration: f.duration ?? null,
        stops: f.stopCount ?? 0,
        stopsText: f.stopsText ?? null,
        isNextDayArrival: !!f.isNextDayArrival,
        flightNumbers: legs.map((l) => `${l.carrierCode}${l.flightNumber}`),
        goWildFare: f.isGoWildFareEnabled ? f.goWildFare ?? null : null,
        goWildAvailable: !!f.isGoWildFareEnabled && f.goWildFare != null,
        goWildSeats: f.goWildFareSeatsRemaining ?? null,
        standardFare: f.standardFare ?? null,
      });
    }
  }
  return flights;
}
