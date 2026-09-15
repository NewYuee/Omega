# Omega 来源与许可证核对

核对日期：2026-09-15。基线：`08e4bae`。自有代码许可证：Apache-2.0；当前状态：维护者已确认独立实现，第三方产物审计待补齐。本文不是法律意见或授权书。

## 结论

维护者在本次核对中确认：“没有实际复制或改写过重建仓库的代码、图片等素材，仅参考功能和交互。”据此为 Omega 自有代码添加标准 Apache-2.0 LICENSE、NOTICE，更新 npm 与自有 Rust 包元数据及 README。该确认属于维护者来源声明，而不是扫描工具给出的独立创作证明。

第三方依赖和生成材料保留各自授权；上述变更不代表所有安装包已完成许可合规。桌面打包清单已纳入根 LICENSE/NOTICE，但第三方完整声明收集及其他端的产物核对仍待完成。

## 已核对的来源

| 范围 | 本地证据 | 结论与缺口 |
| --- | --- | --- |
| Grok Bot 重建仓库 | 相邻 `grok-bot-0.18-reconstructed/NOTICE.md`、`PROVENANCE.md` | 来自公开分发的二进制重建，明确不授予上游源码许可；不能当作可自由复制的开源上游 |
| Omega 与重建仓库对比 | 当前 Git 跟踪的 TS/TSX/JS/MJS/CSS/SVG，与重建仓库相同扩展文件去空白后比较；排除依赖、Git、研究安装包，文件小于 2MB，标准化长度大于 150 | 整文件完全匹配为 0；不覆盖片段复制、改名改写、历史版本、其他文件类型，不证明独立创作 |
| 桌面入口 | `desktop/main.ts`、`desktop/preload.ts`，以及重建仓库 `source/electron-main/application-menu.ts` 抽查 | 当前入口使用 Omega 自己的连接配置和 IPC；与被抽查的菜单模块组织不同，仍不是全模块来源证明 |
| 迁移设计记录 | `docs/grok-bot-client-reuse-plan.md` | 历史计划明确允许迁移可读模块、保留部分 UI/逻辑；需要实施者确认实际迁移清单，不能把 README 的产品独立描述当成清洁室证明 |
| Codex 生成类型 | `src/generated/codex/` 共 847 个文件，有 ts-rs 生成标记；在 `6780da9` 引入 | 缺少生成命令、精确上游版本和归属清单；应从固定版本官方来源重生成并保留其声明，或先证明无依赖再移除；本次未删除 |
| npm 依赖 | `package-lock.json`，本地 sharp/libvips README | 存在 LGPL 原生库及复合许可证表达式；不能仅依据 sharp 顶层 Apache-2.0 判断整个分发物 |
| Rust 依赖 | `src-tauri/Cargo.lock` 与本地 registry 缓存 | 初步扫描有 186 个锁定包未缓存；离线 cargo metadata 在缺失 async-broadcast 0.7.2 时失败，尚非完整审计 |
| 图标、字体、安装包 | 简单 Omega SVG 和 Android 图标等仍需源文件来源记录 | 尚未逐项确认创作者及生成输入；构建工具及 Electron/Chromium、Gradle 依赖也需按实际产物清点 |

## 可重复检查

```sh
node scripts/license-inventory.mjs
# 仅检查 npm 锁文件是否缺少 license 元数据，不代表法律合规通过：
node scripts/license-inventory.mjs --strict
```

输出包括所有 npm 锁定项（含构建依赖、可选平台）、版本、许可证表达式、来源及完整性信息。不要把仅生产依赖的清单当作安装包清单：Electron 等构建依赖也可能进入产物。输出不包含依赖许可证全文，也不能替代第三方声明。

## 发布前按顺序完成

1. **来源确认**：实施者列明从重建仓库直接复制、改写或参考实现的文件/片段，包括后续被改名、迁移的版本。有授权则存档授权依据；没有授权的实现应移除或依据公开功能需求独立替换。单纯改变量名不解决来源问题。
2. **生成代码固定来源**：记录官方仓库、tag/commit、生成器版本、命令、生成文件清单及适用的 LICENSE/NOTICE。不要把生成标记本身当作许可证明。
3. **依赖与产物核对**：补齐 Cargo/Gradle 清单，分别检查 Web、Android、Windows、macOS 实际发布内容；收集所分发版本的许可证全文及版权声明。sharp 预构建 libvips 包还包含其他原生库，须按其清单核对。LGPL 的源码获取、替换/重新链接等要求须结合实际链接及封装方式落实，不能用一个链接或顶层 Apache 声明代替。
4. **正式授权**：来源问题解决后，为有权授权的部分添加标准 Apache-2.0 LICENSE，更新包元数据与 README；第三方材料保留原许可证及必要声明，不改变原有授权。
5. **发布验收**：加入第三方声明收集和安装包内文件检查，缺失时阻止版本发布；确认后再打 release tag。当前检查脚本没有接入 CI，也没有改变现有发布权限。

第 1 项中的重建仓库来源事实已由维护者确认：未搬入或改写其代码及素材。第 4 项的自有代码授权配置已完成。历史迁移计划仅作为当时的方案记录，不代表实际执行过源码迁移；其余生成代码和第三方发布核对仍保持待办。

## 官方依据

- [Apache-2.0 正文](https://www.apache.org/licenses/LICENSE-2.0)：授权主体、再分发和声明保留义务。
- [OpenAI Codex LICENSE](https://github.com/openai/codex/blob/main/LICENSE)：仅作为官方来源入口，需进一步绑定实际生成版本。
- [sharp 安装与预构建依赖说明](https://sharp.pixelplumbing.com/install/)：原生预构建依赖及许可说明。
- [GNU LGPL v3](https://www.gnu.org/licenses/lgpl-3.0.html)：结合实际分发方式核对，不据此笼统判断整个 Omega 必须改用 LGPL。
