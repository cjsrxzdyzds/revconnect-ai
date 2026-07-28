# This cell is generated from revconnect_ui.py by sync_notebook.py.
# Edit that file, then rerun the script -- do not edit this cell directly.
#
# Presentation layer only. Every answer still comes from the functions defined
# in the cells above; nothing here changes retrieval, routing, or policy logic.

import html
import re
from pathlib import Path

import gradio as gr

# A GW-styled monogram, not the university's trademarked logo. GW's official
# marks are controlled by Communications & Marketing and need approval; swap
# this file for the approved asset once that is granted.
def _find_gw_mark():
    """The notebook runs from the prototype folder locally and from /content in
    Colab, so the asset is looked up in both rather than assumed relative."""
    for base in (Path.cwd(), Path.cwd().parent, Path("/content")):
        candidate = base / "assets" / "gw_monogram.svg"
        if candidate.exists():
            return candidate
    return None


GW_MARK = _find_gw_mark()
GW_MARK_INLINE = (
    '<svg class="rc-mark" viewBox="0 0 64 64" role="img" aria-label="GW" focusable="false">'
    '<rect width="64" height="64" rx="12" fill="#033C5A"/>'
    '<rect y="55" width="64" height="9" fill="#D6BF91"/>'
    '<text x="32" y="42" font-family="Newsreader, Georgia, serif" font-size="30"'
    ' font-weight="600" text-anchor="middle" fill="#FFFFFF">GW</text>'
    '</svg>'
)
LAUNCH_KWARGS = {"favicon_path": str(GW_MARK)} if GW_MARK else {}

# --- Design tokens -----------------------------------------------------------
# GW's published brand palette (communications.gwu.edu/brand-guidelines/color-palette).
# GW Blue and GW Buff are the core pair, drawn from the Continental Army uniform;
# Potomac and Navy Yard are the sanctioned blue accents. Buff is light, so it
# works as a ground, a fill, and a rule on navy -- never as text on white.

GW_BLUE = "#033C5A"      # core
GW_BUFF = "#D6BF91"      # core
GW_BUFF_80 = "#DAC8A3"
GW_BUFF_50 = "#E8DDC6"
GW_BUFF_20 = "#F6F1E8"   # the page ground: warm, unmistakably GW
POTOMAC = "#0075C8"      # interactive blue
POTOMAC_50 = "#7FBAE3"
NAVY_YARD = "#00223E"    # ink, and the dark-mode ground
ROW_HOUSE = "#EF4343"    # secondary accent, used only for critical state
PATINA = "#ADCAB8"       # secondary accent, used only for healthy state

BUFF = gr.themes.Color(
    c50=GW_BUFF_20, c100="#F1E9DA", c200=GW_BUFF_50, c300=GW_BUFF_80,
    c400=GW_BUFF, c500="#C4A970", c600="#A98D55", c700="#856E41",
    c800="#5E4E2E", c900="#3D331E", c950="#221C10",
)
NAVY = gr.themes.Color(
    c50="#E9F3FB", c100="#CCE3F4", c200=POTOMAC_50, c300="#3391D3",
    c400=POTOMAC, c500="#005C9E", c600="#044A76", c700=GW_BLUE,
    c800="#022F47", c900=NAVY_YARD, c950="#001729",
)
# Warm-biased neutrals so the greys sit on the buff ground rather than fighting it.
STONE = gr.themes.Color(
    c50="#FAF8F4", c100="#F2EFE8", c200="#E4DED2", c300="#CFC7B7",
    c400="#A39C8E", c500="#7D7669", c600="#5E6670", c700="#454C55",
    c800="#2C333B", c900="#1A2129", c950="#0C1319",
)

THEME = gr.themes.Base(
    primary_hue=NAVY,
    secondary_hue=BUFF,
    neutral_hue=STONE,
    font=[gr.themes.GoogleFont("Public Sans"), "system-ui", "-apple-system", "sans-serif"],
    font_mono=[gr.themes.GoogleFont("IBM Plex Mono"), "ui-monospace", "monospace"],
).set(
    body_background_fill=GW_BUFF_20,
    body_background_fill_dark="#001729",
    block_background_fill="#FFFFFF",
    block_background_fill_dark="#04283F",
    block_border_width="1px",
    block_border_color="#E4DED2",
    block_border_color_dark="#0B3A5C",
    block_radius="10px",
    block_label_text_weight="600",
    block_title_text_weight="600",
    body_text_color=NAVY_YARD,
    body_text_color_dark="#E8EFF5",
    body_text_color_subdued="#5E6670",
    body_text_color_subdued_dark="#9FB6C6",
    button_primary_background_fill=GW_BLUE,
    button_primary_background_fill_hover=POTOMAC,
    button_primary_background_fill_dark=GW_BUFF,
    button_primary_background_fill_hover_dark=GW_BUFF_80,
    button_primary_text_color="#FFFFFF",
    button_primary_text_color_dark=NAVY_YARD,
    button_large_radius="8px",
    button_small_radius="8px",
    input_background_fill="#FFFFFF",
    input_background_fill_dark="#012134",
    input_border_color="#E4DED2",
    input_border_color_dark="#0B3A5C",
    input_radius="8px",
)

# Gradio's theme only fetches the faces named in `font`/`font_mono`. Newsreader
# is used by the CSS below, so it has to be requested explicitly or it silently
# falls back to Georgia.
HEAD = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2'
    '?family=Newsreader:opsz,wght@6..72,500;6..72,600'
    '&amp;family=Public+Sans:wght@400;500;600;700'
    '&amp;family=IBM+Plex+Mono:wght@400;500&amp;display=swap">'
)

CSS = """
/* Only classes this file owns are styled here; the rest comes from the theme
   tokens above, so the design does not depend on Gradio's internal classes. */
:root {
  --rc-blue: #033C5A;        /* GW Blue */
  --rc-link: #0075C8;        /* Potomac */
  --rc-buff: #D6BF91;        /* GW Buff */
  --rc-ink: #00223E;         /* Navy Yard */
  --rc-muted: #5E6670;
  --rc-surface: #FFFFFF;
  --rc-border: #E4DED2;
  /* Semantic state, kept distinct from the core pair. Derived from GW's own
     secondary accents but darkened to hold contrast as text. */
  --rc-ok: #2F6B4F;   --rc-ok-bg: #EAF2ED;    /* Patina family */
  --rc-warn: #8A6D1F; --rc-warn-bg: #FFF8DC;  /* Parchment family */
  --rc-crit: #B02F2F; --rc-crit-bg: #FCEAEA;  /* Row House family */
  --rc-tag-bg: #F1E9DA; --rc-tag-fg: #6E5A33;   /* Buff tint for category tags */
}
/* Gradio stamps .dark on the wrapper for both the OS preference and its own
   toggle, so one signal covers both directions. */
.dark {
  --rc-blue: #7FBAE3;        /* Potomac 50% */
  --rc-link: #7FBAE3;
  --rc-buff: #D6BF91;
  --rc-ink: #E8EFF5;
  --rc-muted: #9FB6C6;
  --rc-surface: #04283F;
  --rc-border: #0B3A5C;
  --rc-ok: #ADCAB8;   --rc-ok-bg: #0C2E22;
  --rc-warn: #FFEFAE; --rc-warn-bg: #2E2814;
  --rc-crit: #EF4343; --rc-crit-bg: #331A1A;
  --rc-tag-bg: #0B3A5C; --rc-tag-fg: #DAC8A3;
}

/* fill_width is off, but Gradio still stretches the container on wide screens;
   the auto margins are what actually centre it. */
.gradio-container {
  max-width: 1180px !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

/* Masthead ---------------------------------------------------------------- */
.rc-masthead {
  background: linear-gradient(180deg, #033C5A 0%, #00223E 100%); /* GW Blue -> Navy Yard */
  border-radius: 12px;
  padding: 22px 26px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 3px solid #D6BF91; /* GW Buff rule */
}
.rc-masthead__lockup { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
.rc-mark { width: 46px; height: 46px; flex: none; border-radius: 10px; margin-top: 2px; }
.rc-masthead__id { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.rc-eyebrow {
  font-size: 11px; font-weight: 600; letter-spacing: 0.09em;
  text-transform: uppercase; color: #D6BF91;
}
.rc-wordmark {
  font-family: Newsreader, Georgia, "Times New Roman", serif;
  font-size: 32px; font-weight: 600; line-height: 1.05; color: #FFFFFF;
  margin: 0; text-wrap: balance;
}
.rc-tagline { font-size: 14px; color: #CCE3F4; margin: 0; max-width: 62ch; } /* Potomac 20% */

/* Status chip ------------------------------------------------------------- */
.rc-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 13px; border-radius: 999px;
  font-size: 12.5px; font-weight: 600; letter-spacing: 0.01em;
  border: 1px solid transparent; white-space: nowrap;
}
.rc-chip__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.rc-chip--ok   { background: var(--rc-ok-bg);   color: var(--rc-ok);   border-color: var(--rc-ok); }
.rc-chip--warn { background: var(--rc-warn-bg); color: var(--rc-warn); border-color: var(--rc-warn); }
.rc-chip--ok   .rc-chip__dot { background: var(--rc-ok); }
.rc-chip--warn .rc-chip__dot { background: var(--rc-warn); }
.rc-chip--proto {
  background: rgba(214,191,145,0.16); color: #E8DDC6; border-color: rgba(214,191,145,0.55);
}

/* Section headings -------------------------------------------------------- */
.rc-section h2 {
  font-family: Newsreader, Georgia, serif;
  font-size: 21px; font-weight: 600; color: var(--rc-ink);
  margin: 4px 0 3px; text-wrap: balance;
}
.rc-section p { font-size: 14px; color: var(--rc-muted); margin: 0; max-width: 68ch; }

/* Stat tiles -------------------------------------------------------------- */
.rc-tiles { display: flex; flex-wrap: wrap; gap: 10px; margin: 2px 0 6px; }
.rc-tile {
  flex: 1 1 130px; background: var(--rc-surface); border: 1px solid var(--rc-border);
  border-radius: 10px; padding: 12px 14px;
}
.rc-tile__label {
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--rc-muted); margin-bottom: 5px;
}
.rc-tile__value {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 22px; font-weight: 500; color: var(--rc-ink); line-height: 1.15;
}
.rc-tile__value--sm { font-size: 13px; }

/* Result tables ----------------------------------------------------------- */
/* Organization cards ------------------------------------------------------ */
.rc-cards {
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  /* Most live records have no mission text, so let cards hug their content
     instead of stretching to the tallest in the row. */
  align-items: start;
}
.rc-card {
  display: flex; flex-direction: column; gap: 8px;
  background: var(--rc-surface); border: 1px solid var(--rc-border);
  border-radius: 10px; padding: 14px 16px;
}
.rc-card__name { font-size: 15px; font-weight: 600; margin: 0; line-height: 1.3; }
.rc-card__name, .rc-card__name a { color: var(--rc-ink); text-decoration: none; }
.rc-card__name a:hover { color: var(--rc-link); text-decoration: underline; }
.rc-card__desc {
  font-size: 13px; color: var(--rc-muted); line-height: 1.5; margin: 0;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden;
}
.rc-card__foot { margin-top: auto; padding-top: 2px; }
.rc-card__link { font-size: 12.5px; font-weight: 600; color: var(--rc-link); text-decoration: none; }
.rc-card__link:hover { text-decoration: underline; }
.rc-card__nolink { font-size: 12.5px; color: var(--rc-muted); }
.rc-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.rc-tag {
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  background: var(--rc-tag-bg); color: var(--rc-tag-fg);
  border-radius: 4px; padding: 3px 7px; white-space: nowrap;
}

/* Event list -------------------------------------------------------------- */
.rc-events { display: flex; flex-direction: column; gap: 9px; }
.rc-event {
  display: flex; align-items: stretch; gap: 14px;
  background: var(--rc-surface); border: 1px solid var(--rc-border);
  border-radius: 10px; padding: 12px 16px;
}
.rc-event__date {
  flex: none; width: 52px; text-align: center;
  border-right: 1px solid var(--rc-border); padding-right: 12px;
  display: flex; flex-direction: column; justify-content: center;
}
.rc-event__mon {
  font-size: 10px; font-weight: 700; letter-spacing: 0.09em; color: var(--rc-blue);
}
.rc-event__day {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 21px; font-weight: 500; color: var(--rc-ink); line-height: 1.1;
}
.rc-event__body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.rc-event__title { font-size: 14.5px; font-weight: 600; margin: 0; line-height: 1.35; }
.rc-event__title, .rc-event__title a { color: var(--rc-ink); text-decoration: none; }
.rc-event__title a:hover { color: var(--rc-link); text-decoration: underline; }
.rc-event__meta { font-size: 12.5px; color: var(--rc-muted); }
.rc-event__where { font-size: 12px; }
.rc-empty {
  font-size: 13.5px; color: var(--rc-muted); font-style: italic;
  padding: 18px; border: 1px dashed var(--rc-border); border-radius: 10px; margin: 0;
}

/* Gradio's own footer badge is the one remaining non-GW mark. */
footer a[href*="gradio.app"] { display: none !important; }

/* Answer surface ---------------------------------------------------------- */
.rc-answer { min-height: 150px; }
.rc-answer p { line-height: 1.62; }
.rc-answer ol, .rc-answer ul { line-height: 1.62; }
.rc-answer a { color: var(--rc-link); text-underline-offset: 2px; }
.rc-answer blockquote {
  border-left: 3px solid var(--rc-warn); background: var(--rc-warn-bg);
  padding: 10px 14px; margin: 14px 0; border-radius: 0 8px 8px 0;
  color: var(--rc-ink); font-size: 14px;
}
.rc-answer .rc-placeholder { color: var(--rc-muted); font-style: italic; }
.rc-answer pre, .rc-answer table { overflow-x: auto; }

/* Footer ------------------------------------------------------------------ */
.rc-footer {
  border-top: 1px solid var(--rc-border); margin-top: 20px; padding-top: 14px;
  font-size: 12.5px; color: var(--rc-muted); line-height: 1.55;
}
.rc-footer strong { color: var(--rc-ink); }

*:focus-visible { outline: 2px solid var(--rc-buff); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
@media (max-width: 700px) {
  .rc-wordmark { font-size: 26px; }
  .rc-masthead { padding: 18px; }
}
"""

# --- Presentation helpers ----------------------------------------------------

_URL_RE = re.compile(r"(?<![(<\"'])\bhttps?://[^\s<>\"')\]]+")

# Sentences the answer pipeline appends when a question needs staff sign-off or
# touches legacy platform wording. Surfaced as callouts so the safety behaviour
# is visible rather than buried in a wall of text.
_CALLOUT_PREFIXES = (
    "Confirm this with Org Help",
    "Note: a retrieved handbook passage refers to Engage",
)


def rc_markdown(text: str) -> str:
    """Render a plain-text answer as Markdown: live links, kept line breaks."""
    text = str(text or "").strip()
    if not text:
        return '<p class="rc-placeholder">Ask a question to see an answer here.</p>'

    blocks = []
    for block in re.split(r"\n\s*\n", text):
        block = block.strip()
        if not block:
            continue
        linked = _URL_RE.sub(lambda m: f"[{m.group(0)}]({m.group(0)})", block)
        if block.startswith(_CALLOUT_PREFIXES):
            blocks.append("> " + linked.replace("\n", "\n> "))
        else:
            # Two trailing spaces keeps single newlines as line breaks.
            blocks.append(linked.replace("\n", "  \n"))
    return "\n\n".join(blocks)


def rc_answer(question: str) -> str:
    return rc_markdown(answer_question(question))


def rc_deadline(question: str) -> str:
    return rc_markdown(deadline_answer(question))


def rc_funding_path(*args) -> str:
    return rc_markdown(funding_path_advisor(*args))


def rc_budget(*args) -> str:
    return rc_markdown(estimate_event_budget(*args))


def rc_application(*args) -> str:
    return rc_markdown(funding_application_draft(*args))


_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
           "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def _empty(message: str) -> str:
    return f'<p class="rc-empty">{html.escape(message)}</p>'


def _chips(value: str) -> str:
    """Categories arrive as 'Undergrad / Grad, Arts / Performance' -- split on
    the comma so each facet reads as its own tag."""
    parts = [p.strip() for p in str(value or "").split(",") if p.strip()]
    return "".join(f'<span class="rc-tag">{html.escape(p)}</span>' for p in parts[:3])


def _link(url: str, label: str) -> str:
    if not url:
        return '<span class="rc-card__nolink">No CampusGroups link</span>'
    return f'<a class="rc-card__link" href="{html.escape(url)}" target="_blank" rel="noopener">{label}</a>'


def rc_org_cards(query: str) -> str:
    """Organizations as cards. A dataframe of long names, category strings, and
    URLs reads like a spreadsheet export; cards let the name lead."""
    rows = recommend_organizations(query or "student organizations", top_k=12)
    if not rows:
        return _empty("No matching organizations. Try a broader interest.")
    cards = []
    for row in rows:
        raw_name = str(row.get("org_name", ""))
        name = html.escape(raw_name)
        url = str(row.get("source_url", "") or "")
        heading = f'<a href="{html.escape(url)}" target="_blank" rel="noopener">{name}</a>' if url else name

        # Records with no mission text get a synthesised description upstream
        # ("<name> is a GW <type> in the <category> category."), which only
        # repeats the heading and the tags. Drop it rather than pad the card.
        description = str(row.get("description", "") or "").strip()
        if description.startswith(f"{raw_name} is a GW"):
            description = ""
        body = f'<p class="rc-card__desc">{html.escape(description[:210])}</p>' if description else ""

        cards.append(
            '<article class="rc-card">'
            f'<h3 class="rc-card__name">{heading}</h3>'
            f'<div class="rc-tags">{_chips(row.get("category", ""))}</div>'
            f'{body}'
            f'<div class="rc-card__foot">{_link(url, "View on CampusGroups &rarr;")}</div>'
            '</article>'
        )
    return f'<div class="rc-cards">{"".join(cards)}</div>'


def _date_key(raw: str):
    """Sort key from M/D/YYYY. Undated rows sort last rather than first."""
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", str(raw or "").strip())
    if not match:
        return (1, 0, 0, 0)
    month, day, year = (int(g) for g in match.groups())
    return (0, year, month, day)


def _date_block(raw: str) -> str:
    """M/D/YYYY -> a stacked month/day block; falls back to the raw string."""
    text = str(raw or "").strip()
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", text)
    if not match:
        return f'<div class="rc-event__date"><div class="rc-event__day">--</div></div>'
    month, day, _ = (int(g) for g in match.groups())
    label = _MONTHS[month - 1] if 1 <= month <= 12 else ""
    return (
        '<div class="rc-event__date">'
        f'<div class="rc-event__mon">{label}</div>'
        f'<div class="rc-event__day">{day}</div>'
        '</div>'
    )


def rc_event_cards(query: str) -> str:
    rows = recommend_events(query or "upcoming public events", top_k=12)
    if not rows:
        return _empty("No matching upcoming events in the current feed.")
    # Relevance decides which events appear; a calendar should then read in
    # date order, not score order.
    rows = sorted(rows, key=lambda r: _date_key(r.get("event_date", "")))
    items = []
    for row in rows:
        title = html.escape(str(row.get("event_title", "Event")))
        url = str(row.get("source_url", "") or "")
        heading = f'<a href="{html.escape(url)}" target="_blank" rel="noopener">{title}</a>' if url else title
        host = html.escape(str(row.get("host_org", "") or "Host not listed"))
        location = html.escape(str(row.get("location", "") or "Location not listed"))
        time_text = html.escape(str(row.get("event_time", "") or ""))
        items.append(
            '<article class="rc-event">'
            + _date_block(row.get("event_date", ""))
            + '<div class="rc-event__body">'
            f'<h3 class="rc-event__title">{heading}</h3>'
            f'<div class="rc-event__meta">{host}</div>'
            f'<div class="rc-event__meta rc-event__where">{location}'
            + (f' &middot; {time_text}' if time_text else "")
            + '</div></div></article>'
        )
    return f'<div class="rc-events">{"".join(items)}</div>'


def rc_chip() -> str:
    """Connection state for the masthead, encoded in colour as well as words."""
    live = bool(campusgroups_status.connected)
    tone = "ok" if live else "warn"
    label = "Live CampusGroups data" if live else "Using bundled data"
    return (
        f'<span class="rc-chip rc-chip--{tone}">'
        f'<span class="rc-chip__dot"></span>{label}</span>'
    )


def rc_masthead() -> str:
    return (
        '<div class="rc-masthead">'
        '  <div class="rc-masthead__lockup">'
        f'  {GW_MARK_INLINE}'
        '  <div class="rc-masthead__id">'
        '    <div class="rc-eyebrow">The George Washington University</div>'
        '    <h1 class="rc-wordmark">RevConnectAI</h1>'
        '    <p class="rc-tagline">Student organization guidance, CampusGroups help, '
        'funding pathways, and event planning &mdash; grounded in GW policy documents '
        'and current CampusGroups listings.</p>'
        '  </div>'
        '  </div>'
        f'  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">{rc_chip()}'
        '    <span class="rc-chip rc-chip--proto">Prototype</span>'
        '  </div>'
        '</div>'
    )


def rc_status_panel() -> str:
    """Counts first, then the detail — the summary should read at a glance."""
    status = campusgroups_status
    live = bool(status.connected)
    refreshed = status.refreshed_at_utc.replace("T", " ")[:16] if status.refreshed_at_utc else "not yet"
    tiles = (
        '<div class="rc-tiles">'
        f'<div class="rc-tile"><div class="rc-tile__label">Organizations</div>'
        f'<div class="rc-tile__value">{status.groups_count:,}</div></div>'
        f'<div class="rc-tile"><div class="rc-tile__label">Upcoming events</div>'
        f'<div class="rc-tile__value">{status.events_count:,}</div></div>'
        f'<div class="rc-tile"><div class="rc-tile__label">Source</div>'
        f'<div class="rc-tile__value rc-tile__value--sm">{html.escape(status.source)}</div></div>'
        f'<div class="rc-tile"><div class="rc-tile__label">Refreshed (UTC)</div>'
        f'<div class="rc-tile__value rc-tile__value--sm">{html.escape(refreshed)}</div></div>'
        '</div>'
    )
    tone = "ok" if live else "warn"
    detail = (
        f'<div class="rc-chip rc-chip--{tone}" style="margin-bottom:10px">'
        f'<span class="rc-chip__dot"></span>'
        f'{"Connected" if live else "Not connected"} &middot; {html.escape(status.endpoint_host)}</div>'
        f'<p style="font-size:13.5px;color:var(--rc-muted);margin:0;line-height:1.55">'
        f'{html.escape(status.message)}</p>'
    )
    warnings = ""
    if status.warnings:
        items = "".join(f"<li>{html.escape(w)}</li>" for w in status.warnings)
        warnings = (
            f'<ul style="font-size:13px;color:var(--rc-warn);margin:10px 0 0;'
            f'padding-left:18px;line-height:1.5">{items}</ul>'
        )
    return tiles + detail + warnings


def rc_refresh():
    """Refresh live data, then restate connection status in both places it appears."""
    refresh_campusgroups_live()
    return rc_status_panel(), rc_masthead()


EXAMPLE_QUESTIONS = [
    "Is there a Muslim student group on campus?",
    "How do I create an event in CampusGroups?",
    "What public events are coming up on campus?",
    "Can I sign a contract for my student organization?",
    "What is the co-sponsorship deadline and when should we hear back?",
    "How can we recruit more members?",
]

DISCLAIMER = (
    '<div class="rc-footer"><strong>RevConnectAI provides guidance, not decisions.</strong> '
    'It does not approve funding, purchases, contracts, reimbursements, travel, or events. '
    'Current GW policy and authorized staff control. Verify anything you act on with Org Help, '
    'SGA Finance, or the responsible GW office. Organization and event listings come from public '
    'CampusGroups feeds; no student, membership, attendee, or payment data is requested.</div>'
)


def rc_section(title: str, blurb: str) -> str:
    return f'<div class="rc-section"><h2>{title}</h2><p>{blurb}</p></div>'


# --- Interface ---------------------------------------------------------------

with gr.Blocks(title="RevConnectAI", theme=THEME, css=CSS, head=HEAD, fill_width=False) as demo:
    masthead = gr.HTML(rc_masthead)

    with gr.Tabs():
        with gr.Tab("Ask"):
            gr.HTML(rc_section(
                "Ask a question",
                "Answers are grounded in the GW Student Organization Handbook, SGA bylaws and "
                "funding guidance, CampusGroups how-to steps, and live organization listings. "
                "High-risk topics are flagged for staff review.",
            ))
            with gr.Row():
                with gr.Column(scale=2, min_width=300):
                    question = gr.Textbox(
                        lines=4, label="Your question", show_label=True,
                        placeholder="e.g. What funding should we pursue for a cultural festival next semester?",
                    )
                    ask_button = gr.Button("Ask RevConnectAI", variant="primary")
                    gr.Examples(examples=EXAMPLE_QUESTIONS, inputs=question, label="Try one")
                with gr.Column(scale=3, min_width=340):
                    answer = gr.Markdown(
                        rc_markdown(""), label="Answer",
                        elem_classes=["rc-answer"], container=True, show_label=True,
                    )
            ask_button.click(rc_answer, question, answer)
            question.submit(rc_answer, question, answer)

        with gr.Tab("Organizations & events"):
            gr.HTML(rc_section(
                "Search current CampusGroups listings",
                "Registered organizations and upcoming events, read from GW's public "
                "CampusGroups feeds. Falls back to bundled data if the feed is unreachable.",
            ))
            status_panel = gr.HTML(rc_status_panel)
            with gr.Row():
                refresh_button = gr.Button(
                    "Refresh from CampusGroups", variant="secondary",
                    size="sm", scale=0, min_width=220,
                )

            # Tables get the full width; side by side they clip their columns.
            with gr.Row():
                org_query = gr.Textbox(
                    label="Find organizations", scale=4, min_width=240,
                    placeholder="photography, public service, coding, cultural community",
                )
                org_button = gr.Button("Search", variant="primary", scale=0, min_width=130)
            org_results = gr.HTML(lambda: rc_org_cards(""), label="Matching organizations")

            with gr.Row():
                event_query = gr.Textbox(
                    label="Find events", scale=4, min_width=240,
                    placeholder="volunteer, career, cultural, social, technology",
                )
                event_button = gr.Button("Search", variant="primary", scale=0, min_width=130)
            event_results = gr.HTML(lambda: rc_event_cards(""), label="Upcoming events")
            refresh_button.click(rc_refresh, outputs=[status_panel, masthead])
            org_button.click(rc_org_cards, org_query, org_results)
            org_query.submit(rc_org_cards, org_query, org_results)
            event_button.click(rc_event_cards, event_query, event_results)
            event_query.submit(rc_event_cards, event_query, event_results)

        with gr.Tab("Funding pathway"):
            gr.HTML(rc_section(
                "Which funding source fits",
                "Compares SGA General Allocation, co-sponsorship, the University-Wide Programs "
                "Fund, and self-generated funds against what you are planning. Planning guidance "
                "only — eligibility and deadlines are confirmed by SGA Finance.",
            ))
            with gr.Row():
                with gr.Column(min_width=300):
                    need = gr.Textbox(lines=4, label="What are you planning?")
                    pathway = gr.Dropdown(
                        ["Unknown", "Red", "Blue", "Orange", "Silver", "Yellow", "Green"],
                        value="Unknown", label="Organization pathway",
                    )
                    open_all = gr.Checkbox(True, label="Open to all GW students")
                    campuswide = gr.Checkbox(False, label="Large campus-wide event or tradition")
                    future = gr.Checkbox(False, label="Happens in a future semester")
                    flexible = gr.Checkbox(False, label="Needs flexible or self-generated funds")
                    funding_button = gr.Button("Recommend a pathway", variant="primary")
                with gr.Column(min_width=340):
                    funding_out = gr.Markdown(
                        rc_markdown(""), label="Recommendation",
                        elem_classes=["rc-answer"], container=True, show_label=True,
                    )
            funding_button.click(
                rc_funding_path,
                [need, pathway, open_all, campuswide, future, flexible],
                funding_out,
            )

        with gr.Tab("Budget estimate"):
            gr.HTML(rc_section(
                "Estimate an event budget",
                "Produces low, typical, and high planning figures from GW cost assumptions. "
                "A planning estimate, not a quote or an approved budget.",
            ))
            with gr.Row():
                with gr.Column(min_width=300):
                    with gr.Row():
                        attendees = gr.Number(50, label="Expected attendees")
                        food = gr.Dropdown(
                            list(EVENT_BUDGET_ASSUMPTIONS.keys()),
                            value="Snacks/refreshments", label="Food",
                        )
                    with gr.Row():
                        supplies = gr.Number(5, label="Supplies per person ($)")
                        marketing = gr.Number(100, label="Marketing ($)")
                    with gr.Accordion("Vendor, venue, and travel costs", open=False):
                        with gr.Row():
                            venue = gr.Number(0, label="Venue ($)")
                            av = gr.Number(0, label="A/V ($)")
                        with gr.Row():
                            speaker = gr.Number(0, label="Speaker fee ($)")
                            performer = gr.Number(0, label="Performer or DJ fee ($)")
                        with gr.Row():
                            travel = gr.Number(0, label="Travel ($)")
                            other = gr.Number(0, label="Security or other ($)")
                    contingency = gr.Number(10, label="Contingency (%)")
                    budget_button = gr.Button("Estimate budget", variant="primary")
                with gr.Column(min_width=340):
                    budget_out = gr.Markdown(
                        rc_markdown(""), label="Planning estimate",
                        elem_classes=["rc-answer"], container=True, show_label=True,
                    )
            budget_button.click(
                rc_budget,
                [attendees, food, supplies, marketing, venue, speaker,
                 performer, av, travel, other, contingency],
                budget_out,
            )

        with gr.Tab("Application draft"):
            gr.HTML(rc_section(
                "Draft a funding request",
                "Turns your event details into a narrative covering student benefit, audience, "
                "budget justification, and accessibility. Review and edit before submitting; "
                "a draft never implies approval.",
            ))
            with gr.Row():
                with gr.Column(min_width=300):
                    with gr.Row():
                        event_name = gr.Textbox(label="Event or project")
                        org_name = gr.Textbox(label="Organization")
                    purpose = gr.Textbox(lines=4, label="Purpose and student benefit")
                    with gr.Row():
                        audience = gr.Textbox(label="Audience")
                        attendance = gr.Number(50, label="Expected attendance")
                    with gr.Row():
                        event_date = gr.Textbox(label="Date")
                        location = gr.Textbox(label="Location")
                    with gr.Row():
                        total = gr.Number(0, label="Total cost ($)")
                        requested = gr.Number(0, label="Amount requested ($)")
                    source = gr.Dropdown(
                        ["SGA General Allocation", "SGA Co-Sponsorship",
                         "University-Wide Programs Fund", "Other"],
                        value="SGA Co-Sponsorship", label="Funding source",
                    )
                    accessibility = gr.Textbox(lines=3, label="Accessibility and inclusion plan")
                    draft_button = gr.Button("Draft the request", variant="primary")
                with gr.Column(min_width=340):
                    draft_out = gr.Markdown(
                        rc_markdown(""), label="Draft narrative",
                        elem_classes=["rc-answer"], container=True, show_label=True,
                    )
            draft_button.click(
                rc_application,
                [event_name, org_name, purpose, audience, attendance, event_date,
                 location, total, requested, source, accessibility],
                draft_out,
            )

        with gr.Tab("Deadlines"):
            gr.HTML(rc_section(
                "Check a deadline",
                "Co-sponsorship, contracts, re-registration, General Allocation, UWPF, "
                "new-organization recognition, and payment timelines.",
            ))
            with gr.Row():
                with gr.Column(min_width=300):
                    process = gr.Textbox(
                        lines=2, label="Which process?",
                        placeholder="e.g. co-sponsorship, vendor check, re-registration",
                    )
                    deadline_button = gr.Button("Check the timeline", variant="primary")
                with gr.Column(min_width=340):
                    deadline_out = gr.Markdown(
                        rc_markdown(""), label="Deadline and timeline",
                        elem_classes=["rc-answer"], container=True, show_label=True,
                    )
            deadline_button.click(rc_deadline, process, deadline_out)
            process.submit(rc_deadline, process, deadline_out)

    gr.HTML(DISCLAIMER)

demo.launch(share=True, debug=False, **LAUNCH_KWARGS)
