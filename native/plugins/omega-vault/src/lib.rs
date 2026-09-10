use tauri::{plugin::{Builder, TauriPlugin}, Runtime};
#[cfg(target_os = "android")]
use tauri::Manager;
#[cfg(target_os = "android")]
struct Vault<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.omega.workspace", "connection").map_err(|_| "无法访问系统凭据存储".into())
}
#[tauri::command]
async fn load<R: Runtime>(_app: tauri::AppHandle<R>) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return match entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("无法读取系统保存的连接，请解锁钥匙串后重试".into()),
    };
    #[cfg(target_os = "android")]
    {
        let value: serde_json::Value = _app.state::<Vault<R>>().0
            .run_mobile_plugin("load", ()).map_err(|_| "无法读取 Android 安全存储")?;
        return Ok(value.get("value").and_then(|v| v.as_str()).map(String::from));
    }
    #[cfg(not(any(target_os = "android", target_os = "macos", target_os = "windows")))]
    Err("此平台尚不支持安全存储".into())
}
#[tauri::command]
async fn save<R: Runtime>(_app: tauri::AppHandle<R>, value: String) -> Result<(), String> {
    if value.len() > 4096 { return Err("连接配置过长".into()); }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return entry()?.set_password(&value).map_err(|_| "无法保存到系统凭据存储".into());
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = _app.state::<Vault<R>>().0
            .run_mobile_plugin("save", serde_json::json!({"value":value})).map_err(|_| "无法保存到 Android 安全存储")?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "android", target_os = "macos", target_os = "windows")))]
    Err("此平台尚不支持安全存储".into())
}
#[tauri::command]
async fn clear<R: Runtime>(_app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("无法移除系统保存的连接".into()),
    };
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = _app.state::<Vault<R>>().0
            .run_mobile_plugin("clear", ()).map_err(|_| "无法移除 Android 保存的连接")?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "android", target_os = "macos", target_os = "windows")))]
    Err("此平台尚不支持安全存储".into())
}
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("omega-vault")
        .on_navigation(|_, url| {
            (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
        })
        .invoke_handler(tauri::generate_handler![load, save, clear])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(Vault(_api.register_android_plugin("com.omega.vault", "OmegaVaultPlugin")?));
            Ok(())
        }).build()
}
