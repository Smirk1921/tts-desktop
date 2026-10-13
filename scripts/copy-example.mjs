#!/usr/bin/env node
/**
 * scripts/copy-example.mjs — v9-3 窗口 A3（示例图包收集脚本）
 *
 * 职责：把 v8-2 验收夹具 tts-toolkit/tests/fixtures/s_dial.ttsmod 复制为
 *       src-tauri/resources/examples/sample.ttsmod（施工方案 §6.3 "示例图包来源"，
 *       审批意见 §11：从 v8-2 的 s_dial.ttsmod 夹具改装——小、结构简单、已验证合法、
 *       已匿名化），供首次启动向导"打开示例图包"流程使用。
 *
 * 目录映射：
 *   ../tts-toolkit/tests/fixtures/s_dial.ttsmod → src-tauri/resources/examples/sample.ttsmod
 *
 * 行为约定：
 *   · 源不存在 → 报错 process.exit(1)（示例图包是验收必需品，缺失必须 fail）；
 *   · 目标已存在且 sha256 一致 → 跳过（幂等）；
 *   · 目标已存在但内容不同 → 覆盖 + warn。
 *
 * 用法：
 *   node scripts/copy-example.mjs
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_FILE = path.resolve(DESKTOP_ROOT, "..", "tts-toolkit", "tests", "fixtures", "s_dial.ttsmod");
const DEST_FILE = path.join(DESKTOP_ROOT, "src-tauri", "resources", "examples", "sample.ttsmod");

const TAG = "[copy-example]";

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
  console.log(`${TAG} 源: ${SRC_FILE}`);
  console.log(`${TAG} 目标: ${DEST_FILE}`);

  if (!existsSync(SRC_FILE)) {
    throw new Error(`源不存在: ${SRC_FILE} —— v8-2 验收夹具缺失，请检查 tts-toolkit 仓库`);
  }

  const st = await stat(SRC_FILE);

  // 目标已有文件：内容一致 → 跳过；不同 → 覆盖 + warn
  if (existsSync(DEST_FILE)) {
    const srcHash = await sha256(SRC_FILE);
    const dstHash = await sha256(DEST_FILE);
    if (srcHash === dstHash) {
      console.log(`${TAG} 内容一致（sha256 相同），跳过: sample.ttsmod (${formatBytes(st.size)})`);
      console.log(`${TAG} 完成: 0 个复制, 1 个跳过`);
      return;
    }
    console.warn(`${TAG} 目标已存在 sample.ttsmod 但内容不同（sha256 不同）——覆盖`);
  }

  await mkdir(path.dirname(DEST_FILE), { recursive: true });
  await copyFile(SRC_FILE, DEST_FILE);
  console.log(`${TAG} 已复制: s_dial.ttsmod → sample.ttsmod (${formatBytes(st.size)})`);
  console.log(`${TAG} 完成: 1 个复制, 0 个跳过`);
}

main().catch((err) => {
  console.error(`${TAG} 失败: ${err?.message ?? err}`);
  if (err?.cause) console.error(`  原始错误: ${err.cause.message ?? err.cause}`);
  process.exitCode = 1;
});
