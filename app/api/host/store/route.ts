import { NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";

// GET /api/host/store — public catalog: active categories + active products.
// Optional ?category=<slug> filter, ?featured=1 for featured-only.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const categorySlug = url.searchParams.get("category");
  const featuredOnly = url.searchParams.get("featured") === "1";

  try {
    const catRes = await fetch(
      `${SB_URL}/rest/v1/store_categories?active=eq.true&select=id,name,slug,icon,kind,sort_order&order=sort_order.asc`,
      { headers: SB_READ, cache: "no-store" },
    );
    const categories = catRes.ok ? await catRes.json() : [];

    let activeCatId: string | null = null;
    if (categorySlug) {
      activeCatId = (categories.find((c: any) => c.slug === categorySlug) || {}).id || null;
    }

    let q = `${SB_URL}/rest/v1/store_products?active=eq.true&in_stock=eq.true`
      + `&select=id,category_id,name,brand,description,specs,images,buy_price,rent_monthly,emi_available,emi_min_months,rating,reviews_count,featured,badges`
      + `&order=featured.desc,rating.desc`;
    if (activeCatId) q += `&category_id=eq.${activeCatId}`;
    if (featuredOnly) q += `&featured=eq.true`;

    const prodRes = await fetch(q, { headers: SB_READ, cache: "no-store" });
    const products = prodRes.ok ? await prodRes.json() : [];

    return NextResponse.json({ categories, products });
  } catch (e: any) {
    return NextResponse.json(
      { categories: [], products: [], error: String(e?.message || e).slice(0, 200) },
      { status: 502 },
    );
  }
}
