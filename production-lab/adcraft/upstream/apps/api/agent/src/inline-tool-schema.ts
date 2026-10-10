/** Inline local schema references for providers that reject top-level $defs.
 * Business validation still uses the original Python contract.
 */
export function inlineToolSchema(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  function walk(value: unknown, active: ReadonlySet<string>): unknown {
    if (Array.isArray(value)) return value.map(item => walk(item, active));
    if (value === null || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    const siblings = Object.fromEntries(Object.entries(object)
      .filter(([key]) => key !== "$defs" && key !== "$ref")
      .map(([key, item]) => [key, walk(item, active)]));
    if (typeof object.$ref !== "string") return siblings;
    const ref = object.$ref;
    if (!ref.startsWith("#/") || active.has(ref)) throw new Error("agent_tool_schema_reference_unsupported");
    let target: unknown = schema;
    for (const part of ref.slice(2).split("/")) {
      if (target === null || typeof target !== "object") throw new Error("agent_tool_schema_reference_missing");
      target = (target as Record<string, unknown>)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    if (target === undefined) throw new Error("agent_tool_schema_reference_missing");
    const expanded = walk(target, new Set([...active, ref]));
    return Object.keys(siblings).length ? { allOf: [expanded, siblings] } : expanded;
  }
  return walk(schema, new Set()) as Readonly<Record<string, unknown>>;
}
