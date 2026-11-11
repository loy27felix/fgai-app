type ServiceDefinition = {
  label: string; paths: readonly string[]; dependencies: readonly string[];
  data: 'fg' | 'production-lab' | 'canvas' | 'gateway' | 'native' | 'product' | 'browser' | 'unavailable'; runtime: 'fg' | 'canvas' | 'independent';
};

// This is a source/service map, not proof that a service is deployed or that a request crossed it.
// 目录只说明源码及服务边界，不证明服务已部署，也不证明本次请求经过该服务。
export const supportServices = {
  fg: { label: '共享源码与历史主站实现（不作为业务取证服务）', paths: ['app/', 'lib/', 'components/'], dependencies: [], data: 'fg', runtime: 'fg' },
  'production-lab': { label: 'Production Lab 制作工作台与独立业务库', paths: ['app/api/production-lab/', 'app/production-lab/', 'components/production-lab/', 'lib/production-lab/', 'production-lab/migrations/', 'production-lab/prototype/'], dependencies: ['fg'], data: 'production-lab', runtime: 'fg' },
  'yingce-web': { label: 'Yingce 网页与制作界面', paths: ['production-lab/yingce/canvas/web/', 'production-lab/yingce/canvas/director-desk/'], dependencies: ['yingce-gateway', 'canvas'], data: 'browser', runtime: 'independent' },
  'yingce-gateway': { label: 'Yingce 接入网关、鉴权与音乐/语音任务', paths: ['production-lab/yingce/gateway/'], dependencies: ['canvas', 'fg'], data: 'gateway', runtime: 'independent' },
  canvas: { label: 'Yingce Canvas Go 后端与任务执行', paths: ['production-lab/yingce/canvas/backend/'], dependencies: ['yingce-agent'], data: 'canvas', runtime: 'canvas' },
  'yingce-agent': { label: 'Yingce 独立 Agent 服务', paths: ['production-lab/yingce/canvas/yingce-agent/'], dependencies: ['canvas'], data: 'native', runtime: 'independent' },
  arcreel: { label: 'ArcReel 小说转视频', paths: ['production-lab/arcreel/'], dependencies: ['yingce-gateway'], data: 'product', runtime: 'independent' },
  opencreator: { label: 'OpenCreator 创作服务', paths: ['production-lab/opencreator/'], dependencies: ['yingce-gateway'], data: 'product', runtime: 'independent' },
  adcraft: { label: 'AdCraft 广告工作台', paths: ['production-lab/adcraft/'], dependencies: ['yingce-gateway'], data: 'product', runtime: 'independent' },
  meilin: { label: 'Meilin 服务', paths: ['production-lab/meilin/'], dependencies: ['yingce-gateway'], data: 'product', runtime: 'independent' },
  suno: { label: 'Suno 音乐服务', paths: ['production-lab/suno/'], dependencies: ['yingce-gateway'], data: 'product', runtime: 'independent' },
  infrastructure: { label: '反向代理、部署、数据库与存储基础设施', paths: ['docker/', 'scripts/', 'production-lab/yingce/canvas/docker/', 'production-lab/yingce/canvas/scripts/'], dependencies: [], data: 'unavailable', runtime: 'independent' },
  repository: { label: '其他仓库代码（待确定运行服务）', paths: [], dependencies: [], data: 'unavailable', runtime: 'independent' },
} as const satisfies Record<string, ServiceDefinition>;

export type SupportServiceId = keyof typeof supportServices;

// Preserve multi-service investigation; only retired main-site modules are excluded.
// 保留多服务排查范围，只排除已废弃的主站模块，不把 Yingce 当作唯一来源。
export const supportInvestigationServices = (Object.keys(supportServices) as SupportServiceId[])
  .filter(service => supportServices[service].runtime !== 'fg');
export function supportInvestigationServiceId(value: unknown): SupportServiceId | undefined {
  return supportInvestigationServices.find(service => service === value);
}
export function supportServiceId(value: unknown): SupportServiceId | undefined {
  return typeof value === 'string' && Object.hasOwn(supportServices, value) ? value as SupportServiceId : undefined;
}
export function serviceForCodePath(path: string): SupportServiceId {
  if (['middleware.ts', 'instrumentation.ts', 'next.config.mjs'].includes(path)) return 'fg';
  if (/^(?:docker-compose|Dockerfile|nginx)|(?:^|\/)(?:docker-compose[^/]*\.ya?ml|Dockerfile[^/]*)$/.test(path)) return 'infrastructure';
  let selected: SupportServiceId = 'repository';
  let length = 0;
  for (const [id, service] of Object.entries(supportServices)) for (const prefix of service.paths) {
    if (path.startsWith(prefix) && prefix.length > length) { selected = id as SupportServiceId; length = prefix.length; }
  }
  return selected;
}
export function supportServiceDirectory() {
  return supportInvestigationServices.map(id => ({ id, ...supportServices[id],
    dependencies: supportServices[id].dependencies.filter(dependency => !!supportInvestigationServiceId(dependency)),
    runtimeCoverage: supportServices[id].runtime === 'independent' ? '按服务配置独立版本接口，每次实测身份/commit/dirty；未配置、不可达或开发构建不得冒充已核对运行源码' : '每次核对对应运行快照/版本接口，失败则仅参考源码',
    dataCoverage: supportServices[id].data === 'browser' ? '浏览器没有独立业务库或服务端原生日志；核对本服务版本与浏览器线索，业务状态和请求另查canvas及yingce-gateway，各自标记来源，不冒充浏览器日志' : supportServices[id].data === 'unavailable' ? '尚无原生业务库适配；仅在配置且验证本服务结构化日志源后读取，绝不回退其他服务' : '已实现只读适配，是否配置、可达及覆盖范围以本次查询结果为准',
  }));
}
