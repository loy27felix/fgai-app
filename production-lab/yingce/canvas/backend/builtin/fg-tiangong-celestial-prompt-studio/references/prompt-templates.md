# Prompt 模板与返回格式

## 最小输入模板

没有足够信息时，先按以下字段组织需求；能合理推断的字段直接补齐，不要为了每个字段都追问用户：

```text
Model: midjourney | image2
Use: concept art | poster | video keyframe | cover
Scene: <发生什么>
Architecture: <宫殿/桥/阶梯/长廊/瀑布/亭台>
Environment: <云海/峡谷/山峰/夜空/雾>
Character: <可选；服装、动作、尺度>
Camera: <机位、焦段行为、构图>
Light: <时间、主光方向、雾中光>
Materials: <玉、漆、瓦、青铜、湿岩、水>
Mood: <庄严/寂静/神圣/巨物恐惧/梦幻>
Ratio: 16:9
Text: <无；或逐字写出>
Reference role: style | content | edit target
```

## Midjourney 示例模板

```text
An immense ancient Chinese celestial palace suspended above a realistic sea of clouds, one monumental white-jade bridge crossing a mist-filled gorge toward a distant gate, a tiny figure in pale Han-style robes standing near the lower edge as a scale marker, the figure less than one percent of the frame height. Telephoto architectural photography, long leading lines, foreground carved jade railing softly out of focus, middle bridge and palace sharply resolved, distant roofs dissolving into cool blue-grey atmospheric haze. One low side-backlight creates restrained warm-gold rim light on wet jade and dark glazed tiles while the underside of the eaves falls into deep shadow. Wet stone, shallow reflective water film, oxidized bronze details, wind-pulled fabric, physically coherent waterfall and cloud mist. Quiet, solemn, dreamlike Eastern mythic realism, cinematic film grain, monumental negative space, no dense cluster of buildings.
--ar 16:9 --s 100 --raw
```

Avoid line:

```text
--no anime, cartoon, illustration, centered portrait, dense building cluster, generic fantasy castle, modern objects, unreadable text, watermark, black bars, plastic CGI, inconsistent shadows
```

这个示例只是结构示范。换成用户的场景、角色和镜头，不要机械复用桥、门或人物。

## image2 示例模板

```text
Create a cinematic wide keyframe for an Eastern mythic celestial-palace scene. Show one colossal white-jade palace bridge emerging from a realistic cloud sea and crossing a deep gorge toward a distant open gate. Place one tiny figure in pale Han-style robes near the lower edge, less than one percent of the frame height, only to establish scale. Use a telephoto architectural-photography perspective with strong leading lines: a softly blurred carved jade railing in the foreground, the bridge and main palace in the middle ground, and distant roofs fading into cool blue-grey atmospheric haze. Use one low side-backlight from the left, restrained warm-gold rim light on wet jade and dark glazed roof tiles, deep cool shadows under the eaves, and volumetric light through natural mist. Show wet jade pores, shallow reflective water films, weathered lacquer, oxidized bronze, gravity-driven waterfall spray, and wind moving the robe. Mood: quiet, solemn, monumental, dreamlike, realistic cinematic concept art. Wide 16:9 composition, no text, no watermark, no black bars, no modern objects, no cartoon or anime styling, no plastic CGI, no dense city of buildings.
```

## 直接生图时的返回格式

```text
模型：image2（实际路由：imagegen/image2-compatible）
风格解析：东方巨构建筑 + 极小人物尺度 + 冷暖侧逆光 + 湿玉/云海真实材质。

最终 Prompt：
<完整 image2 prompt>

Avoid：
<负面约束>

生成结果：
<内置 imagegen 结果或图片预览>
保存路径：
<实际路径；如果仅预览则明确说明>
```

## 只要 prompt 时的返回格式

```text
模型：<Midjourney 或 image2>
风格解析：<一句话>

Prompt：
<对应模型 prompt>

Avoid / 参数：
<MJ 参数与 --no，或 image2 约束>

构图说明：<机位、前中后景、人物尺度>
```

## 海报文字规则

如果用户要把标题、文案或 logo 放进图里：

1. 单独列出 `Text (verbatim)`，逐字保留大小写、标点和换行。
2. 在 prompt 中要求文字“exactly as provided”，并说明位置和留白。
3. 对复杂中文标题，建议先生成无字底图，再在设计软件中排版；不要把模型可能生成的乱码当作成品。
4. 如果用户只说“参考某海报”，只吸收布局、留白和色彩，不复制原文或品牌标识。
