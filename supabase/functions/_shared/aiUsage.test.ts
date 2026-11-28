import { describe, expect, it } from "vitest";
import { usageRow } from "./aiUsage.ts";

describe("usageRow", () => {
  it("copies OpenRouter's token counts and cost", () => {
    const row = usageRow({ usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00042 } }, "extract", "openai/gpt-4o-mini");
    expect(row).toEqual({ purpose: "extract", model: "openai/gpt-4o-mini", prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost_usd: 0.00042 });
  });

  it("works out the total when OpenRouter leaves it out", () => {
    expect(usageRow({ usage: { prompt_tokens: 10, completion_tokens: 5 } }, "discover", "m")).toMatchObject({ total_tokens: 15, cost_usd: null });
  });

  it("records zeros, not errors, when the reply has no usage note", () => {
    expect(usageRow({ choices: [] }, "extract", "m")).toEqual({ purpose: "extract", model: "m", prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: null });
    expect(usageRow(null, "extract", "m").total_tokens).toBe(0);
  });

  it("ignores negative or non-numeric figures", () => {
    expect(usageRow({ usage: { prompt_tokens: -4, completion_tokens: "9", cost: -1 } }, "extract", "m")).toMatchObject({ prompt_tokens: 0, completion_tokens: 0, cost_usd: null });
  });

  it("keeps the stored purpose and model within their column sizes", () => {
    const row = usageRow({}, "x".repeat(60), "y".repeat(120));
    expect(row.purpose.length).toBe(40);
    expect(row.model.length).toBe(80);
  });
});
