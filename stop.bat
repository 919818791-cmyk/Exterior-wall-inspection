@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Building Exterior Stopper

echo [STOP] Closing frontend and backend windows...
taskkill /FI "WINDOWTITLE eq Building Exterior Backend*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq Building Exterior Frontend*" /T /F >nul 2>nul

rem Fall back to the fixed development ports if a terminal host changed its title.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = 8000, 5175;" ^
  "foreach ($port in $ports) {" ^
  "  Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |" ^
  "    Select-Object -ExpandProperty OwningProcess -Unique |" ^
  "    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" ^
  "}"

echo [DONE] Frontend and backend have been stopped.
echo Docker services were left unchanged.
exit /b 0
