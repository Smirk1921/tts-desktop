/**
 * hub 版本兼容策略 — UI-1b，施工方案 v0.8.0 §8.3（审批意见 §4）
 *
 * UI 启动查 GET /v1/status，按 hub.version 决定功能可用性：
 *  - < 0.7.0（含无 version 字段的旧版）：isSupported=false → 拒绝接入，HubLauncher 提示升级
 *  - 0.7.0：降级模式（基础面可用，卡面预览 / 工作台保存禁用）
 *  - >= 0.8.0：全功能（canReadFiles / canWriteFiles）
 * MINOR bump 向前兼容：旧 UI 连新 hub 正常；新 UI 必须能识别哪些路由可用。
 */
import type { HubStatus } from "./client";

export type HubAppMode = "standalone" | "app";

export type HubCapabilities = {
  version: string;
  appMode: HubAppMode;
  /** POST /v1/files/read（version >= 0.8.0） */
  canReadFiles: boolean;
  /** PUT /v1/files/write（version >= 0.8.0） */
  canWriteFiles: boolean;
  /** version >= 0.7.0（无 version 字段视为 0.7.0 之前，拒绝接入） */
  isSupported: boolean;
};

const MIN_SUPPORTED = "0.7.0";
const FILES_SINCE = "0.8.0";

/** 简易 semver 比较：按 "." 切前三段逐段数值比较；非数值段记 0。a<b → -1，a=b → 0，a>b → 1 */
export function compareSemver(a: string, b: string): number {
  const seg = (v: string): [number, number, number] => {
    const parts = v.split(".").map((s) => {
      const n = Number.parseInt(s, 10);
      return Number.isFinite(n) ? n : 0;
    });
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const pa = seg(a);
  const pb = seg(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** 由 /v1/status 响应推导能力表；响应缺 hub 字段（旧版）时全部降级 */
export function capabilitiesFromStatus(status: HubStatus): HubCapabilities {
  const hub = (status as { hub?: { version?: unknown; appMode?: unknown } })
    ?.hub;
  const version =
    typeof hub?.version === "string" ? hub.version : "";
  const appMode: HubAppMode = hub?.appMode === "app" ? "app" : "standalone";
  const supported = version !== "" && compareSemver(version, MIN_SUPPORTED) >= 0;
  const files = version !== "" && compareSemver(version, FILES_SINCE) >= 0;
  return {
    version,
    appMode,
    canReadFiles: files,
    canWriteFiles: files,
    isSupported: supported,
  };
}
