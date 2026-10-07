/**
 * App.tsx — UI-1b hub 门 + UI-2/3 Stage C 顶层接线
 *
 * 职责：
 *  - caps === null → <HubLauncher>（探测 39995 / 引导启动 / 版本兼容门）；
 *    验证通过后按固定顺序挂四层 Provider：
 *      HubContext.Provider（client 单例 + caps）
 *        → ConfirmGateProvider（全站确认门 request 单槽）
 *          → SseProvider（App.tsx 顶层唯一 SSE 订阅，红线 3）
 *            → DeadLinkProvider（全站死链 store，UI-3 Stage C；③④ dot + 路由消费）
 *    → <AppInner> 渲染 Frame + LayerNav + LegendBar + 当前路由 + SignBlock
 *  - ConfirmGate 全站唯一实例在 <ConfirmGateHost>（本文件，红线 1）：从
 *    ConfirmGateContext 读 request 渲染；业务层一律经 useConfirmGate().ask(req)
 *    打开（红线 2），不再各自渲染 <ConfirmGate>
 *  - caps 就绪后轮询 /v1/status（30s）→ 真实 TTS 连接状态 → Frame 状态行
 *  - LayerNav 圆点真实化（红线 4）：② 代理面 dot 由 SSE 连接态实时计算；
 *    ③ 卡牌 / ④ 素材 dot 由 DeadLinkContext 同源驱动（deadUrls 非空 = red，
 *    hint 带死链数；UI-4 再细分"cards 选中卡死链" vs "assets 总死链数"）；
 *    ① 代码面 dirty 上报待 Code 面提供（现仍占位 ok）
 *
 * UI-4 在此接入：
 *  - ⓪ 总览填充；① 代码 dot dirty 真实化；SignBlock.onSign 接真实会签出厂流程
 */
import { useContext, useEffect, useState, type JSX } from "react";
import Frame from "./components/Frame";
import LayerNav, { type LayerItem } from "./components/LayerNav";
import LegendBar from "./components/LegendBar";
import SignBlock from "./components/SignBlock";
import ConfirmGate from "./components/ConfirmGate";
import HubLauncher from "./components/HubLauncher";

import {
  ConfirmGateContext,
  ConfirmGateProvider,
  HubContext,
  hubClient,
  useHub,
} from "./hub/HubContext";
import { SseProvider, useSseEvents } from "./hub/useSseEvents";
import { DeadLinkProvider, useDeadLinks } from "./state/DeadLinkContext";
import type { HubCapabilities } from "./hub/capabilities";
import type { HubStatus } from "./hub/client";

import Overview from "./routes/Overview";
import Code from "./routes/Code";
import Agent from "./routes/Agent";
import Cards from "./routes/Cards";
import Assets from "./routes/Assets";

type LayerId = "overview" | "code" | "agent" | "cards" | "assets";

const PACK = { name: "mypack", version: "v0.8.0", branch: "main" };

const STATUS_POLL_MS = 30_000;

const SIGN_CHECKS = [
  { k: "版本", v: "v0.8.0", tone: "ok" as const },
  { k: "校样", v: "通过", tone: "ok" as const },
  { k: "打样", v: "待", tone: "bad" as const, next: true },
  { k: "出厂", v: "未", tone: "bad" as const },
];

const SIGN_PROCS = [
  { name: "写回游戏", state: "open" as const },
  { name: "发布 V2", state: "soon" as const, badge: "v0.9.0" },
  { name: "同步 V2", state: "soon" as const, badge: "v0.9.0" },
];

/** 会签栏 + 状态行 + 确认门宿主（须在 HubContext / ConfirmGateProvider / SseProvider / DeadLinkProvider 内） */
function AppInner(): JSX.Element {
  const { client } = useHub();
  const { state: sseState } = useSseEvents();
  // 全站死链 store（Stage C）：③④ dot 同源双色（UI-4 再细分 cards 选中卡 / assets 总数）
  const { deadUrls } = useDeadLinks();

  const [status, setStatus] = useState<HubStatus | null>(null);
  const [activeLayer, setActiveLayer] = useState<LayerId>("overview");

  // caps 就绪后轮询 /v1/status：真实 TTS 连接状态 → Frame 状态行
  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const s = await client.status();
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
  }, [client]);

  // LayerNav 圆点：② 代理面按 SSE 连接态、③④ 卡牌/素材按死链集合双色
  // （红线 4，Stage C：deadUrls 非空 = red，同源——一个集合两面同色）；
  // ① 代码面 TODO：dirty 状态由 Code 面上报后再真实化（现占位 ok）
  const layers: LayerItem[] = [
    { id: "overview", num: "⓪", name: "总览", dot: "ok", hint: "⓪ 总览（UI-4 填充）" },
    { id: "code", num: "①", name: "代码", dot: "ok", hint: "① 代码（dot TODO：由 Code 面上报 dirty）" },
    {
      id: "agent",
      num: "②",
      name: "代理",
      dot: sseState === "open" ? "ok" : sseState === "connecting" ? "blue" : "amber",
      hint: `② 代理 · SSE ${sseState}`,
    },
    {
      id: "cards",
      num: "③",
      name: "卡牌",
      dot: deadUrls.size > 0 ? "red" : "ok",
      hint: `③ 卡牌 · 死链 ${deadUrls.size}`,
    },
    {
      id: "assets",
      num: "④",
      name: "素材",
      dot: deadUrls.size > 0 ? "red" : "ok",
      hint: `④ 素材 · 死链 ${deadUrls.size}`,
    },
  ];

  const connected = status?.tts.connected === true;

  return (
    <>
      <Frame
        pack={PACK}
        connected={connected}
        version={status?.tts.version}
        nav={
          <LayerNav
            items={layers}
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
            onSign={() => {
              // SignBlock.onSign 暂为占位（UI-4 总览面接真实会签出厂）；
              // 当前危险操作入口由 Code 面的「写回游戏」经 useConfirmGate().ask 触发
            }}
            onDetail={() => {
              /* UI-4 填充 */
            }}
          />
        }
      >
        {activeLayer === "overview" && <Overview />}
        {activeLayer === "code" && <Code />}
        {activeLayer === "agent" && <Agent />}
        {activeLayer === "cards" && <Cards />}
        {activeLayer === "assets" && <Assets />}
      </Frame>

      {/* 确认门全站唯一实例（红线 1） */}
      <ConfirmGateHost />
    </>
  );
}

/** 确认门宿主：从 ConfirmGateContext 读 request 渲染唯一 <ConfirmGate> */
function ConfirmGateHost(): JSX.Element | null {
  const ctx = useContext(ConfirmGateContext);
  if (ctx === null || ctx.request === null) return null;
  const { request, cancel, _resolve } = ctx;
  return (
    <ConfirmGate
      open={true}
      title={request.title}
      items={request.items}
      assetWarning={request.assetWarning}
      ackLabel={request.ackLabel}
      onConfirm={async () => {
        // 业务回调成功 → 清空 request（ConfirmGate 随之关闭）；reject 由
        // ConfirmGate 内部捕获显示错误条，request 保持打开可重试
        await request.onConfirm();
        _resolve();
      }}
      onCancel={cancel}
    />
  );
}

export default function App(): JSX.Element {
  const [caps, setCaps] = useState<HubCapabilities | null>(null);

  // caps 未就绪：先过 HubLauncher（探测 / 引导 / 版本兼容门）——
  // 四层 Provider 都在验证通过后挂载，SSE / 确认门 / 死链 store 不接触未验证的 hub
  if (caps === null) {
    return <HubLauncher onReady={setCaps} />;
  }

  return (
    <HubContext.Provider value={{ client: hubClient, caps }}>
      <ConfirmGateProvider>
        <SseProvider>
          <DeadLinkProvider>
            <AppInner />
          </DeadLinkProvider>
        </SseProvider>
      </ConfirmGateProvider>
    </HubContext.Provider>
  );
}
