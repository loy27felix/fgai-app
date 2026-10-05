export function fgCompanyLinks(origin: string) {
  const source = new URL(origin);
  const lan = source.hostname === "192.168.0.99" && source.port === "3017";
  const workspace = new URL("/production-lab", origin);
  const audio = new URL(lan ? "/fg-audio-tools" : "/fg-six/fg-audio-tools", origin);
  if (lan) {
    workspace.port = "3000";
    audio.port = "3016";
  }
  return { workspace: workspace.href, audio: audio.href };
}
