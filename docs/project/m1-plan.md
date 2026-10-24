# M1：两端简体中文 / English 切换

配套规格：同目录 `requirements.md`。这是待执行任务清单，不代表已修改代码或通过测试。路径均相对于对应仓库；下列入口已通过 GitHub 只读检查，完整调用范围需在 checkout 搜索确认。

## 目标与范围

两端用户均能明确选择简体中文或英文；语言选择可以持久化。初次启动沿用现有语言解析规则，新增中文映射；至少识别 `zh-Hans` 和大陆简体常见标签。不把界面语言切换变成医疗单位、账户时区、基础资料或数据库业务值的变化。已有其他语言继续可用。

第一轮评审已确认：登录后使用账户统一语言，Web、iOS 与后台日报一致；未登录时跟随系统，离线使用本机缓存。语言的跨端同步及重新登录纳入验收；首期修改账户语言需联网，离线只使用缓存语言。

覆盖基线中可见的用户界面、表单校验、错误/空状态、图表、日期数字格式、无障碍文本及现有通知/报告文案。中文发布范围内不得用整段英文占位冒充翻译完成；保留英语 fallback 供异常或未来新增词条兜底。药名、用户输入和来源记录不自动翻译。

M1 不做：新的健康数据模型、目标引擎、设备适配、HealthKit 读写策略变化、重复提醒治理、推送调度或生产部署。

## T0：确定工作区与基线

- [ ] 复用已准备的两个 Fork/checkout，核对 origin/upstream、当前分支、提交及用户未提交改动。

- [ ] 阅读适用仓库规则、贡献文档、API 契约、UI 标准和 CI；以实际代码/CI 为准处理过时文档。
- [ ] 记录可用 Node/pnpm、PostgreSQL/Docker、Xcode/模拟器环境；不为完成交接自动安装工具或改动系统设置。
- [ ] 先执行相关基线检查，记录已有失败；需要数据库时使用独立测试库，不能对现有健康库执行 reset 或 db push。

## T1：Web 复用现有国际化

已确认入口：

| 入口                                                               | 最小工作                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `messages/en.json` 及新增中文 catalog                              | 沿用键结构，完成中文翻译，校验插值、复数及格式占位符；不批量改名         |
| `src/lib/i18n/config.ts`                                           | 注册简体中文的统一 locale、显示名和语言名称，复用现有配置                |
| `project.inlang/settings.json`                                     | 同步注册语言，保留已有 9 个语言及工具链                                  |
| `src/lib/i18n/load-locale.ts`                                      | 补齐中文动态加载；沿用 SSR / boot bundle / 英语 fallback                 |
| `src/lib/i18n/server-catalogs.ts`                                  | 验证新增 catalog 可读取、缓存与 fallback 正确，无需先重写加载器          |
| `src/app/api/auth/me/locale/route.ts`、现有语言设置 UI             | 检查服务端校验、用户偏好、cookie 与首次渲染一致；必要时补入中文选项      |
| `src/lib/format-locale.ts`、`src/components/ui/calendar-locale.ts` | 搜索对应调用与语言表，补齐中文日期、数字、日历映射，保持既有用户格式偏好 |
| `scripts/generate-i18n-boot.mjs`、Docker/Next 打包配置             | 确认生成与部署包包含中文资源                                             |

- [ ] 在修改共享 locale 代码前搜索全部调用方、`Record<Locale,...>`、校验枚举、语言白名单、后台文案及测试语言列表，形成最小受影响清单。
- [ ] 沿用仓库现有语言标识约定；如果选择 `zh-CN` 或 `zh-Hans`，集中定义映射，不能在 API/cookie/catalog 之间混用未映射值。
- [ ] 保持用户单位/日期偏好及已录入数据原值；切换后刷新、登录/退出与重新访问仍符合现有优先级。
- [ ] 不因为新语言测试失败就删除其他语言断言或降低校验门槛。

## T2：iOS 复用 String Catalog 与现有偏好机制

- [ ] 盘点语言解析、设置入口、App 根节点与所有 `String(localized:)` / SwiftUI 本地化调用，复用已有偏好；若缺少应用内选择，仅新增完成切换所需的最小入口与持久化。
- [ ] 在 `HealthLog/Resources/Localizable.xcstrings` 增加 `zh-Hans`，保留 en/de；处理复数、插值与格式签名。
- [ ] 新增中文 `InfoPlist.strings`，覆盖现有隐私权限说明；同步检查 `project.yml` 的 developmentLanguage、CFBundleLocalizations、资源收集和生成规则。
- [ ] 复用既有 `en.lproj/InfoPlist.strings` 和 `de.lproj/InfoPlist.strings` 的资源模式；盘点 catalog 之外的 `ReportLocale`、`LocaleText` 和手写语言分支，覆盖 `HealthLog/Services/PDF/DoctorReportSectionDrawer.swift` 等报告路径。
- [ ] 选择中文或英文后，SwiftUI 界面与非 SwiftUI 的本地化读取结果一致；不能只有 `.environment(\.locale, ...)` 改了局部界面。
- [ ] 检查 `HealthLogWidgets/Resources/Localizable.xcstrings`、`NotificationServiceExtension/Resources/Localizable.xcstrings`；已有 Watch/WatchWidgets 随 App 分发且有可见文案时一并补齐其 catalog，保持现有目标可构建。
- [ ] 验证中文布局、小屏、动态字体和 VoiceOver，不固定文字宽度或删掉现有无障碍信息。
- [ ] 保留 iOS 18 deployment target；不能为了语言支持提升最低系统版本或引入新的 i18n 依赖。
- [ ] 遵循上游生成项目方式，不只编辑会被 `xcodegen` 覆盖的生成文件；签名、Bundle ID、HealthKit、App Group、Push 与服务器配置按用户环境单独核对，不能复用上游私有凭据。

## T3：检查与验收

沿用已有测试，补充能证明新增行为的小测试。优先扩展现有测试，避免另造平行框架。

Web：

- [ ] 扩展 locale 解析、中文 catalog 键/格式、fallback、偏好持久化与 SSR/首屏一致性检查。
- [ ] 参考 `e2e/locale-switch.spec.ts` 增加中英真实切换，并覆盖刷新/重新登录；不能只注入 cookie 后检查页面无 raw key。
- [ ] 检查登录/引导、首页、血压/体重/睡眠/步数图表、已有记录表单、设置与错误提示；中文和英文均可操作。
- [ ] 运行上游规定的 `pnpm typecheck`、`pnpm lint`、`pnpm test`，以及受影响的 E2E、构建、资源打包和必要格式检查。准确记录未执行/失败项，不把未运行写成通过。

iOS：

- [ ] 复用 `HealthLogTests/i18n` 和 catalog 格式/复数检查，增加中文覆盖及语言持久化验证。
- [ ] 在可用模拟器中验证设置切换、重启、表单、图表与无障碍文案；已有用户安装状态也要覆盖。
- [ ] 依据当前 `.github/workflows/ci.yml` 执行 xcodegen、字符串检查、格式/lint、构建与测试；不要照搬 TESTING.md 中与当前代码矛盾的旧配置片段。
- [ ] 对附带 Widget/Watch/通知扩展运行受影响的编译或资源检查。M1 模拟器结果不能替代 M2 的 HealthKit 真机验收。

共同验收：

- [ ] 中英文翻译覆盖表、两端设置入口截图/短演示、持久化及布局检查有据可查，使用虚构健康数据。
- [ ] 任一端显式切换账户语言后，另一端在同步偏好后正确显示；后台日报使用同一账户语言。检查冷启动、离线缓存、重登录及已有安装状态。
- [ ] 已有功能和配置行为保持；不做破坏性数据库迁移，不移除上游功能、语言或测试。
- [ ] 本地开发/自托管构建步骤可复现；验证远程部署所需的中文资源随构建产物交付。真实远程发布需明确目标与授权后执行。
- [ ] 每个仓库交付各自清晰可审阅的改动、验证结果、已知限制和后续任务；创建 PR 时保留许可且不自动合并。

## 建议提交顺序

1. Web：注册中文、catalog、现有切换/格式接入及相应测试。
2. iOS：catalog、必要的设置/偏好接入、多目标资源及相应测试。
3. 在两端现有测试和构建结果基础上完成联调与部署说明；只有发现实际问题才继续扩大修改。

完成上述范围后 M1 结束，再进入设备验证。未具备的工具、真机或远程环境需在交付中逐项注明，不能以“实现完成”替代未做的验收。
