import test from "node:test";
import assert from "node:assert/strict";
import { hasSameOriginLabRequest } from "../lib/production-lab/origin";

test("accepts the browser origin forwarded through the TLS reverse proxy", () => {
  const request = new Request("http://app:3000/api/production-lab/admin", {
    headers: {
      origin: "https://192.168.0.99:3000",
      host: "192.168.0.99:3000",
      "x-forwarded-host": "192.168.0.99:3000",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(hasSameOriginLabRequest(request), true);
});

test("rejects cross-origin, missing-origin, and malformed proxy origin requests", () => {
  const crossOrigin = new Request("http://app:3000/api/production-lab/admin", {
    headers: { origin: "https://attacker.example", host: "192.168.0.99:3000", "x-forwarded-host": "192.168.0.99:3000", "x-forwarded-proto": "https" },
  });
  const missingOrigin = new Request("https://192.168.0.99:3000/api/production-lab/admin");
  const malformedProxy = new Request("http://app:3000/api/production-lab/admin", {
    headers: { origin: "https://192.168.0.99:3000", "x-forwarded-host": "192.168.0.99:3000", "x-forwarded-proto": "javascript" },
  });
  assert.equal(hasSameOriginLabRequest(crossOrigin), false);
  assert.equal(hasSameOriginLabRequest(missingOrigin), false);
  assert.equal(hasSameOriginLabRequest(malformedProxy), false);
});

test("uses the request host and scheme when no reverse-proxy headers exist", () => {
  const request = new Request("https://studio.example/api/production-lab/admin", {
    headers: { origin: "https://studio.example", host: "studio.example" },
  });
  assert.equal(hasSameOriginLabRequest(request), true);
});
