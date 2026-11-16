# FG 玻璃视觉资产

2026-10-07 前端视觉预览。使用内置 imagegen 生成，原生 PNG 保留；没有第三方参考站的截图或素材进入产品。

| 文件 | 用途 | 提示词约束 |
| --- | --- | --- |
| glass-atmosphere.png | 工作台、管理中心环境背景 | Wide panoramic original premium creative studio wallpaper. Light passing through massive translucent frosted glass sheets. Milky ice-blue horizon, champagne light left, steel-blue reflected edge right. Smooth low-detail left and center for readable UI. Quiet architectural glass, no interface, no text, no logo, no purple blobs or neon. |
| agent-glass-orb.png | 创作首页、Agent 入口动态球 | One living optic-glass sphere isolated on true transparent background. Frosted pearlescent blue-white core, flowing liquid interior, delicate cyan filaments, champagne rim reflection. Clear circular silhouette at 40px, no face, no text, no floor, no frame. Calm premium studio sculpture. |
| fg-logo-master.png | FG 核心标识生成母稿 | Exact letters FG, custom architectural monogram, deep midnight blue on opaque white. Modular F and open rounded-square G. One horizontal negative-space light slit echoed in both letters. Flat 2D, readable at 24px, no slogan, bevel, shadow, annotations or mockup. |

产品内的 FG 标识在 `components/brand/brand-logo.tsx` 中用可缩放的 SVG 重新绘制，保留母稿的光缝与横向模数。已有自定义标识仍服从原有外观设置。

Agent 的轻微呼吸、光线位移和悬停磁吸为前端动画；不是已绑定骨骼的 Live2D 模型。已有 Live2D 设置、加载与交互保留。

React Bits 的 SpotlightCard、Magnet 经适配用于统计卡片和首页玻璃球；来源及许可证保存在 `src/components/ui/react-bits-LICENSE.md`。减少动画模式下停止装饰动画；触屏不启用鼠标磁吸。
