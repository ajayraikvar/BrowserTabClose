# EdgeClose

EdgeClose is a Manifest V3 Microsoft Edge extension that closes tabs matching user-defined URL patterns after the computer has been idle for a chosen duration.

## Install locally

1. Open `edge://extensions` in Microsoft Edge.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this folder.
4. Select the EdgeClose toolbar icon to open settings.
5. Add one URL pattern per line and save.

Patterns support `*`, for example:

```text
https://www.example.com/*
https://social.example/*
```

The timeout is measured using the operating system idle state. EdgeClose displays a warning during the final 10 seconds, then closes matching tabs if you remain inactive. Returning to active use cancels the pending close. Matching tabs opened while the computer remains idle are also handled. An empty pattern list leaves tabs untouched.

The settings page automatically checks GitHub releases when opened and every six hours. A GitHub source repository cannot silently replace installed extension code. For genuine automatic installation, publish the extension through Microsoft Edge Add-ons; Edge will then manage signed updates automatically. Locally loaded unpacked builds must be updated by loading the new folder through `edge://extensions`.
