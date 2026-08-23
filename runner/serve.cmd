@echo off
rem Schedule server launcher. Runs from this runner folder no matter where invoked.
rem Double-click, or run from any directory.
cd /d "%~dp0"
node serve.js %*
pause
