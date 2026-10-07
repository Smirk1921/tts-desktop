/**
 * ① 代码面 — Stage B1 路由组装（UI-2 窗口）
 *
 * 职责：把 Stage A 展示组件（CodeFileTree / CodeDiffView / CodeEditor）组装为完整
 * 代码面三区骨架（round-03 §3.1：对象区 / 工作区 / 参数标注区），数据流全部经 hub：
 *   GET  /v1/packs        → 取第一个注册图包作为 root
 *   POST /v1/scripts/pull → 游戏内脚本/UI → 工作区（挂载时 + 「重新拉取」）
 *   POST /v1/diff         → 工作区 vs 游戏内差异（文件树唯一数据源，见下）
 *   POST /v1/files/read   → 读工作区文件（base64 → UTF-8）→ 编辑器
 *   PUT  /v1/files/write  → 保存（baseSha256 乐观锁；409 HUB_CONFLICT → 冲突条）
 *   POST /v1/push         → 写回游戏（ConfirmGate 会签后 confirm:true）
 *   SSE  loaded           → GameLoaded 后自动重 diff
 *
 * v0.8.0 简化（任务书最终决定）：文件树只列 diff 出的有差异条目；diff 干净时树为空 +
 * 提示"工作区与游戏一致"。不臆造 hub 未提供的列目录路由。
 *
 * Stage C 接线（已接入）：SSE 订阅由 App.tsx 顶层 SseProvider 提供（本路由不再
 * 兜底挂载）；写回游戏经 useConfirmGate().ask(req) 打开 App.tsx 顶层的全站唯一
 * ConfirmGate（红线：本面不渲染 <ConfirmGate>，onConfirm = runPush，push 失败的
 * 错误仍走参数标注区错误行）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import CodeFileTree from "../components/CodeFileTree";
import type { TreeNode } from "../components/CodeFileTree";
import CodeDiffView from "../components/CodeDiffView";
import type { DiffEntry } from "../components/CodeDiffView";
import CodeEditor from "../components/CodeEditor";

import { useConfirmGate, useHub, type ConfirmRequest } from "../hub/HubContext";
import { useSseEvents } from "../hub/useSseEvents";
import { useJobTracker } from "../hub/useJobTracker";
import { sha256Hex } from "../hub/sha256";
import { isHubError } from "../hub/errors";

import "./routes.css";
import "./Code.css";

/** diff 条目 kind（= TreeNode / 确认门影响清单条目共用的对象类别） */
type EntryKind = DiffEntry["kind"];

/** packs() 注册表里的一条图包（只取本面用到的字段） */
interface PackMeta {
  dir: string;
  name?: string;
}

/** diff 状态 → 影响清单符号（红线 §10 字符集：+ M −） */
const STATUS_MARK: Record<DiffEntry["status"], string> = {
  added: "+",
  modified: "M",
  deleted: "−",
};

/** 从 diff() 响应里取条目数组（hub 返回 { entries, added, modified, deleted }） */
function readDiffEntries(res: unknown): DiffEntry[] {
  const entries = (res as { entries?: unknown }).entries;
  return Array.isArray(entries) ? (entries as DiffEntry[]) : [];
}

/** 从 packs() 响应里取第一个注册图包（hub 返回 { packs: [{dir, name, …}] }） */
function readFirstPack(res: unknown): PackMeta | null {
  const packs = (res as { packs?: unknown }).packs;
  if (!Array.isArray(packs)) return null;
  for (const p of packs) {
    if (typeof p === "object" && p !== null) {
      const dir = (p as { dir?: unknown }).dir;
      if (typeof dir === "string" && dir !== "") {
        const name = (p as { name?: unknown }).name;
        return { dir, name: typeof name === "string" ? name : undefined };
      }
    }
  }
  return null;
}

/** pullScripts() 响应 → 一行摘要（{ scriptsWritten, uiWritten, skippedNoChange }） */
function readPullSummary(res: unknown): string {
  const r = res as { scriptsWritten?: unknown; uiWritten?: unknown; skippedNoChange?: unknown };
  const s = typeof r.scriptsWritten === "number" ? r.scriptsWritten : 0;
  const u = typeof r.uiWritten === "number" ? r.uiWritten : 0;
  const skip = r.skippedNoChange === true ? " · 无变化跳过" : "";
  return `脚本 ${s} · UI ${u}${skip}`;
}

/** base64 → UTF-8 文本（atob 逐字节展开后经 TextDecoder，中文不乱码） */
function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** 时间戳 → HH:MM:SS（参数标注区"拉取"行） */
function fmtClock(ts: number | null): string {
  if (ts === null) return "—";
  const d = new Date(ts);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function CodeInner(): ReactElement {
  const { client, caps } = useHub();
  const { events: sseEvents } = useSseEvents();
  const { track } = useJobTracker();
  const { ask } = useConfirmGate();

  // ---- 数据状态 ----
  const [root, setRoot] = useState<string | null>(null);
  const [packName, setPackName] = useState<string | null>(null);
  const [diffEntries, setDiffEntries] = useState<DiffEntry[]>([]);
  const [lastPullAt, setLastPullAt] = useState<number | null>(null);
  const [pullNote, setPullNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- 编辑状态 ----
  const [activeGuid, setActiveGuid] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<EntryKind>("script");
  const [editedContent, setEditedContent] = useState("");
  const [originalSha256, setOriginalSha256] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState<"edit" | "diff">("edit");

  const filesOk = caps.canReadFiles && caps.canWriteFiles;

  /** 重 diff（拉取 / 保存 / 写回 / GameLoaded 后共用） */
  const refreshDiff = useCallback(
    async (packRoot: string): Promise<void> => {
      const res = await track("POST /v1/diff", `root=${packRoot}`, () => client.diff(packRoot));
      setDiffEntries(readDiffEntries(res));
    },
    [client, track],
  );

  // ---- 挂载：packs → 选第一个 → pull → diff ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const packsRes = await track("GET /v1/packs", "", () => client.packs());
        if (cancelled) return;
        const pack = readFirstPack(packsRes);
        if (pack === null) {
          setError("未注册图包。请先用 tts CLI 注册一个图包（.registry.yaml）。");
          return;
        }
        setRoot(pack.dir);
        setPackName(pack.name ?? null);
        // 先拉取（游戏内 → 工作区）再 diff：diff 结果反映拉取后的工作区状态
        const pullRes = await track("POST /v1/scripts/pull", `root=${pack.dir}`, () =>
          client.pullScripts(pack.dir),
        );
        if (cancelled) return;
        const diffRes = await track("POST /v1/diff", `root=${pack.dir}`, () => client.diff(pack.dir));
        if (cancelled) return;
        setDiffEntries(readDiffEntries(diffRes));
        setPullNote(readPullSummary(pullRes));
        setLastPullAt(Date.now());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, track]);

  // ---- SSE GameLoaded：游戏内脚本可能已变 → 后台重 diff（尽力而为，不打断编辑） ----
  const lastLoadedTs = useMemo<number | null>(() => {
    for (let i = sseEvents.length - 1; i >= 0; i -= 1) {
      if (sseEvents[i].type === "loaded") return sseEvents[i].ts;
    }
    return null;
  }, [sseEvents]);

  useEffect(() => {
    if (lastLoadedTs === null || root === null) return;
    let cancelled = false;
    void client
      .diff(root)
      .then((res) => {
        if (!cancelled) setDiffEntries(readDiffEntries(res));
      })
      .catch(() => {
        /* 后台刷新失败静默：错误通道留给用户主动操作 */
      });
    return () => {
      cancelled = true;
    };
  }, [lastLoadedTs, root, client]);

  // ---- 派生：文件树 / 当前条目 / 语言 / 影响清单 ----
  const treeNodes = useMemo<TreeNode[]>(
    () => diffEntries.map((e) => ({ name: e.name, guid: e.guid, kind: e.kind, status: e.status })),
    [diffEntries],
  );
  const scriptNodes = useMemo<TreeNode[]>(() => treeNodes.filter((n) => n.kind === "script"), [treeNodes]);
  const uiNodes = useMemo<TreeNode[]>(() => treeNodes.filter((n) => n.kind === "ui"), [treeNodes]);

  const activeEntry = useMemo<DiffEntry | null>(
    () => diffEntries.find((e) => e.guid === activeGuid && e.kind === activeKind) ?? null,
    [diffEntries, activeGuid, activeKind],
  );

  const editorLanguage = useMemo<"lua" | "xml" | "text">(() => {
    const name = activeEntry?.name ?? "";
    if (name.endsWith(".xml")) return "xml";
    if (name.endsWith(".lua")) return "lua";
    return "text";
  }, [activeEntry]);

  const confirmItems = useMemo<ConfirmRequest["items"]>(
    () =>
      diffEntries.map((e) => ({
        file: `${e.kind === "script" ? "scripts" : "ui"}/${e.name}`,
        diff: STATUS_MARK[e.status],
      })),
    [diffEntries],
  );

  // ---- 选中文件：filesRead → 解码 + 乐观锁基线 sha256 ----
  const handleSelect = useCallback(
    async (guid: string, kind: EntryKind): Promise<void> => {
      if (root === null || loading) return;
      const entry = diffEntries.find((e) => e.guid === guid && e.kind === kind) ?? null;
      setTab("edit");
      setActiveGuid(guid);
      setActiveKind(kind);
      setConflict(false);
      // 不可编辑（无条目 / 已删除 / hub 降级）：只置选中态，渲染层给出对应提示
      if (entry === null || entry.localPath === undefined || !caps.canReadFiles) {
        setEditedContent("");
        setOriginalSha256(null);
        setDirty(false);
        return;
      }
      const localPath = entry.localPath;
      try {
        const res = await track("POST /v1/files/read", `path=${localPath}`, () =>
          client.filesRead(root, localPath),
        );
        const sha = await sha256Hex(res.base64);
        setEditedContent(base64ToUtf8(res.base64));
        setOriginalSha256(sha);
        setDirty(false);
      } catch (e) {
        setEditedContent("");
        setOriginalSha256(null);
        setDirty(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [root, loading, diffEntries, caps.canReadFiles, client, track],
  );

  const openEntryInEditor = useCallback(
    (guid: string, kind: EntryKind): void => {
      void handleSelect(guid, kind);
    },
    [handleSelect],
  );

  const handleEditorChange = useCallback((next: string): void => {
    setEditedContent(next);
    setDirty(true);
  }, []);

  // ---- 保存：filesWrite（乐观锁）；409 → 冲突条 ----
  const handleSave = useCallback(async (): Promise<void> => {
    if (root === null || activeEntry?.localPath === undefined || originalSha256 === null) return;
    const localPath = activeEntry.localPath;
    setBusy(true);
    setError(null);
    try {
      const res = await track("PUT /v1/files/write", `path=${localPath}`, () =>
        client.filesWrite(root, localPath, editedContent, originalSha256),
      );
      // 写入响应自带 sha256（服务端对落盘字节的摘要），直接作为新基线
      setOriginalSha256(res.sha256);
      setDirty(false);
      setConflict(false);
      await refreshDiff(root);
    } catch (e) {
      if (isHubError(e) && e.code === "HUB_CONFLICT") {
        setConflict(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }, [root, activeEntry, originalSha256, editedContent, client, track, refreshDiff]);

  /** 冲突条「强制覆盖」：不带 baseSha256 绕过乐观锁（用户显式选择） */
  const handleForceOverwrite = useCallback(async (): Promise<void> => {
    if (root === null || activeEntry?.localPath === undefined) return;
    const localPath = activeEntry.localPath;
    setBusy(true);
    setError(null);
    try {
      const res = await track("PUT /v1/files/write", `path=${localPath}（强制覆盖）`, () =>
        client.filesWrite(root, localPath, editedContent),
      );
      setOriginalSha256(res.sha256);
      setDirty(false);
      setConflict(false);
      await refreshDiff(root);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [root, activeEntry, editedContent, client, track, refreshDiff]);

  // ---- 重新拉取：游戏内 → 工作区，再重 diff ----
  const handlePull = useCallback(async (): Promise<void> => {
    if (root === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await track("POST /v1/scripts/pull", `root=${root}`, () => client.pullScripts(root));
      // 拉取会以游戏内内容覆盖工作区文件：正在编辑的文件其 baseSha256 已失效，
      // 保存时将得到 409 → 走冲突条（重新加载 / 强制覆盖），不在这里静默丢弃编辑。
      await refreshDiff(root);
      setPullNote(readPullSummary(res));
      setLastPullAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [root, client, track, refreshDiff]);

  // ---- 写回游戏：ConfirmGate 会签 → push(confirm:true) ----
  const runPush = useCallback(async (): Promise<void> => {
    if (root === null) return;
    setBusy(true);
    setError(null);
    try {
      await track("POST /v1/push", `root=${root} · confirm=true · ${diffEntries.length} 项`, () =>
        client.push(root, true),
      );
      await refreshDiff(root); // push 后工作区与游戏一致 → 差异清空
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [root, diffEntries.length, client, track, refreshDiff]);

  // ---- 写回入口：ask() 打开 App.tsx 顶层的全站唯一 ConfirmGate ----
  const handlePushRequest = useCallback((): void => {
    if (root === null || diffEntries.length === 0) return;
    setError(null);
    ask({
      title: "写回游戏",
      items: confirmItems,
      ackLabel: "我已知晓上述影响，确认写回",
      onConfirm: runPush,
    });
  }, [root, diffEntries.length, ask, confirmItems, runPush]);

  // ---- 按钮可用性 ----
  const canSave =
    root !== null &&
    filesOk &&
    !busy &&
    dirty &&
    originalSha256 !== null &&
    activeEntry !== null &&
    activeEntry.status !== "deleted" &&
    activeEntry.localPath !== undefined;
  const canPush = root !== null && !busy && diffEntries.length > 0;
  const canPull = root !== null && !busy;

  const rootBase = root === null ? "—" : root.split(/[\\/]/).filter(Boolean).pop() ?? root;

  const renderEditor = (): ReactElement => {
    if (loading) return <div className="code-empty">◌ 正在连接 hub 并拉取图包…</div>;
    if (root === null) {
      return error !== null ? (
        <div className="code-empty code-empty-error">✗ {error}</div>
      ) : (
        <div className="code-empty">— 未注册图包</div>
      );
    }
    if (!caps.canReadFiles) {
      return (
        <div className="code-empty code-empty-amber">
          hub {caps.version} 无 /v1/files/* 路由（需 ≥ 0.8.0）：文件读取与保存不可用，仅可查看差异。
        </div>
      );
    }
    if (activeEntry === null) {
      return diffEntries.length === 0 ? (
        <div className="code-empty">✓ 工作区与游戏内一致，无差异条目可编辑（本面仅列出有差异的文件）。</div>
      ) : (
        <div className="code-empty">从左侧差异列表选择一个文件开始编辑。</div>
      );
    }
    if (activeEntry.status === "deleted" || activeEntry.localPath === undefined) {
      return (
        <div className="code-empty code-empty-amber">
          − {activeEntry.name} 已从工作区删除，无法编辑；「写回游戏」将同步删除游戏内对应脚本/UI。
        </div>
      );
    }
    return (
      <CodeEditor
        value={editedContent}
        language={editorLanguage}
        onChange={handleEditorChange}
        placeholder="（空文件）"
      />
    );
  };

  return (
    <div className="route-slide">
      <div className="code-layout">
        {/* 对象区：差异文件树 */}
        <aside className="code-obj">
          <CodeFileTree
            scripts={scriptNodes}
            uis={uiNodes}
            activeGuid={activeGuid ?? undefined}
            onSelect={(guid, kind) => void handleSelect(guid, kind)}
          />
        </aside>

        {/* 工作区：编辑 | 差异 Tab */}
        <main className="code-work">
          <div className="code-tabs" role="tablist" aria-label="代码工作区视图">
            <button type="button" data-on={tab === "edit"} onClick={() => setTab("edit")}>
              编辑
            </button>
            <button type="button" data-on={tab === "diff"} onClick={() => setTab("diff")}>
              差异 ({diffEntries.length})
            </button>
            <span className="code-tabs-file" data-dirty={dirty} title={activeEntry?.localPath}>
              {activeEntry?.name ?? "未选择文件"}
              {dirty ? " ●" : ""}
            </span>
          </div>
          {tab === "diff" ? (
            <div className="code-diffwrap">
              <CodeDiffView entries={diffEntries} onOpenEntry={openEntryInEditor} />
            </div>
          ) : (
            <div className="code-editwrap">
              {conflict && activeEntry !== null && (
                <div className="code-conflict" role="alert">
                  <span className="code-conflict-sym">✗</span>
                  <span className="code-conflict-text">
                    文件已被外部修改（409 HUB_CONFLICT）：{activeEntry.name}
                  </span>
                  <button type="button" onClick={() => void handleSelect(activeEntry.guid, activeEntry.kind)}>
                    重新加载
                  </button>
                  <button type="button" onClick={() => void handleForceOverwrite()}>强制覆盖</button>
                </div>
              )}
              {renderEditor()}
            </div>
          )}
        </main>

        {/* 参数标注区：版本状态 + 操作 */}
        <aside className="code-param">
          <div className="code-param-title">参数标注</div>
          <dl className="code-meta">
            <div>
              <dt>图包</dt>
              <dd title={root ?? undefined}>{packName ?? rootBase}</dd>
            </div>
            <div>
              <dt>拉取</dt>
              <dd className="tnum">{fmtClock(lastPullAt)}</dd>
            </div>
            <div>
              <dt>差异</dt>
              <dd className="tnum">{diffEntries.length}</dd>
            </div>
            <div>
              <dt>当前</dt>
              <dd title={activeEntry?.localPath}>{activeEntry?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>改动</dt>
              <dd data-tone={dirty ? "amber" : conflict ? "red" : undefined}>
                {dirty ? "未保存" : conflict ? "冲突" : "—"}
              </dd>
            </div>
            <div>
              <dt>文件路由</dt>
              <dd
                data-tone={filesOk ? "ok" : "red"}
                title={filesOk ? undefined : "POST/PUT /v1/files/* 需要 hub ≥ 0.8.0"}
              >
                {filesOk ? "可用" : "不可用"}
              </dd>
            </div>
          </dl>
          {pullNote !== null && <div className="code-pull-note">{pullNote}</div>}
          {error !== null && root !== null && (
            <div className="code-error" role="alert">
              ✗ {error}
            </div>
          )}
          <div className="code-acts">
            <button type="button" className="code-btn" disabled={!canSave} onClick={() => void handleSave()}>
              保存
            </button>
            <button
              type="button"
              className="code-btn code-btn-danger"
              disabled={!canPush}
              onClick={handlePushRequest}
            >
              写回游戏
            </button>
            <button type="button" className="code-btn" disabled={!canPull} onClick={() => void handlePull()}>
              重新拉取
            </button>
          </div>
          <div className="code-param-note">
            保存 = PUT /v1/files/write（baseSha256 乐观锁，冲突 409）；写回 = 确认门会签 → POST /v1/push（confirm:true）。
          </div>
        </aside>
      </div>
    </div>
  );
}

/** ① 代码面路由：SSE 订阅由 App.tsx 顶层 SseProvider 提供（Stage C 接线完成） */
export default function Code(): ReactElement {
  return <CodeInner />;
}
