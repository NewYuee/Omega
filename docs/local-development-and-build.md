# Omega 本地启动与多端编译

本文是 Omega v0.2 的本地开发、长期运行和多端打包操作手册。所有命令默认从仓库根目录执行。

```sh
cd /path/to/Omega
```

## 1. 环境准备

所有平台都需要：

- Node.js 22.18 或更高版本；
- 已安装依赖：`npm ci`；
- 服务端机器已安装并登录 Codex CLI，`codex app-server` 可以启动。

首次准备和基础检查：

```sh
node --version
codex --version
npm ci
npm run typecheck
npm test
```

Omega 默认把运行数据放在 `.omega/`，把 Web 构建产物放在 `web-dist/`，把桌面构建中间产物放在 `desktop-dist/`。这些目录和安装包均不应提交到 Git。

## 2. 本地启动

### 日常前台启动

```sh
npm start
```

该命令先构建 React Web 客户端，再启动 TypeScript 服务端和常驻 Codex App Server。浏览器打开：

```text
http://127.0.0.1:4310
```

首次连接所需密钥位于：

```sh
cat .omega/access-token
```

停止服务按 `Ctrl+C`。默认工作目录是 Omega 仓库的父目录；`OMEGA_WORKSPACE` 决定新建会话预填目录和群组协调者的目录。新建会话也可输入服务器上其他存在且服务进程可访问的文件夹；会话仍使用原有的执行审批设置。

### 本地开发循环

修改前端后先构建，再启动服务：

```sh
npm run web:build
node server.ts
```

当前 Web 构建不是独立热更新开发服务器；改动前端源码后需要再次运行 `npm run web:build` 并刷新页面。提交前建议运行：

```sh
npm run typecheck
npm test
npm run web:build
```

### 监督运行与后台服务

不安装系统服务时，可在当前终端运行带自动拉起能力的 supervisor：

```sh
npm run service:start
```

它仍占用当前终端；关闭终端后是否继续运行取决于你的终端会话管理器。

长期日用推荐安装当前用户服务：

```sh
npm run service:install
npm run service:status
```

macOS 使用 LaunchAgent，Linux 使用 systemd user service。日志位于：

```text
.omega/omega.out.log
.omega/omega.error.log
```

卸载用户服务：

```sh
npm run service:uninstall
```

安装服务之前应先执行一次 `npm run web:build`。如果源码更新包含前端改动，也应重新构建，然后通过页面控制中心或系统服务重启 Omega。

### 自定义运行参数

```sh
PORT=4310 \
OMEGA_HOST=127.0.0.1 \
OMEGA_WORKSPACE=/path/to/projects \
OMEGA_STATE_DIR=/path/to/Omega/.omega \
OMEGA_CODEX_BIN=codex \
OMEGA_ACCESS_TOKEN='至少8个字符' \
npm start
```

通常不需要设置 `OMEGA_ACCESS_TOKEN`；留空时 Omega 自动生成并持久化密钥。显式设置后，Web 设置页不能修改该密钥。

## 3. Web 与多设备连接

本机测试使用 `http://127.0.0.1:4310`。另一台电脑可先建立 SSH 隧道：

```sh
ssh -N -L 4310:127.0.0.1:4310 USER@SERVER
```

然后在客户端设备打开 `http://127.0.0.1:4310`，输入服务器 `.omega/access-token` 中的同一密钥。

通过 FRP 或反向代理对外提供服务时，服务端仍建议只监听 loopback，由代理转发。公网长期使用必须配置 HTTPS，并关闭代理的 SSE 缓冲；HTTP 明文会暴露密钥和聊天内容。

## 4. Electron 桌面端

Windows 和 macOS 的正式桌面路线是 Electron。桌面 App 是 Omega 客户端，不内置另一套服务端；启动后填写正在运行的 Omega 服务地址和访问密钥。

### 开发运行

先启动服务端，再另开终端：

```sh
npm run desktop:dev
```

### macOS 打包

在 macOS 上执行：

```sh
npm run desktop:package -- --mac
```

输出位于 `release/`，包含 DMG 和 ZIP。当前未配置 Developer ID 签名和 Apple 公证，外部分发前需要补充证书和公证流程。

### Windows 打包

应在 Windows 机器上安装 Node.js 后执行：

```powershell
npm ci
npm run typecheck
npm run desktop:package -- --win
```

NSIS 安装包输出到 `release\`。当前未配置 Authenticode 签名，公开分发时 Windows 可能提示未知发布者。跨平台强行打包不能代替目标系统实机验收。

## 5. Android APK

Android 使用 Tauri 2 外壳并复用同一 React 客户端。需要：

- Rust 工具链；
- Android Studio 或 Android SDK Command-line Tools；
- Android Platform、Build Tools；
- NDK 28.2.13676358；
- JDK 21；
- 已接受 Android SDK 许可。

Omega 会优先使用仓库内已有的 `.toolchains/android-sdk`、`.toolchains/cargo` 和 Homebrew JDK 21；其他机器应正确设置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`。

首次生成 Android 工程：

```sh
npm ci
npm run mobile:android:init
```

构建适合大多数实体 Android 手机的调试 APK：

```sh
npm run mobile:android:build -- --debug --target aarch64
```

APK 位于：

```text
src-tauri/gen/android/app/build/outputs/apk/
```

连接开启 USB 调试的手机后安装：

```sh
adb devices
adb install -r APK路径
```

调试包只用于本地测试。发布到应用商店前必须创建并妥善保管自己的签名密钥，配置 release signing，再生成 AAB/APK；签名文件和密码不能提交到仓库。

构建经过优化、但无需手动执行签名工具的本地 Release APK：

```sh
npm run mobile:android:build:local-release -- --target aarch64
```

该命令会构建 Release、执行 `zipalign`，并优先使用 `OMEGA_ANDROID_*` 环境变量指定的证书签名；未配置时使用或自动创建本机 Android 调试证书。最终文件名为 `Omega-aarch64-release-local-signed.apk`。这是可安装的 Release 构建，但本机调试证书不适合应用商店发布。

## 6. GitHub Actions 构建

`.github/workflows/build.yml` 仅接受仓库所有者触发，在所有者推送到 `main`、推送 `v*` 标签或手动启动时运行。外部贡献者提交 Pull Request 不会自动消耗构建额度；即使拥有协作权限的其他账号尝试手动触发，构建任务也会被所有者身份门禁跳过。

- TypeScript 检查、测试和 Web 构建；
- ARM64 Android Release APK；
- macOS Electron DMG/ZIP；
- Windows x64 Electron NSIS 安装程序。

`main` 推送和 **Actions → Build Omega → Run workflow** 仅执行源码验证，不构建安装包。仅仓库所有者推送新 `v*` 标签时才构建安装包。

所有平台构建成功后，独立发布任务下载本次运行的三个平台产物，检查 APK、DMG、ZIP、EXE 均存在，再上传到标签对应的 GitHub Release。不存在 Release 时先创建草稿，上传成功后发布；已有 Release 保留说明。重跑会更新同名附件。只有发布任务拥有 `contents: write`，其他任务保持只读；发布还检查重跑发起者是否为仓库所有者。

安装包也可从该次运行的 **Artifacts** 下载，那里默认保留 14 天。Release 附件不受此保留期影响。旧标签使用旧版工作流，修改本文件不会自动给旧 Release 补传附件。

Android 未配置 Secrets 时使用该次 Runner 临时生成的证书，适合安装验证，但不同 CI 运行产物可能不能彼此覆盖安装。需要稳定升级或正式分发时，在仓库 Actions Secrets 中配置：

- `ANDROID_KEYSTORE_BASE64`：签名文件的 Base64 内容；
- `ANDROID_KEY_ALIAS`；
- `ANDROID_STORE_PASSWORD`；
- `ANDROID_KEY_PASSWORD`。

macOS 和 Windows 当前生成未做开发者身份签名的安装包，系统可能显示未知开发者提示。正式公开分发需要另外配置 Apple Developer、Notarization 和 Windows Authenticode 凭据。

Tauri 启动包装器只接受 Android/iOS 子命令；直接调用桌面 `dev` 或 `build` 会失败并提示改用 Electron。

## 7. 发布前检查清单

1. 确认 `git status` 不包含 `.omega/`、`web-dist/`、`desktop-dist/`、`release/`、`src-tauri/target/` 或 Android 构建产物。
2. 执行 `npm ci`、`npm run typecheck`、`npm test`、`npm run web:build`。
3. 在目标系统分别构建 Windows、macOS 和 Android 包。
4. 用真实 Omega 服务验证登录、断线重连、会话历史、图片、群组、通知和系统返回键。
5. 正式外发前配置 macOS、Windows、Android 各自的签名流程。
6. 记录版本号、提交号、构建机器、产物校验值和已知问题。

## 8. 常见问题

- 页面打不开：确认 `npm run service:status` 或前台服务输出，检查 4310 端口和日志。
- 提示 403：服务器地址或密钥不匹配；FRP/代理还需保留 Authorization，并正确转发 SSE。
- Android 构建只显示 Gradle 退出码：进入 `src-tauri/gen/android/` 运行 `./gradlew assembleDebug --stacktrace` 查看真正的底层错误。
- 手机不能访问 `127.0.0.1`：手机上的 loopback 指手机自己，应填写服务器可达的 HTTPS/FRP 地址。
- 桌面端重启后要求重新输入密钥：开发包或系统安全存储不可用；检查钥匙串/凭据管理器权限，正式包应完成签名。
