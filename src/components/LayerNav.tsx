/**
 * <LayerNav> 图层切换导航 — round-03 §4.2
 * 职责：5 个工作面切换，是当前位置指示。
 * 结构：圆圈序号 + 名称 + 状态圆点（7px，红=有问题 / 蓝=活动 / 青=正常）
 * 状态：.on = 白底蓝字反色
 *
 * UI-1a：状态圆点色为演示硬编码（五面 demo 各取一色），UI-1b 改为按 hubCapabilities 真实计算。
 */
import "./LayerNav.css";

export type LayerDot = "ok" | "blue" | "red" | "amber" | "none";

export interface LayerItem {
  id: string;
  /** 圆圈序号字符：⓪ ① ② ③ ④ ⑤ ... */
  num: string;
  name: string;
  /** 状态圆点色 */
  dot: LayerDot;
  /** hover 提示 */
  hint?: string;
}

export interface LayerNavProps {
  items: LayerItem[];
  active: string;
  onSelect: (id: string) => void;
}

export default function LayerNav({ items, active, onSelect }: LayerNavProps) {
  return (
    <nav className="layernav" aria-label="图层切换">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`layernav-item ${item.id === active ? "on" : ""}`}
          title={item.hint ?? item.name}
          onClick={() => onSelect(item.id)}
        >
          <span className="layernav-num">{item.num}</span>
          <span className="layernav-name">{item.name}</span>
          {item.dot !== "none" && (
            <span className={`layernav-dot dot-${item.dot}`} aria-hidden />
          )}
        </button>
      ))}
    </nav>
  );
}
