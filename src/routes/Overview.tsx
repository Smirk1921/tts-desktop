/**
 * ⓪ 总览面 — 占位（UI-4 填充：工序章 + 待办 + 迷你文件树 + 四面状态磁贴）
 */
import "./routes.css";

export default function Overview() {
  return (
    <div className="route-slide">
      <div className="route-stub">
        <div className="route-stub-num">⓪</div>
        <div className="route-stub-name">总览</div>
        <div className="route-stub-note">本面内容于 UI-4 窗口填充（工序章 / 待办 / 迷你文件树）</div>
      </div>
    </div>
  );
}
