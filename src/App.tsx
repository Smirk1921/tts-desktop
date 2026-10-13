/**
 * App.tsx — UI-1b hub 门 + UI-2/3 Stage C 顶层接线 + UI-4 Stage B1 总览接线
 *
 * 职责：
 *  - caps === null → <HubLauncher>（探测 39995 / 引导启动 / 版本兼容门）；
 *    验证通过后按固定顺序挂五层 Provider：
 *      HubContext.Provider（client 单例 + caps）
 *        → ConfirmGateProvider（全站确认门 request 单槽）
 *          → SseProvider（App.tsx 顶层唯一 SSE 订阅，红线 3）
 *            → DeadLinkProvider（全站死链 store，UI-3 Stage C；③④ dot + 路由消费）
 *              → DirtyProvider（全站未提交改动 GUID 集合，UI-4 Stage A3；① dot + 代码面上报）
 *    → <AppInner> 渲染 Frame + LayerNav + LegendBar + 当前路由 + SignBlock
 *  - ConfirmGate 全站唯一实例在 <ConfirmGateHost>（本文件，红线 1）：从
 *    ConfirmGateContext 读 request 渲染；业务层一律经 useConfirmGate().ask(req)
 *    打开（红线 2），不再各自渲染 <ConfirmGate>
 *  - caps 就绪后轮询 /v1/status（30s）→ 真实 TTS 连接状态 → Frame 状态行
 *
 * UI-4 Stage B1 接线（本窗口）：
 *  - 图包元信息真实化：GET /v1/packs 首项 → 图名栏（Frame.pack）与 ⓪ 引擎 root 同一来源；
 *    失败保持 UI-1a 占位，注册表可读但无条目 → 「未注册图包 / —」（不谎报）
 *  - ⓪总览数据引擎 useOverviewData 在 AppInner **单点**调用：SIGN_CHECKS（会签栏交付清单）、
 *    LayerNav 圆点、onSign 待签数与 ⓪ 面工序章/待办/磁贴共用同一份 OverviewData（同源），
 *    <Overview> 受控接收 data/root。单点的理由：该 hook 有模块级结果缓存但**无在途去重**，
 *    App 与路由两处同时调用会在冷启动并发发两次 POST /v1/scripts/pull（覆盖工作区）
 *    + 两次 POST /v1/test/run（在真实游戏内跑测试）——processStamps.ts 文件头明确
 *    「并发交错风险不值当」，故全站只留一处调用。
 *  - LayerNav 圆点真实化：⓪ 总览 = 死链或差异 > 0；① 代码 = 未提交改动（DirtyContext）
 *    > 0 蓝，否则按差异红/青；② 代理按 SSE 连接态；③④ 卡牌/素材按死链集合同源双色
 *  - SignBlock.onSign = 真实会签出厂（ConfirmGate → POST /v1/push confirm:true）；
 *    onDetail = 切到 ① 代码面。SIGN_PROCS 仍是 UI-1a 占位（发布/同步未开放）
 *  - 已知缺口（留给 Stage C）：push 成功后 ⓪ 面五章/待签计数不会自动重算——Stage A 引擎
 *    只导出 clearStampCache()，没有 refetch 出口，且引擎挂在 AppInner（不随路由卸载），
 *    清缓存后不会重发请求；需要刷新窗口时给引擎加 refresh 触发（或 key 重挂载）。
 *
 * v9-3 Stage B1 接线（本窗口）：
 *  - 首次启动三态（B1 任务书）：isFirstRun() → null=检测中 loading（复用 wizard 面板底色，
 *    不闪屏）/ true=<FirstRunWizard> / false=原 caps===null ? HubLauncher : AppInner 流程。
 *    向导整体排在 HubLauncher **之前**（首启先引导再连 hub）。
 *  - handleWizardDone 四分支统一先 markFirstRunDone()（写 首次向导.flag，任务书契约）
 *    再 setFirstRun(false)：'example' → resolveResource(sample.ttsmod) + plugin-dialog
 *    目录选择器（open directory:true，默认 $DOCUMENT/tts-packs/sample）→ hubClient.importTtsmod
 *    （POST /v1/pack/import-ttsmod，hub-control.md §4.17）→ 完成提示条；
 *    'tutorial' → plugin-opener 打开 README 快速上手锚点；'existing'/'skip' 直接放行。
 *  - 已知时序缺口（v9-4 真机验收关注）：'example' 的导入 POST 不等 sidecar 就绪——
 *    内嵌 hub 启动期间（≤10s）会 NETWORK_ERROR，alert 报错后可回向导重按「开始」重试。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  basename as tauriBasename,
  dirname as tauriDirname,
  documentDir,
  join as tauriJoin,
  resolveResource,
} from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import Frame from "./components/Frame";
import LayerNav, { type LayerItem } from "./components/LayerNav";
import LegendBar from "./components/LegendBar";
import SignBlock, { type SignCheck } from "./components/SignBlock";
import ConfirmGate from "./components/ConfirmGate";
import HubLauncher from "./components/HubLauncher";
import FirstRunWizard from "./components/FirstRunWizard";
import type { FirstRunChoice } from "./components/FirstRunWizard";
import "./components/FirstRunWizard.css";

import {
  ConfirmGateContext,
  ConfirmGateProvider,
  HubContext,
  hubClient,
  useConfirmGate,
  useHub,
} from "./hub/HubContext";
import { isHubError } from "./hub/errors";
import { SseProvider, useSseEvents } from "./hub/useSseEvents";
import { DeadLinkProvider, useDeadLinks } from "./state/DeadLinkContext";
import { DirtyProvider, useDirty } from "./state/DirtyContext";
import {
  NO_PACK_NAME,
  NO_VERSION,
  useOverviewData,
  type LayerId,
  type OverviewData,
} from "./state/processStamps";
import { isFirstRun, markFirstRunDone } from "./lib/firstRun";
import type { HubCapabilities } from "./hub/capabilities";
import type { HubStatus } from "./hub/client";

import Overview from "./routes/Overview";
import Code from "./routes/Code";
import Agent from "./routes/Agent";
import Cards from "./routes/Cards";
import Assets from "./routes/Assets";

/** 图名栏 + ⓪ 引擎 root 的共同来源（GET /v1/packs 首项） */
interface PackInfo {
  /** 注册表条目 dir（hub 路由直接接受）；null = 无已注册图包 */
  root: string | null;
  name: string;
  version: string;
  branch: string;
}

/** 未注册图包（注册表可读但无条目）：与 ⓪ 引擎同一套「无则」值 */
const NO_PACK_INFO: PackInfo = {
  root: null,
  name: NO_PACK_NAME,
  version: NO_VERSION,
  branch: "main",
};

/** GET /v1/packs 失败 / 未返回前的占位（UI-1a 演示值：不闪空，失败也不谎报新值） */
const PACK_PLACEHOLDER: PackInfo = {
  root: null,
  name: "mypack",
  version: "v0.8.0",
  branch: "main",
};

const STATUS_POLL_MS = 30_000;

// ---- v9-3 Stage B1：首次向导接线常量 ----

/** 打包内示例图包（bundle.resources，plan 决策 2：独立 resources/examples/） */
const SAMPLE_TTSMOD_RESOURCE = "resources/examples/sample.ttsmod";
/** 教程锚点：tts-desktop README 5 分钟上手（施工方案 §6.2 任务 10 钦定链接） */
const TUTORIAL_URL = "https://github.com/Smirk1921/tts-desktop#快速上手";
/** 示例图包默认解开位置：文档目录下的 tts-packs/sample（B1 任务书钦定） */
const SAMPLE_DEFAULT_DIRNAME = "sample";
const SAMPLE_PACKS_PARENT = "tts-packs";

/** 出厂工序（SignBlock）：写回游戏已开放，发布/同步仍是未开放占位（UI-4 不动） */
const SIGN_PROCS = [
  { name: "写回游戏", state: "open" as const },
  { name: "发布 V2", state: "soon" as const, badge: "v0.9.0" },
  { name: "同步 V2", state: "soon" as const, badge: "v0.9.0" },
];

/** 路径末段（注册表条目无 name 时的诚实兜底，与 processStamps 同口径） */
function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter((s) => s !== "");
  const last = parts[parts.length - 1];
  return last !== undefined && last !== "" ? last : path;
}

/** POST /v1/pack/import-ttsmod 失败的提示正文（B1）：业务码带 hub 文案，网络层说明 hub 未就绪可重试 */
function buildImportErrorText(e: unknown): string {
  if (isHubError(e)) {
    if (e.code === "NETWORK_ERROR") {
      return `无法连接 hub：${e.message}。内嵌 hub 启动可能尚未完成，请稍候重试。`;
    }
    return `导入失败（${e.code}）：${e.message}`;
  }
  return `导入失败：${e instanceof Error ? e.message : String(e)}`;
}

/** GET /v1/packs 响应 → 首项图包元信息（无条目返回 null；缺字段按契约取「无则」值） */
function readFirstPackInfo(res: unknown): PackInfo | null {
  const packs = (res as { packs?: unknown }).packs;
  if (!Array.isArray(packs)) return null;
  for (const p of packs) {
    if (typeof p !== "object" || p === null) continue;
    const dir = (p as { dir?: unknown }).dir;
    if (typeof dir !== "string" || dir === "") continue;
    const name = (p as { name?: unknown }).name;
    // version / branch 目前不在 .registry.yaml 的 PackEntry schema 内（前向探测）：
    // 有则用，无则 "—" / "main"（branch 缺省 = main 与 a-deep 同）
    const version = (p as { version?: unknown }).version;
    const branch = (p as { branch?: unknown }).branch;
    return {
      root: dir,
      name: typeof name === "string" && name !== "" ? name : basename(dir),
      version: typeof version === "string" && version !== "" ? version : NO_VERSION,
      branch: typeof branch === "string" && branch !== "" ? branch : "main",
    };
  }
  return null;
}

/**
 * 会签栏交付清单（§4.4 / a-deep.html 636-640）：版本 → 校样 → 打样 → 出厂。
 * `next`（左缘 2.5px 红条 = 当前下一步）落在**出厂行**（a-deep 640 行
 * 「3 件待签 ←」），与 ⓪ 工序章同源：校样行取 proof 章 note、出厂行取 pendingSign
 * （= ship 章同一计数：>0 「N 件待签 ←」/ =0 「✓ 已会签」）。
 * 说明：不用 Stage A 的 deriveSignBlock——它把 next 放在「首个 bad 行」且出厂文案不带 ←；
 * 本窗口按 a-deep 逐字落地（值仍取自同一份 OverviewData，两处文案一致）。
 * 打样：POST /v1/pack/build 的产物状态无查询路由，恒「未打样」（Stage A 同结论）。
 */
function buildSignChecks(
  pack: PackInfo,
  uncommitted: number,
  data: OverviewData,
): SignCheck[] {
  const proof = data.stamps.find((s) => s.id === "proof");
  const versionKnown = pack.version !== NO_VERSION;
  const pendingSign = data.pendingSign;

  return [
    {
      k: "版本",
      v: `${versionKnown ? pack.version : "未标注"}${
        uncommitted > 0 ? ` · ${uncommitted} 未提交` : ""
      }`,
      // SignCheck.tone 只有 ok | bad：有未提交改动 / 版本未标注 → bad（红），余为 ok（青）
      tone: versionKnown && uncommitted === 0 ? "ok" : "bad",
    },
    {
      k: "校样",
      v: proof?.note ?? "—",
      tone: proof?.status === "done" ? "ok" : "bad",
    },
    { k: "打样", v: "未打样", tone: "bad" },
    {
      k: "出厂",
      v: pendingSign > 0 ? `${pendingSign} 件待签 ←` : "✓ 已会签",
      tone: pendingSign > 0 ? "bad" : "ok",
      next: pendingSign > 0,
    },
  ];
}

/** 会签栏 + 状态行 + 确认门宿主（须在 HubContext / ConfirmGateProvider / SseProvider / DeadLinkProvider / DirtyProvider 内） */
function AppInner(): JSX.Element {
  const { client } = useHub();
  const { state: sseState, events: sseEvents } = useSseEvents();
  // 全站死链 store（Stage C）：③④ dot 同源双色（UI-4 再细分 cards 选中卡 / assets 总数）
  const { deadUrls } = useDeadLinks();
  // 全站未提交改动集合（UI-4）：① 代码 dot + 会签栏版本行的未提交数
  const { dirtyGuids } = useDirty();
  // 确认门（红线 2）：会签出厂开全站唯一 <ConfirmGate>
  const { ask } = useConfirmGate();

  const [status, setStatus] = useState<HubStatus | null>(null);
  const [activeLayer, setActiveLayer] = useState<LayerId>("overview");
  const [pack, setPack] = useState<PackInfo>(PACK_PLACEHOLDER);

  // 图包元信息（GET /v1/packs 首项）：图名栏 + ⓪ 引擎 root 一次取，避免两处各查注册表；
  // 失败静默保持占位（hub 未验证时根本走不到这里，HubLauncher 已兜底）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await client.packs();
        if (cancelled) return;
        setPack(readFirstPackInfo(res) ?? NO_PACK_INFO);
      } catch {
        /* 静默：保持占位 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const root = pack.root;

  // ⓪ 总览状态引擎（单点，见文件头）：stamps / todos / diffCount / pendingSign / deadCount
  // 同时供会签栏、LayerNav 圆点与 ⓪ 面消费；root=null 时 hook 内部零请求（降级模式）
  const data = useOverviewData({ deadUrls, sseEvents, root });

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

  const deadCount = deadUrls.size;
  const dirtyCount = dirtyGuids.size;
  const { diffCount, pendingSign } = data;

  // LayerNav 圆点（红线 4，UI-4 真实化）：⓪ 死链或差异 / ① 未提交改动或差异 /
  // ② SSE 连接态 / ③④ 死链集合双色（同源——一个集合两面同色）
  const layers: LayerItem[] = [
    {
      id: "overview",
      num: "⓪",
      name: "总览",
      dot: deadCount > 0 || diffCount > 0 ? "red" : "ok",
      hint: `⓪ 总览 · 死链 ${deadCount} · 与游戏内不同 ${diffCount}`,
    },
    {
      id: "code",
      num: "①",
      name: "代码",
      dot: dirtyCount > 0 ? "blue" : diffCount > 0 ? "red" : "ok",
      hint: `① 代码 · 未提交 ${dirtyCount} · 与游戏内不同 ${diffCount}`,
    },
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

  // 会签栏交付清单（与 ⓪ 工序章同源；版本行带 DirtyContext 的未提交数）
  const signChecks = useMemo(
    () => buildSignChecks(pack, dirtyCount, data),
    [pack, dirtyCount, data],
  );

  // 会签出厂：危险操作走全站唯一确认门（红线 1/2），确认后 POST /v1/push（confirm:true）
  const handleSign = useCallback((): void => {
    // 无图包 / 无待签件：不写回（与 ①代码面「写回游戏」按钮的可用性口径一致）
    if (root === null || pendingSign === 0) return;
    ask({
      title: "会签出厂",
      items: [{ file: "写回游戏", diff: `${pendingSign} 件` }],
      assetWarning: deadCount > 0 ? `${deadCount} 个素材死链未修复` : undefined,
      onConfirm: async () => {
        await client.push(root, true);
      },
    });
  }, [ask, client, root, pendingSign, deadCount]);

  return (
    <>
      <Frame
        pack={pack}
        connected={connected}
        version={status?.tts.version}
        deadLinks={deadCount}
        pending={pendingSign}
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
            version={pack.version}
            checks={signChecks}
            procs={SIGN_PROCS}
            onSign={handleSign}
            onDetail={() => setActiveLayer("code")}
          />
        }
      >
        {activeLayer === "overview" && (
          <Overview
            data={data}
            root={root}
            onNavigate={(layer) => setActiveLayer(layer)}
          />
        )}
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

/**
 * 向导三子态面板（B1）：wizard = FirstRunWizard 原样；busy = 导入中状态条；
 * done / error = 导入结果提示条（error 方框标转红，文案预换行）。
 * 各子态都是独立面板（不嵌套），role 语义互斥、可查询。
 */
function FirstRunWizardPanel(): JSX.Element {
  const { wizardStatus, wizardNotice, finishWizard, setWizardStatus, handleWizardDone } =
    useWizardPanel();

  if (wizardStatus === "wizard") {
    return <FirstRunWizard onDone={(c) => void handleWizardDone(c)} />;
  }

  return (
    <div
      className="wizard-panel"
      role={wizardStatus === "busy" ? "status" : "alertdialog"}
      aria-modal={wizardStatus === "busy" ? undefined : "true"}
      aria-label={
        wizardStatus === "busy"
          ? "正在导入示例图包"
          : wizardStatus === "done"
            ? "示例图包已就绪"
            : "导入失败"
      }
    >
      <header className="wizard-head">
        <span
          className="wizard-marker"
          style={wizardStatus === "error" ? { background: "var(--red)" } : undefined}
          aria-hidden
        />
        <h1 className="wizard-title">
          {wizardStatus === "busy"
            ? "正在导入示例图包…"
            : wizardStatus === "done"
              ? "示例图包已就绪"
              : "导入失败"}
        </h1>
      </header>

      {wizardStatus === "busy" && (
        <p className="wizard-note">正在解开示例图包，请稍候…</p>
      )}
      {wizardStatus !== "busy" && (
        <p className="wizard-note" style={{ whiteSpace: "pre-line" }}>
          {wizardNotice}
        </p>
      )}

      {wizardStatus !== "busy" && (
        <footer className="wizard-act">
          <button type="button" className="wizard-btn" onClick={() => void finishWizard()}>
            {wizardStatus === "done" ? "进入工作台" : "仍要进入工作台"}
          </button>
          {wizardStatus === "error" && (
            <button
              type="button"
              className="wizard-btn wizard-btn--secondary"
              onClick={() => setWizardStatus("wizard")}
            >
              返回向导重试
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

/** FirstRunWizardPanel 的状态/回调来源（App 组件提供） */
interface WizardPanelContextValue {
  wizardStatus: "wizard" | "busy" | "done" | "error";
  wizardNotice: string;
  handleWizardDone: (choice: FirstRunChoice) => Promise<void>;
  finishWizard: () => Promise<void>;
  setWizardStatus: (s: "wizard" | "busy" | "done" | "error") => void;
}

const WizardPanelContext = createContext<WizardPanelContextValue | null>(null);

function useWizardPanel(): WizardPanelContextValue {
  const v = useContext(WizardPanelContext);
  if (v === null) {
    throw new Error("useWizardPanel() 必须在 <WizardPanelContext.Provider> 内使用");
  }
  return v;
}
export default function App(): JSX.Element {
  const [caps, setCaps] = useState<HubCapabilities | null>(null);
  // v9-3 Stage B1 首次启动三态：null=isFirstRun() 检测中（防闪屏 loading）、
  // true=首次启动（挂向导）、false=正常流程（caps === null ? HubLauncher : AppInner）
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  // 'example' 导入流程状态：wizard|busy=向导页（busy 禁回车重按）、done=完成提示条、error=失败提示
  const [wizardStatus, setWizardStatus] = useState<
    "wizard" | "busy" | "done" | "error"
  >("wizard");
  /** done/error 提示条正文 */
  const [wizardNotice, setWizardNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void isFirstRun().then((v) => {
      if (!cancelled) setFirstRun(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 向导四分支（B1 任务书）：'example' 出口走 finishWizard（先 markFirstRunDone()
   * 写 首次向导.flag，A2 契约，再 setFirstRun(false)）；'tutorial' / 'existing' /
   * 'skip' 就地同序完成。'example' 的标记延后到提示条按钮：导入失败可「返回向导重试」，
   * 此刻不算完成，不能提前写 flag。
   * 'example'（施工方案 §6.3）：resolveResource 拿打包内示例图包绝对路径 →
   * plugin-dialog 目录选择器（默认 $DOCUMENT/tts-packs/sample）→ hubClient.importTtsmod
   * （POST /v1/pack/import-ttsmod）导入 → 成功提示条（解开目录 / objectsImported /
   * warnings）→ finishWizard 进主界面。
   * inFlight 守卫：FirstRunWizard 的回车监听在 window 级（A2 骨架），长按 Enter /
   * 双击「开始」会重复触发 onDone——防重复弹目录选择器。
   */
  const finishWizard = useCallback(async (): Promise<void> => {
    try {
      await markFirstRunDone();
    } catch {
      /* flag 写失败也放行：否则可能困死在向导页；下次启动重出向导可接受 */
    }
    setFirstRun(false);
  }, []);

  const wizardInFlight = useRef(false);

  const handleWizardDone = useCallback(async (choice: FirstRunChoice) => {
    if (wizardInFlight.current) return;
    wizardInFlight.current = true;
    try {
      await runWizardChoice(choice);
    } finally {
      wizardInFlight.current = false;
    }
  }, []);

  const runWizardChoice = useCallback(async (choice: FirstRunChoice) => {
    if (choice === "example") {
      try {
        // 1. 打包内 sample.ttsmod → 绝对路径（resolveResource，B1 任务书钦定）
        const modFile = await resolveResource(SAMPLE_TTSMOD_RESOURCE);
        // 2. 选解开目录：plugin-dialog 目录选择器，默认 $DOCUMENT/tts-packs/sample（B1
        //    任务书钦定；defaultPath 指向不存在的 sample 时 dialog 落在其最近存在的父目录，
        //    用户可「新建文件夹」造出 sample——importTtsmod 落地时 mkdir recursive 兜底）。
        //    注：任务书说的"save-dialog"在 plugin-dialog 2.x 的 save() 上不存在 directory
        //    选项（SaveDialogOptions 仅 title/filters/defaultPath/canCreateDirectories），
        //    选目录的专用 API 是 open({directory:true})，故用之（同一插件）。
        const documents = await documentDir();
        const defaultTarget = await tauriJoin(
          documents,
          SAMPLE_PACKS_PARENT,
          SAMPLE_DEFAULT_DIRNAME,
        );
        const target = await open({
          title: "选择示例图包的解开目录",
          directory: true,
          multiple: false,
          defaultPath: defaultTarget,
        });
        if (target === null) {
          // 用户取消：不写 flag、不解包，留在向导页可重选（取消不是完成）
          return;
        }
        // 3. 拆 modsParentDir（选目录的父目录）与 modSaveLocation（选目录名）
        //    （/v1/pack/import-ttsmod 请求体契约，hub-control.md §4.17）
        const parent = await tauriDirname(target);
        const leaf = await tauriBasename(target);
        setWizardStatus("busy");
        // 4. 导入（绕过 firstRun 门直连 hub——此时 hub 可能还在启动，失败给出可重试提示）
        const res = await hubClient.importTtsmod(modFile, parent, leaf);
        setWizardNotice(
          res.warnings.length === 0
            ? `示例图包已解开到 ${target}（${res.objectsImported} 个文件），即将进入工作台。`
            : `示例图包已解开到 ${target}（${res.objectsImported} 个文件，${res.warnings.length} 条警告）：\n${res.warnings.join("\n")}`,
        );
        setWizardStatus("done");
      } catch (e) {
        setWizardNotice(buildImportErrorText(e));
        setWizardStatus("error");
      }
      return;
    }
    if (choice === "tutorial") {
      try {
        await markFirstRunDone();
        await openUrl(TUTORIAL_URL);
      } catch {
        /* 同 finishWizard：放行优先，标记/开浏览器失败不困死向导 */
      }
      setFirstRun(false);
      return;
    }
    // 'existing' / 'skip'：标记完成直接进正常流程
    try {
      await markFirstRunDone();
    } catch {
      /* 同 finishWizard：放行优先 */
    }
    setFirstRun(false);
  }, []);

  // 首次启动检测中：复用 wizard 全屏底色（var(--bp-dd)），不闪屏
  if (firstRun === null) {
    return (
      <div className="wizard">
        <div className="wizard-panel" role="status">
          <p className="wizard-note">正在启动…</p>
        </div>
      </div>
    );
  }

  // 首次启动：先过向导，再连 hub（HubLauncher）。三子态（FirstRunWizardPanel）：
  //  wizard = FirstRunWizard 原样渲染（A2 交付物，不嵌额外面板——避免双 dialog 重复 aria）
  //  busy   = 导入中：状态面板（role=status）
  //  done/error = 完成提示条 / 失败提示条（role=alertdialog；error 方框标转 --red）
  if (firstRun) {
    return (
      <div className="wizard">
        <WizardPanelContext.Provider
          value={{
            wizardStatus,
            wizardNotice,
            handleWizardDone,
            finishWizard,
            setWizardStatus,
          }}
        >
          <FirstRunWizardPanel />
        </WizardPanelContext.Provider>
      </div>
    );
  }

  // caps 未就绪：先过 HubLauncher（探测 / 引导 / 版本兼容门）——
  // 五层 Provider 都在验证通过后挂载，SSE / 确认门 / 死链 / 脏通道不接触未验证的 hub
  if (caps === null) {
    return <HubLauncher onReady={setCaps} />;
  }

  return (
    <HubContext.Provider value={{ client: hubClient, caps }}>
      <ConfirmGateProvider>
        <SseProvider>
          <DeadLinkProvider>
            <DirtyProvider>
              <AppInner />
            </DirtyProvider>
          </DeadLinkProvider>
        </SseProvider>
      </ConfirmGateProvider>
    </HubContext.Provider>
  );
}
