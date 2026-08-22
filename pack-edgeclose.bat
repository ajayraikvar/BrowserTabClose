@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-edgeclose.ps1"
if errorlevel 1 (
  echo.
  echo Packaging failed.
  pause
  exit /b 1
)
echo.
echo Packaging completed. Check the dist folder.
pause
endlocal
