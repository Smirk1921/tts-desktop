/**
 * <SliceGrid> 卡牌面·切片网格（③卡牌工作区主角） — UI-3 Stage A2
 *
 * 职责：按 ui-design/round-03/UI施工方案.md §4.9 规格渲染图集切片网格：
 *   .sheetzone（cols×rows CSS Grid，网格线减淡）+ 真实牌面格 .cellcard +
 *   虚线占位格 .cellghost + 右下脚注 .ghost-note；
 *   双态 sel（蓝框选中）/ dead（右上 ✗ 红点死链）。
 *
 * 关键设计：
 *  - 纯受控展示：不持状态、不调 hubClient；图面像素数据由 <CardFacePreview>
 *    单独加载（经 fileCache），本组件格内只显示卡序号 + name（若有）；
 *  - 卡格按 card.i（0-based row-major）定位：先建 i→card 映射再遍历
 *    0..cols*rows-1，cards 数组允许乱序 / 稀疏；超出 cols*rows 的卡忽略；
 *  - deadLinkSet 由 Stage C 的 DeadLinkContext 经路由下发（坑 26：Stage B 可能为
 *    undefined）——undefined 容错为"全部存活"，不阻塞 B 阶段渲染；
 *  - filled = 已切片卡序号集合（undefined = 全部未切）：未切片卡内容减淡提示；
 *  - 符号纪律（红线 §10）：✗ 已在 LegendBar 注册（死链），本组件不新增符号。
 */
import { useMemo } from "react";
import type { CSSProperties, ReactElement } from "react";
import "./SliceGrid.css";

/** 图集元信息（sheetzone 按 w/h 定比例、cols×rows 定网格） */
export interface SheetMeta {
  /** 图集 URL（用于展示，不直接 <img>） */
  url: string;
  /** 图集宽（px） */
  w: number;
  /** 图集高（px） */
  h: number;
  /** 列数 */
  cols: number;
  /** 行数 */
  rows: number;
}

/** 一张卡（卡序号 + 可选卡面 / 卡名） */
export interface SliceCard {
  /** 卡序号（0-based，按 row-major） */
  i: number;
  /** 卡面本地路径（root 内相对路径，用于 /v1/files/read） */
  face?: string;
  /** 卡面 URL（原始，用于死链判断） */
  faceUrl?: string;
  /** 卡名 */
  name?: string;
}

export interface SliceGridProps {
  /** 图集元信息 */
  sheet: SheetMeta;
  /** 卡列表（按 card.i 落格；长度 ≤ cols*rows） */
  cards: SliceCard[];
  /** 已切片的卡序号集合；undefined = 全部未切 */
  filled?: Set<number>;
  /** 当前选中卡序号（高亮蓝框） */
  selectedIndex?: number;
  /** 死链 URL 集合（Stage C 提供，B 阶段可能为 undefined = 全部存活） */
  deadLinkSet?: ReadonlySet<string>;
  /** 点击牌面格回调（index = card.i） */
  onSelect(index: number): void;
}

export default function SliceGrid(props: SliceGridProps): ReactElement {
  const { sheet, cards, filled, selectedIndex, deadLinkSet, onSelect } = props;

  const total = sheet.cols * sheet.rows;

  // card.i → card 映射：cards 允许乱序 / 稀疏，落格查表 O(1)
  const byIndex = useMemo(() => {
    const m = new Map<number, SliceCard>();
    for (const c of cards) {
      m.set(c.i, c);
    }
    return m;
  }, [cards]);

  // 图集比例（w/h 为 0 时不设 aspect-ratio，退化为容器自然高）
  const zoneStyle = {
    "--sz-cols": String(sheet.cols),
    "--sz-rows": String(sheet.rows),
    aspectRatio:
      sheet.w > 0 && sheet.h > 0 ? `${sheet.w} / ${sheet.h}` : undefined,
  } as CSSProperties;

  const cells: ReactElement[] = [];
  for (let i = 0; i < total; i += 1) {
    const card = byIndex.get(i);
    if (card === undefined) {
      // 虚线占位格：无卡可放，不响应点击
      cells.push(
        <div key={`ghost-${i}`} className="cellghost" aria-hidden="true" />,
      );
      continue;
    }
    const dead =
      card.faceUrl !== undefined && deadLinkSet?.has(card.faceUrl) === true;
    const filledHere = filled === undefined ? false : filled.has(i);
    cells.push(
      <button
        key={`card-${i}`}
        type="button"
        className="cellcard"
        data-sel={selectedIndex === i ? "true" : "false"}
        data-dead={dead ? "true" : "false"}
        data-filled={filledHere ? "true" : "false"}
        aria-pressed={selectedIndex === i}
        aria-label={`卡 ${i}${card.name !== undefined ? ` ${card.name}` : ""}${dead ? " ✗ 死链" : ""}`}
        title={`#${i}${card.name !== undefined ? ` · ${card.name}` : ""}${card.face !== undefined ? `\n${card.face}` : ""}${dead ? "\n✗ 死链（去素材面体检）" : ""}${filledHere ? "" : "\n未切片"}`}
        onClick={() => onSelect(i)}
      >
        <span className="cellcard-idx">{i}</span>
        {card.name !== undefined && (
          <span className="cellcard-name">{card.name}</span>
        )}
      </button>,
    );
  }

  return (
    <div
      className="sheetzone"
      style={zoneStyle}
      role="group"
      aria-label={`图集 ${sheet.url}（${sheet.cols}×${sheet.rows}）`}
    >
      {cells}
      <div className="ghost-note tnum">
        {cards.length}/{total}
      </div>
    </div>
  );
}
