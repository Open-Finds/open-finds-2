/**
 * Turns the usage note on an OpenRouter reply into one row for ai_usage.
 * Pure: no network or database access, so it can be tested on its own.
 */
export type AiUsageRow = {
  purpose: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
};

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;

export function usageRow(reply: unknown, purpose: string, model: string): AiUsageRow {
  const usage = (reply && typeof reply === "object" ? (reply as Record<string, unknown>).usage : undefined) as
    | Record<string, unknown>
    | undefined;
  const prompt = count(usage?.prompt_tokens);
  const completion = count(usage?.completion_tokens);
  const total = count(usage?.total_tokens) || prompt + completion;
  const cost = typeof usage?.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null;
  return {
    purpose: purpose.slice(0, 40),
    model: model.slice(0, 80),
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    cost_usd: cost,
  };
}
