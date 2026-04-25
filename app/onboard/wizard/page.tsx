"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadOnboardSession, onbFetch, clearOnboardSession } from "@/lib/onboard/client";

type Hit = {
  source: string; sourceRef: string; name: string; address?: string; city: string;
  rating?: number; reviewCount?: number; thumbnail?: string;
  starRating?: number; priceHint?: number; link?: string;
};

type Room = { type: string; capacity: number; basePrice: number; floorPrice: number; amenities: string[] };
type Draft = {
  name: string; description: string; city: string; state?: string; country: string;
  address: string; starRating: number; rating?: number; reviewCount?: number;
  photos: string[]; amenities: string[]; rooms: Room[];
  contact: { phone?: string; email?: string; website?: string };
  policies: { checkIn?: string; checkOut?: string; cancellation?: string };
  source: string; sourceRef: string;
};

type Step = "search" | "select" | "edit" | "consent" | "done";

export default function WizardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [city, setCity]   = useState("");
  const [hits, setHits]   = useState<Hit[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [onboardedVia, setOnboardedVia] = useState<"self" | "agent">("self");
  const [agentCode, setAgentCode] = useState("");
  const [agentValid, setAgentValid] = useState<null | boolean>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [livePublicId, setLivePublicId] = useState<string | null>(null);

  useEffect(() => {
    const { token, user } = loadOnboardSession();
    if (!token) { router.replace("/onboard/signin"); return; }
    setUser(user);
  }, [router]);

  // ---- Step actions ------------------------------------------------------
  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || !city.trim()) { setErr("Hotel name and city are required."); return; }
    setErr(null); setSearching(true); setHits([]);
    try {
      const j = await onbFetch<{ provider: string; results: Hit[] }>("/api/onboard/search", {
        method: "POST", body: JSON.stringify({ query, city }),
      });
      setHits(j.results || []); setProvider(j.provider);
      setStep("select");
    } catch (e: any) { setErr(e?.message || "Search failed"); }
    finally { setSearching(false); }
  };

  const pickHit = async (hit: Hit) => {
    setFetching(true); setErr(null);
    try {
      const j = await onbFetch<{ draftId: string; draft: Draft }>("/api/onboard/fetch-details", {
        method: "POST", body: JSON.stringify({ hit }),
      });
      setDraft(j.draft); setDraftId(j.draftId); setStep("edit");
    } catch (e: any) { setErr(e?.message || "Failed to load details"); }
    finally { setFetching(false); }
  };

  const checkAgent = async () => {
    if (!agentCode.trim()) { setAgentValid(null); return; }
    try {
      const r = await fetch(`/api/onboard/agent/verify?code=${encodeURIComponent(agentCode.trim())}`);
      const j = await r.json();
      setAgentValid(!!j.valid);
    } catch { setAgentValid(false); }
  };

  const submit = async () => {
    if (!draft || !draftId) return;
    if (!consent) { setErr("Owner consent is required."); return; }
    if (onboardedVia === "agent" && !agentValid) { setErr("Please verify the agent code first."); return; }
    setSubmitting(true); setErr(null);
    try {
      const j = await onbFetch<{ ok: boolean; hotelId: string }>("/api/onboard/submit", {
        method: "POST",
        body: JSON.stringify({
          draftId, payload: draft, ownerConsent: consent,
          onboardedVia, agentCode: onboardedVia === "agent" ? agentCode : null,
        }),
      });
      setLivePublicId(j.hotelId); setStep("done");
    } catch (e: any) { setErr(e?.message || "Submit failed"); }
    finally { setSubmitting(false); }
  };

  // ---- Render ------------------------------------------------------------
  if (!user) return null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* User chip */}
      <div className="flex items-center justify-between mb-6">
        <Stepper step={step} />
        <button onClick={() => { clearOnboardSession(); router.push("/onboard"); }}
                className="text-sm text-luxury-500 hover:text-gold-700">Sign out</button>
      </div>

      {err && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      {step === "search" && (
        <SearchStep query={query} city={city} setQuery={setQuery} setCity={setCity}
                    onSearch={doSearch} searching={searching} />
      )}

      {step === "select" && (
        <SelectStep hits={hits} provider={provider} fetching={fetching} onPick={pickHit}
                    onBack={() => setStep("search")} />
      )}

      {step === "edit" && draft && (
        <EditStep draft={draft} setDraft={setDraft}
                  onContinue={() => setStep("consent")}
                  onBack={() => setStep("select")} />
      )}

      {step === "consent" && draft && (
        <ConsentStep
          draft={draft} consent={consent} setConsent={setConsent}
          onboardedVia={onboardedVia} setOnboardedVia={setOnboardedVia}
          agentCode={agentCode} setAgentCode={setAgentCode}
          agentValid={agentValid} checkAgent={checkAgent}
          submitting={submitting} onSubmit={submit}
          onBack={() => setStep("edit")}
        />
      )}

      {step === "done" && livePublicId && (
        <DoneStep publicId={livePublicId} draft={draft!} onAddAnother={() => {
          setStep("search"); setQuery(""); setCity(""); setHits([]);
          setDraft(null); setDraftId(null); setConsent(false); setLivePublicId(null);
        }} />
      )}
    </div>
  );
}

// ============================================================================
// Stepper
// ============================================================================
function Stepper({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "search",  label: "Search" },
    { id: "select",  label: "Select" },
    { id: "edit",    label: "Review" },
    { id: "consent", label: "Consent" },
    { id: "done",    label: "Live" },
  ];
  const idx = steps.findIndex((s) => s.id === step);
  return (
    <div className="flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold ${
            i <= idx ? "bg-gradient-to-br from-gold-600 to-gold-500 text-white"
                     : "bg-luxury-100 text-luxury-400"
          }`}>{i + 1}</div>
          <div className={i <= idx ? "text-luxury-800 font-medium" : "text-luxury-400"}>{s.label}</div>
          {i < steps.length - 1 && <div className={`w-8 h-px ${i < idx ? "bg-gold-400" : "bg-luxury-200"}`} />}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Step 1: Search
// ============================================================================
function SearchStep({ query, city, setQuery, setCity, onSearch, searching }: any) {
  return (
    <div className="grid md:grid-cols-2 gap-10 items-center">
      <div>
        <h1 className="font-display text-4xl text-luxury-900">Find your hotel</h1>
        <p className="text-luxury-500 mt-3">Tell us your hotel's name and city. Our AI will search across the web for your existing presence.</p>
        <form onSubmit={onSearch} className="mt-7 space-y-4 card-luxury p-6">
          <Field label="Hotel name">
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="e.g. The Mountain Grand" className="input-luxury" autoFocus />
          </Field>
          <Field label="City">
            <input value={city} onChange={(e) => setCity(e.target.value)}
                   placeholder="e.g. Mussoorie" className="input-luxury" />
          </Field>
          <button disabled={searching} className="btn-luxury w-full disabled:opacity-50">
            {searching ? "Searching the web…" : "Search hotels →"}
          </button>
        </form>
      </div>
      <div className="hidden md:block">
        <div className="card-luxury p-7 bg-gradient-to-br from-gold-50 to-luxury-50 border-gold-200">
          <div className="text-xs uppercase tracking-widest text-gold-700 font-bold">What our AI checks</div>
          <ul className="mt-4 space-y-3 text-sm text-luxury-700">
            {["Google Hotels","Booking.com","MakeMyTrip","Goibibo","Agoda","Hotel's own website"].map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-gold-200 text-gold-800 text-xs flex items-center justify-center">✓</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step 2: Select hotel from search results
// ============================================================================
function SelectStep({ hits, provider, fetching, onPick, onBack }: any) {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="font-display text-3xl text-luxury-900">Pick your hotel</h2>
          <p className="text-luxury-500 text-sm mt-1">
            {hits.length} matches · provider: <span className="font-mono text-gold-700">{provider}</span>
          </p>
        </div>
        <button onClick={onBack} className="text-sm text-luxury-500 hover:text-gold-700">← Search again</button>
      </div>

      {fetching && (
        <div className="card-luxury p-8 text-center">
          <div className="font-display text-xl text-gold-700">AI is fetching photos & details…</div>
          <div className="text-sm text-luxury-500 mt-2">This may take a few seconds.</div>
          <div className="mt-4 mx-auto w-12 h-12 rounded-full border-2 border-gold-300 border-t-gold-600 animate-spin"></div>
        </div>
      )}

      {!fetching && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {hits.map((h: Hit) => (
            <button key={h.sourceRef} onClick={() => onPick(h)}
                    className="text-left card-luxury overflow-hidden group hover:border-gold-400 hover:shadow-gold transition">
              <div className="aspect-video bg-cover bg-center bg-luxury-100"
                   style={{ backgroundImage: h.thumbnail ? `url(${h.thumbnail})` : undefined }} />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-luxury-900 leading-tight">{h.name}</div>
                  {h.starRating && <div className="text-xs text-gold-700 font-bold whitespace-nowrap">{"★".repeat(h.starRating)}</div>}
                </div>
                <div className="text-xs text-luxury-500 mt-1">{h.address || h.city}</div>
                <div className="flex items-center justify-between mt-3 text-xs">
                  {h.rating && <span className="text-emerald-700 font-semibold">★ {h.rating} · {h.reviewCount || 0}</span>}
                  {h.priceHint && <span className="text-luxury-700">from ₹{h.priceHint.toLocaleString("en-IN")}</span>}
                </div>
                <div className="mt-3 text-xs text-gold-700 font-bold opacity-0 group-hover:opacity-100 transition">Choose this →</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {!fetching && hits.length === 0 && (
        <div className="card-luxury p-8 text-center text-luxury-500">
          No matches. <button onClick={onBack} className="text-gold-700 font-medium">Try different search terms</button>.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Step 3: Edit (the big premium-theme review screen)
// ============================================================================
function EditStep({ draft, setDraft, onContinue, onBack }: { draft: Draft; setDraft: (d: Draft) => void; onContinue: () => void; onBack: () => void }) {
  const upd = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const updRoom = (i: number, patch: Partial<Room>) =>
    upd({ rooms: draft.rooms.map((r, j) => j === i ? { ...r, ...patch } : r) });
  const removeRoom = (i: number) => upd({ rooms: draft.rooms.filter((_, j) => j !== i) });
  const addRoom = () => upd({ rooms: [...draft.rooms, { type: "New Room", capacity: 2, basePrice: 4999, floorPrice: 3899, amenities: ["WiFi"] }] });
  const togglePhoto = (url: string) => {
    const has = draft.photos.includes(url);
    upd({ photos: has ? draft.photos.filter((p) => p !== url) : [...draft.photos, url] });
  };
  const addPhotoUrl = (url: string) => { if (url.trim()) upd({ photos: [...draft.photos, url.trim()] }); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-3xl text-luxury-900">Review your hotel</h2>
        <button onClick={onBack} className="text-sm text-luxury-500 hover:text-gold-700">← Pick a different hotel</button>
      </div>

      {/* Basics */}
      <Section title="Basics">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Hotel name"><input className="input-luxury" value={draft.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
          <Field label="Star rating">
            <select className="input-luxury" value={draft.starRating} onChange={(e) => upd({ starRating: +e.target.value })}>
              {[3,4,5].map((n) => <option key={n} value={n}>{n} stars</option>)}
            </select>
          </Field>
          <Field label="City"><input className="input-luxury" value={draft.city} onChange={(e) => upd({ city: e.target.value })} /></Field>
          <Field label="State"><input className="input-luxury" value={draft.state || ""} onChange={(e) => upd({ state: e.target.value })} /></Field>
          <Field label="Address" full><input className="input-luxury" value={draft.address} onChange={(e) => upd({ address: e.target.value })} /></Field>
          <Field label="Description" full>
            <textarea rows={4} className="input-luxury" value={draft.description} onChange={(e) => upd({ description: e.target.value })} />
          </Field>
        </div>
      </Section>

      {/* Photos */}
      <Section title={`Photos (${draft.photos.length})`} subtitle="Click to remove. Add custom URLs below.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {draft.photos.map((url) => (
            <button key={url} type="button" onClick={() => togglePhoto(url)}
                    className="aspect-square rounded-xl bg-cover bg-center border-2 border-luxury-100 hover:border-red-400 relative group"
                    style={{ backgroundImage: `url(${url})` }}>
              <div className="absolute inset-0 bg-red-500/0 group-hover:bg-red-500/30 transition rounded-xl flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 text-white font-bold">Remove</span>
              </div>
            </button>
          ))}
        </div>
        <PhotoAdder onAdd={addPhotoUrl} />
      </Section>

      {/* Amenities */}
      <Section title="Amenities">
        <AmenitiesEditor list={draft.amenities} setList={(l) => upd({ amenities: l })} />
      </Section>

      {/* Rooms */}
      <Section title="Rooms & pricing" subtitle="Add as many room types as you offer.">
        <div className="space-y-3">
          {draft.rooms.map((r, i) => (
            <div key={i} className="grid md:grid-cols-5 gap-3 items-end card-luxury p-4">
              <Field label="Room type"><input className="input-luxury" value={r.type} onChange={(e) => updRoom(i, { type: e.target.value })} /></Field>
              <Field label="Capacity"><input type="number" className="input-luxury" value={r.capacity} onChange={(e) => updRoom(i, { capacity: +e.target.value })} /></Field>
              <Field label="Base price (₹/night)"><input type="number" className="input-luxury" value={r.basePrice} onChange={(e) => updRoom(i, { basePrice: +e.target.value })} /></Field>
              <Field label="Floor price (₹/night)"><input type="number" className="input-luxury" value={r.floorPrice} onChange={(e) => updRoom(i, { floorPrice: +e.target.value })} /></Field>
              <button onClick={() => removeRoom(i)} className="text-red-600 text-sm hover:underline">Remove</button>
            </div>
          ))}
          <button onClick={addRoom} className="text-gold-700 font-semibold text-sm hover:underline">+ Add room type</button>
        </div>
      </Section>

      {/* Contact */}
      <Section title="Contact & policies">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Phone"><input className="input-luxury" value={draft.contact.phone || ""} onChange={(e) => upd({ contact: { ...draft.contact, phone: e.target.value } })} /></Field>
          <Field label="Email"><input className="input-luxury" value={draft.contact.email || ""} onChange={(e) => upd({ contact: { ...draft.contact, email: e.target.value } })} /></Field>
          <Field label="Website"><input className="input-luxury" value={draft.contact.website || ""} onChange={(e) => upd({ contact: { ...draft.contact, website: e.target.value } })} /></Field>
          <Field label="Check-in / Check-out">
            <div className="flex gap-2">
              <input className="input-luxury" placeholder="14:00" value={draft.policies.checkIn || ""} onChange={(e) => upd({ policies: { ...draft.policies, checkIn: e.target.value } })} />
              <input className="input-luxury" placeholder="11:00" value={draft.policies.checkOut || ""} onChange={(e) => upd({ policies: { ...draft.policies, checkOut: e.target.value } })} />
            </div>
          </Field>
        </div>
      </Section>

      <div className="flex justify-end">
        <button onClick={onContinue} className="btn-luxury">Continue to consent →</button>
      </div>
    </div>
  );
}

function PhotoAdder({ onAdd }: { onAdd: (url: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="mt-4 flex gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="https://… image URL"
             className="input-luxury flex-1" />
      <button type="button" onClick={() => { onAdd(v); setV(""); }}
              className="px-4 py-2 rounded-xl bg-gold-100 text-gold-800 font-semibold hover:bg-gold-200">Add</button>
    </div>
  );
}

function AmenitiesEditor({ list, setList }: { list: string[]; setList: (l: string[]) => void }) {
  const [v, setV] = useState("");
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {list.map((a) => (
          <span key={a} className="px-3 py-1 rounded-full bg-gold-50 border border-gold-200 text-sm text-gold-800 flex items-center gap-2">
            {a}
            <button onClick={() => setList(list.filter((x) => x !== a))} className="text-gold-500 hover:text-red-500">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add amenity (e.g. Spa)"
               className="input-luxury flex-1" />
        <button type="button" onClick={() => { if (v.trim()) { setList([...list, v.trim()]); setV(""); } }}
                className="px-4 py-2 rounded-xl bg-gold-100 text-gold-800 font-semibold hover:bg-gold-200">Add</button>
      </div>
    </div>
  );
}

// ============================================================================
// Step 4: Consent + Agent code + Final submit
// ============================================================================
function ConsentStep(props: any) {
  const { draft, consent, setConsent, onboardedVia, setOnboardedVia,
          agentCode, setAgentCode, agentValid, checkAgent,
          submitting, onSubmit, onBack } = props;
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="font-display text-3xl text-luxury-900">Almost there</h2>

      <div className="card-luxury p-6">
        <div className="text-xs uppercase tracking-widest text-gold-700 font-bold mb-3">Onboarding mode</div>
        <div className="grid md:grid-cols-2 gap-3">
          <button onClick={() => setOnboardedVia("self")}
                  className={`p-4 rounded-2xl border-2 text-left transition ${onboardedVia === "self" ? "border-gold-500 bg-gold-50" : "border-luxury-200 bg-white"}`}>
            <div className="font-semibold text-luxury-900">I am the hotel owner</div>
            <div className="text-xs text-luxury-500 mt-1">Listing my own property</div>
          </button>
          <button onClick={() => setOnboardedVia("agent")}
                  className={`p-4 rounded-2xl border-2 text-left transition ${onboardedVia === "agent" ? "border-gold-500 bg-gold-50" : "border-luxury-200 bg-white"}`}>
            <div className="font-semibold text-luxury-900">I am a StayBid agent</div>
            <div className="text-xs text-luxury-500 mt-1">Onboarding on behalf of an owner</div>
          </button>
        </div>

        {onboardedVia === "agent" && (
          <div className="mt-4">
            <Field label="Agent code">
              <div className="flex gap-2">
                <input className="input-luxury flex-1" placeholder="AGT-XXXX" value={agentCode}
                       onChange={(e) => setAgentCode(e.target.value.toUpperCase())} />
                <button onClick={checkAgent} className="px-4 py-2 rounded-xl bg-luxury-100 text-luxury-800 font-semibold hover:bg-luxury-200">Verify</button>
              </div>
            </Field>
            {agentValid === true && <div className="text-sm text-emerald-700 mt-2">✓ Agent verified</div>}
            {agentValid === false && <div className="text-sm text-red-600 mt-2">✗ Code not recognised</div>}
          </div>
        )}
      </div>

      <div className="card-luxury p-6 border-gold-200 bg-gradient-to-br from-gold-50 to-white">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                 className="mt-1 w-5 h-5 accent-gold-600" />
          <div>
            <div className="font-semibold text-luxury-900">Owner consent confirmed</div>
            <div className="text-sm text-luxury-600 mt-1">
              I confirm that I am the owner of <span className="font-semibold">{draft.name}</span> or have explicit
              written authorization from the owner to list this property on StayBid, and that I have the right to use
              the photos and information shown.
            </div>
          </div>
        </label>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="text-luxury-500 hover:text-gold-700">← Edit details</button>
        <button onClick={onSubmit} disabled={submitting || !consent} className="btn-luxury disabled:opacity-50">
          {submitting ? "Going live…" : "Publish hotel →"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Step 5: Done
// ============================================================================
function DoneStep({ publicId, draft, onAddAnother }: { publicId: string; draft: Draft; onAddAnother: () => void }) {
  return (
    <div className="max-w-2xl mx-auto text-center py-12">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white text-4xl mb-6">✓</div>
      <h2 className="font-display text-4xl text-luxury-900">{draft.name} is live!</h2>
      <p className="text-luxury-500 mt-3">Your hotel is now visible to customers across StayBid.</p>

      <div className="mt-6 inline-flex items-center gap-3 bg-white border border-gold-200 rounded-full px-5 py-2.5 shadow-gold">
        <span className="text-xs uppercase tracking-widest text-luxury-500">Hotel ID</span>
        <span className="font-mono font-bold text-gold-800">{publicId}</span>
      </div>

      <div className="mt-10 flex flex-wrap gap-3 justify-center">
        <a href={`/hotels/${publicId}`} className="btn-luxury">View public listing →</a>
        <a href="/partner" className="px-6 py-3 rounded-full bg-white border border-luxury-200 font-semibold text-luxury-800 hover:border-gold-400">Open partner dashboard</a>
        <button onClick={onAddAnother} className="px-6 py-3 rounded-full bg-luxury-100 text-luxury-800 font-semibold hover:bg-luxury-200">+ List another hotel</button>
      </div>
    </div>
  );
}

// ============================================================================
// Atoms
// ============================================================================
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card-luxury p-6">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="font-display text-xl text-luxury-900">{title}</h3>
          {subtitle && <div className="text-xs text-luxury-500 mt-1">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <div className="text-xs uppercase tracking-wider text-luxury-500 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
