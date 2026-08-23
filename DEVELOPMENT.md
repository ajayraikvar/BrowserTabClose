# EdgeClose private development

This private repository is for local development and organization-managed builds. The public Edge Add-ons package should contain only the runtime extension files.

## Local workflow

1. Edit the extension files in this folder.
2. Load the folder through `edge://extensions` with Developer mode enabled.
3. Open EdgeClose settings from the toolbar action.
4. Use a short timeout while testing, such as 30 seconds.
5. Test warning behavior, tab activity reset, child tabs opened with `target="_blank"`, and optional sound.
6. Run `pack-edgeclose.bat` when a signed CRX build is needed.

## Customization points

- `options.js` and `options.html`: settings fields and per-site configuration.
- `background.js`: URL matching, per-tab timers, alarms, child-tab inheritance, and tab closing.
- `content.js` and `content.css`: warning overlay and sound behavior.
- `options.css`: local Options page appearance.
- `manifest.json`: extension permissions and version.

## Local testing rules

Use test domains you control or sites where closing a tab is safe. Keep test timeouts short, but use a warning period smaller than the timeout. Mouse, keyboard, touch, pointer, and wheel events reset the active tab timer. DOM changes and network activity do not reset it.

Do not commit passwords, private signing keys, CRX files, browser profiles, or user data. The repository ignores generated package and PEM files.
