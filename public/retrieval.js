import { discoveryIntent, parseDiscoveryQuery, searchEvents, recommendGroups, costEvidence, foodStatus, eventNotes } from './discovery.js';

export const planningSources = [
  {
    type: 'Planning guidance', title: 'Event funding and purchase preparation',
    body: 'GW says purchases require an approved purchase request before spending. Food purchase requests need event marketing information or an attendee list, and caterers need an invoice. Confirm the current process with Org Finance.',
    keywords: 'event funding prepare request catering food quote invoice marketing attendee flyer',
    url: 'https://students.gwu.edu/organization-finances',
  },
  {
    type: 'Campus support', title: 'Org Help event and finance support',
    body: 'Org Help assists with event planning, while Org Finance reviews purchase requests and helps determine the right purchasing method. Confirm the approved route before arranging a transaction.',
    keywords: 'event planning finance purchasing staff support',
    url: 'https://students.gwu.edu/org-advising-support',
  },
  {
    type: 'Funding guidance', title: 'SGA funding pathways overview',
    body: 'SGA describes general allocations, co-sponsorships for on-campus events open to GW students, and the University-Wide Programs Fund for campus-wide events. Select the applicable route and confirm current criteria and deadlines on the official page.',
    keywords: 'event funding prepare apply budget co sponsorship',
    url: 'https://sga.gwu.edu/applying-for-funding',
  },
];

const stop = new Set('a an and are at be can do for from how i in is it me my of on or our should the to we what when where who with you your this that'.split(' '));
function normalize(value) { return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function words(value) { return [...new Set(normalize(value).split(/\s+/).filter(word => word && !stop.has(word)).map(word => word.replace(/(ments|ment|ings|ing|ed|es|s)$/, '')))]; }
export function score(query, title, keywords = '', body = '') {
  const tokens = words(query);
  if (!tokens.length) return 0;
  const titleText = words(title), keywordText = words(keywords), bodyText = words(body);
  let points = 0;
  for (const token of tokens) {
    if (titleText.includes(token)) points += 5;
    else if (titleText.some(word => word.startsWith(token) && token.length > 3)) points += 3;
    if (keywordText.includes(token)) points += 2;
    if (bodyText.includes(token)) points += 1;
  }
  if (normalize(title).includes(normalize(query))) points += 8;
  return points;
}

// Called on the server with trusted public records, never client-supplied context.
export function retrieveSources(data, events, question, now = new Date()) {
  const intent = discoveryIntent(question);
  if (intent === 'events') {
    const parsed = parseDiscoveryQuery(question, {}, now);
    if (parsed.invalid) return [];
    return searchEvents(events, parsed, now).slice(0, 3).map(row => ({ title: row.title, url: row.url, type: 'Public event', body: `${row.date} ${row.time}–${row.endTime || 'unknown end time'}; timezone ${row.timeZone || 'unknown'}. Host: ${row.host}. Location: ${row.location}. ${foodStatus(row)} ${costEvidence(row).label} ${costEvidence(row).excerpt || ''} ${eventNotes(row).join(' ')} ${row.description}` }));
  }
  if (intent === 'groups') return recommendGroups(data.groups, events, question, now).slice(0, 3).map(row => ({ title: row.name, url: row.url, type: 'Organization', body: `${row.description} Match: ${row.reasons.join('; ')}. Membership eligibility is unverified.` }));
  const candidates = [
    ...planningSources,
    ...data.howto.map(row => ({ type: 'CampusGroups how-to', title: row.topic, body: `${row.summary} ${row.steps}`, keywords: row.audience, url: row.source_url })),
    ...data.deadlines.map(row => ({ type: 'Deadline', title: row.topic, body: `${row.deadline}. ${row.timeline}`, keywords: 'timing deadline due submit apply', url: row.source_url })),
    ...data.fundingPrograms.map(row => ({ type: 'Funding', title: row.program, body: `${row.best_for} ${row.timing}`, keywords: 'funding money sga allocation sponsorship', url: row.source_url })),
    ...data.resources.map(row => ({ type: 'Campus support', title: row.resource, body: `${row.description} Contact: ${row.contact}`, keywords: row.keywords, url: row.source_url })),
  ];
  return candidates.map(item => ({ ...item, rank: score(question, item.title, item.keywords, item.body) })).filter(item => item.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 3);
}
