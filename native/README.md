# Omega App · v0.2.0

原生客户端复用现有聊天界面，使用本机打包的资源和原生 HTTP/SSE，连接同一个 Omega 服务端。客户端不启动 Codex、不复制服务器的登录令牌，也不另外保存整份聊天历史。

## 本次交付状态

- macOS Apple Silicon：已构建本地测试版 `src-tauri/target/release/bundle/macos/Omega.app`，约 8.4 MB。未进行 Developer ID 签名或 Apple 公证；不是正式公开发行包。
- Windows：Rust/JS 客户端与凭据存储分支已提供；须在 Windows 上编译、测试 NSIS 安装包，本机未生成 .exe 安装包。
- Android：已提供 Tauri 配置、Keystore 加密存储和返回键处理；官方 Android 工程生成与 APK 构建需要 SDK/NDK。本机缺少这些环境，尚未编译 Kotlin 或验证真机文件选择/键盘，未生成 APK。

## 本机测试

先保持 Omega 服务端运行：

```sh
npm start
```

打开 `src-tauri/target/release/bundle/macos/Omega.app`。本机服务器填写 `http://127.0.0.1:4310`，勾选“允许 HTTP 明文连接”，输入现有服务器访问密钥即可。

其他电脑/手机不能用这个 loopback 地址连接此 Mac，请填写你现有的 FRP 地址（包括端口），或 HTTPS 地址。地址仅接受根域名，不支持子路径部署，不要把密钥放入地址中。客户端不会创建或修改 FRP、证书或防火墙配置。

连接设置里可切换服务端、重新填写密钥，也可忘记本机连接。切换会重新载入本机界面，未发送草稿不会保留；不会停止服务器上的任务。不同服务端的上次会话选择独立保存。修改“访问密钥”仍是修改服务端密钥，其他设备需要重新连接。

## 已实现

- 会话按需加载、历史问答、流式输出、重命名/删除、模型与推理设置、轮次统计沿用 Web。
- 图片选择、粘贴、拖拽与按需预览复用现有接口；服务端仍按 7 天清理。
- 密钥使用 macOS Keychain / Windows Credential Manager；Android 使用 Keystore 非导出 AES-GCM 密钥，加密后的连接配置写入应用私有存储。
- 原生版本不把密钥写入 localStorage/sessionStorage；安全保存失败会报错，不降级成明文文件。
- 前台恢复、网络恢复时重连和读取快照，不自动重发消息、不清空当前输入。
- Android 返回键优先关闭对话框/全屏编辑；没有对话框时回到后台，保留当前进程的草稿。系统回收进程后，未发送草稿不保证恢复。
- 外部 HTTP(S) 链接交给系统浏览器；客户端窗口只允许本机应用资源导航。

## 安全边界

HTTP 的允许选项只是兼容，不是加密。HTTP 会暴露访问密钥、消息和图片，公网建议配置 HTTPS。HTTPS 始终校验证书，禁止重定向，防止密钥跟随到另一个地址。

原生请求通过官方 HTTP 插件的 `unsafe-headers` 特性显式传入空 Origin，插件随后移除该头，避免自动注入 `tauri://localhost` 导致服务端 403。此配置不关闭服务端 Origin 检查、不跳过密钥认证，也不关闭 TLS 证书校验。

网络能力仅授予本机打包界面，允许用户指定 HTTP(S) 主机/端口的 `/api/*`；没有给远程网页授予 IPC，也没有开放 shell 或文件系统能力。JS 适配器进一步限制为当前服务端的 API 路径。不要把远程网页 URL 改成 Tauri window.url。

密钥运行时仍会进入应用内存以发送认证请求；系统安全存储保护静态保存，不防御已控制当前用户会话的恶意程序。当前是个人单用户访问权限。

## 开发与构建

需要 Node.js 22+ 和 Rust。使用 `npm ci` 安装锁定依赖。本次在项目 `.toolchains/` 安装了独立 Rust，未修改系统 shell；`native/tauri.mjs` 自动优先使用它，其他机器可使用正常安装的 Rust。

```sh
npm run native:dev
npm run native:build -- --bundles app
```

macOS 开发需要 Xcode Command Line Tools。Apple Silicon 和 Intel 分别在对应机器构建；要做 universal 包需安装两个 Rust targets 后指定 `--target universal-apple-darwin`，此目标尚未验证。

Windows：安装 Microsoft C++ Build Tools（桌面 C++ 工作负载）、WebView2 和 Rust MSVC 工具链，在 Windows 终端运行：

```powershell
npm ci
npm run native:build -- --bundles nsis
```

输出在 `src-tauri/target/release/bundle/nsis/`。未配置代码签名，Windows 可能显示未知发布者提示；正式分发需自己的签名证书。

Android：先安装 Android Studio / SDK Command-line Tools、平台 SDK、Build Tools、NDK（Side by side）和 JDK 21；阅读并自行接受 SDK 许可。设置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME` 为实际目录，然后：

```sh
npm ci
npm run native:android:init
npm run native:android:build -- --debug --target aarch64
```

`init` 调用官方生成器创建 `src-tauri/gen/android/`，随后只修改生成的 Manifest：禁用备份、开启明文传输兼容。依赖的精确 SDK/NDK 版本以生成工程及构建错误提示为准，不伪造本机 SDK 路径。

测试 APK 在 `src-tauri/gen/android/app/build/outputs/apk/`，可用 `adb install -r APK路径` 安装。发布版需要你的 Android 签名密钥，不能用临时测试密钥冒充正式签名，也不要把签名密钥提交进仓库。

官方环境说明：[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)、[Android distribution](https://v2.tauri.app/distribute/google-play/)。

## 验证与边界

```sh
npm test
node native-smoke.mjs
node native-transport-smoke.mjs
```

`native-smoke.mjs` 使用模拟的原生 IPC/HTTP 边界和临时本地页面，检查 390/1280px 视口下连接、HTTP 同意、错误密钥不保存、服务端切换隔离、历史、恢复不重发、全屏返回和发送；不调用模型，不接触真实钥匙串。可用 `CHROME_PATH` 指定 Chrome。

Rust `src-tauri/tests/network_scope.rs` 使用与官方 HTTP 插件相同的 URLPattern 实现验证自定义端口、IPv6 和 API 路径隔离：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --release --test network_scope
```

模拟边界测试不等同于 Android/Windows 真机验收，也不证明系统凭据库已完成端到端验证。macOS 实际原生窗口已打开检查；其余平台仍需在目标系统构建测试。

`native-transport-smoke.mjs` 构建独立的 macOS WebView 测试窗口，连接临时本地假服务。使用固定的无权限测试值、不加载 Omega 界面或钥匙串，验证真实插件可复现 403、修复后认证头保留且 Origin 消失、SSE 分块读取与取消。它不会向公网或真实服务发送密钥。

第一版不包含自动更新、推送通知、离线发送、跨设备同步未发送草稿、本机文件浏览器或后台常驻服务。关闭客户端不会停止服务器任务；服务器必须保持运行和可访问。包内只包含显式允许的前端文件，不包含 `.omega/`、密钥或工作目录。
