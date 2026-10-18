import { useEffect, useState, type ReactNode } from "react";
import {
  type DashboardData,
  TASK_STATUSES,
  leaseLabel,
  money,
  shortId,
  stripeLink,
  time,
} from "./data";
import type { MarketData } from "./market";
import { useDashboard } from "./useDashboard";
import { Buyer } from "./Buyer";
import { BrandOrb } from "../../dashboard/src/components/brand-orb";

function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function statusTone(status: string) {
  return ["APPROVED", "ACTIVE", "CAPTURED"].includes(status)
    ? "good"
    : ["REJECTED", "SUSPENDED"].includes(status)
      ? "bad"
      : ["RUNNING", "JUDGING", "PAYLOAD_READY", "HELD", "PAID"].includes(status)
        ? "warm"
        : "";
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark">↗</span>
      <p>{children}</p>
    </div>
  );
}
function Title({
  n,
  title,
  detail,
}: {
  n: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="section-title">
      <h2>
        <span>{n}</span>
        {title}
      </h2>
      <p>{detail}</p>
    </div>
  );
}

export function DashboardView({
  data,
  now,
  filter,
  search,
  market,
}: {
  data: DashboardData;
  now: number;
  filter: string;
  search: string;
  market?: MarketData;
}) {
  const tasks = data.tasks.filter(
    (t) =>
      (filter === "ALL" || t.status === filter) &&
      [t.task_id, t.seller_id, ...t.allowed_models].some((v) =>
        v?.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const total = Object.values(data.counts).reduce<number>(
    (n, v) => n + (v ?? 0),
    0,
  );
  const count = (...statuses: string[]) =>
    statuses.reduce((n, s) => n + (data.counts[s] ?? 0), 0);
  return (
    <>
      {data.db === "memory" && (
        <div role="status" className="error">
          <strong>MEMORY · TEMPORARY DEMO DATA</strong>
          <span>Development and test data only. Records disappear when this server restarts.</span>
        </div>
      )}
      <div className="stats">
        {[
          ["Total tasks", total, "Across the marketplace"],
          [
            "In progress",
            count(
              "CLAIMED",
              "PAYLOAD_READY",
              "RUNNING",
              "SUBMITTED",
              "JUDGING",
            ),
            "Compute → review",
          ],
          ["Approved", count("APPROVED"), "Verified by the judge"],
          [
            "Active sellers",
            data.sellers.filter((s) => s.status === "ACTIVE").length,
            "In the latest 50 sellers",
          ],
        ].map(([label, value, hint], i) => (
          <div className="stat" key={label}>
            <div className="stat-label">
              {label}
              <span>0{i + 1}</span>
            </div>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="state-strip" aria-label="Counts by task state">
        {TASK_STATUSES.map((s) => (
          <span key={s}>
            <i className={statusTone(s)} />
            {s}
            <b>{data.counts[s] ?? 0}</b>
          </span>
        ))}
      </div>
      <section id="jobs" className="panel">
        <Title n="01" title="Buyer jobs" detail="Parts grouped by public job ID · original answers stay private" />
        {data.jobs.length ? <div className="job-grid">{data.jobs.map(job => {
          const children = data.tasks.filter(task => task.job_id === job.job_id).sort((a,b) => (a.part_key ?? "").localeCompare(b.part_key ?? "", undefined, {numeric:true}));
          const latest = children.filter(task => !children.some(other => other.part_key === task.part_key && (other.attempt ?? 1) > (task.attempt ?? 1)));
          return <article className="record" key={job.job_id}>
            <div className="record-top"><code>{job.job_id}</code><Badge tone={job.status === "COMPLETE" ? "good" : job.status === "PARTIAL_FAILURE" ? "bad" : "warm"}>{job.status}</Badge></div>
            <p>{job.progress.approved} / {job.progress.parts} approved · {job.progress.failed_latest} failed · {job.progress.open + job.progress.in_progress} pending</p>
            <div className="amounts"><span>Budget <b>{money(job.budget_cents)}</b></span><span>Reserved <b>{money(job.reserved_cents)}</b></span><span>Spent <b>{money(job.spent_cents)}</b></span></div>
            <ul className="job-parts">{latest.map(part => <li key={part.task_id}>
              <div><code>{part.part_key}</code> · attempt {part.attempt ?? 1} · offer {money(part.price_cents ?? part.max_price_cents)}</div>
              <div><Badge tone={statusTone(part.status)}>{part.status}</Badge> <code>{part.task_id}</code></div>
              <small>Seller / computer: {part.seller_id ? (data.sellers.find(seller => seller.seller_id === part.seller_id)?.display_name ?? "Name unavailable") : "Unclaimed"} · <code>{part.seller_id ?? "—"}</code></small>
            </li>)}</ul>
            {latest.length < job.progress.parts && <p className="muted">Only {latest.length} parts are in the latest task window. Totals include all parts.</p>}
            <small>Server approval counts shown. The buyer separately verifies commitments and aggregates the answers.</small>
          </article>;
        })}</div> : <Empty>No parent jobs yet. Use the buyer CLI to plan bounded independent parts.</Empty>}
      </section>
      <section id="tasks" className="panel task-panel">
        <Title
          n="02"
          title="Task board"
          detail={`Showing ${tasks.length} of the latest ${data.tasks.length} tasks · USD test amounts`}
        />
        {tasks.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Task / allowed models</th>
                  <th>State</th>
                  <th>Task offer</th>
                  <th>Selected seller</th>
                  <th>Lease left</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.task_id}>
                    <td>
                      <code title={t.task_id}>{t.task_id}</code>
                      <small>{t.allowed_models.join(" · ")}</small>
                    </td>
                    <td>
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                      {t.review && <small>Review {t.review.status}{t.review.attempts > 0 ? ` · retry count ${t.review.attempts}` : ""}</small>}
                      {t.replacement_status && t.replacement_status !== "NOT_NEEDED" && <small>Replacement {t.replacement_status}</small>}
                    </td>
                    <td>
                      <strong>{money(t.price_cents ?? t.max_price_cents)}</strong>
                      <small>{t.seller_id ? "Accepted by seller" : "Claim accepts this offer"}</small>
                    </td>
                    <td>
                      <span title={t.seller_id ?? ""}>
                        {data.sellers.find((s) => s.seller_id === t.seller_id)
                          ?.display_name ?? shortId(t.seller_id)}
                      </span>
                      <small>{t.model_id ?? "Waiting for a match"}</small>
                    </td>
                    <td className="mono">
                      {leaseLabel(t.status, t.lease_expires_at, now)}
                    </td>
                    <td>
                      <Badge
                        tone={
                          t.payment.mode === "mock"
                            ? "warm"
                            : statusTone(t.payment.state)
                        }
                      >
                        {t.payment.mode === "mock"
                          ? `MOCK · ${t.payment.state}`
                          : `${t.payment.mode === "mpp" ? "MPP · STRIPE_TEST" : "STRIPE_TEST"} · ${t.payment.state}`}
                      </Badge>
                      {stripeLink(t.payment.stripe_payment_intent_id) && (
                        <a
                          className="payment-link"
                          href={stripeLink(t.payment.stripe_payment_intent_id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.payment.stripe_payment_intent_id} ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            {data.tasks.length
              ? "No tasks match these filters."
              : "The next task starts with an agent. Connect a buyer to the marketplace to get things moving."}
          </Empty>
        )}
      </section>
      <section id="market" className="panel">
        <Title n="03" title="Market observations" detail={market ? `${market.sample_count} recent task offers · updated ${time(market.generated_at)}` : "Observations unavailable"} />
        <p className="market-note">Comparable model sets and runtime limits only. Sampled prices do not establish equilibrium or change your budget.</p>
        {market?.groups.length ? <div className="table-scroll"><table><thead><tr><th>Models / runtime limit</th><th>Sample</th><th>Accepted offer median</th><th>Claim / expiry rate</th><th>Median fill time</th></tr></thead><tbody>{market.groups.map((group,index)=><tr key={index}>
          <td>{group.allowed_models.join(" · ")}<small>{group.max_runtime_s}s limit</small></td>
          <td>{group.accepted_count} accepted / {group.sample_count} posted<small>{group.approved_count} approved · {group.sample_status === "insufficient_data" ? "Insufficient data" : "Observed sample"}</small></td>
          <td>{group.sample_status === "insufficient_data" ? "Insufficient data (<5 accepted)" : money(group.accepted_price_cents.median)}</td>
          <td>{Math.round(group.claim_rate*100)}% / {Math.round(group.expiry_rate*100)}%</td>
          <td>{group.fill_time_ms.median === null ? "Unknown" : `${(group.fill_time_ms.median/1000).toFixed(1)}s`}<small>{group.fill_time_sample_count} measured fills</small></td>
        </tr>)}</tbody></table></div> : <Empty>Insufficient data. Task offers remain explicit buyer choices.</Empty>}
      </section>
      <section id="sellers" className="panel">
        <Title
          n="04"
          title="Compute network"
          detail="Model availability and runner identity are self-reported"
        />
        {data.sellers.length ? (
          <div className="seller-grid">
            {data.sellers.map((s) => (
              <article className="seller" key={s.seller_id}>
                <div className="seller-heading">
                  <div className="seller-avatar">
                    {s.display_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3>{s.display_name}</h3>
                    <code title={s.seller_id}>{shortId(s.seller_id)}</code>
                  </div>
                  <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                </div>
                <div className="runtime">
                  <Badge
                      tone={s.runner.key_source === "none" ? "" : s.runner.runtime === "wassette" ? "good" : "bad"}
                  >
                    {s.runner.key_source === "none" ? "Awaiting runner setup" : s.runner.runtime === "wassette"
                      ? "● wassette"
                      : "● node-unsandboxed · UNSANDBOXED"}
                  </Badge>
                </div>
                <div className="models">
                  {!s.models.length && <small>No models advertised yet</small>}
                  {s.models.map((m) => (
                    <div key={m.model_id}>
                      <code>{m.model_id}</code>
                      <strong>
                        <small>Accepts task offers</small>
                      </strong>
                    </div>
                  ))}
                </div>
                <dl className="runner-details">
                  <div>
                    <dt>Runner key</dt>
                    <dd>
                      <code>{s.runner.public_key?.key_id ?? "Not registered"}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Key source</dt>
                    <dd>{s.runner.key_source === "per-claim"
                      ? "Latest claim"
                      : s.runner.key_source === "registered"
                        ? "Seller registration"
                        : "No claim key yet"}</dd>
                  </div>
                  <div>
                    <dt>Wasm SHA-256</dt>
                    <dd>
                      <code title={s.runner.wasm_sha256 ?? ""}>
                        {s.runner.wasm_sha256
                          ? `${s.runner.wasm_sha256.slice(0, 16)}…`
                          : "Not reported"}
                      </code>
                    </dd>
                  </div>
                </dl>
                <div className="reputation">
                  <span>
                    <b>{s.reputation.approvals}</b> approved
                  </span>
                  <span>
                    <b>{s.reputation.rejections}</b> rejected
                  </span>
                  <span className={s.reputation.strikes ? "text-bad" : ""}>
                    <b>{s.reputation.strikes}</b> strikes
                  </span>
                </div>
                <small className="last-seen">
                  Last seen {time(s.last_seen)}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <Empty>
            No sellers registered yet. Start a seller daemon on a machine with a
            supported Ollama model.
          </Empty>
        )}
      </section>
      <div className="lower-grid">
        <section id="settlements" className="panel">
          <Title
            n="05"
            title="Review & settlement"
            detail="Judge decisions and test-mode accounting"
          />
          {data.verdicts.length || data.settlements.length ? (
            <div className="records">
              {[
                ...new Set([
                  ...data.verdicts.map((v) => v.task_id),
                  ...data.settlements.map((s) => s.task_id),
                ]),
              ].map((id) => {
                const v = data.verdicts.find((v) => v.task_id === id),
                  s = data.settlements.find((s) => s.task_id === id);
                return (
                  <article className="record" key={id}>
                    <div className="record-top">
                      <code title={id}>{shortId(id)}</code>
                      <Badge
                        tone={
                          v?.verdict === "APPROVE" ? "good" : v ? "bad" : ""
                        }
                      >
                        {v?.verdict ?? "AWAITING VERDICT"}
                      </Badge>
                    </div>
                    <p>
                      {v?.reason_code.replaceAll("_", " ") ??
                        "No verdict recorded"}
                    </p>
                    {s ? (
                      <>
                        <div className="amounts">
                          <span>
                            Seller owed <b>{money(s.payout_owed_cents ?? s.seller_payout_cents)}</b>
                          </span>
                          <span>Transferred <b>{s.payout_transferred_cents === undefined ? "Unconfirmed" : money(s.payout_transferred_cents)}</b></span>
                          <span>
                            Buyer refund <b>{money(s.buyer_refund_cents)}</b>
                          </span>
                        </div>
                        <div className="record-bottom">
                          <Badge tone={s.kind === "MOCK" ? "warm" : ""}>
                            {s.kind === "MPP" ? "MPP · STRIPE_TEST" : s.kind}
                          </Badge>
                          <span>{s.finalized_at ? "Buyer settlement final" : "Finalization unconfirmed"}</span>
                        </div>
                        {s.transfer_state === "PENDING" && <p className="onboarding">Seller transfer pending · owed, not paid{s.transfer_retry_at ? " · retry scheduled" : ""}</p>}
                        {s.transfer_state === "TRANSFERRED" && <p className="muted">Seller transfer confirmed</p>}
                        {s.pendingOnboarding && s.transfer_state !== "TRANSFERRED" && (
                          <p className="onboarding">
                            PENDING_ONBOARDING · Seller transfer awaits account
                            onboarding.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="muted">Settlement not recorded yet.</p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty>Judged tasks and settlements will appear here.</Empty>
          )}
        </section>
        <section id="events" className="panel">
          <Title
            n="06"
            title="Event stream"
            detail="Latest 60 events · local time"
          />
          {data.events.length ? (
            <ol className="timeline">
              {data.events.map((e) => (
                <li key={e.id}>
                  <span className="event-dot" />
                  <div>
                    <strong>{e.type}</strong>
                    <code title={e.task_id ?? ""}>
                      {e.task_id ? shortId(e.task_id) : "Marketplace"}
                    </code>
                  </div>
                  <time dateTime={e.created_at}>{time(e.created_at)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>Waiting for the first marketplace event.</Empty>
          )}
        </section>
      </div>
    </>
  );
}

export function App() {
  const hosted = import.meta.env.MODE === "hosted";
  const base = hosted ? window.location.origin :
    import.meta.env.VITE_MARKETPLACE_BASE_URL || "http://localhost:3000";
  const { data, market, error, updated, refresh } = useDashboard(base);
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const stale = !!error || (!!updated && now - updated > 12000);
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to marketplace activity
      </a>
      <aside className="sidebar">
        <a className="brand" href="#main">
          <BrandOrb />
          <span>
            <b>HANDOFF</b>
          </span>
        </a>
        <div className="nav-label">OBSERVATORY</div>
        <nav aria-label="Dashboard sections">
          <a href="#buyer">＋ <span>{hosted ? "Buyer access" : "Submit a task"}</span><span>BUY</span></a>
          <a href="#jobs">▤ <span>Buyer jobs</span><span>01</span></a>
          <a href="#tasks">▦ <span>Task board</span><span>02</span></a>
          <a href="#market">↗ <span>Market observations</span><span>03</span></a>
          <a href="#sellers">◈ <span>Compute network</span><span>04</span></a>
          <a href="#settlements">⇄ <span>Settlements</span><span>05</span></a>
          <a href="#events">≋ <span>Event stream</span><span>06</span></a>
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">BUILT FOR AGENTS</span>
          <p>
            Idle compute.
            <br />
            Useful work.
          </p>
          <small>
            Public metadata only.
            <br />
            Private tasks stay off this board.
          </small>
        </div>
        <div className="sidebar-footer">
          HANDOFF / OCT 2026 <span>↗</span>
        </div>
      </aside>
      <main id="main">
        <header className="topbar">
          <span>NETWORK / OVERVIEW</span>
          <div role="status" className={`connection ${stale ? "offline" : ""}`}>
            <i />
            {error
              ? "Connection interrupted"
              : data
                ? stale
                  ? "Data delayed"
                  : "Live · refreshes every 3s"
                : "Connecting to marketplace"}
          </div>
        </header>
        <div className="page-heading">
          <div className="eyebrow">THE AGENT LABOR MARKET</div>
          <div className="heading-row">
            <h1>
              Compute, put to work<span>.</span>
            </h1>
            <Badge tone={data?.payments.mode === "mock" ? "warm" : ""}>
              {data
                ? data.payments.mode === "mock"
                  ? "MOCK · SIMULATED PAYMENTS"
                  : data.payments.mode === "mpp"
                    ? "MPP · STRIPE TEST MODE"
                    : "STRIPE TEST MODE"
                : "PAYMENT MODE UNCONFIRMED"}
            </Badge>
          </div>
          <p>
            Follow tasks from an open listing to a judged result and a settled
            payment.
          </p>
          <a className="buyer-entry" href="#buyer">{hosted ? "Buyer access" : "Submit a task"} →</a>
        </div>
        <Buyer hosted={hosted} />
        <div className="toolbar">
          <div className="filters">
            <label>
              <span className="sr-only">Search tasks, sellers, or models</span>
              <input
                type="search"
                placeholder="Search task, seller, or model…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">Filter by state</span>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="ALL">All task states</option>
                {TASK_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <button onClick={refresh}>↻ Refresh</button>
        </div>
        {error && (
          <div role="alert" className="error">
            <strong>{error}</strong>
            <span>
              {data
                ? "Showing the last successful snapshot; counts and payments may have changed."
                : "No marketplace data loaded. Automatic retries continue every 3 seconds."}
            </span>
          </div>
        )}
        {data ? (
          <DashboardView
            data={data}
            market={market}
            now={now}
            filter={filter}
            search={search}
          />
        ) : (
          !error && (
            <div className="loading" role="status">
              <span className="loader" />
              Loading marketplace activity…
            </div>
          )
        )}
        <section className="trust-panel">
          <div>
            <span className="tiny-label">WHAT YOU ARE LOOKING AT</span>
            <h2>
              Open activity.
              <br />
              An explicit trust boundary.
            </h2>
          </div>
          <div>
            <p>
              “It is <strong>not a TEE</strong>. The seller’s OS can read the
              Wasm instance’s memory and the Ollama process sees prompt tokens.”
            </p>
            <p>
              Wassette limits access to files and network resources. Runtime
              badges are self-reported, and model identities are not remotely
              attested. The marketplace operator holds buyer keys; the judge
              receives the task and result.
            </p>
            <small>
              From docs/SECURITY.md · Stripe payments are test mode. MOCK means
              simulated accounting. A recorded payout may still await seller
              onboarding.
            </small>
          </div>
        </section>
        <footer>
          <span>
            HANDOFF <b>↗</b>
          </span>
          <span>
            {updated
              ? `Last received ${time(new Date(updated).toISOString())}${stale ? " · STALE" : ""}`
              : "Awaiting first snapshot"}
          </span>
        </footer>
      </main>
    </div>
  );
}
