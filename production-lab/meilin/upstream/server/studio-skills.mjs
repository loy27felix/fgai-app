import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { SKILLS_DIR } from "./skills.mjs";
import { context } from "./fg-context.mjs";

const suite = [
  "short-drama-director",
  "sd-decision-engine",
  "sd-recon-engine",
  "sd-script-engine",
  "sd-overseas-engine",
  "sd-jieshuo-engine",
  "sd-asset-engine",
  "sd-storyboard-engine",
  "sd-combat-engine",
  "sd-xuanhuan-engine",
  "sd-real-engine",
  "sd-feed-engine",
  "sd-qc-engine",
];
export const STUDIO_CHAINS = Object.freeze([
  {
    id: "dream",
    name: "超级造梦",
    lead: "把强情节拍成大场面",
    description:
      "完整导演总控，按剧情选择文戏、玄幻、商业打戏或真人动作，贯穿资产、分镜与连续性质检。",
    skills: suite,
    stages: ["concept", "script", "assets", "storyboard", "prompts", "qc"],
  },
  {
    id: "prism",
    name: "超级棱镜",
    lead: "把一个想法打磨成好故事",
    description:
      "概念、人物、世界、分场逐步确认。每一步留得住，任何局部都能退回修改，再进入电影化制作。",
    skills: [
      "screenwriting-pipeline",
      "deepwhite-director-shooting-v3-7",
      "zy-cinematic-realism",
      "short-drama-asset-prompts",
      "acting",
    ],
    stages: [
      "concept",
      "characters",
      "world",
      "outline",
      "script",
      "audit",
      "assets",
      "storyboard",
      "prompts",
      "qc",
    ],
  },
  {
    id: "screen",
    name: "超级银幕",
    lead: "让人物与镜头一起讲故事",
    description:
      "先把动机、对白和因果写扎实，再打磨形象、表演、走位与视线，适合电影感短片。",
    skills: [
      "screenwriter",
      "lira-image-prompts",
      "acting",
      "cinedance-higgsfield",
      "tygg-ai-film-studio",
    ],
    stages: ["concept", "script", "assets", "storyboard", "prompts", "qc"],
  },
  {
    id: "spark",
    name: "超级爆点",
    lead: "开场抓人，每一回合有回报",
    description:
      "从钩子、冲突升级和反转设计连续短剧；文戏与武戏分别导演，保留集尾追更动力。",
    skills: [
      "short-drama-factory",
      "short-drama-asset-prompts",
      "script-to-drama-prompt-dev",
      "wuxi-action-director-public",
      "zy-cinematic-realism",
    ],
    stages: [
      "concept",
      "outline",
      "script",
      "assets",
      "storyboard",
      "prompts",
      "qc",
    ],
  },
]);
export const STAGE_NAMES = {
  concept: "故事方案",
  characters: "人物圣经",
  world: "世界与规则",
  outline: "分场大纲",
  script: "完整剧本",
  audit: "剧本体检",
  assets: "角色与场景",
  storyboard: "导演分镜",
  prompts: "视频 Prompt",
  qc: "连续性质检",
};
const pipeline = {
  concept: "01_概念锚定.md",
  characters: "02_角色圣经.md",
  world: "03_世界观.md",
  outline: "04_分场大纲.md",
  script: "05_剧本深度融合.md",
  audit: "06_剧本压力测试.md",
};
const ref = (id, ...names) => names.map((n) => [id, "references/" + n]);
const skills = (...ids) => ids.map((id) => [id, "SKILL.md"]);
const fullSuite = (stage, locks) => {
  const manager = skills("short-drama-director");
  if (stage === "concept")
    return [
      ...manager,
      ...ref(
        "short-drama-director",
        "track-routing.md",
        "asset-delivery-modes.md",
        "style-bible/style-lock-protocol.md",
      ),
    ];
  if (stage === "script")
    return [
      ...manager,
      ...skills("sd-script-engine"),
      ...ref(
        "sd-script-engine",
        "six-stage-pipeline.md",
        "dialogue-naturalization.md",
        "external-script-polish.md",
      ),
      ...ref("short-drama-director", "dialogue-doctor-7d.md"),
      ...(locks.source === "对标爆款" || locks.source === "热点速成"
        ? skills("sd-recon-engine")
        : []),
      ...(locks.track === "海外剧" ? skills("sd-overseas-engine") : []),
      ...(locks.track === "解说叙事" ? skills("sd-jieshuo-engine") : []),
    ];
  if (stage === "assets")
    return [
      ...manager,
      ...skills("sd-asset-engine"),
      ...ref(
        "sd-asset-engine",
        "scene-grid-template.md",
        "character-portrait-templates.md",
        "prop-template.md",
      ),
      ...ref(
        "short-drama-director",
        "asset-delivery-modes.md",
        "asset-spatial-ledger.md",
      ),
    ];
  if (stage === "storyboard" || stage === "prompts") {
    const combat =
      locks.action === "玄幻仙侠"
        ? "sd-xuanhuan-engine"
        : locks.action === "真人写实"
          ? "sd-real-engine"
          : locks.action === "商业打戏"
            ? "sd-combat-engine"
            : null;
    const core = {
      "sd-xuanhuan-engine": [
        "core-combat-laws.md",
        "camera-specs-15modes.md",
        "close-quarters-engine.md",
        "xuanhuan-elements-vfx.md",
        "grand-scale-domains.md",
        "arsenal-moves-library.md",
        "arsenal-parameter-library.md",
        "character-scene-presets.md",
        "epic-battlefield-protocols.md",
      ],
      "sd-real-engine": [
        "r1-combat-core.md",
        "kinetic-chain-11.md",
        "defense-evasion-rules.md",
        "impact-physics.md",
        "camera-action-specs.md",
        "render-adapters.md",
      ],
      "sd-combat-engine": [
        "combat-iron-laws.md",
        "combat-construction.md",
        "eight-sentence-masters.md",
        "combat-intensity-guardrails.md",
        "combat-rhythm-and-load-guardrails.md",
        "tier-and-finisher-system.md",
        "vfx-rendering-mandate.md",
        "impact-frame-and-banlist.md",
      ],
    };
    return [
      ...manager,
      ...skills("sd-decision-engine", "sd-storyboard-engine"),
      ...ref(
        "sd-decision-engine",
        "context-mapping.md",
        "emotion-anchor-table.md",
        "forbidden-zone-whitelist.md",
      ),
      ...ref(
        "short-drama-director",
        "acting-direction.md",
        "blocking-direction.md",
        "segment-splicing.md",
      ),
      ...ref(
        "sd-storyboard-engine",
        "short-drama-camera-system.md",
        "shot-economy-and-acting.md",
        "scene-space-adaptation.md",
        "segment-linkage.md",
        "storyboard-sheet-template.md",
      ),
      ...(combat ? [...skills(combat), ...ref(combat, ...core[combat])] : []),
      ...(stage === "prompts"
        ? [
            ...skills("sd-feed-engine"),
            ...ref(
              "sd-feed-engine",
              "feed-mode-and-gates.md",
              "asset-mapping-and-rules.md",
            ),
            ...ref("short-drama-director", "prompt-feeding-checklist.md"),
          ]
        : []),
    ];
  }
  return [
    ...manager,
    ...skills("sd-qc-engine"),
    ...ref("sd-qc-engine", "machine-check-manual.md", "continuity-ledger.md"),
  ];
};
export function chainCatalog() {
  return STUDIO_CHAINS.map((c) => ({
    ...c,
    stages: c.stages.map((id) => ({ id, name: STAGE_NAMES[id] })),
    available: c.skills.every((id) =>
      existsSync(resolve(SKILLS_DIR, id, "SKILL.md")),
    ),
  }));
}
export function phaseSources(chainId, stage, locks = {}) {
  if (stage === "audit")
    return [
      ...skills("screenwriting-pipeline"),
      ...ref(
        "screenwriting-pipeline",
        "00_编剧SKILL全流程_总控.md",
        "06_剧本压力测试.md",
      ),
    ];
  if (chainId === "dream") return [
    ...fullSuite(stage,locks),
    ...(locks.track==='海外剧'?skills('sd-overseas-engine'):[]),
    ...(locks.track==='解说叙事'?skills('sd-jieshuo-engine'):[]),
    ...(stage==='concept'&&['对标爆款','热点速成'].includes(locks.source)?skills('sd-recon-engine'):[]),
  ];
  if (chainId === "prism" && pipeline[stage])
    return [
      ...skills("screenwriting-pipeline"),
      ...ref(
        "screenwriting-pipeline",
        "00_编剧SKILL全流程_总控.md",
        pipeline[stage],
      ),
    ];
  if (chainId === "screen")
    return stage === "concept" || stage === "script"
      ? [
          ...skills("screenwriter"),
          ...[
            "methodology.md",
            "style-rules.md",
            "workflow.md",
            "timing-and-cutting.md",
          ].map((n) => ["screenwriter", n]),
        ]
      : stage === "assets"
        ? skills("lira-image-prompts")
        : stage === "storyboard" || stage === "prompts"
          ? [
              ...skills(
                "acting",
                "cinedance-higgsfield",
                "tygg-ai-film-studio",
              ),
              ...ref(
                "tygg-ai-film-studio",
                "directing-story-and-editing.md",
                "camera-and-action.md",
                "reference-prompt-template.md",
                "ai-video-and-asset-prompts.md",
              ),
            ]
          : skills("acting");
  if (chainId === "spark" && ["concept", "outline", "script"].includes(stage))
    return [
      ...skills("short-drama-factory"),
      ...ref(
        "short-drama-factory",
        "golden-3s-hook-library.md",
        "first-three-eps-beat-card.md",
        "emotion-flow-roundtrip.md",
        "cliffhanger-master-formulas.md",
        "continuity-ledger.md",
        "dialogue-doctor-anti-ai.md",
      ),
    ];
  if (stage === "assets")
    return [
      ...skills("short-drama-asset-prompts"),
      ...ref("short-drama-asset-prompts", "public-asset-templates.md"),
    ];
  if (chainId === "prism" && ["storyboard", "prompts"].includes(stage))
    return [
      ...skills(
        "deepwhite-director-shooting-v3-7",
        "acting",
        "zy-cinematic-realism",
      ),
      ...[
        "SCRIPT_FIDELITY.md",
        "ASSET_CONFIRMATION.md",
        "SPATIAL_BLOCKING.md",
        "SEEDANCE_2_5_RULES.md",
        "PLANNING_CAPACITY.md",
        "DRAMA_SHOT_MOMENTUM.md",
        "DYNAMIC_MOTION_PHYSICS.md",
        "DYNAMIC_SPATIAL_LOCK.md",
      ].map((path) => [
        "deepwhite-director-shooting-v3-7",
        "reference/" + path,
      ]),
      ...ref(
        "zy-cinematic-realism",
        "cinematic-principles.md",
        "camera-and-light.md",
        "quality-checklist.md",
      ),
    ];
  if (chainId === "spark" && ["storyboard", "prompts"].includes(stage))
    return [
      ...skills(
        "script-to-drama-prompt-dev",
        ...(locks.action !== "文戏" ? ["wuxi-action-director-public"] : []),
        "zy-cinematic-realism",
      ),
    ];
  return skills("zy-cinematic-realism");
}
export function loadPhase(chainId, stage, locks = {}) {
  if (!STUDIO_CHAINS.some((c) => c.id === chainId))
    throw Error("请选择有效制作链路");
  const root = realpathSync(SKILLS_DIR),
    sources = [
      ...new Map(
        phaseSources(chainId, stage, locks).map(([id, path]) => [
          id + "/" + path,
          { id, path },
        ]),
      ).values(),
    ];
  const receipts = [];
  const text = sources
    .map(({ id, path }) => {
      const location = resolve(root, id, path);
      if (!existsSync(location))
        throw Error(`完整技能包缺少 ${id}/${path}，请管理员补齐后重试`);
      const real = realpathSync(location),
        rel = relative(root, real);
      if (rel.startsWith("..") || isAbsolute(rel) || !real.endsWith(".md"))
        throw Error("技能参考路径无效");
      const value = readFileSync(real, "utf8"),
        sha256 = createHash("sha256").update(value).digest("hex");
      receipts.push({ id, path, sha256 });
      return `<skill-source name="${id}/${path}">\n${value}\n</skill-source>`;
    })
    .join("\n\n");
  const c = context();
  if (c) {
    c.skillsUsed ||= {};
    for (const r of receipts) c.skillsUsed[r.id + "/" + r.path] = r.sha256;
  }
  return { text, receipts };
}
