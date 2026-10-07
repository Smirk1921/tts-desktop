/**
 * <DeckList> Cards 面·对象区（左列表） — Stage A1（UI-3）
 * 职责：卡牌面对象区的牌堆列表，结构对齐 CodeFileTree（UI-2 范式），
 *       但数据源是"牌堆"（deck.yaml 的 key 或 deckGuid）不是 diff 文件。
 * 纯受控展示：选中由父组件驱动（activeDeckKey），本组件不持状态、不调 hubClient。
 * 行为：单分组 "decks/"，每行 name + cardCount（若有）；键盘可达（Enter/Space）；
 *       空态 "— 无牌堆"（"—" 为任务书指定的占位符，非 LegendBar 注册符号）。
 */
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import "./DeckList.css";

/** 牌堆条目：deck.yaml 的 key 或 deckGuid */
export interface DeckEntry {
  /** 牌堆 key（deck.yaml 的 key 或 deckGuid） */
  deckKey: string;
  /** 展示名 */
  name: string;
  /** 牌堆内卡数（可选，未拉取时为 undefined） */
  cardCount?: number;
  /** 卡背 URL（可选；由父组件取数后送 CardBackPreview，本组件不消费） */
  backUrl?: string;
}

export interface DeckListProps {
  /** 牌堆列表（父组件由 deck.yaml / 存档整理而来） */
  decks: DeckEntry[];
  /** 当前选中牌堆 key（高亮） */
  activeDeckKey?: string;
  /** 选中回调 */
  onSelect(deckKey: string): void;
}

function DeckItem(props: {
  deck: DeckEntry;
  active: boolean;
  onSelect: DeckListProps["onSelect"];
}): ReactElement {
  const { deck, active, onSelect } = props;

  const handleClick = (event: MouseEvent<HTMLLIElement>): void => {
    event.stopPropagation();
    onSelect(deck.deckKey);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(deck.deckKey);
    }
  };

  return (
    <li
      className="decklist-item"
      data-active={active ? "true" : "false"}
      aria-current={active ? "true" : undefined}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="decklist-name">{deck.name}</span>
      {deck.cardCount !== undefined && (
        <span className="decklist-count tnum">{deck.cardCount}</span>
      )}
    </li>
  );
}

export default function DeckList(props: DeckListProps): ReactElement {
  const { decks, activeDeckKey, onSelect } = props;

  return (
    <nav className="decklist" aria-label="卡牌对象区">
      <section className="decklist-group" aria-label="decks/">
        <div className="decklist-group-title">decks/</div>
        {decks.length > 0 ? (
          <ul className="decklist-list">
            {decks.map((deck) => (
              <DeckItem
                key={deck.deckKey}
                deck={deck}
                active={deck.deckKey === activeDeckKey}
                onSelect={onSelect}
              />
            ))}
          </ul>
        ) : (
          <div className="decklist-empty">— 无牌堆</div>
        )}
      </section>
    </nav>
  );
}
