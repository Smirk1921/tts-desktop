/**
 * <LegendBar> 全局图例条 — round-03 §4.8
 * 职责：导航下方常驻，符号语义查询，全工作面共享。
 * 6 组：✗死链 / ⇄与游戏内不同 / M●已改未提交·进行中 / ✂切片中 / ⬆待上传·待会签 / ✓存活·已完成
 *
 * 红线：新增符号必须在此注册。
 */
import "./LegendBar.css";

export interface LegendItem {
  sym: string;
  /** 符号色（必须是 tokens 四功能色之一或 w） */
  color: "red" | "amber" | "blue" | "ok" | "w";
  text: string;
}

export interface LegendBarProps {
  items?: LegendItem[];
}

const DEFAULT_ITEMS: LegendItem[] = [
  { sym: "✗", color: "red",   text: "死链" },
  { sym: "⇄", color: "red",   text: "与游戏内不同" },
  { sym: "M●", color: "blue", text: "已改未提交 · 进行中" },
  { sym: "✂", color: "blue",  text: "切片中" },
  { sym: "⬆", color: "amber", text: "待上传 · 待会签" },
  { sym: "✓", color: "ok",    text: "存活 · 已完成" },
];

export default function LegendBar({ items = DEFAULT_ITEMS }: LegendBarProps) {
  return (
    <div className="legendbar" role="complementary" aria-label="全局图例">
      {items.map((item, i) => (
        <span key={i} className="legendbar-item">
          <span className={`legendbar-sym sym-${item.color}`}>{item.sym}</span>
          <span className="legendbar-text">{item.text}</span>
        </span>
      ))}
    </div>
  );
}
