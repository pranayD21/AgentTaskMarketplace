# Cost ledger — buyer cost vs system resource cost (B1, owner D)

Two views, never mixed. The marketplace price a buyer pays is **revenue to the seller and spend for the buyer**; it is not a resource. Resources are energy, hardware time, hosted services, judge tokens and payment-processing fees. Counting the 75c transfer in both views would double-count it, so the system view excludes it by construction.

All money is USD. Every rate below names its source and fetch date. **Anything not measured is `unknown`, never 0**: a per-task total is then reported as "≥ known subtotal, missing: …". The 75-cent Stripe TEST price is a demo setting, not a measured inference cost, and must not be read as one.

## 1. Definitions

| symbol | meaning | owner of the measurement |
|---|---|---|
| `N_ok` | tasks that ended `APPROVED` with `commitment_verified = true` in the window | A (DB) |
| `N_att` | attempts in the window: every claim, including released, expired, `REJECTED` and retried ones | A |
| `P_i` | marketplace price settled for task *i* (`settlements.seller_payout_cents`) | D |
| `R_i` | refund/release back to the buyer for task *i* (`buyer_refund_cents`) | D |
| `T_buyer,i` | buyer-side LLM tokens to decide, post, poll and read task *i* (controller/baseline calls) | B |
| `T_judge,i` | judge tokens per attempt, including every retry and the replacement answer | E |
| `t_inf,i`, `t_load,i` | seller inference and model-load wall time per attempt | C |
| `E_i` | seller energy per attempt (Wh), measured at the wall or `powermetrics`, else an **estimate labelled as such** | C |
| `H_hw` | stated hardware amortization rate ($/h) for the seller machine; `unknown` until the operator states it | C |
| `U_host` | hosted MCP requests, build minutes, egress; DB usage | A |
| `F_i` | payment-processing fees the platform would pay for task *i* on a live rail | D |

## 2. The two views

**Buyer cost per successful task** (what the buyer's human paid for):

```
BuyerCost = Σ_i (P_i − 0)            ← price actually settled to sellers (refunds R_i are returned, so excluded)
          + Σ_i cost(T_buyer,i)      ← the buyer agent's own model calls, at the buyer's model rate
          + Σ_i fee_buyer,i          ← fees the rail charges the *buyer* (0 on both rails today)
BuyerCost / N_ok
```

**System resource cost per successful task** (what it took to produce the accepted answers):

```
SystemCost = Σ_att (E_a · p_elec + t_a · H_hw)      ← seller energy and amortized hardware, every attempt
           + Σ_att cost(T_judge,a)                   ← judge + replacement + retries
           + U_host · rates + DB plan share           ← hosting
           + Σ_i F_i                                  ← payment-processing fees (platform side)
SystemCost / N_ok
```

**Allocation rule for failed attempts (declared):** every attempt's resource cost is charged to the successful tasks of the same window (`SystemCost / N_ok`), and the per-attempt figure (`SystemCost / N_att`) is reported beside it so the retry burden is visible. A rejected seller's inference is a system cost even though the buyer paid nothing for it.

## 3. Rates (official sources, fetched 2026-10-17)

| item | rate | source |
|---|---|---|
| Judge model `claude-opus-5-5` (default `JUDGE_MODEL`) | input $4 / MTok, output $20 / MTok, cache hit $0.20, 5-min cache write $5; batch 50% off | https://platform.claude.com/docs/en/about-claude/pricing |
| Alternative judge `claude-sonnet-5-5` | $2 / $10 per MTok | same |
| Cheapest judge `claude-haiku-5-5` (≤100k prompt) | $0.10 / $0.50 per MTok | same |
| Buyer controller (Armature run used Codex/GPT-5.6; Claude Code runs use the buyer's plan) | buyer's own rate; **unknown** unless B records model + tokens | B's harness |
| Stripe card (both rails; MPP/Link cards are the same rate) | 2.9% + 30¢ per successful charge; +1.5% international, +1% FX | https://stripe.com/pricing |
| Stripe refunds | no refund fee, but the original charge fee is not returned (so a refunded max-price hold costs the fee anyway) | https://stripe.com/pricing (Refunds section) |
| Stripe Connect transfers to a connected account | no per-transfer fee; payouts to the seller's bank: "No fee" when Stripe handles pricing, else 0.25% + 25¢ per payout and $2 per monthly active account; Instant Payouts 1% | https://stripe.com/connect/pricing |
| Electricity (U.S. average residential, July 2026, preliminary) | 18.31 ¢/kWh | https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a |
| Manufact hosting (the MCP server) | Free $0 with $5 credits, Hobby $30/mo with $30 credits; requests $0.10 per 1,000 (MCP tool calls count, discovery does not), build minutes $0.07, egress $0.15/GB; 1 credit = $0.01 | https://manufact.com/pricing.md, https://docs.manufact.com/dashboard/billing |
| InsForge (Postgres + admin API) | Free $0 (500 MB DB, 5 GB bandwidth); Pro $25/mo ($20 yearly) with $10 compute credits, overages $0.125/GB DB, $0.09/GB bandwidth | https://insforge.dev/pricing |
| Seller machine power under inference | **estimate** 30–40 W whole-system for an M4 Pro (Mac mini measurements from secondary sources; no first-party MacBook Pro M4 Pro figure found) — replace with `powermetrics` or wall readings | secondary; see B1 plan |

Rates are checked again when B runs the protocol; prices change.

## 4. What the current code already records (and what it does not)

| field | where | status |
|---|---|---|
| `price_cents`, `max_price_cents`, `seller_payout_cents`, `buyer_refund_cents`, `stripe_capture_id`, `stripe_transfer_id` | `tasks`, `settlements` | **measured** on every settlement |
| `runtime_ms`, `tokens_out` | `results` | **measured** by the seller runner (Ollama `eval_count`; input tokens not stored) |
| seller input tokens, load time, energy, hardware | – | **unknown** (C to add to the usage record) |
| judge input/output/cache tokens, retries, replacement-answer tokens | – | **unknown** (E; `contains_text` rubrics make 0 judge calls, `llm_rubric` ones are unrecorded) |
| buyer controller tokens | – | **unknown** (B's harness) |
| hosted requests per task | Manufact dashboard | countable per run (Armature accepted case: 9 buyer calls); seller ≈ 6, judge ≈ 2 per attempt |

## 5. Worked example — one `contains_text` task on 2026-10-18, card rail, Stripe TEST

Measured: `task_c611df0772356b56`, qwen3:8b on this M4 Pro, Node runtime, `runtime_ms 5047–5677`, `tokens_out 2–3`, price 75c, hold 100c, refund 25c, transfer 75c, 0 judge model calls (deterministic rubric), ~17 MCP requests across buyer/seller/judge.

| line | buyer view | system view | basis |
|---|---|---|---|
| marketplace price | **$0.75** | – (internal transfer) | measured (TEST) |
| buyer controller tokens | unknown | – | not recorded |
| seller energy | – | ≈ **$0.00001** (35 W × 5.5 s = 0.053 Wh × 18.31 ¢/kWh) | **estimate** (power), measured (time) |
| hardware amortization | – | unknown (`H_hw` not stated) | – |
| judge tokens | – | $0 for this rubric; an `llm_rubric` call of ~800 in / 200 out on Opus 5.5 would be ≈ **$0.0072** | measured rubric kind; token counts unknown |
| hosting | – | ≈ **$0.0017** requests (17 × $0.10/1,000) + plan share (Free $0, or Hobby $30 ÷ monthly tasks) | rate; volume per month unknown |
| database | – | Free $0, or Pro $25 ÷ monthly tasks | rate; volume unknown |
| Stripe fee if live | $0 to buyer | **$0.32** (2.9% × $0.75 + $0.30; the 30¢ is not returned on the 25c release) | rate (TEST pays $0) |
| **per successful task** | **≥ $0.75 (missing: buyer tokens)** | **≥ $0.32 (missing: hardware, judge/seller tokens, plan shares)** | – |

Reading: at a 75c price point the fixed 30¢ card fee is ~40% of the price. For sub-dollar tasks a real deployment must batch (one charge per job or per day) or use a balance-based rail; this is a finding for F1 budgets, not a reason to pretend the fee is zero. Energy for a 5-second local inference is negligible next to fees and hosting.

## 6. Ledger record (proposed fields for A's shared usage schema)

One record per **attempt** (`claim_id`), with `task_id`, `job_id` (F1), `outcome ∈ {APPROVED, REJECTED, RELEASED, EXPIRED}`:

```
seller:   model_id, model_digest, runtime, tokens_in, tokens_out, load_ms, inference_ms, energy_wh (+ energy_method: measured|estimated|unknown), hardware_id, hw_rate_usd_per_h
judge:    model, calls, tokens_in, tokens_out, cache_read, cache_write, retries, replacement_tokens_out
buyer:    controller_model, tokens_in, tokens_out, mcp_calls
host:     mcp_requests, egress_bytes, build_minutes
payment:  rail, max_price_cents, price_cents, refund_cents, transfer_cents, transfer_state, fee_cents_if_live, fee_basis
```

Missing numeric fields are `null` (unknown), never `0`. D reconciles the `payment:` block from `settlements` and the Stripe objects; D computes both views from the merged records and publishes them in `docs/buyer/` with B's report.

## 7. Uncertainty

- Energy: ±30% until measured at the wall (chassis and thermal state matter).
- Fees: exact for Stripe's published US rates; MPP/Link pricing is the card rate today and may change in preview.
- Hosting/DB: plan-share terms depend on monthly volume; report the marginal (per-request) and the plan-share figures separately.
- Token prices: taken from the official page on 2026-10-17; the Claude 4.7+ tokenizer yields ~30% more tokens for the same text (official note), so token counts must come from API usage fields, not estimates.
