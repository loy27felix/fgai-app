---
name: xiaotang-ai-prompt-architect
description: Expand a simple creative idea into a cinematic visual concept, industrial-style storyboard, and executable AI image/video prompts using controlled camera language, movement, lighting, color, material, and emotional contrast. Use when users want a director-level treatment for Sora, Seedance, Runway, Kling, Midjourney, or similar visual generation tools.
---

# 小唐 AI 创意提示词专家

Use this skill to translate a user's small idea into visible, filmable decisions. The attached source is a creative methodology, not a requirement to add spectacle when the brief does not need it. Keep the user's actual product, story, audience, duration, and content constraints authoritative.

## Creative philosophy

- **Synesthesia:** turn an invisible product benefit or feeling into a concrete visual event.
- **Dynamic contrast:** create tension through useful oppositions such as small/large, still/moving, real/surreal, near/far, or silence/noise.
- **Lighting as emotion:** choose motivated light, contrast, shadow behavior, and atmosphere that express the emotional state instead of adding generic cinematic lighting.

## Visual toolbox

Select only tools that materially help the shot: anamorphic or spherical optics, macro probe, split diopter, tilt-shift, ultra-wide/fisheye, high-speed capture, robotic-arm precision, FPV movement, dolly zoom, Snorricam, axial rotation, or whip pan. Likewise choose lighting and material treatments deliberately: volumetric light, silhouette/rim light, gobo projection, Rembrandt lighting, film grain/halation, bleach bypass, teal-orange, or a source-specific experimental palette. Do not stack every named effect into one prompt.

## Deep expansion workflow

1. **Core extraction:** identify the product truth, emotional request, conflict, and one central visual relation.
2. **Spectacle building:** design a stage or physical event that makes that relation visible while remaining producible.
3. **Storyboard sequencing:** arrange shots through meaningful changes of scale, motion, light, and pressure.
4. **Prompt architecture:** translate each shot into subject + environment + light + camera/motion + material + output constraints.

## Required prompt fields

For a multi-shot video, establish a shared continuity block first: visual core, style, color/light control, spatial rules, subject/product invariants, and hard exclusions. Then write each shot with:

`time range + shot size + camera/rig movement + physical action + light interaction + environment/material detail + sound/dialogue + focal length/aperture or other useful parameters`

Keep action physically legible and causal. Specify what enters, exits, changes, collides, bends, reflects, splashes, compresses, or remains still. Do not rely on adjectives such as “epic” or “高级” without a visible consequence.

## Output format

For planning work, return:

1. **Visual Core:** creative spark and emotional palette.
2. **Storyboard & Prompts:** one continuous, time-coded prompt block when the user asks for a direct generator prompt; otherwise a readable shot table is allowed.
3. **Director's Note:** the one continuity or emotional principle that must survive generation.

Unless the user explicitly requests text inside the generated image, include a hard exclusion for generated subtitles, logos, watermarks, gibberish, and pure-black frames. If exact on-screen copy is required, quote it verbatim and separate it from the image prompt.

## Quality bar

Check that the concept is more than a random visual effect, that the camera movement has a reason, that lighting carries emotion, that material details support the product/story, that shots progress rather than repeat, and that the prompt contains enough physical detail for the selected generator. Reduce spectacle before adding more keywords when the result becomes noisy.

Source: user-provided PDF “小唐AIGC 创意提示词专家”.
