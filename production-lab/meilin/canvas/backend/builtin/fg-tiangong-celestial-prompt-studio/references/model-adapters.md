# 模型适配器

同一个视觉合同先保持不变，再做模型语法转换。不要因为换模型就改变主体、人物尺度、光线方向或叙事动作。

## 选择表

| 选择 | Prompt 形态 | 可否在当前环境直接出图 | 适合 |
| --- | --- | --- | --- |
| `midjourney` | 英文完整描述 + 参数 + 单独 `--no` | 当前无可确认的 MJ 直连时，不可声称已用 MJ 出图；可选 imagegen 预览 | 探索构图、建筑氛围、快速多版本 |
| `image2` | 自然语言制作规格，不带 MJ flags | 调用内置 `image_gen__imagegen`；结果按 imagegen 规则保存 | 需要直接生成、参考图生成、较明确的成片 brief |

## Midjourney 适配

### 写法

按“场景 → 主体 → 尺度 → 镜头 → 光线 → 材质 → 空气 → 情绪”写一段可复制的英文 prompt。用明确的空间关系代替空泛审美词，例如：

- `a tiny white-robed figure, less than one percent of the frame height, crossing the wet jade terrace`
- `three monumental structures at most, the lower foundations disappearing into the cloud sea`
- `telephoto compression, deep corridor vanishing point, foreground carved column base`
- `one motivated side-backlight, warm rim light against cold blue-grey atmospheric haze`

### 参数

未指定时，推荐：

```text
--ar 16:9 --s 100 --raw
```

按用户需要改为 `--ar 21:9`、`--ar 4:5` 或 `--ar 9:16`。只有用户明确指定 Midjourney 版本才加入 `--v <version>`；参考资料里的 `--v 8.2` 仅作为可选历史参数，不自动假设它是当前版本。

`--no` 保持短而具体，例如：

```text
--no illustration, anime, cartoon, centered portrait, dense building cluster, modern objects, unreadable text, watermark, black bars, plastic CGI, inconsistent shadows
```

不要同时堆叠互相冲突的“ultra-wide”和“telephoto compression”；必须根据构图目标选一个主镜头行为。不要把 `8k`, `masterpiece`, `trending on ArtStation` 当成必需参数。

### MJ 输出块

```text
Model: Midjourney
Prompt:
<one clean English prompt> --ar 16:9 --s 100 --raw

Avoid / --no:
<short avoid list>

Notes:
<why this lens, scale, and lighting were chosen>
```

如果用户说“直接用 Midjourney 生图”，先说明当前是否有 MJ 连接器。没有时，可以调用 imagegen 生成同一 brief 的预览，但输出块必须写清楚：`imagegen preview — not a Midjourney render`。

## image2 适配

### 写法

使用自然语言制作规格，包含用途和比例，不放 `--ar`、`--v`、`--raw` 等 Midjourney 参数：

```text
Use case: stylized-concept / cinematic key art
Asset type: <poster, video keyframe, cover, etc.>
Primary request: <what happens in the image>
Scene/backdrop: <cloud sea, palace, bridge, waterfall>
Subject and scale: <architecture first; tiny figure as scale marker>
Composition/framing: <camera, lens behavior, foreground/midground/background>
Lighting/mood: <one motivated light direction, rim light, volumetric haze>
Materials/textures: <wet jade, lacquer, roof tile, stone, water>
Color palette: <cold white/blue-grey plus restrained warm gold>
Output: <aspect ratio and intended use>
Constraints: no text unless exact text is supplied; no black bars; no watermark
Avoid: <negative constraints>
```

“image2”在用户口中可能只是模型称呼；若当前内置工具没有暴露具体模型字段，不要伪称使用了某个 API 模型。应写成“imagegen/image2-compatible route”，并以实际工具返回结果为准。

### 直接生成规则

用户明确要求“直接生图”时：

1. 先把最终 prompt 和 avoid list 固定下来。
2. 用内置 `image_gen__imagegen`，默认生成而不是编辑；参考图仅用于风格/构图时走 generate。
3. 本地参考图全部有路径时使用 `referenced_image_paths`；只有对话图片时使用最小 `num_last_images_to_include`；两者不同时使用。
4. 按 imagegen skill 检查主体、比例、文字、材质和禁止项；必要时只做单变量迭代。
5. 若用户指定了项目目录，生成后把最终文件复制到该目录，使用版本化文件名，不覆盖已有资产。
6. 返回实际生成结果、工具路由、保存路径、最终 prompt 和是否经过参考图。

如果内置工具不可用，不要未经用户同意切换 CLI/API；说明 fallback 需要用户明确选择，并遵守 imagegen skill 的 key、依赖和输出规则。

## 通用质量门槛

- 模型转换前后，主事件和空间关系一致。
- 人物没有膨胀成主角，建筑没有缩成背景贴图。
- 阶梯、桥、柱列和瀑布遵守重力与透视。
- 只有一个主要光源方向，暖冷关系清楚。
- 近处材质更具体，远处因空气透视更轻。
- 没有从参考图带入黑边、文字、水印或无关角色。
