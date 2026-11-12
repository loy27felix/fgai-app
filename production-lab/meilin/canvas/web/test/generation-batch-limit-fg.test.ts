import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { batchQuoteTotal, clampGenerationCount, generationBatchLimit } from "../src/lib/generation-batch-limit";
import { ImageParameterFields } from "../src/components/image-parameter-fields";
import { projectImageParameters } from "../src/lib/image-parameters";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import type { AiConfig } from "../src/stores/use-config-store";

test("account limit constrains independent tasks and malformed counts", () => {
    expect(clampGenerationCount("9",5)).toBe(5);
    expect(clampGenerationCount("NaN",5)).toBe(1);
    expect(generationBatchLimit(999)).toBe(15);
    expect(generationBatchLimit(Number.POSITIVE_INFINITY)).toBe(1);
});
test("quote multiplication preserves RMB units without converting currency", () => {
    expect(batchQuoteTotal(2.4,3)).toBeCloseTo(7.2);
    expect(batchQuoteTotal(0,4)).toBe(0);
});
test("one-output model still offers independent batch tasks", () => {
    const profile=projectImageParameters(defaultImageCapabilityConfig(),[{name:"count",label:"生成张数",type:"integer",min:1,max:1,default:1,binding:"imageCount",enabled:true,description:"one per provider request"}]);
    const html=renderToStaticMarkup(createElement(ImageParameterFields,{profile,config:{count:"3"} as AiConfig,onChange:()=>{},countLimit:5}));
    expect(html).toContain("生成张数"); expect(html).toContain(">3<");
    expect(html).not.toContain("one per provider request");
});
