"use client";
// ═══════════════════════════════════════════════════════════════════════════
// TRIP FINDER (v582) — "Not sure where to go? Answer 3 taps."
//
// The Decision Engine's guided journey for the traveller who cannot name a
// destination: WHO is going → WHAT KIND of trip → WHAT BUDGET, then three
// 🥇🥈🥉 Answer Cards with the reasons a human advisor would give and honest
// from-prices (real minimum nightly rate × typical nights — never invented).
//
// All scoring lives in lib/browse/trip-finder.ts (pure, deterministic, the
// same signals as every other surface). This component only walks the steps,
// persists the answers (sb_trip_finder_v1, 14 days) so a returning visitor
// lands straight on their answers, and feeds the segment/format stores the
// rest of the Stage already personalizes from.
//
// Styles: .sbh-tf-* in app/globals.css (unlayered, both viewports).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { answerTrip, BUDGET_BANDS, type BudgetBandId, type FinderHotel } from "@/lib/browse/trip-finder";
import { TRIP_FORMATS, formatForSegment, type SegmentId, type TripFormatId } from "@/lib/browse/trip-formats";
import { recordFormatChoice, recordSegmentChoice } from "@/lib/browse/segment";
import type { ViewerPoint } from "@/lib/browse/affinity";

const WHO: { id: SegmentId; emoji: string; label: string }[] = [
  { id: "couple",  emoji: "👫", label: "Couple" },
  { id: "family",  emoji: "👨‍👩‍👧", label: "Family" },
  { id: "group",   emoji: "🎒", label: "Friends" },
  { id: "solo",    emoji: "🧳", label: "Solo" },
  { id: "pilgrim", emoji: "🛕", label: "Darshan" },
];

const STORE_KEY = "sb_trip_finder_v1";
const STORE_TTL = 14 * 24 * 60 * 60 * 1000;

interface Saved { seg: SegmentId; format: TripFormatId; budget: BudgetBandId; ts: number; }

function readSaved(): Saved | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null") as Saved | null;
    if (!raw?.seg || !raw?.format || !raw?.budget || !Number.isFinite(raw.ts)) return null;
    if (Date.now() - raw.ts > STORE_TTL) return null;
    return raw;
  } catch { return null; }
}

const MEDAL = ["🥇", "🥈", "🥉"];

export default function TripFinder({
  hotels,
  viewer,
}: {
  hotels: FinderHotel[];
  viewer: ViewerPoint | null;
}) {
  const router = useRouter();
  // step: 0 who · 1 trip type · 2 budget · 3 answers
  const [step, setStep] = useState(0);
  const [seg, setSeg] = useState<SegmentId | null>(null);
  const [format, setFormat] = useState<TripFormatId | null>(null);
  const [budget, setBudget] = useState<BudgetBandId | null>(null);

  // A returning visitor with saved answers lands straight on them.
  useEffect(() => {
    const saved = readSaved();
    if (saved) { setSeg(saved.seg); setFormat(saved.format); setBudget(saved.budget); setStep(3); }
  }, []);

  const finish = (b: BudgetBandId) => {
    setBudget(b);
    setStep(3);
    if (seg && format) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ seg, format, budget: b, ts: Date.now() } satisfies Saved)); } catch {}
    }
  };

  const picks = useMemo(() => {
    if (step !== 3 || !seg || !format || !budget) return [];
    return answerTrip({ segment: seg, format, budget, viewer, hotels });
  }, [step, seg, format, budget, viewer, hotels]);

  const reset = () => {
    setStep(0); setSeg(null); setFormat(null); setBudget(null);
    try { localStorage.removeItem(STORE_KEY); } catch {}
  };

  if (!hotels.length) return null;

  return (
    <section className="sbh-tf" aria-label="Trip Finder">
      <div className="sbh-tf-card">
        <div className="sbh-tf-top">
          <h2 className="sbh-tf-title">
            {step === 3 ? "Your perfect matches" : "Not sure where to go?"}
          </h2>
          <p className="sbh-tf-sub">
            {step === 0 && "Answer 3 quick taps — we'll find your places."}
            {step === 1 && "What kind of trip are you dreaming of?"}
            {step === 2 && "Roughly what budget per person?"}
            {step === 3 && "Picked for your trip, your budget and how far you are."}
          </p>
          {step < 3 ? (
            <div className="sbh-tf-dots" aria-hidden>
              {[0, 1, 2].map((i) => <span key={i} className={`sbh-tf-dot${i <= step ? " is-on" : ""}`} />)}
            </div>
          ) : (
            <button type="button" className="sbh-tf-change" onClick={reset}>↺ Change answers</button>
          )}
        </div>

        {step === 0 ? (
          <div className="sbh-tf-opts" role="group" aria-label="Who's going?">
            {WHO.map((w) => (
              <button
                key={w.id} type="button" className="sbh-tf-opt"
                onClick={() => {
                  setSeg(w.id);
                  recordSegmentChoice(w.id);
                  setFormat(formatForSegment(w.id)); // pre-highlight step 2's natural pick
                  setStep(1);
                }}
              >
                <span className="sbh-tf-opt-emo" aria-hidden>{w.emoji}</span>
                <span>{w.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="sbh-tf-opts" role="group" aria-label="Trip type">
            {TRIP_FORMATS.map((f) => (
              <button
                key={f.id} type="button"
                className={`sbh-tf-opt${format === f.id ? " is-hint" : ""}`}
                onClick={() => { setFormat(f.id); recordFormatChoice(f.id); setStep(2); }}
              >
                <span className="sbh-tf-opt-emo" aria-hidden>{f.emoji}</span>
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="sbh-tf-opts" role="group" aria-label="Budget per person">
            {BUDGET_BANDS.map((b) => (
              <button key={b.id} type="button" className="sbh-tf-opt" onClick={() => finish(b.id)}>
                <span className="sbh-tf-opt-emo" aria-hidden>💰</span>
                <span>{b.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          picks.length ? (
            <div className="sbh-tf-answers">
              {picks.map((p, i) => (
                <article key={p.hotel.id} className="sbh-tf-ans">
                  {p.hotel.image ? (
                    <div className="sbh-tf-ans-img" style={{ backgroundImage: `url(${p.hotel.image})` }} aria-hidden />
                  ) : null}
                  <div className="sbh-tf-ans-body">
                    <div className="sbh-tf-ans-head">
                      <span className="sbh-tf-ans-medal" aria-hidden>{MEDAL[i] || "✨"}</span>
                      <div>
                        <h3 className="sbh-tf-ans-city">{p.hotel.city}</h3>
                        <p className="sbh-tf-ans-name">{p.hotel.name}</p>
                      </div>
                    </div>
                    <div className="sbh-tf-ans-why">
                      {p.reasons.map((r) => <span key={r} className="sbh-tf-why">{r}</span>)}
                    </div>
                    <div className="sbh-tf-ans-foot">
                      {p.estFrom != null ? (
                        <span className="sbh-tf-ans-price">
                          From ₹{p.estFrom.toLocaleString("en-IN")} <i>· {p.estNights} nights</i>
                        </span>
                      ) : <span />}
                      <div className="sbh-tf-ans-ctas">
                        <button type="button" className="sbh-tf-go" onClick={() => router.push(`/hotels/${p.hotel.id}`)}>
                          Explore
                        </button>
                        <button
                          type="button" className="sbh-tf-bid"
                          onClick={() => router.push(`/hotels/${p.hotel.id}?intent=negotiate`)}
                        >
                          ₹ Your price
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="sbh-tf-empty">No exact match this time — try a different trip type or budget.</p>
          )
        ) : null}
      </div>
    </section>
  );
}
