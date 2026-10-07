/**
 * ⓪ 总览面 — UI-4 Stage B1 路由组装（round-03 §3.1 三区骨架 + a-deep.html 368-425）
 *
 * 职责：把 Stage A 展示组件组装为完整总览面——
 *   左主区（.ov-main）：<ProcessStamps> 工序章 横贯顶部
 *                      + .ov-grid 双列：左列 <TodoList> / <MiniFileTree>，右列 <EventFlow>
 *   右栏（.ov-side，290px）：<LayerTiles> 四面状态磁贴
 * 动效（§2.6 三件套之二/之三）：
 *   - 工作面滑入：根元素由 <RouteSlide> 包装（替掉原 <div className="route-slide">）；
 *   - 首次进入阶梯：useFirstEnter() 翻转 .ov-enter → .ov-enter-done（delay 阶梯在
 *     ./Overview.css，pre 态只落在「工序章容器 + .ov-grid」两个块上，不落在容器本体，
 *     免与 RouteSlide 的 translateX 叠成两段位移）。
 *
 * 数据来源（受控）：OverviewData 由 AppInner 的 useOverviewData 单点派生后经 props 传入。
 *   本面不自己调 useOverviewData——该 hook 有模块级结果缓存但无在途去重，App 与路由同时
 *   调用会在冷启动并发发两次 pullScripts（覆盖工作区）+ 两次 testRun（在真实游戏内跑测试），
 *   详见 src/App.tsx 文件头「单点」说明。本面只读：SSE 事件流经 useSseEvents()（Context 订阅，
 *   无副作用），迷你文件树经 Stage A 的 deriveMiniTree(root)（与 ①代码面同一份差异缓存）。
 * 视图内跳转：待办行 / 四面磁贴 / 迷你文件树行 → onNavigate(layer)（App.tsx 的 setActiveLayer）。
 */
import type { ReactElement } from "react";

import ProcessStamps from "../components/ProcessStamps";
import TodoList from "../components/TodoList";
import MiniFileTree from "../components/MiniFileTree";
import LayerTiles from "../components/LayerTiles";
import EventFlow from "../components/EventFlow";
import { RouteSlide } from "../components/RouteSlide";

import { useSseEvents } from "../hub/useSseEvents";
import { useFirstEnter } from "../hub/useFirstEnter";
import { deriveMiniTree, type LayerId, type OverviewData } from "../state/processStamps";

import "./routes.css";
import "./Overview.css";

export interface OverviewProps {
  /** ⓪总览聚合数据（AppInner 的 useOverviewData 单点派生；本面纯渲染） */
  data: OverviewData;
  /** 已注册图包 root（迷你文件树数据源；null = 未注册图包，deriveMiniTree 给空态 note） */
  root: string | null;
  /** 块内跳转（待办行 / 四面磁贴 / 迷你文件树）→ 切换工作面 */
  onNavigate(layer: LayerId): void;
}

export default function Overview(props: OverviewProps): ReactElement {
  const { data, root, onNavigate } = props;

  // SSE 事件流（②代理面同一订阅：App.tsx 顶层 SseProvider，本面只消费）
  const { events, state, clear } = useSseEvents();
  // 首进阶梯开关：false = 出场态（.ov-enter），双 rAF 后 true（.ov-enter-done）
  const entered = useFirstEnter();
  // 迷你文件树：与 ①代码面同源（Stage A 差异缓存派生，组件不调 hub）
  const tree = deriveMiniTree(root);

  const ladder = entered ? "ov-enter-done" : "ov-enter";

  return (
    <RouteSlide>
      <div className="overview">
        <div className="ov-main">
          {/* 工序章：总览唯一主角，横贯顶部（容器只作阶梯动效钩子） */}
          <div className={`ov-stamps ${ladder}`}>
            <ProcessStamps steps={data.stamps} />
          </div>

          {/* 下部填实：左工作区（待办 + 文件树） / 右事件流 */}
          <div className={`ov-grid ${ladder}`}>
            <div className="ov-col">
              <div className="ov-blk">
                <TodoList todos={data.todos} onNavigate={onNavigate} />
              </div>
              <div className="ov-blk">
                <MiniFileTree
                  nodes={tree.nodes}
                  note={tree.note}
                  onNavigate={onNavigate}
                />
              </div>
            </div>
            <div className="ov-col">
              {/* .ov-ev 只补块框与剩余高度：.eventflow 自带头部（标题 + ● 存活点 + 清空）
                  与内部滚动，不另造第二套外壳 */}
              <div className="ov-blk ov-ev">
                <EventFlow
                  events={events}
                  live={state === "open"}
                  onClear={clear}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 右栏：四面状态磁贴（290px 定宽，虚线分栏） */}
        <aside className="ov-side">
          <LayerTiles data={data} onNavigate={onNavigate} />
        </aside>
      </div>
    </RouteSlide>
  );
}
