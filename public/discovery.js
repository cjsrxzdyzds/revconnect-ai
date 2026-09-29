// Public-record discovery. Parsed constraints and evidence are shown to the user.
// No model, account data, or inferred registration eligibility is used.
const DAY = 86400000;
const ZONE = "America/New_York";
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const topics = [
  { name: "AI / computing", query: /\b(ai|artificial intelligence|machine learning|coding|computer|computing|programming)\b/i, terms: ["artificial intelligence", "machine learning", "ai", "computing", "computer", "coding", "programming", "software", "robotics", "data science"] },
  { name: "Consulting", query: /\bconsult(?:ing|ants?|ancy)?\b/i, terms: ["consulting", "consultant", "consultancy"] },
  { name: "Culture", query: /\bcultur(?:e|al)\b/i, terms: ["cultural", "culture", "mid-autumn", "heritage"] },
  { name: "Service", query: /\b(volunteer(?:ing)?|service|community service)\b/i, terms: ["volunteer", "service", "civic engagement"] },
  { name: "Arts", query: /\b(art|arts|music|dance|theat(?:er|re))\b/i, terms: ["arts", "art", "music", "dance", "theater", "theatre", "performance"] },
  { name: "Sports", query: /\b(sports?|fitness|athletic|exercise)\b/i, terms: ["sports", "athletic", "fitness", "exercise", "soccer", "basketball", "volleyball"] },
  { name: "Career", query: /\b(career|professional|resume|networking)\b/i, terms: ["career", "professional", "resume", "networking", "corporate presentation"] },
  { name: "Social", query: /\b(social|friends?|meet people)\b/i, terms: ["social", "community", "friends"] },
];

const filler = new Set("a an and are at be by can do for from how i in is it me my of on or our should the to we what when where who with you your this that find show want interested interest interests like suitable recommend recommendation recommendations group groups club clubs organization organizations student students event events activity activities upcoming happening friday monday tuesday wednesday thursday saturday sunday today tomorrow weekend week next free food provided pm am after before between until available have time only some no please campus near soon both also join try which attend start end with without beginner beginners minutes hour hours spend prefer would all tell about looking related admission entry".split(" "));
export function isEnglishQuery(query) {
  return /^[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Symbol}\p{Mark}\s]*$/u.test(query);
}
function folded(value) { return String(value || "").normalize("NFKC").toLowerCase(); }
function termIn(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

export function dateNumber(value) {
  const text = String(value || "");
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/);
  if (!iso && !us) return null;
  const [y, m, d] = iso ? iso.slice(1).map(Number) : [Number(us[3]), Number(us[1]), Number(us[2])];
  const n = Date.UTC(y, m - 1, d);
  const check = new Date(n);
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? n : null;
}

function campusNow(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
}
export function clockMinutes(value, meridiem = "") {
  const match = folded(value).match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const suffix = match[3] || meridiem;
  if (minute > 59 || hour > (suffix ? 12 : 23) || (suffix && hour === 0)) return null;
  if (suffix) hour = hour % 12 + (suffix === "pm" ? 12 : 0);
  return hour * 60 + minute;
}
export function formatClock(minutes) {
  if (minutes === null || minutes === undefined) return "";
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}${minutes % 60 ? `:${String(minutes % 60).padStart(2, "0")}` : ""} ${hour >= 12 ? "PM" : "AM"}`;
}
export function formatDate(value) {
  const date = typeof value === "number" ? value : dateNumber(value);
  return date === null ? "Date unknown" : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(date));
}

export function eventInterval(event) {
  const date = dateNumber(event.date);
  const endDate = dateNumber(event.endDate);
  const time = clockMinutes(event.time);
  const endTime = clockMinutes(event.endTime);
  return { date, time, endTime, start: date !== null && time !== null ? date + time * 60000 : null, end: endDate !== null && endTime !== null ? endDate + endTime * 60000 : null };
}
export function upcomingEvents(events, now = new Date()) {
  const current = campusNow(now);
  return events.filter((event) => {
    const interval = eventInterval(event);
    return interval.start !== null ? interval.start >= current : interval.date !== null && interval.date >= Math.floor(current / DAY) * DAY;
  }).sort((a, b) => (eventInterval(a).start ?? dateNumber(a.date)) - (eventInterval(b).start ?? dateNumber(b.date)));
}

export function parseDiscoveryQuery(query, overrides = {}, now = new Date()) {
  const text = folded(query).replace(/[–—]/g, "-");
  const result = { query, topics: topics.filter((topic) => topic.query.test(text)), terms: [], dateFrom: null, dateTo: null, start: null, end: null, food: /\b(food|meal|snacks?|refreshments?)\b/.test(text), free: /\bfree\b/.test(text), online: /\bonline\b/.test(text), labels: [], warnings: [], invalid: false };
  if (!isEnglishQuery(query)) {
    result.invalid = true;
    result.warnings.push("Please enter your question in English.");
    return result;
  }
  if (/\b(?:i(?:'m| am)|we(?:'re| are)) free\b|\bfree time\b/.test(text)) result.free = false;
  if (/\b(?:no|without) (?:food|meals?|snacks?)\b/.test(text)) {
    result.food = false; result.invalid = true;
    result.warnings.push("The food flag cannot verify a no-food requirement. Remove it to explore events.");
  }
  const current = campusNow(now);
  const today = Math.floor(current / DAY) * DAY;
  const weekday = new Date(today).getUTCDay();
  const dates = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  if (dates.length) {
    result.dateFrom = dateNumber(dates[0]); result.dateTo = dateNumber(dates[1] || dates[0]);
    if (result.dateFrom === null || result.dateTo === null) result.invalid = true;
  } else if (/\btomorrow\b/.test(text)) {
    result.dateFrom = result.dateTo = today + DAY;
  } else if (/\btoday\b/.test(text)) {
    result.dateFrom = result.dateTo = today;
  } else if (/\bweekend\b/.test(text)) {
    result.dateFrom = weekday === 0 ? today : today + ((6 - weekday + 7) % 7) * DAY;
    result.dateTo = result.dateFrom + (weekday === 0 ? 0 : DAY);
  } else {
    const day = weekdays.findIndex((name) => new RegExp(`\\b${name.toLowerCase()}\\b`).test(text));
    const nextWeek = /\bnext\b/.test(text);
    const thisWeek = /\bthis week\b|\bthis (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text);
    const monday = today - ((weekday + 6) % 7) * DAY;
    if (day >= 0) {
      const date = nextWeek || thisWeek ? monday + (nextWeek ? 7 : 0) * DAY + ((day + 6) % 7) * DAY : today + ((day - weekday + 7) % 7) * DAY;
      result.dateFrom = result.dateTo = date;
    } else if (nextWeek || thisWeek) {
      result.dateFrom = monday + (nextWeek ? 7 : 0) * DAY;
      result.dateTo = result.dateFrom + 6 * DAY;
    }
  }

  const range = text.match(/(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:-|to|until)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)\b/) || text.match(/\b(\d{1,2}:\d{2})\s*(am|pm)?\s*(?:-|to|until)\s*(\d{1,2}:\d{2})\s*(am|pm)?\b/);
  if (range) {
    result.start = clockMinutes(range[1], range[2] || range[4] || ""); result.end = clockMinutes(range[3], range[4] || range[2] || "");
    // "11-1pm" is the conventional 11am-1pm window; explicit suffixes stay authoritative.
    if (!range[2] && range[4] === "pm" && result.start > result.end) result.start -= 720;
  } else {
    const bound = text.match(/\b(after|before)\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)\b/);
    if (bound) result[bound[1] === "after" ? "start" : "end"] = clockMinutes(bound[2], bound[3]);
    else if (/(?:\d\s*-\s*\d|\b(?:after|before)\s+\d)/.test(text) && !dates.length) {
      result.warnings.push("Use AM/PM or 24-hour HH:MM for the time window (for example, 5-7pm)."); result.invalid = true;
    }
  }
  if (range && (result.start === null || result.end === null)) result.invalid = true;
  if (overrides.date) {
    result.dateFrom = result.dateTo = dateNumber(overrides.date);
    if (result.dateFrom === null) result.invalid = true;
  }
  if (overrides.start) result.start = clockMinutes(overrides.start);
  if (overrides.end) result.end = clockMinutes(overrides.end);
  if (overrides.food) result.food = true;
  if (result.dateFrom !== null && result.dateTo < result.dateFrom) result.invalid = true;
  if (result.start !== null && result.end !== null && result.end <= result.start) result.invalid = true;
  if (result.invalid) result.warnings.push("Check the date and time window. End must be later than start on the same day.");
  const topicWords = new Set(result.topics.flatMap((topic) => topic.terms.flatMap((term) => term.split(/[\s-]+/))));
  result.terms = [...new Set(text.replace(/\d{4}-\d{2}-\d{2}/g, " ").match(/[a-z][a-z-]*/g) || [])].filter((word) => word.length > 1 && !filler.has(word) && !topicWords.has(word));
  if (result.dateFrom !== null) result.labels.push(result.dateFrom === result.dateTo ? formatDate(result.dateFrom) : `${formatDate(result.dateFrom)} – ${formatDate(result.dateTo)}`);
  if (result.start !== null || result.end !== null) result.labels.push(`${result.start === null ? "Any start" : `From ${formatClock(result.start)}`} · ${result.end === null ? "Any end" : `finish by ${formatClock(result.end)}`} (GW time)`);
  result.labels.push(...result.topics.map((topic) => topic.name));
  if (result.food) result.labels.push("Host marks food provided");
  if (result.free) result.labels.push("Description explicitly mentions free entry");
  if (result.online) result.labels.push("Online");
  if (/\b(beginner|beginners|new student)\b/.test(text)) result.warnings.push("Beginner eligibility is not verified by this feed. Check the official page.");
  if (/\bfree\s+(food|meal|snacks)\b/.test(text)) {
    result.warnings.push("Food provided does not confirm free food. This feed cannot verify that request."); result.invalid = true;
  }
  return result;
}

function matchEvidence(record, parsed, isGroup) {
  const title = folded(isGroup ? record.name : record.title);
  const category = folded(record.category);
  const description = folded(record.description);
  const other = folded(isGroup ? record.keywords : record.host);
  const evidence = [];
  let points = 0;
  for (const topic of parsed.topics) {
    const term = topic.terms.find((term) => termIn(title, term)) || topic.terms.find((term) => termIn(category, term)) || topic.terms.find((term) => termIn(description, term));
    if (term) {
      const field = termIn(title, term) ? "name" : termIn(category, term) ? "category" : "description";
      points += field === "name" ? 8 : field === "category" ? 5 : 3;
      evidence.push(`${topic.name}: “${term}” in the published ${field}`);
    }
  }
  if (parsed.topics.length && !points) return { points: 0, evidence: [], hasInterest: true };
  for (const word of parsed.terms) {
    if (termIn(`${title} ${category} ${description} ${other}`, word)) {
      points += termIn(title, word) ? 5 : 1;
      evidence.push(`Published listing mentions “${word}”`);
    }
  }
  return { points, evidence, hasInterest: parsed.topics.length > 0 || parsed.terms.length > 0 };
}

export function foodStatus(event) {
  if ([true, "1", "true"].includes(event.foodProvided)) return "Food marked as provided; cost and dietary options are unconfirmed.";
  if ([false, "0", "false"].includes(event.foodProvided)) return "Host has not marked food as provided.";
  return "Food information is not available in this record.";
}
export function costEvidence(event) {
  const text = event.description || "";
  const free = /\bfree\s+(?:entry|entrance|admission)\b|\b(?:entry|entrance|admission|event)\s+(?:is\s+)?free\b/i.test(text) && !/\b(?:not|no)\s+free\s+(?:entry|entrance|admission)/i.test(text);
  const amounts = [...new Set(text.match(/\$\s*\d+(?:\.\d{1,2})?/g) || [])];
  const excerpt = (text.match(/[^.!?]{0,100}\$\s*\d+(?:\.\d{1,2})?[^.!?]{0,100}/) || [""])[0].trim();
  return { free, label: free ? amounts.length ? `Description says free entry and also lists ${amounts.join(", ")}. Check what each option includes.` : "Description says free entry. Check current ticket options." : amounts.length ? `Description lists ${amounts.join(", ")}. Check what each option includes.` : "Price is not confirmed by this feed.", amounts, excerpt };
}
export function eventNotes(event) {
  const notes = [];
  const interval = eventInterval(event);
  const pattern = /(?:date\s*(?:&|and)\s*time|start(?:s|ing)?(?:\s+(?:at|time))?)\s*[:：]?[^.!?]{0,65}?\b(\d{1,2}(?::\d{2})?)\s*(am|pm)\b/gi;
  for (const match of (event.description || "").matchAll(pattern)) {
    const proseTime = clockMinutes(match[1], match[2].toLowerCase());
    if (proseTime !== interval.time && interval.time !== null) {
      notes.push(`Time conflict: listing starts at ${formatClock(interval.time)}; description mentions ${formatClock(proseTime)}. Confirm with the host.`); break;
    }
  }
  if (interval.end === null) notes.push("End time is missing; availability cannot be fully checked.");
  else if (interval.start !== null && interval.end <= interval.start) notes.push("Published end time is not after start; confirm the schedule.");
  return notes;
}
function gwTime(event) {
  const zone = String(event.timeZone || "");
  if (/America\/New_York|Eastern/i.test(zone)) return true;
  const namedOffset = /\bEDT\b/i.test(zone) ? -4 : /\bEST\b/i.test(zone) ? -5 : null;
  const offset = /^[+-]?\d{1,2}(?:\.\d{1,2})?$/.test(zone) ? Number(zone) : namedOffset;
  const interval = eventInterval(event);
  // GW's RSS uses numeric UTC offsets. Check against the actual event date,
  // so winter (-5) and summer (-4) are never treated as interchangeable.
  return offset !== null && offset >= -12 && offset <= 14 && interval.start !== null && campusNow(new Date(interval.start - offset * 3600000)) === interval.start;
}
export function timeZoneLabel(event) {
  const zone = String(event.timeZone || "");
  const label = /^[+-]?\d{1,2}(?:\.\d{1,2})?$/.test(zone) ? `UTC${Number(zone) >= 0 ? "+" : ""}${Number(zone)}` : zone;
  return gwTime(event) ? `GW time (${label})` : label || "Time zone unconfirmed";
}
export function searchEvents(events, parsed, now = new Date()) {
  if (parsed.invalid) return [];
  return upcomingEvents(events, now).flatMap((event) => {
    const interval = eventInterval(event);
    if (parsed.dateFrom !== null && (interval.date < parsed.dateFrom || interval.date > parsed.dateTo)) return [];
    if ((parsed.start !== null || parsed.end !== null) && (!gwTime(event) || interval.start === null || interval.end === null || interval.end <= interval.start)) return [];
    if (parsed.start !== null && interval.start < interval.date + parsed.start * 60000) return [];
    if (parsed.end !== null && interval.end > interval.date + parsed.end * 60000) return [];
    if (parsed.food && ![true, "1", "true"].includes(event.foodProvided)) return [];
    if (parsed.free && !costEvidence(event).free) return [];
    if (parsed.online && !/online|virtual/i.test(event.locationType || "")) return [];
    const match = matchEvidence(event, parsed, false);
    if (match.hasInterest && !match.points) return [];
    if (parsed.dateFrom !== null) match.evidence.push(`Falls on ${formatDate(interval.date)}`);
    if (parsed.start !== null || parsed.end !== null) match.evidence.push("Published start and end fit your full time window (GW time)");
    if (parsed.food) match.evidence.push("Host checked Food Provided; free food is not confirmed");
    return [{ ...event, rank: match.points, reasons: match.evidence }];
  }).sort((a, b) => b.rank - a.rank || eventInterval(a).start - eventInterval(b).start);
}
export function recommendGroups(groups, events, query, now = new Date()) {
  const parsed = parseDiscoveryQuery(query, {}, now);
  if (parsed.invalid) return [];
  const future = upcomingEvents(events, now);
  return groups.flatMap((group) => {
    const match = matchEvidence(group, parsed, true);
    if (query.trim() && (!match.hasInterest || !match.points)) return [];
    const related = future.filter((event) => group.id && event.groupId ? group.id === event.groupId : folded(group.name) === folded(event.host)).slice(0, 2);
    return [{ ...group, rank: match.points, reasons: match.evidence, related }];
  }).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
}
export function discoveryIntent(query) {
  if (/\b(groups?|clubs?|organizations?)\b/i.test(query)) return "groups";
  if (/\b(events?|activities|today|tomorrow|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(query) && !/\b(create|organize|funding|reimbursement|request|budget)\b/i.test(query)) return "events";
  return "guidance";
}
