@echo off
setlocal EnableExtensions

rem This file must stay pure ASCII: cmd reads .cmd using the ANSI code
rem page, so non-ASCII text (even in rem) becomes garbage bytes that can
rem break parsing. See install.cmd for the full explanation.

rem ELECTRON_RUN_AS_NODE is injected by DSH terminals; it makes
rem electron.exe behave as plain Node and fail with a misleading error.
set "ELECTRON_RUN_AS_NODE="

set "HUB=%LOCALAPPDATA%\DouyinAccountHub"
if defined DYHUB_ROOT set "HUB=%DYHUB_ROOT%"

set "EXE=%HUB%\runtime\electron\electron.exe"
set "APP=%HUB%\runtime\app"

if not exist "%EXE%" goto notinstalled
if not exist "%APP%\package.json" goto notinstalled

start "" "%EXE%" "%APP%"
exit /b 0

:notinstalled
echo ============================================
echo   Not installed yet.
echo   Run install.cmd first.
echo.
echo   Expected: %EXE%
echo ============================================
pause
exit /b 1
