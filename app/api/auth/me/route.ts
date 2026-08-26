import { NextResponse } from "next/server";
import { getSessionUser, unauthorized } from "@/lib/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return NextResponse.json({ user });
}
