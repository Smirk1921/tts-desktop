/**
 * <Frame> 图框 — round-03 §4.1
 * 职责：应用最外层，图名栏 + 图层导航 + 图例条 + 状态行 + 会签栏的容器。
 * 结构：双线边框（外 1px --w + 内缩 5px 一道 --wdim）+ 42px 网格底纹（仅 canvas 区）
 *
 * UI-1b：状态行去硬编码，改由 props 驱动（connected / version / deadLinks / pending），
 * 圆点色按状态色纪律（§2.5）：青=已连接、红=未连接；statusLeft / statusRight 仍可整体覆写。
 */
import React from "react";
import "./Frame.css";

export interface FrameProps {
  pack: { name: string; version: string; branch: string };
  /** 导航栏（LayerNav 元素，由 App 组装后传入） */
  nav?: React.ReactNode;
  /** 图例条（LegendBar 元素） */
  legend?: React.ReactNode;
  /** 当前工作面（routes/* 元素） */
  children?: React.ReactNode;
  /** 会签栏（SignBlock 元素） */
  signBlock?: React.ReactNode;
  /** TTS 连接状态（/v1/status → tts.connected），缺省 false */
  connected?: boolean;
  /** 连接态附注版本（/v1/status → tts.version） */
  version?: string;
  /** 死链数（UI-3 素材体检回填；缺省不显示该段） */
  deadLinks?: number;
  /** 待签数（UI-4 会签回填；缺省不显示该段） */
  pending?: number;
  /** 状态行左侧整体覆写（缺省按 connected / version 生成） */
  statusLeft?: React.ReactNode;
  /** 状态行右侧整体覆写（缺省按 deadLinks / pending 生成） */
  statusRight?: React.ReactNode;
}

export default function Frame(props: FrameProps) {
  const {
    pack,
    nav,
    legend,
    children,
    signBlock,
    connected = false,
    version,
    deadLinks,
    pending,
    statusLeft,
    statusRight,
  } = props;

  const rightParts: string[] = [];
  if (deadLinks !== undefined) rightParts.push(`${deadLinks} 死链`);
  if (pending !== undefined) rightParts.push(`${pending} 待签`);
  const defaultStatusLeft = (
    <>
      <span className={`frame-status-dot${connected ? "" : " off"}`}>●</span>
      {connected ? `TTS 已连接${version ? ` · ${version}` : ""}` : "TTS 未连接"}
    </>
  );
  const defaultStatusRight =
    rightParts.length > 0 ? rightParts.join(" · ") : "—";

  return (
    <div className="frame-outer">
      <div className="frame-inner">
        {/* 图名栏 */}
        <header className="frame-title">
          <div className="frame-title-left">
            <span className="frame-title-label">图名</span>
            <span className="frame-title-name">{pack.name}</span>
            <span className="frame-title-sep">·</span>
            <span className="frame-title-label">版本</span>
            <span className="frame-title-ver">
              {pack.version}·{pack.branch}
            </span>
          </div>
          <div className="frame-title-right">{nav}</div>
        </header>

        {/* 全局图例条 */}
        {legend}

        {/* 工作面容器：42px 网格底纹 + 底部留出状态行高度 */}
        <main className="frame-canvas">{children}</main>

        {/* 状态行（左下） */}
        <footer className="frame-status">
          <span className="frame-status-left">
            {statusLeft ?? defaultStatusLeft}
          </span>
          <span className="frame-status-right tnum">
            {statusRight ?? defaultStatusRight}
          </span>
        </footer>

        {/* 会签栏（右下常驻） */}
        {signBlock}
      </div>
    </div>
  );
}
