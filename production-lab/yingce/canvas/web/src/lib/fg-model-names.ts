/** Display names only. Provider identifiers remain unchanged in every request. */
const names: Record<string,string> = {
 'doubao-seedance-2-0-filter-off':'SD2',
 'doubao-seedance-2-0-fast-filter-off':'SD2-fast',
 'dreamina-seedance-2-0-mini-filter-off':'SD2-mini',
 'dreamina-seedance-2-5-filter-off':'SD2.5',
 'happyhorse-1.1-i2v':'HappyHorse 1.1 · 图生',
 'happyhorse-1.1-r2v':'HappyHorse 1.1 · 参考',
 'happyhorse-1.1-t2v':'HappyHorse 1.1 · 文生',
 'MiniMax-H3':'MiniMax H3', 'wan3.0-video':'Wan 3.0',
 'dola-seedream-5-0-pro-260628':'Seedream 5 Pro',
 'seedream-5-0-lite-260128':'Seedream 5 Lite',
 'gemini-3.1-flash-image-preview':'Gemini 3.1 Flash Image',
 'gemini-3-pro-image-preview':'Gemini 3 Pro Image',
 'gpt-image-2':'GPT Image 2', 'gpt-image-2.5-flare':'GPT Image 2.5 Flare',
 'gpt-image-2.5-sunburst':'GPT Image 2.5 Sunburst', 'wan2.7-image-pro':'Wan 2.7 Image',
 'claude-opus-5-5-t3a':'Claude Opus 5.5', 'claude-sonnet-5-5-t3a':'Claude Sonnet 5.5',
 'deepseek-v4-pro':'DeepSeek V4 Pro', 'gemini-3.5-pro':'Gemini 3.5 Pro',
 'gpt-6-astra':'GPT 6 Astra', 'gpt-5.6-sol-t1a':'GPT 5.6 Sol',
};
export function fgModelName(id:string,fallback=id){return names[id] || fallback;}
