@echo off
REM harness/init.cmd — Windows wrapper for cmd.exe and PowerShell. The gate itself is init.mjs.
REM Run as:  harness/init.cmd     (cmd)      or  .\harness/init.cmd  (PowerShell)
REM Do not add logic here; see init.sh for why.
where node >nul 2>nul || (echo harness/init.cmd: node is required ^(every harness tool is a .mjs^).& exit /b 1)
node "%~dp0init.mjs" %*
