import { SaveIcon } from "../../../icons.tsx";
import type { ProviderModelSummaryV1 } from "../../../api/providerRegistry.ts";
import type { CanvasNodeV2, CanvasRuntimeModelResolutionV2 } from "../../../types-v2.ts";
import { CanvasModelPicker } from "./CanvasModelPicker.tsx";
import { FourLinePromptEditor } from "./FourLinePromptEditor.tsx";
import { NodeWorkbenchError } from "./NodeWorkbenchError.tsx";
import type { NodeWorkbenchDraft } from "./useNodeWorkbenchDraft.ts";
import {
  canRetryNodeExecution,
  failureUserAction,
  nodeActionableFailure,
} from "../chat/actionableFailure.ts";
import type { RefObject } from "react";

export function TextWorkbench({
  node,
  draft,
  models,
  defaultModelRef,
  modelsLoading,
  modelsError,
  modelResolution,
  promptEditorRef,
}: {
  node: CanvasNodeV2;
  draft: NodeWorkbenchDraft;
  models: ProviderModelSummaryV1[];
  defaultModelRef: string | null;
  modelsLoading: boolean;
  modelsError: string | null;
  modelResolution: CanvasRuntimeModelResolutionV2 | null;
  promptEditorRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const isWorldSetting = node.creative_role === "world_setting";
  const canRun = !isWorldSetting && (node.status === "draft" || node.status === "failed");
  const retryingExecution = node.status === "failed" && canRetryNodeExecution(node);
  const regenerating = node.status === "failed"
    && failureUserAction(nodeActionableFailure(node)) === "regenerate";

  return (
    <div className="agent-node-workbench__body">
      <label className="agent-node-workbench__composer">
        <FourLinePromptEditor
          ariaLabel={isWorldSetting ? "World Setting content" : canRun ? "Text prompt" : "Text content"}
          value={isWorldSetting || !canRun ? draft.textContent : draft.prompt}
          disabled={draft.pending}
          placeholder={isWorldSetting
            ? "描述世界观、规则、地点、时代与视觉风格。"
            : canRun ? "描述你想创作的文本。" : "为下一个节点填写需求、方向或说明。"}
          onChange={(event) => {
            if (isWorldSetting || !canRun) draft.setTextContent(event.currentTarget.value);
            else draft.setPrompt(event.currentTarget.value);
          }}
          onBlur={() => void draft.flushPrompt()}
          editorRef={promptEditorRef}
        />
      </label>
      {draft.error || draft.promptSaveStatus === "conflict" ? (
        <div className="agent-node-workbench__text-feedback">
          <NodeWorkbenchError draft={draft} />
        </div>
      ) : null}
      <footer className="agent-node-workbench__footer agent-node-workbench__footer--composer agent-node-workbench__footer--text">
        <div className="agent-node-workbench__composer-actions">
          {!isWorldSetting ? (
            <div className="agent-node-workbench__options agent-node-workbench__options--inline" aria-label="Text generation options">
              <CanvasModelPicker
                appearance="monochrome"
                showOptionDetails={false}
                showStatusDetails={false}
                defaultModelRef={defaultModelRef}
                models={models}
                loading={modelsLoading}
                error={modelsError}
                selectionMode={draft.modelSelectionMode}
                modelRef={draft.modelRef}
                modelSummary={node.model_summary}
                modelResolution={modelResolution}
                disabled={draft.pending}
                onChange={draft.setModelSelection}
              />
            </div>
          ) : null}
          <button
            type="button"
            className="agent-node-workbench__run"
            aria-label={isWorldSetting
              ? "Save World Setting changes"
              : !canRun ? "Save text changes" : retryingExecution ? "Retry text node" : regenerating ? "Regenerate text node" : "Run text node"}
            title={!canRun
              ? "保存修改"
              : retryingExecution ? "重试文本" : regenerating ? "重新生成文本" : "生成文本"}
            disabled={draft.pending || (canRun && !draft.prompt.trim())}
            onClick={() => void (isWorldSetting || !canRun ? draft.save() : draft.run())}
          >
            <SaveIcon />
          </button>
        </div>
      </footer>
    </div>
  );
}
