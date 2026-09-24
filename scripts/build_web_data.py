"""Build the public, data-only Worker site's curated and organization snapshot.

Run with --refresh-live to replace the public CampusGroups organization and
event snapshots. No credentials, officer/member data, or source PDFs are included.
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "RevConnectAI_Knowledge_Base_v4"
OUTPUT = ROOT / "public" / "data.json"
GROUPS_URL = "https://gwu.campusgroups.com/rss_groups?include_unpublished=0&include_deleted=0"
EVENTS_URL = "https://gwu.campusgroups.com/rss_events?deleted=0&time_range=upcoming_only&future_day_range=60&limit=60&privacy_displayed_to=0&privacy_level=0"
TABLES = {
    "resources": "campus_resources.csv",
    "howto": "campusgroups_howto.csv",
    "deadlines": "deadline_registry.csv",
    "budgetAssumptions": "event_budget_assumptions.csv",
    "fundingPrograms": "funding_programs.csv",
    "pathways": "pathway_rules.csv",
    "starterGroups": "student_organization_directory_starter.csv",
}


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value or ""))).strip()


def safe_url(value: str) -> str:
    parsed = urlparse(value or "")
    return value if parsed.scheme == "https" and parsed.netloc else ""


def read_csv(name: str) -> list[dict[str, str]]:
    with (SOURCE / name).open(newline="", encoding="utf-8-sig") as stream:
        return list(csv.DictReader(stream))


def fetch_items(url: str) -> list[ET.Element]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "RevConnectAI/5.1 (public RSS snapshot)", "Accept": "application/xml"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        root = ET.fromstring(response.read())
    return root.findall(".//item")


def fetch_groups(starter: list[dict[str, str]]) -> list[dict[str, str]]:

    curated = {row["org_name"].casefold(): row for row in starter}
    groups = []
    seen = set()
    for item in fetch_items(GROUPS_URL):
        row = {node.tag.split("}")[-1]: clean(" ".join(node.itertext())) for node in item}
        if row.get("deleted", "0").lower() in {"1", "true", "yes"}:
            continue
        if row.get("hidden", "0").lower() in {"1", "true", "yes"}:
            continue
        if row.get("published", "1").lower() not in {"1", "true", "yes", "published"}:
            continue
        name = row.get("groupName", "")
        if not name or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        match = curated.get(name.casefold(), {})
        description = clean(" ".join(row.get(key, "") for key in ("mission", "whatWeDo", "goals")))
        groups.append({
            "name": name,
            "category": row.get("category") or match.get("category", ""),
            "description": description or match.get("description", ""),
            "keywords": clean(" ".join((name, row.get("groupAcronym", ""), match.get("keywords", "")))),
            "url": safe_url(row.get("groupLink") or match.get("source_url", "")),
        })
    return sorted(groups, key=lambda item: item["name"].casefold())


def fetch_events() -> list[dict[str, str]]:
    events = []
    seen = set()
    blocked = {"cancelled", "canceled", "rejected", "denied", "deleted"}
    for item in fetch_items(EVENTS_URL):
        row = {node.tag.split("}")[-1]: clean(" ".join(node.itertext())) for node in item}
        if row.get("eventDelete") == "1" or row.get("approvalStatus", "").lower() in blocked:
            continue
        if row.get("privacyLevel", "0") not in {"0", "Everyone"}:
            continue
        if row.get("privacyDisplayedTo", "0") not in {"0", "Everyone"}:
            continue
        event_id = row.get("eventUid") or row.get("eventId", "")
        title = row.get("title", "")
        if not event_id or not title or event_id in seen:
            continue
        seen.add(event_id)
        events.append({
            "id": event_id,
            "title": title,
            "host": row.get("group", ""),
            "category": row.get("eventType", ""),
            "date": row.get("eventDate", ""),
            "time": row.get("eventTime", ""),
            "location": row.get("eventLocation", ""),
            "description": row.get("description", "")[:500],
            "url": safe_url(row.get("eventLink", "")),
        })
    return events


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh-live", action="store_true")
    args = parser.parse_args()

    data = {key: read_csv(filename) for key, filename in TABLES.items()}
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    data["groups"] = previous.get("groups", [])
    data["groupsFetchedAt"] = previous.get("groupsFetchedAt", "")
    data["events"] = previous.get("events", [])
    data["eventsFetchedAt"] = previous.get("eventsFetchedAt", "")
    if args.refresh_live:
        data["groups"] = fetch_groups(data["starterGroups"])
        data["groupsFetchedAt"] = datetime.now(timezone.utc).isoformat()
        data["events"] = fetch_events()
        data["eventsFetchedAt"] = datetime.now(timezone.utc).isoformat()
    if not data["groups"]:
        data["groups"] = [
            {
                "name": row["org_name"],
                "category": row["category"],
                "description": row["description"],
                "keywords": row["keywords"],
                "url": safe_url(row["source_url"]),
            }
            for row in data["starterGroups"]
        ]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT}: {len(data['groups'])} public organizations, {len(data['events'])} public events")


if __name__ == "__main__":
    main()
