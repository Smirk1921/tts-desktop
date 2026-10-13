#!/usr/bin/env node
/**
 * scripts/collect-vsix.mjs — v9-3 窗口 A3（VSCode 插件 .vsix 收集脚本）
 *
 * 职责：把仓库根 ../vscode-ext/ 下最新的 .vsix（mtime 最大者）复制到
 *       src-tauri/resources/vscode-ext/，供 NSIS 自定义模板
 *       （src-tauri/nsis/custom.nsh 的 `File "resources\vscode-ext\*.vsix"`）
 *       在打包时落进安装目录 vscode-ext\。
 *
 * 目录映射：
 *   ../vscode-ext/*.vsix（mtime 最大的一个）→ src-tauri/resources/vscode-ext/<同名>
 *
 * 行为约定：
 *   · ../vscode-ext/ 不存在或没有任何 .vsix → console.warn + process.exit(0)，
 *     不算失败（构建期允许"暂时没有插件产物"）；
 *   · 目标已存在同名 .vsix 且内容一致（size + sha256）→ 跳过（幂等）；
 *   · 目标已存在同名但内容不同 → 覆盖 + warn。
 *
 * 用法：
 *   node scripts/collect-vsix.mjs
 *   npm run collect-vsix（若 package.json 注册了该脚本）
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.resolve(DESKTOP_ROOT, "..", "vscode-ext");
const DEST_DIR = path.join(DESKTOP_ROOT, "src-tauri", "resources", "vscode-ext");

const TAG = "[collect-vsix]";

/** 体积格式化：B → KB/MB，保留 1 位小数（对齐 copy-product.mjs） */
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 计算文件 sha256（内容一致性判定） */
function sha256(abs) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(abs);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  console.log(`${TAG} 源: ${SRC_DIR}`);
  console.log(`${TAG} 目标: ${DEST_DIR}`);

  if (!existsSync(SRC_DIR)) {
    console.warn(`${TAG} 源目录不存在（尚未构建 VSCode 插件 .vsix？）——跳过收集，不视为失败`);
    process.exit(0);
  }

  // 枚举源目录（仅顶层）里的 .vsix，取 mtime 最大者
  const entries = await readdir(SRC_DIR, { withFileTypes: true });
  const vsixFiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".vsix")) continue;
    const abs = path.join(SRC_DIR, entry.name);
    const st = await stat(abs);
    vsixFiles.push({ name: entry.name, abs, size: st.size, mtimeMs: st.mtimeMs });
  }

  if (vsixFiles.length === 0) {
    console.warn(
      `${TAG} ../vscode-ext/ 下没有 .vsix 文件 —— 跳过收集，不视为失败（构建 VSCode 插件后重跑即可）`,
    );
    process.exit(0);
  }

  vsixFiles.sort((a, b) => b.mtimeMs - a.mtimeMs); // mtime 大者在前
  const latest = vsixFiles[0];
  const destAbs = path.join(DEST_DIR, latest.name);

  console.log(
    `${TAG} 最新 .vsix: ${latest.name} (${formatBytes(latest.size)}, mtime ${new Date(latest.mtimeMs).toISOString()})` +
      (vsixFiles.length > 1 ? `；其余 ${vsixFiles.length - 1} 个较旧的忽略` : ""),
  );

  // 目标已有同名文件：内容一致 → 跳过；不同 → 覆盖 + warn
  if (existsSync(destAbs)) {
    const srcHash = await sha256(latest.abs);
    const dstHash = await sha256(destAbs);
    if (srcHash === dstHash) {
      console.log(`${TAG} 内容一致（sha256 相同），跳过: ${latest.name}`);
      console.log(`${TAG} 完成: 0 个复制, 1 个跳过`);
      return;
    }
    console.warn(`${TAG} 目标已存在同名 .vsix 但内容不同（sha256 不同）——覆盖: ${latest.name}`);
  }

  await mkdir(DEST_DIR, { recursive: true });
  await copyFile(latest.abs, destAbs);
  console.log(`${TAG} 已复制: ${latest.name} (${formatBytes(latest.size)}) → ${destAbs}`);
  console.log(`${TAG} 完成: 1 个复制, 0 个跳过`);
}

main().catch((err) => {
  console.error(`${TAG} 失败: ${err?.message ?? err}`);
  if (err?.cause) console.error(`  原始错误: ${err.cause.message ?? err.cause}`);
  process.exitCode = 1;
});
