const PLUGIN_ID = "fg-local-prompt-studio";

function readCanvasScale(layer) {
  const transform = window.getComputedStyle(layer).transform;
  if (!transform || transform === "none") return 1;
  const values = transform.match(/^matrix\(([^)]+)\)$/)?.[1]?.split(",").map(Number);
  if (!values || values.length < 2) return 1;
  const scale = Math.hypot(values[0], values[1]);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function enableNativePromptWorkspaceScaling() {
  let frame = 0;
  let observedViewport = null;
  const viewportObserver = new MutationObserver(scheduleSync);

  function sync() {
    frame = 0;
    const viewportLayer = document.querySelector("[data-canvas-viewport-layer]");
    if (viewportLayer !== observedViewport) {
      viewportObserver.disconnect();
      observedViewport = viewportLayer;
      if (viewportLayer) viewportObserver.observe(viewportLayer, { attributes: true, attributeFilter: ["style"] });
    }
    const scale = viewportLayer ? Math.min(Math.max(readCanvasScale(viewportLayer), 0.65), 1.35) : 1;
    document.querySelectorAll("[data-canvas-prompt-workspace]").forEach((workspace) => {
      workspace.style.setProperty("--fg-prompt-studio-workspace-scale", String(scale));
    });
  }

  function scheduleSync() {
    if (!frame) frame = requestAnimationFrame(sync);
  }

  const documentObserver = new MutationObserver(scheduleSync);
  documentObserver.observe(document.body, { childList: true, subtree: true });
  sync();

  return () => {
    documentObserver.disconnect();
    viewportObserver.disconnect();
    if (frame) cancelAnimationFrame(frame);
    document.querySelectorAll("[data-canvas-prompt-workspace]").forEach((workspace) => {
      workspace.style.removeProperty("--fg-prompt-studio-workspace-scale");
    });
  };
}

export default function createPromptStudioPlugin(runtime) {
  const React = runtime.React;
  const h = runtime.jsx;

  function valueFor(ctx) {
    return String(ctx.node.metadata?.content || ctx.node.metadata?.prompt || "");
  }

  function updatePrompt(ctx, value) {
    ctx.updateMetadata({ content: value, prompt: value, status: "success" });
  }

  function PromptEditor({ ctx, panel = false }) {
    const value = valueFor(ctx);
    const [expanded, setExpanded] = React.useState(false);
    const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
    const textareaClass = panel ? "fg-prompt-studio__panel-textarea" : "fg-prompt-studio__textarea";
    return h(
      "section",
      {
        className: panel ? "fg-prompt-studio fg-prompt-studio--panel" : "fg-prompt-studio",
        "data-canvas-no-zoom": panel ? "true" : undefined,
        onMouseDown: (event) => event.stopPropagation(),
        onPointerDown: (event) => event.stopPropagation(),
      },
      h("header", { className: "fg-prompt-studio__header" },
        h("div", null,
          h("div", { className: "fg-prompt-studio__eyebrow" }, "LOCAL NODE · PROMPT DESK"),
          h("strong", null, panel ? "提示词工作台" : "可缩放提示词工作台"),
        ),
        h("div", { className: "fg-prompt-studio__meta" }, `${wordCount} 词`),
      ),
      h("textarea", {
        className: textareaClass,
        value,
        placeholder: "写下画面、镜头、角色、限制条件或你希望 Agent 延续的创作方向…",
        onChange: (event) => updatePrompt(ctx, event.target.value),
        onWheel: (event) => event.stopPropagation(),
        onKeyDown: (event) => event.stopPropagation(),
        spellCheck: false,
        "aria-label": "提示词内容",
      }),
      panel ? h("footer", { className: "fg-prompt-studio__footer" },
        h("span", null, "拖动节点边缘可继续放大；工作台会随画布缩放。"),
        h("button", {
          type: "button",
          className: "fg-prompt-studio__size-button",
          onClick: () => {
            const next = expanded ? { width: 820, height: 360 } : { width: 1100, height: 560 };
            ctx.updateNode(next);
            setExpanded(!expanded);
          },
        }, expanded ? "恢复默认" : "放大节点"),
      ) : null,
    );
  }

  return {
    id: PLUGIN_ID,
    name: "可缩放提示词工作台",
    version: "1.1.0",
    description: "一个可调整大小的本地提示词节点；启用后，原生生图/视频节点下方的提示词工作台也会随画布缩放。",
    css: `
      [data-canvas-prompt-workspace]{transform:scale(var(--fg-prompt-studio-workspace-scale,1))!important;transform-origin:top center!important}
      .fg-prompt-studio{display:flex;box-sizing:border-box;width:100%;height:100%;min-width:0;min-height:0;flex-direction:column;gap:14px;padding:20px;border-radius:20px;background:linear-gradient(145deg,rgba(12,27,31,.96),rgba(12,19,28,.98));color:#e7f9f5;font-family:ui-sans-serif,system-ui,sans-serif;box-shadow:inset 0 0 0 1px rgba(94,234,212,.14)}
      .fg-prompt-studio--panel{width:min(920px,calc(100vw - 56px));height:auto;min-height:440px;border:1px solid rgba(94,234,212,.28);box-shadow:0 26px 80px rgba(0,0,0,.34)}
      .fg-prompt-studio__header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
      .fg-prompt-studio__header strong{display:block;margin-top:3px;font-size:18px;line-height:1.2;letter-spacing:-.02em}
      .fg-prompt-studio__eyebrow{color:#63e6d8;font-size:10px;font-weight:800;letter-spacing:.16em}
      .fg-prompt-studio__meta{flex:none;border:1px solid rgba(148,233,220,.17);border-radius:999px;padding:4px 8px;color:#a7c9c5;font-size:11px;line-height:1}
      .fg-prompt-studio__textarea,.fg-prompt-studio__panel-textarea{box-sizing:border-box;width:100%;flex:1;min-height:0;resize:none;border:1px solid rgba(148,233,220,.17);border-radius:14px;padding:16px;background:rgba(1,12,16,.52);color:#f2fffc;font:500 17px/1.72 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none;transition:border-color .18s ease,box-shadow .18s ease}
      .fg-prompt-studio__panel-textarea{min-height:270px;font-size:19px}
      .fg-prompt-studio__textarea::placeholder,.fg-prompt-studio__panel-textarea::placeholder{color:#81a09d}
      .fg-prompt-studio__textarea:focus,.fg-prompt-studio__panel-textarea:focus{border-color:rgba(94,234,212,.72);box-shadow:0 0 0 3px rgba(45,212,191,.12)}
      .fg-prompt-studio__footer{display:flex;align-items:center;justify-content:space-between;gap:16px;color:#9ab6b3;font-size:12px}
      .fg-prompt-studio__size-button{border:1px solid rgba(94,234,212,.35);border-radius:10px;padding:7px 11px;background:rgba(45,212,191,.12);color:#c4fff5;font-weight:700;cursor:pointer}
      .fg-prompt-studio__size-button:hover{background:rgba(45,212,191,.22)}
    `,
    setup() {
      console.info("[plugin prompt-studio] native prompt workspace scaling enabled");
      return enableNativePromptWorkspaceScaling();
    },
    nodes: [
      {
        type: `${PLUGIN_ID}:prompt-desk`,
        title: "可缩放提示词工作台",
        icon: "✦",
        description: "大尺寸提示词编辑节点，可作为下游生成参考",
        defaultSize: { width: 820, height: 360 },
        defaultMetadata: { content: "", prompt: "", status: "success" },
        minimapColor: "#5eead4",
        hasSourceHandle: true,
        interactionToggle: true,
        forceInteractive: () => true,
        autoOpenPanel: true,
        resource: (node) => {
          const text = String(node.metadata?.content || node.metadata?.prompt || "").trim();
          return text ? { kind: "text", text } : null;
        },
        Content: ({ ctx }) => h(PromptEditor, { ctx }),
        Panel: ({ ctx }) => h(PromptEditor, { ctx, panel: true }),
      },
    ],
  };
}
