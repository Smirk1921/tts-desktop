/**
 * <ProcessStamps> 工序章 — UI-4 Stage A1（⓪总览顶部主角，§4.3）
 *
 * 职责：拉取→切片→拼版→校样→出厂 五章横排，等分；每章「序号（等宽小字）+
 *   名（仿宋大字）+ 状态（等宽小字 note）」。差异化的图纸语言，总览唯一主角。
 * 纯受控展示：不调 hub、不持状态——五章数据由 A3 经 useOverviewData 派生后传入，
 *   本组件只做渲染 + 状态四态的视觉映射（§2.5 状态色纪律）：
 *     done  → .st 青（--ok = 已完成）
 *     doing → 章底 inset 蓝条 + 淡蓝底 + .nm 白字 + .st 蓝（--blue = 进行中）
 *     alert → .nm / .st 红（--red = 错误 / 死链 / 差异）
 *     todo  → 整章半透明 + .st 灰（--wdim）
 * 数据形状：StampState（state/processStamps.ts，契约 §1）——steps 恒 5 项，
 *   顺序 拉取→切片→拼版→校样→出厂，序号 01…05 由数组下标派生（不写死）。
 * 动效（§6，A2 实现到 CSS / A3 在 Overview.tsx 施加 .ov-enter→.ov-enter-done）：
 *   本章内每项即 .processstamps-stamp（.processstamps 的直接子元素，恰 5 项），
 *   阶梯 transition-delay 由 :nth-child 命中；本组件不加动画类、不接管时序。
 */
import type { ReactElement } from "react";
import type { StampState } from "../state/processStamps";
import "./ProcessStamps.css";

export interface ProcessStampsProps {
  /** 五道工序（恒 5 项，顺序 拉取→切片→拼版→校样→出厂） */
  steps: StampState[];
}

export default function ProcessStamps(props: ProcessStampsProps): ReactElement {
  const { steps } = props;

  return (
    <div className="processstamps" role="list" aria-label="交付工序">
      {steps.map((step, i) => (
        <div
          key={step.id}
          className="processstamps-stamp"
          data-status={step.status}
          role="listitem"
          aria-label={`${step.name}：${step.note}`}
        >
          {/* 序号：等宽·数字表格化（§2.2），01…05 由下标派生 */}
          <div className="processstamps-no tnum">{String(i + 1).padStart(2, "0")}</div>
          <div className="processstamps-nm">{step.name}</div>
          <div className="processstamps-st tnum">{step.note}</div>
        </div>
      ))}
    </div>
  );
}
