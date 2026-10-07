/**
 * <LuaExecPanel> Lua 直执 — Stage A3（代理面右上）
 * 职责：textarea 输入 + snippet 快捷入口 + 执行按钮 + JSON 结果展示。
 * 输入性内部状态（lua / running / result / error）；执行经 onExec 回调由
 * 父级调 hubClient.exec（本组件不依赖 hubClient，不订阅 SSE）。
 *
 * 结果色（§2.5）：成功返回 = ok（青），Error = red（红）。
 * 符号：◌（执行中）▶（执行）—— 均为字符，无图标库。
 */
import { useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import "./LuaExecPanel.css";

export interface LuaExecPanelProps {
  /** 执行回调（父组件负责调 hubClient.exec，本组件只触发） */
  onExec(lua: string): Promise<unknown>;
  /** 禁用（如 hub 未连接 / TTS 未加载存档） */
  disabled?: boolean;
  /** 常用指令快捷入口 */
  snippets?: { label: string; lua: string }[];
}

export default function LuaExecPanel(props: LuaExecPanelProps): ReactElement {
  const { onExec, disabled = false, snippets } = props;
  const [lua, setLua] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<string | undefined>(undefined);
  const [error, setError] = useState<boolean>(false);

  const doExec = async (): Promise<void> => {
    setRunning(true);
    setResult(undefined);
    setError(false);
    try {
      const res: unknown = await onExec(lua);
      /* JSON.stringify(undefined) 返回 undefined（面板不显示），兜底为字面量 */
      setResult(
        res === undefined ? "undefined" : JSON.stringify(res, null, 2),
      );
    } catch (e: unknown) {
      setResult(e instanceof Error ? e.message : String(e));
      setError(true);
    } finally {
      setRunning(false);
    }
  };

  const handleExec = (): void => {
    if (disabled || running || !lua.trim()) return;
    void doExec();
  };

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    setLua(e.target.value);
  };

  return (
    <div className="luapanel">
      <div className="luapanel-head">
        <span className="luapanel-title">Lua 直执</span>
      </div>
      {snippets !== undefined && snippets.length > 0 && (
        <div className="luapanel-snippets">
          {snippets.map((s, i) => (
            <button
              key={i}
              type="button"
              className="luapanel-snippet"
              onClick={() => setLua(s.lua)}
              disabled={disabled}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        className="luapanel-input"
        value={lua}
        onChange={handleInput}
        placeholder="return 1+1"
        disabled={disabled}
        rows={6}
        spellCheck={false}
      />
      <div className="luapanel-act">
        <button
          type="button"
          className="luapanel-exec"
          onClick={handleExec}
          disabled={disabled || !lua.trim() || running}
        >
          {running ? "◌ 执行中" : "▶ 执行"}
        </button>
      </div>
      {result !== undefined && (
        <div className="luapanel-result" data-ok={!error}>
          <pre>{result}</pre>
        </div>
      )}
    </div>
  );
}
