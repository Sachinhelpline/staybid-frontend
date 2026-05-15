"use client";
// v98 — customer-side Complaints centre.
// Until v98, the only customer-side complaint surface was the video-
// verification "Report Issue" link (writes vp_complaints with evidence
// video). For non-video issues — billing dispute, refund delay, room
// mismatch without recording, service complaint — there was no entry
// point at all, so /admin/complaints stayed empty in prod.
//
// This page hosts (a) a complaint history list for the signed-in user,
// (b) a "New complaint" composer with type/priority + optional booking
// context, and (c) a status timeline per item.

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import ModalCloseButton from "@/components/ModalCloseButton";

type Complaint = {
  id: string;
  type: string;
  subject?: string | null;
  description?: string | null;
  priority?: string | null;
  status?: string | null;
  bookingId?: string | null;
  hotelId?: string | null;
  bidId?: string | null;
  adminNotes?: string | null;
  adminNote?: string | null;       // legacy column
  refundAmount?: number | null;
  resolvedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

const TYPE_LABEL: Record<string, { label: string; icon: string }> = {
  booking:  { label: "Booking issue",   icon: "📅" },
  payment:  { label: "Payment / refund", icon: "💳" },
  refund:   { label: "Refund",           icon: "💸" },
  service:  { label: "Hotel service",   icon: "🏨" },
  bid:      { label: "Bid",              icon: "🎯" },
  video:    { label: "Video / verification", icon: "🎥" },
  general:  { label: "General",          icon: "📝" },
  other:    { label: "Other",            icon: "📝" },
};

const PRIORITY_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  low:    { bg: "bg-luxury-50",   color: "text-luxury-700", label: "Normal" },
  medium: { bg: "bg-amber-50",    color: "text-amber-800",  label: "Medium" },
  high:   { bg: "bg-red-50",      color: "text-red-700",    label: "Urgent" },
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  open:        { bg: "bg-amber-50",   color: "text-amber-800",   label: "Open" },
  in_progress: { bg: "bg-blue-50",    color: "text-blue-800",    label: "In review" },
  resolved:    { bg: "bg-emerald-50", color: "text-emerald-800", label: "Resolved" },
  rejected:    { bg: "bg-rose-50",    color: "text-rose-800",    label: "Closed" },
  escalate:    { bg: "bg-purple-50",  color: "text-purple-800",  label: "Escalated" },
};

// v103.1 — wrap useSearchParams() consumer in Suspense per Next.js 14
// requirement. Without this the static-page build fails with
// "useSearchParams should be wrapped in a suspense boundary".
export default function ComplaintsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-luxury-500">Loading…</div>}>
      <ComplaintsInner />
    </Suspense>
  );
}

function ComplaintsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [list, setList] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const prefilledBookingId = params?.get("bookingId") || "";
  const prefilledHotelId   = params?.get("hotelId")   || "";

  // Auto-open the composer when we arrive with a bookingId from /bookings.
  useEffect(() => {
    if (prefilledBookingId) setComposerOpen(true);
  }, [prefilledBookingId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.getMyComplaints();
      setList(d.complaints || []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }
    load();
  }, [user, authLoading, router, load]);

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center text-luxury-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-luxury-50 pb-24">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:py-12">
        <header className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl text-luxury-900">Complaints & Help</h1>
            <p className="text-sm text-luxury-500 mt-1">
              Raise a concern about a booking, payment, or hotel service. Our team responds within 24 hrs.
            </p>
          </div>
          <button
            onClick={() => setComposerOpen(true)}
            className="btn-luxury whitespace-nowrap text-sm px-4 py-2.5"
          >
            + New complaint
          </button>
        </header>

        {/* Helpful pointers */}
        <div className="card-luxury p-4 mb-6 bg-gradient-to-br from-gold-50/60 to-luxury-50/30">
          <div className="text-xs font-bold text-gold-800 uppercase tracking-wider mb-2">Faster routes</div>
          <div className="grid sm:grid-cols-3 gap-2 text-sm">
            <Link href="/my-bids"   className="card-luxury p-3 text-luxury-700 hover:bg-white transition">🎯 Issue with a bid? Check <span className="font-semibold">My Bids</span> first</Link>
            <Link href="/bookings"  className="card-luxury p-3 text-luxury-700 hover:bg-white transition">📅 Booking trouble? Open the booking in <span className="font-semibold">My Bookings</span></Link>
            <Link href="/verification" className="card-luxury p-3 text-luxury-700 hover:bg-white transition">🎥 Room mismatch? <span className="font-semibold">Record video evidence</span></Link>
          </div>
        </div>

        {loading ? (
          <div className="card-luxury p-10 text-center text-luxury-500 shimmer">Loading your complaints…</div>
        ) : list.length === 0 ? (
          <div className="card-luxury p-10 text-center">
            <div className="text-5xl mb-3">🙌</div>
            <div className="font-display text-xl text-luxury-900 mb-1">No complaints on record</div>
            <p className="text-sm text-luxury-500">If something goes wrong, raise it here and our team takes a look right away.</p>
            <button
              onClick={() => setComposerOpen(true)}
              className="btn-luxury mt-5 text-sm px-5 py-2.5"
            >
              Raise a complaint
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {list.map((c) => <Card key={c.id} c={c} />)}
          </div>
        )}
      </div>

      {composerOpen && (
        <Composer
          prefilledBookingId={prefilledBookingId}
          prefilledHotelId={prefilledHotelId}
          onClose={() => setComposerOpen(false)}
          onCreated={() => { setComposerOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function Card({ c }: { c: Complaint }) {
  const t = TYPE_LABEL[c.type] || TYPE_LABEL.general;
  const p = PRIORITY_STYLE[c.priority || "low"] || PRIORITY_STYLE.low;
  const s = STATUS_STYLE[c.status || "open"] || STATUS_STYLE.open;
  const adminMsg = c.adminNotes || c.adminNote;

  return (
    <article className="card-luxury p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-2xl leading-none">{t.icon}</span>
          <div>
            <div className="font-semibold text-luxury-900">{c.subject || t.label}</div>
            <div className="text-xs text-luxury-500 mt-0.5">
              {c.id?.slice(0, 12)} · {c.createdAt ? new Date(c.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <span className={`${p.bg} ${p.color} text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full`}>{p.label}</span>
          <span className={`${s.bg} ${s.color} text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full`}>{s.label}</span>
        </div>
      </div>

      {c.description && (
        <p className="text-sm text-luxury-700 leading-relaxed whitespace-pre-wrap mt-2">
          {c.description}
        </p>
      )}

      {(c.bookingId || c.bidId) && (
        <div className="flex gap-2 mt-3 flex-wrap text-xs">
          {c.bookingId && (
            <span className="bg-luxury-100 text-luxury-700 px-2 py-1 rounded-full">
              📅 Booking {c.bookingId.slice(0, 10)}
            </span>
          )}
          {c.bidId && (
            <span className="bg-luxury-100 text-luxury-700 px-2 py-1 rounded-full">
              🎯 Bid {c.bidId.slice(0, 10)}
            </span>
          )}
        </div>
      )}

      {adminMsg && (
        <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
          <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider mb-1">Reply from StayBid</div>
          <p className="text-sm text-emerald-900 leading-relaxed whitespace-pre-wrap">{adminMsg}</p>
          {Number(c.refundAmount) > 0 && (
            <div className="mt-2 text-xs font-semibold text-emerald-800">
              💸 Refund ₹{Number(c.refundAmount).toLocaleString("en-IN")} processed
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Composer({
  onClose, onCreated, prefilledBookingId, prefilledHotelId,
}: {
  onClose: () => void;
  onCreated: () => void;
  prefilledBookingId?: string;
  prefilledHotelId?: string;
}) {
  const [type, setType] = useState("booking");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("low");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [bookingId, setBookingId] = useState(prefilledBookingId || "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // Auto-load user's bookings so they can attach context without typing an ID
  useEffect(() => {
    setLoadingBookings(true);
    Promise.all([
      api.getMyBookings().catch(() => ({ bookings: [] })),
      api.getMyBids().catch(() => ({ bids: [] })),
    ]).then(([b, bd]) => {
      const fromBookings = (b.bookings || []).map((x: any) => ({
        id: x.id,
        label: `${x.hotel?.name || x.hotelId} · ${x.checkIn?.slice(0, 10) || "—"}`,
        kind: "booking",
      }));
      const fromBids = (bd.bids || [])
        .filter((x: any) => ["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(x.status))
        .map((x: any) => ({
          id: x.id,
          label: `${x.hotel?.name || x.hotelId} · bid · ${new Date(x.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
          kind: "bid",
        }));
      // Dedup by id
      const seen = new Set<string>();
      const merged: any[] = [];
      [...fromBookings, ...fromBids].forEach((x) => {
        if (!seen.has(x.id)) { seen.add(x.id); merged.push(x); }
      });
      setBookings(merged.slice(0, 20));
    }).finally(() => setLoadingBookings(false));
  }, []);

  async function submit() {
    setErr(null);
    if (!description.trim()) { setErr("Please describe the issue."); return; }
    setSubmitting(true);
    try {
      const selected = bookings.find((b) => b.id === bookingId);
      // When the user landed here from /bookings the booking may not be
      // in the loaded list yet — pass the id through anyway.
      const kind = selected?.kind ?? (bookingId ? "booking" : null);
      await api.submitComplaint({
        type,
        priority,
        subject: subject.trim() || undefined,
        description: description.trim(),
        bookingId: kind === "booking" ? bookingId || undefined : undefined,
        bidId:     kind === "bid"     ? bookingId || undefined : undefined,
        hotelId:   prefilledHotelId || undefined,
      });
      onCreated();
    } catch (e: any) {
      setErr(e?.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-luxury-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <div className="font-display text-xl text-luxury-900">Raise a complaint</div>
            <div className="text-xs text-luxury-500 mt-0.5">We typically reply within 24 hrs</div>
          </div>
          <ModalCloseButton onClose={onClose} tone="light" />
        </div>

        <div className="px-5 py-5 space-y-4" data-autonext-form>
          {/* Type chips — v122.3: every click auto-scrolls to "priority" section */}
          <div data-autonext="type" data-autonext-self="priority">
            <label className="text-[10px] font-bold uppercase tracking-wider text-luxury-500 mb-2 block">Issue type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["booking", "payment", "refund", "service", "bid", "other"] as const).map((t) => {
                const tt = TYPE_LABEL[t];
                const active = type === t;
                return (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    type="button"
                    className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                      active
                        ? "bg-gold-500 text-white border-gold-500 shadow-gold"
                        : "bg-white border-luxury-200 text-luxury-700 hover:border-gold-300"
                    }`}
                  >
                    <span className="mr-1">{tt.icon}</span> {tt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority — v122.3 */}
          <div data-autonext="priority" data-autonext-self="booking">
            <label className="text-[10px] font-bold uppercase tracking-wider text-luxury-500 mb-2 block">Priority</label>
            <div className="flex gap-2">
              {(["low", "medium", "high"] as const).map((p) => {
                const styles = {
                  low:    { active: "bg-luxury-700 text-white border-luxury-700", label: "Normal"  },
                  medium: { active: "bg-amber-500 text-white border-amber-500",   label: "Medium"  },
                  high:   { active: "bg-red-500 text-white border-red-500",       label: "Urgent"  },
                }[p];
                return (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    type="button"
                    className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold transition-all border ${
                      priority === p ? styles.active : "bg-white border-luxury-200 text-luxury-700 hover:border-luxury-300"
                    }`}
                  >
                    {styles.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Attach booking — v122.3 */}
          <div data-autonext="booking">
            <label className="text-[10px] font-bold uppercase tracking-wider text-luxury-500 mb-2 block">
              Attach booking <span className="text-luxury-400 font-normal lowercase">(optional)</span>
            </label>
            <select
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              className="input-luxury w-full"
              disabled={loadingBookings}
              data-autonext-target-blur="subject"
            >
              <option value="">{loadingBookings ? "Loading…" : "Not related to a specific booking"}</option>
              {bookings.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>

          {/* Subject — v122.3: blur (tap-away / Tab) advances to description */}
          <div data-autonext="subject">
            <label className="text-[10px] font-bold uppercase tracking-wider text-luxury-500 mb-2 block">
              Short title <span className="text-luxury-400 font-normal lowercase">(optional)</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value.slice(0, 180))}
              placeholder="e.g. Room was not the type I booked"
              className="input-luxury w-full"
              maxLength={180}
              data-autonext-target-blur="description"
              data-autonext-target-enter="description"
            />
          </div>

          {/* Description */}
          <div data-autonext="description">
            <label className="text-[10px] font-bold uppercase tracking-wider text-luxury-500 mb-2 block">
              What happened? *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 4000))}
              rows={5}
              placeholder="Walk us through what went wrong. The more detail you can share, the faster we can help."
              className="input-luxury w-full resize-none"
              maxLength={4000}
            />
            <div className="text-[10px] text-luxury-400 mt-1 text-right">{description.length}/4000</div>
          </div>

          {err && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-luxury-100 px-5 py-3 flex gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 rounded-xl border border-luxury-200 text-luxury-700 font-semibold text-sm hover:bg-luxury-50 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !description.trim()}
            className="flex-[2] btn-luxury text-sm py-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : "Submit complaint"}
          </button>
        </div>
      </div>
    </div>
  );
}
