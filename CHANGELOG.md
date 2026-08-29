# Changelog

## v1.4.0

- Strengthen the settings password with salted PBKDF2/SHA-256 verification, per-session failed-attempt rate limiting, and password change support.
- Open the settings page automatically on first installation so a password is configured before use.
- Keep the settings page locked until the correct password is entered on every open.
- Add a toolbar dashboard popup with protected-tab status and temporary 15-minute, 1-hour, and 24-hour pause controls.
- Improve rule priority so specific URL/path rules take precedence over broad domains and wildcard rules.
- Keep the background service worker authoritative for per-tab deadlines while retaining a page-side deadline signal for short timeouts.
- Treat only trusted, real user interaction events as activity; DOM changes, network activity, animations, and synthetic events do not reset timers.
- Keep timers isolated per tab and expose monitored-tab countdowns in the toolbar dashboard.
- Add a policy dashboard showing managed-policy precedence, rule count, monitored-tab count, and pause state.
- Add a local, bounded audit log that intentionally excludes passwords, URLs, page titles, patterns, and secrets.
- Add an explicit extension-pages Content Security Policy and package the toolbar popup files.
- Keep privacy documentation aligned with local password verification and audit logging.

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
