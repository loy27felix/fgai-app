import { describe, expect, it } from "vitest";
import { fgCompanyLinks } from "./fg-links";

describe("FG company links", () => {
  it("keeps the external HTTPS host and forwarded port", () => {
    expect(fgCompanyLinks("https://218.61.196.139:8300")).toEqual({
      workspace: "https://218.61.196.139:8300/production-lab",
      audio: "https://218.61.196.139:8300/fg-six/fg-audio-tools",
    });
  });
  it("retains direct LAN access", () => {
    expect(fgCompanyLinks("https://192.168.0.99:3017")).toEqual({
      workspace: "https://192.168.0.99:3000/production-lab",
      audio: "https://192.168.0.99:3016/fg-audio-tools",
    });
  });
});
