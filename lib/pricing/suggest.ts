// Hotel-owner price suggestion engine.
// Builds a ready-to-apply suggestion for room price + floor + flash-floor
// based on competitor min, demand and vacancy. Returns reasoning text the
// hotel panel can display verbatim.

import { sbSelect } from "@/lib/onboard/supabase-admin";
import { getLatestCompetitorMin } from "./scraper";
import { getDemandScore, getVacancyRate, ensurePricingConfig } from "./engine";

export type Suggestion = {
  hotelId: string;
  rooms: Array<{
    roomId: string;
    roomName: string;
    competitorMin: number | null;
    suggestedRoomPrice: number;
    suggestedFloorPrice: number;
    suggestedFlashFloor: number;
    currentFloor: number;
    currentPrice: number;
    aiManaged: boolean;
    reasoning: string;
  }>;
  hotelDemand: number;
  hotelVacancy: number;
  hotelCompetitorMin: number | null;
};

export async function buildSuggestions(hotelId: string): Promise<Suggestion> {
  const competitorMin = await getLatestCompetitorMin(hotelId);
  const vacancy = await getVacancyRate(hotelId);
  const rooms = await sbSelect<any>("rooms", `"hotelId"=eq.${hotelId}&select=id,name,type,floorPrice,mrp&limit=50`);

  const out: Suggestion["rooms"] = [];
  let demandSample = 0;

  for (const r of rooms) {
    const cfg = await ensurePricingConfig(r.id).catch(() => null);
    if (!cfg) continue;
    const demand = await getDemandScore(r.id);
    demandSample = Math.max(demandSample, demand);

    const cMin = competitorMin ?? Number(r.mrp) * 1.5;
    const suggestedRoomPrice = Math.max(
      Math.round((cMin * 0.93) / 10) * 10,
      Number(cfg.floor_price)
    );
    const suggestedFloorPrice = Math.round((cMin * 0.60) / 10) * 10;
    const suggestedFlashFloor = Math.round((cMin * 0.45) / 10) * 10;

    out.push({
      roomId: r.id,
      roomName: r.name || r.type,
      competitorMin,
      suggestedRoomPrice,
      suggestedFloorPrice,
      suggestedFlashFloor,
      currentFloor: Number(cfg.floor_price),
      currentPrice: Number(cfg.current_price),
      aiManaged: !!cfg.ai_managed,
      reasoning: buildReasoning(cMin, demand, vacancy),
    });
  }
  return {
    hotelId,
    rooms: out,
    hotelDemand: demandSample,
    hotelVacancy: vacancy,
    hotelCompetitorMin: competitorMin,
  };
}

function buildReasoning(competitorMin: number, demand: number, vacancy: number): string {
  const parts: string[] = [];
  if (competitorMin) parts.push(`Competitor lowest: ₹${competitorMin}`);
  parts.push(`Demand: ${demand >= 75 ? "HIGH 🔥" : demand >= 40 ? "Normal" : "Low"}`);
  parts.push(`Vacancy: ${Math.round(vacancy)}%`);
  if (vacancy < 30 || demand > 75) parts.push("→ premium pricing recommended");
  else if (vacancy > 80) parts.push("→ aggressive discount recommended");
  else parts.push("→ stay 5–10% below market");
  return parts.join(" · ");
}
