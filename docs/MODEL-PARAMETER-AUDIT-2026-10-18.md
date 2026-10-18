# FG 模型参数复核 · 2026-10-18

基线：线上启用 22 个生成模型（4 文本、7 图片、9 视频、2 语音），另有 3 个语音工具，以及独立公司音乐工作流。以线上 `/channels/system` 的启用名单为准，不把仓库中已停用模型算作当前可选模型。未调用收费生成接口。

本表区分供应商 API 能力、FG 已开放的控件和公司限制；不是“供应商所有高级接口均已接入”的声明。WeToken 的日期后缀、`filter-off`、`t3a` 和 `wan3.0-video` 是渠道标识，官方文档可核对参数，不能证明转售渠道的底层权重、价格或服务承诺。

## 本次修正

- GPT Image 2.5 Flare / Sunburst：`size` 本身包含像素尺寸，不需要额外的 `imageResolution` 字段。修复前后端把分辨率限制在默认 1K 的错误。恢复 1K、2K、4K 档位；`quality=low` 也可搭配 3840×2160，不能把画质等级当分辨率。
- GPT 6.1 Sol：官方上下文 1,050,000 token、最大输出 128,000 token；更新旧能力声明。美林任务的输出上限随所选模型配置，常规阶段请求仍按实际需要申请，不自动把每次输出拉满。
- MiniMax H3：补齐提示词 7,000 字符、图片 30 MiB、视频 50 MiB、边长 256–5760、参考视频／音频单段最短 2 秒及各自累计最多 15 秒、混合引用总数最多 12；前后端生成前检查一致。格式和比例按 API 参考页，而非仅依赖简版指南。

## 图片模型（7 个）

| 线上模型 | 官方尺寸与比例重点 | FG 当前开放及边界 |
|---|---|---|
| GPT Image 2.5 Flare | `size=auto` 或合法像素尺寸；最长边 3840、16 的倍数、宽高比不超过 3:1、总像素 655360–8294400；独立画质 auto/low/medium/high/xhigh/max | 1K/2K/4K 合法预设和自适应；1–10 张、透明背景。4K 横屏 3840×2160、竖屏 2160×3840；方图使用 2880×2880，不能伪造不合法的 4096×4096。当前原生参数白名单开放预设，自定义像素、输出压缩等未全部开放 |
| GPT Image 2.5 Sunburst | 同上，尺寸与画质独立 | 同上；不根据渠道名推断两者能力或效果差异 |
| Seedream 5.0 Pro（dola-seedream-5-0-pro-260628） | 1K / 1.5K / 2K；921600–4624220 像素；最大长宽比 16:1 | 不开放 4K；最多 10 张参考图、单图 30 MiB。FG 单次节点输出一张；官方组图工作流不等同此计费单元 |
| Seedream 5.0 Lite（seedream-5-0-lite-260128） | 2K / 3K / 4K；3686400–16777216 像素；最大长宽比 16:1 | 最多 14 张参考图、单图 30 MiB；不把字符串 `auto` 塞给只接受尺寸／像素的接口 |
| Gemini 3.1 Flash Image Preview | 512px / 1K / 2K / 4K；14 种比例，包括 1:4、4:1、1:8、8:1 | 14 张参考图上限；分辨率映射原生 imageSize，比例映射 aspectRatio。当前配置显式选择比例 |
| Gemini Nano Banana 2.1 | 1K / 2K / 4K；14 种比例；最多 14 张参考图；没有 512px 档 | 自适应通过省略 aspectRatio 实现，可与 4K 同用。模型最终返回像素决定实际尺寸，不用 GPT 的像素表承诺 Gemini 输出 |
| Wan 2.7 Image Pro | 文生图支持 4K；编辑及组图最高 2K；589824–16777216 像素，最大长宽比 8:1 | 最多 9 张参考图、20 MiB；普通生成 1–4 张；带参考图时检查最高 4194304 像素，不能把文生图的 4K 能力套给编辑模式 |

官方依据：[OpenAI 图像指南](https://developers.openai.com/api/docs/guides/image-prompting)、[图像 API](https://developers.openai.com/api/reference/resources/images/methods/generate)、[Google 图像生成](https://ai.google.dev/gemini-api/docs/image-generation)、[Nano Banana 2.1](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1?hl=en)、[火山图片生成 API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=en)、[Wan 图片生成与编辑 API](https://help.aliyun.com/en/model-studio/wan-image-generation-and-editing-api-reference)。

## 视频模型（9 个）

| 线上模型 | 输出时长 / 分辨率 | 参考素材与限制重点 |
|---|---|---|
| Seedance 2.0 Standard（doubao-seedance-2-0-filter-off） | 4–15 秒；480p / 720p / 1080p / 4K | 9 图、3 视频、3 音频；视频及音频各累计最多 15 秒 |
| Seedance 2.0 Fast（doubao-seedance-2-0-fast-filter-off） | 4–15 秒；480p / 720p | 不复制 Standard 的 1080p / 4K 能力 |
| Seedance 2.0 Mini（dreamina-seedance-2-0-mini-filter-off） | 4–15 秒；480p / 720p | 不复制 Standard 的 1080p / 4K 能力 |
| Seedance 2.5（dreamina-seedance-2-5-filter-off） | 4–30 秒；480p / 720p / 1080p | 最多 30 图、10 视频、10 音频；视频和音频各累计最多 30 秒。输入参考视频最短 2 秒与输出最短 4 秒是不同约束 |
| HappyHorse 1.1 T2V | 3–15 秒；480P / 720P / 1080P | 文生视频，9 种固定比例 |
| HappyHorse 1.1 I2V | 3–15 秒；480P / 720P / 1080P | 有且只有 1 张首帧；比例跟随首帧，短边 ≥300、宽高比 0.4–2.5、图片 ≤20 MiB |
| HappyHorse 1.1 R2V | 3–15 秒；480P / 720P / 1080P | 1–9 张参考图，短边 ≥400、图片 ≤20 MiB；不能套用 I2V 的单图限制 |
| MiniMax H3 | 4–15 秒整数；768P / 2K | 9 图、3 视频、3 音频，混合最多 12 个；视频和音频单段 2–15 秒且各累计 ≤15 秒；文生模式不能选 adaptive，首尾帧跟随图比例 |
| Wan 3.0（wan3.0-video） | 2–30 秒；480p / 720p / 1080p | 10 图、5 视频、5 音频；视频／音频单段 1–15 秒且各累计 ≤15 秒；参考视频累计时长与输出时长合计 ≤30 秒；自适应和 6 种固定比例 |

Seedance 的文件格式、图片边长和体积限制、HappyHorse 的中外文提示词上限、Wan 的累计时长与像素限制分别保留在模型专属配置中，没有用一套通用默认值代替。

官方依据：[Seedance 2.0](https://docs.volcengine.com/docs/ark/seedance-2-0?lang=en)、[Seedance 2.5](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=en)、[火山视频任务 API](https://console.volcengine.com/ark/region%3Acn-beijing/docs/create-video-generation-task-api)、[HappyHorse 文生](https://help.aliyun.com/en/model-studio/happyhorse-text-to-video-api-reference)、[HappyHorse 图生](https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference)、[HappyHorse 参考生](https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference)、[MiniMax H3 API](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[Wan 3 API](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)。

## 文本模型（4 个）

| 线上模型 | 官方上下文 / 输出 token | FG 边界 |
|---|---|---|
| GPT 6.1 Sol · Trings 个人 Key | 1,050,000 / 128,000 | 个人授权；FG 图片附件限制 16 张属于平台限制，不冒充官方上限；阶段任务按需指定输出 |
| Claude Sonnet 5.5（claude-sonnet-5-5-t3a） | 1,000,000 / 128,000 | API 支持最多 600 张图；FG 保留 5 MiB 单图限制，属转售兼容的保守限制；官方直连为 10 MB（base64 后），Bedrock/Vertex 为 5 MB |
| Claude Opus 5.5（claude-opus-5-5-t3a） | 1,000,000 / 128,000 | 同上；t3a 为渠道别名 |
| DeepSeek V4 Pro | 1,048,576 / 393,216 | 文本模型，不显示图片／视频输入能力 |

官方依据：[GPT 6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)、[Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview)、[Claude 图像限制](https://platform.claude.com/docs/en/build-with-claude/vision)、[DeepSeek API](https://api-docs.deepseek.com/api/create-chat-completion/)。

## 语音模型、工具与音乐

- Seed TTS 2.0：FG 开放 MP3/WAV、7 个内置音色、0.5–2 倍语速，映射官方 speech_rate=-50…100；输出 24 kHz。官方更多采样率、PCM/Ogg Opus、字幕等尚未全部开放。[官方单向流式 TTS HTTP](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)。
- Seed Audio 1.0：现有渠道走 `/api/v3/tts/create`，提示词描述声音、MP3/WAV、48 kHz；FG 提示词限 3000 Unicode 字符、最长 120 秒来自现有接入和返回错误契约。公开一手资料不足以完整核实此端点全部可选参数，不能标为“全部官方参数已确认”。不显示不可用的固定音色选择；语速通过提示词描述。
- `volc.seedasr.sauc.duration`、`volc.seedasr.auc`、`volc.speech.mt` 是专用语音工具，不能当作音频生成模型。现有实现为流式识别、文件识别、机器翻译；固定采样率／批量大小等是 FG 接入范围，不代表供应商能力上限。已核对官方资源 ID 和文件识别 submit/query 路径；[官方语音模型清单](https://docs.volcengine.com/docs/DoubaoVoice/model-list?lang=zh)、[文件识别提交](https://docs.volcengine.com/docs/DoubaoVoice/task-submission-http-1?lang=zh)、[机器翻译 API](https://docs.volcengine.com/docs/DoubaoVoice/MachineTranslationLargeModel-APIAccessDocumentation?lang=zh)。
- `suno-company-music` 是独立公司音乐工作流，不能把第三方代理的参数称为 Suno 官方公开 API 参数；现有 MP3 工作流保留，不套用 TTS 参数。

## 未全部接入的高级 API 选项

当前控件只开放已有传输、校验与计费路径支持的参数：Google 搜索 grounding／thinking 控制、Wan palette／bbox／自动时长 -1／组图扩展、Seedream 多图组输出、更多音频编码采样率等，没有因为官方提到就添加一个实际无效的按钮。后续开放这些选项必须同时补齐请求映射、输入校验、费用预估和回归测试。

## 验证范围

用线上脱敏 Image 2.5 参数快照复现并修复；前端实际 ImageSettingsPanel 渲染检查 2K/4K，后端检查 3840×2160 + low 不降回 1K；H3 检查 12 个混合引用通过、13 个在提交前拒绝。部署验收另见对应发布记录。无收费生成；未用一张生成图替代所有模型、所有规格的实测证明。
