/**
 * <HubLauncher> hub 未启动引导 — UI-1b，施工方案 v0.8.0 §8.2 方案 C + §8.3
 *
 * 状态机：
 *   1. checking → Tauri invoke('check_hub') TCP 探测 39995（非 Tauri 环境<纯浏览器 dev>退化为
 *      直接 fetch /v1/status，1500ms）
 *   2. 端口通 → client.status() → capabilitiesFromStatus() →
 *      isSupported ? onReady(caps) : 「版本过旧」面板（<0.7.0 或无 version 字段）
 *   3. 端口不通 → 引导对话框：安装命令 + 启动命令（各带一键复制）+「我已启动，重试」
 *
 * 样式：tokens.css——var(--bp-d) 面板底 + var(--w) 边框 + var(--amber) 警示（§2.5）。
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HUB_BASE_URL } from "../hub/client";
import { hubClient } from "../hub/HubContext";
import { capabilitiesFromStatus } from "../hub/capabilities";
import type { HubCapabilities } from "../hub/capabilities";
import "./HubLauncher.css";

const HUB_PORT = 39995;
const PROBE_TIMEOUT_MS = 1500;
const INSTALL_CMD = "npm install -g @smirk1921/tts-toolkit";
const START_CMD = "tts-hub";

type Phase = "checking" | "guide" | "unsupported";

export interface HubLauncherProps {
  /** 验证通过（hub 在线且版本 >= 0.7.0）后回传能力表 */
  onReady: (caps: HubCapabilities) => void;
}

export default function HubLauncher({ onReady }: HubLauncherProps) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [detected, setDetected] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      if (!(await probePort())) {
        setPhase("guide");
        return;
      }
      const caps = capabilitiesFromStatus(await hubClient.status());
      if (!caps.isSupported) {
        setDetected(caps.version === "" ? "（无版本号，视为 0.7.0 之前）" : caps.version);
        setPhase("unsupported");
        return;
      }
      onReady(caps);
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

  return (
    <div className="hublauncher">
      <div
        className="hublauncher-panel"
        role={phase === "checking" ? "status" : "alertdialog"}
        aria-modal={phase === "checking" ? undefined : "true"}
        aria-label={
          phase === "guide"
            ? "未检测到 tts-hub"
            : phase === "unsupported"
              ? "hub 版本过旧"
              : "正在检测 tts-hub"
        }
      >
        {phase === "checking" && (
          <p className="hublauncher-note">
            正在检测 tts-hub（127.0.0.1:{HUB_PORT}）…
          </p>
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
