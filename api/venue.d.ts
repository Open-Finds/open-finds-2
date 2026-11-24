type Req = { query: Record<string, string | undefined> };
type Res = { status(code: number): Res; setHeader(name: string, value: string): void; send(body: unknown): Res };
export default function handler(req: Req, res: Res): Promise<Res | void>;
