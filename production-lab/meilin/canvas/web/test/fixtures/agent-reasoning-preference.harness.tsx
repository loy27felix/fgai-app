import { expect, test, afterAll } from "bun:test";
import { Window } from "happy-dom";
const dom = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useAgentReasoningPreference } = await import("../../src/components/canvas/use-agent-reasoning-preference");
const { LEGACY_TEXT_THINKING_CONFIG } = await import("../../src/lib/text-thinking");
const host = document.createElement("div"); document.body.append(host);
const root = createRoot(host);
let selected: ReturnType<typeof useAgentReasoningPreference>;
function Probe({ user = "user-a", model = "model-a" }: { user?: string; model?: string }) {
    selected = useAgentReasoningPreference(user, model, LEGACY_TEXT_THINKING_CONFIG);
    return <span>{selected[0]}</span>;
}
test("restores preferences by account and model and tolerates unavailable storage", async () => {
    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe("auto");
    await act(async () => selected[1]("medium"));
    expect(host.textContent).toBe("medium");
    await act(async () => root.render(<Probe user="user-b" />));
    expect(host.textContent).toBe("auto");
    await act(async () => root.render(<Probe model="model-b" />));
    expect(host.textContent).toBe("auto");
    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe("medium");
    await act(async () => selected[1]("max"));
    expect(host.textContent).toBe("medium");
    await act(async () => selected[1]("auto"));
    expect(host.textContent).toBe("auto");
    await act(async () => root.unmount());
    expect(dom.localStorage.length).toBe(0);
});
afterAll(() => dom.happyDOM.abort());
