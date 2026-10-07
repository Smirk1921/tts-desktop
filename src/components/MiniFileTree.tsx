/**
 * <MiniFileTree> 工作区迷你文件树 — UI-4 Stage A1（⓪总览左下块，a-deep.html .ftree）
 *
 * 职责：块标题「工作区」+ 右上角小注（「差异 N」/「未注册图包」）+ 差异文件列表；
 *   行点击 → onNavigate("code")（跳 ①代码面看 diff，不在此做编辑）。
 * 复用泛化后的 <CodeFileTree>（groups 单组渲染），故行样式/状态符号/键盘可达性
 *   与①代码面对象区同源，不另造第二套文件树。
 *
 * 数据来源（契约 §5 修订版，逐字）：nodes / note 由 A3 从 useOverviewData 派生后
 *   传入——本组件不调 hub、不读模块级缓存、不依赖 hook 调用时序（纯受控展示）。
 *   nodes 为空时由 CodeFileTree 的分组空态渲染「— 无对象」（未注册图包 / 无差异
 *   两种情况都不留空块）。
 */
import type { ReactElement } from "react";
import CodeFileTree, { type TreeNode } from "./CodeFileTree";
import type { LayerId } from "../state/processStamps";
import "./MiniFileTree.css";

export interface MiniFileTreeProps {
  /** 差异文件节点（A3 由 useOverviewData 缓存派生；kind 按扩展名，status 按 added/modified/deleted） */
  nodes: TreeNode[];
  /** 右上角小注：「差异 N」或「未注册图包」 */
  note: string;
  /** 行点击 → 跳转工作面（本组件固定跳 "code"） */
  onNavigate(layer: LayerId): void;
}

export default function MiniFileTree(props: MiniFileTreeProps): ReactElement {
  const { nodes, note, onNavigate } = props;

  return (
    <section className="miniftree" aria-label="工作区">
      <div className="miniftree-head">
        <span className="miniftree-title">工作区</span>
        <span className="miniftree-note tnum">{note}</span>
      </div>
      <div className="miniftree-body">
        {/* 组标题留空：块标题已在上方，树内不重复标题也不留空标题占位 */}
        <CodeFileTree groups={[{ title: "", nodes }]} onSelect={() => onNavigate("code")} />
      </div>
    </section>
  );
}
