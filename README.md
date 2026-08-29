# EdgeClose

EdgeClose is a Manifest V3 Microsoft Edge extension that closes tabs matching user-defined URL patterns after the computer has been idle for a chosen duration.

Read the [EdgeClose Privacy Policy](privacy-policy.html) before publishing. EdgeClose keeps configuration, password verification data, temporary per-tab activity state, pause state, and a bounded local audit log on the device. It does not transmit browsing history or page content. The Options page contacts the public GitHub API only to show published release versions.

### Install locally

1. Open `edge://extensions` in Microsoft Edge.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this folder.
4. On the first installation, EdgeClose automatically opens its Options page and asks you to create a settings password.
5. After the password is created, every new Options-page session requires that password before settings can be viewed or changed.

For a packaged installation, download the ZIP attached to the matching GitHub Release.

## Settings security

The Options page is password protected. On first install, EdgeClose requires a password of at least 8 characters. Every later Options-page open requires the password again. The password itself is never stored; EdgeClose uses a per-install random salt with PBKDF2/SHA-256 and a high iteration count. Five consecutive incorrect attempts trigger a 60-second temporary lockout. The Options page provides a password-change workflow after successful unlock.

Passwords are never written to logs, analytics, URLs, GitHub requests, audit entries, or generated HTML. Password input is used only for local verification and cleared after authentication flows.

## Monitoring rules

Patterns support `*`, for example:

```text
https://www.example.com/*
https://social.example/*
```

You can also enter a domain without a protocol, such as `example.com`; this matches the domain, its `www` version, and all page paths. Direct IPv4 addresses are also supported.

Each website has its own inactivity timeout, warning lead time, optional warning sound, and optional daily `From`/`To` schedule. Leave both schedule fields empty to keep a website active all day. Overnight schedules such as `23:00` to `07:00` are supported.

When multiple rules match, EdgeClose applies automatic specificity priority: exact URL/path patterns outrank broad domain rules, longer literal patterns outrank shorter patterns, and wildcard-heavy patterns rank lower. Equal-priority rules retain their configuration order.

The timer is tracked independently for every matching tab. A timer resets only after trusted, real user interaction such as pointer, keyboard, wheel, touch, input, or change events on that tab. DOM updates, animations, network requests, media playback, and synthetic script-generated events do not reset the timer. Matching tabs can pass their rule to a newly opened child tab so the configured session can follow a link opened in a new tab.

The background service worker remains authoritative for the close deadline and verifies wall-clock elapsed time before closing. A page-side deadline signal provides a second trigger for short timeouts when browser alarm delivery is delayed.

## Temporary pause and toolbar dashboard

Select the EdgeClose toolbar icon to open the dashboard. It shows the number of monitored tabs and their remaining time, and provides temporary protection pauses for 15 minutes, 1 hour, or 24 hours. Resume is available from the same dashboard. Pausing clears active per-tab warning/close alarms; protection automatically resumes when the selected pause expires.

## Administrator-managed settings

On organization-managed Edge devices, administrators can use the `EdgeClose` managed policy with the included `managed_schema.json` schema. Managed policy has explicit precedence over local settings: **managed policy > local settings**. When managed rules are present, users can view them but cannot change them from Options. Changes to local or managed configuration cause active per-tab alarms to be rebuilt.

The Options page contains a policy dashboard showing the current source, precedence, rule count, monitored-tab count, and pause state. It also includes a local audit log of EdgeClose management events. The audit log is bounded and intentionally excludes passwords, password hashes, salts, URLs, page titles, rule patterns, tokens, and secrets.

To prevent users from disabling or uninstalling EdgeClose itself, administrators must deploy the extension using Edge's `ExtensionSettings` policy with `installation_mode` set to `force_installed`. The extension cannot prevent a user from disabling or uninstalling itself without browser-level management policy.

## Privacy policy URL

After enabling GitHub Pages:

```text
https://ajayraikvar.github.io/EdgeClose/privacy-policy.html
```

The public repository includes a Pages deployment workflow. In GitHub, select **Settings > Pages > Build and deployment > Source > GitHub Actions** once. The workflow publishes the policy after pushes to `main`.

## Releases and updates

The Options page checks published GitHub Releases when opened. A normal Git commit is not a published release, so create a GitHub Release and attach the matching ZIP after each version update. The built-in updater intentionally compares the installed version only against non-draft, non-prerelease GitHub Releases.

For automatic updates and administrator-managed installation, publish the packaged ZIP through Microsoft Edge Add-ons.

## Development

The extension targets Manifest V3 and keeps the background service worker authoritative for timer state. Before publishing a release, validate JavaScript/JSON with repository CI and attach a ZIP containing the exact source version from `manifest.json`.
