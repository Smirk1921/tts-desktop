/**
 * App.tsx — UI-1a 状态机 + UI-1b hub 接入
 *
 * 职责：
 *  - UI-1b：caps === null → <HubLauncher>（探测 39995 / 引导启动 / 版本兼容门）；
 *    验证通过后经 HubContext.Provider 下发 client 单例 + caps，渲染 Frame + 当前路由
 *  - 持有 activeLayer（0..4），渲染 Frame + LayerNav + LegendBar + 当前路由 + SignBlock + ConfirmGate
 *  - caps 就绪后轮询 /v1/status → 真实连接状态 → Frame 状态行
 *
 * UI-2/3/4 在此接入：
 *  - LayerNav 圆点按真实工作面状态计算（现仍为演示硬编码）
 *  - ConfirmGate 接真实 /v1/push confirm:true；死链 / 待签数接真实数据
 */
import { useEffect, useState } from "react";
import Frame from "./components/Frame";
import LayerNav, { LayerItem } from "./components/LayerNav";
import LegendBar from "./components/LegendBar";
import SignBlock from "./components/SignBlock";
import ConfirmGate from "./components/ConfirmGate";
import HubLauncher from "./components/HubLauncher";

import { HubContext, hubClient } from "./hub/HubContext";
import type { HubCapabilities } from "./hub/capabilities";
import type { HubStatus } from "./hub/client";

import Overview from "./routes/Overview";
import Code from "./routes/Code";
import Agent from "./routes/Agent";
import Cards from "./routes/Cards";
import Assets from "./routes/Assets";

type LayerId = "overview" | "code" | "agent" | "cards" | "assets";

const LAYERS: LayerItem[] = [
  { id: "overview", num: "⓪", name: "总览", dot: "ok",   hint: "⓪ 总览（UI-4 填充）" },
  { id: "code",     num: "①", name: "代码", dot: "ok",   hint: "① 代码（UI-2 填充）" },
  { id: "agent",    num: "②", name: "代理", dot: "blue", hint: "② 代理（UI-2 填充）" },
  { id: "cards",    num: "③", name: "卡牌", dot: "amber",hint: "③ 卡牌（UI-3 填充）" },
  { id: "assets",   num: "④", name: "素材", dot: "red",  hint: "④ 素材（UI-3 填充）" },
];

const PACK = { name: "mypack", version: "v1.3", branch: "main" };

const STATUS_POLL_MS = 30_000;

const SIGN_CHECKS = [
  { k: "版本", v: "v1.3 · 已生成", tone: "ok" as const },
  { k: "校样", v: "3 处差异",     tone: "bad" as const, next: true },
  { k: "打样", v: "未开始",       tone: "ok" as const },
  { k: "出厂", v: "—",            tone: "ok" as const },
];

const SIGN_PROCS = [
  { name: "写回游戏",  state: "open" as const },
  { name: "发布 V2",   state: "soon" as const },
  { name: "同步 V2",   state: "soon" as const },
];

const DEMO_CONFIRM_ITEMS = [
  { file: "scripts/global.lua",  diff: "+12 -3" },
  { file: "scripts/card_01.lua", diff: "+5 -0" },
  { file: "ui/table.xml",        diff: "重写" },
];

function App() {
  const [caps, setCaps] = useState<HubCapabilities | null>(null);
  const [status, setStatus] = useState<HubStatus | null>(null);
  const [activeLayer, setActiveLayer] = useState<LayerId>("overview");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // caps 就绪后轮询 /v1/status：真实 TTS 连接状态 → Frame 状态行
  useEffect(() => {
    if (caps === null) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await hubClient.status();
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [caps]);

  const routeElement = (() => {
    switch (activeLayer) {
      case "overview": return <Overview />;
      case "code":     return <Code />;
      case "agent":    return <Agent />;
      case "cards":    return <Cards />;
      case "assets":   return <Assets />;
    }
  })();

  // caps 未就绪：先过 HubLauncher（探测 / 引导 / 版本兼容门）
  if (caps === null) {
    return <HubLauncher onReady={setCaps} />;
  }

  return (
    <HubContext.Provider value={{ client: hubClient, caps }}>
      <Frame
        pack={PACK}
        connected={status?.tts.connected ?? false}
        version={status?.tts.version}
        nav={
          <LayerNav
            items={LAYERS}
            active={activeLayer}
            onSelect={(id) => setActiveLayer(id as LayerId)}
          />
        }
        legend={<LegendBar />}
        signBlock={
          <SignBlock
            version={PACK.version}
            checks={SIGN_CHECKS}
            procs={SIGN_PROCS}
            onSign={() => setConfirmOpen(true)}
            onDetail={() => {
              /* UI-4 填充 */
            }}
          />
        }
      >
        {routeElement}
      </Frame>

      <ConfirmGate
        open={confirmOpen}
        title="确认写回游戏（演示）"
        items={DEMO_CONFIRM_ITEMS}
        assetWarning="检测到 2 处素材改动未随本次 push 生效"
        ackLabel="我已知晓上述影响，确认写回"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          // UI-2 在此接真实 /v1/push confirm:true（hubClient.push(root, true)）
          setConfirmOpen(false);
        }}
      />
    </HubContext.Provider>
  );
}

export default App;
