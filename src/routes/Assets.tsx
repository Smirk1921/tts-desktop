/**
 * ④ 素材面 — Stage B2 路由组装（UI-3 窗口）
 *
 * 职责：把 Stage A 展示组件（AssetsGroupNav / AssetsTable）组装为 round-03 §3.1
 * 三区骨架——对象区（类型分组）/ 工作区（台账表格，>500 行自动虚拟化）/
 * 参数标注区（数据源状态 + 体检 / 导入 / 保存）。数据流全部经 hub，每次调用
 * 经 useJobTracker().track 登记 Job（tool 名一律 HTTP 路由形态，红线 §10）：
 *   GET  /v1/packs        → 取第一个注册图包作为 root
 *   POST /v1/files/read   → 读 cards.csv（base64 → UTF-8）→ AssetRow[]
 *   PUT  /v1/files/write  → 保存（baseSha256 乐观锁；409 HUB_CONFLICT → 顶部冲突条）
 *   POST /v1/assets/check → 批量体检（URL 去重 + 分块，见 CHECK_CHUNK 注释）
 *   POST /v1/import       → 导入（dry-run 在 ImportPreviewDialog；真导入过确认门）
 *   SSE  loaded           → 游戏重载后静默刷新 rows（有未保存改动时不刷，防丢编辑）
 *
 * cards.csv 形态识别（表头驱动，防误写真实数据）：
 *  - 台账表头 id,group,field,url,source（mockCardsCsv 生成器同款）→ 完整读写，
 *    保存按原表头回写（escapeCsvField 与 parseCsv 转义互逆，round-trip 稳定）；
 *  - deck 契约表头 card_id,face,back,name,…（cards.csv.md §3 十列，face 是相对
 *    deck 目录的文件名而非 URL）→ 只读视图（card_id→id / face→url），保存禁用：
 *    台账五行回写会毁掉其余七列契约字段；
 *  - 文件不存在（hub 400 HUB_BAD_REQUEST "file not found"）或 hub < 0.8.0 无
 *    /v1/files 路由 → 降级 generateMockCardsCsv(3500 行 / 5% 死链) + 琥珀色
 *    "当前为 mock 数据"提示，编辑与保存禁用（把 mock 行写进真实图包等于伪造台账）。
 *
 * 保存基线（乐观锁）：取 filesRead 响应 base64 的摘要（Code.tsx handleSelect
 * 同款 sha256Hex(res.base64)）——对"将写入文本"自算 sha 得到的是与盘上无关的值，
 * 服务端与盘上字节比对必然 409；写入成功后以响应 sha256 滚动为新基线。
 *
 * 批量体检分块：HubClient HTTP 超时固定 10s（client.ts DEFAULT_TIMEOUT_MS，本窗口
 * 不可改），3500 条一次调用必然整体超时；hub 并发池缺省 8（check.ts）。取
 * CHECK_CHUNK=24 × 单 URL 超时 2.5s → 最坏一块 ≈ ⌈24/8⌉×2.5s = 7.5s < 10s；
 * 分块串行、逐块归并（行状态即时落表），任意一块失败不影响已完成块的结果。
 *
 * 确认门（红线 1/2）：真导入经 useConfirmGate().ask 打开 App.tsx 顶层唯一
 * ConfirmGate，本面不渲染 <ConfirmGate>。对话框「确认导入」→ 父组件
 * handleConfirmImport 登记 ask 后立即 resolve——ask 无完成回调可 await（拒签
 * 不可观测），若等真导入 resolve，用户「拒签」会让对话框永远悬在"◌ 处理中"；
 * 对话框关闭后确认门在顶层接管（z-index 100 > 对话框 90），导入结果落参数区。
 *
 * 死链联动（Stage C 已接通真 store）：体检完成后把 status==="dead" 的 url
 * markBatch 上报到 DeadLinkContext（App.tsx 顶层 Provider；③ 卡牌面与
 * LayerNav ③④ dot 同源消费）；deadUrls 与本地体检结果取并集驱动分组导航
 * 死链计数（✗N）与参数区死链数。
 *
 * 符号（红线 §10 字符集）：✗ 死链 / ✓ 存活 / ● 已改未提交（表格内由
 * AssetsTable data-dirty 渲染）/ ◌ 进行中（Code/Agent/AssetsTable 三面同款，
 * LegendBar 未注册——A3 已报备，Stage C 注册或替换）/ ⚠ 警告（ConfirmGate
 * warn 框同款）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import AssetsGroupNav from "../components/AssetsGroupNav";
import type { AssetGroupCount } from "../components/AssetsGroupNav";
import AssetsTable from "../components/AssetsTable";
import type { AssetRow } from "../components/AssetsTable";
import ImportPreviewDialog from "../components/ImportPreviewDialog";
import { RouteSlide } from "../components/RouteSlide";

import { useConfirmGate, useHub, type ConfirmRequest } from "../hub/HubContext";
import { useSseEvents } from "../hub/useSseEvents";
import { useJobTracker } from "../hub/useJobTracker";
import { sha256Hex } from "../hub/sha256";
import { isHubError } from "../hub/errors";
import { generateMockCardsCsv, parseMockCsvToAssetRows } from "../utils/mockCardsCsv";
import { useDeadLinks } from "../state/DeadLinkContext";

import "./routes.css";
import "./Assets.css";

// ---- 常量 ----

/** 台账表头（本面自有读写格式，与 utils/mockCardsCsv 生成器一致） */
const LEDGER_HEADER = "id,group,field,url,source";

/** deck 契约表头（tts-toolkit docs/schemas/cards.csv.md §3 十列，列序写死） */
const CARDS_CONTRACT_HEADER =
  "card_id,face,back,name,nickname,sheet_id,slot,sheet_cols,sheet_rows,sheet_source";

/** mock 降级行数 / 死链比例（施工方案 §10.4：3,500 行 ≥ 3,000+ 压测口径） */
const MOCK_ROWS = 3500;
const MOCK_DEAD_RATIO = 0.05;

/**
 * 体检分块大小与单 URL 超时（推导见文件头「批量体检分块」注释）：
 * HubClient HTTP 超时 10s 固定，hub 并发池缺省 8，最坏一块 ⌈24/8⌉×2.5s=7.5s<10s。
 */
const CHECK_CHUNK = 24;
const CHECK_TIMEOUT_MS = 2500;

// ---- 类型 ----

/** packs() 注册表里的一条图包（只取本面用到的字段） */
interface PackMeta {
  dir: string;
  name?: string;
}

/** /v1/assets/check 单条结果（hub CheckSummary.results 元素，契约 §4.5） */
interface UrlCheckResult {
  url: string;
  alive: boolean;
  /** 无响应（超时/网络错误）时为 0 */
  status: number;
  error?: string;
}

/** cards.csv 形态：ledger=台账可读写 / cards-view=deck 契约十列只读视图 / none=未识别 */
type CsvFormat = "ledger" | "cards-view" | "none";

// ---- CSV 基础（读侧 RFC4180-lite / 写侧转义，二者互逆） ----

/**
 * 极简 CSV 解析（引号字段 / "" 转义 / \r\n 与裸 \r 收行；deck 契约允许 name
 * 含逗号引号，台账 URL 亦可能含逗号，故不用裸 split）。
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      endRow();
    } else if (c === "\r") {
      endRow(); // 裸 \r 也按行尾
      if (text[i + 1] === "\n") {
        i += 1; // \r\n：连带吃掉 \n（体 +1、循环 update +1，共越过两字符）
      }
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) endRow(); // 末尾无换行收尾
  return rows;
}

/** CSV 字段转义：含逗号/引号/换行时加引号（写侧；读侧 parseCsv 对应还原） */
function escapeCsvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 去除 UTF-8 BOM（hub 读侧原样返回文件字节，手写文件可能带 BOM） */
function stripBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/** base64 → UTF-8 文本（atob 逐字节展开后经 TextDecoder，中文不乱码；同 Code.tsx） */
function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** AssetRow[] → 台账 CSV 文本（表头 + 数据行；escapeCsvField 与 parseCsv 互逆） */
function serializeLedgerCsv(rows: AssetRow[]): string {
  const lines = [LEDGER_HEADER];
  for (const r of rows) {
    lines.push(
      [r.id, r.group, r.field, r.url, r.source].map(escapeCsvField).join(","),
    );
  }
  return lines.join("\n");
}

// ---- hub 响应防御解析（client 各方法返回 unknown，同 Code.tsx readFirstPack 范式） ----

/** 从 packs() 响应取第一个注册图包 */
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

/** 从 /v1/assets/check 响应取 results[]，按 url 建 Map（重复 url 以末条为准） */
function readCheckResults(res: unknown): Map<string, UrlCheckResult> {
  const map = new Map<string, UrlCheckResult>();
  const results = (res as { results?: unknown }).results;
  if (!Array.isArray(results)) return map;
  for (const it of results) {
    if (it === null || typeof it !== "object") continue;
    const o = it as { url?: unknown; alive?: unknown; status?: unknown; error?: unknown };
    if (typeof o.url !== "string" || o.url === "") continue;
    map.set(o.url, {
      url: o.url,
      alive: o.alive === true,
      status: typeof o.status === "number" ? o.status : 0,
      error: typeof o.error === "string" ? o.error : undefined,
    });
  }
  return map;
}

/** 真导入响应 → 一行摘要（ImportResult.decks / objects / warnings 计数） */
function readImportSummary(res: unknown): string {
  const r = (res ?? {}) as { decks?: unknown; objects?: unknown; warnings?: unknown };
  const decks = Array.isArray(r.decks) ? r.decks.length : 0;
  const objects = Array.isArray(r.objects) ? r.objects.length : 0;
  const warns = Array.isArray(r.warnings) ? r.warnings.length : 0;
  return `✓ 导入完成：卡堆 ${decks} · 素材对象 ${objects}${warns > 0 ? ` · 警告 ${warns} 条` : ""}`;
}

/** 时间戳 → HH:MM:SS（参数标注区"体检 / 保存"行） */
function fmtClock(ts: number | null): string {
  if (ts === null) return "—";
  const d = new Date(ts);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function AssetsInner(): ReactElement {
  const { client, caps } = useHub();
  const { events: sseEvents } = useSseEvents();
  const { track } = useJobTracker();
  const { ask } = useConfirmGate();
  const { deadUrls: storeDeadUrls, markBatch } = useDeadLinks();

  // ---- 数据状态 ----
  const [root, setRoot] = useState<string | null>(null);
  const [packName, setPackName] = useState<string | null>(null);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [format, setFormat] = useState<CsvFormat>("none");
  const [isMock, setIsMock] = useState(false);
  const [sourceNote, setSourceNote] = useState<string | null>(null);
  /** 保存乐观锁基线（filesRead 响应 base64 的 sha256；mock / 只读视图为 null） */
  const [baselineSha, setBaselineSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [checkAt, setCheckAt] = useState<number | null>(null);
  const [saveAt, setSaveAt] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // ---- 界面状态 ----
  const [activeGroup, setActiveGroup] = useState<string | undefined>(undefined);
  const [manifestPath, setManifestPath] = useState("import.yaml");
  const [importOpen, setImportOpen] = useState(false);

  /** 体检轮次序号：新一轮启动后，旧一轮的迟归块全部作废 */
  const checkSeqRef = useRef(0);

  const filesOk = caps.canReadFiles && caps.canWriteFiles;
  /** 仅台账形态可编辑/保存：mock（无真实文件）与 deck 契约视图（回写毁列）都只读 */
  const writable = format === "ledger" && !isMock;

  /** applyMock：mock 降级（无基线 → 编辑/保存禁用，仅浏览 + 体检） */
  const applyMock = useCallback((note: string): void => {
    const csv = generateMockCardsCsv({ rows: MOCK_ROWS, deadRatio: MOCK_DEAD_RATIO });
    setRows(parseMockCsvToAssetRows(csv));
    setFormat("ledger");
    setIsMock(true);
    setSourceNote(note);
    setBaselineSha(null);
    setConflict(false);
    setActiveGroup(undefined);
  }, []);

  /** 读 cards.csv → rows。silent=true（SSE 刷新 / 导入后刷新）不动 loading、失败不上墙 */
  const loadRows = useCallback(
    async (packRoot: string, opts?: { silent?: boolean }): Promise<void> => {
      const silent = opts?.silent === true;
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        if (!caps.canReadFiles) {
          // hub < 0.8.0：无 /v1/files/* → mock 降级（amber 提示写明原因）
          applyMock(`hub ${caps.version} 无 /v1/files 路由（需 ≥ 0.8.0），当前为 mock 数据`);
          return;
        }
        const res = await track("POST /v1/files/read", `root=${packRoot} · path=cards.csv`, () =>
          client.filesRead(packRoot, "cards.csv"),
        );
        const sha = await sha256Hex(res.base64);
        const text = base64ToUtf8(res.base64);
        const table = parseCsv(stripBom(text)).filter((r) => r.some((f) => f.trim() !== ""));
        const header = (table[0] ?? []).map((f) => f.trim()).join(",");
        if (header === LEDGER_HEADER) {
          // 台账形态：五列一一对应 AssetRow，可读写（round-trip 稳定）
          const parsed: AssetRow[] = table.slice(1).map((f) => ({
            id: f[0] ?? "",
            group: f[1] ?? "",
            field: f[2] ?? "",
            url: f[3] ?? "",
            source: f[4] ?? "",
          }));
          setRows(parsed);
          setFormat("ledger");
          setIsMock(false);
          setSourceNote(null);
          setBaselineSha(sha);
          setConflict(false);
          setActiveGroup(undefined);
        } else if (header === CARDS_CONTRACT_HEADER) {
          // deck 契约十列：只读视图（一行 = 一张卡，face 是相对 deck 目录的文件名）
          const parsed: AssetRow[] = table.slice(1).map((f) => ({
            id: f[0] ?? "",
            group: "card",
            field: "face",
            url: f[1] ?? "",
            source: "cards.csv",
          }));
          setRows(parsed);
          setFormat("cards-view");
          setIsMock(false);
          setSourceNote(
            "cards.csv 为 deck 契约格式（十列，face 为文件名）：本面仅读，保存已禁用（台账五行回写会丢失其余列）",
          );
          setBaselineSha(null);
          setConflict(false);
          setActiveGroup(undefined);
        } else {
          setRows([]);
          setFormat("none");
          setIsMock(false);
          setSourceNote(null);
          setBaselineSha(null);
          setError(`cards.csv 表头未识别：${header !== "" ? header : "（空文件）"}`);
        }
      } catch (e) {
        if (isHubError(e) && e.code === "HUB_BAD_REQUEST" && e.message.startsWith("file not found")) {
          // cards.csv 不存在 → mock 降级（hub files/read 对 ENOENT 返回 400
          // HUB_BAD_REQUEST "file not found: …"，见 hub control.ts asFileAccessError）
          applyMock("当前为 mock 数据（cards.csv 未找到）");
          return;
        }
        if (!silent) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [caps.canReadFiles, caps.version, client, track, applyMock],
  );

  // ---- 挂载：packs → 选第一个 → 读 cards.csv ----
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
          setLoading(false);
          return;
        }
        setRoot(pack.dir);
        setPackName(pack.name ?? null);
        await loadRows(pack.dir);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, track, loadRows]);

  // ---- SSE loaded：游戏重载 → 静默刷新 rows（仅对新到事件；有脏行不刷防丢编辑） ----
  const lastLoadedTs = useMemo<number | null>(() => {
    for (let i = sseEvents.length - 1; i >= 0; i -= 1) {
      if (sseEvents[i].type === "loaded") return sseEvents[i].ts;
    }
    return null;
  }, [sseEvents]);
  const hasDirty = useMemo(() => rows.some((r) => r.dirty === true), [rows]);
  const prevLoadedTsRef = useRef<number | null>(null);
  // 脏行标记渲染期同步进 ref（useSseEvents maxRef 同款范式）：loaded 回调读最新值，
  // 而不必把 hasDirty 放进 effect 依赖（否则行编辑本身也会触发一次静默刷新）
  const hasDirtyRef = useRef(false);
  hasDirtyRef.current = hasDirty;

  useEffect(() => {
    const prev = prevLoadedTsRef.current;
    prevLoadedTsRef.current = lastLoadedTs;
    if (lastLoadedTs === null || root === null) return;
    if (prev === lastLoadedTs) return; // 只响应新到的 loaded 事件（行编辑导致的重跑不算）
    if (hasDirtyRef.current) return; // 有未保存改动：不自动刷，改动走保存/409 冲突条
    void loadRows(root, { silent: true });
  }, [lastLoadedTs, root, loadRows]);

  // ---- 行内编辑：改 url → dirty + 体检结果作废（URL 已变，旧结论不再适用） ----
  const handleCellEdit = useCallback(
    (rowId: string, field: "url", next: string): void => {
      // 只读形态不受理（AssetsTable 无 readOnly prop，提交在此拦截）；
      // 空串提交拒绝（AssetRowEditor trim 后空串会原样上抛——A3 备注）
      if (!writable || field !== "url" || next === "") return;
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? { ...r, url: next, dirty: true, status: "unknown", statusMessage: undefined }
            : r,
        ),
      );
    },
    [writable],
  );

  // ---- 保存：filesWrite（baseSha256 乐观锁）；409 → 顶部冲突条 ----
  const handleSave = useCallback(async (): Promise<void> => {
    if (root === null || !writable) return;
    setBusy(true);
    setError(null);
    try {
      const csvText = serializeLedgerCsv(rows);
      const res = await track(
        "PUT /v1/files/write",
        `path=cards.csv · ${rows.length} 行`,
        () => client.filesWrite(root, "cards.csv", csvText, baselineSha ?? undefined),
      );
      // 写入响应自带 sha256（服务端对落盘字节的摘要），滚动为新基线
      setBaselineSha(res.sha256);
      setRows((prev) => prev.map((r) => ({ ...r, dirty: false })));
      setConflict(false);
      setSaveAt(Date.now());
      setStatusMsg(`✓ 已保存 cards.csv（${rows.length} 行）`);
    } catch (e) {
      if (isHubError(e) && e.code === "HUB_CONFLICT") {
        setConflict(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }, [root, writable, rows, baselineSha, client, track]);

  /** 冲突条「强制覆盖」：不带 baseSha256 绕过乐观锁（用户显式选择） */
  const handleForceOverwrite = useCallback(async (): Promise<void> => {
    if (root === null || !writable) return;
    setBusy(true);
    setError(null);
    try {
      const csvText = serializeLedgerCsv(rows);
      const res = await track(
        "PUT /v1/files/write",
        `path=cards.csv（强制覆盖）· ${rows.length} 行`,
        () => client.filesWrite(root, "cards.csv", csvText),
      );
      setBaselineSha(res.sha256);
      setRows((prev) => prev.map((r) => ({ ...r, dirty: false })));
      setConflict(false);
      setSaveAt(Date.now());
      setStatusMsg(`✓ 已强制覆盖 cards.csv（${rows.length} 行）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [root, writable, rows, client, track]);

  // ---- 批量体检：URL 去重 → 分块串行 → 逐块归并 → 死链上报 ----
  const handleCheck = useCallback(async (): Promise<void> => {
    if (root === null || rows.length === 0 || busy) return;
    const seq = checkSeqRef.current + 1;
    checkSeqRef.current = seq;
    // 去重（同 URL 多行共享一次体检），空 URL 跳过
    const urls = Array.from(new Set(rows.map((r) => r.url).filter((u) => u !== "")));
    if (urls.length === 0) {
      setStatusMsg("— 无 URL 可体检（全部为空）");
      return;
    }
    const chunks: string[][] = [];
    for (let i = 0; i < urls.length; i += CHECK_CHUNK) {
      chunks.push(urls.slice(i, i + CHECK_CHUNK));
    }
    setBusy(true);
    setError(null);
    setRows((prev) =>
      prev.map((r) => (r.url === "" ? r : { ...r, status: "checking", statusMessage: undefined })),
    );
    let alive = 0;
    let dead = 0;
    const deadUrlList = new Set<string>();
    try {
      for (let i = 0; i < chunks.length; i += 1) {
        const chunkUrls = chunks[i];
        const res = await track(
          "POST /v1/assets/check",
          `体检 ${i + 1}/${chunks.length} · ${chunkUrls.length} url`,
          () => client.assetsCheck(chunkUrls, CHECK_TIMEOUT_MS),
        );
        if (checkSeqRef.current !== seq) return; // 已有新一轮体检启动，本轮结果作废
        const resultMap = readCheckResults(res);
        setRows((prev) =>
          prev.map((r) => {
            const hit = resultMap.get(r.url);
            if (hit === undefined) return r;
            if (hit.alive) return { ...r, status: "ok", statusMessage: undefined };
            return { ...r, status: "dead", statusMessage: hit.error ?? `HTTP ${hit.status}` };
          }),
        );
        for (const hit of resultMap.values()) {
          if (hit.alive) {
            alive += 1;
          } else {
            dead += 1;
            deadUrlList.add(hit.url);
          }
        }
      }
      if (checkSeqRef.current !== seq) return;
      // 收尾：响应未覆盖的行（理论不发生）退回 unknown，不悬在 checking
      setRows((prev) =>
        prev.map((r) => (r.status === "checking" ? { ...r, status: "unknown" } : r)),
      );
      // 死链上报 → DeadLinkContext（App.tsx 顶层 store；③ 卡牌面 / ③④ dot 同源消费）
      markBatch(Array.from(deadUrlList));
      setCheckAt(Date.now());
      setStatusMsg(`✓ 体检完成：${urls.length} 条 URL · 存活 ${alive} · 死链 ${dead}`);
    } catch (e) {
      if (checkSeqRef.current !== seq) return;
      // 中途失败：已完成块的结果保留，未完成块退回 unknown
      setRows((prev) =>
        prev.map((r) => (r.status === "checking" ? { ...r, status: "unknown" } : r)),
      );
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (checkSeqRef.current === seq) {
        setBusy(false);
      }
    }
  }, [root, rows, busy, client, track, markBatch]);

  // ---- 导入：真导入在确认门 onConfirm 内执行，失败原样抛（ConfirmGate 错误条可重试） ----
  const runImport = useCallback(async (): Promise<void> => {
    if (root === null) return;
    const res = await track(
      "POST /v1/import",
      `root=${root} · manifest=${manifestPath} · dryRun=false`,
      () => client.importAssets(root, manifestPath, false),
    );
    await loadRows(root, { silent: true }); // 导入后刷新 rows（静默，失败不追导入错误）
    setStatusMsg(readImportSummary(res));
  }, [root, manifestPath, client, track, loadRows]);

  const importItems = useMemo<ConfirmRequest["items"]>(
    () => [{ file: manifestPath, diff: "写本地文件" }],
    [manifestPath],
  );

  /** 确认导入交接：登记确认门（ask）后立即 resolve——理由见文件头「确认门」注释 */
  const handleConfirmImport = useCallback(async (): Promise<void> => {
    ask({
      title: "确认导入素材",
      items: importItems,
      assetWarning: "导入仅写本地工作区；素材改动不随 POST /v1/push 生效。",
      onConfirm: runImport,
    });
  }, [ask, importItems, runImport]);

  // ---- 派生：分组计数 / 过滤行 / 汇总 ----
  const groups = useMemo<AssetGroupCount[]>(() => {
    const acc = new Map<string, { total: number; dead: number; dirty: number }>();
    for (const r of rows) {
      const g = acc.get(r.group) ?? { total: 0, dead: 0, dirty: 0 };
      g.total += 1;
      if (r.status === "dead" || storeDeadUrls.has(r.url)) g.dead += 1;
      if (r.dirty === true) g.dirty += 1;
      acc.set(r.group, g);
    }
    return Array.from(acc.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, v]) => ({
        group,
        total: v.total,
        dead: v.dead > 0 ? v.dead : undefined,
        dirty: v.dirty > 0 ? v.dirty : undefined,
      }));
  }, [rows, storeDeadUrls]);

  const visibleRows = useMemo(
    () => (activeGroup === undefined ? rows : rows.filter((r) => r.group === activeGroup)),
    [rows, activeGroup],
  );
  const deadCount = useMemo(
    () => rows.filter((r) => r.status === "dead" || storeDeadUrls.has(r.url)).length,
    [rows, storeDeadUrls],
  );
  const dirtyCount = useMemo(() => rows.filter((r) => r.dirty === true).length, [rows]);

  // ---- 按钮可用性 ----
  const canSave = root !== null && filesOk && writable && !busy && dirtyCount > 0;
  const canCheck = root !== null && !busy && rows.length > 0;
  const canImport = root !== null && !busy;

  const rootBase = root === null ? "—" : root.split(/[\\/]/).filter(Boolean).pop() ?? root;

  return (
    <RouteSlide>
      <div className="assets-layout">
        {/* 对象区：类型分组导航 */}
        <aside className="assets-obj">
          <AssetsGroupNav groups={groups} activeGroup={activeGroup} onSelect={setActiveGroup} />
        </aside>

        {/* 工作区：409 冲突条 + 台账表格 */}
        <main className="assets-work">
          {conflict && (
            <div className="assets-conflict" role="alert">
              <span className="assets-conflict-sym">✗</span>
              <span className="assets-conflict-text">
                文件已被外部修改（409 HUB_CONFLICT）：cards.csv
              </span>
              <button
                type="button"
                onClick={() => {
                  if (root !== null) void loadRows(root);
                }}
              >
                重新加载
              </button>
              <button type="button" onClick={() => void handleForceOverwrite()}>
                强制覆盖
              </button>
            </div>
          )}
          {loading ? (
            <div className="assets-empty">◌ 正在连接 hub 并读取 cards.csv…</div>
          ) : root === null ? (
            <div className={`assets-empty${error !== null ? " assets-empty-error" : ""}`}>
              {error !== null ? `✗ ${error}` : "— 未注册图包"}
            </div>
          ) : (
            <div className="assets-tablewrap">
              <AssetsTable rows={visibleRows} onCellEdit={handleCellEdit} />
            </div>
          )}
        </main>

        {/* 参数标注区：数据源状态 + 体检 / 导入 / 保存 */}
        <aside className="assets-param">
          <div className="assets-param-title">参数标注</div>
          <dl className="assets-meta">
            <div>
              <dt>图包</dt>
              <dd title={root ?? undefined}>{packName ?? rootBase}</dd>
            </div>
            <div>
              <dt>行数</dt>
              <dd className="tnum">{rows.length}</dd>
            </div>
            <div>
              <dt>死链</dt>
              <dd className="tnum" data-tone={deadCount > 0 ? "red" : undefined}>
                {deadCount}
              </dd>
            </div>
            <div>
              <dt>脏行</dt>
              <dd className="tnum" data-tone={dirtyCount > 0 ? "amber" : undefined}>
                {dirtyCount}
              </dd>
            </div>
            <div>
              <dt>体检</dt>
              <dd className="tnum">{fmtClock(checkAt)}</dd>
            </div>
            <div>
              <dt>保存</dt>
              <dd className="tnum">{fmtClock(saveAt)}</dd>
            </div>
            <div>
              <dt>文件路由</dt>
              <dd
                data-tone={filesOk ? "ok" : "red"}
                title={filesOk ? undefined : "/v1/files/* 需要 hub ≥ 0.8.0"}
              >
                {filesOk ? "可用" : "不可用"}
              </dd>
            </div>
          </dl>
          {sourceNote !== null && <div className="assets-mock" role="status">{sourceNote}</div>}
          {error !== null && root !== null && (
            <div className="assets-error" role="alert">
              ✗ {error}
            </div>
          )}
          {statusMsg !== null && <div className="assets-status">{statusMsg}</div>}
          <label className="assets-field">
            <span className="assets-field-label">导入清单 manifestPath</span>
            <input
              className="assets-input"
              type="text"
              value={manifestPath}
              onChange={(e) => setManifestPath(e.target.value)}
              spellCheck={false}
              aria-label="导入清单路径"
            />
          </label>
          <div className="assets-acts">
            <button
              type="button"
              className="assets-btn"
              disabled={!canCheck}
              onClick={() => void handleCheck()}
            >
              批量体检
            </button>
            <button
              type="button"
              className="assets-btn"
              disabled={!canImport}
              onClick={() => {
                setError(null);
                setImportOpen(true);
              }}
            >
              导入…
            </button>
            <button
              type="button"
              className="assets-btn"
              disabled={!canSave}
              title={writable ? undefined : "仅台账格式（id,group,field,url,source）可保存"}
              onClick={() => void handleSave()}
            >
              保存
            </button>
          </div>
          {/* 虚拟化遥测（Stage C 性能压测，施工方案 §10.4）：阈值 500 与 AssetsTable
           * 的 VIRTUAL_THRESHOLD 同值（该常量未导出，此处字面量 + 注释对齐）；行数取
           * visibleRows——表格实际收到的行集（分组过滤后小于总行数时如实反映开关态） */}
          <div className="assets-param-note">
            虚拟化: {visibleRows.length > 500 ? "on" : "off"} · {visibleRows.length} 行
          </div>
          <div className="assets-param-note">
            体检 = POST /v1/assets/check（去重分块）；保存 = PUT /v1/files/write（乐观锁，409 →
            冲突条）；导入 = POST /v1/import（dry-run 预览 → 确认门会签）。
          </div>
        </aside>
      </div>

      {/* 导入预览对话框（真导入经确认门：父组件 handleConfirmImport） */}
      <ImportPreviewDialog
        open={importOpen}
        root={root ?? ""}
        manifestPath={manifestPath}
        onClose={() => setImportOpen(false)}
        onConfirmImport={handleConfirmImport}
      />
    </RouteSlide>
  );
}

/** ④ 素材面路由：SSE 订阅由 App.tsx 顶层 SseProvider 提供（红线 3，本面不再兜底挂载） */
export default function Assets(): ReactElement {
  return <AssetsInner />;
}
