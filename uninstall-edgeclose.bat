@echo off
setlocal
rem Optional: set EXTENSION_ID for an exact policy match.
set "EXTENSION_ID="
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0uninstall-edgeclose.ps1\" -ExtensionId \"%EXTENSION_ID%\"'"
endlocal
