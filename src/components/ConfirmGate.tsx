/**
 * <ConfirmGate> 确认门 — round-03 §4.5（危险操作唯一组件）
 * 职责：全站唯一的危险确认，写回 / 发布 / 同步 / 批量覆盖都复用它。
 * 结构：遮罩 + .dialog 从触发按钮生长：
 *   标题（红色方框标）
 *   影响清单 .list（等宽）
 *   素材警告 .warn（红色虚线框，附"去构建→"跳转）
 *   必勾"我已知晓" .chk
 *   拒签 / 会签 双按钮（会签 --red，未勾禁用）
 * 动效：--ease-pop + --dur-pop，transform-origin:bottom right，scale 0.7→1
 *
 * 红线：任何危险操作必须走它，不自建确认框。
 */
import { useState } from "react";
import "./ConfirmGate.css";

export interface ConfirmItem {
  file: string;
  diff: string; // "+12 -3" 或 "重写" 等
}

export interface ConfirmGateProps {
  open: boolean;
  title: string;
  items: ConfirmItem[];
  /** 素材改动警告（可选，存在时显示 .warn 红虚线框） */
  assetWarning?: string;
  ackLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmGate(props: ConfirmGateProps) {
  const {
    open,
    title,
    items,
    assetWarning,
    ackLabel = "我已知晓上述影响",
    onConfirm,
    onCancel,
  } = props;

  const [ack, setAck] = useState(false);

  if (!open) {
    // 关闭时重置勾选，下次打开需重新确认
    if (ack) setAck(false);
    return null;
  }

  return (
    <div className="confirmgate" role="dialog" aria-modal="true" aria-label={title}>
      {/* 遮罩 */}
      <div className="confirmgate-mask" onClick={onCancel} />

      {/* 对话框：从右下会签按钮生长 */}
      <div className="confirmgate-dialog">
        {/* 标题：红色方框标 */}
        <header className="confirmgate-head">
          <span className="confirmgate-marker" aria-hidden />
          <h2 className="confirmgate-title">{title}</h2>
        </header>

        {/* 影响清单（等宽） */}
        <section className="confirmgate-list">
          <div className="confirmgate-list-title">影响清单</div>
          <ul>
            {items.map((it, i) => (
              <li key={i}>
                <span className="confirmgate-file">{it.file}</span>
                <span className="confirmgate-diff tnum">{it.diff}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 素材警告（红色虚线框） */}
        {assetWarning && (
          <section className="confirmgate-warn">
            <span className="confirmgate-warn-icon">⚠</span>
            <span className="confirmgate-warn-text">{assetWarning}</span>
            <button type="button" className="confirmgate-warn-link">
              去构建 →
            </button>
          </section>
        )}

        {/* 必勾"我已知晓" */}
        <label className="confirmgate-chk">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          <span className="confirmgate-chk-label">{ackLabel}</span>
        </label>

        {/* 双按钮 */}
        <footer className="confirmgate-act">
          <button type="button" className="confirmgate-btn refuse" onClick={onCancel}>
            拒签
          </button>
          <button
            type="button"
            className="confirmgate-btn sign"
            disabled={!ack}
            onClick={onConfirm}
          >
            会签
          </button>
        </footer>
      </div>
    </div>
  );
}
