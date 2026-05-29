@echo off
cd /d "%~dp0web"
echo [BUILD] Building frontend...
call npm run build
echo [BUILD] Done!
pause
