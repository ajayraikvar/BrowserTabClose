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

You can also enter a domain without a protocol, such as `rgpvdiploma.in`; this matches the domain, its `www` version, and all page paths.

Each website has its own inactivity timeout, warning lead time, and optional warning sound. Use **Add website** in the Options page to configure multiple sites independently. Sound is played once when that website enters its warning period. Enable sound for a site and interact with it once after loading so the browser permits warning audio playback.

The timer is tracked separately for each matching tab. Mouse, keyboard, wheel, touch, and pointer actions on that tab reset its timer; activity on another tab does not. The user can choose how many seconds before timeout the warning appears, then the tab closes if the user remains inactive. Website DOM updates, animations, network activity, and floating bubbles do not reset the timer. An empty pattern list leaves tabs untouched.

The settings page automatically checks GitHub releases when opened and every six hours. It shows the installed version and available published release versions. A GitHub source repository cannot silently replace installed extension code. For genuine automatic installation, publish the extension through Microsoft Edge Add-ons; Edge will then manage signed updates automatically. Locally loaded unpacked builds must be updated by loading the new folder through `edge://extensions`.

## Administrator-only uninstall

The extension cannot prevent uninstall through JavaScript or `manifest.json`. An organization administrator must force-install it with Microsoft Edge enterprise policy. A force-installed extension cannot be removed by a normal user; the administrator must remove the policy first.

For a signed Edge Add-ons or self-hosted package, configure the Windows policy `ExtensionInstallForcelist` under:

```text
HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist
```

Create a string value such as `1` with this format:

```text
EXTENSION_ID;UPDATE_MANIFEST_URL
```

Use the extension ID from `edge://extensions`. The update manifest URL must point to the signed package's supported update manifest. Do not use the GitHub repository URL as an update manifest. This policy requires administrator access and should be deployed through Group Policy or Microsoft Intune.

The current GitHub folder is an unpacked development build. It can be loaded for testing, but administrator-only uninstall and automatic updates require a packaged deployment through Edge Add-ons or an enterprise-managed update server.

### Admin installer

Use `install-edgeclose-admin.bat` only after EdgeClose has been published as a signed Edge Add-ons extension:

1. Open `edge://extensions`, copy the EdgeClose Extension ID, and put it in the batch file as `EXTENSION_ID`.
2. Right-click `install-edgeclose-admin.bat` and select **Run as administrator**.
3. Restart Edge, or open `edge://policy` and choose **Reload policies**.

The batch file targets only the configured EdgeClose Extension ID. It does not grant administrator rights to the extension and cannot make an unpacked GitHub folder force-installable. A user who is themselves a Windows administrator can still remove or change local policies; this protects standard users on an administrator-managed device.

### One-click GitHub installer

Run `install-edgeclose.bat` to request administrator rights, download the latest `main` branch from GitHub, install the files under `%ProgramData%\EdgeClose`, validate `manifest.json`, and open `edge://extensions`. Edge still requires one manual **Load unpacked** selection of `%ProgramData%\EdgeClose`; this final click cannot be automated by a batch file because Edge blocks silent unpacked-extension installation. This installer does not grant the extension extra browser permissions and does not prevent uninstall by itself.

You can also run it directly from an already elevated PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& .\install-edgeclose.ps1
```

The command performs the download and installation preparation automatically. Administrator PowerShell does not remove Edge's final confirmation for an unpacked extension. To install without that click, the extension must be signed and deployed using Edge Add-ons or an enterprise force-install policy.
