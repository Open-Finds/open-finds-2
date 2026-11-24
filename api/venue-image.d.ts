export function card(venue: { name: string; address: string; type?: string; unverified?: boolean }): unknown;
export function renderCard(venue: { name: string; address: string; type?: string; unverified?: boolean }): Promise<Uint8Array>;
type Req = { query: Record<string, string | undefined> };
type Res = { status(code: number): Res; setHeader(name: string, value: string): void; send(body: unknown): Res };
export default function handler(req: Req, res: Res): Promise<Res | void>;
