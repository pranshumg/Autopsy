# AUTOPSY

AUTOPSY reverse-engineers black-box decision algorithms. Cooperating statistical agents probe a target **only through its HTTP API**. They run controlled experiments, accept or reject hypotheses, and publish what survives as a plain-language **Hidden Rulebook**. Alongside it they build a surrogate model, whose accuracy is measured on sealed held-out queries.

Example questions it answers:

- Does a pricing API charge iPhone users more?
- Is there an age threshold?
- Does a surcharge apply only on weekend nights?
- Is a postcode quietly standing in for income?

## Two engines, one UI

| | Built-in engine (TypeScript) | Python agent engine |
|---|---|---|
| Runs | in the browser (Web Worker) | locally, `backend/` (FastAPI) |
| Targets | 10 synthetic black boxes | Ride Pricing API, Credit Approval Model (a scikit-learn model on UCI German Credit) |
| Agents | 4 deterministic statistical roles | 🎭 Persona, 🧪 Experimenter, 📊 Statistician, 📝 Reporter on a shared SQLite blackboard |
| Extras | connect your own API, blind challenge | DoWhy refuters, proxy detection, Reveal scorecard, active-vs-random benchmark |

The Python targets appear in the Lab, tagged **python agents**, whenever the engine is running. Without the engine, everything else still works.

## Quick start

Requirements: Node 20+, plus [uv](https://docs.astral.sh/uv/) for the Python engine.

```bash
# terminal 1: Python engine + mock targets
cd backend
uv sync
AUTOPSY_TARGET_SEED=1 AUTOPSY_LLM=off uv run python run.py

# terminal 2: website
npm install
npm run dev          # http://localhost:3000
```

Then open **Lab**, pick **Ride Pricing API**, press **Launch investigation**, and when it says COMPLETE open **Rules → Reveal hidden rules**.

## What's in the site

| Page | Use |
|---|---|
| **Lab** | Pick a target, set the query budget and pace, launch an investigation. **Case files** at the bottom keep your past runs in this browser. |
| Workspace tabs (keys 1–7) | Laboratory canvas · Agent command · Experiments · Hypothesis map · Active learning (+ benchmark) · Surrogate model (what-if console, decision surface) · Hidden rulebook (badges, DoWhy refuters, exports, Reveal) |
| **Benchmarks** | Runs every built-in target and compares adaptive vs random sampling. Python targets and connected APIs are opt-in. |
| **Targets / Agents / Method / Docs** | Target catalog, agent architecture, the six-phase method, API contract |
| **Connect** (`/connect`) | Point AUTOPSY at your own HTTPS scoring API through an SSRF-safe relay, or load the sample blind challenge |

## Project layout

| Path | What it is |
|---|---|
| `src/app/` | Next.js App Router pages and API routes (`api/targets`, `api/proxy`, `api/challenge`, `api/engine` = relay to the Python engine) |
| `src/server/` | Built-in targets (hidden rules stay server-side), sample challenge, SSRF-safe proxy |
| `src/lib/engine/` | Built-in investigation engine (Web Worker) and the shared event reducer |
| `src/lib/store.ts` | Zustand store: investigations, case files, connected targets |
| `src/components/` | Landing page, lab workspace and site pages |
| `backend/` | Python multi-agent engine, mock targets and tests; see [`backend/README.md`](backend/README.md) |
| `tests/` | Web tests (Vitest) |

## How an investigation works

1. **Reconnaissance.** Measures the noise floor from repeated queries and seals a held-out test set.
2. **Screening.** Counterfactual pairs: the same persona with exactly one input changed. Each effect gets a sign-flip permutation test and a bootstrap CI, with Benjamini–Hochberg correction across all effects.
3. **Structure.** Sweeps and model comparison decide whether an effect is multiplicative, additive, a threshold, or linear.
4. **Interactions.** 2×2 factorial tests find rules that apply only in combination, such as weekend AND hour ≥ 20.
5. **Active learning.** The remaining budget goes where the evidence is most uncertain.
6. **Synthesis.** Findings are refuted with DoWhy (Python engine) and fitted into a surrogate tree. The Reporter publishes only the rules that survived.

All statistics are computed in code. In the Python engine, a local LLM (Ollama) can optionally write personas and rule sentences; with `AUTOPSY_LLM=off`, seeded samplers and templates are used instead.

## Tests

```bash
npm run typecheck && npm test        # web
cd backend && uv run pytest          # Python
```

## Honest limits

- The targets are synthetic, with known answers, which is what makes scoring possible. You can connect real APIs on `/connect`.
- Pricing target, 500 queries, 10 seeds: about 80% of hidden rules were recovered exactly. The usual miss is the weekend × night interaction.
- The Python engine runs locally only. The hosted website shows the built-in engine.
- Case files live in browser storage (about 5 MB, a handful of runs). Export important runs from the Rules tab.
