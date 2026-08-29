# Changelog

## v1.3.2

- Fix per-tab activity state updates so concurrent tab activity cannot overwrite another tab's timestamp.
- Rebuild monitored-tab alarms when local or managed settings change.
- Treat matching sites outside their active schedule as paused instead of accidentally using an inactive rule.
- Make the background service worker authoritative for the close deadline.
- Improve warning countdown accuracy using a wall-clock deadline.
- Track user activity inside frames as well as the top-level page.
- Keep inherited child-tab rules schedule-aware.
- Remove stale per-tab session state when a tab closes.
