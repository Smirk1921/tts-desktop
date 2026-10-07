/**
 * deadLinkReducer — UI-3 Stage C 死链 store 的 useReducer（红线 4 数据源）
 *
 * 职责：维护全站死链 URL 集合（deadUrls）与上次批量上报时间戳（lastMarkedAt），
 *   为 DeadLinkContext（./DeadLinkContext.tsx）提供状态机。消费方：
 *   - ④ 素材面 routes/Assets.tsx：批量体检完成后 markBatch 上报本轮死链；
 *   - ③ 卡牌面 routes/Cards.tsx：只读 deadUrls（SliceGrid.deadLinkSet + 死链卡禁切片）；
 *   - App.tsx AppInner：③/④ LayerNav dot 同源双色（deadUrls 非空 = red）。
 *
 * 关键设计：
 *  - 恒返回新 State / 新 Set（不可变更新）：引用变化即"有上报"，消费方
 *    useMemo/useEffect 按引用判断即可，无需深比较；
 *  - deadUrls 对外类型 ReadonlySet<string>：只读视图，变更只能经 reducer，
 *    杜绝旁路写（setDeadUrls 直接 mutate 之类不存在）；
 *  - markBatch 语义 = "一轮体检完成，上报本轮发现的死链"：urls 为空（全部
 *    存活）也刷新 lastMarkedAt——上报动作本身发生了（时间戳语义 = 上次批量
 *    上报，非上次发现死链）；
 *  - clear 语义 = 全站清空（重置体检 / 重连图包），lastMarkedAt 一并归 null；
 *  - 纯函数：不读外部状态、不改入参（Date.now() 是唯一外部依赖，时间戳语义
 *    本就要求取调用时刻）。
 */

/** 死链 store 状态 */
export interface DeadLinkState {
  /** 全站死链 URL 集合（只读；变更经 reducer） */
  deadUrls: ReadonlySet<string>;
  /** 上次批量上报时间戳（ms） */
  lastMarkedAt: number | null;
}

/** 死链 store 动作：markBatch=体检批量上报 / add·remove=单条 / clear=清空 */
export type DeadLinkAction =
  | { type: "markBatch"; urls: string[] }
  | { type: "add"; url: string }
  | { type: "remove"; url: string }
  | { type: "clear" };

/** 初始状态：无死链、未上报 */
export const initialDeadLinkState: DeadLinkState = {
  deadUrls: new Set<string>(),
  lastMarkedAt: null,
};

/** 死链 store reducer（纯函数：恒返回新对象，不改入参） */
export function deadLinkReducer(state: DeadLinkState, action: DeadLinkAction): DeadLinkState {
  switch (action.type) {
    case "markBatch": {
      const next = new Set(state.deadUrls);
      for (const u of action.urls) next.add(u);
      return { deadUrls: next, lastMarkedAt: Date.now() };
    }
    case "add": {
      const next = new Set(state.deadUrls);
      next.add(action.url);
      return { deadUrls: next, lastMarkedAt: state.lastMarkedAt };
    }
    case "remove": {
      const next = new Set(state.deadUrls);
      next.delete(action.url);
      return { deadUrls: next, lastMarkedAt: state.lastMarkedAt };
    }
    case "clear":
      return { deadUrls: new Set<string>(), lastMarkedAt: null };
  }
}
