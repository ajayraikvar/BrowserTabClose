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

The timeout is measured using the operating system idle state. Matching tabs are closed when the idle threshold is reached, including tabs opened while the computer remains idle. An empty pattern list leaves tabs untouched.

The settings page includes a GitHub release check. Edge extensions loaded unpacked cannot silently replace their own files; when a release is available, install the downloaded update by loading the updated folder through `edge://extensions`.
