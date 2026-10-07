/**
 * fileCache — UI-3 Stage A2：/v1/files/read 的 UI 侧内存 LRU 缓存
 *
 * 职责：卡面预览等场景避免对同一本地文件反复发 POST /v1/files/read（SliceGrid
 * 快速连点 / 选中来回切换时尤其明显）。模块级单例，不依赖 React，可在任意
 * 组件 / hook 内直接 import 使用。
 *
 * 关键设计：
 *  - 容量 50 条，key = `${root}::${path}`（root 隔离不同图包的同名相对路径）；
 *  - LRU 驱逐：Map 迭代顺序 = 插入顺序，get 命中时 delete + set 把该条提升为
 *    最新，set 超容量时驱逐迭代器首位（最久未访问）；
 *  - 单条 base64 解码后 > 1MB 直接跳过（不进 Map），避免少数大图挤掉全部小图；
 *  - 只缓存在 root 内稳定的本地文件；游戏内对象 / SSE 事件不经过本模块。
 */

/** 一条缓存记录（size 为 base64 解码后的字节数） */
export interface CacheEntry {
  base64: string;
  mime: string;
  size: number;
  savedAt: number;
}

/** 容量（条数） */
const CAPACITY = 50;
/** 单条上限：base64 解码后字节数（1MB = 1024 × 1024） */
const MAX_ENTRY_BYTES = 1024 * 1024;

/** 模块级单例（Map 迭代顺序 = 插入顺序，即访问新近度） */
const store = new Map<string, CacheEntry>();

/** 缓存 key：root 内相对路径，root 隔离 */
function cacheKey(root: string, path: string): string {
  return `${root}::${path}`;
}

/** base64 解码后字节数（按 padding 修正，无需真实解码） */
function decodedBytes(base64: string): number {
  let pad = 0;
  if (base64.endsWith("==")) {
    pad = 2;
  } else if (base64.endsWith("=")) {
    pad = 1;
  }
  return Math.max(0, Math.floor((base64.length * 3) / 4) - pad);
}

/** 取缓存；命中时把该条提升为最新（LRU touch） */
export function getCachedFile(root: string, path: string): CacheEntry | undefined {
  const key = cacheKey(root, path);
  const hit = store.get(key);
  if (hit === undefined) return undefined;
  store.delete(key);
  store.set(key, hit);
  return hit;
}

/** 写缓存；解码后 > 1MB 的条目直接丢弃（return，不污染 Map），超容量驱逐最旧 */
export function setCachedFile(
  root: string,
  path: string,
  base64: string,
  mime: string,
): void {
  const size = decodedBytes(base64);
  if (size > MAX_ENTRY_BYTES) return;

  const key = cacheKey(root, path);
  // 覆盖写：先 delete 重置插入顺序（同 key 重读按最新计）
  store.delete(key);
  store.set(key, { base64, mime, size, savedAt: Date.now() });

  while (store.size > CAPACITY) {
    const oldest = store.keys().next();
    if (oldest.done === true) break;
    store.delete(oldest.value);
  }
}

/** 清空全部缓存（切图包 / 手动刷新时可用） */
export function clearFileCache(): void {
  store.clear();
}

/** 当前缓存条数 */
export function fileCacheSize(): number {
  return store.size;
}
