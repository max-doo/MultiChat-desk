@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\MultiChat.exe" "%~dp0..\resources\cli\index.js" %*
endlocal & exit /b %ERRORLEVEL%
