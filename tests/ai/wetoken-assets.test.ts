import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { prepareWetokenAssetReferences } from "../../lib/ai/wetoken-assets";

const previousKey = process.env.WETOKEN_API_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.WETOKEN_API_KEY;
  else process.env.WETOKEN_API_KEY = previousKey;
});

test("Wetoken asset failures preserve a nested provider reason without exposing credentials", async () => {
  process.env.WETOKEN_API_KEY = "test-key";
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/CreateAsset")) {
      return new Response(JSON.stringify({ data: { id: "asset-failed-image" } }), { status: 200 });
    }
    if (url.endsWith("/GetAsset")) {
      return new Response(JSON.stringify({
        data: {
          Status: "Failed",
          Error: { message: "图片元数据不受支持：Bearer should-not-leak", code: "invalid_image_metadata" },
        },
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };

  await assert.rejects(
    () => prepareWetokenAssetReferences("doubao-seedance-2-0", [{ type: "image", url: "https://assets.example/ref.png", role: "reference_image" }], { fetcher }),
    (error: unknown) => {
      assert.match(String(error), /图片元数据不受支持/);
      assert.doesNotMatch(String(error), /should-not-leak/);
      assert.equal((error as { providerCode?: unknown }).providerCode, "invalid_image_metadata");
      return true;
    },
  );
  assert.ok(calls.some((url) => url.endsWith("/GetAsset")));
});

test("Wetoken asset failures also read the lower-case data.error payload shape", async () => {
  process.env.WETOKEN_API_KEY = "test-key";
  let requestedStatus = false;
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/CreateAsset")) return new Response(JSON.stringify({ id: "asset-lowercase-error" }), { status: 200 });
    if (url.endsWith("/GetAsset")) {
      requestedStatus = true;
      return new Response(JSON.stringify({ data: { status: "Failed", error: { message: "图片内容不符合素材要求", code: 3412 } } }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };

  await assert.rejects(
    () => prepareWetokenAssetReferences("doubao-seedance-2-0", [{ type: "image", url: "https://assets.example/lowercase.png", role: "reference_image" }], { fetcher }),
    (error: unknown) => {
      assert.match(String(error), /图片内容不符合素材要求/);
      assert.equal((error as { providerCode?: unknown }).providerCode, "3412");
      return true;
    },
  );
  assert.equal(requestedStatus, true);
});
