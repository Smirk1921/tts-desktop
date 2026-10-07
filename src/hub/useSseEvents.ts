/**
 * useSseEvents — UI-2 Stage A1：SSE 事件全局 Context
 *
 * 把 UI-1b 的 subscribeEvents（./sse.ts）封装为全局唯一订阅：App.tsx 顶层挂
 * 一次 SseProvider，任意组件经 useSseEvents() 拿到事件数组（FIFO，最新在末尾，
 * 默认上限 500 条）、连接状态与清空动作。useJobTracker 的"系统事件行"也源自这里。
 *
 * 说明：任务书指定本文件为 .ts，Provider 返回值用 createElement 构造（与 JSX 等价）。
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { HUB_BASE_URL } from "./client";
import { subscribeEvents } from "./sse";
import type { HubEvent, HubStreamState } from "./sse";

/** SSE 上下文值：事件数组（FIFO，最新在末尾）+ 连接状态 + 清空动作 */
export interface SseContextValue {
  /** 累计接收的事件，最多 MAX_EVENTS 条（默认 500） */
  events: HubEvent[];
  /** 当前连接状态 */
  state: HubStreamState;
  /** 清空事件数组（用户点"清空"按钮时调） */
  clear(): void;
}

export const SseContext = createContext<SseContextValue | null>(null);

export interface SseProviderProps {
  /** hub 的 SSE baseUrl（默认 http://127.0.0.1:39995，与 HubClient 同源） */
  baseUrl?: string;
  /** 事件数组上限（默认 500） */
  maxEvents?: number;
  children: ReactNode;
}

/** 在 App.tsx 顶层挂一次；卸载时自动停止 SSE 订阅 */
export function SseProvider(props: SseProviderProps): JSX.Element {
  const { baseUrl = HUB_BASE_URL, maxEvents = 500, children } = props;

  const [events, setEvents] = useState<HubEvent[]>([]);
  const [state, setState] = useState<HubStreamState>("connecting");

  // maxEvents 经 ref 读取：变化时只影响后续 FIFO 截断，不触发重订阅（下限钳到 1）
  const maxRef = useRef(maxEvents);
  maxRef.current = Math.max(1, maxEvents);

  useEffect(() => {
    // 全局唯一订阅；stop 作为 cleanup，仅 baseUrl 变化或卸载时执行
    return subscribeEvents(
      baseUrl,
      (e) => {
        setEvents((prev) => {
          const cap = maxRef.current;
          // FIFO：满员后挤掉最旧一条（等价 slice(-(cap-1))，cap=1 时也正确）
          return prev.length < cap
            ? [...prev, e]
            : [...prev.slice(prev.length - cap + 1), e];
        });
      },
      setState,
    );
  }, [baseUrl]);

  const clear = useCallback(() => {
    setEvents([]);
  }, []);

  const value = useMemo<SseContextValue>(
    () => ({ events, state, clear }),
    [events, state, clear],
  );

  return createElement(SseContext.Provider, { value }, children);
}

/** 消费 SSE 上下文；不在 Provider 内时抛错 */
export function useSseEvents(): SseContextValue {
  const v = useContext(SseContext);
  if (v === null) {
    throw new Error(
      "useSseEvents() 必须在 <SseProvider> 内使用（App.tsx 顶层挂载一次）",
    );
  }
  return v;
}
