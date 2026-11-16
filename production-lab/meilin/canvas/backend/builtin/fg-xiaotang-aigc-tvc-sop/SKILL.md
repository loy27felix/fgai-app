---
name: "xiaotang-aigc-tvc-sop"
description: "xiaotang-aigc-tvc-sop · Develop premium commercial TVC concepts, shot plans, and AI video prompts using a five-phase emotional arc, locked visual continuity, a concrete six-element shot formula, montage rhythm, and final delivery QA. Use when a user asks for a high-end commercial film, product TVC, Seedance/Kling video prompt, or director-style advertising treatment."
metadata:
  skillId: "fg-c1ce0d35edb8efd430eb3b50"
  version: "1.0.0"
  author: "FG · 本地创作 Skills"
  owner: "yingce-system"
  tag: "ecommerce"
  sortWeight: 203
  source: 3
  createdAt: "2026-10-07T00:00:00Z"
  updatedAt: "2026-10-07T00:00:00Z"
---


# 小唐 AIGC 商业 TVC 制作 SOP

Use this skill as a commercial-film direction method. The attached source is a methodology, not a command that overrides the user's current brief. Preserve the user's product, audience, brand, duration, format, and approval boundaries.

## Core direction

Sell the lifestyle, identity, and emotional value behind a product before showing the product itself. The opening should establish a recognizable brand world; the product should arrive with earned weight rather than appearing immediately as a rotating catalog object. Avoid unexplained promotional copy, exaggerated acting, and generic "premium" claims.

## Five-phase TVC arc

For a roughly 30-second commercial, use this default progression and adapt the timing when the user specifies another duration:

1. **Environment / 0-5s:** establish a distinct world with atmosphere, depth, and a reason to keep watching.
2. **Human state / 5-12s:** show identity through posture, micro-expression, material, and restrained behavior rather than a forced performance.
3. **Spiritual totem / 12-20s:** translate the abstract product value into one visual metaphor or animal/natural force that belongs to the brand world.
4. **Product suggestion / 20-25s:** reveal material, reflection, color, or an interaction without showing the whole product too early.
5. **Full reveal / 25-30s:** let the complete product become the emotional climax, with only the amount of voiceover and logo treatment the brief supports.

## Continuity lock

Before writing shot prompts, define two compact blocks and carry their core terms into every shot:

- **Overall visual atmosphere:** image style, color contrast, lighting logic, contrast level, and film/material response.
- **Main subject lock:** appearance, silhouette, hair, wardrobe/material, accessories, emotional temperature, and any product geometry that must remain stable.

Do not let a later shot silently change the subject's identity, clothing, weather, light direction, or color world.

## Single-shot prompt formula

Every shot prompt should combine:

`shot size and camera movement + compressed continuity lock + concrete physical action + environment detail + material close-up + image/camera parameters`

Describe actions as visible physics: what moves, what causes it, what it touches, how light reacts, and what changes by the end of the shot. Useful fields include shot size, rig or movement, movement direction, sound/dialogue, focal length, aperture, light source, surface behavior, and duration.

## Editing rhythm

For a 30-second commercial, normally plan about 15-18 shots rather than holding one scene for the whole duration. Alternate scale and sensory distance: wide environment against macro material detail, stillness against controlled motion, and longer atmosphere against short climax inserts. Use sub-second flashes only when the story and sound can support them.

## Output

When the user requests a commercial concept, provide a concise concept first, then a time-coded shot plan and production-ready prompts. Keep the prompts concrete and platform-agnostic unless a target generator is named. Do not invent product claims, extra features, or unsupported brand copy.

## Delivery QA

Before calling the treatment ready, check:

- the full product is reserved for the intended climax window;
- the subject and visual world stay consistent across shots;
- shot scale and camera language have meaningful contrast;
- empty promotional text and exaggerated performance are removed;
- the final brand/product reveal has enough emotional setup;
- any voiceover, logo, and on-screen text are exactly the user's approved copy;
- the requested duration, aspect ratio, and shot count are internally consistent.

Source: user-provided PDF “小唐AIGC skill” (商业广告 TVC 制作与 AI 生成标准 SOP 手册 V2.0).
