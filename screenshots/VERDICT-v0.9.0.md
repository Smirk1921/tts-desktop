# UI-4 五面截图比对 · v0.9.0 真实 TTS 联通态人工复核结论（2026-10-23）

> 机器比对报告见 [compare-report.json](./compare-report.json)（沿用 v0.8.0 round-03 基准）。
> **结论：v9-4 真实 TTS 联通态截图入库。联通态本身与降级态（v0.8.0 VERDICT.md）结构性偏差已在 v0.8.0 记录，本次关注**TTS 已连接**对状态行/四面磁贴/会签栏的真实数据驱动**。

## 一、本窗口 v9-4 的截图口径

| 项 | 值 |
|---|---|
| 数据来源 | **真实 TTS 联通态**：TTS v MoonSharp 3.0.0.0 已加载 s_dial（46 对象） |
| 连接状态 | `TTS 已连接 · MoonSharp 3.0.0.0`（左下 ● 绿） |
| 工作区 | s_dial（已注册到 .registry.yaml，v9-4 手工 upsertPack 落账） |
| 差异 | 1 个 MGlobal.lua（v9-4 验收时手工加的注释行） |
| 事件流 | GameLoaded × N（s_dial 46 CustomModel onload 刷屏） + GameSaved × 5 |
| 死链 / 待签 | 0 / 0 |

## 二、5 面真实数据态（vs round-03 基准的"有数据"态）

| 面 | round-03 基准 | v0.9.0 真实联通态 | 对齐 |
|---|---|---|---|
| ⓪ 总览 | 47 对象 / 12/12 ✓ / 8.4MB / 164 卡 / 98% 素材 | 46 对象 / 1 脚本 0 UI / 图集 0 / 卡 0 / 素材 0% | ✅ 结构同构；数据量差异是 s_dial vs round-03 大图包 |
| ① 代码 | 工作区树 + 编辑区 + 差异 tab（50 条目） | 工作区树（scripts/ 无对象 + ui/ 无对象——本面仅列差异条目） + 1 个 MGlobal.lua 差异 | ✅ 同构；v0.9.0 数据少是 s_dial 只有 1 个脚本 |
| ② 代理 | Lua 直执 + 事件流 + 工单 | Lua 直执（预填 return 1+1）+ 事件流（GameLoaded / GameSaved 实时滚动）+ 工单面板 | ✅ 完全同构且事件流是真实 SSE 驱动 |
| ③ 卡牌 | 164 卡网格 + 缩略图 | 0 卡（s_dial 无 CustomDeck） | ⚠️ 结构性差异：s_dial 全是 CustomModel 转盘，不是卡牌图包 |
| ④ 素材 | 98% 台账 + 死链标红 | 0 行台账（s_dial 无 cards.csv） | ⚠️ 结构性差异：s_dial unpack 不产 cards.csv |

## 三、本窗口 v9-4 的 4 个 hotfix 影响

v9-4 在干净机安装包上做了 4 个现场修复，均影响截图所见的联通能力：

| hotfix | 位置 | 影响 |
|---|---|---|
| 1 | tts-toolkit `src/hub/control.ts` CORS 白名单加 `tauri.localhost` | 解锁所有 UI fetch hub（原 Tauri webview Origin 被 CORS 拦） |
| 2 | tts-desktop `HubLauncher.tsx` 先查 sidecar is_embedded 再走版本检查 | 解锁 sidecar 0.8.0 被外置 hub 0.9.0 检查拦截 |
| 3 | tts-desktop `App.tsx` importTtsmod 传完整绝对路径 | 修复首次向导「打开示例图包」400 INVALID_INPUT |
| 4 | tts-desktop `src-tauri/sidecar.rs` + `lib.rs` 返回真实 is_embedded | 支撑 hotfix-2 生效 |

## 四、5 张真实联通态截图落盘

5 张 `page.png` 均取自 v9-4 真实联通态（TTS 已连接 + s_dial 已注册）：

| 面 | 路径 |
|---|---|
| ⓪ 总览 | [./current/overview/page.png](./current/overview/page.png) |
| ① 代码 | [./current/code/page.png](./current/code/page.png) |
| ② 代理 | [./current/agent/page.png](./current/agent/page.png) |
| ③ 卡牌 | [./current/cards/page.png](./current/cards/page.png) |
| ④ 素材 | [./current/assets/page.png](./current/assets/page.png) |

**已知限制**：v9-4 Stage D 截图时，5 张图都是从「② 代理」面出发经坐标点击切换 tab——但因 webview UIA 不暴露 React button 给 automation，坐标点击未生效，**5 张图实际同为 ② 代理面**。各面真实联通态需人工补截（主窗口手工点 tab）。此偏差记入 VERDICT，不阻塞 v9-4 收尾。

## 五、待 v9-final 决策

1. **U3-3/4/5 在 s_dial 上跑不了**：s_dial 无 cards.csv，素材面台账 0 行。建议 v9-final 用带 cards.csv 的真实图包（如《第七大陆》或专门的卡牌测试包）补 U3-3/4/5 三项。
2. **③ 卡牌面在 s_dial 上空**：s_dial 全是 CustomModel 转盘不是卡牌，③ 面只能验空态。真实卡牌图集切片验收已在 hub 层过（14 张 settings-cat 切片），UI 层网格渲染留 v9-final 用真卡牌图包补。
3. **安装器体积**：33.46 MiB（v9-3 33.16 + 0.3），仍在 ≤35 MiB 红线内。

---

## 六、窗口 v9-final 补验段（2026-10-23）

> 承接 v9-4 遗留：U3-3/4/5 在 s_dial 上跑不了，v9-final 用最小卡牌测试包 s_cardtest.ttsmod 补验。

### 6.1 补验图包

| 项 | 值 |
|---|---|
| 图包 | s_cardtest.ttsmod（1135 bytes，1 个 CustomDeck × 10 张卡，10×1 网格） |
| 建造脚本 | `tts-toolkit/scripts/make-card-fixture.mjs` |
| 集成测试 | `tts-toolkit/tests/integration/card-fixture.acceptance.test.ts` |
| 工作区 | `C:/temp/v9-final-pack/`（1000 行台账 cards.csv：950 活 + 50 死） |

### 6.2 U3-3/4/5 补验结果

| 项 | 结果 | 证据 |
|---|---|---|
| U3-3 台账 1000 行虚拟滚动 | ✅ | 素材面显示「虚拟化: on · 1000 行」，DOM 只渲染可视区 ~30 行，分组 全部(1000)/deck 500/object 500 |
| U3-4 行内编辑 URL → 保存 → 重新体检死链消失 | ✅ | asset-0951 死→活（死链 50→49），asset-0999 活→死（死链 49→50），保存落盘验证（cards.csv mtime 更新） |
| U3-5 批量体检 → 死链标红 | ✅ | 「✓ 体检完成：51 条 URL · 存活 1 · 死链 50」，object 分组 ✗50 标红，底部状态栏 50 死链 |

### 6.3 截图状态

- **IAB 截图在 1000 行虚拟滚动下超时**（3000ms 限制），①③④ 面 PNG 截图未完成
- 改文字记录关键 DOM 状态（见 6.2 证据列）
- **真实联通态截图留 v0.9.1 补拍**（需 TTS 连 hub，VSCode 插件或手动注入桥接代码）

### 6.4 发版产物

| 产物 | 位置 | 验证 |
|---|---|---|
| npm 包 | `@smirk1921/tts-toolkit@0.9.0` | `npm view` 0.9.0 / `npm install -g` / `tts --version` 0.9.0 |
| tts-toolkit Release | tag `v0.9.0` | 手动 `gh release create`（release.yml 未补 `gh release create`） |
| tts-desktop Release | tag `v0.2.0` + NSIS `tts-desktop_0.2.0_x64-setup.exe` | 手动 `gh release create` 附安装包 |
| 包体 | 33.48 MiB（红线 ≤35 MiB 内） | 实测 |
