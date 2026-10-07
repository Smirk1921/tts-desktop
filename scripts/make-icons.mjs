#!/usr/bin/env node
/**
 * scripts/make-icons.mjs — UI-4 Stage B2
 *
 * 由 assets-src/icon.svg（唯一图标母版）生成 src-tauri/icons/ 全套 16 个目标文件：
 *   · 14 个 PNG（逐尺寸直接矢量栅格化，不做位图缩放 → 小尺寸图线不糊）
 *   · icon.ico —— 内置最小 ICO 编码器（ICONDIR + ICONDIRENTRY + PNG 数据体，
 *                  Vista+ 合法的 PNG 压缩条目；sharp 不支持 ico 编码，node_modules
 *                  内也无 png-to-ico 可用包，故手写 ~40 行）
 *   · icon.icns — 内置最小 ICNS 编码器（"icns" 头 + 各段 type/length/PNG）
 *
 * 用法：npm run make-icons
 * 幂等：重复运行结果一致（覆盖写，输出字节前后对比）。
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVG_PATH = path.join(ROOT, "assets-src", "icon.svg");
const OUT_DIR = path.join(ROOT, "src-tauri", "icons");

/** PNG 目标：文件名 → 边长（与 tauri.conf.json / Windows 商店 logo 约定一致） */
const PNG_TARGETS = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
];

/** ICO 内嵌 PNG 尺寸（256 为 Vista+ PNG 条目上限；其余供任务栏/资源管理器小图标） */
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

/** ICNS 段：icns type → PNG 边长（ic11=32, ic12=64, ic07=128, ic08=256, ic09=512, ic10=1024） */
const ICNS_SEGMENTS = [
  ["ic11", 32],
  ["ic12", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
];

const ICO_ENTRIES = [["icon.ico", ICO_SIZES]];
const ICNS_ENTRIES = [["icon.icns", ICNS_SEGMENTS]];

// ---------------------------------------------------------------- SVG 栅格化

/** 把母版的 width/height 换成目标边长后再交给 sharp：librsvg 按 density=72 出图，
 *  即 1 SVG 用户单位 = 1px，得到「按目标尺寸重新矢量绘制」而非位图缩小。 */
function svgAtSize(svg, size) {
  let hit = false;
  const patched = svg.replace(/<svg\b[^>]*>/, (tag) => {
    hit = true;
    // 注意：size 恰等于母版边长（1024）时替换结果与原文相同，故按「属性是否存在」判定，
    // 不能按「字符串是否变化」判定。
    if (!/\swidth="[^"]*"/.test(tag) || !/\sheight="[^"]*"/.test(tag)) {
      throw new Error(`${SVG_PATH}: 根 <svg> 缺 width/height 属性`);
    }
    return tag
      .replace(/\swidth="[^"]*"/, ` width="${size}"`)
      .replace(/\sheight="[^"]*"/, ` height="${size}"`);
  });
  if (!hit) throw new Error(`${SVG_PATH}: 找不到 <svg> 开标签`);
  return patched;
}

async function renderPng(svg, size) {
  return sharp(Buffer.from(svgAtSize(svg, size)), { density: 72 })
    .png({ compressionLevel: 9, effort: 10, palette: false })
    .toBuffer();
}

// ---------------------------------------------------------------- ICO 编码器

/**
 * 最小 ICO 编码器（PNG 条目版，Windows Vista+ 与 Tauri/wry 均支持）。
 * 结构：ICONDIR(6B: reserved=0, type=1, count) + count × ICONDIRENTRY(16B) + PNG 数据体。
 * ICONDIRENTRY = 宽/高(各 1B，256 记 0) + 调色板数(1B=0) + 保留(1B=0)
 *              + 颜色平面(2B=1) + 位深(2B=32) + 数据长度(4B) + 数据偏移(4B)。
 */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((entry, i) => {
    const base = i * 16;
    const dim = entry.size >= 256 ? 0 : entry.size; // 256 在 ICO 里记作 0
    dir.writeUInt8(dim, base); // width
    dir.writeUInt8(dim, base + 1); // height
    dir.writeUInt8(0, base + 2); // colorCount
    dir.writeUInt8(0, base + 3); // reserved
    dir.writeUInt16LE(1, base + 4); // planes
    dir.writeUInt16LE(32, base + 6); // bitCount
    dir.writeUInt32LE(entry.png.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ---------------------------------------------------------------- ICNS 编码器

/**
 * 最小 ICNS 编码器。
 * 结构："icns"(4B magic) + 总长度(4B big-endian，含头) + 各段[type(4B) + 段长(4B, 含段头) + PNG]。
 * 现代 macOS 全段用 PNG 数据体，无需 4 字节对齐填充。
 */
function encodeIcns(segments) {
  const chunks = segments.map((seg) => {
    const head = Buffer.alloc(8);
    head.write(seg.type, 0, 4, "ascii");
    head.writeUInt32BE(8 + seg.png.length, 4);
    return Buffer.concat([head, seg.png]);
  });
  const body = Buffer.concat(chunks);

  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const svg = await readFile(SVG_PATH, "utf8");
  await mkdir(OUT_DIR, { recursive: true });

  // 目标清单：14 PNG + icon.ico + icon.icns = 16
  const expected = new Set([...PNG_TARGETS.map(([f]) => f), "icon.ico", "icon.icns"]);
  const existing = (await readdir(OUT_DIR)).filter((f) => !f.startsWith("."));
  const uncovered = existing.filter((f) => !expected.has(f));
  if (uncovered.length > 0) {
    throw new Error(`src-tauri/icons/ 存在清单外文件，未覆盖：${uncovered.join(", ")}`);
  }

  const sizeOf = (file) => {
    try {
      return statSync(path.join(OUT_DIR, file)).size;
    } catch {
      return 0; // 尚不存在
    }
  };
  const rows = [];
  const write = async (file, buf) => {
    const before = sizeOf(file);
    await writeFile(path.join(OUT_DIR, file), buf);
    rows.push({ file, before, after: buf.length });
  };

  // PNG：每个尺寸独立栅格化
  const pngCache = new Map();
  const pngAt = async (size) => {
    if (!pngCache.has(size)) pngCache.set(size, await renderPng(svg, size));
    return pngCache.get(size);
  };
  for (const [file, size] of PNG_TARGETS) {
    await write(file, await pngAt(size));
  }

  // ICO
  for (const [file, sizes] of ICO_ENTRIES) {
    const entries = [];
    for (const size of sizes) entries.push({ size, png: await pngAt(size) });
    await write(file, encodeIco(entries));
  }

  // ICNS
  for (const [file, segments] of ICNS_ENTRIES) {
    const segs = [];
    for (const [type, size] of segments) segs.push({ type, png: await pngAt(size) });
    await write(file, encodeIcns(segs));
  }

  // 结果表（字节数前后对比，供「16 个文件真实更新」自查看）
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nicon.svg → ${path.relative(ROOT, OUT_DIR).replace(/\\/g, "/")}`);
  console.log(`${pad("file", 24)}${pad("before", 10)}${pad("after", 10)}changed`);
  console.log("-".repeat(52));
  let changed = 0;
  for (const r of rows) {
    const diff = r.after !== r.before;
    if (diff) changed += 1;
    console.log(
      `${pad(r.file, 24)}${pad(r.before, 10)}${pad(r.after, 10)}${diff ? "yes" : "NO(bits identical)"}`,
    );
  }
  const listOnly = existing.filter((f) => !rows.some((r) => r.file === f));
  console.log("-".repeat(52));
  console.log(
    `共 ${rows.length} 个目标文件，字节变化 ${changed} 个` +
      (listOnly.length ? `；原有未覆盖：${listOnly.join(", ")}` : "") +
      "\n",
  );
  if (rows.length !== 16) throw new Error(`目标数应为 16，实际 ${rows.length}`);
}

main().catch((err) => {
  console.error("[make-icons] 失败：", err);
  process.exitCode = 1;
});
