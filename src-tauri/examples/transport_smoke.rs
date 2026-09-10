// Isolated native HTTP harness: no Omega frontend, no vault plugin, no user keys.
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            println!("Native transport harness ready");
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(45));
                handle.exit(2);
            });
            Ok(())
        })
        .on_page_load(|_, payload| { println!("Native test page {:?}", payload.event()); })
        .run(tauri::generate_context!("transport-smoke/tauri.conf.json"))
        .expect("transport harness failed");
}
