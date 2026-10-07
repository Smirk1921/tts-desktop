/**
 * processStamps — UI-4 Stage A3「状态引擎 + 脏通道」的状态引擎半边
 *
 * 唯一事实源：ui-design/round-03/UI施工方案.md §4.3（工序章）/ §4.4（会签栏）/
 * §3.1（⓪总览工作面）+ UI-4 锁定决策 2「出厂章与 SignBlock checks 同源」。
 *
 * 本模块三块职责：
 *  1. `useOverviewData(src)`：把 hub（GET /v1/packs、POST /v1/scripts/pull + /v1/diff、
 *     POST /v1/test/run）+ 全站死链 store（消费方经 src.deadUrls 传入）+ SSE 事件数组
 *     （src.sseEvents 传入）折算成 ⓪总览需要的 OverviewData（五章状态 / 待办行 / 四面磁贴）。
 *  2. `deriveMiniTree(root)`：⓪总览「工作区」迷你文件树的数据源（A1 版 MiniFileTreeProps
 *     的 nodes + note），与 ①代码面的 diff 同源（同一份条目的模块级缓存）。
 *  3. `deriveSignBlock(data)`：§4.4 会签栏交付清单数据源（出厂行与出厂章同源）。
 *
 * 五章状态推导（契约 §1 语义表，优先级 alert > doing > done > todo）：
 *   拉取 pull：root=null → todo「未注册」｜请求中 → doing「拉取中…」｜失败 → alert「拉取失败」
 *             ｜成功且有差异 → doing「N 件待写回」｜成功且无差异 → done「✓ 已同步」
 *   切片 slice：有切片活动 → doing「进行中」｜否则 → todo「未开始」
 *   拼版 compose：拉取未成功 → todo「待拉取」｜死链 > 0 → alert「N 死链」｜否则 → done「✓ 无死链」
 *   校样 proof：root=null → todo「未注册」｜请求中 → doing「校样中…」｜通过 → done「N/N ✓」
 *             ｜有用例未过 / 请求失败 → alert
 *   出厂 ship：root=null → todo「未注册」｜拉取未成功 → todo「待拉取」
 *             ｜有件待签 → todo「N 件待签」｜全部签出 → done「✓ 已会签」
 *
 * 实测偏差与工程选择（逐条与任务书/契约对齐后的判断，供下游与验收窗口核对）：
 *  - HubEvent 的导入路径：契约写「类型从 ../hub/useSseEvents 导入」，但 useSseEvents.ts
 *    只是 `import type { HubEvent } from "./sse"`（src/hub/useSseEvents.ts:24），并未 re-export，
 *    故此处从真正的定义处 `../hub/sse` 导入（同一类型身份，消费方传 useSseEvents().events 无需改动）。
 *  - 切片活动的检测：hub 的 POST /v1/deck/slice 是纯本地文件操作（tts-toolkit
 *    src/hub/control.ts:1276-1289 → sliceAtlas），不发任何 SSE 帧；SSE 只转发 TTS 入站
 *    messageID 1/2/3/4/6/7（src/hub/sse.ts:14-20）。因此契约的「SSE 会话期有 slice 活动」
 *    没有直接信号：本模块实现为 (a) 可选入参 src.sliceActive（消费方可显式上报，
 *    追加字段，非契约必需）(b) SSE 文案线索尽力检测（见 hasSliceActivity），
 *    两者都无 → todo「未开始」（诚实简化）。
 *  - cardCount / assetCount 恒 null：注册表（.registry.yaml）实际带 PackStats
 *    （tts-toolkit src/pack/registry.ts:103-115）与卡牌数，但按任务书本窗口不接③④面数据源，
 *    保持 null（LayerTiles 渲染为「—」）；素材行数无任何查询路由，确实不可得。
 *  - packVersion：.registry.yaml（PackEntry）与 pack.yaml 都没有 version 字段
 *    （src/pack/registry.ts:110-126、src/pack/packyaml.ts:105-135），故恒为 NO_VERSION「—」；
 *    此处保留对注册表条目可选 version 字段的前瞻探测，未来加字段即自动生效。
 *  - 「写回游戏成功」在 OverviewSource 里没有直接信号：出厂章以「拉取成功且 diff=0
 *    （工作区 == 游戏内）」等价于「全部签出」；SSE 的 saved（GameSaved）事件为潜在线索，
 *    刻意不用于避免误判（用户手动存档也会发）。
 *  - 失败不写结果缓存，但记 30s 节流窗（pullErrorAt / proofErrorAt）：pull 会覆盖工作区、
 *    testRun 会在真实游戏内跑测试，反复切换 ⓪ 面不应反复触发。
 *  - 拉取与校样串行执行：两条路由都经 hub 已绑定的编辑器端口 39998
 *    （tts-toolkit src/hub/control.ts:1342-1465 注入 daemon.server），并发交错风险不值当。
 *
 * 受控：本模块只读 hub 与入参，不写任何组件状态；root 为 null 时不发任何 hub 请求。
 */
import { useEffect, useMemo, useState } from "react";
import { useHub } from "../hub/HubContext";
import type { HubEvent } from "../hub/sse";
import type { TreeNode } from "../components/CodeFileTree";
import type { SignCheck } from "../components/SignBlock";

// ───────────────────────────── 契约类型（逐字） ─────────────────────────────

export type StampId = "pull" | "slice" | "compose" | "proof" | "ship";
export type StampStatus = "done" | "doing" | "alert" | "todo";

export interface StampState {
  id: StampId;
  name: string;
  status: StampStatus;
  note: string;
}

export type LayerId = "overview" | "code" | "agent" | "cards" | "assets";

export interface TodoItem {
  mark: string;
  color: "red" | "blue" | "amber" | "ok";
  text: string;
  target: LayerId;
}

export interface OverviewData {
  /** 恒 5 个，顺序 拉取→切片→拼版→校样→出厂 */
  stamps: StampState[];
  todos: TodoItem[];
  /** 与游戏内不同/未提交的文件数（①代码；拉取未知/失败时为 0） */
  diffCount: number;
  /** 死链总数（deadUrls.size，③④同源） */
  deadCount: number;
  /** 待会签件数（≈ diffCount） */
  pendingSign: number;
  /** SSE 事件数（②代理流水） */
  jobCount: number;
  /** 卡牌总数（③，未知为 null——见文件头） */
  cardCount: number | null;
  /** 素材行数（④，未知为 null——见文件头） */
  assetCount: number | null;
  /** 已注册图包名（无则 "（未注册图包）"） */
  packName: string;
  /** 图包版本（无则 "—"） */
  packVersion: string;
}

export interface OverviewSource {
  deadUrls: ReadonlySet<string>;
  sseEvents: HubEvent[];
  /** 图包根路径；null 表示无已注册图包（降级模式，不发起 hub 调用）。 */
  root: string | null;
  /**
   * 可选：切片活动显式上报（追加字段，非契约必需）。
   * hub 的 /v1/deck/slice 不发 SSE（见文件头），消费方（如③卡牌面切片进行中）可置 true
   * 让「切片」章进入 doing；缺省走 SSE 文案线索。
   */
  sliceActive?: boolean;
}

/** 无已注册图包时的图包名（契约「无则」值） */
export const NO_PACK_NAME = "（未注册图包）";
/** 无版本来源时的版本占位（契约「无则」值） */
export const NO_VERSION = "—";

// ───────────────────────────── 内部状态与缓存 ─────────────────────────────

/** 拉取结果：成功带差异条目数；失败（含 pull/diff 任一步失败）无数据 */
type PullOutcome = { ok: true; diffEntries: number } | { ok: false };

/** 校样结果：ok=用例全过；notPassed=未通过数（failed+errored+bailed）；notPassed=null 表示请求/解析失败 */
type ProofOutcome = { ok: true; passed: number; notPassed: number } | { ok: false; notPassed: number | null };

/** 契约 §1 的模块级结果缓存（仅内存） */
export interface StampCacheEntry {
  pull?: { diffEntries: number };
  proof?: { passed: number; failed: number };
  /** 追加：上次拉取失败的补充标记（供 30s 节流 + 重挂载后仍显示 alert），非契约字段 */
  pullErrorAt?: number;
  /** 追加：上次校样请求失败的补充标记（同上） */
  proofErrorAt?: number;
}

/** 结果缓存：root → 拉取/校样结果（免重复请求） */
const cache = new Map<string, StampCacheEntry>();
/** 迷你文件树缓存：root → diff 条目派生的 TreeNode[]（与 ①代码面同源） */
const treeCache = new Map<string, TreeNode[]>();
/** 图包元信息缓存：metaKey(root) → {name, version}（会话级） */
const packMetaCache = new Map<string, PackMeta>();

/** 失败节流窗（ms）：窗口内重挂载不重发 hub 请求，直接从缓存的失败标记推导 alert */
const RETRY_AFTER_MS = 30_000;

/** 迷你文件树最多渲染行数（⓪总览块高有限；note 仍报总差异数） */
const MINI_TREE_MAX = 12;

interface EngineState {
  root: string | null;
  pull: PullOutcome | null;
  proof: ProofOutcome | null;
  packName: string;
  packVersion: string;
}

interface PackMeta {
  /** 注册表条目 dir（一级子目录名，hub 路由直接接受，与 ①代码面同口径） */
  dir: string;
  name: string;
  version: string;
}

// ───────────────────────────── 纯工具 ─────────────────────────────

/** 路径归一：斜杠统一 + 小写（Windows 比较用；只做展示级匹配，不做真实路径解析） */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** 注册表条目在缓存里的 key */
function metaKey(rootish: string): string {
  return normalizePath(rootish);
}

/** root 兜底显示名：路径最后一段（注册表查不到时的诚实兜底，避免谎报「未注册」） */
function packNameFallback(root: string): string {
  const parts = root.split(/[\\/]+/).filter((s) => s !== "");
  const last = parts[parts.length - 1];
  return last !== undefined && last !== "" ? last : root;
}

/** 失败节流判断：窗口内不重发 */
function isThrottled(root: string, kind: "pull" | "proof"): boolean {
  const entry = cache.get(root);
  const at = kind === "pull" ? entry?.pullErrorAt : entry?.proofErrorAt;
  return at !== undefined && Date.now() - at < RETRY_AFTER_MS;
}

/** 合并式写缓存（成功清除失败标记：显式 undefined 覆盖） */
function patchCache(root: string, patch: Partial<StampCacheEntry>): void {
  cache.set(root, { ...(cache.get(root) ?? {}), ...patch });
}

/** 由缓存/空态推导引擎基线（root 变更首帧同步渲染，避免闪上一图包的旧值） */
function seedState(root: string | null): EngineState {
  if (root === null) {
    return {
      root: null,
      pull: null,
      proof: null,
      packName: NO_PACK_NAME,
      packVersion: NO_VERSION,
    };
  }
  const entry = cache.get(root);
  const meta = packMetaCache.get(metaKey(root));
  const pull: PullOutcome | null =
    entry?.pull !== undefined
      ? { ok: true, diffEntries: entry.pull.diffEntries }
      : isThrottled(root, "pull")
        ? { ok: false }
        : null;
  const proof: ProofOutcome | null =
    entry?.proof !== undefined
      ? { ok: entry.proof.failed === 0, passed: entry.proof.passed, notPassed: entry.proof.failed }
      : isThrottled(root, "proof")
        ? { ok: false, notPassed: null }
        : null;
  return {
    root,
    pull,
    proof,
    packName: meta?.name ?? packNameFallback(root),
    packVersion: meta?.version ?? NO_VERSION,
  };
}

/** 5 章名称（id → 仿宋大字） */
const STAMP_NAMES: Record<StampId, string> = {
  pull: "拉取",
  slice: "切片",
  compose: "拼版",
  proof: "校样",
  ship: "出厂",
};

/** 工序章顺序：拉取 → 切片 → 拼版 → 校样 → 出厂 */
const STAMP_ORDER: StampId[] = ["pull", "slice", "compose", "proof", "ship"];

/**
 * 由四组标量推导五章（纯函数，见文件头语义表）。导出供验收窗口离线核对语义表；
 * 组件侧只经 useOverviewData 消费。
 */
export function deriveStamps(args: {
  root: string | null;
  pull: PullOutcome | null;
  proof: ProofOutcome | null;
  deadCount: number;
  sliceActive: boolean;
  pendingSign: number;
}): StampState[] {
  const { root, pull, proof, deadCount, sliceActive, pendingSign } = args;

  // 拉取
  let pullStatus: StampStatus;
  let pullNote: string;
  if (root === null) {
    pullStatus = "todo";
    pullNote = "未注册";
  } else if (pull === null) {
    pullStatus = "doing";
    pullNote = "拉取中…";
  } else if (!pull.ok) {
    pullStatus = "alert";
    pullNote = "拉取失败";
  } else if (pull.diffEntries > 0) {
    pullStatus = "doing";
    pullNote = `${pull.diffEntries} 件待写回`;
  } else {
    pullStatus = "done";
    pullNote = "✓ 已同步";
  }
  const pullDone = pull !== null && pull.ok;

  // 切片（见文件头：无历史查询路由，只认会话内活动）
  const sliceStatus: StampStatus = sliceActive ? "doing" : "todo";
  const sliceNote = sliceActive ? "进行中" : "未开始";

  // 拼版（死链来自全站死链 store，与 ③④ 面同源）
  let composeStatus: StampStatus;
  let composeNote: string;
  if (!pullDone) {
    composeStatus = "todo";
    composeNote = "待拉取";
  } else if (deadCount > 0) {
    composeStatus = "alert";
    composeNote = `${deadCount} 死链`;
  } else {
    composeStatus = "done";
    composeNote = "✓ 无死链";
  }

  // 校样
  let proofStatus: StampStatus;
  let proofNote: string;
  if (root === null) {
    proofStatus = "todo";
    proofNote = "未注册";
  } else if (proof === null) {
    proofStatus = "doing";
    proofNote = "校样中…";
  } else if (proof.ok) {
    proofStatus = "done";
    proofNote = `${proof.passed}/${proof.passed + proof.notPassed} ✓`;
  } else if (proof.notPassed !== null && proof.notPassed > 0) {
    proofStatus = "alert";
    proofNote = `${proof.notPassed} 未过`;
  } else {
    proofStatus = "alert";
    proofNote = "校样失败";
  }

  // 出厂（待签件数 ≈ diffCount；「全部签出」= 拉取成功且无差异）
  let shipStatus: StampStatus;
  let shipNote: string;
  if (root === null) {
    shipStatus = "todo";
    shipNote = "未注册";
  } else if (!pullDone) {
    shipStatus = "todo";
    shipNote = "待拉取";
  } else if (pendingSign > 0) {
    shipStatus = "todo";
    shipNote = `${pendingSign} 件待签`;
  } else {
    shipStatus = "done";
    shipNote = "✓ 已会签";
  }

  const byId: Record<StampId, { status: StampStatus; note: string }> = {
    pull: { status: pullStatus, note: pullNote },
    slice: { status: sliceStatus, note: sliceNote },
    compose: { status: composeStatus, note: composeNote },
    proof: { status: proofStatus, note: proofNote },
    ship: { status: shipStatus, note: shipNote },
  };

  return STAMP_ORDER.map((id) => ({
    id,
    name: STAMP_NAMES[id],
    status: byId[id].status,
    note: byId[id].note,
  }));
}

/**
 * 待办行（符号 + 色彩纪律：✗ 红=错误/死链 ⇄ 红=与游戏内不同 ✂ 蓝=进行中 ⬆ 琥珀=待会签）。
 * 导出供验收窗口离线核对；组件侧只经 useOverviewData 消费。
 */
export function deriveTodos(args: {
  pull: PullOutcome | null;
  deadCount: number;
  sliceActive: boolean;
  pendingSign: number;
}): TodoItem[] {
  const { pull, deadCount, sliceActive, pendingSign } = args;
  const todos: TodoItem[] = [];

  if (deadCount > 0) {
    todos.push({
      mark: "✗",
      color: "red",
      text: `${deadCount} 个素材死链待替换`,
      target: "assets",
    });
  }
  if (pull !== null && !pull.ok) {
    todos.push({
      mark: "✗",
      color: "red",
      text: "拉取失败，去 ① 代码重试",
      target: "code",
    });
  }
  const diff = pull !== null && pull.ok ? pull.diffEntries : 0;
  if (diff > 0) {
    todos.push({
      mark: "⇄",
      color: "red",
      text: `${diff} 个对象与游戏内不同`,
      target: "code",
    });
  }
  if (sliceActive) {
    todos.push({
      mark: "✂",
      color: "blue",
      text: "切片进行中",
      target: "cards",
    });
  }
  if (pendingSign > 0) {
    // 会签动作在右下常驻会签栏（不是某个工作面）→ target 取 ⓪ 总览为最近落点
    todos.push({
      mark: "⬆",
      color: "amber",
      text: `${pendingSign} 件待会签（右下会签栏）`,
      target: "overview",
    });
  }
  return todos;
}

// ───────────────────────────── hub 响应解析（容错） ─────────────────────────────

interface DiffEntryLite {
  guid: string;
  name: string;
  kind: "script" | "ui";
  status: "added" | "modified" | "deleted";
}

/** 扩展名 → 对象类别（契约 §5：.lua→script / .xml→ui） */
function kindFromName(name: string): "script" | "ui" {
  return name.toLowerCase().endsWith(".xml") ? "ui" : "script";
}

/** POST /v1/diff 响应 → 条目数组（hub 返回 { entries, added, modified, deleted }） */
function readDiffEntries(res: unknown): DiffEntryLite[] {
  const entries = (res as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const out: DiffEntryLite[] = [];
  for (const raw of entries) {
    if (typeof raw !== "object" || raw === null) continue;
    const guid = (raw as { guid?: unknown }).guid;
    const name = (raw as { name?: unknown }).name;
    const kind = (raw as { kind?: unknown }).kind;
    const status = (raw as { status?: unknown }).status;
    if (typeof guid !== "string" || typeof name !== "string") continue;
    out.push({
      guid,
      name,
      // hub 的分类为准；缺失时按契约 §5 的扩展名规则兜底
      kind: kind === "script" || kind === "ui" ? kind : kindFromName(name),
      status:
        status === "added" || status === "modified" || status === "deleted"
          ? status
          : "modified",
    });
  }
  return out;
}

/** diff 条目 → 迷你文件树节点（①代码面同一份条目形状） */
function toTreeNodes(entries: DiffEntryLite[]): TreeNode[] {
  return entries.map(
    (e): TreeNode => ({
      name: e.name,
      guid: e.guid,
      kind: e.kind,
      status: e.status,
    }),
  );
}

/** POST /v1/test/run 响应（RunReport）→ { passed, notPassed }；非 RunReport 形状返回 null */
function readRunReport(res: unknown): { passed: number; notPassed: number } | null {
  if (typeof res !== "object" || res === null) return null;
  const r = res as {
    passed?: unknown;
    failed?: unknown;
    errored?: unknown;
    bailed?: unknown;
  };
  if (r.passed === undefined && r.failed === undefined && r.errored === undefined) {
    return null; // 缺 results/total 之外的三个计数即认为不是 RunReport
  }
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  // 未通过数 = 断言失败 + 执行错误 + 提前中止（任一非 0 都不算「校样通过」）
  return {
    passed: num(r.passed),
    notPassed: num(r.failed) + num(r.errored) + num(r.bailed),
  };
}

/** GET /v1/packs 响应（.registry.yaml）→ 条目数组 */
function readPackMetas(res: unknown): PackMeta[] {
  const packs = (res as { packs?: unknown }).packs;
  if (!Array.isArray(packs)) return [];
  const out: PackMeta[] = [];
  for (const p of packs) {
    if (typeof p !== "object" || p === null) continue;
    const dir = (p as { dir?: unknown }).dir;
    if (typeof dir !== "string" || dir === "") continue;
    const name = (p as { name?: unknown }).name;
    // 前瞻探测：当前 .registry.yaml 的 PackEntry 无 version 字段（严格 schema），
    // 未来若加入即自动生效，否则恒 NO_VERSION
    const version = (p as { version?: unknown }).version;
    out.push({
      dir,
      name: typeof name === "string" && name !== "" ? name : packNameFallback(dir),
      version:
        typeof version === "string" && version !== "" ? version : NO_VERSION,
    });
  }
  return out;
}

/** 注册表条目匹配 root：dir 是一级子目录名，root 可能是其完整路径 */
function findPackMeta(metas: PackMeta[], root: string): PackMeta | null {
  const target = normalizePath(root);
  for (const meta of metas) {
    const dir = normalizePath(meta.dir);
    if (target === dir || (dir !== "" && target.endsWith(`/${dir}`))) return meta;
  }
  return null;
}

/** SSE 文案线索（尽力而为，见文件头）：切片活动检测 */
function hasSliceActivity(events: HubEvent[]): boolean {
  for (const e of events) {
    const msg = e.msg.toLowerCase();
    if (msg.includes("切片") || msg.includes("deck/slice") || msg.includes("slice")) {
      return true;
    }
  }
  return false;
}

// ───────────────────────────── 主 hook ─────────────────────────────

/**
 * ⓪总览数据源。只在 root 非 null 时访问 hub（降级模式零请求）；拉取/校样结果按 root
 * 走模块级缓存，同会话内 ⓪ 面反复切换不重复请求。
 */
export function useOverviewData(src: OverviewSource): OverviewData {
  const { client } = useHub();
  const { root, deadUrls, sseEvents } = src;

  const [state, setState] = useState<EngineState>(() => seedState(src.root));
  // root 变更首帧：直接以缓存/空态渲染（effect 随后补请求），不闪上一图包的旧值
  const view = state.root === root ? state : seedState(root);

  const deadCount = deadUrls.size;
  const jobCount = sseEvents.length;
  const sliceActive = src.sliceActive === true || hasSliceActivity(sseEvents);

  useEffect(() => {
    let cancelled = false;

    // 幂等基线同步：仅当组件内状态与本轮 root 不一致时重置
    setState((prev) => (prev.root === root ? prev : seedState(root)));

    // 降级模式（无已注册图包）：不发任何 hub 请求
    if (root === null) {
      return () => {
        cancelled = true;
      };
    }
    const packRoot = root;

    void (async () => {
      const apply = (updater: (prev: EngineState) => EngineState): void => {
        if (!cancelled) {
          setState((prev) => (prev.root === packRoot ? updater(prev) : prev));
        }
      };

      // ① 图包元信息（GET /v1/packs 只读本地注册表；会话级缓存，同 root 只查一次）
      if (!packMetaCache.has(metaKey(packRoot))) {
        try {
          const hit = findPackMeta(readPackMetas(await client.packs()), packRoot);
          if (hit !== null) {
            packMetaCache.set(metaKey(packRoot), hit);
            apply((prev) => ({
              ...prev,
              packName: hit.name,
              packVersion: hit.version,
            }));
          } else if (!cancelled) {
            // 查不到条目：保留 basename 兜底名与 "—" 版本（不谎报「未注册」）
            packMetaCache.set(metaKey(packRoot), {
              dir: packRoot,
              name: packNameFallback(packRoot),
              version: NO_VERSION,
            });
          }
        } catch {
          // 静默降级：保留 basename(packRoot) + "—"
        }
      }

      // ② 拉取：POST /v1/scripts/pull + POST /v1/diff 合并为一次「拉取」语义
      //    （与 ①代码面挂载同序：先拉后 diff，diff 反映拉取后的工作区状态）
      if (cache.get(packRoot)?.pull === undefined && !isThrottled(packRoot, "pull")) {
        try {
          await client.pullScripts(packRoot);
          const entries = readDiffEntries(await client.diff(packRoot));
          // 先写缓存再 setState：同一帧内 deriveMiniTree 已能取到新节点
          patchCache(packRoot, {
            pull: { diffEntries: entries.length },
            pullErrorAt: undefined,
          });
          treeCache.set(packRoot, toTreeNodes(entries));
          apply((prev) => ({
            ...prev,
            pull: { ok: true, diffEntries: entries.length },
          }));
        } catch {
          // 静默降级：拉取章 alert，失败标记进节流窗（30s 内重挂载不重发）
          patchCache(packRoot, { pullErrorAt: Date.now() });
          apply((prev) => ({ ...prev, pull: { ok: false } }));
        }
      }

      // ③ 校样：POST /v1/test/run（在真实游戏内跑 tests/**）；跑完即缓存（断言失败也算跑完）
      if (
        cache.get(packRoot)?.proof === undefined &&
        !isThrottled(packRoot, "proof")
      ) {
        try {
          const report = readRunReport(await client.testRun({ root: packRoot }));
          if (report === null) {
            patchCache(packRoot, { proofErrorAt: Date.now() });
            apply((prev) => ({ ...prev, proof: { ok: false, notPassed: null } }));
          } else {
            patchCache(packRoot, {
              proof: { passed: report.passed, failed: report.notPassed },
              proofErrorAt: undefined,
            });
            apply((prev) => ({
              ...prev,
              proof: {
                ok: report.notPassed === 0,
                passed: report.passed,
                notPassed: report.notPassed,
              },
            }));
          }
        } catch {
          patchCache(packRoot, { proofErrorAt: Date.now() });
          apply((prev) => ({ ...prev, proof: { ok: false, notPassed: null } }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, root]);

  const pull = view.pull;
  const proof = view.proof;

  const diffCount = pull !== null && pull.ok ? pull.diffEntries : 0;
  const pendingSign = diffCount;

  const stamps = useMemo(
    () =>
      deriveStamps({
        root,
        pull,
        proof,
        deadCount,
        sliceActive,
        pendingSign,
      }),
    [root, pull, proof, deadCount, sliceActive, pendingSign],
  );

  const todos = useMemo(
    () => deriveTodos({ pull, deadCount, sliceActive, pendingSign }),
    [pull, deadCount, sliceActive, pendingSign],
  );

  return useMemo<OverviewData>(
    () => ({
      stamps,
      todos,
      diffCount,
      deadCount,
      pendingSign,
      jobCount,
      // 见文件头：本窗口不接 ③④ 面数据源（LayerTiles 渲染为 "—"）
      cardCount: null,
      assetCount: null,
      packName: view.packName,
      packVersion: view.packVersion,
    }),
    [
      stamps,
      todos,
      diffCount,
      deadCount,
      pendingSign,
      jobCount,
      view.packName,
      view.packVersion,
    ],
  );
}

// ───────────────────────────── 派生数据源（迷你文件树 / 会签栏） ─────────────────────────────

export interface MiniTreeData {
  nodes: TreeNode[];
  /** 块右上角小注（契约 §5：「差异 N」/ 空态「未注册图包」） */
  note: string;
}

/**
 * ⓪总览「工作区」迷你文件树数据源：读 useOverviewData 同一份缓存（同源），
 * 在渲染期调用即可（拉取成功后本模块已先写 treeCache 再 setState，同一帧能取到新节点）。
 * 最多 MINI_TREE_MAX 行，note 报总差异数。
 */
export function deriveMiniTree(root: string | null): MiniTreeData {
  if (root === null) {
    return { nodes: [], note: "未注册图包" };
  }
  const nodes = treeCache.get(root);
  if (nodes === undefined) {
    return { nodes: [], note: "差异 —" };
  }
  return { nodes: nodes.slice(0, MINI_TREE_MAX), note: `差异 ${nodes.length}` };
}

export interface SignBlockData {
  version: string;
  checks: SignCheck[];
}

/**
 * §4.4 会签栏交付清单数据源（锁定决策 2：出厂行与出厂章同源）。
 * 行序 版本 → 校样 → 打样 → 出厂；`next` 落在第一行 bad 上（当前下一步）。
 *
 * 注意：SignCheck.tone 只有 ok | bad（SignBlock 现有类型），故非 done 行一律 bad
 * （与 App.tsx 既有占位「待/未 → bad」一致）；若后续把 tone 扩到 amber（待签=待人审，
 * §2.5 更准确），此处可相应细化。打样（POST /v1/pack/build）产物不在 OverviewSource 内
 * 且无查询路由，恒「未打样」。
 */
export function deriveSignBlock(data: OverviewData): SignBlockData {
  const note = (id: StampId): string =>
    data.stamps.find((s) => s.id === id)?.note ?? NO_VERSION;
  const status = (id: StampId): StampStatus =>
    data.stamps.find((s) => s.id === id)?.status ?? "todo";
  const toneOf = (id: StampId): "ok" | "bad" =>
    status(id) === "done" ? "ok" : "bad";

  const checks: SignCheck[] = [
    {
      k: "版本",
      v: data.packVersion === NO_VERSION ? "未标注" : data.packVersion,
      tone: data.packVersion === NO_VERSION ? "bad" : "ok",
    },
    { k: "校样", v: note("proof"), tone: toneOf("proof") },
    { k: "打样", v: "未打样", tone: "bad" },
    { k: "出厂", v: note("ship"), tone: toneOf("ship") },
  ];

  const nextIdx = checks.findIndex((c) => c.tone === "bad");
  const nextRow = checks[nextIdx];
  if (nextRow !== undefined) checks[nextIdx] = { ...nextRow, next: true };

  return { version: data.packVersion, checks };
}

/** 图包根信息（供 Stage B 解一次注册表，同时喂 useOverviewData 与 MiniFileTree 的 root） */
export interface PackRootInfo {
  /** 已注册图包根（注册表条目 dir，hub 路由直接接受；无图包为 null） */
  root: string | null;
  packName: string;
  packVersion: string;
}

/**
 * 解析已注册图包根（GET /v1/packs 取第一个条目，与 ①代码面「第一个注册图包」口径一致）。
 * root 为 null 时不写任何数据；consumers 可把 root 转交 useOverviewData / deriveMiniTree。
 */
export function usePackRoot(): PackRootInfo {
  const { client } = useHub();
  const [info, setInfo] = useState<PackRootInfo>(() => ({
    root: null,
    packName: NO_PACK_NAME,
    packVersion: NO_VERSION,
  }));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const metas = readPackMetas(await client.packs());
        if (cancelled) return;
        for (const meta of metas) packMetaCache.set(metaKey(meta.dir), meta);
        const first = metas[0];
        setInfo(
          first === undefined
            ? { root: null, packName: NO_PACK_NAME, packVersion: NO_VERSION }
            : {
                root: first.dir,
                packName: first.name,
                packVersion: first.version,
              },
        );
      } catch {
        if (!cancelled) {
          setInfo({ root: null, packName: NO_PACK_NAME, packVersion: NO_VERSION });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  return info;
}

// ───────────────────────────── 缓存维护（供 Stage B / 验收窗口） ─────────────────────────────

/** 读缓存（只读视图；调试 / 二次派生用） */
export function readStampCache(root: string): StampCacheEntry | undefined {
  return cache.get(root);
}

/**
 * 清空全部结果缓存（拉取 / 校样 / 迷你文件树 / 图包元信息）。
 * 用途：写回游戏成功（push）后主动失效，让 ⓪ 面重算五章与差异计数。
 * 注意：清空后下次进入 ⓪ 会重新 pull（会覆盖工作区）+ 重跑测试，请在明确时机调用。
 */
export function clearStampCache(): void {
  cache.clear();
  treeCache.clear();
  packMetaCache.clear();
}
