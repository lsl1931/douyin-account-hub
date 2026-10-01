@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem ===============================================================
rem Required environment variables. Read this before "fixing" them.
rem
rem   npm_config_cache       default npm cache lives outside this
rem                          folder and is not writable here.
rem   electron_config_cache  the name matters: ELECTRON_CACHE has NO
rem                          effect on @electron/get, this one does.
rem   ELECTRON_MIRROR        binary mirror, avoids slow/Blocked CDN.
rem   ELECTRON_RUN_AS_NODE   injected by DSH terminals. It degrades
rem                          electron.exe into plain Node and reports
rem                          a totally misleading error. Clear it.
rem
rem NOTE: this file must stay pure ASCII. cmd reads .cmd files using
rem the ANSI code page, so non-ASCII text (even inside rem) turns into
rem garbage bytes that can break parsing. A test enforces this.
rem ===============================================================

set "npm_config_cache=%~dp0.npm-cache"
set "electron_config_cache=%~dp0.electron-cache"
set "ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/"
set "ELECTRON_RUN_AS_NODE="

echo ============================================
echo   Douyin Account Hub - install
echo ============================================
echo.

echo [1/2] npm install
call npm install --no-audit --no-fund
if errorlevel 1 goto fail

echo.
echo [2/2] build + deploy
node "%~dp0scripts\deploy.mjs"
if errorlevel 1 goto fail

echo.
echo ============================================
echo   Done. Double-click start.cmd to launch.
echo ============================================
pause
exit /b 0

:fail
echo.
echo ============================================
echo   INSTALL FAILED - see the messages above
echo ============================================
pause
exit /b 1
