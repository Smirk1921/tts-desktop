/**
 * <Frame> 图框 — round-03 §4.1
 * 职责：应用最外层，图名栏 + 图层导航 + 图例条 + 状态行 + 会签栏的容器。
 * 结构：双线边框（外 1px --w + 内缩 5px 一道 --wdim）+ 42px 网格底纹（仅 canvas 区）
 *
 * UI-1a：状态行内容为占位硬编码（"● TTS 已连接 / 2 死链 · 3 待签"），UI-1b 接入真实数据。
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
  /** 状态行左侧文本（UI-1b 将传入真实 hub 状态） */
  statusLeft?: React.ReactNode;
  /** 状态行右侧文本 */
  statusRight?: React.ReactNode;
}

export default function Frame(props: FrameProps) {
  const {
    pack,
    nav,
    legend,
    children,
    signBlock,
    statusLeft = (
      <>
        <span className="frame-status-dot">●</span> TTS 已连接
      </>
    ),
    statusRight = "2 死链 · 3 待签",
  } = props;

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
          <span className="frame-status-left">{statusLeft}</span>
          <span className="frame-status-right tnum">{statusRight}</span>
        </footer>

        {/* 会签栏（右下常驻） */}
        {signBlock}
      </div>
    </div>
  );
}
