#!/usr/bin/env node
/**
 * compare-screenshots.mjs — 五面截图 vs round-03 基准图 像素比对（UI-4 Stage B3）
 *
 * 用法：
 *   node scripts/compare-screenshots.mjs
 *   node scripts/compare-screenshots.mjs --shots-dir <基准目录> --current-dir <当前目录>
 *   npm run compare-screenshots
 *
 * 默认目录：
 *   基准 = D:/Codex/TTS图包制作维护工具/ui-design/round-03/shots   （round-03 施工轮次截图，随 git 入库）
 *   当前 = <repo>/screenshots/current                              （Stage C 用 oil-ui 现拍，.gitignore 已忽略）
 *
 * 基准映射（按序回退，取第一个存在 page.png 的候选）：
 *   overview → r6-overview → r5-overview     code → r5-code
 *   agent    → r5-agent                      cards → r6-cards
 *   assets   → r6-assets
 *   说明：r6 系为最新干净轮但无 code/agent 两面；code/agent 沿用 r5 系（五面齐全）。
 *
 * 当前图命名（按序回退，兼容两种落盘习惯）：
 *   <current-dir>/<layer>/page.png → <current-dir>/<layer>.png
 *
 * 判定：
 *   尺寸不一致 → 把较大一张 center-crop 到较小的尺寸，结果 note 记 size_mismatch；
 *   差异率 = pixelmatch 差异像素数 / (宽 × 高)；
 *   ≤ 阈值（5%）PASS，> 阈值 FAIL；当前截图缺失记 missing，跳过不计 FAIL。
 *
 * 退出码：0 = 全 PASS 或全为跳过（缺失基线的也跳过）；1 = 存在 FAIL；2 = 用法/环境错误。
 *
 * 产物：终端表格 + <repo>/screenshots/compare-report.json
 *   {generatedAt, threshold, results:[{layer, baseline, current, width, height,
 *    diffPixels, diffRatio, pass, note?}]}
 *   跳过行的 width/height 为 null（不是 0 —— 0 会谎报尺寸），diffPixels=0、pass=true。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const DEFAULT_SHOTS_DIR = 'D:/Codex/TTS图包制作维护工具/ui-design/round-03/shots';
const DEFAULT_CURRENT_DIR = path.join(REPO_ROOT, 'screenshots', 'current');
const REPORT_PATH = path.join(REPO_ROOT, 'screenshots', 'compare-report.json');

/** 差异率阈值：≤5% PASS（round-03 §十七 UI-4 验收项） */
const DIFF_RATIO_THRESHOLD = 0.05;
/** pixelmatch 单像素色差阈值（0~1，越小越敏感）；保持默认，抗锯齿像素不计差异 */
const PIXEL_COLOR_THRESHOLD = 0.1;

/** 五面映射表：候选基准目录按优先级排列 */
const LAYER_BASELINES = [
  { layer: 'overview', candidates: ['r6-overview', 'r5-overview'] },
  { layer: 'code', candidates: ['r5-code'] },
  { layer: 'agent', candidates: ['r5-agent'] },
  { layer: 'cards', candidates: ['r6-cards'] },
  { layer: 'assets', candidates: ['r6-assets'] },
];

const USAGE = [
  '用法: node scripts/compare-screenshots.mjs [--shots-dir <基准目录>] [--current-dir <当前目录>]',
  '',
  '  --shots-dir <dir>    基准截图目录（默认 ' + DEFAULT_SHOTS_DIR + '）',
  '  --current-dir <dir>  当前截图目录（默认 ' + DEFAULT_CURRENT_DIR + '）',
  '  -h, --help           打印本帮助',
].join('\n');

function fail2(msg, error) {
  console.error(msg);
  if (error) console.error(error instanceof Error ? error.stack : String(error));
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { shotsDir: null, currentDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    }
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
    const takeValue = (name) => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        fail2(`参数 ${name} 缺少取值\n\n${USAGE}`);
      }
      i += 1;
      return next;
    };
    if (key === '--shots-dir') opts.shotsDir = takeValue('--shots-dir');
    else if (key === '--current-dir') opts.currentDir = takeValue('--current-dir');
    else fail2(`未知参数: ${arg}\n\n${USAGE}`);
  }
  return opts;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function relShots(shotsDir, p) {
  const rel = path.relative(shotsDir, p);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : p;
}

/** 依次取第一个存在的候选路径；返回 {path, alternatives} */
function pickFirst(candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    if (isFile(candidates[i])) return { path: candidates[i], index: i };
  }
  return { path: null, index: -1 };
}

/** center-crop 到 w×h（只裁不缩，保持像素一一对应） */
function centerCrop(png, w, h) {
  if (png.width === w && png.height === h) return png;
  const out = new PNG({ width: w, height: h });
  const offX = Math.floor((png.width - w) / 2);
  const offY = Math.floor((png.height - h) / 2);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const from = ((y + offY) * png.width + (x + offX)) << 2;
      const to = (y * w + x) << 2;
      out.data[to] = png.data[from];
      out.data[to + 1] = png.data[from + 1];
      out.data[to + 2] = png.data[from + 2];
      out.data[to + 3] = png.data[from + 3];
    }
  }
  return out;
}

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function pad(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padStart(text, width) {
  const s = String(text);
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

/** 单面比对；异常（读图失败等）折叠成 note + 跳过，不让一个坏文件炸掉整份报告 */
function compareLayer(entry, shotsDir, currentDir) {
  const baseCandidates = entry.candidates.map((c) => path.join(shotsDir, c, 'page.png'));
  const baselinePick = pickFirst(baseCandidates);

  const currentCandidates = [
    path.join(currentDir, entry.layer, 'page.png'),
    path.join(currentDir, `${entry.layer}.png`),
  ];
  const currentPick = pickFirst(currentCandidates);

  const row = {
    layer: entry.layer,
    baseline: baselinePick.path,
    current: currentPick.path ?? currentCandidates[0],
    width: null,
    height: null,
    diffPixels: 0,
    diffRatio: 0,
    pass: true,
  };

  if (!baselinePick.path) {
    row.note = `baseline missing: 候选 ${entry.candidates.map((c) => `${c}/page.png`).join(', ')} 均不存在 —— 跳过，不计 FAIL`;
    return row;
  }
  if (baselinePick.index > 0) {
    row.note = `baseline fallback: ${entry.candidates[0]}/page.png 缺失，改用 ${entry.candidates[baselinePick.index]}/page.png`;
  }
  if (!currentPick.path) {
    row.current = currentCandidates[0];
    row.note = `missing: 当前截图不存在（找过 ${currentCandidates.map((p) => relShots(currentDir, p)).join(', ')}）—— 跳过，不计 FAIL`;
    return row;
  }
  if (currentCandidates[0] !== currentPick.path) {
    row.note = `current naming: 使用 ${relShots(currentDir, currentPick.path)}`;
  }

  let base;
  let curr;
  try {
    base = readPng(baselinePick.path);
    curr = readPng(currentPick.path);
  } catch (err) {
    row.note = `read error: ${err instanceof Error ? err.message : String(err)} —— 跳过，不计 FAIL`;
    return row;
  }

  const w = Math.min(base.width, curr.width);
  const h = Math.min(base.height, curr.height);
  if (w < 1 || h < 1) {
    row.note = `size error: 基准 ${base.width}x${base.height} / 当前 ${curr.width}x${curr.height} —— 无交集像素，跳过，不计 FAIL`;
    return row;
  }
  if (base.width !== curr.width || base.height !== curr.height) {
    const cropNote = `size_mismatch: 基准 ${base.width}x${base.height} / 当前 ${curr.width}x${curr.height} → center-crop 到 ${w}x${h}`;
    row.note = row.note ? `${row.note}; ${cropNote}` : cropNote;
    if (base.width > w || base.height > h) base = centerCrop(base, w, h);
    if (curr.width > w || curr.height > h) curr = centerCrop(curr, w, h);
  }

  row.width = w;
  row.height = h;
  row.diffPixels = pixelmatch(base.data, curr.data, null, w, h, {
    threshold: PIXEL_COLOR_THRESHOLD,
    includeAA: false,
  });
  row.diffRatio = row.diffPixels / (w * h);
  row.pass = row.diffRatio <= DIFF_RATIO_THRESHOLD;
  return row;
}

function printTable(shotsDir, currentDir, results) {
  const rows = results.map((r) => ({
    layer: r.layer,
    baseline: r.width === null ? '(skipped)' : relShots(shotsDir, r.baseline),
    current: r.width === null ? '(skipped)' : relShots(currentDir, r.current),
    size: r.width === null ? '-' : `${r.width}x${r.height}`,
    diffPixels: r.width === null ? '-' : String(r.diffPixels),
    ratio: r.width === null ? '-' : `${(r.diffRatio * 100).toFixed(3)}%`,
    verdict: r.width === null ? 'SKIP' : r.pass ? 'PASS' : 'FAIL',
  }));

  const cols = {
    layer: Math.max(5, ...rows.map((r) => r.layer.length)),
    baseline: Math.max(8, ...rows.map((r) => r.baseline.length)),
    current: Math.max(7, ...rows.map((r) => r.current.length)),
    size: Math.max(8, ...rows.map((r) => r.size.length)),
    diffPixels: Math.max(7, ...rows.map((r) => r.diffPixels.length)),
    ratio: Math.max(5, ...rows.map((r) => r.ratio.length)),
    verdict: 6,
  };

  console.log('');
  console.log('tts-desktop · 五面截图比对（UI-4 Stage B3）');
  console.log(`基准目录 : ${shotsDir}`);
  console.log(`当前目录 : ${currentDir}`);
  console.log(`阈值     : ${(DIFF_RATIO_THRESHOLD * 100).toFixed(1)}% 差异像素（pixelmatch threshold ${PIXEL_COLOR_THRESHOLD}）`);
  console.log('');
  console.log(
    [
      pad('LAYER', cols.layer),
      pad('BASELINE', cols.baseline),
      pad('CURRENT', cols.current),
      pad('SIZE', cols.size),
      padStart('DIFF', cols.diffPixels),
      padStart('RATIO', cols.ratio),
      pad('VERDICT', cols.verdict),
    ].join('  '),
  );
  console.log(
    [
      '-'.repeat(cols.layer),
      '-'.repeat(cols.baseline),
      '-'.repeat(cols.current),
      '-'.repeat(cols.size),
      '-'.repeat(cols.diffPixels),
      '-'.repeat(cols.ratio),
      '-'.repeat(cols.verdict),
    ].join('  '),
  );
  for (const r of rows) {
    console.log(
      [
        pad(r.layer, cols.layer),
        pad(r.baseline, cols.baseline),
        pad(r.current, cols.current),
        pad(r.size, cols.size),
        padStart(r.diffPixels, cols.diffPixels),
        padStart(r.ratio, cols.ratio),
        pad(r.verdict, cols.verdict),
      ].join('  '),
    );
  }
  console.log('');

  for (const r of results) {
    if (r.note) console.log(`  [${r.layer}] ${r.note}`);
  }
  if (results.some((r) => r.note)) console.log('');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const shotsDir = path.resolve(opts.shotsDir ?? DEFAULT_SHOTS_DIR);
  const currentDir = path.resolve(opts.currentDir ?? DEFAULT_CURRENT_DIR);

  if (!fs.existsSync(shotsDir)) fail2(`基准目录不存在: ${shotsDir}`);
  if (!fs.existsSync(currentDir)) {
    console.warn(`当前截图目录不存在（全部面记 missing 并跳过）: ${currentDir}`);
  }

  let results;
  try {
    results = LAYER_BASELINES.map((entry) => compareLayer(entry, shotsDir, currentDir));
  } catch (err) {
    fail2('比对过程异常终止', err);
  }

  printTable(shotsDir, currentDir, results);

  const report = {
    generatedAt: new Date().toISOString(),
    threshold: DIFF_RATIO_THRESHOLD,
    results,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`报告已写出: ${REPORT_PATH}`);

  const failed = results.filter((r) => !r.pass);
  const compared = results.filter((r) => r.width !== null);
  const skipped = results.length - compared.length;
  if (failed.length > 0) {
    console.log(`结论: ${failed.length} 面超阈（${failed.map((r) => r.layer).join(', ')}）`);
    process.exit(1);
  }
  console.log(`结论: 全部通过（比对 ${compared.length} 面 / 跳过 ${skipped} 面）`);
  process.exit(0);
}

main();
