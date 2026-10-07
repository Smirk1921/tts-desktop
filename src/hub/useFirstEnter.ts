/**
 * useFirstEnter — 首次进入钩子（round-03 §2.6 第三件套 / UI-4 Stage A 契约 §6）
 *
 * 语义：挂载后先返回 false（= 元素处于 pre 出场态），双 rAF 之后返回 true
 * （= pre 态被移除，transition 归位）。仅首次挂载触发一次，之后不再回退。
 *
 * 双 rAF 的理由：第一帧让浏览器完成带 pre 类的首帧布局/绘制（否则"挂载即翻态"
 * 会被合并进同一次样式计算，transition 不产生过渡帧）；第二帧再翻态，过渡必被观测。
 *
 * 用法（装配方：总览面）：
 *   const entered = useFirstEnter();
 *   <div className={entered ? "ov-enter-done" : "ov-enter"}>…</div>
 * 类名语义见 src/routes/Overview.css（.ov-enter = pre 态，.ov-enter-done = 移除 pre）。
 *
 * 无副作用：不做订阅、不请求 hub；prefers-reduced-motion 由 tokens.css 全局
 * transition:none 兜底（本 hook 照常翻态，元素直接落到终态）。
 */
import { useEffect, useState } from "react";

export function useFirstEnter(): boolean {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, []);

  return entered;
}

export default useFirstEnter;
