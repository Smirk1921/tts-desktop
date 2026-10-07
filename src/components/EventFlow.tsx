/**
 * <EventFlow> 事件流 — Stage A3（代理面右侧）
 * 职责：渲染 SSE 事件数组（时间戳升序，最新在末尾），events 变化时自动滚动到底。
 * 纯受控展示：不订阅 SSE；events / live 由父级（useEventStream，Stage A1）供给。
 *
 * 状态色（红线 §2.5）：error 行整行反色（--red 底 --w 字）/
 * loaded · saved=ok / object=blue / print=默认 --w；头部存活点 ● =ok。
 */
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { HubEvent } from "../hub/sse";
import "./EventFlow.css";

export interface EventFlowProps {
  /** SSE 事件数组（时间戳升序，最新在末尾） */
  events: HubEvent[];
  /** SSE 连接状态（用于顶部状态条） */
  live: boolean;
  /** 清空回调 */
  onClear?(): void;
}

/** epoch ms → HH:MM:SS */
function formatTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function EventFlow(props: EventFlowProps): ReactElement {
  const { events, live, onClear } = props;
  const bodyRef = useRef<HTMLDivElement>(null);

  /* 新事件到达 → 滚动到底部（最新在末尾） */
  useEffect(() => {
    const el = bodyRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events]);

  return (
    <div className="eventflow">
      <div className="eventflow-head">
        <span className="eventflow-title">事件流</span>
        <span
          className="eventflow-status"
          data-live={live}
          aria-label={live ? "事件流：已连接" : "事件流：未连接"}
        >
          {live ? "●" : "○"}
        </span>
        {onClear !== undefined && (
          <button
            type="button"
            className="eventflow-clear"
            onClick={onClear}
          >
            清空
          </button>
        )}
      </div>
      <div className="eventflow-body" ref={bodyRef}>
        {events.map((e, i) => (
          <div key={i} className="r" data-type={e.type}>
            <span className="ts tnum">{formatTs(e.ts)}</span>
            <span className="tg">{e.type}</span>
            <span className="m">{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
