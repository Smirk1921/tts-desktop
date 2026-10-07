/**
 * ③ 卡牌面 — Stage B1 路由组装（UI-3）
 *
 * 职责：把 Stage A 展示组件（DeckList / CardBackPreview / SliceGrid /
 * CardFacePreview）组装为完整卡牌面三区骨架（round-03 §3.1）：
 *   对象区（左 .cards-obj）   = 牌堆列表（上） + 卡背预览（下）
 *   工作区（中 .cards-work）  = 切片网格（上） + 卡面预览（下）
 *   参数标注区（右 .cards-param）= 元信息 + 切片参数 + 替换预览 + 操作按钮
 * 数据流全部经 hub（契约：tts-toolkit/docs/schemas/hub-control.md §4.6-4.8、§4.15；
 * cards.csv 契约：tts-toolkit/docs/schemas/cards.csv.md §2-§3）：
 *   GET  /v1/packs        → 取第一个注册图包作为 root（同 Code.tsx readFirstPack）
 *   POST /v1/files/read   → 牌堆清单探测 + cards.csv 回填 + 卡背图（hub ≥ 0.8.0）
 *   POST /v1/deck/slice   → 切片（useConfirmGate().ask 会签后执行，写本地文件）
 *   POST /v1/deck/plan    → 替换计划 dry-run（只读，不经确认门）
 *   SSE  loaded           → GameLoaded 后静默重探牌堆清单（Code.tsx lastLoadedTs 模式）
 *
 * == 契约勘误（相对任务书的落地差异；均按 hub 已实现契约处理，非臆造）==
 *  1. 任务书牌堆数据源 filesRead(root, "deck.yaml")：hub §4.15 的 MIME 白名单
 *     （png/jpg/jpeg/webp/gif/pdf/txt/lua/xml/json/csv/md）不含 yaml → 现实恒
 *     400 HUB_BAD_REQUEST。按任务书降级路径处理：任何读取失败 → 单占位牌堆
 *     （deckKey="default"，name="默认牌堆"）。解析器仍按任务书正则
 *     /^  ([a-zA-Z0-9_-]+):/gm 实现（白名单未来放行 yaml 时零改动生效）。
 *  2. 切片成功后的真实值回填走 SliceResult（hub-control.md §4.7：
 *     {cardsSliced, deck: DeckCandidate, sharedWith, cardsCsvPath, cardFiles,
 *     backFiles}）：cols/rows 取 cards.csv 的 sheet_cols/sheet_rows（deck.yaml.md
 *     §4.3：cards.csv 是权威声明；DeckCandidate.numWidth/numHeight 兜底），图集
 *     URL 取 sheet_source（兼作死链 faceUrl）/ deck.faceUrl，卡格按 slot（1 基）
 *     → SliceCard.i（0 基），face = outDir 内文件名（files/read 接受 root 内绝对
 *     路径，§4.15），卡背取 backFiles[0]。
 *  3. 任务书"deck.yaml 内 back 字段"在真实契约（deck.yaml.md v1.1）中不存在 →
 *     切片前卡背恒占位；切片后由 backFiles 回填（经对象区卡背 effect 统一取数）。
 *
 * Stage C 已接线：useDeadLinks 来自 ../state/DeadLinkContext（App.tsx 顶层
 * DeadLinkProvider 下发，红线 4），本面只读不上报——deadUrls 下发
 * SliceGrid.deadLinkSet + 选中死链卡时禁用切片 + 红字提示。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import DeckList from "../components/DeckList";
import type { DeckEntry } from "../components/DeckList";
import CardBackPreview from "../components/CardBackPreview";
import SliceGrid from "../components/SliceGrid";
import type { SheetMeta, SliceCard } from "../components/SliceGrid";
import CardFacePreview from "../components/CardFacePreview";

import { useConfirmGate, useHub } from "../hub/HubContext";
import { useSseEvents } from "../hub/useSseEvents";
import { useJobTracker } from "../hub/useJobTracker";
import { getCachedFile, setCachedFile } from "../hub/fileCache";

import { useDeadLinks } from "../state/DeadLinkContext";

import "./routes.css";
import "./Cards.css";

/** 占位牌堆 key（任务书：deck.yaml 不可读时降级为单 deck 占位） */
const PLACEHOLDER_KEY = "default";

/** SheetMeta 缺省网格（任务书：cols=10 rows=7 w=700 h=980；真实值由切片回填） */
const DEFAULT_SHEET = { w: 700, h: 980, cols: 10, rows: 7 } as const;

/** 切片 / 替换预览入参缺省网格兜底（cards.csv 数值列解析失败时） */
const FALLBACK_COLS = DEFAULT_SHEET.cols;
const FALLBACK_ROWS = DEFAULT_SHEET.rows;

/** packs() 注册表里的一条图包（只取本面用到的字段） */
interface PackMeta {
  dir: string;
  name?: string;
}

/** root 级 deck.yaml 解析出的一条牌堆（内部过渡形；渲染用 Stage A 的 DeckEntry） */
interface ParsedDeck {
  deckKey: string;
  backUrl?: string;
}

/** 网格元数据（SheetMeta 的可变部分；w/h 本阶段恒为缺省，见文件头勘误 2） */
interface SheetDims {
  w: number;
  h: number;
  cols: number;
  rows: number;
}

/** cards.csv 一行（只取本面用到的列；契约 cards.csv.md §3，slot/sheet_* 为 1 基/整列） */
interface CardsCsvRow {
  face: string;
  name?: string;
  slot: number;
  sheetId: number;
  sheetCols: number;
  sheetRows: number;
  sheetSource: string;
}

/** SliceResult 只取本面消费的字段（契约 hub-control.md §4.7；防御式读取） */
interface SliceSummary {
  cardsSliced: number;
  deckKey?: string;
  nickname?: string;
  faceUrl?: string;
  numWidth?: number;
  numHeight?: number;
  cardsCsvPath?: string;
  backFiles: string[];
}

/** 占位牌堆（deck.yaml 不可读 / 解析为空时的降级） */
function placeholderDeck(): DeckEntry {
  return { deckKey: PLACEHOLDER_KEY, name: "默认牌堆" };
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

/** base64 → UTF-8 文本（atob 逐字节展开后经 TextDecoder，中文不乱码） */
function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** 时间戳 → HH:MM:SS（参数标注区"探测"行） */
function fmtClock(ts: number | null): string {
  if (ts === null) return "—";
  const d = new Date(ts);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** 目录 + 相对文件名 → 绝对路径（backFiles / cards.csv 的 face 均相对 outDir） */
function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${name}`;
}

/**
 * root 级 deck.yaml 极简解析（任务书指定正则，不引第三方 YAML 库）：
 * 优先取顶层 `decks:` 段内的二级 key；无该段时按任务书正则全文件扫二级 key。
 * 每个牌堆块内可带 4 空格缩进的 `back:` 字段（任务书 §4 卡背来源；现实契约无）。
 */
function parseRootDeckYaml(text: string): ParsedDeck[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const decksAt = lines.findIndex((l) => /^decks:\s*(?:#.*)?$/.test(l));
  let lo = 0;
  let hi = lines.length;
  if (decksAt >= 0) {
    lo = decksAt + 1;
    hi = lo;
    while (hi < lines.length && /^\S/.test(lines[hi]) === false) hi += 1;
  }
  const decks: ParsedDeck[] = [];
  let cur: ParsedDeck | null = null;
  for (let i = lo; i < hi; i += 1) {
    const line = lines[i];
    const key = /^ {2}([a-zA-Z0-9_-]+):/.exec(line);
    if (key !== null) {
      cur = { deckKey: key[1] };
      decks.push(cur);
      continue;
    }
    if (cur === null) continue;
    const back = /^ {4}back:\s*(.+?)\s*$/.exec(line);
    if (back !== null && cur.backUrl === undefined) {
      cur.backUrl = back[1]
        .replace(/\s+#.*$/, "") // 行尾注释（URL 片段 # 前必有空白才视作注释）
        .replace(/^["']|["']$/g, "");
    }
  }
  return decks;
}

/** 极简 CSV 解析（RFC4180 子集：双引号字段 / 双写引号转义 / CRLF 容忍；剥 BOM） */
function parseCsvRows(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * cards.csv → 本面需要的行（契约 cards.csv.md §2-§3：首行表头按列名取下标；
 * 数值列仅接受整数；face 必填非空；非法行跳过不致命）。
 */
function parseCardsCsv(text: string): CardsCsvRow[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const iFace = col("face");
  const iName = col("name");
  const iSlot = col("slot");
  const iSheet = col("sheet_id");
  const iCols = col("sheet_cols");
  const iRows = col("sheet_rows");
  const iSrc = col("sheet_source");
  if (iFace < 0 || iSlot < 0) return [];
  const int = (v: string | undefined, dflt: number): number => {
    const n = Number.parseInt(v ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const out: CardsCsvRow[] = [];
  for (const r of rows.slice(1)) {
    const face = (r[iFace] ?? "").trim();
    if (face === "") continue;
    const slot = int(iSlot < r.length ? r[iSlot] : undefined, 0);
    if (slot < 1) continue; // slot 1 基（契约 §3）；解析失败 = 非法行
    out.push({
      face,
      name: iName >= 0 && iName < r.length ? (r[iName] ?? "").trim() || undefined : undefined,
      slot,
      sheetId: int(iSheet >= 0 && iSheet < r.length ? r[iSheet] : undefined, 1),
      sheetCols: int(iCols >= 0 && iCols < r.length ? r[iCols] : undefined, FALLBACK_COLS),
      sheetRows: int(iRows >= 0 && iRows < r.length ? r[iRows] : undefined, FALLBACK_ROWS),
      sheetSource: iSrc >= 0 && iSrc < r.length ? (r[iSrc] ?? "").trim() : "",
    });
  }
  return out;
}

/** SliceResult 防御式读取（响应定型为 Promise<unknown>；形状见 hub-control.md §4.7） */
function readSliceResult(res: unknown): SliceSummary | null {
  if (typeof res !== "object" || res === null) return null;
  const r = res as Record<string, unknown>;
  const deck = (typeof r.deck === "object" && r.deck !== null ? r.deck : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v !== "" ? v : undefined;
  const pos = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  const strs = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    cardsSliced: typeof r.cardsSliced === "number" && Number.isFinite(r.cardsSliced) ? r.cardsSliced : 0,
    deckKey: str(deck.deckKey),
    nickname: str(deck.nickname),
    faceUrl: str(deck.faceUrl),
    numWidth: pos(deck.numWidth),
    numHeight: pos(deck.numHeight),
    cardsCsvPath: str(r.cardsCsvPath),
    backFiles: strs(r.backFiles),
  };
}

/** 远端卡背 URL → base64（浏览器 fetch，非 hub 调用，不经 JobTracker；失败抛错） */
async function fetchImageBase64(url: string): Promise<{ base64: string; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}：${url}`);
  const blob = await res.blob();
  const mime = blob.type !== "" ? blob.type : "image/png";
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
  return { base64, mime };
}

function CardsInner(): ReactElement {
  const { client, caps } = useHub();
  const { events: sseEvents } = useSseEvents();
  const { track } = useJobTracker();
  const { ask } = useConfirmGate();
  // 全站死链 store（App.tsx 顶层 DeadLinkProvider，Stage C 已接线；本面只读）
  const { deadUrls } = useDeadLinks();

  // ---- 数据状态 ----
  const [root, setRoot] = useState<string | null>(null);
  const [packName, setPackName] = useState<string | null>(null);
  const [decks, setDecks] = useState<DeckEntry[]>([]);
  const [activeDeckKey, setActiveDeckKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastProbeAt, setLastProbeAt] = useState<number | null>(null);

  // ---- 网格状态（真实值由切片结果回填，见文件头勘误 2） ----
  const [dims, setDims] = useState<SheetDims>({ ...DEFAULT_SHEET });
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [cards, setCards] = useState<SliceCard[]>([]);
  const [filled, setFilled] = useState<Set<number> | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  /** 切片响应里的真实 CustomDeck key（占位牌堆无 key，消歧参数用它） */
  const [realDeckKey, setRealDeckKey] = useState<string | null>(null);

  // ---- 卡背预览状态（CardBackPreview 纯受控，取数 Job 归本路由登记） ----
  const [backBase64, setBackBase64] = useState<string | undefined>(undefined);
  const [backMime, setBackMime] = useState<string | undefined>(undefined);
  const [backLoading, setBackLoading] = useState(false);
  const [backError, setBackError] = useState<string | undefined>(undefined);

  // ---- 参数区输入（任务书：路径输入默认留空；savePath 切片 / 替换共用） ----
  const [sheetPath, setSheetPath] = useState("");
  const [savePath, setSavePath] = useState("");
  const [outDir, setOutDir] = useState("");
  const [planFrom, setPlanFrom] = useState("");
  const [planTo, setPlanTo] = useState("");
  const [planResult, setPlanResult] = useState<string | null>(null);

  const filesOk = caps.canReadFiles;

  /**
   * 牌堆清单探测：filesRead(root, "deck.yaml") → 极简 YAML 解析 → DeckEntry[]。
   * 契约勘误 1：hub MIME 白名单不含 yaml → 现实恒失败，调用方须兜底降级。
   */
  const probeDecks = useCallback(
    async (packRoot: string): Promise<DeckEntry[]> => {
      const res = await track("POST /v1/files/read", "path=deck.yaml（牌堆清单探测）", () =>
        client.filesRead(packRoot, "deck.yaml"),
      );
      const parsed = parseRootDeckYaml(base64ToUtf8(res.base64));
      const entries: DeckEntry[] = parsed.map((d) => ({
        deckKey: d.deckKey,
        name: d.deckKey,
        backUrl: d.backUrl,
      }));
      return entries.length > 0 ? entries : [placeholderDeck()];
    },
    [client, track],
  );

  // ---- 挂载：packs → 选第一个 → 探测牌堆清单 ----
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
        try {
          const entries = await probeDecks(pack.dir);
          if (cancelled) return;
          setDecks(entries);
        } catch {
          // 降级路径（任务书）：root/deck.yaml 不存在 / MIME 白名单拒绝 → 占位牌堆
          if (!cancelled) setDecks([placeholderDeck()]);
        }
        if (!cancelled) setLastProbeAt(Date.now());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, track, probeDecks]);

  // ---- 选中同步：自动选第一个；选中项被清单刷新移除时回退到第一个 ----
  useEffect(() => {
    if (decks.length === 0) return;
    if (activeDeckKey === null || !decks.some((d) => d.deckKey === activeDeckKey)) {
      setActiveDeckKey(decks[0].deckKey);
    }
  }, [decks, activeDeckKey]);

  // ---- 切换牌堆：重置网格 / 选中 / 卡背（切片回填不换 key，不触发本 effect） ----
  useEffect(() => {
    setDims({ ...DEFAULT_SHEET });
    setSheetUrl(null);
    setCards([]);
    setFilled(undefined);
    setSelectedIndex(null);
    setRealDeckKey(null);
    setBackBase64(undefined);
    setBackMime(undefined);
    setBackError(undefined);
    setBackLoading(false);
    setNote(null);
  }, [activeDeckKey]);

  const activeDeck = useMemo<DeckEntry | null>(
    () => decks.find((d) => d.deckKey === activeDeckKey) ?? null,
    [decks, activeDeckKey],
  );
  const backUrl = activeDeck?.backUrl;

  // ---- 卡背取数：deck.backUrl（本地路径 filesRead + fileCache；http(s) 浏览器直取）----
  useEffect(() => {
    if (backUrl === undefined || backUrl === "") {
      setBackBase64(undefined);
      setBackMime(undefined);
      setBackError(undefined);
      setBackLoading(false);
      return;
    }
    if (/^https?:\/\//i.test(backUrl) === false) {
      // 本地路径：必须经 hub filesRead（root 缺失 / 版本不足 → 提示，不发请求）
      if (root === null || !caps.canReadFiles) {
        setBackError(
          root === null
            ? "未连接图包（root 缺失），卡背不可读。"
            : "hub 无 /v1/files/read 路由（需 ≥ 0.8.0），卡背不可读。",
        );
        setBackLoading(false);
        return;
      }
      const packRoot = root;
      const path = backUrl;
      const hit = getCachedFile(packRoot, path);
      if (hit !== undefined) {
        setBackBase64(hit.base64);
        setBackMime(hit.mime);
        setBackError(undefined);
        setBackLoading(false);
        return;
      }
      let cancelled = false;
      setBackLoading(true);
      setBackError(undefined);
      setBackBase64(undefined);
      void (async () => {
        try {
          const res = await track("POST /v1/files/read", `path=${path}（卡背）`, () =>
            client.filesRead(packRoot, path),
          );
          if (cancelled) return;
          setCachedFile(packRoot, path, res.base64, res.mime);
          setBackBase64(res.base64);
          setBackMime(res.mime);
        } catch (e) {
          if (!cancelled) setBackError(e instanceof Error ? e.message : String(e));
        } finally {
          if (!cancelled) setBackLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    // 远端 URL：浏览器直取（非 hub 调用，不经 JobTracker；CORS 失败 → 卡背错误态）
    let cancelledRemote = false;
    setBackLoading(true);
    setBackError(undefined);
    setBackBase64(undefined);
    void (async () => {
      try {
        const img = await fetchImageBase64(backUrl);
        if (cancelledRemote) return;
        setBackBase64(img.base64);
        setBackMime(img.mime);
      } catch (e) {
        if (!cancelledRemote) setBackError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelledRemote) setBackLoading(false);
      }
    })();
    return () => {
      cancelledRemote = true;
    };
  }, [activeDeckKey, backUrl, root, caps.canReadFiles, client, track]);

  // ---- SSE GameLoaded：静默重探牌堆清单（失败保持现列表：降级常态，不打扰） ----
  const lastLoadedTs = useMemo<number | null>(() => {
    for (let i = sseEvents.length - 1; i >= 0; i -= 1) {
      if (sseEvents[i].type === "loaded") return sseEvents[i].ts;
    }
    return null;
  }, [sseEvents]);

  useEffect(() => {
    if (lastLoadedTs === null || root === null) return;
    let cancelled = false;
    void probeDecks(root)
      .then((entries) => {
        if (!cancelled) {
          setDecks(entries);
          setLastProbeAt(Date.now());
        }
      })
      .catch(() => {
        /* 静默：清单探测失败保持现列表 */
      });
    return () => {
      cancelled = true;
    };
  }, [lastLoadedTs, root, probeDecks]);

  // ---- 派生：选中卡 / 死链态 / SheetMeta ----
  const selectedCard = useMemo<SliceCard | null>(
    () => cards.find((c) => c.i === selectedIndex) ?? null,
    [cards, selectedIndex],
  );

  const selectedCardDead = useMemo<boolean>(() => {
    const u = selectedCard?.faceUrl;
    return u !== undefined && deadUrls.has(u);
  }, [selectedCard, deadUrls]);

  const sheet = useMemo<SheetMeta | null>(() => {
    if (activeDeck === null) return null;
    return {
      url: sheetUrl ?? activeDeck.backUrl ?? `deck/${activeDeck.deckKey}`,
      w: dims.w,
      h: dims.h,
      cols: dims.cols,
      rows: dims.rows,
    };
  }, [activeDeck, sheetUrl, dims]);

  // ---- 按钮可用性（声明须先于引用它的 handleSliceRequest / handlePlan）----
  const canSlice =
    root !== null &&
    !busy &&
    activeDeck !== null &&
    !selectedCardDead &&
    sheetPath.trim() !== "" &&
    savePath.trim() !== "" &&
    outDir.trim() !== "";
  const canPlan =
    root !== null && !busy && savePath.trim() !== "" && planFrom.trim() !== "" && planTo.trim() !== "";

  // ---- 切片：确认门会签 → deckSlice → SliceResult 回填（网格 / 卡片 / 卡背 / 元信息）----
  const runSlice = useCallback(async (): Promise<void> => {
    if (root === null || activeDeck === null) return;
    const sp = sheetPath.trim();
    const sv = savePath.trim();
    const od = outDir.trim();
    if (sp === "" || sv === "" || od === "") return; // canSlice 已拦，双保险
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      // 占位牌堆无真实 key：省略 deckKey 让 hub 自动解析（多候选时 hub 报
      // SLICE_AMBIGUOUS 提示消歧）；切片过一次后 realDeckKey 已回填。
      const res = await track(
        "POST /v1/deck/slice",
        `deck=${realDeckKey ?? "自动"} · sheet=${sp} · out=${od}`,
        () =>
          client.deckSlice({
            sheetPath: sp,
            savePath: sv,
            outDir: od,
            ...(realDeckKey !== null ? { deckKey: realDeckKey } : {}),
          }),
      );
      const sum = readSliceResult(res);
      if (sum === null) {
        setNote("切片完成，但响应不是 SliceResult 形，网格未回填。");
        return;
      }
      const deckKeyNow = activeDeck.deckKey;

      // 1) 元信息回填：真实 deckKey / 显示名（nickname） / 卡数；卡背走 backFiles[0]
      setRealDeckKey(sum.deckKey ?? realDeckKey);
      setDecks((prev) =>
        prev.map((d) =>
          d.deckKey !== deckKeyNow
            ? d
            : {
                ...d,
                name: sum.nickname ?? sum.deckKey ?? d.name,
                cardCount: sum.cardsSliced,
                ...(sum.backFiles.length > 0
                  ? { backUrl: joinPath(od, sum.backFiles[0]) }
                  : {}),
              },
        ),
      );

      // 2) 网格兜底（cards.csv 不可用时）：DeckCandidate 声明的列/行 + faceUrl
      const applyDeckDims = (): void => {
        setDims((prev) => ({
          w: prev.w,
          h: prev.h,
          cols: sum.numWidth ?? prev.cols,
          rows: sum.numHeight ?? prev.rows,
        }));
        if (sum.faceUrl !== undefined) setSheetUrl(sum.faceUrl);
      };

      // 3) cards.csv 回填（契约 cards.csv.md：slot 1 基 → i 0 基；sheet_id=1 优先）
      if (sum.cardsCsvPath !== undefined && caps.canReadFiles) {
        const csvPath = sum.cardsCsvPath;
        try {
          const csvRes = await track(
            "POST /v1/files/read",
            `path=${csvPath}（cards.csv 回填）`,
            () => client.filesRead(root, csvPath),
          );
          const rows = parseCardsCsv(base64ToUtf8(csvRes.base64));
          const onSheet1 = rows.filter((r) => r.sheetId === 1);
          const group = onSheet1.length > 0 ? onSheet1 : rows;
          if (group.length > 0) {
            const g0 = group[0];
            setDims((prev) => ({ w: prev.w, h: prev.h, cols: g0.sheetCols, rows: g0.sheetRows }));
            if (g0.sheetSource !== "") setSheetUrl(g0.sheetSource);
            const nextCards: SliceCard[] = group.map((r) => ({
              i: r.slot - 1,
              face: joinPath(od, r.face),
              faceUrl: r.sheetSource !== "" ? r.sheetSource : undefined,
              name: r.name,
            }));
            setCards(nextCards);
            setFilled(new Set(nextCards.map((c) => c.i)));
            setSelectedIndex(null);
            setNote(
              `✓ 已切片 ${sum.cardsSliced} 卡，网格已按 cards.csv 回填（${g0.sheetCols}×${g0.sheetRows}）。`,
            );
          } else {
            applyDeckDims();
            setNote(`切片完成 ${sum.cardsSliced} 卡，但 cards.csv 无有效行，网格未回填。`);
          }
        } catch (e) {
          applyDeckDims();
          const msg = e instanceof Error ? e.message : String(e);
          setNote(`切片完成 ${sum.cardsSliced} 卡；cards.csv 回填失败：${msg}`);
        }
      } else {
        applyDeckDims();
        if (sum.cardsCsvPath === undefined) {
          setNote(`切片完成 ${sum.cardsSliced} 卡（响应无 cardsCsvPath，网格未回填）。`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [root, activeDeck, sheetPath, savePath, outDir, realDeckKey, caps.canReadFiles, client, track]);

  /** 切片入口：ask() 打开 App.tsx 顶层的全站唯一 ConfirmGate（红线 1） */
  const handleSliceRequest = useCallback((): void => {
    if (root === null || activeDeck === null || !canSlice) return;
    setError(null);
    ask({
      title: "切片牌堆",
      items: [{ file: `deck/${activeDeck.deckKey}`, diff: "✂" }],
      ackLabel: "我已知晓，开始切片",
      onConfirm: runSlice,
    });
  }, [root, activeDeck, canSlice, ask, runSlice]);

  // ---- 替换预览：deckPlan dry-run（只读，不经确认门）；结果只展示不执行 ----
  const handlePlan = useCallback(async (): Promise<void> => {
    if (root === null) return;
    const sv = savePath.trim();
    const from = planFrom.trim();
    const to = planTo.trim();
    if (sv === "" || from === "" || to === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await track("POST /v1/deck/plan", `save=${sv} · from=${from} → to=${to}`, () =>
        client.deckPlan({ savePath: sv, rules: [{ from, to }] }),
      );
      const pretty = JSON.stringify(res, null, 2) ?? "undefined";
      setPlanResult(pretty.length > 4000 ? `${pretty.slice(0, 4000)}\n…（已截断）` : pretty);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [root, savePath, planFrom, planTo, client, track]);

  const rootBase = root === null ? "—" : root.split(/[\\/]/).filter(Boolean).pop() ?? root;

  /** 工作区上半：切片网格（无牌堆 / 未连接时给空态） */
  const renderSheet = (): ReactElement => {
    if (loading) return <div className="cards-empty">◌ 正在连接 hub 并探测牌堆清单…</div>;
    if (root === null) {
      return error !== null ? (
        <div className="cards-empty cards-empty-error">✗ {error}</div>
      ) : (
        <div className="cards-empty">— 未注册图包</div>
      );
    }
    if (sheet === null || activeDeck === null) {
      return <div className="cards-empty">— 无牌堆</div>;
    }
    return (
      <div className="cards-sheetwrap">
        <SliceGrid
          sheet={sheet}
          cards={cards}
          filled={filled}
          selectedIndex={selectedIndex ?? undefined}
          deadLinkSet={deadUrls}
          onSelect={setSelectedIndex}
        />
      </div>
    );
  };

  return (
    <div className="route-slide">
      <div className="cards-layout">
        {/* 对象区：牌堆列表（上） + 卡背预览（下） */}
        <aside className="cards-obj">
          <div className="cards-obj-list">
            <DeckList
              decks={decks}
              activeDeckKey={activeDeckKey ?? undefined}
              onSelect={setActiveDeckKey}
            />
          </div>
          <div className="cards-obj-back">
            <div className="cards-obj-backlabel">卡背</div>
            <CardBackPreview
              deck={activeDeck ?? undefined}
              imageBase64={backBase64}
              mime={backMime}
              loading={backLoading}
              error={backError}
            />
          </div>
        </aside>

        {/* 工作区：切片网格（上） + 卡面预览（下） */}
        <main className="cards-work">
          {renderSheet()}
          <CardFacePreview card={selectedCard ?? undefined} root={root} />
        </main>

        {/* 参数标注区：元信息 + 切片参数 + 替换预览 + 操作 */}
        <aside className="cards-param">
          <div className="cards-param-title">参数标注</div>
          <dl className="cards-meta">
            <div>
              <dt>图包</dt>
              <dd title={root ?? undefined}>{packName ?? rootBase}</dd>
            </div>
            <div>
              <dt>牌堆</dt>
              <dd>{activeDeck?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>deckKey</dt>
              <dd title={realDeckKey ?? undefined}>{realDeckKey ?? "自动"}</dd>
            </div>
            <div>
              <dt>卡数</dt>
              <dd className="tnum">{cards.length}</dd>
            </div>
            <div>
              <dt>选中</dt>
              <dd className="tnum">{selectedIndex !== null ? `#${selectedIndex}` : "—"}</dd>
            </div>
            <div>
              <dt>网格</dt>
              <dd className="tnum">
                {dims.cols}×{dims.rows}
              </dd>
            </div>
            <div>
              <dt>探测</dt>
              <dd className="tnum">{fmtClock(lastProbeAt)}</dd>
            </div>
            <div>
              <dt>文件路由</dt>
              <dd
                data-tone={filesOk ? "ok" : "red"}
                title={filesOk ? undefined : "POST /v1/files/read 需要 hub ≥ 0.8.0"}
              >
                {filesOk ? "可用" : "不可用"}
              </dd>
            </div>
          </dl>
          {note !== null && <div className="cards-note">{note}</div>}
          {selectedCardDead && (
            <div className="cards-deadwarn" role="alert">
              ✗ 当前卡为死链，请先去 ④ 素材面体检
            </div>
          )}
          {error !== null && root !== null && (
            <div className="cards-error" role="alert">
              ✗ {error}
            </div>
          )}

          <div className="cards-fields">
            <label className="cards-field">
              <span className="cards-fieldlabel">图集 sheetPath（绝对路径）</span>
              <input
                className="cards-input"
                value={sheetPath}
                onChange={(e) => setSheetPath(e.target.value)}
                placeholder="D:/packs/<pack>/decks/<deck>/atlas.png"
                spellCheck={false}
              />
            </label>
            <label className="cards-field">
              <span className="cards-fieldlabel">存档 savePath（切片 / 替换共用）</span>
              <input
                className="cards-input"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="D:/TTS/Saves/<save>.json"
                spellCheck={false}
              />
            </label>
            <label className="cards-field">
              <span className="cards-fieldlabel">输出目录 outDir（deck 目录）</span>
              <input
                className="cards-input"
                value={outDir}
                onChange={(e) => setOutDir(e.target.value)}
                placeholder="D:/packs/<pack>/decks/<deck>"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="cards-acts">
            <button
              type="button"
              className="cards-btn cards-btn-danger"
              disabled={!canSlice}
              onClick={handleSliceRequest}
            >
              切片牌堆
            </button>
          </div>

          <div className="cards-fields">
            <label className="cards-field">
              <span className="cards-fieldlabel">替换 from（原 URL）</span>
              <input
                className="cards-input"
                value={planFrom}
                onChange={(e) => setPlanFrom(e.target.value)}
                placeholder="https://old.example.com/a.png"
                spellCheck={false}
              />
            </label>
            <label className="cards-field">
              <span className="cards-fieldlabel">替换 to（新 URL）</span>
              <input
                className="cards-input"
                value={planTo}
                onChange={(e) => setPlanTo(e.target.value)}
                placeholder="https://new.example.com/a.png"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="cards-acts">
            <button
              type="button"
              className="cards-btn"
              disabled={!canPlan}
              onClick={() => void handlePlan()}
            >
              替换预览（dry-run）
            </button>
          </div>
          {planResult !== null && <pre className="cards-plan">{planResult}</pre>}

          <div className="cards-param-note">
            切片 = 确认门会签 → POST /v1/deck/slice（写 outDir 与 cards.csv，网格按 cards.csv
            回填）；替换预览 = POST /v1/deck/plan（dry-run，不落盘）。
          </div>
        </aside>
      </div>
    </div>
  );
}

/** ③ 卡牌面路由：SSE 订阅由 App.tsx 顶层 SseProvider 提供（红线 3），本面只消费 */
export default function Cards(): ReactElement {
  return <CardsInner />;
}
