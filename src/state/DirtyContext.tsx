/**
 * DirtyContext — UI-4 Stage A3「状态引擎 + 脏通道」的脏通道半边
 *
 * 职责：全站「未提交改动」GUID 集合 store（React Context + useReducer，仿
 *   ./DeadLinkContext.tsx + ./deadLinkReducer.ts 范式）。①代码面在编辑器里改动 /
 *   保存后把对应对象 guid 上报进来，App.tsx 读 dirtyGuids.size 驱动 ① 代码面
 *   LayerNav 圆点（>0 = red「有未提交改动」），后续要更多消费方也只是读同一集合。
 *
 * 关键设计（与 DeadLinkContext 对齐的约定）：
 *  - 唯一实例挂 App.tsx 顶层（HubContext.Provider → ConfirmGateProvider → SseProvider
 *    → DeadLinkProvider → DirtyProvider → AppInner；路由不自行挂 Provider）；
 *  - 状态机在本文件内（dirtyReducer / DirtyState / DirtyAction 均导出），状态不可变：
 *    Set 只在变更时新建，未变更（重复 markDirty / markClean 不存在的 guid）返回原引用，
 *    消费方按引用即可判断「有没有变化」，也不会被空操作触发多余重渲染；
 *  - dirtyGuids 对外类型 ReadonlySet<string>：只读视图，变更只能经 reducer，
 *    杜绝旁路写；
 *  - markDirty / markClean / clearDirty 经 useCallback 稳定引用：消费方
 *    memo / effect 依赖安全；
 *  - 空字符串 guid 静默忽略（全局脚本/UI 的合法 guid 是 "-1"，不是 ""）；
 *  - useDirty 在 Provider 外使用即 throw（useHub / useConfirmGate / useDeadLinks 同款防御）。
 *
 * 说明：任务清单只允许写本文件，故 reducer 不像 deadLinkReducer 那样单列一个文件，
 * 但导出形状（reducer + 初始态 + State/Action 类型）与 DeadLinkContext 一致。
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

/** 脏文件 store 状态 */
export interface DirtyState {
  /** 已改动未提交的对象 GUID 集合（只读；变更经 reducer） */
  dirtyGuids: ReadonlySet<string>;
}

/** 脏文件 store 动作 */
export type DirtyAction =
  | { type: "dirty"; guid: string }
  | { type: "clean"; guid: string }
  | { type: "clear" };

/** 初始状态：无脏文件 */
export const initialDirtyState: DirtyState = {
  dirtyGuids: new Set<string>(),
};

/**
 * 脏文件 store reducer（纯函数）。
 * 未产生变化的动作返回原 state 引用（不新建 Set、不触发重渲染）。
 */
export function dirtyReducer(state: DirtyState, action: DirtyAction): DirtyState {
  switch (action.type) {
    case "dirty": {
      if (action.guid === "" || state.dirtyGuids.has(action.guid)) return state;
      const next = new Set(state.dirtyGuids);
      next.add(action.guid);
      return { dirtyGuids: next };
    }
    case "clean": {
      if (!state.dirtyGuids.has(action.guid)) return state;
      const next = new Set(state.dirtyGuids);
      next.delete(action.guid);
      return { dirtyGuids: next };
    }
    case "clear":
      return state.dirtyGuids.size === 0 ? state : { dirtyGuids: new Set<string>() };
  }
}

/** DirtyContext 消费值（契约 §2） */
export interface DirtyContextValue {
  /** 已改动未提交的对象 GUID 集合（只读） */
  dirtyGuids: ReadonlySet<string>;
  /** 上报某对象有未提交改动 */
  markDirty(guid: string): void;
  /** 上报某对象已回到干净状态（保存 / 写回 / 重新拉取后） */
  markClean(guid: string): void;
  /** 清空（重新拉取 / 切换图包） */
  clearDirty(): void;
}

const DirtyContext = createContext<DirtyContextValue | null>(null);

/** 全站唯一脏文件 Provider（App.tsx 顶层挂载一次） */
export function DirtyProvider(props: { children: ReactNode }): JSX.Element {
  const { children } = props;

  const [state, dispatch] = useReducer(dirtyReducer, initialDirtyState);

  // 动作引用稳定（useCallback []）：消费方 memo / effect 依赖安全
  const markDirty = useCallback((guid: string): void => {
    dispatch({ type: "dirty", guid });
  }, []);
  const markClean = useCallback((guid: string): void => {
    dispatch({ type: "clean", guid });
  }, []);
  const clearDirty = useCallback((): void => {
    dispatch({ type: "clear" });
  }, []);

  const value = useMemo<DirtyContextValue>(
    () => ({ dirtyGuids: state.dirtyGuids, markDirty, markClean, clearDirty }),
    [state.dirtyGuids, markDirty, markClean, clearDirty],
  );

  return <DirtyContext.Provider value={value}>{children}</DirtyContext.Provider>;
}

/** 消费脏文件 store；必须在 <DirtyProvider> 内使用（App.tsx 顶层挂载一次） */
export function useDirty(): DirtyContextValue {
  const v = useContext(DirtyContext);
  if (v === null) {
    throw new Error(
      "useDirty() 必须在 <DirtyProvider> 内使用（App.tsx 顶层挂载一次）",
    );
  }
  return v;
}
