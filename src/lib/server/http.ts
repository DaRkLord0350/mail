import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

type Ctx<P> = { params: Promise<P> };

/** Wrap a route handler with uniform error handling. */
export function handler<P = Record<string, string>>(fn: (req: Request, ctx: Ctx<P>) => Promise<Response>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  if (e instanceof ZodError) {
    const flat = z.flattenError(e);
    const first = e.issues[0];
    const msg = first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input";
    return NextResponse.json({ error: msg, details: flat }, { status: 400 });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2025") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (e.code === "P2002") return NextResponse.json({ error: "Already exists (unique constraint)" }, { status: 409 });
    if (e.code === "P2003") return NextResponse.json({ error: "Record is referenced by other records" }, { status: 409 });
  }
  if (e instanceof Prisma.PrismaClientInitializationError) {
    console.error("[mail] database unavailable", e.message);
    return NextResponse.json({ error: "Database is unavailable. Check DATABASE_URL and that the database is running." }, { status: 503 });
  }
  console.error("[mail] unhandled API error", e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

const MAX_JSON_BYTES = 1024 * 1024;

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_JSON_BYTES) throw new HttpError(413, "Request body too large");
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BYTES) throw new HttpError(413, "Request body too large");
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function searchParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

export function pagination(sp: URLSearchParams, defaultSize = 25) {
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(sp.get("pageSize") ?? String(defaultSize), 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
