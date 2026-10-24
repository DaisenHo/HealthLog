# Apple 健康用药功能核验

核验日期：2026-10-24。用途：支持 HealthLog 用药功能对比，暂不决定替代方案。以下分别描述 Apple 自带 App 和第三方公开接口；两者能力不能互相等同。

## 用户可以直接使用的功能

| 事项 | 官方已确认的行为 |
|---|---|
| 添加药品 | 可输入未列出的药名，并设置类型、规格；未提供的规格可自定义。相机识别仅限美国。[Apple 添加说明](https://support.apple.com/zh-cn/105064) |
| 定时类型 | 支持定时频率与持续时间，包括每周特定日期、循环、每隔几天；也支持按需用药。每天固定时刻的具体配置应在目标手机走一遍验收。[Apple 用药手册](https://support.apple.com/zh-cn/guide/iphone/iph811670c81/ios)、[定时类型与系统限制](https://support.apple.com/zh-cn/105064) |
| 服用记录 | 可记已服用或已跳过，按需药也能记录；记录时可选实际剂量和时间。支持补录过去日期；更改记录可能表现为删除旧事件并保存新事件。[Apple 记录说明](https://support.apple.com/en-ie/guide/iphone/iph811670c81/ios)、[Apple 开发者演示](https://developer.apple.com/videos/play/wwdc2025/321/) |
| 提醒 | 定时提醒；30 分钟仍未记录时可跟进提醒；可为药品开启重要提醒，在专注或静音时发声并显示锁屏。[Apple 提醒说明](https://support.apple.com/zh-cn/guide/iphone/iph811670c81/ios) |
| 设备 | iPhone/iPad 添加与记录，Apple Watch 记录和提醒；Watch 通知可延后 10 分钟。循环和每周特定日需要 iOS/iPadOS 18、watchOS 11 或更高；Apple Watch 亲子设置不支持用药。[Apple 设备说明](https://support.apple.com/zh-cn/105064) |
| 历史与导出 | 可查看服用/跳过频率和历史；可导出当前药品列表 PDF。不能把“药品列表 PDF”预先承诺为全部逐次事件的统计报表。[Apple 历史与导出说明](https://support.apple.com/en-us/105064) |
| 地域 | 美国境外仍可手动添加未列出药品。药物相互作用仅美国提供，未列出药品不纳入其考量；其他功能也应按地区和系统版本验收。[Apple 地域说明](https://support.apple.com/en-us/105064) |

## HealthLog 可以通过公开 HealthKit 接口获得什么

- 药品与剂量事件的新接口从 iOS 26 起提供；药品对象包含是否已归档、是否有定时、别名和药品概念。`hasSchedule` 只是布尔值，不是完整未来计划。[HKUserAnnotatedMedication](https://developer.apple.com/documentation/healthkit/hkuserannotatedmedication)、[hasSchedule](https://developer.apple.com/documentation/healthkit/hkuserannotatedmedication/hasschedule)
- 剂量事件可包含实际剂量、单位、事件状态、药品标识、单次计划日期/剂量及定时上下文。[HKMedicationDoseEvent](https://developer.apple.com/documentation/healthkit/hkmedicationdoseevent)
- 状态不只有已服用/已跳过，还包括未交互、撤销记录、通知未发送和延后。[LogStatus](https://developer.apple.com/documentation/healthkit/hkmedicationdoseevent/logstatus-swift.enum)
- 用户逐个授权药品；允许某药品后可读其剂量事件。Apple 说明每个排定剂量会保存事件，并提醒开发者处理补记、删除与重存。[Apple API 演示](https://developer.apple.com/videos/play/wwdc2025/321/)

## 不能由现有证据直接推出的结论

1. **“拿不到完整未来周期规则”不等于“无法读到历史应服剂量”。** 官方提供单次计划事件字段；因此历史服药依从率是否可可靠计算，应验证所有状态、权限、时间覆盖与同步完整性，不能只统计已服/跳过事件。[剂量事件字段](https://developer.apple.com/documentation/healthkit/hkmedicationdoseevent)、[状态定义](https://developer.apple.com/documentation/healthkit/hkmedicationdoseevent/logstatus-swift.enum)
2. 本次核验的公开药品对象和剂量事件接口以查询/读取为中心；没有得到“第三方可创建药品、写入用药事件或修改完整提醒计划”的正面证据。**不能承诺 HealthLog 能反向维护 Apple 用药流程**；也不将这次未确认写接口，表述成永远不可能。[公开药品对象](https://developer.apple.com/documentation/healthkit/hkuserannotatedmedication)、[Apple API 演示](https://developer.apple.com/videos/play/wwdc2025/321/)
3. 未真机确认：每天多时刻/不同剂量的实际配置步骤、当前中国账户界面、历史覆盖范围、权限撤销行为、未交互事件生成时间、完整未来规则/写入接口在当前目标 SDK 的可用性。

## 对规格的影响

故事 42 应先要求展示 HealthLog 与 Apple 健康的功能对比和操作流程，再由用户决定每项功能在哪里完成。Apple App 能承担计划、记录和提醒，不构成用户已经选定替代方案的依据。HealthLog 现有能力应另以当前仓库实现为准。

本笔记只核验公开资料，未操作用户健康数据、未运行 App，也未改动应用或仓库规范。
