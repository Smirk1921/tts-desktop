/**
 * HubContext — UI-1b 全站 hub 状态下发 + UI-2 Stage C 确认门上下文
 *
 * 两块职责：
 *  1. hub 下发（UI-1b，施工方案 v0.8.0 §8.5-4）：App 在 HubLauncher 验证通过后，
 *     把 caps 与 client 单例经 HubContext.Provider 下发；路由组件（①代码 / ③卡牌 /
 *     ④素材…）经 useHub() 消费，依赖新路由的功能按 caps.canReadFiles /
 *     caps.canWriteFiles 禁用 + 提示。
 *  2. 确认门请求（Stage C）：ConfirmGateProvider 持 request 单槽 state，
 *     业务层经 useConfirmGate().ask(req) 打开全站唯一 ConfirmGate（实例在
 *     App.tsx 顶层 ConfirmGateHost），取消 / 完成由宿主经 cancel / _resolve 清槽。
 *
 * 说明：本文件为 .ts，ConfirmGateProvider 返回值用 createElement 构造（与 JSX 等价，
 * 同 ./useSseEvents.ts 的处理）。
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
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

// ---- Stage C：确认门请求上下文 ----

/** ConfirmGate 请求载荷（ask(req) 的 req） */
export interface ConfirmRequest {
  /** 对话框标题（红色方框标） */
  title: string;
  /** 影响清单 */
  items: { file: string; diff: string }[];
  /** 素材警告（可选；ConfirmGate 显示"去构建→"跳转占位） */
  assetWarning?: string;
  /** "我已知晓"勾选 label（可选，ConfirmGate 有缺省文案） */
  ackLabel?: string;
  /** 确认回调；可异步，ConfirmGate 等待 resolve 后才关闭，reject 则对话框内红条报错 */
  onConfirm(): Promise<void> | void;
}

/** ConfirmGate 上下文值（request 单槽：ask 新请求覆盖未完成的旧请求） */
export interface ConfirmGateContextValue {
  /** 当前请求（null = 不显示对话框） */
  request: ConfirmRequest | null;
  /** 打开确认门 */
  ask(req: ConfirmRequest): void;
  /** 用户取消（清空请求） */
  cancel(): void;
  /** 内部使用：完成回调后清空请求（ConfirmGateHost 的 onConfirm 成功路径调用） */
  _resolve(): void;
}

export const ConfirmGateContext = createContext<ConfirmGateContextValue | null>(
  null,
);

/** 在 App.tsx 内提供（HubContext.Provider 内、SseProvider 外），持 request state */
export function ConfirmGateProvider(props: {
  children: ReactNode;
}): JSX.Element {
  const { children } = props;

  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  // ask / cancel / _resolve 引用稳定：不影响消费方 memo 依赖
  const ask = useCallback((req: ConfirmRequest) => setRequest(req), []);
  const cancel = useCallback(() => setRequest(null), []);
  const _resolve = useCallback(() => setRequest(null), []);

  const value = useMemo<ConfirmGateContextValue>(
    () => ({ request, ask, cancel, _resolve }),
    [request, ask, cancel, _resolve],
  );

  return createElement(ConfirmGateContext.Provider, { value }, children);
}

/** 消费确认门；只暴露 ask（cancel / _resolve 是宿主内部协议，不给业务层） */
export function useConfirmGate(): { ask(req: ConfirmRequest): void } {
  const ctx = useContext(ConfirmGateContext);
  if (ctx === null) {
    throw new Error(
      "useConfirmGate() 必须在 <ConfirmGateProvider> 内使用（App.tsx 顶层挂载一次）",
    );
  }
  return useMemo(() => ({ ask: ctx.ask }), [ctx.ask]);
}
