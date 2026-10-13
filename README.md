# tts-desktop

> TTS 图包工作台 — 蓝图纸语言桌面应用
>
> Round-03 设计方案（[ui-design/round-03](https://github.com/Smirk1921/tts-toolkit)）的 Tauri 2 + React 19 实现。
> v0.9.0 窗口 v9-3：一体化安装包（NSIS installerHooks 加 PATH / 首次向导 / 示例图包）完工。

## 前置依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| Windows | **10 1809+ / 11** | 仅 Windows（v0.1.0 不做跨平台） |
| WebView2 Runtime | 任意 | Win10 1809+ 自带；缺失时 HubLauncher 引导面板顶部红条提示 + 一键下载 |
| tts-toolkit (CLI) | 内嵌 | v0.1.0 起一体化安装包**自带 `tts-hub` sidecar**（v9-2 落地），无需用户手动 `npm install -g`。外置模式仍需 ≥0.9.0 |
| Tabletop Simulator | 任意 Steam 版 | 联通功能需要；UI 空骨架可独立浏览 |
| Node.js | **24+** | 仅开发期需要 |
| Rust | **1.99+** (stable-msvc) | 仅开发期需要；`rustup` 安装 |
| VS Build Tools 2022 | C++ 工作负载 | 仅开发期需要；含 MSVC + Windows SDK |

## 快速开始（用户）

**v0.1.0 一体化安装包**（推荐，5 分钟上手）：

1. 下载并运行 `tts-desktop_0.1.0_x64-setup.exe`
2. 双击桌面「TTS 图包工作台」图标
3. **首次启动**会弹出向导：默认推荐「打开示例图包」（16KB s_dial 演示包，立即可玩）；也可选「打开现有图包」或「查看 5 分钟教程」，或「跳过，直接进入」
4. 装完即可用 —— 安装器已把 `bin\` 追加到用户 PATH（PowerShell 可直接 `tts --version` / `tts-hub`），并内嵌 `tts-hub` sidecar（无需手动 `npm install -g`）

**外置 hub 模式**（高级用户 / 降级模式）：

1. `npm install -g @smirk1921/tts-toolkit`（一次）
2. 在图包工作区目录起一个终端跑 `tts-hub`（保持窗口开启）
3. 运行安装包，应用检测到 39995 端口的外置 hub（≥0.9.0 接收，<0.9.0 提示升级）→ 进入五面工作台

## 快速开始（开发）

```bash
npm install
npm run tauri dev        # 首次 cargo build 5-10 min
npm run dev              # 浏览器调试（不开 Tauri 壳，HubLauncher 走 HTTP 探测降级）

npm run build            # tsc + vite build
npm run tauri build      # 出 NSIS 安装包（src-tauri/target/release/bundle/nsis/）
npm run make-icons       # 从 assets-src/icon.svg 重生成 src-tauri/icons/ 全套
npm run compare-screenshots  # 五面截图 vs round-03 基准 pixelmatch 比对（需先截图入 screenshots/current/）
```

## 当前状态：v0.1.0 候选（UI-4 完工）

五面全部落地：

- **⓪ 总览**：工序章五章横排（拉取→切片→拼版→校样→出厂，四态色）+ 待办清单 + 迷你文件树 + 事件流 + 四面状态磁贴，首进阶梯动效
- **① 代码**：pull → 条目级 diff（红绿块）→ CodeMirror 编辑（Lua/XML 高亮）→ 乐观锁保存（409 冲突条）→ 确认门写回游戏
- **② 代理**：Lua 直执 + 作业流水（hub 路由调用行）+ SSE 事件流（Error 整行红）
- **③ 卡牌**：牌堆列表 + 切片网格（14 真实格 + 虚线占位）+ 卡面预览 + 死链卡牌切片禁用
- **④ 素材**：台账表格（>500 行强制虚拟化，3500 行实测 renderedRows=41）+ 行内编辑 + 批量体检死链标红 + 导入预览

顶层机制：

- 五层 Provider：HubContext → ConfirmGate → Sse → DeadLink → Dirty
- `<ConfirmGate>` 全站唯一危险确认组件（确认门生长动效 + 勾选"我已知晓"）
- 跨面联动：④ 体检死链 → ③ 切片禁用；① 脏文件 → LayerNav ①蓝点；死链/差异 → ⓪红点
- hub 版本兼容：0.7.x 降级提示 / 0.8.0 全功能（`capabilitiesFromStatus`）
- 设计令牌：`src/tokens.css`（10 色彩 + 3 字体 + 4 字号 + 6 间距 + 6 动效 + 几何约束），全站引用无写死值

## 设计红线（round-03 §10）

施工不可破：

1. 写回游戏等一切危险操作只经 `<ConfirmGate>`（confirm:true 门的 UI 化）
2. 状态色纪律：红=危险/错误、琥珀=待人审、蓝=代理/选中、青=成功/存活
3. 直角或 ≤2px 微圆角、线框分隔、字符符号（✗⇄M●✂⬆✓），不引图标库、不用大圆角卡片、不滥用投影
4. 三层字族职责不混用：仿宋=标注 / 等宽=数据 / 黑体=正文
5. 全站引用 tokens.css 变量，不写死颜色 / 字号 / 间距
6. 不引 Tailwind / Sass / 组件库

## 仓库

- 主仓：本仓 [Smirk1921/tts-desktop](https://github.com/Smirk1921/tts-desktop)
- 姊妹仓：[Smirk1921/tts-toolkit](https://github.com/Smirk1921/tts-toolkit)（CLI + hub + MCP）
- 姊妹仓：[Smirk1921/tts-lua-hub](https://github.com/Smirk1921/tts-lua-hub)（VSCode 插件 fork）

## License

MIT © Smirk1921

## 开发者：构建安装包

v9-3 起安装器通过 Tauri 2 官方 **NSIS installerHooks** 机制注入自定义逻辑（`src-tauri/nsis/installer-hooks.nsh`，`tauri.conf.json` 的 `bundle.windows.nsis.installerHooks` 指向）。v9-3 简化（坑 35，见交接文档）：不做安装器勾选页，行为默认执行 —— 安装时把 `bin\` 幂等追加到**用户级 PATH**（HKCU，用 NSIS 自带 `${WordAdd}` 去重，**不需要 EnVar 插件**），检测到 VSCode（`%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe`）时把打包内 `.vsix` 拷到 `$INSTDIR\vscode-ext\`；卸载时幂等清 PATH + kill tts-hub 残留进程。

1. **构建命令**（在 `tts-desktop/` 下）：
   ```bash
   npm run copy-product && npx tauri build
   ```
   - `npm run copy-product`：把 tts-toolkit 产物（sidecar .exe + resources）同步进 `src-tauri/`，并顺带执行 examples/vsix 两步收集（详见 `scripts/copy-product.mjs` 头注释）
   - `npx tauri build`：Rust release 编译 + NSIS 打包（beforeBuildCommand 里已含前端 `vite build`）

   可选资源收集脚本（copy-product 末尾会自动调；产物缺失时 vsix 自动跳过不阻塞构建）：
   ```bash
   node scripts/collect-vsix.mjs   # ../vscode-ext/ 最新 .vsix → src-tauri/resources/vscode-ext/（无 .vsix 时 warn 跳过）
   node scripts/copy-example.mjs   # s_dial.ttsmod 夹具 → src-tauri/resources/examples/sample.ttsmod
   ```

2. **产物**：
   ```
   src-tauri/target/release/bundle/nsis/tts-desktop_0.1.0_x64-setup.exe
   ```
   安装器行为（v9-3 无勾选页，默认执行）：安装完成时 `bin\` 幂等追加到用户 PATH（`${WordAdd}` 去重 + WM_SETTINGCHANGE 广播）；检测到 VSCode 时把打包内 .vsix 拷到 `$INSTDIR\vscode-ext\`（终端手动 `code --install-extension <路径>` 安装）；卸载时幂等清 PATH + kill tts-hub 残留进程。
