; installer-hooks.nsh — v9-3 窗口 B2（坑 35 修正：从 A3 的 custom.nsh 片段改造为
; Tauri 2 官方 NSIS installerHooks 形式）
;
; 背景（坑 35）：施工方案 §6.3 与 A3 的 custom.nsh 均假设 tauri.conf.json 的
; bundle.windows.nsis.template 是"override/!include 语义"，但实测安装的
; tauri-bundler 2.12.1（crates/tauri-bundler/src/bundle/windows/nsis/mod.rs:629-637）
; 是 `register_template_string("installer.nsi", read_to_string(path))` ——
; template 会**整体替换**默认 installer.nsi（~9466 行），片段式 custom.nsh 当
; template 会产出残缺安装器。经裁决（escalate 回复）改走官方 **installerHooks**
; 机制：默认模板在 4 个固定位置有 `!ifmacrodef NSIS_HOOK_*` 插入点
; （PREINSTALL=安装段开头 / POSTINSTALL=安装段末尾 / PREUNINSTALL=卸载段开头 /
;   POSTUNINSTALL=卸载段末尾），本文件被 !include 进默认模板后只需定义宏。
;
; v9-3 简化（裁决方案 a）：砍掉 A3 的自定义 CheckBox 页面（hooks 无 UI 机制），
; 行为改为默认执行：
;   · POSTINSTALL：把 $INSTDIR\bin 幂等追加到用户 PATH（HKCU，${WordAdd} 去重）；
;     检测到 VSCode（$LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe）时，把
;     bundle.resources 打进 $INSTDIR 的 resources\vscode-ext\*.vsix 拷到
;     $INSTDIR\vscode-ext\。v9-3 尚无 bin\ 目录（方案 A 无 CLI 产物），PATH 先
;     占位 —— Windows 忽略不存在的 PATH 目录，v9-4 落 bin\tts*.exe 后即通。
;   · POSTUNINSTALL：从用户 PATH 幂等移除 $INSTDIR\bin（${un.WordAdd}）+
;     kill 残留 tts-hub 进程 + 清理 $INSTDIR\vscode-ext 拷贝目录。
;
; 插件依赖：**不依赖 EnVar 插件**（Tauri 自带 NSIS 工具集
; %LOCALAPPDATA%\tauri\NSIS\Plugins\x86-unicode\ 无 EnVar.dll，
; nsis_tauri_utils.dll v0.5.3 也没有 PATH 操作导出）。
; PATH 追加/去重/移除用 NSIS 自带 WordFunc.nsh 的 ${WordAdd}/${un.WordAdd}
; （默认模板第 22 行已 !include WordFunc.nsh；已亲测 makensis 编译通过，
;  含卸载段 ${un.WordAdd}）。WM_SETTINGCHANGE 广播用 System.dll 调
; SendMessageTimeout，常量在本文件内 !define，不依赖宿主 include 顺序。
; 依据：施工方案-v0.9.0.md §6.3 + 裁决（坑 35，escalate 回复原文）。

; ── 自带常量（避免依赖宿主是否已 include WinMessages.nsh）──
!ifndef HWND_BROADCAST
  !define HWND_BROADCAST 0xFFFF
!endif
!ifndef WM_SETTINGCHANGE
  !define WM_SETTINGCHANGE 0x001A
!endif
; SendMessageTimeout_flags: SMTO_ABORTIFHUNG = 0x0002

!macro NSIS_HOOK_PREINSTALL
  ; v9-3 简化：安装前无需动作（占用进程已由默认模板 CheckIfAppIsRunning 处理）
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; ── 1. 把 $INSTDIR\bin 幂等追加到用户 PATH（HKCU\Environment\Path）──
  ; ${WordAdd} "$PATH" ";" "+entry"：entry 已存在则原样返回（去重），否则追加。
  ReadRegStr $R0 HKCU "Environment" "Path"
  ${WordAdd} "$R0" ";" "+$INSTDIR\bin" $R1
  ${If} $R1 != $R0
    WriteRegExpandStr HKCU "Environment" "Path" "$R1"
    ; 广播 WM_SETTINGCHANGE，让新开的进程立刻拿到新 PATH
    System::Call 'user32::SendMessageTimeout(p ${HWND_BROADCAST}, i ${WM_SETTINGCHANGE}, p 0, t "Environment", i 2, i 5000, *p .r2) i .r3'
  ${EndIf}

  ; ── 2. VSCode 插件：检测到 VSCode 才把打包进安装器的 .vsix 拷到 $INSTDIR\vscode-ext\
  ;       （tauri.conf.json bundle.resources 的 "resources/vscode-ext" 使 .vsix
  ;         落 <resource_dir>\resources\vscode-ext\，Tauri 的 resource_dir=$INSTDIR）
  ${If} ${FileExists} "$LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
    ${If} ${FileExists} "$INSTDIR\resources\vscode-ext\*.vsix"
      CreateDirectory "$INSTDIR\vscode-ext"
      CopyFiles /SILENT "$INSTDIR\resources\vscode-ext\*.vsix" "$INSTDIR\vscode-ext\"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; v9-3 简化：卸载前无需动作
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; ── 1. 从用户 PATH 幂等移除 $INSTDIR\bin（${un.WordAdd} 的 "-entry" 删除形态）──
  ReadRegStr $R0 HKCU "Environment" "Path"
  ${If} $R0 != ""
    ${un.WordAdd} "$R0" ";" "-$INSTDIR\bin" $R1
    ${If} $R1 != $R0
      WriteRegExpandStr HKCU "Environment" "Path" "$R1"
      System::Call 'user32::SendMessageTimeout(p ${HWND_BROADCAST}, i ${WM_SETTINGCHANGE}, p 0, t "Environment", i 2, i 5000, *p .r2) i .r3'
    ${EndIf}
  ${EndIf}

  ; ── 2. kill 残留 tts-hub 进程（node.exe 窗口标题匹配 tts-hub*；2>nul 吞掉无匹配时的非零码）──
  nsExec::ExecToStack 'taskkill /F /IM node.exe /FI "WINDOWTITLE eq tts-hub*" 2>nul'
  Pop $R0

  ; ── 3. 清理安装时生成的 vscode-ext 拷贝目录（resources\ 由默认卸载逻辑随 $INSTDIR 递归删除）──
  RMDir /r "$INSTDIR\vscode-ext"
!macroend
