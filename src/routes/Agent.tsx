/**
 * ② 代理面 — UI-2 Stage B2（round-03 §3.1 三区骨架：工作区 + 参数标注区）
 *
 * 职责：路由组装层——把 Stage A 展示组件组装为完整工作面：
 *  - 工作区（.agent-work）：<JobSheet> 作业流水（jobs + SSE 系统事件混排）；
 *  - 参数标注区（.agent-param）：<LuaExecPanel> Lua 直执 + <EventFlow> 事件流。
 *
 * 数据面全部来自 hub hooks（本组件不直接调 fetch / SSE、不写展示组件）：
 *  - useHub()        → client 单例（exec / status）；
 *  - useSseEvents()  → 事件流数组 + 连接状态 + 清空；
 *  - useJobTracker() → track() 把每次 hub 调用包成 job，rows 供 JobSheet 渲染。
 *
 * JobRow / SystemEvent 类型统一以 useJobTracker 的返回值为准（Stage A 已知坑：
 * JobSheet.tsx 内有结构兼容的重复定义，本路由不做类型别名导入，值直接透传，
 * 避免两份定义长期并存——Stage C 收敛）。
 *
 * SseProvider 挂载说明（Stage C 已接线）：App.tsx 顶层挂全局唯一 SseProvider，
 * 本路由的兜底包裹已移除——挂载期间不再产生第二条 SSE 连接，事件流/作业流水
 * 直接消费顶层订阅。
 */
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import JobSheet from "../components/JobSheet";
import LuaExecPanel from "../components/LuaExecPanel";
import EventFlow from "../components/EventFlow";
import { useSseEvents } from "../hub/useSseEvents";
import { useJobTracker } from "../hub/useJobTracker";
import { useHub } from "../hub/HubContext";
import "./routes.css";
import "./Agent.css";

/** 常用指令快捷入口（hardcoded；进 LuaExecPanel 后仍可编辑再执行） */
const SNIPPETS: { label: string; lua: string }[] = [
  { label: "1+1", lua: "return 1+1" },
  { label: "对象数", lua: "return #getObjects()" },
  { label: "当前玩家", lua: "return Player.getPlayers()[1].color" },
  { label: "存档名", lua: "return Global.getVar('saveName') or '未命名'" },
  { label: "TTS 版本", lua: "return Global.getVar('ttsVersion') or 'unknown'" },
];

/** 参数摘要：单行截断到 50 字符（job 流水的 args 列展示用） */
function argsSummary(lua: string): string {
  return `lua: ${lua.slice(0, 50)}${lua.length > 50 ? "..." : ""}`;
}

/** ② 代理面路由：hooks 消费 + 三区组装（SSE 由 App.tsx 顶层 SseProvider 提供） */
export default function Agent(): ReactElement {
  const { client } = useHub();
  const { events, state, clear } = useSseEvents();
  const { rows, track } = useJobTracker();
  const [connected, setConnected] = useState<boolean>(false);

  // 检测 TTS 连接：status.tts.connected（caps 可用性已由 useHub 保证——
  // HubContext.Provider 仅在 HubLauncher 验证通过后挂载，能走到这里即 caps 就绪）
  useEffect(() => {
    let cancelled = false;
    client
      .status()
      .then((s) => {
        if (!cancelled) setConnected(s.tts.connected === true);
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Lua 直执：包成 job（tool 用 HTTP 路由形态，非 MCP 工具名——红线）。
  // 失败时 track 只记 fail，错误原样冒泡给 LuaExecPanel 展示红字。
  const handleExec = async (lua: string): Promise<unknown> => {
    return track("POST /v1/exec", argsSummary(lua), () => client.exec(lua));
  };

  return (
    <div className="route-slide">
      <div className="agent-layout">
        {/* 工作区：作业流水 */}
        <main className="agent-work" aria-label="作业流水">
          {rows.length === 0 ? (
            <div className="agent-empty">◌ 暂无作业 · 执行 Lua 或等待 SSE 事件</div>
          ) : (
            <JobSheet rows={rows} />
          )}
        </main>
        {/* 参数标注区：Lua 直执 + 事件流 */}
        <aside className="agent-param" aria-label="Lua 直执与事件流">
          <LuaExecPanel
            onExec={handleExec}
            disabled={!connected}
            snippets={SNIPPETS}
          />
          <EventFlow events={events} live={state === "open"} onClear={clear} />
        </aside>
      </div>
    </div>
  );
}
