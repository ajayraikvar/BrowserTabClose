@echo off
setlocal
rem Replace this value with the EdgeClose extension ID from edge://extensions.
set "EXTENSION_ID=REPLACE_WITH_EDGECLOSE_EXTENSION_ID"
if "%EXTENSION_ID%"=="REPLACE_WITH_EDGECLOSE_EXTENSION_ID" (
	echo ERROR: Set EXTENSION_ID before running this file.
	exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0uninstall-edgeclose.ps1\" -ExtensionId %EXTENSION_ID%'"
endlocal
