/**
 * <CodeDiffView> 代码面·diff 视图（条目级） — Stage A2
 * 职责：展示 diff 结果全部条目，按 added / modified / deleted 三组分组，
 *       每行 = 状态字符 + 文件名（等宽） + kind 徽标（仿宋小字）。
 * 条目级，不做行级 hunks（hub /v1/diff 默认不返回 hunks）。
 * 纯受控展示：不持状态、不调 hubClient；点击回调由父组件驱动。
 */
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import "./CodeDiffView.css";

/** 一条差异条目（与 hub /v1/diff 的 DiffEntry 对应） */
export interface DiffEntry {
  guid: string;
  name: string;
  kind: "script" | "ui";
  status: "added" | "modified" | "deleted";
  localPath?: string;
}

export interface CodeDiffViewProps {
  /** 全部差异条目 */
  entries: DiffEntry[];
  /** 点击某条目（通常用于"在编辑器中打开"） */
  onOpenEntry?(guid: string, kind: "script" | "ui"): void;
}

type EntryStatus = DiffEntry["status"];

/** 分组定义：渲染顺序 added → modified → deleted，符号与状态色对齐红线 §10 */
const GROUPS: ReadonlyArray<{
  status: EntryStatus;
  title: string;
  symbol: string;
}> = [
  { status: "added",    title: "新增", symbol: "+" },
  { status: "modified", title: "修改", symbol: "M" },
  { status: "deleted",  title: "删除", symbol: "−" },
];

function DiffRow(props: {
  entry: DiffEntry;
  symbol: string;
  clickable: boolean;
  onOpen: CodeDiffViewProps["onOpenEntry"];
}): ReactElement {
  const { entry, symbol, clickable, onOpen } = props;

  const handleClick = (event: MouseEvent<HTMLLIElement>): void => {
    if (!onOpen) return;
    event.stopPropagation();
    onOpen(entry.guid, entry.kind);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (!onOpen) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(entry.guid, entry.kind);
    }
  };

  return (
    <li
      className="codediff-item"
      data-status={entry.status}
      data-clickable={clickable ? "true" : "false"}
      tabIndex={clickable ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="codediff-sym">{symbol}</span>
      <span className="codediff-name">{entry.name}</span>
      <span className="codediff-kind">{entry.kind}</span>
    </li>
  );
}

export default function CodeDiffView(props: CodeDiffViewProps): ReactElement {
  const { entries, onOpenEntry } = props;
  const clickable = typeof onOpenEntry === "function";

  if (entries.length === 0) {
    return (
      <div className="codediff" role="status" aria-label="差异检查结果">
        <p className="codediff-empty">
          <span className="codediff-empty-sym">✓</span>
          工作区与游戏内一致
        </p>
      </div>
    );
  }

  return (
    <div className="codediff" aria-label="工作区差异">
      {GROUPS.map((group) => {
        const items = entries.filter((entry) => entry.status === group.status);
        if (items.length === 0) return null;
        return (
          <section className="codediff-group" key={group.status} aria-label={group.title}>
            <div className="codediff-group-title">
              {group.title}
              <span className="codediff-count tnum">{items.length}</span>
            </div>
            <ul className="codediff-list">
              {items.map((entry) => (
                <DiffRow
                  key={`${entry.kind}:${entry.guid}`}
                  entry={entry}
                  symbol={group.symbol}
                  clickable={clickable}
                  onOpen={onOpenEntry}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
