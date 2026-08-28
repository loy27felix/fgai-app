const PLUGIN_ID = "fg-generation-confirmation";

function labelForMode(mode) {
  return { image: "生成图片", video: "生成视频", text: "生成文本", audio: "生成音频" }[mode] || "开始生成";
}

function openConfirmation(request) {
  request.intercepted = true;
  const root = document.createElement("div");
  root.className = "fg-generation-confirmation";
  root.innerHTML = `
    <div class="fg-generation-confirmation__backdrop"></div>
    <section class="fg-generation-confirmation__dialog" role="dialog" aria-modal="true" aria-labelledby="fg-generation-confirmation-title">
      <div class="fg-generation-confirmation__signal">✦</div>
      <div class="fg-generation-confirmation__eyebrow">GENERATION CHECKPOINT</div>
      <h2 id="fg-generation-confirmation-title">确认开始生成？</h2>
      <p class="fg-generation-confirmation__summary">${labelForMode(request.mode)} · ${escapeHtml(request.model || "默认模型")}</p>
      <div class="fg-generation-confirmation__prompt">${escapeHtml(request.prompt || "未填写提示词")}</div>
      <div class="fg-generation-confirmation__actions">
        <button type="button" data-action="cancel">返回修改</button>
        <button type="button" data-action="confirm">确认并开始</button>
      </div>
    </section>`;
  document.body.append(root);

  const close = (approved) => {
    root.remove();
    console.info("[plugin generation-confirmation]", { nodeId: request.nodeId, mode: request.mode, approved });
    request.resolve(approved);
  };
  root.querySelector("[data-action='cancel']").addEventListener("click", () => close(false));
  root.querySelector("[data-action='confirm']").addEventListener("click", () => close(true));
  root.querySelector(".fg-generation-confirmation__backdrop").addEventListener("click", () => close(false));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close(false);
  });
  root.querySelector("[data-action='confirm']").focus();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

export default {
  id: PLUGIN_ID,
  name: "生成前确认",
  version: "1.0.0",
  description: "在调用模型前展示提示词与模型确认窗口，可随时关闭恢复一键生成。",
  nodes: [],
  css: `
    .fg-generation-confirmation{position:fixed;z-index:10000;inset:0;display:grid;place-items:center;padding:20px;font-family:ui-sans-serif,system-ui,sans-serif;color:#f5f7fb}
    .fg-generation-confirmation__backdrop{position:absolute;inset:0;background:rgba(3,7,14,.72);backdrop-filter:blur(12px)}
    .fg-generation-confirmation__dialog{position:relative;width:min(430px,100%);overflow:hidden;border:1px solid rgba(103,232,249,.28);border-radius:22px;padding:25px;background:linear-gradient(145deg,rgba(16,28,43,.98),rgba(8,13,23,.98));box-shadow:0 30px 100px rgba(0,0,0,.5)}
    .fg-generation-confirmation__dialog:before{content:"";position:absolute;inset:0 0 auto;height:2px;background:linear-gradient(90deg,#2dd4bf,#60a5fa,#a78bfa)}
    .fg-generation-confirmation__signal{display:grid;place-items:center;width:34px;height:34px;border-radius:12px;background:rgba(45,212,191,.12);color:#5eead4;font-size:18px}
    .fg-generation-confirmation__eyebrow{margin-top:16px;color:#5eead4;font-size:10px;font-weight:800;letter-spacing:.16em}
    .fg-generation-confirmation h2{margin:7px 0 5px;font-size:21px;letter-spacing:-.03em}
    .fg-generation-confirmation__summary{margin:0;color:#aab7c8;font-size:12px}
    .fg-generation-confirmation__prompt{max-height:124px;margin-top:17px;overflow:auto;border:1px solid rgba(148,163,184,.18);border-radius:13px;padding:11px 12px;background:rgba(2,6,12,.42);color:#d9e2ef;font-size:13px;line-height:1.65;white-space:pre-wrap}
    .fg-generation-confirmation__actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}
    .fg-generation-confirmation__actions button{height:36px;border:1px solid rgba(148,163,184,.25);border-radius:10px;padding:0 13px;background:rgba(148,163,184,.08);color:#dbeafe;font-size:12px;font-weight:650;cursor:pointer}
    .fg-generation-confirmation__actions button[data-action="confirm"]{border-color:transparent;background:linear-gradient(135deg,#2dd4bf,#38bdf8);color:#06202a;box-shadow:0 8px 22px rgba(45,212,191,.22)}
    .fg-generation-confirmation__actions button:hover{filter:brightness(1.12)}
  `,
  setup(app) {
    console.info("[plugin generation-confirmation] enabled");
    const stop = app.on("canvas:generation-confirmation", (payload) => {
      if (!payload || typeof payload !== "object" || typeof payload.resolve !== "function") return;
      openConfirmation(payload);
    });
    return () => {
      stop();
      console.info("[plugin generation-confirmation] disabled");
    };
  },
};
