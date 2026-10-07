/**
 * sha256 — UI-2 Stage A1：base64 内容摘要（施工方案 v0.8.0 §13）
 *
 * 供编辑器保存（PUT /v1/files/write）前计算乐观锁 baseSha256：
 * 对 filesRead 返回的 base64 原文取 SHA-256，随写请求回传给 hub 与
 * baseline 比对，不符则 409 HUB_CONFLICT，防止覆盖他人改动。
 *
 * 纯浏览器 Web Crypto 实现：不加 try/catch，错误原样冒泡给调用方。
 */

/**
 * 计算 base64 编码字节流的 SHA-256 十六进制摘要（小写）。
 * 用于 /v1/files/write 的乐观锁 baseSha256。
 *
 * @param b64 base64 字符串（来自 filesRead 的响应）
 * @returns 64 字符小写 hex 字符串
 * @throws Error 当 base64 解码失败或 crypto.subtle 不可用
 */
export async function sha256Hex(b64: string): Promise<string> {
  if (typeof crypto === "undefined" || crypto.subtle === undefined) {
    throw new Error("crypto.subtle 不可用：需要安全上下文（HTTPS / localhost）");
  }

  // base64 → binary string → 字节数组（atob 对非法输入抛 InvalidCharacterError，原样冒泡）
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
