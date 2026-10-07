/**
 * <CodeFileTree> 代码面·对象区（左树） — Stage A2
 * 职责：scripts / ui 两个扁平列表 + 分组标题，每行一个文件 + 状态字符符号。
 * 纯受控展示：选中由父组件驱动（activeGuid），本组件不持状态、不调 hubClient。
 * 符号（红线 §10）：modified=M(琥珀) / added=+(青) / deleted=−(红) / clean=空格不显示。
 */
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import "./CodeFileTree.css";

/** 文件树节点：scriptStates 数组映射而来 */
export interface TreeNode {
  /** 展示名（来自 scriptStates[i].name） */
  name: string;
  /** 对象 GUID（"-1" 为全局脚本 / 全局 UI） */
  guid: string;
  /** 节点类型 */
  kind: "script" | "ui";
  /** diff 状态；undefined 视为 "clean" */
  status?: "added" | "modified" | "deleted" | "clean";
}

export interface CodeFileTreeProps {
  /** scripts/ 列表（来自 scriptStates 过滤 kind==="script"） */
  scripts: TreeNode[];
  /** ui/ 列表（来自 scriptStates 过滤 kind==="ui"） */
  uis: TreeNode[];
  /** 当前选中项的 guid（高亮） */
  activeGuid?: string;
  /** 选中回调 */
  onSelect(guid: string, kind: "script" | "ui"): void;
}

type NodeStatus = NonNullable<TreeNode["status"]>;

/** 状态 → 字符符号（仅使用红线 4 已注册字符；clean 为空串，占位不显示） */
const STATUS_SYMBOL: Record<NodeStatus, string> = {
  clean: "",
  modified: "M",
  added: "+",
  deleted: "−",
};

function TreeItem(props: {
  node: TreeNode;
  active: boolean;
  onSelect: CodeFileTreeProps["onSelect"];
}): ReactElement {
  const { node, active, onSelect } = props;
  const status: NodeStatus = node.status ?? "clean";

  const handleClick = (event: MouseEvent<HTMLLIElement>): void => {
    event.stopPropagation();
    onSelect(node.guid, node.kind);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(node.guid, node.kind);
    }
  };

  return (
    <li
      className="codetree-item"
      data-status={status}
      data-active={active ? "true" : "false"}
      aria-current={active ? "true" : undefined}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="codetree-sym">{STATUS_SYMBOL[status]}</span>
      <span className="codetree-name">{node.name}</span>
    </li>
  );
}

function TreeGroup(props: {
  title: string;
  nodes: TreeNode[];
  activeGuid?: string;
  onSelect: CodeFileTreeProps["onSelect"];
}): ReactElement {
  const { title, nodes, activeGuid, onSelect } = props;

  return (
    <section className="codetree-group" aria-label={title}>
      <div className="codetree-group-title">{title}</div>
      {nodes.length > 0 ? (
        <ul className="codetree-list">
          {nodes.map((node) => (
            <TreeItem
              key={`${node.kind}:${node.guid}`}
              node={node}
              active={node.guid === activeGuid}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : (
        <div className="codetree-empty">— 无对象</div>
      )}
    </section>
  );
}

export default function CodeFileTree(props: CodeFileTreeProps): ReactElement {
  const { scripts, uis, activeGuid, onSelect } = props;

  return (
    <nav className="codetree" aria-label="代码对象区">
      <TreeGroup title="scripts/" nodes={scripts} activeGuid={activeGuid} onSelect={onSelect} />
      <TreeGroup title="ui/" nodes={uis} activeGuid={activeGuid} onSelect={onSelect} />
    </nav>
  );
}
