// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 探测 tts-hub 控制通道端口是否可连（UI-1b，施工方案 v0.8.0 §8.2 方案 C）。
///
/// HubLauncher 启动时先经此命令做 TCP 探测（127.0.0.1:port），不通则弹引导对话框。
/// 只测端口连通性，不读 HTTP——版本 / appMode 由前端 `GET /v1/status` 再确认。
/// 返回 Ok(true)=端口可连，Ok(false)=不可连；参数非法时 Err(描述)。
/// JS 侧经 `invoke("check_hub", { port, timeoutMs })` 调用（Tauri 2 自动 camelCase↔snake_case）。
#[tauri::command]
fn check_hub(port: u16, timeout_ms: u64) -> Result<bool, String> {
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e| format!("invalid address 127.0.0.1:{port}: {e}"))?;
    Ok(TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms)).is_ok())
}

/// 检测系统是否安装 WebView2 Runtime。
///
/// 实现：查注册表 `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`，
/// 该键是 WebView2 Runtime 的官方安装标记（x64 系统）。x86 退化为查
/// `HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-...}`。
/// 返回 Some(version) 表示已装，None 表示缺失。
#[cfg(target_os = "windows")]
fn detect_webview2() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    const WEBVIEW2_CLIENT_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let candidate_paths = [
        format!(
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{}",
            WEBVIEW2_CLIENT_GUID
        ),
        format!(
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{}",
            WEBVIEW2_CLIENT_GUID
        ),
    ];

    for path in &candidate_paths {
        if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) {
            if let Ok(version) = key.get_value::<String, _>("pv") {
                if !version.is_empty() && version != "0.0.0.0" {
                    return Some(version);
                }
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn detect_webview2() -> Option<String> {
    // 非 Windows 平台不需要 WebView2（Tauri 用 webkitgtk / WKWebView）
    Some("non-windows".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // UI-1a 验收点：WebView2 启动检测钩子
            // 缺失时通过 stderr 警告 + 在窗口标题里追加提示（UI-4 再加原生对话框引导安装）
            match detect_webview2() {
                Some(version) => {
                    println!("[tts-desktop] WebView2 detected: {}", version);
                }
                None => {
                    eprintln!(
                        "[tts-desktop] WebView2 Runtime NOT detected. \
                         Please install from https://go.microsoft.com/fwlink/p/?LinkId=2124703"
                    );
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, check_hub])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
