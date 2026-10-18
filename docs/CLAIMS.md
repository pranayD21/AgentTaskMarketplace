# HANDOFF: results, claim status and security boundaries

[Judge walkthrough](JUDGES.md) · [Sponsor integrations](SPONSORS.md) · [Documentation](README.md)

This page separates demonstrated behavior, proposed metrics and future architecture. Evidence is tied to dated runs; it does not imply a fresh verification of the current deployment.

## Speed

**Demonstrated:** two physical Macs executed separate parts of one job with 75.1 seconds of overlap. Both returned approved, commitment-verified results. The parts were explicitly prepared; this run proves concurrent execution and settlement, not autonomous decomposition or a speedup against a frontier model. [Evidence](LIVE-C-D.md).

**Requested headline: 30% faster benchmark performance.** No supporting completed marketplace comparison is present in the checked-in report. The bounded benchmark has 12 baseline requests and 12 direct-local requests, with different strict-quality success counts; its marketplace arm is unrun. A partial throughput comparison must not be presented as quality-matched end-to-end acceleration. [Report](buyer/benchmark-report.md).

The measured direct-local throughput was 1.705 completed requests/s versus 1.304/s for the hosted baseline, **30.8% higher throughput on those 12 requests**. Strict-quality successes were 6/12 versus 0/12, and the marketplace arm was unrun. This observation is useful context, but it is not a 30% HANDOFF speedup.

To substantiate the headline, publish matched tasks, models/hardware, quality criteria, sample count, raw timing summaries, retries and queue/judge overhead. Define whether 30% means lower latency or higher throughput; these are different measurements.

## Cost

**Demonstrated:** posted offers, atomic spending reservations, review-gated Stripe TEST settlement, and a completed two-part job at 60 TEST cents per part with zero remaining reservation.

**Requested headline: 53% cheaper inference.** The repository has no complete resource-cost comparison supporting this figure. Marketplace prices and Stripe TEST transfers are not measured inference cost. Local energy, hardware amortization, hosting and judge/replacement usage must be counted or explicitly excluded. [Cost methodology](payments/COST.md), [benchmark protocol](buyer/benchmark-plan.md).

A defensible comparison reports cost per successful task at a matched quality bar and identifies the baseline, pricing date and accounting boundary. Neither proposed percentage is an established project result until that evidence is supplied.

## Security

**Implemented:** local seller execution through Wassette/Wasmtime; deny-by-default network grants; ephemeral per-claim keys; separately sealed buyer/judge results; canonical SHA-256 commitments; public/private data separation; role-gated tools; budget controls; safe public verdict text. [Threat model](SECURITY.md).

Data segmentation here means bounded task payloads and separation of public metadata from private task/result envelopes. It is not secret sharing, an automatic privacy-preserving partitioner, or proof that an individual task contains no sensitive information.

**Requested headline: completely secure using data segmentation and confidential VMs.** The current implementation does not support this claim. Wasm is not a confidential VM. The machine owner can inspect sandbox memory and Ollama inputs; the marketplace operator is trusted and holds relevant keys. Some judge/replacement paths invoke a hosted model provider. A SHA-256 commitment checks integrity, not factual correctness or model identity.

[Confidential VMs, GPU confidential computing and attested key release](X1-CONFIDENTIAL-COMPUTE.md) are a design, not deployed evidence. Even that future implementation needs a stated threat model rather than an absolute security guarantee.

## Agent experience and acceptance

Three Armature scenarios scored 5/5 each, covering an accepted purchase, cap rejection and simulated task-ID recovery. This is three workflow checks, not a general quality benchmark. [Results](ARMATURE-RESULTS.md).

Local chat and Google-linked buying/selling are implemented. The last checked-in acceptance notes still leave a fresh-Mac install, human Google/Stripe completion, a fresh installed-worker task and persistence checks to verify. [Workspace](UNIFIED-WORKSPACE.md), [audit](COMPLETION-AUDIT.md).

## Positioning against frontier services

HANDOFF offers a different execution choice: keep the agent local, buy bounded work from local peers, distribute independent parts and track review plus payment. It can complement a frontier assistant acting as buyer. The repository does not establish universal speed, cost, quality or confidentiality superiority over frontier services.
