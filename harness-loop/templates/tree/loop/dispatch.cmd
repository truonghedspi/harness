@echo off
REM Compatibility wrapper only. Cross-platform dispatch logic belongs in dispatch.mjs.
node "%~dp0dispatch.mjs" %*
