# 🚀 StayBid Circle — launch inventory CURATION (PLANNING)

**Status:** PLANNING / spec locked, not started. Build in a fresh session, plan-first.
**Owner direction (2026-07-27) — read this exactly, it overrides the earlier draft of this doc.**

## ⛔ HARD CONSTRAINTS (owner, emphatic)
- **DO NOT change ANY rule / engine / pricing / contract.** Nothing in the money, spine,
  Circle, availability, or provisioning logic changes.
- **DO NOT create / provision / seed any new property.** No blind creation.
- This is **ONLY an inventory FILTER (curation layer)** over the EXISTING inventory.
- **Additive + fully reversible.** Removing the filter later = everything back exactly as now.
- Understand the real data FIRST; no building blind; no breakdown of existing flows.

## The goal
Launch StayBid Circle with a **curated view**: in the launch phase, the customer sees
**exactly ONE premium property per city**, drawn from the EXISTING (demo/current) inventory.
Later, remove/relax the filter to expand (multiple properties per city) — the platform already
supports that, so nothing structural changes.

## Locked answers (owner)
- **A — properties:** not real yet; use existing inventory. Per city pick **1 premium** listing,
  preferably a **Resort or Individual Villa**, **5–15 rooms**.
- **B — duration:** all properties live **all 12 months**; seasonal preference comes from the
  EXISTING spine seasonality (already implemented) — nothing new.
- **C — launch model:** **Model 1** (multi-investor co-own & operate).
- **D — demo data:** keep showing the current data (it is the SOURCE we filter; do not delete).
- **E — pricing:** the **real spine dynamic price** per location — the core rule, untouched.

## What NOT to touch (from CLAUDE.md "Things to Avoid" / locked)
Spine engine, money engines, Circle SEBI-safe ownership contracts, availability engine,
provisioning, `approval_status` feed-gate semantics, prebuy-window. The filter must sit ON TOP,
not inside, these.

## Approach (plan-first, in the build session) — NOTHING here is built yet
1. **READ-ONLY map** the current inventory first: per city, list the properties, their type
   (resort/villa/hotel), room/unit count, Circle status (`owner_type`, `approval_status`).
   Only after seeing the real data do we choose the 1 premium property per city.
2. **Reuse before adding:** check if an existing field/flag can express "launch-featured"
   (e.g. a curated allow-list) before introducing anything. Prefer a small, explicit
   **allow-list of property ids** (config or a lightweight flag) — deterministic, controllable,
   reversible — over any algorithmic guess.
3. Apply the filter **only at the customer-facing surface(s)** (the feed/listing read), as an
   EXTRA constraint layered on top of the existing gate — without editing the existing
   feed-gate rule logic. Admin/partner/data untouched.
4. **Review the picked list with the owner** before it goes live (no blind selection).
5. Implement → live SQL round-trip verify (0 leftover) → confirm expand = just relax the filter.

## OPEN QUESTIONS (confirm before build)
1. **Cities:** the existing demo cities (Dehradun / Dhanaulti / Manali / Mussoorie / Rishikesh /
   Shimla / …) — is the launch set these existing cities, or a specific list you'll give?
2. **1-per-city = hide the rest?** In a city that currently has several properties, the filter
   shows ONLY the chosen premium one and hides the others (until expansion). Confirm.
3. **"Premium" definition:** use existing signals (type = resort/villa + 5–15 rooms + star/score)
   to pick, then you approve the final list? Or you'll name the exact property per city?
4. **Filter scope:** customer feed only (hotels list / discover / Circle browse), right? Admin
   and partner keep seeing everything.

**Next action:** confirm the 4 questions → build session: map inventory → propose the exact
1-per-city list + filter mechanism → owner approves → implement (additive, reversible).
