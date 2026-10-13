/**
 * <FirstRunWizard> 首次启动向导 — v9-3 窗口 Stage A 任务 A2（施工方案 v0.9.0 §6.3）
 *
 * 职责：应用首次启动时的三选一引导页：
 *   1. 打开示例图包（默认选中，红线 20——回车即选，不强制走教程）
 *   2. 打开现有图包
 *   3. 查看 5 分钟上手教程
 * 交互：
 *   - 回车（window keydown）触发 onDone(当前选中项)
 *   - 「开始」主按钮 → onDone(choice)；「跳过，直接进入」次按钮 → onDone('skip')
 *   - choice 联合类型 'example' | 'existing' | 'tutorial' | 'skip'（'skip' 仅经跳过按钮产生）
 * 挂载（Stage B1）：App.tsx 读 isFirstRun() 决定是否渲染本组件；
 *   onDone 后由调用方 markFirstRunDone() 写 `首次向导.flag` 并卸载向导。
 *
 * 样式：tokens.css 全变量（var(--bp-dd) 全屏底 + var(--bp-d) 面板 + var(--amber) 方框标，
 * 对齐 HubLauncher 的引导页视觉）；直角、无投影、prefers-reduced-motion 由 tokens 统一处理。
 */
import { useEffect, useState } from "react";
import "./FirstRunWizard.css";

export type FirstRunChoice = "example" | "existing" | "tutorial" | "skip";

export interface FirstRunWizardProps {
  /** 三选一确认（回车 / 「开始」）或跳过（「跳过，直接进入」）时回传 */
  onDone: (choice: FirstRunChoice) => void;
}

/** 面板 aria-label */
const PANEL_LABEL = "首次启动向导";

export default function FirstRunWizard({ onDone }: FirstRunWizardProps) {
  // ⭐ 默认 example（施工方案 §6.3 骨架 + 审批意见 §9）
  const [choice, setChoice] = useState<"example" | "existing" | "tutorial">("example");

  useEffect(() => {
    // 回车即确认当前选中项（骨架钦定：window keydown Enter → onDone(choice)）
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") onDone(choice);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [choice, onDone]);

  return (
    <div className="wizard" role="dialog" aria-modal="true" aria-label={PANEL_LABEL}>
      <div className="wizard-panel">
        <header className="wizard-head">
          <span className="wizard-marker" aria-hidden />
          <h1 className="wizard-title">欢迎使用 TTS 图包工作台</h1>
        </header>

        <p className="wizard-note">选择一种方式开始（回车确认当前选中项）：</p>

        <div className="wizard-options">
          <label className="wizard-option">
            <input
              type="radio"
              name="firstrun-choice"
              checked={choice === "example"}
              onChange={() => setChoice("example")}
            />
            <span className="wizard-option-text">打开示例图包（推荐新手）</span>
          </label>
          <label className="wizard-option">
            <input
              type="radio"
              name="firstrun-choice"
              checked={choice === "existing"}
              onChange={() => setChoice("existing")}
            />
            <span className="wizard-option-text">打开现有图包</span>
          </label>
          <label className="wizard-option">
            <input
              type="radio"
              name="firstrun-choice"
              checked={choice === "tutorial"}
              onChange={() => setChoice("tutorial")}
            />
            <span className="wizard-option-text">查看 5 分钟上手教程</span>
          </label>
        </div>

        <footer className="wizard-act">
          <button type="button" className="wizard-btn" onClick={() => onDone(choice)}>
            开始
          </button>
          <button
            type="button"
            className="wizard-btn wizard-btn--secondary"
            onClick={() => onDone("skip")}
          >
            跳过，直接进入
          </button>
        </footer>
      </div>
    </div>
  );
}
