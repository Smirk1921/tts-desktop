/**
 * DeadLinkContext — UI-3 Stage C 全站死链 store（红线 4：③/④ LayerNav dot 数据源）
 *
 * 职责：跨面死链状态下发（React Context + useReducer）。④ 素材面批量体检后把
 *   死链 URL markBatch 写入本 store；③ 卡牌面只读 deadUrls（SliceGrid 死链标记
 *   + 死链卡禁切片）；App.tsx AppInner 读 deadUrls.size 驱动 ③/④ dot 双色
 *   （同源：一个集合两面同色，UI-4 再细分"cards 选中卡死链" vs "assets 总数"）。
 *
 * 关键设计：
 *  - 唯一实例挂 App.tsx 顶层：HubContext.Provider → ConfirmGateProvider →
 *    SseProvider → DeadLinkProvider → AppInner（SseProvider 之内、AppInner 之外；
 *    路由不自行挂 Provider，同红线 3 的单点纪律）；
 *  - 状态机在 ./deadLinkReducer（markBatch / add / remove / clear，恒不可变更新）；
 *  - markBatch / addDead / removeDead / clear 经 useCallback 稳定引用：消费方的
 *    useMemo/useEffect 依赖不会因子渲染新建函数而误触发（Stage B 曾以同签名的
 *    空 Set fallback 兜底消费，本文件落地后 fallback 已删除，接口形状不变）；
 *  - deadUrls 恒为 ReadonlySet：变更只能经 dispatch；
 *  - isDead(undefined) 恒 false：可选链数据（如 SliceCard.faceUrl 可缺省）直接
 *    传入不用先判空；
 *  - useDeadLinks 在 Provider 外使用即 throw（useHub / useConfirmGate 同款防御）。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type JSX,
  type ReactNode,
} from "react";
import { deadLinkReducer, initialDeadLinkState } from "./deadLinkReducer";

/** DeadLinkContext 消费值（Stage B 消费点已按此形状对齐：deadUrls + markBatch + clear） */
export interface DeadLinkContextValue {
  /** 全站死链 URL 集合（只读） */
  deadUrls: ReadonlySet<string>;
  /** 上次批量上报时间戳（ms） */
  lastMarkedAt: number | null;
  /** 批量上报（④ 素材面体检完成后调用；传本轮发现的全部死链 URL） */
  markBatch(urls: string[]): void;
  /** 单条标记死链 */
  addDead(url: string): void;
  /** 单条解除死链（如替换确认新 URL 可用后） */
  removeDead(url: string): void;
  /** 清空（重置体检 / 重连图包） */
  clear(): void;
  /** 便捷判断：url 在死链集合中（undefined 安全） */
  isDead(url: string | undefined): boolean;
}

const DeadLinkContext = createContext<DeadLinkContextValue | null>(null);

/** 全站唯一死链 Provider（App.tsx 顶层挂载一次） */
export function DeadLinkProvider(props: { children: ReactNode }): JSX.Element {
  const { children } = props;

  const [state, dispatch] = useReducer(deadLinkReducer, initialDeadLinkState);

  // 动作引用稳定（useCallback []）：消费方 memo / effect 依赖安全
  const markBatch = useCallback((urls: string[]): void => {
    dispatch({ type: "markBatch", urls });
  }, []);
  const addDead = useCallback((url: string): void => {
    dispatch({ type: "add", url });
  }, []);
  const removeDead = useCallback((url: string): void => {
    dispatch({ type: "remove", url });
  }, []);
  const clear = useCallback((): void => {
    dispatch({ type: "clear" });
  }, []);
  const isDead = useCallback(
    (url: string | undefined): boolean => url !== undefined && state.deadUrls.has(url),
    [state.deadUrls],
  );

  const value = useMemo<DeadLinkContextValue>(
    () => ({
      deadUrls: state.deadUrls,
      lastMarkedAt: state.lastMarkedAt,
      markBatch,
      addDead,
      removeDead,
      clear,
      isDead,
    }),
    [state.deadUrls, state.lastMarkedAt, markBatch, addDead, removeDead, clear, isDead],
  );

  return <DeadLinkContext.Provider value={value}>{children}</DeadLinkContext.Provider>;
}

/** 消费死链 store；必须在 <DeadLinkProvider> 内使用（App.tsx 顶层挂载一次） */
export function useDeadLinks(): DeadLinkContextValue {
  const v = useContext(DeadLinkContext);
  if (v === null) {
    throw new Error(
      "useDeadLinks() 必须在 <DeadLinkProvider> 内使用（App.tsx 顶层挂载一次）",
    );
  }
  return v;
}
