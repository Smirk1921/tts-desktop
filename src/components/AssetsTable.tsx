/**
 * <AssetsTable> ④素材面·素材台账表格 — UI-3 Stage A3
 *
 * 职责：素材 URL 台账六列（状态 / 类别 / 字段 / URL / 来源 / 体检消息），
 *   @tanstack/react-table 做数据引擎（core row model + getRowId 稳定行 ID），
 *   @tanstack/react-virtual 做行虚拟化（rows > 500 或 forceVirtual 时启用，
 *   见施工方案-v0.8.0 §10.3：TanStack 默认阈值 100 行，提前到 500 强制启用）。
 *
 * 关键设计（round-03 §3.1 ④素材·工作区"台账表格（虚拟滚动）"）：
 *   - 纯受控展示：rows 与编辑回调全由父组件（Stage C 的 Assets 路由）驱动，
 *     本组件不持业务数据状态、不调 hubClient、不碰确认门——「改 URL 即时保存」
 *     的写操作（/v1/assets/check 后续链路）在路由层经 useJobTracker + ConfirmGate 走。
 *   - 行高固定 28px：单一事实源为本文件 ROW_HEIGHT 常量，经根节点 CSS 变量
 *     --assetstable-rowh 注入样式（虚拟化 estimateSize 与 CSS 行高共用一处）。
 *   - 列渲染引擎：列定义 useMemo 稳定（scroll 时 useVirtualizer 触发重渲染，
 *     列身份漂移会重建 3500+ Row 对象 → 直接破坏 ≥30fps 红线）。
 *   - 虚拟化 hook 无条件调用（count 随开关置 0），规避条件调用 hook 的写法。
 *   - 行内编辑：url 单元格点击进入编辑（渲染 <AssetRowEditor>），Enter/失焦提交、
 *     Esc 取消；提交仅回调 onCellEdit(rowId, "url", next)，不落库。
 *
 * 符号（红线 §10，均已注册 LegendBar / 沿用 UI-2 既有字符）：
 *   ✓ 存活 / ✗ 死链 / ◌ 进行中（体检中，Code/Agent 面同款）/ ● 已改未提交（脏行蓝点）。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { Row } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import AssetRowEditor from "./AssetRowEditor";
import "./AssetsTable.css";

/** 素材台账一行 */
export interface AssetRow {
  /** 行 ID（稳定，通常 = 索引或 path） */
  id: string;
  /** 类别（deck / card / token / board / die / other） */
  group: string;
  /** 字段名（如 CustomDeck.face / Back / NumSlots） */
  field: string;
  /** 当前 URL */
  url: string;
  /** 来源（objects.csv / cards.csv / deck.yaml） */
  source: string;
  /** 体检状态：unknown=未体检 ok=存活 dead=死链 checking=体检中 */
  status?: "unknown" | "ok" | "dead" | "checking";
  /** 体检错误消息（dead 时） */
  statusMessage?: string;
  /** 本地已修改但未保存 */
  dirty?: boolean;
}

export interface AssetsTableProps {
  /** 台账数据（受控，父组件持有） */
  rows: AssetRow[];
  /** 单元格编辑回调（目前只支持 url 列；保存/体检链路在路由层） */
  onCellEdit(rowId: string, field: "url", next: string): void;
  /** 是否强制启用虚拟化；不传时内部按 >500 行自动启用 */
  forceVirtual?: boolean;
  /** 容器高度（px），默认 560 */
  height?: number;
}

type AssetStatus = NonNullable<AssetRow["status"]>;

/** 行高（px）：虚拟化 estimateSize 与 CSS 行高（--assetstable-rowh）的单一事实源 */
const ROW_HEIGHT = 28;

/** 强制虚拟化阈值（施工方案 §10.3：超过 500 行不等默认 100，提前启用） */
const VIRTUAL_THRESHOLD = 500;

/** 虚拟滚动 overscan（任务书指定值） */
const VIRTUAL_OVERSCAN = 10;

/** 状态 → 字符符号（unknown 空串占位不显示） */
const STATUS_SYMBOL: Record<AssetStatus, string> = {
  unknown: "",
  ok: "✓",
  dead: "✗",
  checking: "◌",
};

const columnHelper = createColumnHelper<AssetRow>();

/** 列定义工厂：beginEdit 必须引用稳定（useCallback），否则列身份漂移导致行模型重建 */
function buildColumns(beginEdit: (rowId: string) => void) {
  return [
    columnHelper.accessor((row) => row.status ?? "unknown", {
      id: "status",
      header: "状态",
      cell: (info) => (
        <span className={`assetstable-status assetstable-status-${info.getValue()}`}>
          {STATUS_SYMBOL[info.getValue()]}
        </span>
      ),
    }),
    columnHelper.accessor("group", {
      header: "类别",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("field", {
      header: "字段",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("url", {
      header: "URL",
      cell: (info) => (
        <button
          type="button"
          className="assetstable-url"
          title={info.getValue()}
          onClick={() => beginEdit(info.row.id)}
        >
          {info.getValue()}
        </button>
      ),
    }),
    columnHelper.accessor("source", {
      header: "来源",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("statusMessage", {
      header: "体检消息",
      cell: (info) => {
        const msg = info.getValue();
        return msg === undefined ? "—" : <span title={msg}>{msg}</span>;
      },
    }),
  ];
}

export default function AssetsTable(props: AssetsTableProps): ReactElement {
  const { rows, onCellEdit, forceVirtual = false, height = 560 } = props;

  // ---- 行内编辑态（纯 UI 态；提交后立即退出，数据仍归父组件） ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const beginEdit = useCallback((rowId: string): void => {
    setEditingId(rowId);
  }, []);
  const columns = useMemo(() => buildColumns(beginEdit), [beginEdit]);

  // ---- 数据引擎：core row model + 稳定行 ID（onCellEdit 以 rowId 寻址） ----
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
  });
  const coreRows = table.getRowModel().rows;

  // ---- 行虚拟化：hook 无条件调用，未启用时 count=0（规避条件调用 hook） ----
  const virtualEnabled = forceVirtual === true || rows.length > VIRTUAL_THRESHOLD;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: virtualEnabled ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  /** 单行渲染：virtual 非空时绝对定位 translateY 到虚拟偏移 */
  const renderRow = (row: Row<AssetRow>, virtual: { start: number } | null): ReactElement => {
    const original = row.original;
    const style: CSSProperties | undefined =
      virtual === null ? undefined : { transform: `translateY(${virtual.start}px)` };
    return (
      <tr
        key={row.id}
        className="assetstable-row"
        data-status={original.status ?? "unknown"}
        data-dirty={original.dirty === true ? "true" : "false"}
        data-virtual={virtual === null ? "false" : "true"}
        style={style}
      >
        {row.getVisibleCells().map((cell) => (
          <td key={cell.id} className={`assetstable-cell assetstable-col-${cell.column.id}`}>
            {cell.column.id === "url" && row.id === editingId ? (
              <AssetRowEditor
                value={original.url}
                autoFocus
                onCommit={(next) => {
                  onCellEdit(row.id, "url", next);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              flexRender(cell.column.columnDef.cell, cell.getContext())
            )}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div
      className="assetstable"
      style={{ height, "--assetstable-rowh": `${ROW_HEIGHT}px` } as CSSProperties}
    >
      {rows.length === 0 ? (
        <div className="assetstable-empty">— 暂无素材行</div>
      ) : (
        <div className="assetstable-scroll" ref={scrollRef}>
          <table className="assetstable-table" aria-label="素材台账">
            <thead className="assetstable-thead">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="assetstable-row assetstable-head-row">
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      scope="col"
                      className={`assetstable-cell assetstable-head-cell assetstable-col-${header.column.id}`}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody
              className="assetstable-tbody"
              style={virtualEnabled ? { height: totalSize } : undefined}
            >
              {virtualEnabled
                ? virtualRows.map((virtualRow) => {
                    const row = coreRows[virtualRow.index];
                    if (row === undefined) return null;
                    return renderRow(row, virtualRow);
                  })
                : coreRows.map((row) => renderRow(row, null))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
