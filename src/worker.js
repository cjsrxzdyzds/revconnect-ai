import { handleAsk } from './free-ai.js';
export { FreeAiBudget } from './free-ai.js';

const EVENTS_URL =
  "https://gwu.campusgroups.com/rss_events?deleted=0&time_range=upcoming_only&future_day_range=60&limit=300&privacy_displayed_to=0&privacy_level=0";

function xmlValue(item, tag) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1] : "";
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return Number.isFinite(number) && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    })
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) =>
      ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity],
    )
    .replace(/\s+/g, " ")
    .trim();
}

function field(item, tag) {
  return decodeXml(xmlValue(item, tag));
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function parsePublicEvents(xml) {
  const events = [];
  const seen = new Set();
  const blocked = new Set(["cancelled", "canceled", "rejected", "denied", "deleted"]);
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    if (field(item, "eventDelete") === "1") continue;
    if (blocked.has(field(item, "approvalStatus").toLowerCase())) continue;
    const privacy = field(item, "privacyLevel");
    const displayed = field(item, "privacyDisplayedTo");
    if (privacy !== "0" && privacy !== "Everyone") continue;
    if (displayed !== "0" && displayed !== "Everyone") continue;
    const title = field(item, "title");
    const id = field(item, "eventUid") || field(item, "eventId");
    if (!title || !id || seen.has(id)) continue;
    seen.add(id);
    events.push({
      id,
      groupId: field(item, "groupId"),
      title,
      host: field(item, "group"),
      category: field(item, "eventType"),
      date: field(item, "eventDate"),
      time: field(item, "eventTime"),
      endDate: field(item, "eventEndDate"),
      endTime: field(item, "eventEndTime"),
      timeZone: field(item, "timeZone"),
      locationType: field(item, "locationType"),
      foodProvided: field(item, "foodProvided") === "1" ? true : field(item, "foodProvided") === "0" ? false : null,
      calendarUrl: safeLink(field(item, "iCalLink")),
      location: field(item, "eventLocation"),
      description: (field(item, "fullDescription") || field(item, "description")).slice(0, 6000),
      url: safeLink(field(item, "eventLink")),
    });
  }
  return events;
}

function jsonResponse(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ocr/config') return jsonResponse({ enabled: false }, 200);
    if (url.pathname === '/api/ask') {
      return handleAsk(request, env, async () => {
        const snapshot = await env.ASSETS.fetch(new Request(`${url.origin}/data.json`));
        if (!snapshot.ok) throw new Error('Missing public snapshot');
        const data = await snapshot.json();
        const live = await this.fetch(new Request(`${url.origin}/api/events`), env, ctx);
        const events = live.ok ? (await live.json()).events : data.events;
        return { data, events };
      });
    }
    if (url.pathname !== "/api/events") {
      return jsonResponse({ error: "Not found" }, 404);
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/api/events?schema=2`, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      const upstream = await fetch(EVENTS_URL, {
        headers: { Accept: "application/xml,text/xml" },
        cf: { cacheTtl: 600, cacheEverything: true },
      });
      if (!upstream.ok) throw new Error(`CampusGroups HTTP ${upstream.status}`);
      const xml = await upstream.text();
      if (!xml.includes("<rss")) throw new Error("CampusGroups returned unexpected data");
      const response = jsonResponse(
        { events: parsePublicEvents(xml), fetchedAt: new Date().toISOString(), feedLimit: 300, feedDays: 60 },
        200,
        600,
      );
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch {
      return jsonResponse({ error: "Live events are temporarily unavailable" }, 502);
    }
  },
};
