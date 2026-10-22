//! tts-hub sidecar 进程管理 — v9-2 窗口（施工方案 v0.9.0 §2.2 + §5.3，任务 A2）。
//!
//! 职责：tts-desktop 启动时自动拉起内嵌 tts-hub（方案 A：单 .exe externalBin + resources/sidecar/）；
//! 39995 已被外置 hub 占用时检查版本（>= 0.9.0 复用外置，过旧则报错提示用户选择）；
//! 退出时仅 kill 自己起的 sidecar（外置 hub 不动）。
//!
//! 布局（v9-2 Stage C 实测 Tauri 2 externalBin 只认单 .exe 文件，不支持目录形式）：
//! - node.exe → `bin/tts-hub-x86_64-pc-windows-msvc.exe`（dev）/ `<resource_dir>/tts-hub.exe`（release，在根不在 bin/）；
//! - dist/ + node_modules/ + native/ + locales/ + docs/ → `resources/sidecar/`。
//!
//! 分层（为单元测试服务，测试基线约定：不测真 spawn/TCP/HTTP）：
//! - 纯函数层：[`compare_semver`] / [`is_version_compatible`] / [`parse_hub_version_from_status`]，
//!   无 I/O，`#[cfg(test)]` 单元测试覆盖；
//! - 进程壳层：[`is_hub_running`] / [`check_hub_version`] / [`start_hub_sidecar`] / [`stop_hub_sidecar`]，
//!   真实进程 / TCP / HTTP I/O。

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use tauri::Manager;

/// tts-hub 控制通道端口（hub 侧硬编码默认，无环境变量覆盖，v9-2 契约）。
pub const HUB_PORT: u16 = 39995;

/// 外置 hub 可复用的最低版本（v9-2 契约：低于此版本提示用户关闭或升级外置 hub）。
pub const MIN_HUB_VERSION: &str = "0.9.0";

/// sidecar 启动后等待端口 LISTENING 的轮询次数（× [`STARTUP_WAIT_INTERVAL_MS`] = 5s）。
const STARTUP_WAIT_ATTEMPTS: u32 = 50;

/// 轮询间隔（ms）。
const STARTUP_WAIT_INTERVAL_MS: u64 = 100;

/// 首次启动超时后，重试前的等待时长（ms，施工方案 §2.2：重试 1 次）。
const RETRY_DELAY_MS: u64 = 200;

// ---------------------------------------------------------------------------
// 纯函数层（无 I/O，单元测试覆盖）
// ---------------------------------------------------------------------------

/// 简易 semver 比较 — 与 `tts-desktop/src/hub/capabilities.ts` 的 `compareSemver` 对齐。
///
/// 规则：按 "." 切段，逐段取前导数字解析为 u64（对齐 JS `parseInt` 语义：非数字段记 0），
/// 缺失段补 0 后逐段比较。
///
/// 与 capabilities.ts 的已知差异：本函数对超过 3 段的版本号继续逐段比较
/// （任务 A2 测试用例要求 `"0.9.0.1" > "0.9.0"`），TS 版只比较前三段（第 4 段起截断）。
pub fn compare_semver(a: &str, b: &str) -> Ordering {
    fn parse(v: &str) -> Vec<u64> {
        v.split('.')
            .map(|seg| {
                let digits: String = seg.chars().take_while(char::is_ascii_digit).collect();
                digits.parse::<u64>().unwrap_or(0)
            })
            .collect()
    }
    let (pa, pb) = (parse(a), parse(b));
    let len = pa.len().max(pb.len());
    for i in 0..len {
        let x = pa.get(i).copied().unwrap_or(0);
        let y = pb.get(i).copied().unwrap_or(0);
        if x != y {
            return x.cmp(&y);
        }
    }
    Ordering::Equal
}

/// 外置 hub 版本兼容判定：`external >= required` 返回 true。
///
/// 空字符串 / 缺版本号解析为全 0 段，必然低于 required，返回 false。
pub fn is_version_compatible(external: &str, required: &str) -> bool {
    compare_semver(external, required) != Ordering::Less
}

/// 从 GET /v1/status 响应 JSON 提取 hub 版本。
///
/// v9-2 契约：版本字段在 `hub.version`（**不是**顶层 `version`）。
/// 响应缺 `hub` / `version` 字段，或 `version` 非字符串（旧版 hub）时返回 None。
pub fn parse_hub_version_from_status(json: &serde_json::Value) -> Option<String> {
    json.get("hub")?
        .get("version")?
        .as_str()
        .map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// 进程壳层（真实 spawn / TCP / HTTP，不做单元测试）
// ---------------------------------------------------------------------------

/// hub 运行状态（启动序列返回值，前端 HubLauncher 据此区分 sidecar / 外置场景）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HubStatus {
    /// 39995 上是否有 hub 在跑
    pub running: bool,
    /// hub 版本（GET /v1/status 提取；端口通了但版本接口异常时为 None）
    pub version: Option<String>,
    /// true = 自己起的 sidecar；false = 外置 hub
    pub is_embedded: bool,
}

/// ⭐ 审批意见 §9：Child 非 Send，不能裸 `static Mutex<Option<Child>>`，
/// 必须 `once_cell::sync::Lazy<Mutex<Option<Child>>>` 包装。
static SIDECAR_CHILD: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

/// TCP 探测 127.0.0.1:port 是否 LISTENING。
///
/// 用 200ms `connect_timeout` 保证有界阻塞；loopback 上端口未监听时立即被拒（RST），
/// 不会拖满 200ms。只测端口连通性，不读 HTTP。
pub fn is_hub_running(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};

    format!("127.0.0.1:{port}")
        .parse::<SocketAddr>()
        .is_ok_and(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok())
}

/// GET /v1/status 提取 hub.version（外置 hub 版本检查，审批意见 §5）。
///
/// 请求 / JSON 解析失败返回 Err（含原因）；响应里没有 `hub.version` 也返回 Err。
/// 客户端带 3s 超时，避免外置 hub 假死时启动序列卡住。
pub async fn check_hub_version(port: u16) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{port}/v1/status");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("build http client: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parse /v1/status json: {e}"))?;
    parse_hub_version_from_status(&json).ok_or_else(|| "no hub.version in response".to_string())
}

/// 完整启动序列（施工方案 §5.3 + §2.2 修订）：
///
/// 1. 39995 已占用 → [`check_hub_version`]：>= [`MIN_HUB_VERSION`] 直接复用外置 hub（不起 sidecar）；
///    < [`MIN_HUB_VERSION`] 报错提示用户选择（关闭外置 / 升级）；无法通信 → 视为不兼容报错。
/// 2. 未占用 → spawn `node.exe + dist/cli/hub-main.js`（current_dir = hub 根目录，
///    ⭐ 必须是含 `native/` 的那层：sharp 运行时从 cwd 找 DLL）。
/// 3. 轮询 39995 LISTENING（最多 5s：50 次 × 100ms）。
/// 4. 超时 → kill 本次子进程，200ms 后重试 1 次。
/// 5. 重试仍超时 → Err（sidecar 启动失败，请查看日志）。
///
/// 契约（审批意见 §12）：sidecar 内嵌 hub 与 desktop 绑定必然兼容，前端对
/// `is_embedded == true` 的场景跳过版本检查；本函数对自起 sidecar 不做最低版本校验。
pub async fn start_hub_sidecar(app: &tauri::AppHandle) -> Result<HubStatus, String> {
    // 步骤 1：外置 hub 检测 + 版本检查
    if is_hub_running(HUB_PORT) {
        return match check_hub_version(HUB_PORT).await {
            Ok(version) => {
                if is_version_compatible(&version, MIN_HUB_VERSION) {
                    println!("[sidecar] external hub {version} running, skip sidecar");
                    Ok(HubStatus {
                        running: true,
                        version: Some(version),
                        is_embedded: false,
                    })
                } else {
                    Err(format!(
                        "外置 hub 版本过旧（{version}），tts-desktop 需要 hub >= {MIN_HUB_VERSION}。\n\
                         请选择：(A) 关闭外置 hub 让内嵌 sidecar 启动；(B) 升级外置 hub"
                    ))
                }
            }
            Err(e) => Err(format!("外置 hub 无法通信：{e}")),
        };
    }

    // 步骤 2：未占用 → 解析 hub 目录与 node.exe 路径并启动 sidecar
    let hub_root = resolve_hub_root(app)?;
    let node_exe = resolve_node_exe(app)?;
    spawn_hub_process(&node_exe, &hub_root)?;

    // 步骤 3：等待 39995 LISTENING（最多 5s）
    if wait_for_hub().await {
        println!("[sidecar] hub started");
        return Ok(embedded_status().await);
    }

    // 步骤 4：超时 → kill 后重试 1 次
    eprintln!("[sidecar] first attempt timeout, retrying...");
    stop_hub_sidecar();
    tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
    spawn_hub_process(&node_exe, &hub_root)?;
    if wait_for_hub().await {
        println!("[sidecar] hub started (retry)");
        return Ok(embedded_status().await);
    }

    // 步骤 5：重试仍超时
    eprintln!("[sidecar] hub did not listen on {HUB_PORT} within 5s after retry");
    Err("sidecar 启动失败，请查看日志".to_string())
}

/// 仅 kill 自己起的 sidecar（[`SIDECAR_CHILD`].take()）；外置 hub 不受影响（§2.2 关闭序列）。
///
/// 未起过 sidecar 时为空操作。窗口 `on_close_requested` 钩子调用（v9-2 任务 7）。
pub fn stop_hub_sidecar() {
    let child = SIDECAR_CHILD.lock().expect("SIDECAR_CHILD poisoned").take();
    if let Some(mut child) = child {
        let _ = child.kill();
        // 回收子进程，避免残留句柄
        let _ = child.wait();
        println!("[sidecar] hub killed");
    }
}

/// 查询 SIDECAR_CHILD 中是否有仍存活的 sidecar 子进程（v9-4 hotfix）。
///
/// - 无 sidecar 记录 → false（外置 hub 场景或未启动）
/// - 有记录且 `try_wait` 返回 `Ok(None)` → true（子进程仍在跑）
/// - 有记录但子进程已退出（`Ok(Some(_))`）/ 查询失败 → false（副作用：不清理，
///   清理由 [`stop_hub_sidecar`] 负责——它 take() 掉后本函数自然归 false）
///
/// 前端 HubLauncher 据此跳过 sidecar 场景的版本检查（审批意见 §12：
/// sidecar 与 desktop 绑定必然兼容）。
pub fn is_sidecar_alive() -> bool {
    let mut guard = SIDECAR_CHILD.lock().expect("SIDECAR_CHILD poisoned");
    match guard.as_mut() {
        None => false,
        Some(child) => matches!(child.try_wait(), Ok(None)),
    }
}

/// spawn `node_exe + dist/cli/hub-main.js` 并登记到 [`SIDECAR_CHILD`]。
///
/// ⭐ `Command::new()` / `.arg()` 自动处理含空格路径（如 `C:\Program Files\TTS工作台\`），
/// 不要手动加引号；`.arg()` 传 `hub-main.js` 绝对路径，不依赖 cwd 解析。
/// ⭐ current_dir 必须是 hub_root（含 native/ 的那层）：sharp 运行时从 cwd 找 libvips DLL。
/// ⭐ Windows UNC 路径坑：`current_exe()` / `resource_dir()` 返回 `\\?\D:\...` 前缀路径，
/// node.exe 的 `lstat` 不认 `\\?\` 前缀（报 `EISDIR: illegal operation on a directory, lstat 'D:'`），
/// 必须用 `dunce_canonicalize` 风格去前缀后再传给 `Command::new()`。
fn spawn_hub_process(node_exe: &Path, hub_root: &Path) -> Result<(), String> {
    let node_exe_clean = strip_unc_prefix(node_exe);
    let hub_main = hub_root.join("dist").join("cli").join("hub-main.js");
    let hub_main_clean = strip_unc_prefix(&hub_main);
    let hub_root_clean = strip_unc_prefix(hub_root);
    let mut cmd = Command::new(&node_exe_clean);
    cmd.arg(&hub_main_clean)
        .current_dir(&hub_root_clean);
    #[cfg(windows)]
    {
        // release 下主程序无控制台（windows_subsystem），不设此标志 node 会闪黑框
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("spawn hub ({node_exe_clean:?}): {e}"))?;
    *SIDECAR_CHILD.lock().expect("SIDECAR_CHILD poisoned") = Some(child);
    println!("[sidecar] spawned: {} {}", node_exe_clean.display(), hub_main_clean.display());
    Ok(())
}

/// 去掉 Windows `\\?\` UNC 前缀（`\\?\D:\foo` → `D:\foo`）。
///
/// `std::env::current_exe()` / `tauri::path().resource_dir()` 在 Windows 上返回带 `\\?\` 前缀的
/// 绝对路径，node.exe 的 `fs.lstat` 不认这种格式（会把 `D:` 当目录）。本函数把前缀剥掉，
/// 返回普通盘符路径。非 `\\?\` 路径原样返回。
fn strip_unc_prefix(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        p.to_path_buf()
    }
}

/// 轮询等待 39995 LISTENING（[`STARTUP_WAIT_ATTEMPTS`] × [`STARTUP_WAIT_INTERVAL_MS`] = 5s）。
async fn wait_for_hub() -> bool {
    for _ in 0..STARTUP_WAIT_ATTEMPTS {
        if is_hub_running(HUB_PORT) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(STARTUP_WAIT_INTERVAL_MS)).await;
    }
    false
}

/// sidecar 已 LISTENING 后组装 [`HubStatus`]（is_embedded = true）。
///
/// version 仅作展示用，不做最低版本校验（审批意见 §12：内嵌必然兼容）。
async fn embedded_status() -> HubStatus {
    HubStatus {
        running: true,
        version: check_hub_version(HUB_PORT).await.ok(),
        is_embedded: true,
    }
}

/// 解析内嵌 hub 根目录（current_dir，含 `dist/cli/hub-main.js`、`native/` 的那一层）。
///
/// ⭐ 方案 A 布局（v9-2 Stage C 实测 Tauri 2 externalBin 只认单 .exe 后的调整）：
/// - release：`<resource_dir>/resources/sidecar/`（tauri.conf.json 的 bundle.resources）；
/// - dev：resource_dir 指向 `target/debug/`，resources 实际在源码 `src-tauri/resources/sidecar/`，
///   用 `std::env::current_exe()` 反推 src-tauri（exe 位于 `<src-tauri>/target/debug/` 下）。
fn resolve_hub_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1) release / tauri 资源目录：<resource_dir>/resources/sidecar/
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("resources").join("sidecar");
        if is_hub_root(&candidate) {
            return Ok(candidate);
        }
    }
    // 2) dev fallback：current_exe() = <src-tauri>/target/debug/tts-desktop(.exe)
    //    ancestors() = [exe, debug, target, src-tauri, ...] → nth(3) = src-tauri
    if let Ok(exe) = std::env::current_exe() {
        if let Some(src_tauri) = exe.ancestors().nth(3) {
            let candidate = src_tauri.join("resources").join("sidecar");
            if is_hub_root(&candidate) {
                return Ok(candidate);
            }
        }
    }
    Err(
        "未找到内嵌 hub 根目录（resources/sidecar/，需含 dist/cli/hub-main.js 与 native/）；\
         请先运行 scripts/copy-product.mjs 同步产物"
            .to_string(),
    )
}

/// 解析 sidecar 的 node.exe 路径（方案 A：单 .exe + resources 分离）。
///
/// - release：`<resource_dir>/tts-hub.exe`（externalBin 打包后放 resource_dir 根，自动去 target-triple 后缀）；
/// - dev：`src-tauri/bin/tts-hub-x86_64-pc-windows-msvc.exe`（开发期带 target-triple）。
fn resolve_node_exe(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1) release / tauri 资源目录：<resource_dir>/tts-hub.exe（⭐ 实测：在根，不在 bin/ 子目录）
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("tts-hub.exe");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    // 2) dev fallback：current_exe() 反推 src-tauri，bin/tts-hub-x86_64-pc-windows-msvc.exe
    if let Ok(exe) = std::env::current_exe() {
        if let Some(src_tauri) = exe.ancestors().nth(3) {
            let candidate = src_tauri
                .join("bin")
                .join("tts-hub-x86_64-pc-windows-msvc.exe");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err(
        "未找到 sidecar node.exe（<resource_dir>/tts-hub.exe 或 src-tauri/bin/tts-hub-x86_64-pc-windows-msvc.exe）；\
         请先运行 scripts/copy-product.mjs 同步产物"
            .to_string(),
    )
}

/// 判断目录是否为 hub 根：含 `dist/cli/hub-main.js` 与 `native/`（sharp DLL）。
fn is_hub_root(dir: &Path) -> bool {
    dir.join("dist").join("cli").join("hub-main.js").is_file() && dir.join("native").is_dir()
}

// ---------------------------------------------------------------------------
// 单元测试（只测纯函数层，不测 spawn / TCP / HTTP）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- compare_semver：6 组（任务 A2 指定用例） ----

    #[test]
    fn compare_semver_older_is_less() {
        assert_eq!(compare_semver("0.7.0", "0.9.0"), Ordering::Less);
    }

    #[test]
    fn compare_semver_same_is_equal() {
        assert_eq!(compare_semver("0.9.0", "0.9.0"), Ordering::Equal);
    }

    #[test]
    fn compare_semver_numeric_not_lexicographic() {
        // 逐段数值比较："0.10.0" > "0.9.0"（字典序会得出相反结果）
        assert_eq!(compare_semver("0.10.0", "0.9.0"), Ordering::Greater);
    }

    #[test]
    fn compare_semver_pads_missing_segments() {
        // 短版本号补零："0.9" == "0.9.0"
        assert_eq!(compare_semver("0.9", "0.9.0"), Ordering::Equal);
    }

    #[test]
    fn compare_semver_compares_extra_segments() {
        // 长版本号逐段比："0.9.0.1" > "0.9.0"（较 TS 版 compareSemver 的三段截断略有扩展）
        assert_eq!(compare_semver("0.9.0.1", "0.9.0"), Ordering::Greater);
    }

    #[test]
    fn compare_semver_non_numeric_segment_counts_as_zero() {
        // 非数字段记 0："abc" → [0] < "0.9.0"
        assert_eq!(compare_semver("abc", "0.9.0"), Ordering::Less);
    }

    // ---- is_version_compatible：边界 4 组 ----

    #[test]
    fn compatible_exactly_equal() {
        // 恰好等于 → 兼容
        assert!(is_version_compatible("0.9.0", "0.9.0"));
    }

    #[test]
    fn incompatible_below_required() {
        // 低于 → 不兼容
        assert!(!is_version_compatible("0.8.9", "0.9.0"));
    }

    #[test]
    fn incompatible_empty_version() {
        // 空字符串解析为全 0 段 → 不兼容
        assert!(!is_version_compatible("", "0.9.0"));
    }

    #[test]
    fn compatible_above_required() {
        // 高于 → 兼容
        assert!(is_version_compatible("0.10.0", "0.9.0"));
    }

    // ---- parse_hub_version_from_status：3 组 ----

    #[test]
    fn parses_hub_version_from_status() {
        // 完整响应示例（v9-2 契约）：版本在 hub.version
        let json: serde_json::Value = serde_json::from_str(
            r#"{"ok":true,"hub":{"version":"0.9.0","appMode":"standalone"},"tts":{"connected":false}}"#,
        )
        .unwrap();
        assert_eq!(
            parse_hub_version_from_status(&json),
            Some("0.9.0".to_string())
        );
    }

    #[test]
    fn returns_none_when_hub_field_missing() {
        // 缺 hub 字段（旧版响应）→ None
        let json: serde_json::Value = serde_json::from_str("{}").unwrap();
        assert_eq!(parse_hub_version_from_status(&json), None);
    }

    #[test]
    fn returns_none_when_version_field_missing() {
        // hub 存在但缺 version → None
        let json: serde_json::Value = serde_json::from_str(r#"{"hub":{}}"#).unwrap();
        assert_eq!(parse_hub_version_from_status(&json), None);
    }

    // ---- HubStatus 序列化 / 反序列化 round-trip ----

    #[test]
    fn hub_status_serialization_round_trip() {
        let status = HubStatus {
            running: true,
            version: Some("0.9.0".to_string()),
            is_embedded: true,
        };
        let json = serde_json::to_string(&status).unwrap();
        let back: HubStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(back.running, status.running);
        assert_eq!(back.version, status.version);
        assert_eq!(back.is_embedded, status.is_embedded);
    }
}
