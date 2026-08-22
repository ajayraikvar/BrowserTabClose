@echo off
setlocal

rem Run this file as Administrator.
rem Replace this value with the EdgeClose extension ID from edge://extensions.
set "EXTENSION_ID=REPLACE_WITH_EDGECLOSE_EXTENSION_ID"
set "EDGE_UPDATE_URL=https://edge.microsoft.com/extensionwebstorebase/v1/crx"

if "%EXTENSION_ID%"=="REPLACE_WITH_EDGECLOSE_EXTENSION_ID" (
  echo ERROR: Set EXTENSION_ID before running this file.
  exit /b 1
)

fltmc >nul 2>&1
if errorlevel 1 (
  echo ERROR: Right-click this file and select "Run as administrator".
  exit /b 1
)

reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "%EXTENSION_ID%;%EDGE_UPDATE_URL%" /f
if errorlevel 1 (
  echo ERROR: Could not create the Edge policy.
  exit /b 1
)

echo EdgeClose is now force-installed by Edge policy.
echo Restart Edge or open edge://policy and select Reload policies.
endlocal
