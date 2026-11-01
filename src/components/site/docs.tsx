"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, ExternalLink, Search, Sparkles } from "lucide-react";

type Sec = { id: string; title: string; group: string; body: ReactNode };

const STAGES = [
  ["Reconnaissance", "Latin-hypercube personas, replicate probes for noise, a validation set for monitoring and a sealed test set."],
  ["Sensitivity screening", "Three-level counterfactual pairs, sign-flip tests, randomized null audits."],
  ["Structure probing", "Dose-response sweeps, BIC model comparison, bisection, confirmation."],
  ["Interaction testing", "2×2 factorials with difference-in-differences; proportional effects rejected."],
  ["Active learning", "Ensemble disagreement × diversity chooses the next 16 probes."],
  ["Synthesis", "CART surrogate scored once on the sealed test set; Reporter compiles the Hidden Rulebook."],
];

const SECTIONS: Sec[] = [
  {
    id: "workflow",
    group: "Getting started",
    title: "End-to-end workflow",
    body: (
      <>
        <p>AUTOPSY answers one question: how does this decision system behave? It answers using only the system&rsquo;s inputs and outputs. An investigation moves through six deterministic phases. Each phase spends part of a fixed query budget and decides what the next phase should ask.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {STAGES.map(([t, d], i) => (
            <div key={t} className="s-panel-sm">
              <div className="s-label-accent">STAGE 0{i + 1}</div>
              <div className="mt-2 text-[16px] text-white">{t}</div>
              <div className="s-small mt-1.5">{d}</div>
            </div>
          ))}
        </div>
      </>
    ),
  },
  {
    id: "first-run",
    group: "Getting started",
    title: "Your first investigation",
    body: (
      <>
        <p>Open the Lab, choose a target, and set a query budget between 400 and 2,000. Larger budgets allow more replication, finer threshold localization and more active-learning rounds.</p>
        <ul>
          <li>
            <b className="text-white">Launch</b> starts the agents immediately. <b className="text-white">Stage</b> opens the workspace first so you can choose a pace.
          </li>
          <li>Pace changes only how the run is displayed: Cinematic, Standard or Max. The statistics are identical at every pace.</li>
          <li>Pause, resume or cancel from the workspace header. A cancelled run still publishes a partial rulebook built from the experiments it finished.</li>
        </ul>
      </>
    ),
  },
  {
    id: "workspace",
    group: "Getting started",
    title: "Reading the workspace",
    body: (
      <>
        <p>Every view in the workspace reads the same investigation state, so a selection in one view always matches the others.</p>
        <ul>
          <li>Laboratory: a canvas of inputs, the black box, agents and hypotheses, plus a terminal, a query stream and a task ledger.</li>
          <li>Agents: a live handoff diagram and an execution timeline listing each agent&rsquo;s recorded operations.</li>
          <li>Experiments: controlled pairs, sweeps and factorials, with an input diff and a probe composer.</li>
          <li>Hypotheses: a force-directed evidence graph that sets competing explanations side by side.</li>
          <li>Active learning, Surrogate and Rulebook: uncertainty fields, what-if verification, and the published findings.</li>
        </ul>
      </>
    ),
  },
  {
    id: "query-api",
    group: "Reference",
    title: "Query API",
    body: (
      <>
        <p>Targets are ordinary HTTP endpoints. The schema is public; the decision logic runs only on the server.</p>
        <div className="s-codebox mt-5">
          <div>
            <span className="c"># list public schemas</span>
          </div>
          <div>
            <span className="pk">GET</span> /api/targets
          </div>
          <div className="mt-3">
            <span className="c"># query up to 64 inputs per call</span>
          </div>
          <div>
            <span className="pk">POST</span> /api/targets/meridian-credit/query
          </div>
          <div>{`{ "inputs": [{ "income": 90000, "dti": 0.3, "credit_age": 60,`}</div>
          <div>{`    "inquiries": 1, "employment": "salaried", "region": "rural",`}</div>
          <div>{`    "age": 40, "has_mortgage": "no" }] }`}</div>
          <div className="mt-3">
            <span className="c"># → 200</span>
          </div>
          <div>{`{ "outputs": [16250], "receipt": { "id": "q_…", "latencyMs": 35 } }`}</div>
        </div>
        <ul>
          <li>Invalid fields return 422 with the offending index, and batches over 64 inputs return 413.</li>
          <li>Responses are stochastic. Identical inputs can differ slightly, which is why the engine measures noise first.</li>
        </ul>
      </>
    ),
  },
  {
    id: "connect",
    group: "External targets",
    title: "Connect a black box: the API contract",
    body: (
      <>
        <p>
          AUTOPSY can investigate any HTTPS endpoint that takes <b className="text-white">structured numeric or categorical inputs</b> and returns <b className="text-white">one numeric output</b> per input: credit limits, prices, premiums, candidate, fraud or ranking scores. Text generation, images, stateful systems and classification labels are future extensions. Define the target on the{" "}
          <Link href="/connect" className="text-white underline underline-offset-4">
            Connect page
          </Link>
          .
        </p>
        <div className="s-codebox mt-5">
          <div>
            <span className="c"># batch mode (preferred): up to 64 inputs per request</span>
          </div>
          <div>
            <span className="pk">POST</span> https://your-api.example.com/score
          </div>
          <div>{`{ "inputs": [ { "income": 52000, "segment": "b" }, … ] }`}</div>
          <div>
            <span className="c"># → 200, one number per input, same order</span>
          </div>
          <div>{`{ "outputs": [ 61.5, … ] }          output path: outputs`}</div>
          <div>{`{ "data": [ { "score": 61.5 }, … ] }  output path: data[*].score`}</div>
          <div className="mt-3">
            <span className="c"># single-input mode: one input per request (AUTOPSY sends 4 in parallel)</span>
          </div>
          <div>{`{ "input": { "income": 52000, "segment": "b" } }`}</div>
          <div>{`{ "result": { "score": 61.5 } }       output path: result.score`}</div>
        </div>
        <ul>
          <li>Outputs must be JSON numbers. Strings such as &quot;61.5&quot;, nulls, a wrong count or invalid JSON stop the query with a readable error.</li>
          <li>Inputs always respect the schema you define: numeric bounds, integer constraints and categorical options.</li>
          <li>An optional credential is sent in a header you name (e.g. <code>x-api-key</code>). Never put credentials in the URL; such URLs are rejected.</li>
          <li>Rate limits: answer HTTP 429 with <code>Retry-After</code>. AUTOPSY retries up to twice per request with backoff, then reports the error.</li>
          <li>Each request has a 10-second timeout and a 1 MB response limit. Redirects are refused; use the final URL.</li>
        </ul>
      </>
    ),
  },
  {
    id: "relay",
    group: "External targets",
    title: "How requests reach your API",
    body: (
      <>
        <p>
          External queries are <b className="text-white">server-mediated</b>: the browser sends inputs to AUTOPSY&rsquo;s <code>/api/proxy</code>, which calls your endpoint. Your API therefore needs no CORS configuration, and the credential is attached as a header on the server.
        </p>
        <ul>
          <li>The credential lives only in the open browser tab&rsquo;s memory. It is never written to local storage, case files, logs or exports, and must be re-entered after a reload.</li>
          <li>SSRF protection: https only; every address the hostname resolves to is checked at connection time, so private, loopback, link-local, carrier-grade NAT, multicast and cloud-metadata addresses are refused even after DNS changes. Redirects are never followed.</li>
          <li>Local development (<code>next dev</code>, or <code>AUTOPSY_ALLOW_PRIVATE_TARGETS=1</code>) additionally allows http:// and localhost, so a teammate&rsquo;s API on your machine can be tested.</li>
          <li>Budget accounting: the budget counts inputs evaluated. HTTP requests, including retries, are counted separately and shown in the workspace. Verification and analyst probes spend the investigation budget; benchmarks spend their own, separately reported queries.</li>
        </ul>
      </>
    ),
  },
  {
    id: "blind-challenge",
    group: "External targets",
    title: "Running a blind challenge",
    body: (
      <>
        <p>A blind challenge tests whether AUTOPSY can describe a system it has never seen. Someone else writes the scoring API and keeps its rules secret.</p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            The author implements the contract above (a ready-to-edit Node server is in <code>examples/blind-challenge-server.mjs</code>; instructions in <code>docs/BLIND_CHALLENGE.md</code>), deploys it on a public HTTPS URL, and shares only the schema, endpoint and credential.
          </li>
          <li>The operator enters that schema on the Connect page, tests the connection and launches an investigation. The engine sees only the schema and responses.</li>
          <li>When the run stops, the operator pastes the author&rsquo;s true rules into <b className="text-white">Reveal ground truth</b> in the rulebook and marks each as recovered, partial or missed.</li>
        </ol>
        <p>
          The bundled <b className="text-white">sample challenge</b> (Loan APR quote) runs the same workflow end to end. Because AUTOPSY&rsquo;s authors wrote it, a good result there demonstrates the workflow; it is not independent validation.
        </p>
      </>
    ),
  },
  {
    id: "verify",
    group: "External targets",
    title: "Testing a finding live",
    body: (
      <ul>
        <li>
          <b className="text-white">Test this finding</b> opens a controlled comparison: a realistic subject the engine already queried, with one field changed by default. Values are editable within the schema.
        </li>
        <li>Baseline and variant are each queried 3, 5 or 10 times, interleaved. The panel reports both means, the mean difference, a Welch 95% interval, a permutation p-value and the sample size.</li>
        <li>Warnings appear when several fields change, values sit at the edge of the documented range, or the base subject was edited into a possibly unrealistic profile.</li>
        <li>Observed sensitivity to an input is not by itself evidence of unfairness or discrimination.</li>
      </ul>
    ),
  },
  {
    id: "demo",
    group: "Getting started",
    title: "Guided demo",
    body: (
      <p>
        <Link href="/demo" className="text-white underline underline-offset-4">
          Start guided demo
        </Link>{" "}
        walks through choose target → investigate → inspect the strongest finding → test it live → export evidence, inside the normal workspace. It shows the target&rsquo;s origin, queries used, elapsed time, supported findings and held-out error. A clearly labelled saved recording is available as a fallback if the network fails; it is never presented as a live run.
      </p>
    ),
  },
  {
    id: "outputs",
    group: "Reference",
    title: "Outputs & exports",
    body: (
      <>
        <p>
          The <b className="text-white">Hidden Rulebook</b> opens with an audit summary (target and origin, main findings with effects, intervals, tests and sample sizes, tested ranges, held-out fit, inconclusive results, inputs flagged for review, limitations and follow-ups), then lists each supported pattern with its evidence. It exports to Markdown and JSON without credentials.
        </p>
        <p>
          The <b className="text-white">surrogate model</b> is a CART tree trained on the engine&rsquo;s own queries. Its R² and MAE on the sealed test set, scored once at the end, describe how well it predicts new responses: predictive fit, not percentage accuracy and not the share of rules recovered.
        </p>
        <p>Case files are saved in this browser&rsquo;s local storage and appear in the Lab registry. Clearing site data removes them.</p>
      </>
    ),
  },
  {
    id: "statistics",
    group: "Research & theory",
    title: "Statistical tests",
    body: (
      <ul>
        <li>Paired effects: a sign-flip permutation test (exact for n ≤ 14) with percentile bootstrap intervals.</li>
        <li>Null claims: the bootstrap interval must fall within ±δ, and the claim must survive a randomized audit on 12 fresh subjects.</li>
        <li>Shape: smooth, step and window models compared by BIC on standardized curves.</li>
        <li>Interactions: difference-in-differences, re-tested on the log scale or as a relative effect under gates.</li>
        <li>Conditional effects: confirmed when several fresh subjects show a large response with the same sign.</li>
        <li>Every test uses α = 0.02 with no family-wise correction. Rules re-tested by a dedicated confirmation experiment on fresh subjects are marked as confirmed.</li>
        <li>The evidence score (0-100) combines p-value, interval width and confirmation. It is a heuristic for ranking, not a calibrated probability that a rule is correct.</li>
        <li>Held-out data is split: a validation set monitors progress during the run; a sealed test set is scored once by the final surrogate. Neither is used to fit models, choose queries or decide when to stop.</li>
      </ul>
    ),
  },
  {
    id: "active",
    group: "Research & theory",
    title: "Active learning",
    body: <p>Each round fits a 12-tree bootstrap ensemble, scores 400 random candidates by ensemble disagreement, and greedily selects 16 diverse ones. The Benchmarks page compares this against random sampling on the same endpoint with equal query counts.</p>,
  },
  {
    id: "limits",
    group: "Research & theory",
    title: "Limits of evidence",
    body: (
      <ul>
        <li>Findings describe observed behavior inside the documented input ranges. Inputs outside those ranges are untested.</li>
        <li>Statistical support does not prove mechanism. A supported rule is the simplest explanation consistent with the controlled evidence.</li>
        <li>Narrow or conditional effects can be missed if the budget is too small. &quot;No detectable effect&quot; means smaller than the noise-adjusted margin within the tested range and budget, not zero.</li>
        <li>The ten built-in targets and the sample challenge are synthetic demonstrations, not real organizations&rsquo; policies and not real-world validation.</li>
        <li>Findings are supported behavioral patterns, not a recovery of source code. External APIs may change over time; findings describe the session in which they were observed.</li>
        <li>Flagging a sensitive input highlights it for human review. It is not a finding of discrimination or of a legal violation.</li>
      </ul>
    ),
  },
];

export function DocsView() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(SECTIONS[0].id);
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);
  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  const match = (s: Sec) => !q.trim() || s.title.toLowerCase().includes(q.trim().toLowerCase()) || s.group.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <div className="s-wrap s-docs">
      <aside className="s-docs-side" aria-label="Documentation">
        <label className="s-search !rounded-2xl">
          <Search size={15} className="text-[var(--s-fg-3)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documentation…" aria-label="Search documentation" />
        </label>
        {groups.map((g) => (
          <div key={g}>
            <h5>{g}</h5>
            {SECTIONS.filter((s) => s.group === g && match(s)).map((s) => (
              <a key={s.id} href={`#${s.id}`} className={`s-doc-link${active === s.id ? " is-active" : ""}`}>
                {s.title}
              </a>
            ))}
          </div>
        ))}
        <div className="s-panel-sm mt-8">
          <div className="flex items-center gap-2 text-[13px] pk">
            <Sparkles size={14} /> Interactive investigation lab
          </div>
          <p className="s-small mt-2">Run all six phases live against a synthetic black box and export the rulebook.</p>
          <Link href="/lab" className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-white">
            Launch the Lab <ChevronRight size={14} />
          </Link>
        </div>
      </aside>

      <main className="s-docs-main min-w-0">
        <div className="s-crumbs">
          <Link href="/" className="inline-flex items-center gap-1.5">
            <ArrowLeft size={13} /> Home
          </Link>
          <ChevronRight size={13} />
          <span>Docs</span>
          <ChevronRight size={13} />
          <span className="pk">{SECTIONS.find((s) => s.id === active)?.title}</span>
        </div>
        <span className="mt-8 inline-flex rounded-full border border-[rgb(255_181_94/0.4)] bg-[rgb(255_181_94/0.08)] px-3 py-1 text-[12px] uppercase tracking-wider pk">end-to-end workflow</span>
        <h1 className="s-h3 mt-4">Investigating a black box with AUTOPSY</h1>
        <p className="!mt-5 s-lede">How to configure a run, read the evidence it produces, and understand exactly what the conclusions do and do not establish.</p>
        <div className="mt-14">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id}>
              <div className="s-label-accent">{s.group}</div>
              <h2 className="mt-2">{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      </main>

      <nav className="s-docs-toc" aria-label="On this page">
        <div className="s-label mb-3 !text-white">On this page</div>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={`s-doc-link${active === s.id ? " is-active" : ""}`}>
            {s.title}
          </a>
        ))}
        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="s-small">See it work:</div>
          <Link href="/demo" className="mt-2 inline-flex items-center gap-1.5 text-[13px] pk">
            Start the guided demo <ExternalLink size={12} />
          </Link>
        </div>
      </nav>
    </div>
  );
}
