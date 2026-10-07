/**
 * <ImportPreviewDialog> ④素材面·导入预览对话框 — UI-3 Stage B2
 *
 * 职责：POST /v1/import dry-run 预览（round-03 §3.1 ④素材·参数区"导入"）。
 *   open 时对 root + manifestPath 跑一次 dry-run（dryRun=true，hub 不写盘），
 *   把 ImportResult（契约 tts-toolkit/docs/schemas/import.yaml.md §6.4：
 *   decks[] / objects[] / objectsCsvPath / warnings[]，其中 copiedFiles 为
 *   {source, dest} 路径对）解析为"将导入的文件清单"展示；「确认导入」把
 *   真导入交回父组件——onConfirmImport 由父组件实现（useConfirmGate().ask
 *   会签后 dryRun=false 真导入，红线：写操作必须过确认门），本框等其
 *   resolve 才 onClose，reject 则红字留在框内可重试。
 *
 * 关键设计：
 *  - client 响应按 unknown 防御解析（HubClient.importAssets 返回 unknown，
 *    同 Code.tsx readFirstPack 范式），字段缺失跳过不炸；
 *  - 文件大小：hub ImportResult 契约仅含 source/dest 路径（import.ts
 *    ImportFilePlan），不含 size——对话框如实只列路径（dest 为主、悬停见
 *    source），并在框内注明，不臆造数据；
 *  - dry-run 调用经 useJobTracker().track 登记 Job（tool 名 HTTP 路由形态，
 *    红线 §10；本组件 tracker 实例不渲染 JobSheet，登记仅为纪律一致）；
 *  - 关闭时重置 confirming / error（open=true 重新打开即全新一轮），
 *    同 ConfirmGate 的 reset-on-close 范式；
 *  - 返回类型 ReactElement | null（open=false 返回 null，任务书签名上的
 *    ReactElement 按行为规格收窄补全）。
 *
 * 样式：模态遮罩 + 居中对话框（ConfirmGate 同款骨架，tokens.css 变量）；
 * z-index 90 < 确认门 100——会签时确认门叠于本框之上。
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";

import { useHub } from "../hub/HubContext";
import { useJobTracker } from "../hub/useJobTracker";
import "./ImportPreviewDialog.css";

/** dry-run 清单里的一条待复制文件（= tts-toolkit ImportFilePlan：source → dest） */
export interface ImportPlanFile {
  source: string;
  dest: string;
}

/** 解析后的单卡堆导入计划（ImportResult.DeckImportResult 的本面展示字段） */
export interface ImportPlanDeck {
  name: string;
  guid?: string;
  /** cards.csv 导入前是否已存在（true=更新，false=新建） */
  cardsCsvExisted: boolean;
  /** 本次新增卡数 */
  addedCards: number;
  files: ImportPlanFile[];
}

/** 解析后的单素材对象导入计划（ImportResult.ObjectImportResult 的展示字段） */
export interface ImportPlanObject {
  type: string;
  name: string;
  files: ImportPlanFile[];
}

/** 解析后的 dry-run 计划（hub ImportResult 的展示投影） */
export interface ImportPlan {
  decks: ImportPlanDeck[];
  objects: ImportPlanObject[];
  objectsCsvPath: string | null;
  warnings: string[];
}

export interface ImportPreviewDialogProps {
  open: boolean;
  root: string;
  manifestPath: string;
  onClose(): void;
  /** 父组件实现：useConfirmGate().ask 会签 + dryRun=false 真导入；resolve 后本框才关闭 */
  onConfirmImport(): Promise<void>;
}

// ---- 防御解析（hub 响应一律 unknown，字段缺失即跳过） ----

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** copiedFiles[] → ImportPlanFile[]（缺 source / dest 的条目跳过） */
function readPlanFiles(v: unknown): ImportPlanFile[] {
  const out: ImportPlanFile[] = [];
  for (const it of asArray(v)) {
    if (it === null || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const source = asString(o.source);
    const dest = asString(o.dest);
    if (source !== null && dest !== null) out.push({ source, dest });
  }
  return out;
}

/** ImportResult → ImportPlan（decks / objects 条目缺 name 的跳过） */
function readPlan(res: unknown): ImportPlan {
  const r = (res ?? {}) as Record<string, unknown>;
  const decks: ImportPlanDeck[] = [];
  for (const it of asArray(r.decks)) {
    if (it === null || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const name = asString(o.name);
    if (name === null) continue;
    const guid = asString(o.guid);
    decks.push({
      name,
      guid: guid !== null ? guid : undefined,
      cardsCsvExisted: o.cardsCsvExisted === true,
      addedCards: typeof o.addedCards === "number" ? o.addedCards : 0,
      files: readPlanFiles(o.copiedFiles),
    });
  }
  const objects: ImportPlanObject[] = [];
  for (const it of asArray(r.objects)) {
    if (it === null || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const type = asString(o.type);
    const name = asString(o.name);
    if (type === null || name === null) continue;
    objects.push({ type, name, files: readPlanFiles(o.copiedFiles) });
  }
  const objectsCsvPath = asString(r.objectsCsvPath);
  return {
    decks,
    objects,
    objectsCsvPath: objectsCsvPath !== null ? objectsCsvPath : null,
    warnings: asArray(r.warnings).filter((w): w is string => typeof w === "string"),
  };
}

export default function ImportPreviewDialog(props: ImportPreviewDialogProps): ReactElement | null {
  const { open, root, manifestPath, onClose, onConfirmImport } = props;

  const { client } = useHub();
  const { track } = useJobTracker();

  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** 「重新跑 dry-run」自增触发器 */
  const [rerun, setRerun] = useState(0);

  // 关闭即复位（ConfirmGate reset-on-close 范式）：下次打开是全新一轮
  useEffect(() => {
    if (!open) {
      setConfirming(false);
      setError(null);
      setPlan(null);
      setPhase("loading");
    }
  }, [open]);

  // open / 清单变更 / 手动重跑 → dry-run（dryRun=true，hub 不写盘）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("loading");
    setError(null);
    setPlan(null);
    void (async () => {
      try {
        const res = await track(
          "POST /v1/import",
          `root=${root} · manifest=${manifestPath} · dryRun=true`,
          () => client.importAssets(root, manifestPath, true),
        );
        if (cancelled) return;
        setPlan(readPlan(res));
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, root, manifestPath, rerun, client, track]);

  // 确认导入：等父组件 onConfirmImport resolve 才 onClose；reject 红字留框内可重试
  const handleConfirm = useCallback(async (): Promise<void> => {
    setConfirming(true);
    setError(null);
    try {
      await onConfirmImport();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  }, [onConfirmImport, onClose]);

  if (!open) {
    return null;
  }

  const fileCount =
    plan === null
      ? 0
      : plan.decks.reduce((acc, d) => acc + d.files.length, 0) +
        plan.objects.reduce((acc, o) => acc + o.files.length, 0);

  return (
    <div className="importpreview" role="dialog" aria-modal="true" aria-label="导入预览">
      <div className="importpreview-mask" onClick={confirming ? undefined : onClose} />

      <div className="importpreview-dialog">
        <header className="importpreview-head">
          <span className="importpreview-marker" aria-hidden />
          <h2 className="importpreview-title">导入预览（dry-run）</h2>
        </header>

        <div className="importpreview-meta">
          root={root} · manifest={manifestPath}
          {plan !== null && plan.objectsCsvPath !== null && ` · 台账=${plan.objectsCsvPath}`}
        </div>

        {phase === "loading" && (
          <div className="importpreview-loading">◌ 正在 dry-run（不写盘）…</div>
        )}

        {error !== null && phase !== "loading" && (
          <div className="importpreview-error" role="alert">
            ✗ {error}
          </div>
        )}

        {phase === "ready" && plan !== null && (
          <>
            <div className="importpreview-summary">
              卡堆 {plan.decks.length} · 素材对象 {plan.objects.length} · 待复制文件{" "}
              {fileCount} · 警告 {plan.warnings.length}
            </div>

            {plan.warnings.length > 0 && (
              <div className="importpreview-warn">
                {plan.warnings.map((w, i) => (
                  <span key={i} className="importpreview-warn-line">
                    ⚠ {w}
                  </span>
                ))}
              </div>
            )}

            <ul className="importpreview-list">
              {plan.decks.map((d) => (
                <li key={`deck:${d.name}`} className="importpreview-group">
                  <div className="importpreview-group-head">
                    ▣ deck {d.name}
                    {d.guid !== undefined && d.guid !== "" ? ` (${d.guid})` : ""} · cards.csv{" "}
                    {d.cardsCsvExisted ? "更新" : "新建"} · 新增卡 {d.addedCards}
                  </div>
                  {d.files.map((f, i) => (
                    <div key={i} className="importpreview-file" title={`${f.source} → ${f.dest}`}>
                      {f.dest}
                    </div>
                  ))}
                </li>
              ))}
              {plan.objects.map((o) => (
                <li key={`obj:${o.type}:${o.name}`} className="importpreview-group">
                  <div className="importpreview-group-head">◈ {o.type} / {o.name}</div>
                  {o.files.map((f, i) => (
                    <div key={i} className="importpreview-file" title={`${f.source} → ${f.dest}`}>
                      {f.dest}
                    </div>
                  ))}
                </li>
              ))}
              {fileCount === 0 && plan.decks.length + plan.objects.length > 0 && (
                <li className="importpreview-empty">— 无待复制文件（清单可能只更新台账）</li>
              )}
              {plan.decks.length + plan.objects.length === 0 && (
                <li className="importpreview-empty">— 清单未声明任何 decks / objects 条目</li>
              )}
            </ul>

            <div className="importpreview-sizenote">
              注：hub ImportResult 契约（import.yaml.md §6.4）仅含 source / dest
              路径、不含文件大小，故此处只列目标路径，悬停可见源路径。
            </div>
          </>
        )}

        <footer className="importpreview-act">
          <button type="button" className="importpreview-btn" disabled={confirming} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="importpreview-btn"
            disabled={confirming || phase === "loading"}
            onClick={() => setRerun((n) => n + 1)}
          >
            重新跑 dry-run
          </button>
          <button
            type="button"
            className="importpreview-btn importpreview-btn-primary"
            disabled={confirming || phase !== "ready"}
            onClick={() => void handleConfirm()}
          >
            {confirming ? "◌ 处理中" : "确认导入"}
          </button>
        </footer>
      </div>
    </div>
  );
}
