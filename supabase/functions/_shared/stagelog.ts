/**
 * One structured log line per stage of an AI Save request, so we can see where
 * time goes and where a share stops: stage, milliseconds, an outcome code and a
 * count. It never carries caption text, names, addresses, links or user ids:
 * every string must be a short code (letters, digits, _ and -), anything else
 * (spaces, dots, slashes, @, links) is written as "redacted". Only the `model`
 * field may also hold a model id such as openai/gpt-4o-mini:online. Callers
 * pass codes and counts, never text from a caption. Logging can never break a request.
 */
const SAFE_CODE = /^[a-z0-9_-]{1,48}$/i;
const MODEL_CODE = /^[a-z0-9-]{1,24}\/[a-z0-9.-]{1,32}(:[a-z]{1,16})?$/i;

export type StageFields = Record<string, string | number | boolean | null | undefined>;

function code(value: string, pattern: RegExp = SAFE_CODE): string {
  return pattern.test(value) ? value : "redacted";
}

export function stageLog(fn: string, stage: string, startedAt: number, outcome: string, fields: StageFields = {}): void {
  try {
    const line: Record<string, string | number | boolean> = {
      log: "stage", fn: code(fn), stage: code(stage), ms: Math.max(0, Math.round(Date.now() - startedAt)), outcome: code(outcome),
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || !SAFE_CODE.test(key) || key in line) continue;
      line[key] = typeof value === "string" ? code(value, key === "model" ? MODEL_CODE : SAFE_CODE)
        : typeof value === "number" ? (Number.isFinite(value) ? Math.round(value) : 0)
        : value;
    }
    console.log(JSON.stringify(line));
  } catch {
    // Logging must never fail a request.
  }
}
