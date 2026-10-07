/**
 * <CodeEditor> 代码编辑器 — Stage A2
 * 职责：包 @uiw/react-codemirror，按 language 选 Lua / XML / 纯文本高亮。
 * 纯受控：value / onChange 全由父组件驱动，本组件不持内容状态、不调 hubClient。
 * 主题：tokens.css 变量映射的图纸蓝暗色（EditorView.theme，dark）。
 */
import { useMemo } from "react";
import type { ReactElement } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { xml } from "@codemirror/lang-xml";
import "./CodeEditor.css";

export interface CodeEditorProps {
  /** 编辑器当前内容（受控） */
  value: string;
  /** 语言：按文件扩展名识别（.lua / .xml / 其他纯文本） */
  language: "lua" | "xml" | "text";
  /** 内容变化回调（用户输入时） */
  onChange(next: string): void;
  /** 只读模式（用于展示游戏内 script，禁止编辑） */
  readOnly?: boolean;
  /** 占位文本（value 为空时显示） */
  placeholder?: string;
}

/** TTS 图纸蓝主题：全部经 tokens.css 变量映射，不写死色值 */
const ttsTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--bp-dd)",
      color: "var(--w)",
      fontSize: "var(--fs-data)",
      fontFamily: "var(--mono)",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "var(--w)",
      fontFamily: "var(--mono)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--w)",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--blue)",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--bp-d)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--bp-d)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bp-dd)",
      color: "var(--wdim)",
      border: "none",
      borderRight: "var(--border-w) solid var(--wfaint)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      fontFamily: "var(--mono)",
      fontVariantNumeric: "tabular-nums",
    },
  },
  { dark: true },
);

export default function CodeEditor(props: CodeEditorProps): ReactElement {
  const { value, language, onChange, readOnly = false, placeholder } = props;

  /** 语言扩展：lua → legacy StreamLanguage；xml → lang-xml；text → 无 */
  const extensions = useMemo<Extension[]>(() => {
    if (language === "lua") return [StreamLanguage.define(lua)];
    if (language === "xml") return [xml()];
    return [];
  }, [language]);

  return (
    <div className="codeeditor">
      <CodeMirror
        value={value}
        extensions={extensions}
        onChange={onChange}
        theme={ttsTheme}
        height="100%"
        readOnly={readOnly}
        editable={!readOnly}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
        }}
      />
    </div>
  );
}
