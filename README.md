# tts-desktop

> TTS 图包工作台 — 蓝图纸语言桌面应用
>
> Round-03 设计方案（[ui-design/round-03](https://github.com/Smirk1921/tts-toolkit)）的 Tauri 2 + React 18 实现。
> v0.8.0 窗口 UI-1a：基座 + tokens.css + 5 骨架组件静态渲染。

## 前置依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| Windows | **10 1809+ / 11** | 仅 Windows（v0.1.0 不做跨平台） |
| WebView2 Runtime | 任意 | Win10 1809+ 自带；缺失时启动钩子会在 stderr 警告，[点此下载](https://go.microsoft.com/fwlink/p/?LinkId=2124703) |
| Node.js | **24+** | 仅开发期需要 |
| Rust | **1.99+** (stable-msvc) | 仅开发期需要；`rustup` 安装 |
| VS Build Tools 2022 | C++ 工作负载 | 仅开发期需要；含 MSVC + Windows SDK |
| tts-toolkit (CLI) | ≥ 0.7.0 | **本窗口 (UI-1a) 不需要**；UI-1b 起需要开发期手动起 `tts-hub` |
| Tabletop Simulator | 任意 Steam 版 | **本窗口不需要**；UI-1b 联通验收时需要 |

## 快速开始（开发）

```bash
# 1. 装依赖
npm install

# 2. 起 Tauri dev（首次 cargo build 5-10 min）
npm run tauri dev

# 浏览器调试（不开 Tauri 壳，UI-1a 阶段可选）
npm run dev
```

## 当前状态：UI-1a 骨架

完工交付物：

- [x] Tauri 2 + React 18 + TypeScript + Vite 骨架
- [x] `src/tokens.css` — round-03 §2 设计令牌（10 色彩 + 3 字体 + 4 字号 + 6 间距 + 6 动效 + 几何约束）
- [x] 5 骨架组件静态渲染：
  - `<Frame>` 双线图框 + 图名栏 + 42px 网格底纹 + 状态行
  - `<LayerNav>` 5 面切换（⓪①②③④ + 状态圆点）
  - `<LegendBar>` 6 组全局图例
  - `<SignBlock>` 右下会签栏（交付清单 / 出厂工序 / 操作）
  - `<ConfirmGate>` 确认门（危险操作唯一组件，右下生长动效）
- [x] 5 路由占位（UI-2/3/4 填充真实内容）
- [x] WebView2 启动检测钩子（`src-tauri/src/lib.rs` setup hook）

不在本窗口（后续窗口交付）：

- `src/hub/`（HubClient + SSE） — **UI-1b**
- ①代码 / ②代理 — **UI-2**
- ③卡牌 / ④素材 — **UI-3**
- ⓪总览 + 动效三件套 + 应用图标 + 打包 — **UI-4**

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
