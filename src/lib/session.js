// A tiny stateful HTTP session for Frontier's booking site.
//
// Frontier's flight search is a server-side session flow:
//   InternalSelect (302, sets ASP.NET_SessionId + dotrez cookies)
//     -> /Flight/Select (renders the data, needs those cookies)
// so we need a cookie jar that persists across requests and follows redirects
// while carrying cookies. Node's global fetch does neither, hence this wrapper.

const BASE = "https://booking.flyfrontier.com";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

export function createSession() {
  const jar = new Map();
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const baseHeaders = {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  function store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  // Fetch that persists cookies and manually follows up to `maxRedirects`
  // hops, re-sending the jar each hop. Returns the final Response's text.
  async function get(url, { maxRedirects = 5, headers = {} } = {}) {
    let current = new URL(url, BASE).href;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetch(current, {
        headers: { ...baseHeaders, ...headers, Cookie: cookieHeader() },
        redirect: "manual",
      });
      store(res);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { status: res.status, url: current, body: await res.text() };
        current = new URL(loc, current).href;
        continue;
      }
      return { status: res.status, url: current, body: await res.text() };
    }
    throw new Error(`Too many redirects starting at ${url}`);
  }

  return { get, jar, cookieHeader, userAgent };
}

export { BASE };
