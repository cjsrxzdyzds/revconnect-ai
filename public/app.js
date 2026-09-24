const $ = (selector) => document.querySelector(selector);
const state = { data: null, events: [], eventSource: "", eventFetchedAt: "" };
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
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

function normalize(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const stop = new Set("a an and are at be can do for from how i in is it me my of on or our should the to we what when where who with you your this that".split(" "));
function words(value) {
  return [...new Set(normalize(value).split(/\s+/).filter((word) => word && !stop.has(word)).map((word) => word.replace(/(ments|ment|ings|ing|ed|es|s)$/, "")))];
}

function score(query, title, keywords = "", body = "") {
  const tokens = words(query);
  if (!tokens.length) return 0;
  const titleText = words(title);
  const keywordText = words(keywords);
  const bodyText = words(body);
  let points = 0;
  for (const token of tokens) {
    if (titleText.some((word) => word === token)) points += 5;
    else if (titleText.some((word) => word.startsWith(token) && token.length > 3)) points += 3;
    if (keywordText.some((word) => word === token)) points += 2;
    if (bodyText.some((word) => word === token)) points += 1;
  }
  if (normalize(title).includes(normalize(query))) points += 8;
  return points;
}

function trim(value, length = 300) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

function eventTime(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : null;
}

function currentEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return state.events.filter((event) => {
    const date = eventTime(event.date);
    return date && date >= today;
  }).sort((a, b) => eventTime(a.date) - eventTime(b.date));
}

function renderGroups() {
  if (!state.data) return;
  const query = $("#group-search").value.trim();
  const starterNames = new Set(state.data.starterGroups.map((group) => group.org_name.toLowerCase()));
  const matches = state.data.groups
    .map((group) => ({ ...group, rank: query ? score(query, group.name, `${group.category} ${group.keywords}`, group.description) : starterNames.has(group.name.toLowerCase()) ? 1 : 0 }))
    .filter((group) => !query || group.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))
    .slice(0, 10);
  const target = $("#group-results");
  target.replaceChildren();
  if (!matches.length) target.append(node("p", "empty-state", "No matching organizations. Try a broader interest."));
  for (const group of matches) {
    const card = node("article", "listing-card");
    card.append(node("h4", "", group.name));
    if (group.category) card.append(node("span", "tag", trim(group.category, 65)));
    if (group.description) card.append(node("p", "", trim(group.description, 220)));
    card.append(sourceLink(group.url, "Open official group page ↗"));
    target.append(card);
  }
  $("#group-count").textContent = state.data.groups.length.toLocaleString();
  $("#group-note").textContent = `Showing ${matches.length} of ${state.data.groups.length} public organizations. Snapshot: ${shortDate(state.data.groupsFetchedAt)}. Confirm current status on RevConnect.`;
}

function renderEvents() {
  const query = $("#event-search").value.trim();
  const matches = currentEvents()
    .map((event) => ({ ...event, rank: query ? score(query, event.title, `${event.host} ${event.category}`, event.description) : 1 }))
    .filter((event) => !query || event.rank > 0)
    .sort((a, b) => query ? b.rank - a.rank || eventTime(a.date) - eventTime(b.date) : eventTime(a.date) - eventTime(b.date))
    .slice(0, 10);
  const target = $("#event-results");
  target.replaceChildren();
  if (!matches.length) target.append(node("p", "empty-state", "No matching upcoming public events in this feed. Browse RevConnect for the full calendar."));
  for (const event of matches) {
    const card = node("article", "listing-card");
    const date = eventTime(event.date);
    if (date) {
      const tile = node("div", "date-tile");
      tile.append(node("small", "", new Intl.DateTimeFormat("en-US", { month: "short" }).format(date).toUpperCase()), node("strong", "", String(date.getDate())));
      card.append(tile);
    }
    card.append(node("h4", "", event.title));
    card.append(node("div", "meta-line", [event.host, event.time, event.location].filter(Boolean).join(" · ")));
    if (event.description) card.append(node("p", "", trim(event.description, 130)));
    card.append(sourceLink(event.url, "See event on RevConnect ↗"));
    target.append(card);
  }
  $("#event-count").textContent = String(currentEvents().length);
  $("#event-note").textContent = `${state.eventSource === "live" ? "Live public feed" : "Saved public snapshot"}, checked ${shortDate(state.eventFetchedAt)}. Showing the nearest 60 feed items; confirm time and registration on RevConnect.`;
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

function ask(question) {
  if (!state.data) return;
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
  const target = $("#ask-results");
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

function amount(form, key) {
  const value = Number(new FormData(form).get(key));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function resultRow(label, value, extraClass = "") {
  const row = node("div", `money-row ${extraClass}`);
  row.append(node("span", "", label), node("strong", "", money(value)));
  return row;
}

function estimateBudget(form) {
  const attendees = amount(form, "attendees");
  const food = new FormData(form).get("food");
  const assumption = state.data.budgetAssumptions.find((row) => row.item.startsWith(food === "meal" ? "Meal" : "Snacks"));
  const foodRates = food === "none" ? [0, 0, 0] : [Number(assumption.low), Number(assumption.typical), Number(assumption.high)];
  const supplies = attendees * amount(form, "supplies");
  const fixed = ["marketing", "venue", "speaker", "avTravel", "other"].reduce((sum, key) => sum + amount(form, key), 0);
  const factor = 1 + amount(form, "contingency") / 100;
  const totals = foodRates.map((rate) => (attendees * rate + supplies + fixed) * factor);
  const target = $("#budget-result");
  target.replaceChildren(node("strong", "", "Planning range"), resultRow("Low estimate", totals[0]), resultRow("Typical estimate", totals[1], "money-total"), resultRow("High estimate", totals[2]));
  target.append(node("p", "panel-note", `Includes ${money(supplies)} in supplies, ${money(fixed)} in other entered costs, and ${amount(form, "contingency")}% contingency. Food rates use the bundled planning assumptions. These are not quotes or funding approvals.`));
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
    $("#event-status").textContent = `Public events: live feed checked ${shortDate(payload.fetchedAt)}`;
  } catch {
    state.events = state.data.events || [];
    state.eventSource = "snapshot";
    state.eventFetchedAt = state.data.eventsFetchedAt;
    $("#event-status").textContent = `Public events: saved snapshot from ${shortDate(state.eventFetchedAt)}`;
  }
  renderEvents();
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
    return;
  }
  $("#group-status").textContent = `${state.data.groups.length.toLocaleString()} public organizations · snapshot ${shortDate(state.data.groupsFetchedAt)}`;
  state.events = state.data.events || [];
  state.eventSource = "snapshot";
  state.eventFetchedAt = state.data.eventsFetchedAt;
  renderGroups();
  renderEvents();
  renderGuidance();
  loadEvents();
}

$("#group-search").addEventListener("input", renderGroups);
$("#event-search").addEventListener("input", renderEvents);
$("#deadline-search").addEventListener("input", renderDeadlines);
$("#ask-form").addEventListener("submit", (event) => { event.preventDefault(); ask($("#ask-input").value.trim()); });
document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => { $("#ask-input").value = button.dataset.question; ask(button.dataset.question); }));
$("#budget-form").addEventListener("submit", (event) => { event.preventDefault(); if (state.data) estimateBudget(event.currentTarget); });
$("#draft-form").addEventListener("submit", (event) => { event.preventDefault(); makeDraft(event.currentTarget); });
init();
