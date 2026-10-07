/**
 * <LayerNav> 图层切换导航 — round-03 §4.2
 * 职责：5 个工作面切换，是当前位置指示。
 * 结构：圆圈序号 + 名称 + 状态圆点（7px，红=有问题 / 蓝=活动 / 青=正常）
 * 状态：.on = 白底蓝字反色
 *
 * UI-1b：圆点仍由外部经 items[].dot 传入（本组件不持状态）；真实状态色由 UI-2/3/4
 * 按各工作面数据计算后经 App 下发，本文件无需改动。
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
