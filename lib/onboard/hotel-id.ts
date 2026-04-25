import { sbRpc } from "./supabase-admin";
import { customAlphabet } from "nanoid";

const agentNano = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4);

export async function generateHotelPublicId(): Promise<string> {
  try {
    const r: any = await sbRpc("next_hotel_id");
    if (typeof r === "string") return r;
    if (Array.isArray(r) && r.length) return r[0];
    if (r && typeof r === "object" && "next_hotel_id" in r) return (r as any).next_hotel_id;
  } catch {
    // fallthrough
  }
  // Fallback if RPC not deployed yet
  const year = new Date().getFullYear();
  const rand = String(Math.floor(10000 + Math.random() * 90000));
  return `STB-${year}-${rand}`;
}

export function generateAgentCode(): string {
  return `AGT-${agentNano()}`;
}
