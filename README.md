# EdgeClose

EdgeClose is a Manifest V3 Microsoft Edge extension that closes tabs matching user-defined URL patterns after the computer has been idle for a chosen duration.

Read the [EdgeClose Privacy Policy](privacy-policy.html) before publishing. The extension stores only configuration and temporary tab-activity timestamps locally; it does not transmit browsing history or page content. The Options page contacts the public GitHub API only to show release versions.

### Permission disclosure for store review

EdgeClose requests `tabs` because it must inspect open tab URLs and close only tabs that match the user's configured patterns. It uses `<all_urls>` because users may configure any website and because matching tabs must receive the warning countdown overlay. It does not read page content or record input details; the content script reports only that a supported user interaction occurred.

## Install locally

1. Open `edge://extensions` in Microsoft Edge.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this folder, or upload `EdgeClose-1.1.6.zip` to Microsoft Edge Add-ons.
4. Select the EdgeClose toolbar icon to open settings.
5. Add one URL pattern per line and save.

Patterns support `*`, for example:

```text
https://www.example.com/*
https://social.example/*
```

You can also enter a domain without a protocol, such as `rgpvdiploma.in`; this matches the domain, its `www` version, and all page paths.

Each website has its own inactivity timeout, warning lead time, optional warning sound, and optional daily `From`/`To` schedule. Leave both schedule fields empty to keep a website active all day. Overnight schedules such as `23:00` to `07:00` are supported. Outside a website's schedule, its inactivity timer and warning are paused; a new session starts when the scheduled window begins. Use **Add website** in the Options page to configure multiple sites independently. Sound is played once when that website enters its warning period. Enable sound for a site and interact with it once after loading so the browser permits warning audio playback.

The timer is tracked separately for each matching tab. Mouse, keyboard, wheel, touch, and pointer actions on that tab reset its timer; activity on another tab does not. The user can choose how many seconds before timeout the warning appears, then the tab closes if the user remains inactive. Website DOM updates, animations, network activity, and floating bubbles do not reset the timer. An empty pattern list leaves tabs untouched.

Privacy policy URL after enabling GitHub Pages:

```text
https://ajayraikvar.github.io/EdgeClose/privacy-policy.html
```

The public repository includes a Pages deployment workflow. In GitHub, select **Settings > Pages > Build and deployment > Source > GitHub Actions** once. The workflow then publishes the policy after pushes to `main`.

The settings page automatically checks GitHub releases when opened and every six hours. A normal Git commit is not a published release, so create a GitHub Release and attach the matching ZIP after each version update. For automatic updates and administrator-managed installation, publish the ZIP through Microsoft Edge Add-ons.
