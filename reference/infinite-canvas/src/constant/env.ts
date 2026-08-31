import { SYSTEM_VERSION } from "@/lib/version";

// The reference canvas is embedded in FG Studio.  It must show this product's
// version rather than the upstream demo's development marker.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || SYSTEM_VERSION;

// 官方插件清单地址:CI 发布到 plugins-dist 分支,经 jsDelivr 远程拉取;可用环境变量覆盖成自建来源
export const PLUGIN_REGISTRY_URL = process.env.NEXT_PUBLIC_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
