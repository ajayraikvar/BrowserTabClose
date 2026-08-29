# Changelog

## v1.3.3

- Address certification feedback for monitored-tab closing reliability.
- Keep the background service worker authoritative for the actual close deadline.
- Add a page-side deadline signal as a second close trigger so short configured timeouts are not dependent on alarm precision alone.
- Retain per-tab activity isolation, schedule-aware rules, frame activity tracking, and managed-setting alarm refresh from v1.3.2.
- Publish the package as `EdgeClose-1.3.3.zip`.

## v1.3.2

- Fix per-tab activity state updates so concurrent tab activity cannot overwrite another tab's timestamp.
- Rebuild monitored-tab alarms when local or managed settings change.
- Treat matching sites outside their active schedule as paused instead of accidentally using an inactive rule.
- Make the background service worker authoritative for the close deadline.
- Improve warning countdown accuracy using a wall-clock deadline.
- Track user activity inside frames as well as the top-level page.
- Keep inherited child-tab rules schedule-aware.
- Remove stale per-tab session state when a tab closes.
