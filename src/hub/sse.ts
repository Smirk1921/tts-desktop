/**
 * SSE 订阅 — UI-1b，施工方案 v0.8.0 §8.5-2（GET /v1/events，契约 hub-control.md §5）
 *
 * 浏览器原生 EventSource：自动重连（含服务端重启后回连），状态经 onStateChange 上报。
 * data 帧为 TTS 入站消息原样 JSON（messageID 转发集合：1 GameLoaded / 2 Print / 3 Error /
 * 4 CustomMessage / 6 GameSaved / 7 ObjectCreated；无 id:/event:/心跳/回放）。
 *
 * 用法：
 *   const stop = subscribeEvents("http://127.0.0.1:39995", onEvent, onStateChange);
 *   ... // 组件卸载时
 *   stop();  // 关闭连接并上报 "closed"
 */

export type HubEventType =
  | "loaded" // messageID 1 GameLoaded
  | "print" // 2 Print
  | "error" // 3 Error
  | "object" // 7 ObjectCreated
  | "saved" // 6 GameSaved
  | "unknown"; // 4 CustomMessage / 无法分类

export interface HubEvent {
  type: HubEventType;
  /** 本地接收时刻（epoch ms） */
  ts: number;
  /** 人类可读摘要（中文，供事件流面板直显） */
  msg: string;
  /** 解析后的原始消息对象（data 非法 JSON 时为原始文本） */
  raw: unknown;
}

export type HubStreamState = "connecting" | "open" | "closed";

export function subscribeEvents(
  baseUrl: string,
  onEvent: (e: HubEvent) => void,
  onStateChange: (s: HubStreamState) => void,
): () => void {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/events`;
  const es = new EventSource(url);

  es.onopen = () => onStateChange("open");
  // onerror 后 readyState 仍为 CONNECTING = EventSource 在自动重连；CLOSED = 彻底失败
  es.onerror = () =>
    onStateChange(
      es.readyState === EventSource.CLOSED ? "closed" : "connecting",
    );

  es.onmessage = (ev: MessageEvent<string>) => {
    let raw: unknown = ev.data;
    try {
      raw = JSON.parse(ev.data) as unknown;
    } catch {
      /* 保持原始文本，分类为 unknown */
    }
    onEvent({ type: classify(raw), ts: Date.now(), msg: describe(raw), raw });
  };

  return () => {
    es.close();
    onStateChange("closed");
  };
}

function classify(raw: unknown): HubEventType {
  const id = messageID(raw);
  switch (id) {
    case 1:
      return "loaded";
    case 2:
      return "print";
    case 3:
      return "error";
    case 6:
      return "saved";
    case 7:
      return "object";
    default:
      return "unknown";
  }
}

function messageID(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const id = (raw as { messageID?: unknown }).messageID;
  return typeof id === "number" ? id : undefined;
}

function describe(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return String(raw ?? "");
  const r = raw as Record<string, unknown>;
  switch (messageID(raw)) {
    case 1: {
      const n = Array.isArray(r.scriptStates) ? r.scriptStates.length : 0;
      return `GameLoaded（${n} 个脚本状态）`;
    }
    case 2:
      return `Print：${String(r.message ?? "")}`;
    case 3: {
      const at = r.guid != null ? ` @${String(r.guid)}` : "";
      const what = String(r.errorMessagePrefix ?? r.error ?? "");
      return `TTS Error${at}：${what}`;
    }
    case 6:
      return typeof r.savePath === "string"
        ? `GameSaved：${r.savePath}`
        : "GameSaved";
    case 7:
      return `ObjectCreated ${String(r.guid ?? "")}`;
    case 4:
      return "CustomMessage";
    default:
      return `messageID ${String(r.messageID ?? "?")}`;
  }
}
