/**
 * useJobTracker — UI-2 Stage A1：hub 调用作业流水
 *
 * 在 Code.tsx / Agent.tsx 内调用：track("POST /v1/exec", "lua: …", () =>
 * hubClient.exec(…)) 把每次 hub 路由调用包成一条 job（序号 / 工具名 / 参数摘要 /
 * 状态 / 结果摘要）供 JobSheet 渲染；同时把全局 SSE 事件（useSseEvents）
 * 折算成"系统事件行"，按时间戳与 jobs 混排为 rows。
 *
 * 约定：
 *  - tool 名用 HTTP 路由形态（"POST /v1/exec"），不是 MCP 工具名（红线 §10）；
 *  - fn 的失败只记 job（fail），错误原样重新抛给调用方自行处理；
 *  - wait 状态本窗口不用，留给 ConfirmGate（Stage C）。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useSseEvents } from "./useSseEvents";
import type { HubEvent } from "./sse";

/** job 状态机：run（执行中）→ done（成功）/ fail（失败）；wait（待用户确认，本窗口暂不用，留给 ConfirmGate） */
export type JobState = "run" | "done" | "fail" | "wait";

/** 一条 hub 路由调用记录（不是 MCP 工具名，是 HTTP 路由） */
export interface Job {
  /** 序号（从 1 自增） */
  no: number;
  /** 工具名（hub 路由形态，如 "POST /v1/exec"） */
  tool: string;
  /** 调用参数摘要（单行，如 "lua: return 1+1"） */
  args: string;
  /** 当前状态 */
  state: JobState;
  /** 结果摘要（done 时一行；fail 时错误消息） */
  res?: string;
  /** 开始时间戳（ms） */
  startedAt: number;
  /** 完成时间戳（ms） */
  finishedAt?: number;
}

/** 系统事件行（来自 SSE，不是 job，但混在 JobSheet 渲染） */
export interface SystemEvent {
  kind: "sse";
  ts: number;
  /** SSE 事件类型（loaded / print / error / object / saved / unknown） */
  type: string;
  msg: string;
}

/** JobSheet 渲染的混合行：要么是 job，要么是系统事件 */
export type JobRow = Job | SystemEvent;

/** 类型守卫：判断是否为 SystemEvent（Job 无 kind 字段，in 收窄即可区分） */
export function isSystemEvent(row: JobRow): row is SystemEvent {
  return "kind" in row;
}

export interface JobTrackerValue {
  /** 按时间戳升序的混合数组（jobs + SSE 事件合并） */
  rows: JobRow[];
  /** 仅 job 数组（不含 SSE 事件），按时间戳升序 */
  jobs: Job[];
  /**
   * 包一次 hub 调用为 job。tool 名建议用 "POST /v1/exec" 这样的 HTTP 路由形态（红线：不是 MCP 工具名）。
   *
   * @param tool 工具名（"POST /v1/exec" / "POST /v1/scripts/pull" / "PUT /v1/files/write" 等）
   * @param args 参数摘要（单行字符串，展示用）
   * @param fn 真实的 hub 调用
   * @returns fn 的返回值
   * @throws fn 抛出的错误原样冒泡；job 标记 fail
   */
  track<T>(tool: string, args: string, fn: () => Promise<T>): Promise<T>;
  /** 清空所有 jobs（不影响 SSE 事件） */
  clearJobs(): void;
}

/** 行排序时间戳：job 取 startedAt，系统事件取 ts */
function stamp(row: JobRow): number {
  return isSystemEvent(row) ? row.ts : row.startedAt;
}

/** SSE 事件 → 系统事件行 */
function toSystemEvent(e: HubEvent): SystemEvent {
  return { kind: "sse", ts: e.ts, type: e.type, msg: e.msg };
}

/** 在 Code.tsx / Agent.tsx 内调用；SSE 事件从全局 useSseEvents() 读取 */
export function useJobTracker(): JobTrackerValue {
  const { events: sseEvents } = useSseEvents();

  const [jobs, setJobs] = useState<Job[]>([]);
  const noRef = useRef(0);

  // 收尾某条 job：补状态 / 结果摘要 / 完成时间（no 定位，避免闭包持整表）
  const finish = useCallback((no: number, state: JobState, res: string) => {
    setJobs((prev): Job[] =>
      prev.map((j): Job =>
        j.no === no ? { ...j, state, res, finishedAt: Date.now() } : j,
      ),
    );
  }, []);

  const track = useCallback(
    <T>(tool: string, args: string, fn: () => Promise<T>): Promise<T> => {
      noRef.current += 1;
      const no = noRef.current;
      const startedAt = Date.now();
      setJobs((prev): Job[] => [
        ...prev,
        { no, tool, args, state: "run", startedAt },
      ]);

      // async IIFE：fn 同步抛错也归一为 rejection，job 不会悬在 run
      return (async () => {
        try {
          const result = await fn();
          // JSON.stringify(undefined) === undefined，先兜底再截断（80 字符）
          const res = (JSON.stringify(result) ?? "undefined").slice(0, 80);
          finish(no, "done", res);
          return result;
        } catch (e) {
          finish(no, "fail", e instanceof Error ? e.message : String(e));
          throw e;
        }
      })();
    },
    [finish],
  );

  const clearJobs = useCallback(() => {
    setJobs([]);
  }, []);

  // jobs 追加时 startedAt 单调，天然升序；rows 与 SSE 事件按时间戳归并
  const rows = useMemo<JobRow[]>(() => {
    const merged: JobRow[] = [...jobs, ...sseEvents.map(toSystemEvent)];
    return merged.sort((a, b) => stamp(a) - stamp(b));
  }, [jobs, sseEvents]);

  return useMemo<JobTrackerValue>(
    () => ({ rows, jobs, track, clearJobs }),
    [rows, jobs, track, clearJobs],
  );
}
