!ifndef BUILD_UNINSTALLER
  # nsDialogs 会连带引入 LogicLib / WinMessages（HWND_BROADCAST / WM_SETTINGCHANGE / BST_CHECKED）
  !include nsDialogs.nsh

  Var CliPathCheckbox
  Var CliAddToPath

  # 静默安装 / 更新流程跳过自定义页时的默认值：1 = 安装 CLI 并加入 PATH
  !macro customInit
    StrCpy $CliAddToPath "1"
  !macroend

  !macro customPageAfterChangeDir
    Page custom CliOptionsPageCreate CliOptionsPageLeave
  !macroend

  Function CliOptionsPageCreate
    GetDlgItem $1 $HWNDPARENT 1037
    SendMessage $1 ${WM_SETTEXT} 0 "STR:可选功能"
    GetDlgItem $1 $HWNDPARENT 1038
    SendMessage $1 ${WM_SETTEXT} 0 "STR:命令行工具（供终端与 AI Agent 调用）"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 14u "命令行工具 multichat"
    Pop $1

    ${NSD_CreateCheckbox} 0 24u 100% 14u "安装 multichat 命令并加入 PATH（推荐）"
    Pop $CliPathCheckbox
    ${NSD_SetState} $CliPathCheckbox ${BST_CHECKED}

    ${NSD_CreateLabel} 14u 46u 86% 34u "安装后可在任意终端及 AI Agent（Codex、Claude Code 等）中调用 multichat 驱动本应用；卸载时会自动从 PATH 移除。"
    Pop $1

    nsDialogs::Show
  FunctionEnd

  Function CliOptionsPageLeave
    ${NSD_GetState} $CliPathCheckbox $CliAddToPath
  FunctionEnd

  # 按分号分段精确匹配 HKCU Path 中是否已存在 $INSTDIR\cli；结果写入 $9（"1"/"0"）
  Function CliPathHasCliDir
    StrCpy $9 "0"
    ReadRegStr $0 HKCU "Environment" "Path"
    StrCpy $4 $0
    ${While} $4 != ""
      StrLen $5 $4
      StrCpy $6 0
      ${While} $6 < $5
        StrCpy $7 $4 1 $6
        ${If} $7 == ";"
          ${ExitWhile}
        ${EndIf}
        IntOp $6 $6 + 1
      ${EndWhile}
      StrCpy $8 $4 $6
      IntOp $2 $6 + 1
      StrLen $3 $4
      IntOp $3 $3 - $2
      ${If} $3 > 0
        StrCpy $4 $4 $3 $2
      ${Else}
        StrCpy $4 ""
      ${EndIf}
      ${If} $8 == "$INSTDIR\cli"
        StrCpy $9 "1"
        ${ExitWhile}
      ${EndIf}
    ${EndWhile}
  FunctionEnd

  Function AddCliDirToPath
    Call CliPathHasCliDir
    ${If} $9 == "1"
      Return
    ${EndIf}
    ReadRegStr $0 HKCU "Environment" "Path"
    ${If} $0 == ""
      StrCpy $1 "$INSTDIR\cli"
    ${Else}
      StrCpy $2 $0 1 -1
      ${If} $2 == ";"
        StrCpy $1 "$0$INSTDIR\cli"
      ${Else}
        StrCpy $1 "$0;$INSTDIR\cli"
      ${EndIf}
    ${EndIf}
    # WriteRegExpandStr 保住 REG_EXPAND_SZ，避免展开型 PATH 项被固化
    WriteRegExpandStr HKCU "Environment" "Path" $1
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  FunctionEnd

  !macro customInstall
    ${If} $CliAddToPath == "1"
      Call AddCliDirToPath
    ${EndIf}
    # electron-builder 不写 InstallLocation；补写供 Agent/脚本从卸载键反推安装目录定位 CLI
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  !macroend

  !macro customFinishPage
    !ifndef HIDE_RUN_AFTER_FINISH
      Function StartApp
        ${if} ${isUpdated}
          StrCpy $1 "--updated"
        ${else}
          StrCpy $1 ""
        ${endif}
        
        # 检查安装程序当前的权限级别
        UserInfo::GetAccountType
        Pop $0
        ${If} $0 == "Admin"
          # 如果以管理员权限运行安装包，使用 ExecShellAsUser 降权启动
          # 这里改用直接的可执行文件路径，避免使用快捷方式链接 $launchLink 时由于 Shell 刷新延迟或 COM 降权通信超时导致安装程序卡死 1 分钟左右
          ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\MultiChat.exe" "open" "$1"
        ${Else}
          # 如果是普通用户权限运行，则直接使用普通 ExecShell 启动，不触发降权逻辑
          ExecShell "open" "$INSTDIR\MultiChat.exe" "$1"
        ${EndIf}
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
    StrCpy $0 "$INSTDIR\MultiChat.exe"
    StrCpy $1 "$PLUGINSDIR\pin_to_taskbar.ps1"

    FileOpen $2 $1 w
    FileWrite $2 "param([string]$$ExePath)$\r$\n"
    FileWrite $2 "$$ErrorActionPreference = 'SilentlyContinue'$\r$\n"
    FileWrite $2 "if (-not (Test-Path -LiteralPath $$ExePath)) { exit 0 }$\r$\n"
    FileWrite $2 "$$lnkPath = Join-Path $$env:TEMP 'MultiChat-taskbar-pin.lnk'$\r$\n"
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

    ExecWait '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\pin_to_taskbar.ps1" -ExePath "$INSTDIR\MultiChat.exe"'
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
    Call un.RemoveCliDirFromPath
  !macroend

  # 从 HKCU Path 中精确移除 $INSTDIR\cli 分段并广播变更
  Function un.RemoveCliDirFromPath
    ReadRegStr $0 HKCU "Environment" "Path"
    StrCpy $R0 ""
    StrCpy $R1 "0"
    StrCpy $4 $0
    ${While} $4 != ""
      StrLen $5 $4
      StrCpy $6 0
      ${While} $6 < $5
        StrCpy $7 $4 1 $6
        ${If} $7 == ";"
          ${ExitWhile}
        ${EndIf}
        IntOp $6 $6 + 1
      ${EndWhile}
      StrCpy $8 $4 $6
      IntOp $2 $6 + 1
      StrLen $9 $4
      IntOp $9 $9 - $2
      ${If} $9 > 0
        StrCpy $4 $4 $9 $2
      ${Else}
        StrCpy $4 ""
      ${EndIf}
      ${If} $8 == "$INSTDIR\cli"
        StrCpy $R1 "1"
      ${ElseIf} $8 != ""
        ${If} $R0 == ""
          StrCpy $R0 $8
        ${Else}
          StrCpy $R0 "$R0;$8"
        ${EndIf}
      ${EndIf}
    ${EndWhile}
    ${If} $R1 == "1"
      WriteRegExpandStr HKCU "Environment" "Path" $R0
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
    ${EndIf}
  FunctionEnd

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
