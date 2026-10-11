#!/usr/bin/env node
/**
 * scripts/copy-product.mjs — v9-2 窗口 A1（产物同步脚本，方案 A：单 .exe + resources）
 *
 * 职责：把 tts-toolkit/product/（v9-1 产物）同步到两个目标：
 *   1. node.exe → src-tauri/bin/tts-hub-x86_64-pc-windows-msvc.exe
 *      （Tauri externalBin 开发期约定：dev 期带 target-triple 后缀 + .exe，
 *        打包时 Tauri 自动去后缀 → bin/tts-hub.exe）。
 *      ⭐ 实测契约（v9-2 Stage C）：Tauri 2 externalBin 只认单 .exe 文件，不支持目录形式。
 *   2. 其余产物（dist/ + node_modules/ + native/ + locales/ + docs/ + package.json）
 *      → src-tauri/resources/sidecar/（tauri.conf.json 的 bundle.resources 打包到
 *        <resource_dir>/resources/sidecar/）。
 *
 * 目录映射：
 *   product/runtime/node.exe  → src-tauri/bin/tts-hub-x86_64-pc-windows-msvc.exe  [单文件，改名]
 *   product/dist/             → src-tauri/resources/sidecar/dist/
 *   product/node_modules/     → src-tauri/resources/sidecar/node_modules/
 *   product/locales/          → src-tauri/resources/sidecar/locales/
 *   product/docs/             → src-tauri/resources/sidecar/docs/
 *   product/package.json      → src-tauri/resources/sidecar/package.json
 *   product/bin/native/*      → src-tauri/resources/sidecar/native/*  [去掉 bin 层]
 *
 * sidecar.rs 路径解析（与上述布局对应）：
 *   - hub_root（current_dir，sharp DLL 从这找）：release <resource_dir>/resources/sidecar/，
 *     dev src-tauri/resources/sidecar/
 *   - node_exe：release <resource_dir>/bin/tts-hub.exe（externalBin 去后缀），
 *     dev src-tauri/bin/tts-hub-x86_64-pc-windows-msvc.exe
 *
 * 用法：
 *   npm run copy-product                  # 全量同步（先清空目标，保证无陈旧文件）
 *   npm run copy-product -- --if-changed  # 增量：按 size+mtime 跳过未变文件（161MB 全量复制慢）
 *   npm run copy-product -- --dry-run     # 只打印将复制的文件清单与总大小，不落盘
 *
 * 坑 28 变种约定：本脚本不杀 node.exe。Windows 下目标 node.exe 被占用时，
 * 删除/复制会以 EBUSY/EPERM 失败 —— 统一转成明确报错，提示先关闭占用进程再重试。
 *
 * 增量实现要点：复制后用 utimes 把目标 mtime 写回为源 mtime，
 * 否则目标 mtime 恒为"复制时刻"，--if-changed 的对比永远不等、增量失效。
 * 已知限制：增量模式不回收目标里已消失的陈旧文件（需要回收用全量模式）。
 */
import { copyFile, mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = path.resolve(DESKTOP_ROOT, "..", "tts-toolkit", "product");
const BIN_DIR = path.resolve(DESKTOP_ROOT, "src-tauri", "bin");
const RESOURCES_DIR = path.resolve(DESKTOP_ROOT, "src-tauri", "resources", "sidecar");
const NODE_EXE_TARGET = path.join(BIN_DIR, "tts-hub-x86_64-pc-windows-msvc.exe");

const argv = new Set(process.argv.slice(2));
const IF_CHANGED = argv.has("--if-changed");
const DRY_RUN = argv.has("--dry-run");

/** 复制计划：label 用于步骤日志；src/dest 相对各自根目录；src 允许是单文件 */
const COPY_PLAN = [
  { label: "dist", src: "dist", dest: "dist" },
  { label: "node_modules", src: "node_modules", dest: "node_modules" },
  { label: "locales", src: "locales", dest: "locales" },
  { label: "docs", src: "docs", dest: "docs" },
  { label: "package.json", src: "package.json", dest: "package.json" },
  // bin/native → native：平移掉 bin 层（sharp 运行时按 sidecar 根下的 native/ 找 DLL）
  { label: "native", src: path.join("bin", "native"), dest: "native" },
];

/** Windows 下文件被占用（运行中的 node.exe 等）的典型错误码 */
const OCCUPIED_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

const log = (...msg) => console.log("[copy-product]", ...msg);

/** 体积格式化：B → KB/MB，保留 1 位小数 */
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 把占用类 fs 错误转成用户能行动的报错（坑 28 变种：不杀进程，只提示）。
 * @param {NodeJS.ErrnoException} err
 * @param {string} action 出错的动作描述，如 "清理目标目录"
 * @returns {Error}
 */
function wrapFsError(err, action) {
  if (err && OCCUPIED_CODES.has(err.code)) {
    const wrapped = new Error(
      `[copy-product] ${action} 失败：文件被占用（${err.code}）。` +
        "请先关闭占用 node.exe 的进程（运行中的 tts-hub / TTS 工作台）后重试；本脚本不会杀进程。",
    );
    wrapped.cause = err;
    return wrapped;
  }
  return err;
}

/**
 * 递归枚举一个源路径下的全部普通文件。
 * @param {string} abs 绝对路径（文件或目录）
 * @param {string} rel 相对 DEST_ROOT 的目标相对路径（单文件时即文件名）
 * @returns {Promise<Array<{rel: string, abs: string, size: number, mtimeMs: number, mtime: Date, atime: Date}>>}
 */
async function walkFiles(abs, rel = "") {
  const st = await stat(abs);
  if (!st.isDirectory()) {
    return [{ rel, abs, size: st.size, mtimeMs: st.mtimeMs, mtime: st.mtime, atime: st.atime }];
  }
  const entries = await readdir(abs, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    const childAbs = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(childAbs, childRel)));
    } else if (entry.isFile()) {
      const fst = await stat(childAbs);
      files.push({
        rel: childRel,
        abs: childAbs,
        size: fst.size,
        mtimeMs: fst.mtimeMs,
        mtime: fst.mtime,
        atime: fst.atime,
      });
    }
  }
  return files;
}

/**
 * 判断目标文件是否与源一致（--if-changed 的跳过条件）。
 * mtime 容差 2ms：吸收 NTFS 精度与 utimes 写回的舍入误差。
 * @param {{size: number, mtimeMs: number}} file
 * @param {string} destAbs
 * @returns {Promise<boolean>} true = 目标已存在且未变，可跳过
 */
async function isUnchanged(file, destAbs) {
  try {
    const dst = await stat(destAbs);
    return dst.isFile() && dst.size === file.size && Math.abs(dst.mtimeMs - file.mtimeMs) < 2;
  } catch {
    return false; // 目标不存在 → 视为需要复制
  }
}

async function main() {
  log(`源: ${SRC_ROOT}`);
  log(`目标 1 (externalBin 单 .exe): ${NODE_EXE_TARGET}`);
  log(`目标 2 (resources): ${RESOURCES_DIR}`);
  log(`模式: ${DRY_RUN ? "dry-run（不落盘）" : IF_CHANGED ? "增量（--if-changed）" : "全量"}`);
  if (!existsSync(SRC_ROOT)) {
    throw new Error(`源目录不存在: ${SRC_ROOT} —— 请先完成 v9-1 的 product 产物构建`);
  }

  // 0. node.exe 单独处理（product/runtime/node.exe → bin/tts-hub-x86_64-pc-windows-msvc.exe）
  const nodeExeSrc = path.join(SRC_ROOT, "runtime", "node.exe");
  if (!existsSync(nodeExeSrc)) {
    throw new Error(`源缺失: ${nodeExeSrc} —— product 产物不完整，请检查 v9-1 产物构建`);
  }
  const nodeExeStat = await stat(nodeExeSrc);
  const nodeExeFile = {
    rel: path.basename(NODE_EXE_TARGET),
    abs: nodeExeSrc,
    size: nodeExeStat.size,
    mtimeMs: nodeExeStat.mtimeMs,
    mtime: nodeExeStat.mtime,
    atime: nodeExeStat.atime,
  };

  // 1. 枚举 resources 源文件（dry-run 的核心验证点：能正确列全 6 组映射）
  const groups = [];
  for (const step of COPY_PLAN) {
    const srcAbs = path.join(SRC_ROOT, step.src);
    if (!existsSync(srcAbs)) {
      throw new Error(`源缺失: ${srcAbs} —— product 产物不完整，请检查 v9-1 产物构建`);
    }
    const files = await walkFiles(srcAbs, step.dest);
    groups.push({ ...step, files, bytes: files.reduce((n, f) => n + f.size, 0) });
  }

  const resourcesFiles = groups.reduce((n, g) => n + g.files.length, 0);
  const resourcesBytes = groups.reduce((n, g) => n + g.bytes, 0);
  const grandFiles = resourcesFiles + 1; // +1 for node.exe
  const grandBytes = resourcesBytes + nodeExeFile.size;

  // 2. dry-run：只打印清单与汇总，不落盘；配合 --if-changed 可预览哪些会被跳过
  if (DRY_RUN) {
    log(`── node.exe（product/runtime/node.exe → bin/${nodeExeFile.rel}）: 1 个文件, ${formatBytes(nodeExeFile.size)}`);
    const nodeExeUnchanged = IF_CHANGED && (await isUnchanged(nodeExeFile, NODE_EXE_TARGET));
    log(`   ${nodeExeUnchanged ? "· 跳过(未变)" : "+ 复制"} ${nodeExeFile.rel} (${formatBytes(nodeExeFile.size)})`);
    for (const g of groups) {
      log(`── ${g.label}（product/${g.src} → resources/sidecar/${g.dest}）: ${g.files.length} 个文件, ${formatBytes(g.bytes)}`);
      for (const f of g.files) {
        const unchanged = IF_CHANGED && (await isUnchanged(f, path.join(RESOURCES_DIR, f.rel)));
        log(`   ${unchanged ? "· 跳过(未变)" : "+ 复制"} ${f.rel} (${formatBytes(f.size)})`);
      }
    }
    log(`dry-run 汇总: ${grandFiles} 个文件（node.exe 1 + resources ${resourcesFiles}）, 总大小 ${formatBytes(grandBytes)}；未写入任何文件`);
    return;
  }

  // 3. 全量模式先清空两个目标（坑 28 变种：被占用 → 清晰报错；增量模式保留目标做对比）
  if (!IF_CHANGED) {
    if (existsSync(RESOURCES_DIR)) {
      try {
        await rm(RESOURCES_DIR, { recursive: true, force: true });
        log("已清空旧 resources 目录");
      } catch (err) {
        throw wrapFsError(err, `清理 resources 目录 ${RESOURCES_DIR}`);
      }
    }
    if (existsSync(NODE_EXE_TARGET)) {
      try {
        await rm(NODE_EXE_TARGET, { force: true });
        log("已删除旧 node.exe（externalBin 占位/真身）");
      } catch (err) {
        throw wrapFsError(err, `删除旧 ${NODE_EXE_TARGET}`);
      }
    }
  }

  // 4. 复制 node.exe（单文件，bin/ 下）
  let nodeExeCopied = 0;
  let nodeExeSkipped = 0;
  if (IF_CHANGED && (await isUnchanged(nodeExeFile, NODE_EXE_TARGET))) {
    nodeExeSkipped = 1;
  } else {
    try {
      await mkdir(path.dirname(NODE_EXE_TARGET), { recursive: true });
      await copyFile(nodeExeFile.abs, NODE_EXE_TARGET);
      await utimes(NODE_EXE_TARGET, nodeExeFile.atime, nodeExeFile.mtime);
      nodeExeCopied = 1;
    } catch (err) {
      throw wrapFsError(err, `复制 node.exe → ${NODE_EXE_TARGET}`);
    }
  }
  log(
    `node.exe (externalBin): 复制 ${nodeExeCopied} 个 (${formatBytes(nodeExeFile.size)})` +
      (IF_CHANGED ? `, 跳过未变 ${nodeExeSkipped}` : ""),
  );

  // 5. 逐组复制 resources，每个大步骤打一行日志
  let copied = 0;
  let skipped = 0;
  let copiedBytes = 0;
  for (const g of groups) {
    let gCopied = 0;
    let gSkipped = 0;
    let gCopiedBytes = 0;
    for (const f of g.files) {
      const destAbs = path.join(RESOURCES_DIR, f.rel);
      if (IF_CHANGED && (await isUnchanged(f, destAbs))) {
        gSkipped += 1;
        continue;
      }
      try {
        await mkdir(path.dirname(destAbs), { recursive: true });
        await copyFile(f.abs, destAbs);
        // 写回源 mtime/atime —— 否则下次增量对比永远不等（见文件头"增量实现要点"）
        await utimes(destAbs, f.atime, f.mtime);
      } catch (err) {
        throw wrapFsError(err, `复制 ${f.rel}`);
      }
      gCopied += 1;
      gCopiedBytes += f.size;
    }
    copied += gCopied;
    skipped += gSkipped;
    copiedBytes += gCopiedBytes;
    log(
      `${g.label}: 复制 ${gCopied} 个文件 (${formatBytes(gCopiedBytes)})` +
        (IF_CHANGED ? `, 跳过未变 ${gSkipped}` : ""),
    );
  }

  log(
    `完成: 目标共 ${grandFiles} 个文件（node.exe ${nodeExeCopied + nodeExeSkipped} + resources ${copied + skipped}）, ` +
      `总大小 ${formatBytes(grandBytes)}; 本次复制 ${nodeExeCopied + copied} 个 (${formatBytes(nodeExeFile.size + copiedBytes)}), 跳过未变 ${nodeExeSkipped + skipped} 个`,
  );
}

main().catch((err) => {
  console.error(err?.message ?? err);
  if (err?.cause) console.error(`  原始错误: ${err.cause.message ?? err.cause}`);
  process.exitCode = 1;
});
