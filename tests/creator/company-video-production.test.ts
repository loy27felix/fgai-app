import assert from "node:assert/strict";
import test from "node:test";

import { estimateCompanyVideoProduction } from "../../lib/creator/company-video-production";

test("company video production quotes every storyboard and video segment before confirmation", () => {
  const quote = estimateCompanyVideoProduction({
    videoModel: "dreamina-seedance-2-0-mini",
    videoResolution: "720p",
    secondsPerSegment: 5,
    segmentCount: 3,
    storyboardModel: "gpt-image-2",
    storyboardResolution: "1024x1024",
  });

  assert.equal(quote.storyboardCount, 3);
  assert.equal(quote.segmentCount, 3);
  assert.equal(quote.videoCostUsd, 7.455);
  assert.equal(quote.storyboardCostUsd, 0.06);
  assert.equal(quote.totalCostUsd, 7.515);
  assert.equal(quote.hasUnpricedItems, false);
});

test("company video production keeps a quote honest when a custom model has no published price", () => {
  const quote = estimateCompanyVideoProduction({
    videoModel: "studio::custom-video-model",
    videoResolution: "720p",
    secondsPerSegment: 5,
    segmentCount: 2,
    storyboardModel: "gpt-image-2",
    storyboardResolution: "1024x1024",
  });

  assert.equal(quote.videoCostUsd, null);
  assert.equal(quote.totalCostUsd, null);
  assert.equal(quote.hasUnpricedItems, true);
});
