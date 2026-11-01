# AUTOPSY engine (Python)

A multi-agent system that reverse-engineers the hidden rules of a black-box
algorithm by probing it from the outside over HTTP, then writes a
plain-language **hidden rulebook**. The existing AUTOPSY web UI (repo root) is
the dashboard.

```
 web UI (Next.js, :3000) ──/api/engine──▶ engine API (FastAPI, :8000)
                                             │  orchestrator routes turns on a blackboard
                                             │  🎭 Persona  🧪 Experimenter  📊 Statistician  📝 Reporter
                                             ▼  HTTP only
                                        mock targets (FastAPI, :8100)
                                        /pricing/quote   /credit/quote
```

## Setup (one time)

```bash
# 1. uv (Python package manager). It also installs Python 3.11 for you.
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Optional: local LLM for the Persona and Reporter agents (free, offline)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b

# 3. Python dependencies
cd backend
uv sync
```

Without Ollama everything still runs: the Persona agent uses a seeded sampler
and the Reporter uses templates. All statistics are always computed in code.

## Run

```bash
# terminal 1: targets (:8100) + engine API (:8000)
cd backend && uv run python run.py

# terminal 2: the web UI
npm run dev        # from the repo root, then open http://localhost:3000/lab
```

In the lab, pick **Ride Pricing API** or **Credit Approval Model** (tagged
`agents`), set the budget and press **Run**.

### Each part on its own

| Part | Command |
|---|---|
| Pricing target only | `uv run uvicorn targets.pricing_api:app --port 8101` (POST /quote) |
| Credit target only | `uv run uvicorn targets.credit_api:app --port 8102` (POST /quote) |
| Both targets | `uv run uvicorn targets.server:app --port 8100` |
| Engine API | `uv run uvicorn autopsy.api:app --port 8000` |
| Headless run (no UI) | `uv run python -m autopsy.cli pricing --budget 500 --seed 42` |
| Random baseline | `uv run python -m autopsy.cli pricing --strategy random --seed 42` |
| Benchmark | `uv run python -m autopsy.cli pricing --benchmark --seeds 3` |
| Tests | `uv run pytest` |

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `AUTOPSY_LLM` | `ollama` | `ollama`, `openai` (any OpenAI-compatible URL) or `off` |
| `AUTOPSY_LLM_MODEL` | `qwen2.5:3b` | model for the Persona and Reporter agents |
| `AUTOPSY_LLM_URL` | `http://127.0.0.1:11434` | Ollama URL, or the base URL of an OpenAI-compatible API |
| `AUTOPSY_LLM_API_KEY` | | key for OpenAI-compatible APIs |
| `AUTOPSY_MEMORY` | `sqlite` | `sqlite` or `meko` |
| `AUTOPSY_MEKO_URL` / `AUTOPSY_MEKO_TOKEN` | | Meko MCP endpoint and token |
| `AUTOPSY_TARGETS_URL` | `http://127.0.0.1:8100` | where targets are served |
| `AUTOPSY_ENGINE_URL` (web UI) | `http://127.0.0.1:8000` | where the Next.js relay finds the engine |
| `AUTOPSY_TARGET_SEED` (targets) | unset | makes the mock target's ±3% noise reproducible, so a seeded demo replays exactly: `AUTOPSY_TARGET_SEED=1 uv run python run.py` |

Fixed seed: pass `--seed` to the CLI (the lab picks a random seed per run). With
the LLM off and `AUTOPSY_TARGET_SEED` set, a seed reproduces a run exactly.

## How it works

**Targets** (`targets/`)
- `pricing_api.py`: POST /quote `{device, age, city, postcode, income, day_of_week, hour, loyalty_tier}` → `{price}`.
  - The base price is ₹200, with ±3% noise.
  - Its hidden rules live in `hidden_rules.json`.
- `credit_api.py`: a scikit-learn random forest trained on the public UCI German Credit dataset → `{approved, score}`.
- Agents never read target code or `hidden_rules.json`. They only see `/schema` (public API docs) and `/quote`. `tests/test_isolation_and_memory.py` enforces this.

**Blackboard** (`autopsy/memory.py`)
- The interface is `write_fact`, `read_facts`, `post_message`, `read_messages`.
- Every message is `{from, to, type, content, reason}`.
- There are two backends: SQLite (default) and Meko over MCP.
- Raw probe results go in the SQLite `probes` table (`autopsy/probes.py`), never in agent memory.

**Agents** (`autopsy/agents/`)

| Agent | What it does |
|---|---|
| 🎭 Persona | Generates realistic, diverse personas from the schema (LLM, validated against the schema, with a seeded fallback). Answers matched requests like "5 personas aged 55+ and 5 under 30, otherwise identical". |
| 🧪 Experimenter | Sends counterfactual paired probes: same persona, ONE feature changed. Phase 1 screens every feature. Phase 2 is active learning. Phase 3 runs 2×2 interaction tests when asked. |
| 📊 Statistician | Pure code. Measures the noise floor from repeated identical queries. Computes paired differences, bootstrap 95% CIs and sign-flip permutation tests, with Benjamini–Hochberg correction across all contrasts. Classifies the effect shape (multiplicative / additive / threshold / linear). Flags heterogeneous effects and requests interaction tests. Runs DoWhy refuters (placebo treatment, random common cause, data subset). Uses a DoWhy causal graph to check whether postcode acts as a proxy for income. |
| 📝 Reporter | Writes the rulebook. Each rule has plain-language text, effect size, CI, number of probes, p / BH q, refuters passed, and a badge (high / medium / suspected). It refuses to state weak rules and asks for more evidence instead. |

**Orchestrator** (`autopsy/orchestrator.py`)
- The agent with the oldest open message addressed to it acts next.
- The run stops when there are no open requests or the budget is spent.
- Active learning scores each open contrast as *CI width (in noise units) × P(effect ≠ 0)* and probes the best one next.
- A feature stops being probed when its CI is narrow, or clearly includes zero.
- A RANDOM probing baseline (`--strategy random`) is used for comparison.

**Reveal**: after a run, the lab's *Ground truth* section fetches `/reveal` and scores the rulebook: rules found, partial matches, false positives, decoys fooled, and queries used.

## 2-minute demo script

1. **(0:00) Setup.** Run `uv run python run.py` and `npm run dev`, then open `/lab`.
   > "This is a ride-pricing API. We can only send requests and see prices. We don't know how it works."
2. **(0:15) Start.** Pick **Ride Pricing API**, keep budget 500 and press **Launch investigation**.
   > "Four agents share a blackboard. Watch the conversation."
3. **(0:30) Console.** Point at the emoji log:
   - 🎭 makes personas.
   - 🧪 measures noise (about 1.7%), then changes one thing at a time.
   - 📊 notices the hour effect is inconsistent and asks for a 2×2 test with the weekend.
4. **(1:00) Hypotheses and effects.** CIs shrink as the active learner spends queries where they're most informative. Loyalty tier closes early as *no detectable effect*.
5. **(1:20) Rules page.** Show these findings:
   - iPhone ×1.12
   - age above 60 +₹50
   - weekend AND hour ≥ 20 ×1.5
   - four premium postcodes ×1.20
   - and *postcode acts as a proxy for income*

   Each rule has its CI, probes, BH q, DoWhy refuters and badge.
6. **(1:40) Reveal.** Under **Ground truth**, click **Reveal hidden rules** and show the scorecard: rules found, false positives, decoys, queries used.
7. **(1:55) Benchmark.** On the Learning page, the benchmark compares active learning with random probing on true rules found per query.
