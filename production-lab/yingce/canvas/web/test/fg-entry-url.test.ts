import {test, expect} from "bun:test";
import {fgWorkspaceBasePath, fgPlatformURL, fgDirectorURL, fgResourceAccessURL} from "../src/lib/fg-entry-url";

test("public workspace paths keep the existing external origin and port", () => {
    expect(fgWorkspaceBasePath("/fg-six/canvas/123")).toBe("/fg-six");
    expect(fgWorkspaceBasePath("/fg-sixevil/canvas")).toBe("");
    expect(fgPlatformURL("https://218.61.196.139:8300")).toBe("https://218.61.196.139:8300/workspace");
    expect(fgDirectorURL("https://218.61.196.139:8300", "/fg-six/arcreel")).toBe("https://218.61.196.139:8300/fg-director/");
});
test("existing direct LAN entries retain their platform and director destinations", () => {
    expect(fgWorkspaceBasePath("/canvas/123")).toBe("");
    expect(fgPlatformURL("https://192.168.0.99:3016")).toBe("https://192.168.0.99:3000/workspace");
    expect(fgDirectorURL("https://192.168.0.99:3016", "/arcreel")).toBe("https://192.168.0.99:3017/");
});
test("public resource delivery keeps signed queries and absolute CDN URLs intact", () => {
    expect(fgResourceAccessURL("/api/resources/123/file?signature=abc&expires=42", "/fg-six/api")).toBe("/fg-six/api/resources/123/file?signature=abc&expires=42");
    expect(fgResourceAccessURL("https://media.example/file?signature=abc", "/fg-six/api")).toBe("https://media.example/file?signature=abc");
    expect(fgResourceAccessURL("/api/resources/123/file", "/api")).toBe("/api/resources/123/file");
    expect(fgResourceAccessURL("/api/resources/123/file", "https://api.example/api")).toBe("https://api.example/api/resources/123/file");
});
