"use client";
import { createClient } from "@supabase/supabase-js";
import { SB_URL, SB_KEY } from "@/lib/sb";

// Single browser-side Supabase client used for Realtime channel subscriptions.
// Server-side code keeps using the REST helpers in lib/sb.ts — no overlap.
let client: ReturnType<typeof createClient> | null = null;
export function rt() {
  if (!client) {
    client = createClient(SB_URL, SB_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
      auth: { persistSession: false },
    });
  }
  return client;
}

export type Tbl =
  | "influencers" | "influencer_commissions" | "influencer_referral_codes"
  | "referral_events" | "hotel_videos" | "user_points"
  | "points_history" | "user_saves" | "notification_queue";

// Subscribe to INSERT/UPDATE/DELETE on any of the new tables. Returns an
// unsubscribe function suitable for useEffect cleanup.
export function subscribeTables(
  tables: Tbl[],
  onChange: (evt: { table: string; eventType: string; new?: any; old?: any }) => void
): () => void {
  const ch = rt().channel(`watch-${Math.random().toString(36).slice(2)}`);
  for (const t of tables) {
    ch.on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: t },
      (payload: any) => onChange({ table: t, eventType: payload.eventType, new: payload.new, old: payload.old })
    );
  }
  ch.subscribe();
  return () => { rt().removeChannel(ch); };
}
