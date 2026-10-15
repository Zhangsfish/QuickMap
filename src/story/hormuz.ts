import type { MapOverlay } from '../shared/protocol';
import { STORY_STEP_IDS } from '../shared/protocol';

export type StoryCamera = { lon: number; lat: number; scale: number };
export type StoryLayer = MapOverlay & {
  kind: 'place' | 'sea-route' | 'pipeline' | 'strait';
  stepId: string;
  pointLabels?: string[];
  pointLabelOffsets?: Array<[number, number]>;
  // Every geometry in this example is an explanatory sketch, not surveyed data.
  schematic: true;
};
export type StoryParagraph = {
  id: string;
  text: string;
  layerIds: string[];
  sourceIds: string[];
};
export type StoryClaim = {
  id: string;
  value: string;
  label: string;
  period: string;
  unit: string;
  sourceId: string;
  qualifier?: string;
};
export type StoryStep = {
  id: 'hormuz-1' | 'hormuz-2' | 'hormuz-3' | 'hormuz-4' | 'hormuz-5';
  title: string;
  eyebrow: string;
  camera: StoryCamera;
  layerIds: string[];
  paragraphs: StoryParagraph[];
  claims: StoryClaim[];
  sourceIds: string[];
};
export type StorySource = { title: string; url: string; period: string };
export type StoryDefinition = {
  id: 'hormuz';
  version: 1;
  asOf: string;
  title: string;
  subtitle: string;
  legend: string;
  sources: Record<string, StorySource>;
  layers: StoryLayer[];
  steps: StoryStep[];
};

export const HORMUZ_STORY: StoryDefinition = {
  id: 'hormuz',
  version: 1,
  asOf: '2026-10-15',
  title: '为什么霍尔木兹海峡重要？',
  subtitle: '从波斯湾出口、亚洲海路到陆上绕行',
  legend: '所有海路、管道连线与海峡标记均为示意；不是 AIS 航迹、精确管线或政治边界。',
  sources: {
    'iea-hormuz-factsheet': {
      title: 'IEA｜Strait of Hormuz factsheet',
      url: 'https://www.iea.org/about/oil-security-and-emergency-response/strait-of-hormuz',
      period: '2025 年流量、2026 年初绕行能力估计',
    },
    'eia-chokepoints-2025': {
      title: 'EIA｜World Oil Transit Chokepoints',
      url: 'https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/',
      period: '2025 年上半年',
    },
    'eia-energy-security-2026': {
      title: 'EIA｜Energy Security',
      url: 'https://www.eia.gov/outlooks/steo/report/energysecurity/article.php',
      period: '2025 年第四季度、2026 年第二季度',
    },
    'iea-oct-2026': {
      title: 'IEA｜Oil Market Report, October 2026',
      url: 'https://www.iea.org/reports/oil-market-report-october-2026',
      period: '2026 年 9 月',
    },
    'iea-apr-2026': {
      title: 'IEA｜Oil Market Report, April 2026',
      url: 'https://www.iea.org/reports/oil-market-report-april-2026',
      period: '2026 年 4 月',
    },
  },
  layers: [
    {
      id: 'hormuz-strait', stepId: 'hormuz-1', kind: 'strait', schematic: true,
      label: '霍尔木兹海峡 · 示意', color: '#ffd27f', source: 'IEA · 示意位置',
      description: '波斯湾通往阿曼湾的狭窄出口。点位与光环只用于定位，不代表边界或航道宽度。',
      geometry: { type: 'Point', coordinates: [56.45, 26.5] },
    },
    {
      id: 'hormuz-gulf-exit', stepId: 'hormuz-1', kind: 'sea-route', schematic: true,
      label: '波斯湾 → 阿曼湾 · 示意', color: '#80cad7', source: 'IEA · 代表性方向示意',
      description: '连接方向示意，不是船舶 AIS 轨迹。',
      geometry: { type: 'LineString', coordinates: [[52.2, 26.8], [54.8, 26.5], [56.4, 26.5], [59.1, 24.8]] },
    },
    {
      id: 'hormuz-exporters', stepId: 'hormuz-2', kind: 'place', schematic: true,
      label: '海湾出口体系 · 示意点', color: '#e9be85', source: 'IEA · 国家级出口体系示意',
      description: '沙特、伊拉克、阿联酋、伊朗、科威特和卡塔尔等海湾出口体系。点位不是具体油田、装船港或产量分配。',
      pointLabels: ['沙特', '伊拉克', '阿联酋', '伊朗', '科威特', '卡塔尔'],
      pointLabelOffsets: [[12, 4], [-16, -18], [12, 4], [12, 4], [15, 22], [12, 4]],
      geometry: { type: 'MultiPoint', coordinates: [[50.2, 26.2], [48.6, 29.5], [54.6, 24.6], [52.5, 27.6], [48.3, 29.3], [51.4, 25.4]] },
    },
    {
      id: 'hormuz-india', stepId: 'hormuz-3', kind: 'sea-route', schematic: true,
      label: '印度方向 · 示意海路', color: '#8bd5c8', source: 'IEA · 代表性方向示意',
      description: '从海峡出口驶向印度方向的代表性路线，不代表实际船舶、港口或双边货流。',
      geometry: { type: 'LineString', coordinates: [[57.4, 25.7], [61.5, 22.7], [67.5, 19.5], [73.2, 18.6]] },
    },
    {
      id: 'hormuz-east-asia', stepId: 'hormuz-3', kind: 'sea-route', schematic: true,
      label: '东亚方向 · 示意海路', color: '#6ca8d7', source: 'IEA · 代表性方向示意',
      description: '经印度洋向中国、日本、韩国方向运输的代表性方向；不是 AIS 航迹或逐国流量。',
      geometry: { type: 'LineString', coordinates: [[57.4, 25.7], [64, 18], [76, 8], [92, 5], [107, 11], [116, 22], [121, 30]] },
    },
    {
      id: 'hormuz-asia-markets', stepId: 'hormuz-3', kind: 'place', schematic: true,
      label: '亚洲目的市场 · 示意点', color: '#b9d7a8', source: 'IEA · 主要进口市场方向示意',
      description: '印度、中国、日本和韩国等亚洲市场。点位不是卸货港，也不表示各国货量。',
      pointLabels: ['印度', '中国', '韩国', '日本'],
      geometry: { type: 'MultiPoint', coordinates: [[76, 19], [116, 35], [127.7, 37.5], [138, 36]] },
    },
    {
      id: 'hormuz-disruption', stepId: 'hormuz-4', kind: 'strait', schematic: true,
      label: '2026 年扰动 · 示意', color: '#ed8c79', source: 'EIA / IEA · 示意位置',
      description: '数字是机构对不同时段石油流量的估计，不是此点位的实时流量或 AIS 观测。',
      geometry: { type: 'Point', coordinates: [56.45, 26.5] },
    },
    {
      id: 'hormuz-saudi-pipeline', stepId: 'hormuz-5', kind: 'pipeline', schematic: true,
      label: '沙特东西向管道 · 示意', color: '#e4b57f', source: 'IEA · 起讫区域示意',
      description: 'Abqaiq 一带至红海 Yanbu 一带的陆上原油绕行方向，非精确管线。',
      geometry: { type: 'LineString', coordinates: [[49.7, 26.0], [45.5, 25.5], [41.7, 24.8], [38.1, 24.1]] },
    },
    {
      id: 'hormuz-uae-pipeline', stepId: 'hormuz-5', kind: 'pipeline', schematic: true,
      label: '阿联酋绕行管道 · 示意', color: '#f1d497', source: 'IEA · 起讫区域示意',
      description: 'Habshan 一带至阿曼湾 Fujairah 一带的陆上原油绕行方向，非精确管线。',
      geometry: { type: 'LineString', coordinates: [[53.5, 24.3], [54.7, 24.6], [56.3, 25.1]] },
    },
    {
      id: 'hormuz-saudi-outlet', stepId: 'hormuz-5', kind: 'sea-route', schematic: true,
      label: 'Yanbu 红海出港 · 示意', color: '#86c1d1', source: 'IEA · 示意方向',
      description: '沙特西岸出港方向示意。好望角航行不能让波斯湾内的油轮绕开霍尔木兹。',
      geometry: { type: 'LineString', coordinates: [[38.1, 24.1], [37.1, 22.5], [36, 19.8]] },
    },
    {
      id: 'hormuz-uae-outlet', stepId: 'hormuz-5', kind: 'sea-route', schematic: true,
      label: 'Fujairah 阿曼湾出港 · 示意', color: '#86c1d1', source: 'IEA · 示意方向',
      description: '阿曼湾出港方向示意，不是 AIS 航迹。',
      geometry: { type: 'LineString', coordinates: [[56.3, 25.1], [59.3, 23.4], [61.6, 21.4]] },
    },
  ],
  steps: [
    {
      id: 'hormuz-1', eyebrow: '01 / 狭窄出口', title: '一道海上的门', camera: { lon: 55.3, lat: 26.5, scale: 12 },
      layerIds: ['hormuz-strait', 'hormuz-gulf-exit'], sourceIds: ['iea-hormuz-factsheet'],
      paragraphs: [
        { id: 'hormuz-1-a', text: '波斯湾的海上出口通向阿曼湾，要经过伊朗与阿曼之间的霍尔木兹海峡。对湾内装船的货物，这道出口难以靠“换一条远洋路线”避开。', layerIds: ['hormuz-strait', 'hormuz-gulf-exit'], sourceIds: ['iea-hormuz-factsheet'] },
        { id: 'hormuz-1-b', text: '这里最窄处约 39 公里。地图上的光点和线只表示位置与方向，不对应航道边界。', layerIds: ['hormuz-strait'], sourceIds: ['iea-hormuz-factsheet'] },
      ],
      claims: [{ id: 'width', value: '约 39', label: '海峡最窄处', period: '地理概况', unit: '公里', sourceId: 'iea-hormuz-factsheet' }],
    },
    {
      id: 'hormuz-2', eyebrow: '02 / 出口体系', title: '哪些能源要从这里出去？', camera: { lon: 52.2, lat: 27.1, scale: 8 },
      layerIds: ['hormuz-exporters'], sourceIds: ['iea-hormuz-factsheet'],
      paragraphs: [
        { id: 'hormuz-2-a', text: '沙特、伊拉克、阿联酋、伊朗、科威特、卡塔尔等海湾国家的出口体系与这条通道相关。地图圆点代表国家级出口体系，不能读成某个油田或港口的位置。', layerIds: ['hormuz-exporters'], sourceIds: ['iea-hormuz-factsheet'] },
        { id: 'hormuz-2-b', text: 'IEA 估计 2025 年经海峡的石油合计约 19.87 百万桶/日，其中原油与凝析油 14.95、油品 4.93。另有约 1120 亿立方米/年 LNG；天然气须与石油分开看，油管不能代替 LNG 海运。', layerIds: ['hormuz-exporters'], sourceIds: ['iea-hormuz-factsheet'] },
      ],
      claims: [
        { id: 'oil-2025', value: '19.87', label: '经海峡石油合计', period: '2025 年 · IEA 估计', unit: '百万桶/日', sourceId: 'iea-hormuz-factsheet', qualifier: '原油/凝析油 14.95；油品 4.93' },
        { id: 'lng-2025', value: '约 1120', label: '经海峡 LNG', period: '2025 年 · IEA 估计', unit: '亿立方米/年', sourceId: 'iea-hormuz-factsheet', qualifier: '与石油分开计量' },
      ],
    },
    {
      id: 'hormuz-3', eyebrow: '03 / 亚洲方向', title: '船驶向哪里？', camera: { lon: 85, lat: 17, scale: 2.45 },
      layerIds: ['hormuz-india', 'hormuz-east-asia', 'hormuz-asia-markets'], sourceIds: ['iea-hormuz-factsheet', 'eia-chokepoints-2025'],
      paragraphs: [
        { id: 'hormuz-3-a', text: '船从海峡出去后，经阿拉伯海与印度洋驶向印度、中国、日本和韩国等市场。箭头与目的市场点只是代表性方向，不是实际船舶轨迹、卸货港或双边贸易量。', layerIds: ['hormuz-india', 'hormuz-east-asia', 'hormuz-asia-markets'], sourceIds: ['iea-hormuz-factsheet'] },
        { id: 'hormuz-3-b', text: 'IEA 统计的 2025 年经海峡石油约 80% 运往亚洲。EIA 的“2025 年上半年原油/凝析油 89% 去亚洲”使用不同品类和时段，不能与前者拼成一组数据。', layerIds: ['hormuz-east-asia', 'hormuz-asia-markets'], sourceIds: ['iea-hormuz-factsheet', 'eia-chokepoints-2025'] },
      ],
      claims: [{ id: 'asia-share', value: '约 80%', label: '经海峡石油运往亚洲', period: '2025 年 · IEA 估计', unit: '份额', sourceId: 'iea-hormuz-factsheet' }],
    },
    {
      id: 'hormuz-4', eyebrow: '04 / 2026 年扰动', title: '通道受阻时会怎样？', camera: { lon: 56.3, lat: 26.5, scale: 11 },
      layerIds: ['hormuz-disruption'], sourceIds: ['eia-energy-security-2026', 'iea-oct-2026'],
      paragraphs: [
        { id: 'hormuz-4-a', text: '这里从 2025 年常态切换到 2026 年扰动。EIA 估计石油流量从 2025 年第四季度的 21.6 降到 2026 年第二季度的 4.9 百万桶/日。', layerIds: ['hormuz-disruption'], sourceIds: ['eia-energy-security-2026'] },
        { id: 'hormuz-4-b', text: 'IEA 另估计 2026 年 9 月经海峡石油流量约 10.9 百万桶/日。这是不同机构、不同时间粒度的估计；AIS 资料在扰动期间尤其不完整，数字可能修订。', layerIds: ['hormuz-disruption'], sourceIds: ['iea-oct-2026', 'eia-energy-security-2026'] },
      ],
      claims: [
        { id: 'eia-before', value: '21.6 → 4.9', label: '经海峡石油估计流量', period: '2025 Q4 → 2026 Q2 · EIA', unit: '百万桶/日', sourceId: 'eia-energy-security-2026', qualifier: '季度口径；估值可能修订' },
        { id: 'iea-sep', value: '约 10.9', label: '经海峡石油估计流量', period: '2026 年 9 月 · IEA', unit: '百万桶/日', sourceId: 'iea-oct-2026', qualifier: '月度口径，不与 EIA 季度值直接连线' },
      ],
    },
    {
      id: 'hormuz-5', eyebrow: '05 / 陆上绕行', title: '能从陆上绕过去吗？', camera: { lon: 47.6, lat: 24.5, scale: 5.5 },
      layerIds: ['hormuz-saudi-pipeline', 'hormuz-uae-pipeline', 'hormuz-saudi-outlet', 'hormuz-uae-outlet'], sourceIds: ['iea-hormuz-factsheet', 'iea-apr-2026'],
      paragraphs: [
        { id: 'hormuz-5-a', text: '沙特的 Abqaiq→Yanbu 原油管道把部分货量送往红海；阿联酋的 Habshan→Fujairah 管道把部分货量送往阿曼湾。线段仅示意起讫和方向，不是精确管线。', layerIds: ['hormuz-saudi-pipeline', 'hormuz-uae-pipeline'], sourceIds: ['iea-hormuz-factsheet'] },
        { id: 'hormuz-5-b', text: 'IEA 对 2026 年初两条管道的可追加绕行能力估计为 3.5–5.5 百万桶/日原油；这不是当前实时余量，也无法替代全部油品或 LNG。', layerIds: ['hormuz-saudi-pipeline', 'hormuz-uae-pipeline'], sourceIds: ['iea-hormuz-factsheet'] },
        { id: 'hormuz-5-c', text: '从红海或阿曼湾出港后还能选择远洋路线；绕好望角只改变出海后的航程，不能让仍在波斯湾内的油轮绕开海峡。', layerIds: ['hormuz-saudi-outlet', 'hormuz-uae-outlet'], sourceIds: ['iea-apr-2026'] },
      ],
      claims: [{ id: 'bypass', value: '3.5–5.5', label: '可追加转移的原油能力', period: '2026 年初 · IEA 估计', unit: '百万桶/日', sourceId: 'iea-hormuz-factsheet', qualifier: '不是 2026 年 10 月实时空余能力' }],
    },
  ],
};

export const storyLayerById = new Map(HORMUZ_STORY.layers.map((layer) => [layer.id, layer]));
export const storyStepById = new Map(HORMUZ_STORY.steps.map((step) => [step.id, step]));

export function validateHormuzStory(): string[] {
  const errors: string[] = [];
  const actualStepIds = HORMUZ_STORY.steps.map((step) => step.id);
  if (actualStepIds.join('|') !== STORY_STEP_IDS.join('|')) errors.push('故事步骤必须与控制协议中的五个固定 ID 和顺序一致');
  const layerIds = new Set<string>();
  for (const layer of HORMUZ_STORY.layers) {
    if (layerIds.has(layer.id)) errors.push(`重复图层 ID：${layer.id}`);
    layerIds.add(layer.id);
    if (!actualStepIds.includes(layer.stepId as StoryStep['id'])) errors.push(`图层 ${layer.id} 指向不存在的步骤 ${layer.stepId}`);
    if (!layer.schematic || !layer.label.includes('示意')) errors.push(`图层 ${layer.id} 缺少常显的示意标识`);
    if (layer.pointLabels && (layer.geometry.type !== 'MultiPoint' || layer.pointLabels.length !== layer.geometry.coordinates.length)) errors.push(`图层 ${layer.id} 的点位标签数量与点位不一致`);
    if (layer.pointLabelOffsets && layer.pointLabelOffsets.length !== layer.pointLabels?.length) errors.push(`图层 ${layer.id} 的标签偏移数量与点位不一致`);
  }
  const paragraphIds = new Set<string>();
  for (const step of HORMUZ_STORY.steps) {
    if (!step.layerIds.length || !step.paragraphs.length || !step.sourceIds.length) errors.push(`步骤 ${step.id} 缺少图层、正文或来源`);
    for (const sourceId of step.sourceIds) if (!HORMUZ_STORY.sources[sourceId]) errors.push(`步骤 ${step.id} 引用未知来源 ${sourceId}`);
    for (const layerId of step.layerIds) {
      const layer = HORMUZ_STORY.layers.find((item) => item.id === layerId);
      if (!layer || layer.stepId !== step.id) errors.push(`步骤 ${step.id} 引用不属于该步骤的图层 ${layerId}`);
    }
    for (const paragraph of step.paragraphs) {
      if (paragraphIds.has(paragraph.id)) errors.push(`重复段落 ID：${paragraph.id}`);
      paragraphIds.add(paragraph.id);
      if (!paragraph.layerIds.length || !paragraph.sourceIds.length || !paragraph.text.trim()) errors.push(`段落 ${paragraph.id} 缺少正文、图层或来源`);
      for (const layerId of paragraph.layerIds) if (!step.layerIds.includes(layerId)) errors.push(`段落 ${paragraph.id} 引用不可见图层 ${layerId}`);
      for (const sourceId of paragraph.sourceIds) if (!step.sourceIds.includes(sourceId)) errors.push(`段落 ${paragraph.id} 引用未列在本步的来源 ${sourceId}`);
    }
    for (const claim of step.claims) {
      if (!claim.value.trim() || !claim.unit.trim() || !claim.period.trim()) errors.push(`数字卡 ${claim.id} 缺少数值、单位或时段`);
      if (!step.sourceIds.includes(claim.sourceId)) errors.push(`数字卡 ${claim.id} 引用未列在本步的来源 ${claim.sourceId}`);
    }
  }
  return errors;
}

const storyValidationErrors = validateHormuzStory();
if (storyValidationErrors.length) throw new Error(`霍尔木兹故事数据无效：${storyValidationErrors.join('；')}`);
