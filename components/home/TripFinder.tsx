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
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { answerTrip, BUDGET_BANDS, type BudgetBandId, type FinderHotel } from "@/lib/browse/trip-finder";
import { TRIP_FORMATS, formatForSegment, type SegmentId, type TripFormatId } from "@/lib/browse/trip-formats";
import { SEASON_PROGRAMS } from "@/lib/browse/season-programs";
import { effectiveProgram, effectiveMonth, readSeasonPrefId, setSeasonPref } from "@/lib/browse/season-pref";
import { recordFormatChoice, recordSegmentChoice } from "@/lib/browse/segment";
import { conciergeWaLink } from "@/lib/browse/whatsapp";
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

// v584.1 — the "what happens here" journey map that fills the header's dead
// space (owner: "yahan kuch aisha mention karo jish se samaj aa jaye ki ab
// kya karna hai"). Rendered as a Who → Trip → Budget → Matches strip whose
// active step glows, done steps tick, and future steps stay quiet.
const GUIDE: { at: number; ico: string; lb: string }[] = [
  { at: 0, ico: "👥", lb: "Who" },
  { at: 1, ico: "🧭", lb: "Trip" },
  { at: 2, ico: "💰", lb: "Budget" },
  { at: 3, ico: "✨", lb: "Matches" },
];

export default function TripFinder({
  hotels,
  viewer,
}: {
  hotels: FinderHotel[];
  viewer: ViewerPoint | null;
}) {
  const router = useRouter();
  // v583.1 — the season is a PREFERENCE now: default = this month's program,
  // but the ribbon opens a picker; a chosen season re-ranks EVERY surface
  // (they all read effectiveMonth()). progTick re-renders on change.
  const [progTick, setProgTick] = useState(0);
  useEffect(() => {
    const onPref = () => setProgTick((t) => t + 1);
    window.addEventListener("sb:season-pref", onPref);
    return () => window.removeEventListener("sb:season-pref", onPref);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const program = useMemo(() => effectiveProgram(), [progTick]);
  const [seasonOpen, setSeasonOpen] = useState(false);
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const picks = useMemo(() => {
    if (step !== 3 || !seg || !format || !budget) return [];
    return answerTrip({ segment: seg, format, budget, viewer, hotels, month: effectiveMonth() });
  }, [step, seg, format, budget, viewer, hotels, progTick]);

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
                {/* v584.1 — every step now says what to DO and what comes
                    NEXT, so the traveller is never guessing. */}
                {step === 0 && "Tap 1 of 3 — who's travelling? Trip type comes next."}
                {step === 1 && "Tap 2 of 3 — pick the trip type. Budget is next."}
                {step === 2 && "Last tap — pick a budget & your matches appear."}
                {step === 3 && "For your trip, budget & how far you are."}
              </p>
            </div>
            {/* v584.1 — the journey map fills the header's empty middle: this
                card finds your destination in 3 taps, and here is exactly
                where you are in that journey. */}
            <div className="sbh-tf-guide" aria-hidden>
              {GUIDE.map((g, idx) => (
                <Fragment key={g.at}>
                  {idx > 0 ? <span className="sbh-tf-garrow">→</span> : null}
                  <span className={`sbh-tf-gstep${step === g.at ? " is-now" : step > g.at ? " is-done" : ""}`}>
                    <span className="sbh-tf-gstep-ico">{step > g.at ? "✓" : g.ico}</span> {g.lb}
                  </span>
                </Fragment>
              ))}
            </div>
            {/* the seasonal selling program, folded into the Finder as a
                slim tappable ribbon (was a full-width card of its own).
                Hidden once answers show — it has done its job by then and
                the module must stay within its height budget. */}
            {step < 3 ? (
            <button
              type="button"
              className="sbh-tf-ribbon"
              onClick={() => setSeasonOpen((v) => !v)}
              aria-expanded={seasonOpen}
              aria-label={`Season: ${program.title} — tap to change`}
            >
              <span className="sbh-tf-ribbon-ico" aria-hidden>{program.icon}</span>
              <span className="sbh-tf-ribbon-txt">
                <b>{program.title}</b>
                <i>{program.tagline}</i>
              </span>
              {/* v584.1 — a bare ▾ read as decoration; say the word so the
                  traveller KNOWS the season is switchable. */}
              <span className="sbh-tf-ribbon-go" aria-hidden>{seasonOpen ? "close ▴" : "change ▾"}</span>
            </button>
            ) : null}
          </div>
          {/* v583.1 — season PICKER: default is this month's program, but the
              traveller can plan for any season; the whole Stage re-ranks. */}
          {seasonOpen && step < 3 ? (
            <div className="sbh-tf-seasons sbh-tf-anim" role="group" aria-label="Plan for a season">
              {SEASON_PROGRAMS.map((sp) => (
                <button
                  key={sp.id} type="button"
                  className={`sbh-tf-season${program.id === sp.id ? " is-on" : ""}`}
                  onClick={() => {
                    setSeasonPref(sp.id);
                    chooseFormat(sp.featuredFormat);
                    setFormatLocked(true);
                    setSeasonOpen(false);
                    if (step === 1) setStep(2);
                  }}
                >
                  <span aria-hidden>{sp.icon}</span> {sp.title}
                </button>
              ))}
              {readSeasonPrefId() ? (
                <button
                  type="button" className="sbh-tf-season is-auto"
                  onClick={() => { setSeasonPref(null); setSeasonOpen(false); }}
                >
                  ↺ Auto (this month)
                </button>
              ) : null}
            </div>
          ) : null}
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
            <div className="sbh-tf-anim" key="s3">
            <div className="sbh-tf-answers">
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
            {/* v583 — WhatsApp-led trust (deck: 56% of the core market
                prefers assisted booking). Same concierge line as the /bid
                group concierge; message pre-filled from the answers. */}
            <a
              className="sbh-tf-wa"
              href={conciergeWaLink(
                `Hi! I'm planning a trip and StayBid suggested ${picks.map((p) => p.hotel.city).filter(Boolean).join(", ")}. Can you help me plan and book?`,
              )}
              target="_blank" rel="noopener noreferrer"
            >
              💬 Want a human to plan it? <b>Chat on WhatsApp</b>
            </a>
            </div>
          ) : (
            <p className="sbh-tf-empty">
              No exact match this time — try a different trip type or budget, or{" "}
              <a className="sbh-tf-wa-inline" href={conciergeWaLink("Hi! I need help planning a trip on StayBid.")} target="_blank" rel="noopener noreferrer">
                ask us on WhatsApp
              </a>.
            </p>
          )
        ) : null}
      </div>
    </section>
  );
}
