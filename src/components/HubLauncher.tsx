/**
 * <HubLauncher> hub 启动引导 / sidecar 状态机 — v9-2 窗口任务 B2（施工方案 v0.9.0 §2.2）
 * 基线：UI-1b（施工方案 v0.8.0 §8.2 方案 C + §8.3）+ UI-4 Stage B2（WebView2 红条）。
 *
 * 六态状态机（v9-2 决策 3）：
 *   1. checking → Tauri invoke('check_hub') TCP 探测 39995 + invoke('is_webview2_present')
 *      （非 Tauri 环境<纯浏览器 dev>退化为直接 fetch /v1/status）
 *   2. 端口通（外置 hub）→ client.status() → 版本判定：
 *        >= 0.9.0        → onReady(caps)          [复用外置 hub]
 *        0.7.0 ~ 0.8.x   → external-outdated      [低于 desktop 要求，用户二选一]
 *        < 0.7.0 / 无版本 → unsupported            [拒绝接入]
 *   3. 端口不通 → sidecar-starting：Rust 侧正在 spawn 内嵌 sidecar（setup 钩子），
 *      前端并发轮询 invoke('sidecar_get_status') + fetch /v1/status（500ms × 最多 10s）；
 *      /v1/status 通 → onReady（审批意见 §12：sidecar 与 desktop 绑定必然兼容，跳过版本检查）
 *   4. 轮询超时 → sidecar-failed：「重试 sidecar」/「降级到手动引导」
 *      （guide 本会话粘性：降级后重试不再进 sidecar-starting）
 *   5. external-outdated：「我已关闭外置，重试」（重走完整检测）/「降级继续」
 *      （onReady(caps)：0.7.0+ 能进主界面，部分功能由 capabilities.ts 禁用）
 *
 * UI-4 Stage B2：WebView2 运行时缺失时，面板顶部红条 +「下载 WebView2」按钮
 * （tauri-plugin-opener 打开微软官方引导链接）——除 checking 外所有 phase 均可叠加。
 * 命令不可用（旧壳 / 纯浏览器）时不报警，避免误报。
 *
 * 样式：tokens.css——var(--bp-d) 面板底 + var(--w) 边框 + var(--amber) 警示（§2.5）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { HUB_BASE_URL } from "../hub/client";
import type { HubStatus } from "../hub/client";
import { hubClient } from "../hub/HubContext";
import { capabilitiesFromStatus, compareSemver } from "../hub/capabilities";
import type { HubCapabilities } from "../hub/capabilities";
import "./HubLauncher.css";

const HUB_PORT = 39995;
const PROBE_TIMEOUT_MS = 1500;
const INSTALL_CMD = "npm install -g @smirk1921/tts-toolkit";
const START_CMD = "tts-hub";
/** 微软官方 WebView2 Runtime 引导安装链接（Evergreen Bootstrapper） */
const WEBVIEW2_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/** 外置 hub 可复用最低版本（对齐 Rust 侧 sidecar.rs 的 MIN_HUB_VERSION，v9-2 契约） */
const EXTERNAL_MIN_VERSION = "0.9.0";
/** sidecar 就绪轮询间隔（ms） */
const SIDECAR_POLL_INTERVAL_MS = 500;
/** sidecar 启动等待上限（ms，超时转 sidecar-failed） */
const SIDECAR_WAIT_MS = 10_000;
/** 轮询内 /v1/status 快速探测超时（ms）：小于轮询间隔，避免 tick 堆积 */
const SIDECAR_STATUS_TIMEOUT_MS = 450;

type Phase =
  | "checking" // 初始：TCP 探测 39995 + WebView2 检测
  | "sidecar-starting" // 端口未占用，Rust 正在 spawn sidecar（前端轮询等 39995 LISTENING）
  | "sidecar-failed" // sidecar 启动失败（重试后仍超时），给「降级到手动引导」选项
  | "external-outdated" // 外置 hub 版本过旧（0.7.0 ~ 0.8.x），给「关闭外置重试 / 降级继续」两选项
  | "guide" // 手动引导（原 phase，仅在 sidecar-failed 降级后到达）
  | "unsupported"; // 外置 hub 版本 < 0.7.0（原 phase，拒绝接入）

/** 面板 aria-label（按 phase） */
const PANEL_LABEL: Record<Phase, string> = {
  checking: "正在检测 tts-hub",
  "sidecar-starting": "正在启动内嵌 hub",
  "sidecar-failed": "内嵌 hub 启动失败",
  "external-outdated": "外置 hub 版本过旧",
  guide: "未检测到 tts-hub",
  unsupported: "hub 版本过旧",
};

/** sidecar_get_status 返回形（Rust sidecar.rs HubStatus 序列化）。
 *  version / is_embedded 为 Rust 简化版占位：真实版本以并发 fetch /v1/status 为准（任务 B2） */
interface SidecarStatus {
  running: boolean;
  version: string | null;
  is_embedded: boolean;
}

export interface HubLauncherProps {
  /** 验证通过（sidecar 就绪 / 外置 hub 版本达标 / 用户选择降级）后回传能力表 */
  onReady: (caps: HubCapabilities) => void;
}

export default function HubLauncher({ onReady }: HubLauncherProps) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [detected, setDetected] = useState("");
  const [busy, setBusy] = useState(false);
  /** WebView2 运行时缺失（UI-4 Stage B2）；仅在权威判定为 false 时置位 */
  const [wv2Missing, setWv2Missing] = useState(false);
  /** sidecar-starting 已等待秒数（面板文案用） */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  /** external-outdated 暂存的已检测能力表（「降级继续」时回传 onReady） */
  const [outdatedCaps, setOutdatedCaps] = useState<HubCapabilities | null>(null);
  /** 用户已在 sidecar-failed 降级为手动模式：本会话内端口不通直接回 guide，不再等 sidecar */
  const downgradedRef = useRef(false);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      // 端口探测与 WebView2 检测同轮发起；后者失败按「不可知」处理，不误报
      // v9-4 hotfix：并发调 probeSidecar 拿 is_embedded——sidecar 自起的 hub
      // 绑定本 desktop 必然兼容（审批意见 §12），跳过版本检查直接 onReady；
      // 否则按外置 hub 走 EXTERNAL_MIN_VERSION 检查。
      const [hubUp, wv2Present, sidecar] = await Promise.all([
        probePort(),
        probeWebview2(),
        probeSidecar(),
      ]);
      setWv2Missing(!wv2Present);
      if (!hubUp) {
        // 端口不通：Tauri 下 Rust 正在 spawn 内嵌 sidecar → 轮询等待；
        // 纯浏览器 dev（无 Rust 可依赖）或已降级手动模式 → 直接手动引导
        setPhase(isTauri() && !downgradedRef.current ? "sidecar-starting" : "guide");
        return;
      }
      const caps = capabilitiesFromStatus(await hubClient.status());
      // sidecar 自起场景：跳过版本检查（v9-4 hotfix，审批意见 §12 原意；
      // v9-3 漏读 is_embedded 导致 0.8.0 sidecar 被外置检查拦截）
      if (sidecar?.is_embedded === true) {
        onReady(caps);
        return;
      }
      if (compareSemver(caps.version, EXTERNAL_MIN_VERSION) >= 0) {
        onReady(caps);
        return;
      }
      if (caps.isSupported) {
        // 0.7.0 ~ 0.8.x：能进主界面但低于 tts-desktop 要求 → 让用户二选一
        setDetected(caps.version);
        setOutdatedCaps(caps);
        setPhase("external-outdated");
        return;
      }
      setDetected(caps.version === "" ? "（无版本号，视为 0.7.0 之前）" : caps.version);
      setPhase("unsupported");
    } catch {
      // 端口通但 /v1/status 失败：等同不可用，回到引导
      setPhase("guide");
    } finally {
      setBusy(false);
    }
  }, [onReady]);

  useEffect(() => {
    void check();
  }, [check]);

  // sidecar-starting：并发轮询 invoke('sidecar_get_status') + fetch /v1/status，
  // /v1/status 通（蕴含 39995 TCP 已 LISTEN）即就绪；10s 超时转 sidecar-failed
  useEffect(() => {
    if (phase !== "sidecar-starting") return;

    const startedAt = Date.now();
    let settled = false;
    let pollId = 0;
    let elapsedId = 0;
    let timeoutId = 0;

    const stopTimers = (): void => {
      window.clearInterval(pollId);
      window.clearInterval(elapsedId);
      window.clearTimeout(timeoutId);
    };

    setElapsedSeconds(0);

    // 一轮并发探测：invoke('sidecar_get_status')（Rust 简化版占位，按任务 B2 契约并发触发）
    // + fetch /v1/status（就绪权威信号，非 null 即蕴含 39995 已 LISTENING）
    const tick = async (): Promise<void> => {
      const [, status] = await Promise.all([probeSidecar(), fetchStatusQuick()]);
      if (settled) return;
      if (status !== null) {
        settled = true;
        stopTimers();
        // 审批意见 §12：sidecar 内嵌 hub 与 desktop 绑定必然兼容——跳过版本检查直接就绪
        onReady(capabilitiesFromStatus(status));
      }
    };

    void tick();
    pollId = window.setInterval(() => void tick(), SIDECAR_POLL_INTERVAL_MS);
    elapsedId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      stopTimers();
      setPhase("sidecar-failed");
    }, SIDECAR_WAIT_MS);

    return () => {
      settled = true;
      stopTimers();
    };
  }, [phase, onReady]);

  /** 「重试 sidecar」：回到 sidecar-starting 重新轮询（Rust 侧 spawn 仍在途则就绪，已死则再次超时） */
  const retrySidecar = useCallback(() => {
    setPhase("sidecar-starting");
  }, []);

  /** 「手动引导」：sidecar-failed 降级（粘性，本会话不再自动等 sidecar） */
  const downgradeToManual = useCallback(() => {
    downgradedRef.current = true;
    setPhase("guide");
  }, []);

  /** 「我已关闭外置，重试」：重走完整检测（端口通 → 版本判定；端口不通 → sidecar-starting） */
  const retryAfterClose = useCallback(() => {
    void check();
  }, [check]);

  /** 「降级继续」：外置 hub 0.7.0+ 回传 caps 进主界面（部分功能由 capabilities.ts 禁用） */
  const continueDegraded = useCallback(() => {
    if (outdatedCaps !== null) onReady(outdatedCaps);
  }, [outdatedCaps, onReady]);

  return (
    <div className="hublauncher">
      <div
        className="hublauncher-panel"
        role={phase === "checking" ? "status" : "alertdialog"}
        aria-modal={phase === "checking" ? undefined : "true"}
        aria-label={PANEL_LABEL[phase]}
      >
        {/* WebView2 红条：除 checking 外所有 phase 均可叠加（UI-4 Stage B2） */}
        {phase !== "checking" && wv2Missing && (
          <div className="hublauncher-wv2" role="alert">
            <span className="hublauncher-wv2-mark" aria-hidden>
              ⚠
            </span>
            <p className="hublauncher-wv2-text">
              缺少 WebView2 运行时：本应用界面可能无法渲染。请先安装并重启应用。
            </p>
            <button
              type="button"
              className="hublauncher-btn hublauncher-btn--sm"
              onClick={() => void openWebview2Download()}
            >
              下载 WebView2
            </button>
          </div>
        )}

        {phase === "checking" && (
          <p className="hublauncher-note">
            正在检测 tts-hub（127.0.0.1:{HUB_PORT}）…
          </p>
        )}

        {phase === "sidecar-starting" && (
          <>
            <p className="hublauncher-note">正在启动内嵌 hub（{elapsedSeconds}s）…</p>
            <div
              className="hublauncher-progress"
              role="progressbar"
              aria-label="正在启动 hub"
            />
          </>
        )}

        {phase === "sidecar-failed" && (
          <>
            <header className="hublauncher-head">
              <span className="hublauncher-marker" aria-hidden />
              <h1 className="hublauncher-title">内嵌 hub 启动失败</h1>
            </header>
            <p className="hublauncher-note">
              内嵌 hub 未能启动。可重试，或降级为手动启动外置 hub。
            </p>
            <footer className="hublauncher-act">
              <button type="button" className="hublauncher-btn" onClick={retrySidecar}>
                重试 sidecar
              </button>
              <button
                type="button"
                className="hublauncher-btn hublauncher-btn--secondary"
                onClick={downgradeToManual}
              >
                手动引导
              </button>
            </footer>
          </>
        )}

        {phase === "external-outdated" && (
          <>
            <header className="hublauncher-head">
              <span className="hublauncher-marker" aria-hidden />
              <h1 className="hublauncher-title">外置 hub 版本过旧</h1>
            </header>
            <p className="hublauncher-note">
              检测到外置 hub {detected}，但 tts-desktop v0.2.0 需要 hub &gt;= 0.9.0。
            </p>
            <p className="hublauncher-note hublauncher-note--dim">
              选项 A：关闭外置 hub 后重试（推荐）
              <br />
              选项 B：降级继续（部分功能禁用）
            </p>
            <footer className="hublauncher-act">
              <button
                type="button"
                className="hublauncher-btn"
                disabled={busy}
                onClick={retryAfterClose}
              >
                我已关闭外置，重试
              </button>
              <button
                type="button"
                className="hublauncher-btn hublauncher-btn--secondary"
                onClick={continueDegraded}
              >
                降级继续
              </button>
            </footer>
          </>
        )}

        {phase === "guide" && (
          <>
            <header className="hublauncher-head">
              <span className="hublauncher-marker" aria-hidden />
              <h1 className="hublauncher-title">未检测到 tts-hub</h1>
            </header>
            <p className="hublauncher-note">
              桌面应用经 hub（{HUB_BASE_URL.replace(/^http:\/\//, "")}）与
              Tabletop Simulator 通信。请在终端先启动：
            </p>
            <CopyRow label="1. 安装（首次）" cmd={INSTALL_CMD} />
            <CopyRow label="2. 启动 hub" cmd={START_CMD} />
            <p className="hublauncher-note hublauncher-note--dim">
              保持该终端窗口开启，回到本应用点击重试。
            </p>
            <footer className="hublauncher-act">
              <button
                type="button"
                className="hublauncher-btn"
                disabled={busy}
                onClick={() => void check()}
              >
                {busy ? "检测中…" : "我已启动，重试"}
              </button>
            </footer>
          </>
        )}

        {phase === "unsupported" && (
          <>
            <p className="hublauncher-warn">⚠ hub 版本过旧</p>
            <p className="hublauncher-note">
              检测到 tts-hub {detected}；本应用需要 0.7.0+（卡面预览 / 工作台保存需
              0.8.0+）。请升级后重试：
            </p>
            <CopyRow label="升级命令" cmd={INSTALL_CMD} />
            <footer className="hublauncher-act">
              <button
                type="button"
                className="hublauncher-btn"
                disabled={busy}
                onClick={() => void check()}
              >
                {busy ? "检测中…" : "我已升级，重试"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/** Tauri 内走 Rust TCP 探测（check_hub）；纯浏览器 dev 退化为 fetch /v1/status */
async function probePort(): Promise<boolean> {
  try {
    return await invoke<boolean>("check_hub", {
      port: HUB_PORT,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  } catch {
    return probeHttp();
  }
}

/**
 * WebView2 运行时探测（UI-4 Stage B2）：Rust 侧 is_webview2_present（查注册表）。
 * 非 Tauri 环境（纯浏览器 dev）与命令缺失（旧壳 / 调用异常）一律按 true 返回——
 * 只有拿到权威的 false 才提示，避免误报。
 */
async function probeWebview2(): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    return await invoke<boolean>("is_webview2_present");
  } catch {
    return true;
  }
}

/**
 * sidecar 运行状态探测：invoke('sidecar_get_status')（Rust sidecar.rs HubStatus）。
 * 非 Tauri 环境 / 命令未注册（invoke 拒绝）时返回 null——不致命，
 * 就绪判定以并发 fetch /v1/status 为权威信号（任务 B2 契约）。
 */
async function probeSidecar(): Promise<SidecarStatus | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<SidecarStatus>("sidecar_get_status");
  } catch {
    return null;
  }
}

/**
 * 短超时 GET /v1/status（sidecar 就绪轮询专用）：成功返回状态对象，
 * 失败（连接拒 / 超时 / 非 2xx / 非法 JSON）返回 null。TCP 可连是它的前提，
 * 故「拿到非 null」即蕴含 39995 已 LISTENING。
 */
async function fetchStatusQuick(): Promise<HubStatus | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SIDECAR_STATUS_TIMEOUT_MS);
  try {
    const res = await fetch(`${HUB_BASE_URL}/v1/status`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as HubStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 打开微软官方 WebView2 引导安装链接；非 Tauri 环境退化为新标签页 */
async function openWebview2Download(): Promise<void> {
  try {
    await openUrl(WEBVIEW2_URL);
  } catch {
    window.open(WEBVIEW2_URL, "_blank", "noopener,noreferrer");
  }
}

async function probeHttp(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${HUB_BASE_URL}/v1/status`, {
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 命令行 + 一键复制（仿宋标注 + 等宽命令） */
function CopyRow({ label, cmd }: { label: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默：命令文本仍可见 */
    }
  };
  return (
    <div className="hublauncher-step">
      <div className="hublauncher-step-note">{label}</div>
      <div className="hublauncher-cmd">
        <code className="hublauncher-cmd-text">{cmd}</code>
        <button type="button" className="hublauncher-cmd-copy" onClick={copy}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
    </div>
  );
}
