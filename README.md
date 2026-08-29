# EdgeClose

EdgeClose is a Manifest V3 Microsoft Edge extension that closes selected website tabs after the configured period of inactivity.

Read the [EdgeClose Privacy Policy](privacy-policy.html) before publishing. EdgeClose keeps configuration, password verification data, temporary per-tab activity state, pause state, and a bounded audit log on the device. It does not transmit browsing history or page content.

## Install locally

1. Open `edge://extensions` in Microsoft Edge.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this folder.
4. On first installation, EdgeClose opens its Options page and requires a settings password.
5. Every later Options-page session requires that password before settings can be viewed or changed.

## Options-only control

EdgeClose does not use a toolbar popup. The extension toolbar button opens the protected Options page.

All management controls are in the Options page:

- Website rules and timers
- Temporary protection pause for 15 minutes, 1 hour, or 24 hours
- Resume protection
- Password change
- Policy status
- Audit log
- Encrypted backup and recovery

Every pause or resume action requires a fresh settings-password confirmation. A temporary pause clears active per-tab warning/close alarms and automatically expires at the selected time.

## Settings security

The Options page is password protected. On first install, EdgeClose requires a password of at least 8 characters. Every later Options-page open requires the password again. The password itself is never stored; EdgeClose uses a random salt with PBKDF2/SHA-256. Five incorrect attempts trigger a 60-second temporary lockout.

Passwords are never written to logs, URLs, analytics requests, GitHub requests, or generated HTML. Password input is used only for local verification.

## Monitoring rules

Patterns support `*`, for example:

```text
https://www.example.com/*
https://social.example/*
```

A bare domain such as `example.com` matches the domain, its `www` version, subdomains, and page paths. Direct IPv4 addresses are also supported.

Each website has its own inactivity timeout, warning lead time, optional warning sound, and optional daily `From`/`To` schedule. Overnight schedules such as `23:00` to `07:00` are supported.

When multiple rules match, EdgeClose applies automatic specificity priority: exact URL/path patterns outrank broad domains; longer literal patterns outrank shorter patterns; wildcard-heavy patterns rank lower. Equal-priority rules retain their configuration order.

The timer is independent for every matching tab. A timer resets only after trusted real user interaction such as pointer, keyboard, wheel, touch, input, or change events on that tab. DOM updates, animations, network requests, media playback, and synthetic script-generated events do not reset the timer.

The background service worker remains authoritative for the close deadline and verifies wall-clock elapsed time before closing. A page-side deadline signal provides a second trigger for short timeouts when browser alarm delivery is delayed.

## Encrypted persistence and recovery

To survive extension removal, EdgeClose can maintain encrypted browser-independent backups in the browser's Downloads folder:

```text
Downloads\EdgeClose\config-audit.enc
Downloads\EdgeClose\recovery-key.enc
```

`config-audit.enc` contains encrypted local website configuration, pause state, audit history, and password-verification data. `recovery-key.enc` contains the RSA private recovery key encrypted using the settings password. Neither file is readable as plain configuration without the password and matching backup files.

The backup is refreshed automatically when configuration, password, or audit state changes. **Backup files remain normal user files and can still be deleted or replaced by someone who has filesystem permissions.** Encryption protects their contents from casual reading; it does not prevent deletion.

After reinstalling EdgeClose, use the protected Options page's **Restore encrypted backup** section and provide the settings password plus both backup files. If either file is missing or tampered with, restoration will fail.

## Administrator-managed settings

On organization-managed Edge devices, administrators can provide website rules through the included `managed_schema.json`. Managed policy has explicit precedence over local settings:

**Managed policy > local settings**

When managed policy is present, users can view the rules but cannot modify them. The Options page shows the current policy source, precedence, rule count, monitored-tab count, and pause state.

The extension cannot stop a user from disabling or uninstalling itself. For enterprise enforcement, administrators must deploy EdgeClose using Edge's `ExtensionSettings` policy with `installation_mode` set to `force_installed`.

## Audit log

The audit log records EdgeClose management events only and intentionally excludes passwords, password hashes, salts, browsing URLs, page titles, rule patterns, tokens, and secrets. A bounded local copy is kept in extension storage and the current state is also included in the encrypted backup.

## Privacy policy URL

After enabling GitHub Pages, the privacy policy is:

```text
https://ajayraikvar.github.io/EdgeClose/privacy-policy.html
```

The public repository includes a Pages deployment workflow. In GitHub, select **Settings > Pages > Build and deployment > Source > GitHub Actions** once.

## Releases and updates

The Options page checks public GitHub Releases for newer published versions. A normal Git commit is not a published release; create a GitHub Release and attach the matching ZIP after each version update.

The repository automatically builds a package named from `manifest.json`, so the release ZIP follows the current version (for example, `EdgeClose-1.6.0.zip`).

## Development

EdgeClose targets Manifest V3. Before publishing a release, validate JavaScript/JSON with repository CI and use the generated ZIP containing the exact source version from `manifest.json`.
