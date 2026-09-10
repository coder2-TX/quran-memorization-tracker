@echo off
setlocal
cd /d "%~dp0"
echo.
echo ============================================
echo   Quran Memorization Tracker - Local Test
echo ============================================
echo.
where php >nul 2>nul
if errorlevel 1 (
  echo PHP was not found in PATH.
  echo Open VS Code terminal in this folder and run your usual PHP command.
  echo.
  pause
  exit /b 1
)
echo Opening: http://127.0.0.1:8080
echo To stop the server press Ctrl+C.
echo.
start "" "http://127.0.0.1:8080"
php -S 127.0.0.1:8080
endlocal
