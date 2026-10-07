# Changelog

本文件记录 tts-desktop 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
组件名、CLI/路由名保留英文原文，其余叙述使用中文。

## [Unreleased]

> 占位：v0.1.0 之后的变更从这里开始累积。UI-4 收尾（动效三件套、Tauri 打包、
> 五面截图比对）尚未合并前的条目仍并入下面的 `[0.1.0]` 段。

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

### Test baseline / 测试基线

- 针对真实 TTS + hub 的手工 UI 验证；暂无自动化 UI 测试（计划 v0.2.0）。

[Unreleased]: https://github.com/Smirk1921/tts-desktop/commits/main
[0.1.0]: https://github.com/Smirk1921/tts-desktop/releases/tag/v0.1.0
