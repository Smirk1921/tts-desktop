/**
 * <CodeFileTree> 代码面·对象区（左树） — Stage A2 / UI-4 Stage A1 泛化
 * 职责：分组文件列表（组标题 + 每行一个文件 + 状态字符符号）。
 * 纯受控展示：选中由父组件驱动（activeGuid），本组件不持状态、不调 hubClient。
 * 符号（红线 §10）：modified=M(琥珀) / added=+(青) / deleted=−(红) / clean=空格不显示。
 *
 * 泛化（UI-4 Stage A1，契约 §4，向后兼容）：
 *  - groups 缺省 → 行为与既有 ①代码面完全一致（scripts/ + ui/ 两组，
 *    标题样式不变）；scripts / uis 缺省按空数组处理；
 *  - groups 存在 → 忽略 scripts / uis，按给定分组顺序渲染（标题样式同 scripts/）；
 *  - title 为空串时不渲染标题行（供 <MiniFileTree> 复用：块标题已由外壳给出，
 *    树内不再重复标题，也不留空标题占位）。既有调用方从未传空串，无回归。
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

/** 树分组：自定义分组渲染（UI-4 泛化） */
export interface TreeGroup {
  /** 组标题，渲染为与 "scripts/" 同款的分组标题；空串 = 不渲染标题行 */
  title: string;
  /** 该组节点 */
  nodes: TreeNode[];
}

export interface CodeFileTreeProps {
  /** 自定义分组；缺省时按 scripts/ + ui/ 两组渲染（①代码面行为不变） */
  groups?: TreeGroup[];
  /** scripts/ 列表（来自 scriptStates 过滤 kind==="script"） */
  scripts?: TreeNode[];
  /** ui/ 列表（来自 scriptStates 过滤 kind==="ui"） */
  uis?: TreeNode[];
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

function GroupSection(props: {
  group: TreeGroup;
  activeGuid?: string;
  onSelect: CodeFileTreeProps["onSelect"];
}): ReactElement {
  const { group, activeGuid, onSelect } = props;
  const { title, nodes } = group;

  return (
    <section className="codetree-group" aria-label={title === "" ? undefined : title}>
      {title !== "" && <div className="codetree-group-title">{title}</div>}
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
  const { groups, scripts, uis, activeGuid, onSelect } = props;

  // groups 优先；缺省回到既有 scripts/ + ui/ 两段（①代码面零变化）
  const resolved: TreeGroup[] = groups ?? [
    { title: "scripts/", nodes: scripts ?? [] },
    { title: "ui/", nodes: uis ?? [] },
  ];

  return (
    <nav className="codetree" aria-label="代码对象区">
      {resolved.map((group, i) => (
        <GroupSection
          key={`${i}:${group.title}`}
          group={group}
          activeGuid={activeGuid}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
