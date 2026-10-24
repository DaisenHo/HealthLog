# 用药功能对比：HealthLog 与 Apple 健康

核验日期：2026-10-24。这里的“当前系统”指已检出的 HealthLog 服务端/Web 和 healthlog-iOS。源码基线分别为 `cf61bd1c8528846c15599a8e26246521cb31ca92`、`3ab0afeba1460c27292929a8268282e5f333440b`，尚未修改用药业务代码。

**结论：HealthLog 已有独立的用药计划、记录、提醒与统计能力，不能把它预先定位为 Apple 健康的被动显示器。先验证需要的操作，再选择管理来源。以下“已有”表示查到实现，不表示已经在用户手机上验收。**

## 功能对比

| 功能             | 当前 HealthLog                                                                                                | Apple 健康                                                                               | 对选择的影响                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 药品资料         | 原生管理药品、剂量和疗程信息；也可只保存资料而关闭服用跟踪。[H1][H5]                                          | 可手动添加未列出药名、类型和规格；相机识别有地区限制。[A1]                               | 两端均不必依赖药品名称自动匹配；应实测中文药名操作。                                                                  |
| 用药计划         | 已有每日、特定星期、每隔若干周、月/年、滚动间隔、单次、按需、循环等模型。[H1]                                 | 官方说明支持定时、特定星期、循环、每隔几天和按需；部分类型有系统版本要求。[A1][A2]       | 不能只凭“更简单/更强大”判断；应验证自己的实际频率、时刻及剂量能否表达。                                               |
| 服用、跳过与补记 | 原生药品有操作和历史时间更正；计划台账区分按时、迟服、跳过、漏服及临时服用。[H2][H6]                          | 支持服用、跳过、按需记录和历史记录；Apple Watch 也能操作。[A1][A2]                       | 日常记录两端均有能力；Apple 来源镜像在 HealthLog 不提供原生剂量录入，以免重复。[H3]                                   |
| 提醒             | iOS 有本地通知和 iOS 26 AlarmKit 路径；服务端还可走 APNs、Telegram、ntfy、邮件等通道，需配置和授权。[H4]      | 有定时提醒、未记录后的 30 分钟跟进提醒，以及可在静音/专注时提示的重要提醒。[A2]          | 应比较真机离线、锁屏与操作结果；代码支持不等于提醒已启用或必然送达。                                                  |
| 漏服与完成情况   | 原生计划有预计剂量，可计算 7/30 天等窗口结果；没有本地计划的 Apple 镜像会返回“不适用”，而不是有效完成率。[H6] | 可查看历史及服用/跳过情况；不能预先认定其统计口径与 HealthLog 完全一致。[A1]             | 若重点是自定义目标、跨指标日报，应验证需要哪些原始计划/状态，不能把“收到几条事件”当成全部应服次数。                   |
| 多端操作与部署   | 有 Web、iOS、Watch 和相关快捷操作；服务端统计/跨端能力依赖自行部署的实例。[H2]                                | 官方入口覆盖 iPhone、iPad、Apple Watch，部分功能依赖系统版本和账户条件。[A1]             | HealthLog 提供浏览器端和自托管能力；Apple 健康省去为其自身用药功能部署服务的步骤。                                    |
| 额外用药功能     | 已有药品库存/容器、剩余量等模型；部分注射药另有部位和相关记录界面。[H7]                                       | 本轮官方资料未确认与这些能力等价的功能，不能据此断言不存在。                             | 如果需要这些扩展，应该验证具体功能，再决定是否保留 HealthLog 原生管理。                                               |
| 数据互通         | 已有 iOS 26 逐药授权、Apple 药品镜像和剂量事件导入；不是已经验证的用药双向同步。[H3][H8]                      | 新 HealthKit API 提供药品及剂量事件读取；App 界面的功能范围不等于第三方 API 的范围。[A3] | 选择 Apple 主入口前，验证所需记录能否完整进入 HealthLog；选择 HealthLog 主入口时，不承诺其用药记录能反写 Apple 健康。 |

## 必须区分的三层能力

1. **Apple 健康 App 能做什么。** 可管理计划、提醒和服用记录，但这不证明第三方能读取完整未来计划或反向修改它。
2. **HealthKit API 能提供什么。** 官方剂量事件还包含单次计划时间/剂量和未交互等状态，不限于“已服用/已跳过”；药品的 `hasSchedule` 则只是布尔值，不是完整未来周期规则。[A3][A4]
3. **HealthLog 当前实际导入什么。** 当前读取器丢弃已服用、已跳过之外的事件状态；药品镜像请求没有完整计划。此处存在实现边界，不能把它当成 Apple API 的永久上限。[H8]

因此，先前仅由“未取得完整未来计划”推断历史依从率无法计算，结论过强。历史单次计划事件是否足以构成可信分母，需要验证事件生成时机、权限、时间覆盖、更正/删除及完整性；本次既不承诺一定能算，也不预先排除。[A3][A4]

## 现有配置需要注意的差异

- “由客户端管理提醒”会静默服务端 APNs 用药提醒，但不是所有通道的总开关；Telegram、ntfy、邮件、Web Push 等仍可能发送。避免重复提醒需要核对实际启用通道，不能只切一个标志。[H4]
- Apple 来源药品与 HealthLog 原生药品是不同管理模式。前者通过镜像导入，当前客户端抑制其手动剂量操作；后者可以维护自身计划并直接记录。[H3]
- 导入去重不等于删除传播。Apple 中已经删除的旧事件，必须实测服务端是否撤回、统计是否重算；不能仅确认客户端队列清理。[H8]
- iOS README 仍有“HealthKit 没有标准用药类型”的旧描述，而当前源码已经有 iOS 26 读取路径。此处以源码和当前 Apple 文档为准，说明文档需要后续校正。[H2][H8][A3]

## 待用户选择的方案

| 方案                                 | 日常操作地点                        | 已有基础                                           | 需接受或验证的边界                                                   |
| ------------------------------------ | ----------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| 沿用 HealthLog 原生用药管理          | 在 HealthLog 建计划、记录和接收提醒 | 计划、台账、统计和多通道提醒均已有代码             | 部署/权限配置与可靠性需验收；用药记录反写 Apple 健康未获确认。       |
| Apple 健康为主，HealthLog 展示与统计 | 在 Apple 健康建计划、记录和接收提醒 | Apple App 的用药功能、HealthLog 的 iOS 26 导入路径 | 验证事件覆盖、历史统计及删除传播；不能把镜像记录当完整计划。         |
| 按药品分别确定来源                   | 每种药品只在指定的一端管理          | 原生药品与 Apple 镜像已经有来源区分                | 需清楚标识来源并核验提醒通道，不能把同一药品在两端建成两个独立计划。 |

本次不替用户选择其中一种。M1 的国际化与现有功能保留继续有效；后续用药改造以功能比较后的选择为前提。

## 决策前的操作验收

使用虚构药品，在两端各走一遍：添加自定义药名和实际需要的时刻/频率 → 触发提醒 → 记录服用/跳过 → 补记过去日期 → 更正和删除 → 查看历史与统计。验证时记录系统版本、地区、权限和是否联网；区分自带系统能力、HealthLog 本地提醒与服务端推送。

两种系统都支持的条目，应以操作便利性、所需统计、稳定性和维护成本作为选择依据，而不是只比较功能名称。真机验证、系统通知权限和 HealthLog 部署尚未完成，本报告没有使用真实健康数据。

## 一手来源

- [H1] [iOS 用药周期模型](https://github.com/MBombeck/healthlog-iOS/blob/3ab0afeba1460c27292929a8268282e5f333440b/HealthLog/Models/MedicationCadence.swift#L44-L86)。
- [H2] [iOS 功能说明](https://github.com/MBombeck/healthlog-iOS/blob/3ab0afeba1460c27292929a8268282e5f333440b/README.md#L52-L75)。
- [H3] [Apple 来源与原生剂量操作的区分](https://github.com/MBombeck/healthlog-iOS/blob/3ab0afeba1460c27292929a8268282e5f333440b/HealthLog/Models/Medication%2BAppleHealth.swift#L8-L26)。
- [H4] [本地与服务端提醒分工](https://github.com/MBombeck/healthlog-iOS/blob/3ab0afeba1460c27292929a8268282e5f333440b/HealthLog/Models/MedicationReminderDelivery.swift#L3-L16)、[AlarmKit 路径](https://github.com/MBombeck/healthlog-iOS/blob/3ab0afeba1460c27292929a8268282e5f333440b/HealthLog/Services/CriticalMedAlarmService.swift#L7-L25)。
- [H5] [只记录资料或跟踪服用的开关](https://github.com/MBombeck/healthlog-iOS/blob/3ab0afeba1460c27292929a8268282e5f333440b/HealthLog/Models/Medication%2BIntakeTracking.swift#L8-L41)。
- [H6] [剂量台账状态](https://github.com/MBombeck/HealthLog/blob/cf61bd1c8528846c15599a8e26246521cb31ca92/src/lib/medications/scheduling/dose-history.ts#L1-L35)、[没有本地计划时的统计语义](https://github.com/MBombeck/HealthLog/blob/cf61bd1c8528846c15599a8e26246521cb31ca92/src/lib/medications/compliance-payload.ts#L195-L235)。
- [H7] [库存汇总模型](https://github.com/MBombeck/healthlog-iOS/blob/3ab0afeba1460c27292929a8268282e5f333440b/HealthLog/Models/MedicationSupplySummary.swift#L3-L13)。
- [H8] [Apple 用药只读导入流程](https://github.com/MBombeck/healthlog-iOS/blob/3ab0afeba1460c27292929a8268282e5f333440b/HealthLog/Services/HealthKit/AppleHealthMedicationImporter.swift#L13-L32)、[当前读取器的状态过滤](https://github.com/MBombeck/healthlog-iOS/blob/3ab0afeba1460c27292929a8268282e5f333440b/HealthLog/Services/HealthKit/AppleHealthMedicationReader.swift#L103-L146)。
- [A1] [Apple：添加药品和记录用药](https://support.apple.com/zh-cn/105064)。
- [A2] [Apple：用药定时与提醒](https://support.apple.com/zh-cn/guide/iphone/iph811670c81/ios)。
- [A3] [Apple：HealthKit Medications API](https://developer.apple.com/videos/play/wwdc2025/321/)。
- [A4] [Apple：剂量事件状态定义](https://developer.apple.com/documentation/healthkit/hkmedicationdoseevent/logstatus-swift.enum)。
