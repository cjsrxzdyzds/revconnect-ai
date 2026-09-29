import test from "node:test";
import assert from "node:assert/strict";
import { parseDiscoveryQuery, searchEvents, recommendGroups, costEvidence, foodStatus, eventNotes, discoveryIntent, dateNumber, upcomingEvents, isEnglishQuery } from "../public/discovery.js";
import { parsePublicEvents } from "../src/worker.js";

const now = new Date("2026-09-25T20:00:00Z");
const event = {
  id: "festival", groupId: "42", title: "Mid-Autumn Festival", host: "Culture Society", category: "Cultural",
  date: "9/27/2026", time: "4:30pm", endDate: "9/27/2026", endTime: "8:00pm", timeZone: "Eastern Time (US & Canada)", foodProvided: true,
  description: "Date & Time: Sunday September 27th; 4pm. Free entry and raffle tickets! Food plate and boba $7.", url: "https://revconnect.gwu.edu/rsvp?id=42",
};

test("compound English queries recognize date, time and interest", () => {
  const parsed = parseDiscoveryQuery("Cultural events on Sunday from 4-8pm", {}, now);
  assert.equal(parsed.start, 960);
  assert.equal(parsed.end, 1200);
  assert.equal(parsed.dateFrom, dateNumber("2026-09-27"));
  assert.deepEqual(searchEvents([event], parsed, now).map((item) => item.id), ["festival"]);
});

test("non-English script queries are rejected instead of silently returning all events", () => {
  const query = "\u5468\u65e5\u6587\u5316\u6d3b\u52a8";
  assert.equal(isEnglishQuery(query), false);
  const parsed = parseDiscoveryQuery(query, {}, now);
  assert.equal(parsed.invalid, true);
  assert.match(parsed.warnings[0], /English/);
  assert.deepEqual(searchEvents([event], parsed, now), []);
  assert.deepEqual(recommendGroups([{ name: "Culture Club" }], [event], query, now), []);
});

test("the full event must fit, including end date; partial overlaps are excluded", () => {
  const query = parseDiscoveryQuery("Sunday 4-8pm cultural events", {}, now);
  assert.equal(searchEvents([
    event, { ...event, id: "early", time: "3:59pm" }, { ...event, id: "late", endTime: "8:01pm" },
    { ...event, id: "overnight", endDate: "9/28/2026", endTime: "1:00am" },
    { ...event, id: "unknown-end", endTime: "" }, { ...event, id: "wrong-zone", timeZone: "Pacific Time" },
    { ...event, id: "bad-end", endTime: "3pm" },
  ], query, now).length, 1);
});

test("numeric feed time zones are validated against GW daylight saving time", () => {
  const parsed = parseDiscoveryQuery("Sunday 4-8pm cultural events", {}, now);
  assert.equal(searchEvents([{ ...event, timeZone: "-4" }], parsed, now).length, 1);
  assert.equal(searchEvents([{ ...event, timeZone: "-5" }], parsed, now).length, 0);
  const winter = { ...event, date: "11/15/2026", endDate: "11/15/2026", timeZone: "-5" };
  const query = parseDiscoveryQuery("2026-11-15 4-8pm cultural events", {}, now);
  assert.equal(searchEvents([winter], query, now).length, 1);
  assert.equal(searchEvents([{ ...winter, timeZone: "-4" }], query, now).length, 0);
});

test("virtual feed format matches an online request", () => {
  const parsed = parseDiscoveryQuery("online cultural events", {}, now);
  assert.equal(searchEvents([{ ...event, locationType: "Virtual" }], parsed, now).length, 1);
  assert.equal(searchEvents([{ ...event, locationType: "On-Campus" }], parsed, now).length, 0);
});

test("date and time controls override natural-language conditions", () => {
  const query = parseDiscoveryQuery("Friday 5-7pm culture", { date: "2026-09-27", start: "16:00", end: "20:00" }, now);
  assert.equal(searchEvents([event], query, now).length, 1);
});

test("next weekdays use the next calendar week in GW time", () => {
  assert.equal(parseDiscoveryQuery("next Friday events", {}, now).dateFrom, dateNumber("2026-10-02"));
  const nearMidnight = new Date("2026-09-26T03:59:00Z");
  assert.equal(parseDiscoveryQuery("tomorrow", {}, nearMidnight).dateFrom, dateNumber("2026-09-26"));
});

test("impossible dates, invalid/ambiguous time windows never return misleading matches", () => {
  for (const query of ["2026-02-30 events", "Sunday 8pm-4pm", "Sunday 25:00-27:00", "Sunday 4-8 events"]) {
    const parsed = parseDiscoveryQuery(query, {}, now);
    assert.equal(parsed.invalid, true, query);
    assert.deepEqual(searchEvents([event], parsed, now), []);
  }
  assert.equal(dateNumber("2026-09-27"), dateNumber("9/27/2026"));
});

test("a shared PM suffix correctly handles a window across noon", () => {
  const parsed = parseDiscoveryQuery("Sunday 11-1pm events", {}, now);
  assert.equal(parsed.start, 660);
  assert.equal(parsed.end, 780);
  assert.equal(parsed.invalid, false);
});

test("food provision and free food are different claims", () => {
  const query = parseDiscoveryQuery("Sunday cultural events with food", {}, now);
  assert.deepEqual(searchEvents([event, { ...event, id: "unknown", foodProvided: null }, { ...event, id: "unmarked", foodProvided: false }], query, now).map((item) => item.id), ["festival"]);
  assert.match(foodStatus({}), /not available/);
  for (const query of ["Sunday free food events", "Sunday events without food"]) {
    const parsed = parseDiscoveryQuery(query, {}, now);
    assert.equal(parsed.invalid, true);
    assert.deepEqual(searchEvents([event], parsed, now), []);
  }
});

test("free time is not interpreted as a ticket price constraint", () => {
  assert.equal(parseDiscoveryQuery("I am free Friday 5-7pm", {}, now).free, false);
  assert.equal(parseDiscoveryQuery("I'm free Friday 5-7pm", {}, now).free, false);
  assert.equal(parseDiscoveryQuery("free cultural events Sunday", {}, now).free, true);
});

test("cost explanation separates explicit free entry, add-ons and unknown pricing", () => {
  assert.equal(costEvidence(event).free, true);
  assert.match(costEvidence(event).label, /free entry.*\$7/);
  assert.equal(costEvidence({ description: "Join us for food and activities" }).free, false);
  assert.match(costEvidence({ description: "Join us for food and activities" }).label, /not confirmed/);
  assert.equal(costEvidence({ description: "There is no free entry" }).free, false);
});

test("only explicit free-entry records pass a free-entry search", () => {
  const parsed = parseDiscoveryQuery("Sunday free cultural events", {}, now);
  assert.deepEqual(searchEvents([event, { ...event, id: "unknown", description: "Enjoy a cultural celebration" }], parsed, now).map((item) => item.id), ["festival"]);
});

test("source time conflicts are flagged without choosing a correct time", () => {
  assert.match(eventNotes(event)[0], /4:30 PM.*4 PM.*Confirm/);
  assert.deepEqual(eventNotes({ ...event, description: "Date & Time: September 27th; 4:30pm" }), []);
  assert.match(eventNotes({ ...event, endTime: "" })[1], /missing/);
});

test("explainable recommendations use whole-word topics and link actual hosted events", () => {
  const groups = [
    { id: "42", name: "AI & Consulting Club", description: "Artificial intelligence and consulting", category: "Professional" },
    { id: "43", name: "Trail Society", description: "We gain skills outdoors", category: "Recreation" },
    { id: "44", name: "Computing Club", description: "Learn programming", category: "Academic" },
  ];
  const ranked = recommendGroups(groups, [event], "Recommend groups for AI and consulting", now);
  assert.deepEqual(ranked.map((group) => group.id), ["42", "44"]);
  assert.equal(ranked[0].reasons.length, 2);
  assert.deepEqual(ranked[0].related.map((item) => item.id), ["festival"]);
  assert.equal(ranked[1].related.length, 0);
});

test("stale snapshots exclude past events, including earlier today", () => {
  assert.equal(upcomingEvents([{ ...event, date: "9/25/2026", time: "1pm" }, event], now).length, 1);
});

test("guidance intent remains available for event creation and funding", () => {
  assert.equal(discoveryIntent("How do I Create an event?"), "guidance");
  assert.equal(discoveryIntent("Friday events"), "events");
  assert.equal(discoveryIntent("Recommend AI groups"), "groups");
});

const xmlItem = (id, extra = "", privacy = "0") => `<item><eventUid>${id}</eventUid><title>Festival</title><groupId>42</groupId><eventDate>9/27/2026</eventDate><eventTime>4:30pm</eventTime><eventEndDate>9/27/2026</eventEndDate><eventEndTime>8pm</eventEndTime><timeZone>Eastern Time</timeZone><privacyLevel>${privacy}</privacyLevel><privacyDisplayedTo>0</privacyDisplayedTo>${extra}</item>`;
test("Worker exposes the new public fields and never replaces unknown food with false", () => {
  const [item] = parsePublicEvents(`<rss>${xmlItem("a", '<foodProvided>1</foodProvided><iCalLink>https://revconnect.gwu.edu/calendar?id=42</iCalLink><fullDescription><![CDATA[Free entry.<br>Food $7.]]></fullDescription>')}</rss>`);
  assert.equal(item.endTime, "8pm");
  assert.equal(item.groupId, "42");
  assert.equal(item.foodProvided, true);
  assert.match(item.description, /Free entry.*Food \$7/);
  assert.match(item.calendarUrl, /^https:/);
  assert.equal(parsePublicEvents(`<rss>${xmlItem("a")}</rss>`)[0].foodProvided, null);
});

test("Worker keeps private, unmarked, deleted and canceled records out of discovery", () => {
  const xml = `<rss>${xmlItem("public")}${xmlItem("private", "", "1")}${xmlItem("deleted", "<eventDelete>1</eventDelete>")}${xmlItem("canceled", "<approvalStatus>Cancelled</approvalStatus>")}${xmlItem("missing").replace('<privacyLevel>0</privacyLevel>', '')}${xmlItem("public")}</rss>`;
  assert.deepEqual(parsePublicEvents(xml).map((event) => event.id), ["public"]);
});

test("calendar links reject non-HTTPS URLs", () => {
  const [item] = parsePublicEvents(`<rss>${xmlItem("a", '<iCalLink>javascript:alert(1)</iCalLink>')}</rss>`);
  assert.equal(item.calendarUrl, "");
});
