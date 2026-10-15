# 霍尔木兹图文故事：来源与口径

核对日期：2026-10-15。故事内的 `asOf`、统计时段和单位应与下表一起阅读。地图上的海路、管道、海峡光点和市场点都是**示意**，不是 AIS 航迹、精确管线、城市行政边界或政治边界。

| 故事内容 | 使用的数字与时段 | 官方来源 | 口径说明 |
| --- | --- | --- | --- |
| 海峡宽度 | 最窄 21 海里，约 39 公里 | [IEA Strait of Hormuz factsheet](https://www.iea.org/about/oil-security-and-emergency-response/strait-of-hormuz)，2026 年 2 月更新 | 宽度不等于航道或地图光点的范围。 |
| 2025 年石油 | 总量 19.87 百万桶/日；其中原油及凝析油 14.95，油品 4.93 | [IEA factsheet](https://www.iea.org/about/oil-security-and-emergency-response/strait-of-hormuz)，2025 全年表格 | 是经海峡出口流量，不是湾内总产量；分项和总计经四舍五入可能有 0.01 差异。 |
| 2025 年 LNG | 经海峡略超 1120 亿立方米/年 | [IEA factsheet](https://www.iea.org/about/oil-security-and-emergency-response/strait-of-hormuz)，2025 全年 | 以体积计量，不换算成石油桶/日；原油管道不能替代 LNG 航运。 |
| 亚洲方向 | 经海峡石油约 80% 运往亚洲 | [IEA factsheet](https://www.iea.org/about/oil-security-and-emergency-response/strait-of-hormuz)，2025 全年 | [EIA chokepoints](https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/) 的 2025 上半年原油及凝析油 89% 为另一时段和品类，不能混成一条序列。 |
| 2026 年扰动 | 2025 Q4 的 21.6 降至 2026 Q2 的 4.9 百万桶/日 | [EIA Short-Term Energy Outlook, Energy Security](https://www.eia.gov/outlooks/steo/report/energysecurity/article.php)，2026 年 8 月，表 4 | 季度石油流量估计。扰动后 AIS 数据不完整，EIA 提醒估值可能修订。 |
| 2026 年部分恢复 | 2026 年 9 月经海峡石油约 10.9 百万桶/日 | [IEA Oil Market Report, October 2026](https://www.iea.org/reports/oil-market-report-october-2026) | 月度 IEA 估计，不直接接到 EIA 季度序列上。 |
| 原油陆上绕行 | 2026 年初估计可追加转移 3.5–5.5 百万桶/日 | [IEA factsheet](https://www.iea.org/about/oil-security-and-emergency-response/strait-of-hormuz) | 沙特 Abqaiq–Yanbu 与阿联酋 Habshan–Fujairah 的原油通道；不是 2026 年 10 月实时闲置能力。 |

只有从海峡西侧经陆上管道送到红海或阿曼湾出港，才能真正避开霍尔木兹。湾内油轮在通过海峡前改走好望角没有地理上的绕行效果；好望角仅影响出海后的远洋航程。[IEA factsheet](https://www.iea.org/about/oil-security-and-emergency-response/strait-of-hormuz) 和 [IEA 2026 年 4 月 Oil Market Report](https://www.iea.org/reports/oil-market-report-april-2026)描述了这些替代出口。

故事层的 `layerIds`、段落 ID、步骤 ID、来源 ID 与数字卡片都在 [`src/story/hormuz.ts`](../src/story/hormuz.ts)。地图内的 Codex 回复只能返回这些预置步骤和来源 ID；自由生成的叙述仍需按上述资料复核。城市行政边界数据尚未引入：试点前须确定行政级别口径、数据许可、数据日期和稳定 ID。普通城市只显示位置点及“暂无边界数据”，香港的城市位置点与现有地区轮廓分开展示。
