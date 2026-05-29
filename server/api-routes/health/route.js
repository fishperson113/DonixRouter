import { NextResponse } from "#adapter/nextShim.js";

export async function GET() {
  return NextResponse.json({ ok: true });
}
