/**
 * <CardBackPreview> Cards 面·对象区（下·卡背预览） — Stage A1（UI-3）
 * 职责：显示当前选中牌堆的卡背缩略图。
 * 纯受控展示：base64 数据由父组件经 /v1/files/read 取得后传入，
 * 本组件不调 hubClient、不经 useJobTracker（取数 Job 归父组件登记）。
 * 状态（任务书指定，优先级从上到下）：
 *   deck===undefined → "— 选择牌堆" / loading → "◌ 加载卡背…"
 *   error → "✗ {error}"（红，§2.5 错误色） / 正常 → <img> 等比缩放。
 * 注："—"（占位）与 "◌"（加载中）为任务书指定显示符，尚未注册进 LegendBar，
 *     沿用现有 "✗"（已注册）；如需入图例由主窗口统一登记。
 */
import type { ReactElement } from "react";
import type { DeckEntry } from "./DeckList";
import "./CardBackPreview.css";

export interface CardBackPreviewProps {
  /** 当前选中牌堆；undefined = 未选中 */
  deck?: DeckEntry;
  /** 已解码的 base64（由父组件经 /v1/files/read 拿到） */
  imageBase64?: string;
  /** 配合 imageBase64 的图片 MIME（缺省按 image/png） */
  mime?: string;
  /** 卡背加载中 */
  loading?: boolean;
  /** 加载失败信息 */
  error?: string;
}

export default function CardBackPreview(props: CardBackPreviewProps): ReactElement {
  const { deck, imageBase64, mime, loading, error } = props;

  let body: ReactElement;
  if (deck === undefined) {
    body = <div className="cardback-hint">— 选择牌堆</div>;
  } else if (loading) {
    body = <div className="cardback-hint">◌ 加载卡背…</div>;
  } else if (error !== undefined && error !== "") {
    body = <div className="cardback-error">✗ {error}</div>;
  } else if (imageBase64 !== undefined && imageBase64 !== "") {
    body = (
      <img
        className="cardback-img"
        src={`data:${mime ?? "image/png"};base64,${imageBase64}`}
        alt={`卡背 · ${deck.name}`}
      />
    );
  } else {
    // 防御态：已选中但父组件尚未给数据（非 loading/error），避免空白
    body = <div className="cardback-hint">— 无卡背数据</div>;
  }

  return (
    <figure className="cardback" aria-label="卡背预览">
      {body}
    </figure>
  );
}
