# tts-desktop

> TTS 图包工作台 — 蓝图纸语言桌面应用
>
> Round-03 设计方案（[ui-design/round-03](https://github.com/Smirk1921/tts-toolkit)）的 Tauri 2 + React 19 实现。
> v0.8.0 窗口 UI-4：⓪总览 + 动效三件套 + 应用图标 + Tauri 打包完工。

## 前置依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| Windows | **10 1809+ / 11** | 仅 Windows（v0.1.0 不做跨平台） |
| WebView2 Runtime | 任意 | Win10 1809+ 自带；缺失时 HubLauncher 引导面板顶部红条提示 + 一键下载 |
| tts-toolkit (CLI) | **≥ 0.7.0** | 桌面应用经 `tts-hub` 与 TTS 通信；0.7.x 为降级模式（无 /v1/files 读写），0.8.0 解锁全功能 |
| Tabletop Simulator | 任意 Steam 版 | 联通功能需要；UI 空骨架可独立浏览 |
| Node.js | **24+** | 仅开发期需要 |
| Rust | **1.99+** (stable-msvc) | 仅开发期需要；`rustup` 安装 |
| VS Build Tools 2022 | C++ 工作负载 | 仅开发期需要；含 MSVC + Windows SDK |

## 快速开始（用户）

1. `npm install -g @smirk1921/tts-toolkit`（一次）
2. 在图包工作区目录起一个终端跑 `tts-hub`（保持窗口开启）
3. 运行安装包 `tts-desktop_0.1.0_x64-setup.exe`（或开发期 `npm run tauri dev`）
4. 应用检测到 39995 端口的 hub → 进入五面工作台；未检测到 → 引导面板（一键复制安装/启动命令）

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
