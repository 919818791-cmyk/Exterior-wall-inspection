@echo off
setlocal EnableExtensions

if /I "%~1"=="backend" goto run_backend
if /I "%~1"=="frontend" goto run_frontend

cd /d "%~dp0"
title Building Exterior Launcher

if not exist "backend\app\main.py" (
  echo [ERROR] backend\app\main.py was not found.
  goto failed
)
if not exist "frontend\package.json" (
  echo [ERROR] frontend\package.json was not found.
  goto failed
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js and try again.
  goto failed
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo [SETUP] Creating the backend virtual environment...
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 -m venv "backend\.venv"
  ) else (
    where python >nul 2>nul
    if errorlevel 1 (
      echo [ERROR] Python was not found. Install Python 3.11 or newer.
      goto failed
    )
    python -m venv "backend\.venv"
  )
  if errorlevel 1 goto failed
)

"backend\.venv\Scripts\python.exe" -c "import uvicorn" >nul 2>nul
if errorlevel 1 (
  echo [SETUP] Installing backend dependencies...
  "backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
  if errorlevel 1 goto failed
)

if not exist "frontend\node_modules\.bin\vite.cmd" (
  echo [SETUP] Installing frontend dependencies...
  pushd "frontend"
  call npm install
  if errorlevel 1 (
    popd
    goto failed
  )
  popd
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo [START] Backend: http://127.0.0.1:8000
  start "Building Exterior Backend" "%~f0" backend
) else (
  echo [SKIP] Port 8000 is already in use; backend was not started again.
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5175 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo [START] Frontend: http://localhost:5175
  start "Building Exterior Frontend" "%~f0" frontend
) else (
  echo [SKIP] Port 5175 is already in use; frontend was not started again.
)

echo.
echo Startup commands have been sent. Docker services are not managed by this script.
echo Close this window at any time; the frontend and backend windows will remain open.
exit /b 0

:run_backend
cd /d "%~dp0backend"
title Building Exterior Backend
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo Backend is already running at http://127.0.0.1:8000.
  echo A second backend process was not started.
  exit /b 0
)
echo [SETUP] Applying backend database migrations...
".venv\Scripts\python.exe" -m alembic upgrade head
if errorlevel 1 (
  echo [ERROR] Backend database migration failed.
  goto failed
)
echo Backend logs will appear in this window.
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
echo.
echo Backend exited. Press any key to close this window.
pause >nul
exit /b %errorlevel%

:run_frontend
cd /d "%~dp0frontend"
title Building Exterior Frontend
echo Frontend logs will appear in this window.
call npm run dev
echo.
echo Frontend exited. Press any key to close this window.
pause >nul
exit /b %errorlevel%

:failed
echo.
echo Startup failed. Review the error above, then press any key to close.
pause >nul
exit /b 1
