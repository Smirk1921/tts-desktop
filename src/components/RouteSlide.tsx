/**
 * <RouteSlide> — 工作面滑入包装（round-03 §2.6 第二件套：状态切换来路）
 *
 * 机制：挂载时根 div 带 .route-slide-pre（translateX(var(--dist-move)) + opacity 0），
 * 双 rAF 后移除该类 → .route-slide 上的 transition（--dur-move / --ease-out）驱动
 * transform + opacity 归位。用 transition 而非 keyframes 是为了让截图工具能抓到
 * 过渡帧（§2.6 明示）；样式表在 src/routes/routes.css（与其余路由壳样式同处）。
 *
 * 用法（五面路由根元素，替代原 <div className="route-slide">）：
 *   <RouteSlide>
 *     <div className="code-layout">…</div>
 *   </RouteSlide>
 *
 * 受控性：本组件不持有业务状态，唯一的内部状态是"是否已入场"的动效开关
 * （由 useFirstEnter 提供，挂载即启动，父组件无需干预）。
 * prefers-reduced-motion 由 tokens.css 全局兜底，本组件无需分支。
 */
import { type ReactNode, type JSX } from "react";
import { useFirstEnter } from "../hub/useFirstEnter";
import "../routes/routes.css";

export function RouteSlide(props: { children: ReactNode }): JSX.Element {
  const entered = useFirstEnter();

  return (
    <div className={entered ? "route-slide" : "route-slide route-slide-pre"}>
      {props.children}
    </div>
  );
}

export default RouteSlide;
