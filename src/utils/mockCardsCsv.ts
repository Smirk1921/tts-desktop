/**
 * mock cards.csv 生成器 — UI-3 Stage A3
 *
 * 职责：为施工方案 §10.4 验收「3,000+ 行滚动帧率 ≥ 30fps」提供压测数据
 *   （《第七大陆》实测 3,683 个 CustomDeck 条目，此处默认 3500 行，Stage C 在
 *   浏览器里跑实测——红线 11：浏览器跑，不接 Tauri）。
 *
 * 关键设计：
 *   - 生成的 CSV 头固定 `id,group,field,url,source`，与 AssetRow 五必填字段一一对应。
 *   - 死链/活链 URL 均为确定序列（按下标取模），不引随机数——多次生成结果一致，
 *     压测与回放可复现：死链 example.invalid（必然解析失败）/ 活链 picsum.photos。
 *   - 死链比例经 deadStep = round(1 / deadRatio) 取模实现，deadRatio=0.05 即每
 *     20 行 1 条；0 或 NaN 视为 0 条死链，1 即全部死链。
 *   - parseMockCsvToAssetRows 按简单 split 解析（本生成器不含引号/逗号转义场景，
 *     不需要完整 CSV 语法），字段数不符的行跳过；status 不在此赋值（unknown 由
 *     字段缺省表达，体检状态归 Stage C 的 /v1/assets/check 链路）。
 *   - 不引第三方库（任务书约束）。
 */
import type { AssetRow } from "../components/AssetsTable";

/** 生成选项（全部可选，缺省见各字段注释） */
export interface MockCsvOptions {
  /** 行数，默认 3500（≥3500 满足 3,000+ 行压测口径） */
  rows?: number;
  /** 死链比例 0..1，默认 0.05 */
  deadRatio?: number;
  /** 组别序列（按下标循环分配），默认 ["deck","card","token","board"] */
  groups?: string[];
}

const DEFAULT_ROWS = 3500;
const DEFAULT_DEAD_RATIO = 0.05;
const DEFAULT_GROUPS: readonly string[] = ["deck", "card", "token", "board"];

/** CSV 表头（契约：与 AssetRow 字段同序） */
const CSV_HEADER = "id,group,field,url,source";

/** 各组别的字段名轮换（field 取值模拟 CustomDeck.face / Back / NumSlots 等） */
const FIELDS_BY_GROUP: Record<string, readonly string[]> = {
  deck: ["CustomDeck.face", "CustomDeck.Back", "CustomDeck.NumSlots"],
  card: ["card.Face", "card.Back"],
  token: ["Token.Face", "Token.Back"],
  board: ["Board.Image"],
};

/** 未知组别（调用方自定义 groups）的兜底字段 */
const FALLBACK_FIELDS: readonly string[] = ["Image"];

/** 来源轮换（AssetRow.source 三种合法值） */
const SOURCES: readonly string[] = ["cards.csv", "objects.csv", "deck.yaml"];

/** 生成 mock cards.csv 内容（首行表头 + rows 行数据，\n 换行） */
export function generateMockCardsCsv(opts?: MockCsvOptions): string {
  const rawRows = opts?.rows ?? DEFAULT_ROWS;
  const rowCount = Number.isFinite(rawRows) ? Math.max(0, Math.floor(rawRows)) : DEFAULT_ROWS;

  const rawRatio = opts?.deadRatio ?? DEFAULT_DEAD_RATIO;
  const deadRatio = Number.isFinite(rawRatio) ? Math.min(1, Math.max(0, rawRatio)) : 0;
  const deadStep = deadRatio > 0 ? Math.max(1, Math.round(1 / deadRatio)) : 0;

  const givenGroups = opts?.groups;
  const groups =
    givenGroups !== undefined && givenGroups.length > 0 ? givenGroups : DEFAULT_GROUPS;

  const lines: string[] = [CSV_HEADER];
  for (let i = 0; i < rowCount; i += 1) {
    const group = groups[i % groups.length];
    const fields = FIELDS_BY_GROUP[group] ?? FALLBACK_FIELDS;
    const field = fields[i % fields.length];
    const isDead = deadStep > 0 && i % deadStep === 0;
    // 死链：example.invalid 是保留无效域（必然体检失败）；活链：picsum 定尺寸图
    const url = isDead
      ? `https://example.invalid/img/${i}.png`
      : `https://picsum.photos/seed/${i}/200`;
    const source = SOURCES[i % SOURCES.length];
    lines.push(`row-${i},${group},${field},${url},${source}`);
  }
  return lines.join("\n");
}

/** 简单 split 解析（跳过表头与空行；字段数 ≠5 的行跳过），status 留缺省 = unknown */
export function parseMockCsvToAssetRows(csv: string): AssetRow[] {
  const rows: AssetRow[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === "") continue;
    const parts = line.split(",");
    if (parts.length !== 5) continue;
    rows.push({
      id: parts[0],
      group: parts[1],
      field: parts[2],
      url: parts[3],
      source: parts[4],
    });
  }
  return rows;
}
