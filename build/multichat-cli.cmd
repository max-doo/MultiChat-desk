@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0MultiChat.exe" "%~dp0resources\cli\index.js" %*
endlocal
