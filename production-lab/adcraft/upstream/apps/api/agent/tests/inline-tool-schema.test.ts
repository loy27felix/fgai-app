import { describe, expect, it } from "vitest";
import { Ajv } from "ajv";
import { inlineToolSchema } from "../src/inline-tool-schema.js";

describe("provider tool schema", () => {
  it("preserves validation, sibling constraints and nullable branches while removing local references", () => {
    const schema = { type: "object", required: ["count"], additionalProperties: false,
      properties: { count: { $ref: "#/$defs/Count", minimum: 1 },
        label: { anyOf: [{ $ref: "#/$defs/Label" }, { type: "null" }] } },
      $defs: { Count: { type: "integer", maximum: 3 }, Label: { type: "string", minLength: 2 } } };
    const original = JSON.stringify(schema);
    const inline = inlineToolSchema(schema);
    expect(JSON.stringify(inline)).not.toContain("$defs");
    expect(JSON.stringify(inline)).not.toContain("$ref");
    expect(JSON.stringify(schema)).toBe(original);
    const ajv = new Ajv({ strict: false });
    const before = ajv.compile(schema), after = ajv.compile(inline);
    for (const value of [{ count: 1 }, { count: 3, label: null }, { count: 2, label: "cup" },
      { count: 0 }, { count: 4 }, { count: 1, label: "x" }, { count: "1" }, { count: 1, extra: true }]) {
      expect(after(value)).toBe(before(value));
    }
  });
  it("rejects cyclic or missing references instead of weakening the contract", () => {
    expect(() => inlineToolSchema({ $ref: "#/$defs/A", $defs: { A: { $ref: "#/$defs/A" } } })).toThrow();
    expect(() => inlineToolSchema({ $ref: "#/$defs/missing" })).toThrow();
  });
});
