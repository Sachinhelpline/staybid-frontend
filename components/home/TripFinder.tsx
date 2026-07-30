"use client";
// ═══════════════════════════════════════════════════════════════════════════
// TRIP FINDER (v582.1 redesign) — "Not sure where to go? Answer 3 taps."
//
// Owner review of the first cut: the Finder + the seasonal band were TWO tall
// flat cards eating ~1.5 phone screens. This redesign folds them into ONE
// compact, layered, alive module:
//   • the seasonal selling program is now a slim tappable RIBBON inside the
//     Finder header (tap = pre-pick its featured trip type) — the standalone
//     band is gone, ~350px returned to the page
//   • options are ONE horizontal row of raised emoji-coin pills (snap
//     scroll), not a 2×3 grid of tall tiles
//   • answers are photo-backed depth cards (media tile + scrim + foil medal —
//     the same depth-on-media contract as every Stage card), in a snap rail
//     on phones and a 3-up row on desktop
//   • steps slide in; the card carries layered elevation + a slow gold sheen
//     (all motion inside this module's CSS, reduced-motion safe)
//
// Scoring unchanged: lib/browse/trip-finder.ts (pure, deterministic).
// Styles: .sbh-tf-* in app/globals.css (unlayered, both viewports).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { answerTrip, BUDGET_BANDS, type BudgetBandId, type FinderHotel } from "@/lib/browse/trip-finder";
import { TRIP_FORMATS, formatForSegment, type SegmentId, type TripFormatId } from "@/lib/browse/trip-formats";
import { programForMonth } from "@/lib/browse/season-programs";
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
  const program = useMemo(() => programForMonth(new Date().getUTCMonth()), []);
  // step: 0 who · 1 trip type · 2 budget · 3 answers
  const [step, setStep] = useState(0);
  const [seg, setSeg] = useState<SegmentId | null>(null);
  const [format, setFormat] = useState<TripFormatId | null>(null);
  const [budget, setBudget] = useState<BudgetBandId | null>(null);
  // the season ribbon can pre-lock the trip type — the flow then skips step 1
  const [formatLocked, setFormatLocked] = useState(false);

  // A returning visitor with saved answers lands straight on them.
  useEffect(() => {
    const saved = readSaved();
    if (saved) { setSeg(saved.seg); setFormat(saved.format); setBudget(saved.budget); setStep(3); }
  }, []);

  const chooseFormat = (id: TripFormatId) => {
    setFormat(id);
    recordFormatChoice(id);
    // keep the Stage's trip-type chips in sync — same store, same event
    try {
      localStorage.setItem("sb_trip_format", id);
      window.dispatchEvent(new Event("sb:trip-format"));
    } catch {}
  };

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
    setStep(0); setSeg(null); setFormat(null); setBudget(null); setFormatLocked(false);
    try { localStorage.removeItem(STORE_KEY); } catch {}
  };

  if (!hotels.length) return null;

  return (
    <section className="sbh-tf" aria-label="Trip Finder">
      <div className="sbh-tf-card">
        <div className="sbh-tf-top">
          <div className="sbh-tf-toprow">
            <div className="sbh-tf-heading">
              <h2 className="sbh-tf-title">
                {step === 3 ? "Your matches" : "Not sure where to go?"}
              </h2>
              <p className="sbh-tf-sub">
                {step === 0 && "3 quick taps — we'll find your places."}
                {step === 1 && "What kind of trip are you dreaming of?"}
                {step === 2 && "Roughly what budget per person?"}
                {step === 3 && "For your trip, budget & how far you are."}
              </p>
            </div>
            {/* the seasonal selling program, folded into the Finder as a
                slim tappable ribbon (was a full-width card of its own).
                Hidden once answers show — it has done its job by then and
                the module must stay within its height budget. */}
            {step < 3 ? (
            <button
              type="button"
              className="sbh-tf-ribbon"
              onClick={() => {
                chooseFormat(program.featuredFormat);
                setFormatLocked(true);
                if (step === 1) setStep(2);
              }}
              aria-label={`${program.title} — ${program.ctaLabel}`}
            >
              <span className="sbh-tf-ribbon-ico" aria-hidden>{program.icon}</span>
              <span className="sbh-tf-ribbon-txt">
                <b>{program.title}</b>
                <i>{program.tagline}</i>
              </span>
              <span className="sbh-tf-ribbon-go" aria-hidden>→</span>
            </button>
            ) : null}
          </div>
          {step < 3 ? (
            <div className="sbh-tf-dots" aria-hidden>
              {[0, 1, 2].map((i) => <span key={i} className={`sbh-tf-dot${i <= step ? " is-on" : ""}`} />)}
            </div>
          ) : (
            <button type="button" className="sbh-tf-change" onClick={reset}>↺ Change answers</button>
          )}
        </div>

        {step === 0 ? (
          <div className="sbh-tf-opts sbh-tf-anim" key="s0" role="group" aria-label="Who's going?">
            {WHO.map((w) => (
              <button
                key={w.id} type="button" className="sbh-tf-opt"
                onClick={() => {
                  setSeg(w.id);
                  recordSegmentChoice(w.id);
                  if (formatLocked && format) { setStep(2); return; } // ribbon pre-locked the trip
                  setFormat(formatForSegment(w.id));
                  setStep(1);
                }}
              >
                <span className="sbh-tf-coin" aria-hidden>{w.emoji}</span>
                <span className="sbh-tf-opt-lb">{w.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="sbh-tf-opts sbh-tf-anim" key="s1" role="group" aria-label="Trip type">
            {TRIP_FORMATS.map((f) => (
              <button
                key={f.id} type="button"
                className={`sbh-tf-opt${format === f.id ? " is-hint" : ""}`}
                onClick={() => { chooseFormat(f.id); setStep(2); }}
              >
                <span className="sbh-tf-coin" aria-hidden>{f.emoji}</span>
                <span className="sbh-tf-opt-lb">{f.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="sbh-tf-opts sbh-tf-anim" key="s2" role="group" aria-label="Budget per person">
            {BUDGET_BANDS.map((b) => (
              <button key={b.id} type="button" className="sbh-tf-opt" onClick={() => finish(b.id)}>
                <span className="sbh-tf-coin" aria-hidden>💰</span>
                <span className="sbh-tf-opt-lb">{b.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          picks.length ? (
            <div className="sbh-tf-answers sbh-tf-anim" key="s3">
              {picks.map((p, i) => (
                <article key={p.hotel.id} className="sbh-tf-ans">
                  <button
                    type="button"
                    className="sbh-tf-ans-media"
                    style={p.hotel.image ? { backgroundImage: `url(${p.hotel.image})` } : undefined}
                    onClick={() => router.push(`/hotels/${p.hotel.id}`)}
                    aria-label={`Explore ${p.hotel.name || p.hotel.city}`}
                  >
                    <span className="sbh-tf-ans-medal" aria-hidden>{MEDAL[i] || "✨"}</span>
                    <span className="sbh-tf-ans-scrim" aria-hidden />
                    <span className="sbh-tf-ans-id">
                      <b className="sbh-tf-ans-city">{p.hotel.city}</b>
                      <i className="sbh-tf-ans-name">{p.hotel.name}</i>
                    </span>
                  </button>
                  <div className="sbh-tf-ans-body">
                    <div className="sbh-tf-ans-why">
                      {p.reasons.slice(0, 2).map((r) => <span key={r} className="sbh-tf-why">{r}</span>)}
                    </div>
                    <div className="sbh-tf-ans-foot">
                      {p.estFrom != null ? (
                        <span className="sbh-tf-ans-price">
                          ₹{p.estFrom.toLocaleString("en-IN")}<i>/{p.estNights}n</i>
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
