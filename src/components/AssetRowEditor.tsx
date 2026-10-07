/**
 * <AssetRowEditor> 素材台账·URL 行内编辑器 — UI-3 Stage A3
 *
 * 职责：AssetsTable url 列的行内编辑输入框（受控组件）。进入编辑由父组件
 *   AssetsTable 渲染本组件挂载，提交/取消后卸载——草稿值生命周期即编辑会话。
 *
 * 关键设计：
 *   - 草稿 state 持在本组件（挂载时以 value 初始化一次）：父组件 props 未给
 *     onChange，故编辑期中间键入不回传父组件；提交时才上抛（trim 去首尾空白）。
 *   - 键盘：Enter = commit / Esc = cancel / blur = commit（任务书行为）；
 *     Esc 取消后组件随即卸载，不会触发 blur 二次提交。
 *   - autoFocus 时挂载即聚焦并全选（点击单元格 → 直接键入即整体替换 URL）。
 *   - 与父组件 AssetsTable 共用样式基调：行高取 AssetsTable 根节点注入的
 *     --assetstable-rowh（缺省回退 28px，与 ROW_HEIGHT 常量保持一致）。
 *   - 纯展示层组件：不调 hubClient、不碰确认门（保存链路在路由层）。
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import "./AssetRowEditor.css";

export interface AssetRowEditorProps {
  /** 初值（当前 URL）；仅挂载时读取一次，编辑期为本地草稿 */
  value: string;
  /** 提交（Enter / 失焦）：草稿 trim 后上抛 */
  onCommit(next: string): void;
  /** 取消（Esc） */
  onCancel(): void;
  /** 挂载即聚焦并全选（行内编辑默认开启） */
  autoFocus?: boolean;
}

export default function AssetRowEditor(props: AssetRowEditorProps): ReactElement {
  const { value, onCommit, onCancel, autoFocus = false } = props;

  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 挂载即聚焦 + 全选（useLayoutEffect 避免焦点闪烁）
  useLayoutEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (el !== null) {
      el.focus();
      el.select();
    }
  }, [autoFocus]);

  const commit = (): void => {
    onCommit(draft.trim());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      className="assetroweditor-input"
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      spellCheck={false}
      aria-label="编辑素材 URL"
    />
  );
}
