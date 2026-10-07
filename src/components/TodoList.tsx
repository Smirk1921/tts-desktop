/**
 * <TodoList> 待办清单 — UI-4 Stage A1（⓪总览左下块，a-deep.html .todo-line）
 *
 * 职责：块标题「待 办」+ 若干行「mark 字符符号（自带颜色）+ 文本」；行点击
 *   → onNavigate(target)，跳去该行所属工作面（①代码 / ③卡牌 / ④素材…）。
 * 纯受控展示：todos 与跳转回调由 A3（useOverviewData + 图层切换）供给，
 *   本组件不持状态、不调 hub。
 * 符号与状态色（§2.4 符号即图标 / §2.5 纪律）：mark 用字符符号（✗ ⇄ ✂ ⬆ ✓…），
 *   颜色由 item.color 决定 —— 数据侧已按语义定色（红=错误·死链·差异、
 *   蓝=进行中·代理、琥珀=待人审、青=成功·完成），本组件只做映射不做判断。
 * 空态：一行灰字「✓ 无待办」（诚实空态，不留空白块）。
 */
import type { KeyboardEvent, ReactElement } from "react";
import type { LayerId, TodoItem } from "../state/processStamps";
import "./TodoList.css";

export interface TodoListProps {
  /** 待办行（来自 OverviewData.todos） */
  todos: TodoItem[];
  /** 行点击 → 跳转对应工作面 */
  onNavigate(layer: LayerId): void;
}

function TodoLine(props: {
  item: TodoItem;
  onNavigate: TodoListProps["onNavigate"];
}): ReactElement {
  const { item, onNavigate } = props;

  const activate = (): void => {
    onNavigate(item.target);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };

  return (
    <div
      className="todolist-line"
      data-color={item.color}
      role="button"
      tabIndex={0}
      title={item.text}
      onClick={activate}
      onKeyDown={handleKeyDown}
    >
      <span className="todolist-mk" aria-hidden="true">
        {item.mark}
      </span>
      <span className="todolist-text">{item.text}</span>
    </div>
  );
}

export default function TodoList(props: TodoListProps): ReactElement {
  const { todos, onNavigate } = props;

  return (
    <section className="todolist" aria-label="待办">
      <div className="todolist-head">
        <span className="todolist-title">待 办</span>
      </div>
      {todos.length > 0 ? (
        todos.map((item, i) => (
          <TodoLine key={`${item.target}:${i}`} item={item} onNavigate={onNavigate} />
        ))
      ) : (
        <div className="todolist-empty">✓ 无待办</div>
      )}
    </section>
  );
}
