/**
 * <JobSheet> 作业流水 — Stage A3（代理面工作区）
 * 职责：渲染 JobRow 混合数组（tool 作业行 + SSE 系统事件行），按时间戳升序（调用方保证有序）。
 * 纯受控展示：不调 hubClient、不订阅 SSE；数据由 useJobTracker（Stage A1）供给。
 *
 * 状态色（红线 §2.5）：run=蓝（代理活动）左条 + tool 加粗 + ◌ 旋转 /
 * done=ok ✓ / fail=red ✗ / wait=amber ⏸；SSE error 行整行反色（--red 底 --w 字）。
 *
 * 符号：◌ ✓ ✗ ⏸（均为字符，无图标库）。
 */
import type { ReactElement } from "react";
import "./JobSheet.css";

/** 与 useJobTracker.ts 的 Job 接口对应（Stage A1 已定义） */
export interface JobRow_Job {
  no: number;
  tool: string;
  args: string;
  state: "run" | "done" | "fail" | "wait";
  res?: string;
  startedAt: number;
  finishedAt?: number;
}

/** 与 useJobTracker.ts 的 SystemEvent 接口对应 */
export interface JobRow_SystemEvent {
  kind: "sse";
  ts: number;
  type: string;
  msg: string;
}

export type JobRow = JobRow_Job | JobRow_SystemEvent;

/** 类型守卫：SSE 系统事件行（Job 无 kind 字段，in 收窄即可区分） */
export function isSystemEventRow(row: JobRow): row is JobRow_SystemEvent {
  return "kind" in row;
}

export interface JobSheetProps {
  /** 按时间戳升序的混合数组 */
  rows: JobRow[];
  /** 用户指令（可选；渲染在 jobs 之前的"U 编号"行，v0.8.0 暂用不到） */
  userCmds?: { id: string; text: string }[];
}

/** 作业状态 → 状态符号 */
function stateSymbol(state: JobRow_Job["state"]): string {
  switch (state) {
    case "run":
      return "◌";
    case "done":
      return "✓";
    case "fail":
      return "✗";
    case "wait":
      return "⏸";
  }
}

/** epoch ms → HH:MM:SS（SSE 行时间戳） */
function formatTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function JobSheet(props: JobSheetProps): ReactElement {
  const { rows, userCmds } = props;

  return (
    <div className="jobsheet" aria-label="作业流水">
      {userCmds?.map((uc) => (
        <div key={uc.id} className="ajob u">
          <span className="ajob-no tnum">{uc.id}</span>
          <span className="ajob-text">{uc.text}</span>
        </div>
      ))}
      {rows.map((row) =>
        isSystemEventRow(row) ? (
          <div key={`sse-${row.ts}`} className="ajob sse" data-type={row.type}>
            <span className="ajob-ts tnum">{formatTs(row.ts)}</span>
            <span className="ajob-sse-type">{row.type}</span>
            <span className="ajob-sse-msg">{row.msg}</span>
          </div>
        ) : (
          <div
            key={`job-${row.no}`}
            className="ajob"
            data-state={row.state}
          >
            <span className="ajob-no tnum">{row.no}</span>
            <span className="ajob-tool">{row.tool}</span>
            <span className="ajob-args">{row.args}</span>
            <span className="ajob-res">
              {/* 符号独立成 span：run 态仅 ◌ 旋转，结果文本不随之转（CSS animation） */}
              <span className="ajob-sym" aria-hidden="true">
                {stateSymbol(row.state)}
              </span>
              {row.res ? ` ${row.res}` : ""}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
