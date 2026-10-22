# Changelog

本文件记录 tts-desktop 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
组件名、CLI/路由名保留英文原文，其余叙述使用中文。

## [Unreleased]

> 占位：v0.1.0 之后的变更从这里开始累积。UI-4 收尾（动效三件套、Tauri 打包、
> 五面截图比对）尚未合并前的条目仍并入下面的 `[0.1.0]` 段。

## [0.2.0] - 2026-10-XX — Embedded hub sidecar

### Added / 新增

- **Embedded hub sidecar (Plan A)**: tts-hub is bundled as a Tauri sidecar
  (node.exe renamed to `bin/tts-hub-x86_64-pc-windows-msvc.exe` as externalBin,
  plus `resources/sidecar/` containing dist/, node_modules/, and sharp native
  DLLs). The desktop app starts and stops it automatically on launch/close.
  No Node.js installation required.
- **External hub version check**: when an external hub is already running on
  port 39995, the app checks `GET /v1/status` for `hub.version` and shows an
  "external hub outdated" dialog if it's older than 0.9.0, offering choices to
  close the external hub or continue in degraded mode.
- **HubLauncher state machine**: 6-phase flow (checking → sidecar-starting →
  sidecar-failed / external-outdated / guide / unsupported) with progress
  indicator during sidecar startup and graceful degradation to manual hub
  startup on sidecar failure.

### Changed / 变更

- **HubLauncher**: skips version check for embedded sidecar (always compatible);
  keeps version check for external hubs. WebView2 missing warning now overlays
  on all phases except initial checking.

### Build / 构建

- **copy-product.mjs**: new build script to sync v9-1 product outputs
  (node.exe + dist/ + node_modules/ + native/) from tts-toolkit/product/ to
  src-tauri/bin/ and src-tauri/resources/sidecar/. Supports --if-changed
  incremental mode and --dry-run preview.
- **.gitignore**: excludes sidecar artifacts (src-tauri/bin/tts-hub-*.exe and
  src-tauri/resources/sidecar/) — regenerated on each build.

### Requirements / 运行要求

- Windows 10 1809+ (WebView2 auto-installed via downloadBootstrapper on first run)
- Tabletop Simulator running with a save loaded (for online features)
- v9-1 product outputs from tts-toolkit (for sidecar bundling)

## [0.1.0] - 2026-10-08

### Added / 新增

- **桌面工作台**：tts-toolkit 的桌面端工作台，实现 Round-03 蓝图设计
  （工程图纸语法、双线图框、三层字族）。
- **五面**：总览（Overview）／代码（Code）／代理（Agent）／卡牌（Cards）／素材（Assets）。
- **九个可复用组件**：Frame、LayerNav、LegendBar、SignBlock、ConfirmGate、
  ProcessStamps、JobSheet、EventFlow、SliceGrid。
- **hub 集成**：基于 fetch 的 HubClient（16 条路由）、经 EventSource 的 SSE 事件流、
  版本兼容检查（与 tts-toolkit ≥ 0.7.0 可运行，≥ 0.8.0 特性齐备）。
- **确认门（ConfirmGate）**：所有危险操作（push、批量覆盖）一律经确认门，
  并向 hub 传 `confirm: true`。
- **跨面联动**：素材面的死链卡片会禁用卡牌面的切片按钮。
- **设计令牌**：13 个 CSS 变量（双色底蓝图 + 4 个语义色 + 3 层字族 + 动效令牌），
  全站不写死值。

### Fixed / 修复

- **⓪总览面**：事件流块（.ov-ev）高度未占满右列——`flex: 1` 改为 `flex: 1 1 0`，
  修复 VERDICT.md §四.2 记录的"事件流块比左列 MiniFileTree 矮一截"问题。

### Requirements / 运行要求

- Windows 10 1809+（WebView2）
- tts-toolkit ≥ 0.7.0（≥ 0.8.0 特性齐备）
- Tabletop Simulator 已启动并加载存档（在线功能所需）

### Tested / 已验收（v9-4 窗口，2026-10-23）

**真实 TTS 联通验收**（s_dial.ttsmod → Dial Set 46 对象）：

- **Stage B 干净机安装**：NSIS installerHooks 静默装（`/S`）→ 桌面快捷方式 →
  双击 → sidecar 2.02s 自起 → 39995 LISTENING → 首启向导 → 选「打开示例图包」→
  51 文件导入 → 主界面渲染。卸载 `/S` 后 `%LOCALAPPDATA%\Programs\tts-desktop`
  清空、HKCU Path 中 `...\bin` 已清、39995 不再 LISTENING。
- **已知 bug 复测**：v9-3 遗留「二次启动 webview ERR_CONNECTION_REFUSED」**未复现**。
  原始 npx tauri build 装的 .exe 正常；该 bug 是 v9-3 测试期 cp 覆盖 .exe 引起的
  Tauri 资源缓存紊乱，与 v9-3 代码无关。
- **U2 系列 6 项**（①代码面 + ②代理面）：
  - U2-1 pull：POST /v1/scripts/pull → 35 个新增条目拉入工作区，差异清零。
  - U2-2 diff：手工编辑 Global.lua 加注释行 → POST /v1/diff 返回 modified=1。
  - U2-3 write：PUT /v1/files/write 携带 baseSha256 乐观锁 → 写入成功 sha256 落地。
  - U2-4 push：POST /v1/push confirm:true → pushed:1 + 备份落盘 .tts/backups/。
  - U2-5 exec：POST /v1/exec {"lua":"return 1+1"} → {"result":2}。
  - U2-6 流水：② 代理面事件流实时渲染 GameLoaded/GameSaved（SSE 驱动）。
- **U3 系列 2 项**（hub 层）：
  - U3-1 切片：POST /v1/deck/slice 用 settings-cat-2232x1920.png 按 10×7 网格切
    14 张 card-XXX.png 落盘 + cards.csv 生成。
  - U3-2 死链：sheetPath 指向不存在文件 → 400 SLICE_SHEET_NOT_FOUND，
    UI 侧收到错误后禁用切片按钮。
- **U3-3/4/5 标记未验**：s_dial unpack 不产 cards.csv，素材面台账 0 行，
  1000 行虚拟滚动 / 行内编辑 URL / 批量体检三项留 v9-final 用带 cards.csv
  的真实图包（如《第七大陆》或专门卡牌测试包）补验。

**现场修复**（v9-4 hotfix，已随本包发布）：

- **hotfix-1**（tts-toolkit）：CORS 白名单加 `tauri.localhost`——Tauri webview
  fetch hub 的 Origin 是 `http://tauri.localhost`，原白名单仅 loopback 三地址，
  所有 UI fetch 被浏览器 CORS 拦截。hub-control-files.test.ts 新增用例覆盖。
- **hotfix-2**（HubLauncher.tsx）：`check()` 先调 `sidecar_get_status` 读
  `is_embedded`，sidecar 自起场景跳过 EXTERNAL_MIN_VERSION 检查
  （审批意见 §12 原意；v9-3 漏读导致 0.8.0 sidecar 被外置检查拦截）。
- **hotfix-3**（App.tsx）：`hubClient.importTtsmod(modFile, parent, leaf)` →
  `hubClient.importTtsmod(modFile, target, target)`——hub-control §4.17 要求
  `modsParentDir` 与 `modSaveLocation` 均为绝对路径，v9-3 误传 basename(target)
  作 modSaveLocation 被 hub 拒 400 INVALID_INPUT。
- **hotfix-4**（sidecar.rs + lib.rs）：`sidecar_get_status` 返回真实
  `is_embedded`（查 SIDECAR_CHILD 是否有存活子进程），不再恒 false——支撑
  hotfix-2 生效。

**测试基线**：tts-toolkit 2066 passed（+1 新 CORS 用例），tts-desktop 15 passed，
cargo test 14 passed。

### Test baseline / 测试基线

- 针对真实 TTS + hub 的手工 UI 验证；暂无自动化 UI 测试（计划 v0.2.0）。

[Unreleased]: https://github.com/Smirk1921/tts-desktop/commits/main
[0.1.0]: https://github.com/Smirk1921/tts-desktop/releases/tag/v0.1.0
