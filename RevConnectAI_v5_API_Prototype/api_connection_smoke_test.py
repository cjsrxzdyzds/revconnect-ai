"""Connection-only smoke test for RevConnectAI's CampusGroups integration.

Needs no credential: the rss_groups and rss_events feeds are public.
"""
import pathlib

from campusgroups_api_client import CampusGroupsConfig, fetch_with_fallback

config = CampusGroupsConfig(school_code='gwu', cache_dir=pathlib.Path('./cache'))
groups, events, status = fetch_with_fallback(enabled=True, config=config)

print('Endpoint host:', config.base_url)
print(status.message)
print('Connected live:', status.connected)
print('Sent a credential:', status.used_credential)
print('Data source:', status.source)
print('Organizations:', len(groups))
print('Upcoming events:', len(events))
for warning in status.warnings:
    print('Warning:', warning)

if not status.connected:
    raise SystemExit(
        'Live connection was not confirmed. Check network access and that the school '
        'code is correct. If CG_API_KEY or CG_API_SECRET is set, try clearing it: an '
        'invalid secret turns a working request into a 403.'
    )
if groups.empty:
    raise SystemExit('Connected but parsed zero organizations; the feed schema may have changed.')

print('\nOK: live CampusGroups data is being read.')
