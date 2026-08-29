# Changelog

## v1.6.0

- Remove the toolbar popup; all EdgeClose controls are managed from the password-protected Options page.
- Move temporary pause and resume controls into the Options page and require fresh password confirmation for each action.
- Keep pause state and protection status visible in the Options dashboard.
- Add encrypted configuration and audit backups in `Downloads/EdgeClose/config-audit.enc`.
- Add a separately encrypted recovery-key file in `Downloads/EdgeClose/recovery-key.enc` so settings can be restored after extension removal.
- Keep backup payloads encrypted with AES-GCM and protect the data-encryption key with RSA-OAEP; never write the settings password in plaintext.
- Add a guided encrypted-backup restore flow to the Options page.
- Keep audit records sanitized: no passwords, hashes, salts, URLs, titles, rule patterns, tokens, or secrets.
- Keep per-tab activity timers, rule specificity priority, managed-policy precedence, trusted interaction checks, and wall-clock deadline verification.
- Update packaging and CI to validate the v1.6.0 source set and exclude obsolete popup files.
- Sync privacy documentation with encrypted persistent backups and Options-only controls.

## v1.5.0

- Refresh the Options page with a polished Pro-style dashboard and clearer information hierarchy.
- Add responsive metric cards for policy source, rule count, monitored tabs, and protection state.
- Improve website rules into clearer cards with automatic-priority indicators and responsive controls.
- Redesign security, audit, and release sections for easier scanning and administration.
- Redesign the toolbar popup with a compact Pro dashboard for protection status, monitored tabs, and pause controls.
- Keep the settings password gate, timer engine, policy precedence, audit controls, and privacy protections from v1.4.0.

## v1.4.0

- Strengthen the settings password with salted PBKDF2/SHA-256 verification, per-session failed-attempt rate limiting, and password change support.
- Open the settings page automatically on first installation so a password is configured before use.
- Keep the settings page locked until the correct password is entered on every open.
- Add a toolbar dashboard popup with protected-tab status and temporary 15-minute, 1-hour, and 24-hour pause controls.
- Improve rule priority so specific URL/path rules take precedence over broad domains and wildcard rules.
- Keep the background service worker authoritative for per-tab deadlines while retaining a page-side deadline signal for short timeouts.
- Treat only trusted, real user interaction events as activity; DOM changes, network activity, animations, media playback, and synthetic events do not reset timers.
- Keep timers isolated per tab and expose monitored-tab countdowns in the toolbar dashboard.
- Add a policy dashboard showing managed-policy precedence, rule count, monitored-tab count, and pause state.
- Add a local, bounded audit log that intentionally excludes passwords, URLs, page titles, patterns, and secrets.
- Add an explicit extension-pages Content Security Policy and package the toolbar popup files.
- Keep privacy documentation aligned with local password verification, audit logging, and persistent Downloads storage.

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
