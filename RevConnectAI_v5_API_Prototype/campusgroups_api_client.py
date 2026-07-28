"""Read-only CampusGroups RSS client used by RevConnectAI v5.

The rss_groups and rss_events feeds are served per school tenant
(https://<school_code>.campusgroups.com) and are publicly readable: they need
no credential. Sending an X-CG-API-Secret header with an invalid value turns a
working HTTP 200 into a 403, so the header is attached only when a credential
is actually configured.

If a credential is configured it is read from an environment variable or Google
Colab Secrets and sent only in the X-CG-API-Secret request header. It is never
written to source files or to the cache.
"""
from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class CampusGroupsAPIError(RuntimeError):
    """Raised when a CampusGroups response cannot be retrieved or parsed."""


def clean_api_text(value: Any) -> str:
    if value is None:
        return ""
    text = re.sub(r"<[^>]+>", " ", str(value))
    return re.sub(r"\s+", " ", text).strip()


def local_name(tag: str) -> str:
    return str(tag).split("}")[-1]


def as_bool(value: Any) -> bool:
    return clean_api_text(value).casefold() in {"1", "true", "yes", "y", "on"}


def first_value(record: Mapping[str, Any], *names: str) -> str:
    lowered = {str(key).casefold(): value for key, value in record.items()}
    for name in names:
        value = lowered.get(name.casefold())
        if value not in (None, ""):
            return clean_api_text(value)
    return ""


def flatten_xml_record(node: ET.Element) -> Dict[str, str]:
    record: Dict[str, str] = {}
    for child in list(node):
        key = local_name(child.tag)
        if list(child):
            pieces = [clean_api_text(text) for text in child.itertext() if clean_api_text(text)]
            value = " | ".join(dict.fromkeys(pieces))
        else:
            value = clean_api_text(child.text)
        if key in record and value:
            record[key] = f"{record[key]} | {value}"
        else:
            record[key] = value
    return record


def parse_payload(content: bytes, expected_id_field: str) -> List[Dict[str, Any]]:
    stripped = content.lstrip()
    if not stripped:
        return []

    if stripped[:1] in {b"[", b"{"}:
        payload = json.loads(stripped.decode("utf-8"))
        if isinstance(payload, list):
            return [dict(item) for item in payload if isinstance(item, Mapping)]
        if isinstance(payload, Mapping):
            for key in ("items", "results", "data", "records"):
                value = payload.get(key)
                if isinstance(value, list):
                    return [dict(item) for item in value if isinstance(item, Mapping)]
            return [dict(payload)]

    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        preview = clean_api_text(content[:300].decode("utf-8", errors="replace"))
        raise CampusGroupsAPIError(f"CampusGroups returned non-XML data: {preview}") from exc

    expected = expected_id_field.casefold()
    candidates: List[ET.Element] = []
    for node in root.iter():
        child_names = {local_name(child.tag).casefold() for child in list(node)}
        if expected in child_names:
            candidates.append(node)

    if not candidates:
        for tag in ("item", "record", "row", "group", "event"):
            candidates.extend(root.findall(f".//{tag}"))

    records = [flatten_xml_record(node) for node in candidates]
    return [record for record in records if record]


@dataclass
class CampusGroupsConfig:
    # Left empty, base_url is derived from school_code. www.campusgroups.com is
    # the vendor's global tenant and does not serve GW records.
    base_url: str = ""
    groups_endpoint: str = "/rss_groups"
    events_endpoint: str = "/rss_events"
    school_code: str = "gwu"
    credential_names: Sequence[str] = ("CG_API_SECRET", "CG_API_KEY")
    timeout_seconds: int = 45
    event_future_days: int = 180
    event_limit: int = 2000
    cache_dir: Path = Path("/content/revconnect_ai/cache")
    user_agent: str = "RevConnectAI/5.0 (read-only CampusGroups integration)"
    # Event privacyLevel values the assistant may surface. 0 is public; 1 is the
    # authenticated campus community, which is RevConnectAI's audience. Confirm
    # the production meaning of each level with GW before widening this.
    allowed_event_privacy_levels: Sequence[str] = ("0", "1", "Everyone")

    def __post_init__(self) -> None:
        if not self.base_url:
            self.base_url = f"https://{self.school_code}.campusgroups.com"


@dataclass
class CampusGroupsStatus:
    enabled: bool
    connected: bool = False
    source: str = "none"
    message: str = "Not initialized"
    groups_count: int = 0
    events_count: int = 0
    refreshed_at_utc: str = ""
    endpoint_host: str = ""
    used_credential: bool = False
    warnings: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "connected": self.connected,
            "used_credential": self.used_credential,
            "source": self.source,
            "message": self.message,
            "groups_count": self.groups_count,
            "events_count": self.events_count,
            "refreshed_at_utc": self.refreshed_at_utc,
            "endpoint_host": self.endpoint_host,
            "warnings": list(self.warnings),
        }


class CampusGroupsReadOnlyClient:
    def __init__(self, config: Optional[CampusGroupsConfig] = None, credential: Optional[str] = None):
        self.config = config or CampusGroupsConfig()
        self.credential = (credential or self._load_credential() or "").strip()
        self.session = self._build_session()

    def _load_credential(self) -> Optional[str]:
        for name in self.config.credential_names:
            value = os.getenv(name)
            if value:
                return value.strip()
        try:
            from google.colab import userdata  # type: ignore
            for name in self.config.credential_names:
                try:
                    value = userdata.get(name)
                except Exception:
                    value = None
                if value:
                    return str(value).strip()
        except Exception:
            pass
        return None

    def _build_session(self) -> requests.Session:
        retry = Retry(
            total=3,
            connect=3,
            read=3,
            backoff_factor=0.8,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}),
            raise_on_status=False,
        )
        session = requests.Session()
        session.mount("https://", HTTPAdapter(max_retries=retry))
        session.headers.update({"User-Agent": self.config.user_agent, "Accept": "application/xml,text/xml,application/json"})
        return session

    @property
    def credential_available(self) -> bool:
        return bool(self.credential)

    def _get_records(self, endpoint: str, params: Mapping[str, Any], expected_id_field: str) -> List[Dict[str, Any]]:
        url = self.config.base_url.rstrip("/") + "/" + endpoint.lstrip("/")
        # The public feeds reject an invalid secret, so only send the header when
        # a credential is configured.
        headers = {"X-CG-API-Secret": self.credential} if self.credential else {}
        response = self.session.get(
            url,
            params={key: value for key, value in params.items() if value not in (None, "")},
            headers=headers,
            timeout=self.config.timeout_seconds,
        )
        if response.status_code in {401, 403}:
            if self.credential:
                raise CampusGroupsAPIError(
                    f"CampusGroups rejected the request with HTTP {response.status_code} while sending a credential. "
                    "These feeds are public and work without one: clear CG_API_KEY/CG_API_SECRET, or supply a valid secret."
                )
            raise CampusGroupsAPIError(
                f"CampusGroups returned HTTP {response.status_code} for {url}. "
                f"Confirm that the school code '{self.config.school_code}' is correct."
            )
        if not response.ok:
            raise CampusGroupsAPIError(f"CampusGroups request failed with HTTP {response.status_code}.")
        content_type = response.headers.get("content-type", "").casefold()
        if "html" in content_type and b"<html" in response.content[:500].lower():
            raise CampusGroupsAPIError("CampusGroups returned an HTML page instead of an API payload.")
        return parse_payload(response.content, expected_id_field=expected_id_field)

    def fetch_groups_raw(self) -> List[Dict[str, Any]]:
        return self._get_records(
            self.config.groups_endpoint,
            params={"include_unpublished": 0, "include_deleted": 0},
            expected_id_field="groupId",
        )

    def fetch_events_raw(self) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {
            "deleted": 0,
            "time_range": "upcoming_only",
            "future_day_range": self.config.event_future_days,
            "limit": self.config.event_limit,
            "privacy_displayed_to": 0,
        }
        # The feed honours privacy_level server-side. Only constrain it there
        # when the config asks for public-only events; otherwise the wider set
        # is fetched and filtered by normalize_events().
        allowed = {str(level) for level in self.config.allowed_event_privacy_levels}
        if not allowed - {"0", "Everyone"}:
            params["privacy_level"] = 0
        return self._get_records(
            self.config.events_endpoint,
            params=params,
            expected_id_field="eventUid",
        )


def normalize_groups(records: Iterable[Mapping[str, Any]]) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for record in records:
        deleted = as_bool(first_value(record, "deleted"))
        hidden = as_bool(first_value(record, "hidden"))
        published_raw = first_value(record, "published")
        published = True if not published_raw else as_bool(published_raw) or published_raw.casefold() == "published"
        if deleted or hidden or not published:
            continue

        name = first_value(record, "groupName", "name")
        if not name:
            continue
        mission = first_value(record, "mission")
        what_we_do = first_value(record, "whatWeDo")
        goals = first_value(record, "goals")
        description = clean_api_text(" ".join(part for part in (mission, what_we_do, goals) if part))
        # groupType is GW's funding-pathway label ("Student Organization (Blue
        # Line)"), not a topical category, so track whether a real category came
        # from the feed before falling back to it.
        category = first_value(record, "category")
        group_type = first_value(record, "groupType")
        has_source_category = bool(category)
        category = category or group_type
        acronym = first_value(record, "groupAcronym")
        # `closed` marks closed *membership* (joining needs approval), not a
        # defunct organization. It must not exclude the record.
        membership_closed = as_bool(first_value(record, "closed"))
        status = first_value(record, "groupStatus") or "active"
        source_url = first_value(record, "groupLink", "primaryWebSite", "webSite")
        has_source_description = bool(description)
        if not description:
            # Most live records carry no mission text, so build something the
            # embedding model can still match on instead of a bare name.
            description = clean_api_text(
                f"{name} is a GW {group_type or 'student organization'}"
                + (f" in the {category} category." if category else ".")
            )
        rows.append({
            "org_id": first_value(record, "groupId", "externalGroupId") or acronym or name,
            "org_name": name,
            "category": category or group_type or "Uncategorized",
            "description": description,
            # The name and acronym carry most of the searchable signal when the
            # mission fields are empty.
            "keywords": clean_api_text(f"{name} {acronym} {category} {group_type} {mission} {what_we_do} {goals}"),
            "source_url": source_url,
            "status": status,
            "last_updated": first_value(record, "lastUpdatedOn"),
            "group_acronym": acronym,
            "group_type": group_type,
            "group_logo_url": first_value(record, "groupLogoUrl"),
            "membership_closed": membership_closed,
            "has_source_description": has_source_description,
            "has_source_category": has_source_category,
            "data_source": "CampusGroups RSS API",
        })
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=[
            "org_id", "org_name", "category", "description", "keywords", "source_url",
            "status", "last_updated", "group_acronym", "group_type", "group_logo_url",
            "membership_closed", "has_source_description", "has_source_category", "data_source"
        ])
    return df.drop_duplicates(subset=["org_id", "org_name"], keep="first").reset_index(drop=True)


def normalize_events(
    records: Iterable[Mapping[str, Any]],
    allowed_privacy_levels: Sequence[str] = ("0", "1", "Everyone"),
) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    blocked_statuses = {"cancelled", "canceled", "rejected", "denied", "deleted"}
    allowed_privacy = {str(level) for level in allowed_privacy_levels}
    for record in records:
        if as_bool(first_value(record, "eventDelete", "deleted")):
            continue
        approval = first_value(record, "approvalStatus", "approvalStatus2")
        if approval.casefold() in blocked_statuses:
            continue
        title = first_value(record, "title", "eventName")
        if not title:
            continue
        privacy_level = first_value(record, "privacyLevel")
        privacy_displayed_to = first_value(record, "privacyDisplayedTo", "publishCalendar")
        if privacy_level and privacy_level not in allowed_privacy:
            continue
        if privacy_displayed_to and privacy_displayed_to not in {"0", "Everyone"}:
            continue
        rows.append({
            "event_id": first_value(record, "eventUid", "eventId", "externalEventId") or title,
            "event_title": title,
            "host_org": first_value(record, "group"),
            "host_org_id": first_value(record, "groupId", "groupCgId"),
            "group_acronym": first_value(record, "groupAcronym"),
            "category": first_value(record, "eventType", "groupType"),
            "description": first_value(record, "description"),
            "event_date": first_value(record, "eventDate"),
            "event_end_date": first_value(record, "eventEndDate"),
            "event_time": first_value(record, "eventTime"),
            "event_end_time": first_value(record, "eventEndTime"),
            "timezone": first_value(record, "timeZone", "timeZoneId"),
            "location": first_value(record, "eventLocation", "eventBuilding", "eventBuildingAddress"),
            "source_url": first_value(record, "eventLink", "iCalLink"),
            "visibility": "Everyone" if privacy_level in {"", "0", "Everyone"} else "GW campus community",
            "approval_status": approval,
            "attendance_estimate": first_value(record, "attendanceEstimate"),
            "last_updated": first_value(record, "lastUpdatedOn", "dateUpdated"),
            "data_source": "CampusGroups RSS API",
        })
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=[
            "event_id", "event_title", "host_org", "host_org_id", "group_acronym", "category",
            "description", "event_date", "event_end_date", "event_time", "event_end_time", "timezone",
            "location", "source_url", "visibility", "approval_status", "attendance_estimate",
            "last_updated", "data_source"
        ])
    return df.drop_duplicates(subset=["event_id", "event_title"], keep="first").reset_index(drop=True)


def merge_organization_sources(local_df: pd.DataFrame, api_df: pd.DataFrame) -> pd.DataFrame:
    """Combine the curated directory with the live feed.

    The live feed is authoritative for which organizations exist and for their
    CampusGroups links, but it carries a mission for only a handful of records.
    So a live row wins on identity while curated description and keyword text is
    kept whenever the live record has none of its own.
    """
    if api_df.empty:
        return local_df.copy().reset_index(drop=True)
    local = local_df.copy()
    api = api_df.copy()
    for frame in (local, api):
        for column in ["org_id", "org_name", "category", "description", "keywords", "source_url", "status", "last_updated"]:
            if column not in frame.columns:
                frame[column] = ""
    for flag in ("has_source_description", "has_source_category"):
        if flag not in api.columns:
            api[flag] = False

    curated = {
        str(row["org_name"]).casefold(): row
        for _, row in local.iterrows()
        if str(row.get("org_name", "")).strip()
    }

    enriched_rows = []
    for _, row in api.iterrows():
        row = row.copy()
        match = curated.get(str(row["org_name"]).casefold())
        if match is not None:
            if not bool(row.get("has_source_description")) and str(match.get("description", "")).strip():
                row["description"] = match["description"]
            if not bool(row.get("has_source_category")) and str(match.get("category", "")).strip():
                row["category"] = match["category"]
            merged_keywords = f"{row.get('keywords', '')} {match.get('keywords', '')}".split()
            row["keywords"] = " ".join(dict.fromkeys(merged_keywords))
        enriched_rows.append(row)

    api_names = set(api["org_name"].fillna("").str.casefold())
    local_only = local[~local["org_name"].fillna("").str.casefold().isin(api_names)]
    merged = pd.DataFrame(enriched_rows) if enriched_rows else api
    return pd.concat([merged, local_only], ignore_index=True, sort=False).reset_index(drop=True)


def _cache_paths(config: CampusGroupsConfig) -> Tuple[Path, Path]:
    return config.cache_dir / "campusgroups_groups_snapshot.csv", config.cache_dir / "campusgroups_events_snapshot.csv"


def save_snapshots(groups_df: pd.DataFrame, events_df: pd.DataFrame, config: CampusGroupsConfig) -> None:
    config.cache_dir.mkdir(parents=True, exist_ok=True)
    groups_path, events_path = _cache_paths(config)
    groups_df.to_csv(groups_path, index=False)
    events_df.to_csv(events_path, index=False)


def load_snapshots(config: CampusGroupsConfig) -> Tuple[pd.DataFrame, pd.DataFrame]:
    groups_path, events_path = _cache_paths(config)
    groups = pd.read_csv(groups_path).fillna("") if groups_path.exists() else normalize_groups([])
    events = pd.read_csv(events_path).fillna("") if events_path.exists() else normalize_events([])
    return groups, events


def fetch_with_fallback(
    enabled: bool = True,
    config: Optional[CampusGroupsConfig] = None,
    credential: Optional[str] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, CampusGroupsStatus]:
    cfg = config or CampusGroupsConfig()
    status = CampusGroupsStatus(enabled=enabled, endpoint_host=cfg.base_url)
    if not enabled:
        groups, events = load_snapshots(cfg)
        status.source = "cache" if (not groups.empty or not events.empty) else "disabled"
        status.message = "Live CampusGroups refresh is disabled."
        status.groups_count = len(groups)
        status.events_count = len(events)
        return groups, events, status

    client = CampusGroupsReadOnlyClient(cfg, credential=credential)

    try:
        groups = normalize_groups(client.fetch_groups_raw())
        events = normalize_events(
            client.fetch_events_raw(),
            allowed_privacy_levels=cfg.allowed_event_privacy_levels,
        )
        save_snapshots(groups, events, cfg)
        status.connected = True
        status.used_credential = client.credential_available
        status.source = "live CampusGroups RSS API"
        status.message = (
            f"Connected successfully to {cfg.base_url} using the read-only group and event feeds"
            + (" with a configured credential." if client.credential_available else " (no credential required).")
        )
        status.groups_count = len(groups)
        status.events_count = len(events)
        status.refreshed_at_utc = datetime.now(timezone.utc).isoformat()
        return groups, events, status
    except Exception as exc:
        groups, events = load_snapshots(cfg)
        status.source = "cache" if (not groups.empty or not events.empty) else "local fallback"
        status.message = f"Live CampusGroups refresh failed; using fallback data. {type(exc).__name__}: {exc}"
        status.groups_count = len(groups)
        status.events_count = len(events)
        if client.credential_available:
            status.warnings.append(
                "A credential is configured. These feeds are public; an invalid secret causes a 403. "
                "Try clearing CG_API_KEY/CG_API_SECRET."
            )
        return groups, events, status
