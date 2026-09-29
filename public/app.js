import { dateNumber, formatDate, eventInterval, upcomingEvents, parseDiscoveryQuery, searchEvents, recommendGroups, foodStatus, costEvidence, eventNotes, discoveryIntent, timeZoneLabel, isEnglishQuery } from "./discovery.js";
import { score } from './retrieval.js';

const $ = (selector) => document.querySelector(selector);
const state = { data: null, events: [], eventSource: "", eventFetchedAt: "", feedLimit: 300, feedDays: 60, lastQuestion: "" };
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const preciseMoney = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const shortDate = (value) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "unknown";

function node(tag, className = "", content = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content) item.textContent = content;
  return item;
}

function safeHref(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function sourceLink(url, label = "View source ↗") {
  const href = safeHref(url);
  if (!href) return node("span", "meta-line", "No direct source link");
  const link = node("a", "card-link", label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function trim(value, length = 300) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

function currentEvents() {
  return upcomingEvents(state.events);
}

function appendReasons(card, reasons) {
  if (!reasons.length) return;
  const list = node("ul", "match-reasons");
  for (const reason of reasons.slice(0, 4)) list.append(node("li", "", reason));
  card.append(list);
}

function groupCard(group) {
  const card = node("article", "listing-card");
  card.append(node("h4", "", group.name));
  if (group.category) card.append(node("span", "tag", trim(group.category, 90)));
  if (group.description) card.append(node("p", "", trim(group.description, 220)));
  else card.append(node("p", "meta-line", "No published description in this snapshot."));
  appendReasons(card, group.reasons);
  if (group.related.length) {
    const related = node("div", "related-events");
    related.append(node("strong", "", "A next step"));
    for (const event of group.related) related.append(sourceLink(event.url, `${event.title} · ${formatDate(event.date)} ↗`));
    card.append(related);
  }
  card.append(sourceLink(group.url, "Open official group page ↗"));
  return card;
}

function eventCard(event) {
  const card = node("article", "listing-card");
  const date = dateNumber(event.date);
  if (date !== null) {
    const tile = node("div", "date-tile");
    tile.append(node("small", "", new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(date)).toUpperCase()), node("strong", "", String(new Date(date).getUTCDate())));
    card.append(tile);
  }
  card.append(node("h4", "", event.title));
  const interval = eventInterval(event);
  const time = `${event.time || "Time unknown"}${event.endTime ? ` – ${event.endTime}` : ""}`;
  card.append(node("div", "meta-line", [formatDate(event.date), time, timeZoneLabel(event)].join(" · ")));
  if (event.endDate && dateNumber(event.endDate) !== date) card.append(node("div", "meta-line", `Ends ${formatDate(event.endDate)}`));
  if (interval.start !== null && interval.end > interval.start) card.append(node("span", "tag", `${(interval.end - interval.start) / 60000} min`));
  if (event.foodProvided === true) card.append(node("span", "tag", "Food marked as provided"));
  card.append(node("div", "meta-line", [event.host, event.location].filter(Boolean).join(" · ")));
  if (event.description) card.append(node("p", "", trim(event.description, 210)));
  appendReasons(card, event.reasons || []);
  const details = node("div", "event-facts");
  const cost = costEvidence(event);
  details.append(node("p", "", foodStatus(event)), node("p", "", cost.label));
  if (cost.excerpt) details.append(node("p", "", `Published cost detail: “${cost.excerpt}”`));
  card.append(details);
  for (const note of eventNotes(event)) card.append(node("p", "source-warning", note));
  const links = node("div", "listing-links");
  links.append(sourceLink(event.url, "Details & registration ↗"));
  if (safeHref(event.calendarUrl)) links.append(sourceLink(event.calendarUrl, "Add to calendar ↗"));
  card.append(links);
  return card;
}

function querySummary(target, parsed, count) {
  target.replaceChildren();
  const chips = node("div", "constraint-chips");
  for (const label of parsed.labels) chips.append(node("span", "tag", label));
  target.append(chips);
  for (const warning of parsed.warnings) target.append(node("p", "source-warning", warning));
  target.append(node("p", "meta-line", `${count} ${count === 1 ? "match" : "matches"} in the available public feed. ${parsed.labels.length ? "These are the conditions understood from your question." : "Add an interest, date or time window to narrow the list."}`));
}

function renderGroups() {
  if (!state.data) return;
  const query = $("#group-search").value.trim();
  const starterNames = new Set(state.data.starterGroups.map((group) => group.org_name.toLowerCase()));
  const all = recommendGroups(state.data.groups, state.events, query);
  if (!query) all.sort((a, b) => Number(starterNames.has(b.name.toLowerCase())) - Number(starterNames.has(a.name.toLowerCase())) || a.name.localeCompare(b.name));
  const matches = all.slice(0, 6);
  const target = $("#group-results");
  target.replaceChildren(...matches.map(groupCard));
  if (!matches.length) target.append(node("p", "empty-state", "No published match. Try a group name or an interest such as AI, consulting, culture, or service."));
  $("#group-count").textContent = state.data.groups.length.toLocaleString();
  $("#group-note").textContent = `Showing ${matches.length} of ${all.length} matches across ${state.data.groups.length} public organizations. Snapshot: ${shortDate(state.data.groupsFetchedAt)}. Recommendations match published interests; membership requirements are unverified. Recent events cover only the available feed.`;
}

function renderEvents() {
  const query = $("#event-search").value.trim();
  const parsed = parseDiscoveryQuery(query, { date: $("#event-date").value, start: $("#event-start").value, end: $("#event-end").value, food: $("#event-food").checked });
  const all = searchEvents(state.events, parsed);
  const matches = all.slice(0, 6);
  const target = $("#event-results");
  querySummary($("#event-query-summary"), parsed, all.length);
  target.replaceChildren(...matches.map(eventCard));
  if (!matches.length) target.append(node("p", "empty-state", parsed.invalid ? "Adjust the conditions above to search again." : "No event fits every understood condition in this feed. Change the day, widen the time window or browse the full RevConnect calendar."));
  $("#event-count").textContent = String(all.length);
  $("#event-note").textContent = `${state.eventSource === "live" ? "Live public feed" : "Saved public snapshot"}, checked ${shortDate(state.eventFetchedAt)}. Up to ${state.feedLimit} feed items across ${state.feedDays} days. Showing ${matches.length} of ${all.length} matches. Time windows require a known start, end and GW time zone. Confirm ticket options and availability on RevConnect.`;
}

function guidanceItem(title, description, url, secondary = "") {
  const item = node("article", "guidance-item");
  item.append(node("h4", "", title), node("p", "", trim(description, 350)));
  if (secondary) item.append(node("p", "secondary", trim(secondary, 300)));
  item.append(sourceLink(url));
  return item;
}

function renderGuidance() {
  const data = state.data;
  $("#funding-list").replaceChildren(...data.fundingPrograms.map((row) => guidanceItem(row.program, row.best_for, row.source_url, row.timing)));
  $("#howto-list").replaceChildren(...data.howto.map((row) => guidanceItem(row.topic, row.summary, row.source_url, row.steps)));
  $("#resource-list").replaceChildren(...data.resources.map((row) => guidanceItem(row.resource, row.description, row.source_url, row.contact)));
  renderDeadlines();
}

function renderDeadlines() {
  if (!state.data) return;
  const query = $("#deadline-search").value.trim();
  const rows = state.data.deadlines
    .map((row) => ({ ...row, rank: query ? score(query, row.topic, "", `${row.deadline} ${row.timeline}`) : 1 }))
    .filter((row) => !query || row.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, query ? 12 : 6);
  const target = $("#deadline-list");
  target.replaceChildren(...rows.map((row) => guidanceItem(row.topic, row.deadline, row.source_url, row.timeline)));
  if (!rows.length) target.append(node("p", "empty-state", "No matching timeline in the guide. Ask Org Help for current requirements."));
}

function renderRuleAnswer(question) {
  if (!state.data) return;
  state.lastQuestion = question;
  if (!isEnglishQuery(question)) {
    $("#ask-results").replaceChildren(node("p", "empty-state", "Please enter your question in English."));
    return;
  }
  const intent = discoveryIntent(question);
  const target = $("#ask-results");
  if (intent === "events") {
    const parsed = parseDiscoveryQuery(question);
    const matches = searchEvents(state.events, parsed);
    querySummary(target, parsed, matches.length);
    const grid = node("div", "answer-list");
    grid.append(...matches.slice(0, 3).map(eventCard));
    if (!matches.length) grid.append(node("p", "empty-state", "No matching public event. Use the date and time controls under Discover to adjust your conditions."));
    target.append(grid);
    return;
  }
  if (intent === "groups") {
    const groups = recommendGroups(state.data.groups, state.events, question).slice(0, 3);
    target.replaceChildren(node("p", "result-intro", "Suggested starting points based on your interests and published group descriptions. Each result explains the match and links to its official page."));
    const grid = node("div", "answer-list");
    grid.append(...groups.map(groupCard));
    if (!groups.length) grid.append(node("p", "empty-state", "No published interest match. Try a group name, AI, consulting, culture, or service."));
    target.append(grid);
    return;
  }
  const data = state.data;
  const candidates = [
    ...data.howto.map((row) => ({ type: "CampusGroups how-to", title: row.topic, body: `${row.summary} ${row.steps}`, keywords: row.audience, url: row.source_url })),
    ...data.deadlines.map((row) => ({ type: "Deadline", title: row.topic, body: `${row.deadline}. ${row.timeline}`, keywords: "timing deadline due submit apply", url: row.source_url })),
    ...data.fundingPrograms.map((row) => ({ type: "Funding", title: row.program, body: `${row.best_for} ${row.timing}`, keywords: "funding money sga allocation sponsorship", url: row.source_url })),
    ...data.resources.map((row) => ({ type: "Campus support", title: row.resource, body: `${row.description} Contact: ${row.contact}`, keywords: row.keywords, url: row.source_url })),
    ...data.groups.map((row) => ({ type: "Organization", title: row.name, body: row.description, keywords: `${row.category} ${row.keywords}`, url: row.url })),
    ...currentEvents().map((row) => ({ type: "Public event", title: row.title, body: `${row.date} ${row.time}. ${row.host}. ${row.location}. ${row.description}`, keywords: row.category, url: row.url })),
  ];
  const ranked = candidates.map((item) => ({ ...item, rank: score(question, item.title, item.keywords, item.body) })).filter((item) => item.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 3);
  target.replaceChildren();
  if (!ranked.length) {
    target.append(node("p", "empty-state", "No close match in the public guidance. Try a shorter question or contact Org Help."));
    return;
  }
  target.append(node("p", "result-intro", "These are the closest published matches. Review the linked source before relying on a deadline, eligibility rule, or policy."));
  const grid = node("div", "answer-list");
  for (const item of ranked) {
    const card = node("article", "answer-card");
    card.append(node("span", "answer-type", item.type), node("h3", "", item.title), node("p", "", trim(item.body, 320)), sourceLink(item.url));
    grid.append(card);
  }
  target.append(grid);
}

let askSequence = 0;
let askController;
async function ask(question) {
  const sequence = ++askSequence;
  askController?.abort();
  renderRuleAnswer(question);
  if (!state.data || !question || question.length > 400 || !isEnglishQuery(question)) return;
  const panel = node('article', 'ai-answer');
  panel.setAttribute('aria-live', 'polite');
  panel.append(node('p', 'meta-line', 'Preparing a summary from the matching public records…'));
  $('#ask-results').prepend(panel);
  const controller = new AbortController();
  askController = controller;
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/api/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }), signal: controller.signal,
    });
    const result = response.ok ? await response.json() : { mode: 'rules' };
    if (sequence !== askSequence) return;
    panel.replaceChildren();
    if (result.mode !== 'ai') {
      panel.append(node('p', 'meta-line', result.reason === 'daily_limit' ? 'Today’s AI summary allowance has been used. Public-record search remains available.' : 'Showing public-record search results. AI summaries are currently unavailable.'));
      return;
    }
    panel.append(node('strong', '', 'AI summary'), node('p', '', result.answer), node('p', 'meta-line', 'Generated from these public records. Confirm details on the official pages.'));
    for (const [i, source] of (result.sources || []).entries()) panel.append(sourceLink(source.url, `[${i + 1}] ${source.title} ↗`));
  } catch {
    if (sequence === askSequence) panel.replaceChildren(node('p', 'meta-line', 'Showing public-record search results. AI summaries are currently unavailable.'));
  } finally { clearTimeout(timer); }
}

function amount(form, key) {
  const value = Number(new FormData(form).get(key));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function resultRow(label, value, extraClass = "") {
  const row = node("div", `money-row ${extraClass}`);
  row.append(node("span", "", label), node("strong", "", preciseMoney(value)));
  return row;
}

function estimateBudget(form) {
  const attendees = amount(form, "attendees");
  const food = new FormData(form).get("food");
  const assumption = state.data.budgetAssumptions.find((row) => row.item.startsWith(food === "meal" ? "Meal" : "Snacks"));
  const foodRates = food === "none" ? [0, 0, 0] : [Number(assumption.low), Number(assumption.typical), Number(assumption.high)];
  const quoteRaw = new FormData(form).get("foodQuote");
  const quotedFood = food !== "none" && quoteRaw !== "" ? amount(form, "foodQuote") : null;
  const supplies = attendees * amount(form, "supplies");
  const delivery = food === "none" ? 0 : amount(form, "deliveryFees");
  const service = food === "none" ? 0 : amount(form, "serviceFees");
  const tip = food === "none" ? 0 : amount(form, "foodTip");
  const tax = food === "none" ? 0 : amount(form, "foodTax");
  const fees = delivery + service + tip + tax;
  const fixed = ["marketing", "venue", "speaker", "avTravel", "other"].reduce((sum, key) => sum + amount(form, key), 0) + fees;
  const factor = 1 + amount(form, "contingency") / 100;
  const totals = foodRates.map((rate) => ((quotedFood === null ? attendees * rate : quotedFood) + supplies + fixed) * factor);
  const target = $("#budget-result");
  if (quotedFood === null) target.replaceChildren(node("strong", "", "Planning range"), resultRow("Low estimate", totals[0]), resultRow("Typical estimate", totals[1], "money-total"), resultRow("High estimate", totals[2]));
  else target.replaceChildren(node("strong", "", "Itemized food quote"), resultRow("Menu subtotal", quotedFood), resultRow("Delivery", delivery), resultRow("Service fee", service), resultRow("Tip", tip), resultRow("Quoted tax", tax), resultRow("Food order total", quotedFood + fees), resultRow("Event planning total", totals[1], "money-total"));
  const foodNote = food === "none" ? "No food costs are included." : quotedFood === null ? "Food rates are planning assumptions; add an itemized quote to replace them." : `The entered food quote is ${attendees ? preciseMoney((quotedFood + fees) / attendees) : "unallocated"} per attendee before event contingency.`;
  target.append(node("p", "panel-note", `Includes ${preciseMoney(supplies)} in supplies, ${preciseMoney(fixed - fees)} in other entered costs, and ${amount(form, "contingency")}% contingency. ${foodNote} This is not a live vendor price.`));
  if (food !== "none") {
    const details = new FormData(form);
    const provider = details.get("foodProvider");
    const providerName = provider === "ezcater" ? "ezCater" : provider === "instacart" ? "Instacart" : "your approved channel";
    const vendor = String(details.get("foodVendor") || "").trim();
    const date = details.get("foodDate");
    const time = details.get("foodTime");
    const zip = String(details.get("foodZip") || "").trim();
    const needs = String(details.get("dietaryNeeds") || "").trim();
    const suggestion = node("p", "panel-note", `${providerName} planning: ${vendor || "choose a restaurant or store"}; ${date || "set a delivery date"}${time ? ` at ${time}` : " and time"}${zip ? ` to ZIP ${zip}` : ""}. ${needs ? `Dietary needs: ${needs}.` : "Check dietary needs."} Confirm the order minimum, final fees, tax exemption, delivery window, and event flyer or attendee list with Org Help.`);
    target.append(suggestion);
  } else if (supplies) target.append(node("p", "panel-note", "For eligible event supplies, check your office's Amazon purchasing process and share a Wish List for extensive orders."));
}

function syncFoodWorkspace() {
  const noFood = $("#budget-form").elements.food.value === "none";
  $("#food-workspace").hidden = noFood;
  $("#food-workspace").disabled = noFood;
}

function makeDraft(form) {
  const fields = Object.fromEntries(new FormData(form).entries());
  const organization = fields.organization.trim() || "Our organization";
  const attendance = Number(fields.attendance) || 0;
  const total = Number(fields.total) || 0;
  const requested = Number(fields.requested) || 0;
  const draft = `Draft funding narrative\n\n${organization} requests ${money(requested)} from ${fields.source} to support ${fields.event}, planned for ${fields.date || "the proposed date"} at ${fields.location.trim() || "the proposed location"}.\n\nPurpose and student benefit\n${fields.purpose.trim()}\n\nAudience and reach\nThe program is intended for ${fields.audience.trim() || "GW students"} and is expected to serve approximately ${attendance} participants. Explain how it advances the organization's mission.\n\nBudget justification\nThe total estimated cost is ${money(total)}. Attach an itemized budget and vendor quotes when available. Explain each expense and identify any other funding sources.\n\nAccessibility and inclusion\n${fields.accessibility.trim() || "The organization will review accessibility, dietary, communication, and participation needs."}\n\nConfirm eligibility, deadlines, allowable costs, and the current submission process before applying. This draft does not imply approval.`;
  const target = $("#draft-result");
  target.replaceChildren();
  if (requested > total) target.append(node("p", "", "Check the amounts: requested funding exceeds the total estimated cost."));
  target.append(node("div", "draft-text", draft));
  const copy = node("button", "copy-button", "Copy draft");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(draft); copy.textContent = "Copied"; }
    catch { copy.textContent = "Select the draft text to copy"; }
  });
  target.append(copy);
}

async function loadEvents() {
  try {
    const response = await fetch("/api/events", { cache: "no-store" });
    if (!response.ok) throw new Error("feed unavailable");
    const payload = await response.json();
    if (!Array.isArray(payload.events)) throw new Error("invalid feed");
    state.events = payload.events;
    state.eventSource = "live";
    state.eventFetchedAt = payload.fetchedAt;
    state.feedLimit = payload.feedLimit || 60;
    state.feedDays = payload.feedDays || 60;
    $("#event-status").textContent = `Public events: live feed checked ${shortDate(payload.fetchedAt)}`;
  } catch {
    state.events = state.data.events || [];
    state.eventSource = "snapshot";
    state.eventFetchedAt = state.data.eventsFetchedAt;
    state.feedLimit = state.data.eventFeedLimit || 60;
    state.feedDays = state.data.eventFeedDays || 60;
    $("#event-status").textContent = `Public events: saved snapshot from ${shortDate(state.eventFetchedAt)}`;
  }
  renderEvents();
  renderGroups();
  if (state.lastQuestion) ask(state.lastQuestion);
}

async function init() {
  try {
    const response = await fetch("/data.json");
    if (!response.ok) throw new Error("data unavailable");
    state.data = await response.json();
  } catch {
    $("#group-status").textContent = "Directory unavailable";
    $("#event-status").textContent = "Please try again later";
    $("#ask-results").replaceChildren(node("p", "empty-state", "The public guidance data could not be loaded."));
    if (budgetTouched) $("#budget-result").textContent = "Planning assumptions are unavailable. Please try again later.";
    return;
  }
  $("#group-status").textContent = `${state.data.groups.length.toLocaleString()} public organizations · snapshot ${shortDate(state.data.groupsFetchedAt)}`;
  state.events = state.data.events || [];
  state.eventSource = "snapshot";
  state.eventFetchedAt = state.data.eventsFetchedAt;
  state.feedLimit = state.data.eventFeedLimit || 60;
  state.feedDays = state.data.eventFeedDays || 60;
  renderGroups();
  renderEvents();
  renderGuidance();
  if (budgetTouched) estimateBudget($("#budget-form"));
  loadEvents();
}

$("#group-search").addEventListener("input", renderGroups);
$("#event-search").addEventListener("input", renderEvents);
for (const id of ["event-date", "event-start", "event-end", "event-food"]) $(`#${id}`).addEventListener("change", renderEvents);
$("#event-reset").addEventListener("click", () => {
  for (const id of ["event-search", "event-date", "event-start", "event-end"]) $(`#${id}`).value = "";
  $("#event-food").checked = false;
  renderEvents();
});
$("#deadline-search").addEventListener("input", renderDeadlines);
$("#ask-form").addEventListener("submit", (event) => { event.preventDefault(); ask($("#ask-input").value.trim()); });
document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => { $("#ask-input").value = button.dataset.question; ask(button.dataset.question); }));
let budgetTouched = false;
$("#budget-form").addEventListener("submit", (event) => { event.preventDefault(); budgetTouched = true; if (state.data) estimateBudget(event.currentTarget); else $("#budget-result").textContent = "Loading planning assumptions…"; });
$("#budget-form").addEventListener("input", (event) => { if (event.target.name === "food") syncFoodWorkspace(); if (budgetTouched && state.data) estimateBudget(event.currentTarget); });
$("#budget-form").addEventListener("change", (event) => { if (event.target.name === "food") syncFoodWorkspace(); if (budgetTouched && state.data) estimateBudget(event.currentTarget); });
syncFoodWorkspace();
$("#draft-form").addEventListener("submit", (event) => { event.preventDefault(); makeDraft(event.currentTarget); });
init();
