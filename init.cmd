@echo off
REM init.cmd — Windows wrapper for cmd.exe and PowerShell. The gate itself is init.mjs.
REM Run as:  init.cmd     (cmd)      or  .\init.cmd  (PowerShell)
REM Do not add logic here; see init.sh for why.
where node >nul 2>nul || (echo init.cmd: node is required ^(every harness tool is a .mjs^).& exit /b 1)
node "%~dp0init.mjs" %*
