@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if errorlevel 1 (
  echo.
  echo Installation did not finish successfully.
  pause
) else (
  echo.
  echo Installation complete. You can now open Portal Field Laboratory from the Desktop or Start menu.
  pause
)
