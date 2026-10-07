/**
 * HubContext — UI-1b 全站 hub 状态下发（施工方案 v0.8.0 §8.5-4）
 *
 * App 在 HubLauncher 验证通过后，把 caps 与 client 单例经 Provider 下发；
 * 路由组件（①代码 / ③卡牌 / ④素材…）经 useHub() 消费，
 * 依赖新路由的功能按 caps.canReadFiles / caps.canWriteFiles 禁用 + 提示。
 */
import { createContext, useContext } from "react";
import { HubClient } from "./client";
import type { HubCapabilities } from "./capabilities";

/** 全站 client 单例（HubLauncher 探测与各路由共用同一实例） */
export const hubClient = new HubClient();

export interface HubContextValue {
  client: HubClient;
  caps: HubCapabilities;
}

export const HubContext = createContext<HubContextValue | null>(null);

export function useHub(): HubContextValue {
  const v = useContext(HubContext);
  if (v === null) {
    throw new Error(
      "useHub() 必须在 <HubContext.Provider> 内使用（caps 未就绪时应渲染 HubLauncher）",
    );
  }
  return v;
}
