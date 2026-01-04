!ifndef BUILD_UNINSTALLER
  !macro customFinishPage
    !ifndef HIDE_RUN_AFTER_FINISH
      Function StartApp
        ${if} ${isUpdated}
          StrCpy $1 "--updated"
        ${else}
          StrCpy $1 ""
        ${endif}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
      FunctionEnd

      !define MUI_FINISHPAGE_RUN
      !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
    !endif

    !define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\readme.txt"
    !define MUI_FINISHPAGE_SHOWREADME_TEXT "固定到任务栏"
    !define MUI_FINISHPAGE_SHOWREADME_FUNCTION PinToTaskbar
    !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

    !insertmacro MUI_PAGE_FINISH
  !macroend

  Function PinToTaskbar
    StrCpy $0 "$INSTDIR\ModelMash.exe"
    StrCpy $1 "$PLUGINSDIR\pin_to_taskbar.ps1"

    FileOpen $2 $1 w
    FileWrite $2 "param([string]$$ExePath)$\r$\n"
    FileWrite $2 "$$ErrorActionPreference = 'SilentlyContinue'$\r$\n"
    FileWrite $2 "if (-not (Test-Path -LiteralPath $$ExePath)) { exit 0 }$\r$\n"
    FileWrite $2 "$$lnkPath = Join-Path $$env:TEMP 'ModelMash-taskbar-pin.lnk'$\r$\n"
    FileWrite $2 "$$wsh = New-Object -ComObject WScript.Shell$\r$\n"
    FileWrite $2 "$$s = $$wsh.CreateShortcut($$lnkPath)$\r$\n"
    FileWrite $2 "$$s.TargetPath = $$ExePath$\r$\n"
    FileWrite $2 "$$s.WorkingDirectory = (Split-Path -Path $$ExePath)$\r$\n"
    FileWrite $2 "$$s.Save()$\r$\n"
    FileWrite $2 "$$shell = New-Object -ComObject Shell.Application$\r$\n"
    FileWrite $2 "$$folder = $$shell.Namespace((Split-Path -Path $$lnkPath))$\r$\n"
    FileWrite $2 "$$item = $$folder.ParseName((Split-Path -Path $$lnkPath -Leaf))$\r$\n"
    FileWrite $2 "if ($$null -ne $$item) { $$item.InvokeVerb('taskbarpin') }$\r$\n"
    FileWrite $2 "Remove-Item -LiteralPath $$lnkPath -Force$\r$\n"
    FileClose $2

    ExecWait '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\pin_to_taskbar.ps1" -ExePath "$INSTDIR\ModelMash.exe"'
  FunctionEnd
!else
  !include nsDialogs.nsh

  Var UnClearCacheCheckbox
  Var UnShouldClearCache

  !macro customCheckAppRunning
    nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO csv | %SYSTEMROOT%\System32\find.exe "${APP_EXECUTABLE_FILENAME}"`
    Pop $0
    ${If} $0 == 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "检测到 ${PRODUCT_NAME} 正在运行，请先退出后再卸载。"
      Quit
    ${EndIf}
  !macroend

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.ClearCachePageCreate un.ClearCachePageLeave
  !macroend
  
  !macro customUnInit
    Call un.checkAppRunning
  !macroend

  !macro customUnInstall
    ${If} $UnShouldClearCache == "1"
      Call un.DeleteLocalCache
    ${EndIf}
  !macroend

  Function un.ClearCachePageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "可选：删除本机缓存与登录信息（Cookie/Session）。"
    Pop $1

    ${NSD_CreateCheckbox} 0 32u 100% 12u "清除本地缓存"
    Pop $UnClearCacheCheckbox

    nsDialogs::Show
  FunctionEnd

  Function un.ClearCachePageLeave
    ${NSD_GetState} $UnClearCacheCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $UnShouldClearCache "1"
    ${Else}
      StrCpy $UnShouldClearCache "0"
    ${EndIf}
  FunctionEnd

  Function un.DeleteLocalCache
    StrCpy $0 "$APPDATA\${APP_FILENAME}"
    RMDir /r "$0\Cache"
    RMDir /r "$0\GPUCache"
    RMDir /r "$0\Code Cache"
    RMDir /r "$0\Session"
    RMDir /r "$0\Partitions\shared"
    !ifdef APP_PACKAGE_NAME
      StrCpy $1 "$APPDATA\${APP_PACKAGE_NAME}"
      RMDir /r "$1\Cache"
      RMDir /r "$1\GPUCache"
      RMDir /r "$1\Code Cache"
      RMDir /r "$1\Session"
      RMDir /r "$1\Partitions\shared"
    !endif
  FunctionEnd
!endif
