/**
 * <SignBlock> 会签栏 — round-03 §4.4（核心品牌组件）
 * 职责：右下常驻，交付流程 + 出厂工序 + 危险操作入口。
 * 结构三段：
 *   .rows  交付清单：版本 / 校样 / 打样 / 出厂 各行 .v(ok|bad)，当前下一步行 .next（左侧 2.5px 红条）
 *   .proc  出厂工序：写回游戏 → 发布 V2 → 同步 V2（未开放项 .soon 虚线徽标置灰）
 *   .act   操作：明细 (chk) + 会签出厂 (sg，--red 实心 flex:1.7)
 *
 * UI-1a：数据为演示占位，点击"会签出厂"由 App 弹出 ConfirmGate 演示。
 */
import "./SignBlock.css";

export interface SignCheck {
  k: string;         // 版本 / 校样 / 打样 / 出厂
  v: string;         // 行内说明（如"v1.3 · 已生成"）
  tone: "ok" | "bad"; // .v 行色
  /** 当前下一步（仅一行）：左侧 2.5px 红条 */
  next?: boolean;
}

export interface SignProc {
  name: string;
  /** soon = 未开放（虚线徽标置灰） */
  state: "open" | "soon";
  badge?: string;
}

export interface SignBlockProps {
  version: string;
  checks: SignCheck[];
  procs: SignProc[];
  onSign: () => void;
  onDetail?: () => void;
}

export default function SignBlock(props: SignBlockProps) {
  const { version, checks, procs, onSign, onDetail } = props;

  return (
    <aside className="signblock" aria-label="会签栏">
      {/* 头部 */}
      <header className="signblock-head">
        <span className="signblock-title">会签栏</span>
        <span className="signblock-ver tnum">{version}</span>
      </header>

      {/* 交付清单 */}
      <section className="signblock-rows">
        {checks.map((c, i) => (
          <div
            key={i}
            className={`signblock-row ${c.next ? "next" : ""}`}
          >
            <span className="signblock-k">{c.k}</span>
            <span className={`signblock-v v-${c.tone}`}>{c.v}</span>
          </div>
        ))}
      </section>

      {/* 出厂工序 */}
      <section className="signblock-procs">
        <div className="signblock-procs-title">出厂工序</div>
        {procs.map((p, i) => (
          <div key={i} className={`signblock-proc ${p.state === "soon" ? "soon" : ""}`}>
            <span className="signblock-proc-name">{p.name}</span>
            {p.state === "soon" && <span className="signblock-soon">未开放</span>}
            {p.badge && <span className="signblock-proc-badge">{p.badge}</span>}
          </div>
        ))}
      </section>

      {/* 操作 */}
      <footer className="signblock-act">
        <button type="button" className="signblock-btn chk" onClick={onDetail}>
          明细
        </button>
        <button type="button" className="signblock-btn sg" onClick={onSign}>
          会签出厂
        </button>
      </footer>
    </aside>
  );
}
