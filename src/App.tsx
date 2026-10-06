/**
 * App.tsx — UI-1a 状态机
 *
 * 职责：
 *  - 持有 activeLayer（0..4），渲染 Frame + LayerNav + LegendBar + 当前路由 + SignBlock + ConfirmGate
 *  - 演示数据：图名 mypack / 版本 v1.3·main / SignBlock 占位 / ConfirmGate 演示
 *
 * UI-1b 在此接入：
 *  - 启动时调 /v1/status → 真实连接状态 → 替换 Frame 状态行 / LayerNav 圆点色
 *  - hubCapabilities → 决定 SignBlock 哪些工序可用、ConfirmGate 真实触发条件
 */
import { useState } from "react";
import Frame from "./components/Frame";
import LayerNav, { LayerItem } from "./components/LayerNav";
import LegendBar from "./components/LegendBar";
import SignBlock from "./components/SignBlock";
import ConfirmGate from "./components/ConfirmGate";

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
  const [activeLayer, setActiveLayer] = useState<LayerId>("overview");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const routeElement = (() => {
    switch (activeLayer) {
      case "overview": return <Overview />;
      case "code":     return <Code />;
      case "agent":    return <Agent />;
      case "cards":    return <Cards />;
      case "assets":   return <Assets />;
    }
  })();

  return (
    <>
      <Frame
        pack={PACK}
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
          // UI-1a：演示确认（不真实调 hub）；UI-1b 在此接 /v1/push confirm:true
          setConfirmOpen(false);
        }}
      />
    </>
  );
}

export default App;
