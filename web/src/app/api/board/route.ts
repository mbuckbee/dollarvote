import { connection, type NextRequest } from "next/server";
import { getBoard, getCategories } from "@/lib/data";
import { parsePicks } from "@/lib/picks";

export async function GET(request: NextRequest) {
  await connection();
  const categories = await getCategories();
  const picks = parsePicks(
    request.nextUrl.searchParams.get("i") ?? "",
    new Set(categories.map((c) => c.slug)),
    new Set(categories.filter((c) => c.is_axis).map((c) => c.slug)),
  );
  const rows = await getBoard(picks, categories);
  return Response.json({ picks, rows });
}
