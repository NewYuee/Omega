# Omega Android App · v0.2.3

Omega 的 Tauri 工程现在只承担移动端容器职责。Windows 和 macOS 桌面客户端统一使用 Electron，不再提供 Tauri 桌面开发、`.app` 或 NSIS 构建入口。

Android 客户端复用 Web/Electron 使用的 React 产品层，通过原生 HTTP/SSE 连接同一个 Omega 服务端。客户端不启动 Codex、不复制服务器登录令牌，也不保存第二份完整聊天历史。

## 已实现

- 会话按需加载、历史问答、流式输出、重命名/删除、群组、模型与推理设置、轮次统计复用共享前端。
- 图片选择、粘贴、拖拽与按需预览使用同一服务接口；服务端仍按 7 天清理。
- Android 使用 Keystore 非导出 AES-GCM 密钥，加密后的连接配置写入应用私有存储。
- 前台或网络恢复时重新连接并读取服务端状态，不自动重发消息。
- Android 返回键优先关闭弹窗和全屏编辑；无弹窗时让应用进入后台。
- 外部 HTTP(S) 链接交给系统浏览器，应用窗口只允许本地打包资源导航。

## 环境准备

需要 Node.js 22+、Rust、Android Studio 或 SDK Command-line Tools、Android Platform、Build Tools、NDK 28.2.13676358 和 JDK 21，并接受 Android SDK 许可。

仓库的 `native/tauri.mjs` 会优先使用已有 `.toolchains/android-sdk`、`.toolchains/cargo` 和 Homebrew JDK 21；其他机器应设置正确的 `JAVA_HOME`、`ANDROID_HOME` 和 `NDK_HOME`。

## 构建 APK

首次生成 Android 工程：

```sh
npm ci
npm run mobile:android:init
```

构建大多数实体 Android 手机使用的 ARM64 调试包：

```sh
npm run mobile:android:build -- --debug --target aarch64
```

APK 输出目录：

```text
src-tauri/gen/android/app/build/outputs/apk/
```

安装到已开启 USB 调试的设备：

```sh
adb devices
adb install -r APK路径
```

发布版必须配置自己的 Android 签名密钥；签名文件和密码不能提交到仓库。

## 连接与安全边界

本机服务地址为 `http://127.0.0.1:4310`，但手机上的 `127.0.0.1` 指手机自身。真机应填写服务器可达的 HTTPS 或 FRP 地址。HTTP 明文兼容选项不提供加密，公网长期使用应配置 HTTPS。

原生 HTTP 插件只允许访问用户所选服务器的 `/api/*`，不开放 shell 和任意文件系统能力。访问密钥运行时仍会进入应用内存；Keystore 保护静态保存，不防御已控制手机系统或当前进程的恶意程序。

## 验证

```sh
npm test
node native-smoke.mjs
node native-transport-smoke.mjs
cargo test --manifest-path src-tauri/Cargo.toml --release --test network_scope
```

测试脚本仍沿用 `native-*` 文件名，因为它们验证的是移动端原生桥接协议。`native-transport-smoke.mjs` 使用独立的 macOS WebView 测试宿主验证 HTTP 插件行为，不是已保留的 Tauri 桌面产品。

模拟测试不能代替 Android 真机的键盘、安全区域、返回键、文件选择和网络恢复验收。关闭客户端不会停止服务器任务；服务器必须持续运行且可访问。
