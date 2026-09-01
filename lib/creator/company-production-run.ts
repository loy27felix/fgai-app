export const COMPANY_PRODUCTION_STAGES = [
  "research",
  "script",
  "visuals",
  "plan",
  "render",
  "assembly",
] as const;

export type CompanyProductionStage = (typeof COMPANY_PRODUCTION_STAGES)[number];
export type CompanyProductionActiveStage = CompanyProductionStage | "complete";

export type CompanyProductionState = {
  version: 1;
  title: string;
  assemble: boolean;
  stage: CompanyProductionActiveStage;
  confirmedStages: CompanyProductionStage[];
  updatedAt: string;
};

type CreateInput = {
  title: string;
  assemble: boolean;
};

function stageIndex(stage: CompanyProductionStage) {
  return COMPANY_PRODUCTION_STAGES.indexOf(stage);
}

export function nextCompanyProductionStage(state: CompanyProductionState): CompanyProductionStage | null {
  if (state.stage === "complete") return null;
  return state.stage;
}

export function createCompanyProductionState(input: CreateInput): CompanyProductionState {
  return {
    version: 1,
    title: input.title.trim().slice(0, 120) || "未命名制片项目",
    assemble: input.assemble,
    stage: "research",
    confirmedStages: [],
    updatedAt: new Date().toISOString(),
  };
}

export function advanceCompanyProductionStage(
  state: CompanyProductionState,
  confirmedStage: CompanyProductionStage,
): CompanyProductionState {
  const expected = nextCompanyProductionStage(state);
  if (!expected) throw new Error("制片项目已经完成");
  if (confirmedStage !== expected) {
    const label = {
      research: "调研",
      script: "脚本",
      visuals: "人设与风格",
      plan: "分镜与制作计划",
      render: "生成",
      assembly: "拼接",
    } satisfies Record<CompanyProductionStage, string>;
    throw new Error(`请先确认${label[expected]}阶段`);
  }

  const completed = [...new Set([...state.confirmedStages, confirmedStage])];
  const nextIndex = stageIndex(confirmedStage) + 1;
  const candidate = COMPANY_PRODUCTION_STAGES[nextIndex];
  const stage: CompanyProductionActiveStage = !candidate
    ? "complete"
    : candidate === "assembly" && !state.assemble
      ? "complete"
      : candidate;
  return { ...state, stage, confirmedStages: completed, updatedAt: new Date().toISOString() };
}
