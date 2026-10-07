/**
 * <AssetsGroupNav> ④素材面·对象区（类型分组导航） — UI-3 Stage A3
 *
 * 职责：按 group 字段分组的素材导航（round-03 §3.1 ④素材·对象区"类型分组"），
 *   顶部「全部 (N)」一行 + 每组一行：group 名 + total +（可选）dead 红字 + dirty 蓝点。
 *
 * 关键设计：
 *   - 纯受控展示：groups / activeGroup / onSelect 全由父组件（Stage C 的 Assets 路由）
 *     驱动，本组件不持状态、不调 hubClient；activeGroup === undefined 即「全部」。
 *   - 计数由父组件预聚合（AssetGroupCount），本组件只渲染不统计。
 *   - 键盘可达：每行是原生 <button>（Tab 聚焦 / Enter·Space 触发），选中行 aria-current。
 *
 * 符号（红线 §10）：✗ 死链（红）/ ● 已改未提交（蓝，M● 语义族）。
 */
import { useMemo } from "react";
import type { ReactElement } from "react";
import "./AssetsGroupNav.css";

/** 一个分组的计数（父组件由 rows 聚合而来） */
export interface AssetGroupCount {
  /** 组名（deck / card / token / board / die / other …） */
  group: string;
  /** 该组总行数 */
  total: number;
  /** 死链行数（未体检/无死链可省略） */
  dead?: number;
  /** 脏行数（已改未保存，可省略） */
  dirty?: number;
}

export interface AssetsGroupNavProps {
  /** 分组计数列表（顺序即展示顺序） */
  groups: AssetGroupCount[];
  /** 当前选中组；undefined = 全部 */
  activeGroup?: string;
  /** 选中回调（选「全部」时上抛 undefined） */
  onSelect(group: string | undefined): void;
}

export default function AssetsGroupNav(props: AssetsGroupNavProps): ReactElement {
  const { groups, activeGroup, onSelect } = props;

  /** 「全部」总数 = 各组 total 之和（组间互斥分组，直接累加） */
  const totalCount = useMemo(
    () => groups.reduce((acc, g) => acc + g.total, 0),
    [groups],
  );

  return (
    <nav className="assetsgroupnav" aria-label="素材类型分组">
      <button
        type="button"
        className="assetsgroupnav-item"
        data-active={activeGroup === undefined ? "true" : "false"}
        aria-current={activeGroup === undefined ? "true" : undefined}
        onClick={() => onSelect(undefined)}
      >
        <span className="assetsgroupnav-name">全部</span>
        <span className="assetsgroupnav-total tnum">({totalCount})</span>
      </button>
      {groups.map((g) => {
        const dead = g.dead ?? 0;
        const dirty = g.dirty ?? 0;
        const active = g.group === activeGroup;
        return (
          <button
            key={g.group}
            type="button"
            className="assetsgroupnav-item"
            data-active={active ? "true" : "false"}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(g.group)}
          >
            <span className="assetsgroupnav-name" title={g.group}>
              {g.group}
            </span>
            {dead > 0 && (
              <span className="assetsgroupnav-dead tnum" title={`${dead} 条死链`}>
                ✗{dead}
              </span>
            )}
            {dirty > 0 && (
              <span className="assetsgroupnav-dirty" title={`${dirty} 行已改未保存`}>
                ●
              </span>
            )}
            <span className="assetsgroupnav-total tnum">{g.total}</span>
          </button>
        );
      })}
    </nav>
  );
}
