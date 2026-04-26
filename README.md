# Scienfisto

Turn a plain-English scientific hypothesis into a complete, ready-to-execute lab
experiment plan — with literature novelty checks, real catalog numbers, an
itemised budget, a phased timeline, and explicit validation criteria.

> Submit on Sunday. Get a Monday-ready protocol that a PI can hand to a grad
> student and start running by Friday.

---

## What it does

Given a hypothesis like:

> *"A paper-based electrochemical biosensor functionalized with anti-CRP
> antibodies will detect C-reactive protein in human serum at clinically
> relevant concentrations (0.1–10 mg/L) with a detection limit below
> 0.05 mg/L."*

Scienfisto produces a structured `ExperimentPlan` JSON containing:

- **Literature QC** — Tavily-grounded novelty signal (`not found` / `similar
  work exists` / `exact match found`) plus 3+ real references with
  authors, year, URL, and a relevance note.
- **Protocol** — 4–8 step-by-step actions, each with duration, critical
  notes, and a citation to a published source (Nature Protocols,
  protocols.io, Bio-protocol, PMC).
- **Materials** — every reagent with a real catalog number, supplier, unit
  size, quantity, and price, grounded against a supplier catalog.
- **Budget** — itemised reagent / consumables / equipment / personnel
  line items, subtotal, 15% contingency, and total in USD.
- **Timeline** — 3–6 phases with start/end days, declared dependencies on
  prior phases, and a milestone per phase.
- **Validation** — primary metric, success threshold, control conditions,
  statistical method, expected sample size, and ≥ 2 named failure modes.

A feedback loop captures expert corrections and feeds them back as few-shot
examples on the next generation, so the system learns from each PI who uses it.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Next.js (App Router)                       │
│  app/page.tsx                                                    │
│  ─────────────────                                               │
│  Hypothesis input → Lit QC checkpoint → Plan view → Feedback     │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────┐    ┌──────────────────────┐
│   /api/lit-qc        │    │   /api/get-prices    │
│   Tavily search +    │    │   Catalog lookup     │
│   Gemini classifier  │    │   (fuzzy match)      │
└──────────┬───────────┘    └──────────┬───────────┘
           │                           │
           ▼                           ▼
        ┌─────────────────────────────────────┐
        │        /api/generate-plan           │
        │  1. Detect domain                   │
        │  2. Grounding loop (get-prices)     │
        │  3. Learning loop (KV corrections)  │
        │  4. Build master prompt             │
        │  5. Call Gemini → ExperimentPlan    │
        └──────────────┬──────────────────────┘
                       │
                       ▼
                ┌───────────────┐
                │  /api/feedback │
                │  POST → KV     │
                │  GET  ← KV     │
                └───────────────┘
```

### Tech stack

| Layer        | Choice                                               |
| ------------ | ---------------------------------------------------- |
| Framework    | Next.js 16 (App Router, Turbopack)                   |
| UI           | React 19, Tailwind v4, anime.js v4                   |
| LLM          | Google Gemini (`gemini-3-flash-preview`)             |
| Search       | Tavily (scientific-aware web search)                 |
| Memory       | Vercel KV (Upstash Redis) — 50 corrections / domain  |
| Language     | TypeScript end-to-end                                |

---

## Project layout

```
scienfisto/
├── app/
│   ├── page.tsx                  # Single-page UI: input → checkpoint → plan
│   ├── globals.css               # Theme + sf-* component styles
│   └── api/
│       ├── lit-qc/route.ts       # Tavily search + Gemini novelty scorer
│       ├── get-prices/route.ts   # Reagent → catalog number / supplier / price
│       ├── generate-plan/route.ts # Master orchestrator (grounding + learning)
│       └── feedback/route.ts     # POST corrections, GET correction history
├── lib/
│   ├── gemini.ts                 # GoogleGenerativeAI client + model config
│   ├── prompt.ts                 # System prompt, JSON schema, prompt builder
│   └── kv.ts                     # Vercel KV helpers for the learning loop
├── types/
│   └── experiment.ts             # Shared types — single source of truth
└── public/                       # Static assets
```

---

## API reference

All routes accept and return JSON. Errors are returned as
`{ "error": string }` with an appropriate HTTP status.

### `POST /api/lit-qc`

Check whether the hypothesis has been done before.

```json
// request
{ "hypothesis": "..." }

// response
{
  "novelty": "not found" | "similar work exists" | "exact match found",
  "references": [
    {
      "title": "Advancement in Paper-Based Electrochemical Biosensing...",
      "authors": ["..."],
      "year": 2023,
      "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC10377443/",
      "relevance_note": "Directly describes ePADs functionalized with..."
    }
  ]
}
```

If `TAVILY_API_KEY` is missing or Tavily is unreachable, the route degrades
gracefully — Gemini scores novelty from the hypothesis alone and returns an
empty references array.

### `POST /api/get-prices`

Look up real catalog numbers and prices for a list of reagents.

```json
// request
{ "reagent_names": ["anti-CRP antibody", "EDC", "NHS"] }

// response
{
  "reagents": [
    { "name": "anti-CRP antibody", "catalog_number": "ab6", "supplier": "Abcam",
      "unit": "100 μg", "unit_price_usd": 350 },
    ...
  ]
}
```

Unknown reagents return `{ catalog_number: "UNKNOWN", supplier: "Supplier TBD",
unit_price_usd: 0 }` so generation never blocks.

### `POST /api/generate-plan`

The main orchestrator. Takes the hypothesis + the lit-qc result and returns a
fully grounded `ExperimentPlan`.

```json
// request
{
  "hypothesis": "...",
  "lit_qc": { "novelty": "...", "references": [...] }
}

// response
{ "plan": ExperimentPlan }
```

Internally:

1. **Domain detection** — keyword classifier picks one of `diagnostics`,
   `cell_biology`, `gut_health`, `climate`, `genomics`, `pharmacology`,
   `materials_science`, `other`.
2. **Grounding loop** — extracts reagent seeds from the hypothesis and calls
   `/api/get-prices`. The result is injected as a `## GROUNDING DATA` section
   in the prompt, with strict instructions to use those exact catalog numbers.
3. **Learning loop** — pulls the latest corrections for this domain from KV
   and injects up to 5 of them as few-shot examples in
   `## EXPERT CORRECTIONS FROM SIMILAR EXPERIMENTS`.
4. **Generation** — calls Gemini with `responseMimeType: application/json` and
   `maxOutputTokens: 32768` to avoid mid-protocol truncation.
5. **Validation & enrichment** — server stamps `generated_at`, `domain`,
   `grounded`, and overrides `lit_qc` so the LLM cannot mutate it.

Returns `502` with `"LLM response was truncated (token limit)"` if the model's
`finishReason` is `MAX_TOKENS`, and `429` (with `Retry-After`) on Gemini
quota exhaustion.

### `POST /api/feedback`

Record a structured correction for the learning loop.

```json
// request
{
  "correction": {
    "experiment_type": "Paper-based Electrochemical CRP Biosensor",
    "experiment_domain": "diagnostics",
    "section": "protocol",
    "field_path": "protocol[0].duration_hours",
    "original_value": "4",
    "corrected_value": "6",
    "correction_reason": "Drying time underestimated for stencil paper at RT"
  }
}

// response
{ "ok": true, "id": "<uuid>" }
```

Stored in Vercel KV under `scienfisto:feedback:<domain>` (LPUSH, capped at 50).

### `GET /api/feedback?domain=<domain>&limit=<n>`

Retrieve the most recent corrections for a domain (debug / history view).

---

## Local development

### 1. Install

```bash
npm install
```

### 2. Configure environment

Create `.env.local` at the repo root:

```bash
# Required for /api/generate-plan and /api/lit-qc
GEMINI_API_KEY=...        # https://aistudio.google.com/app/apikey

# Required for /api/lit-qc (route degrades gracefully without it)
TAVILY_API_KEY=...        # https://app.tavily.com

# Required for /api/feedback and the learning loop
KV_REST_API_URL=...       # populated by `vercel kv create` or the dashboard
KV_REST_API_TOKEN=...

# Internal base URL used by /api/generate-plan to call /api/get-prices
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

If you use Vercel, run `vercel env pull` to sync these automatically.

### 3. Run

```bash
npm run dev
# → http://localhost:3000
```

### 4. Build for production

```bash
npm run build
npm run start
```

---

## Smoke testing the API

```bash
# Lit QC
curl -X POST http://localhost:3000/api/lit-qc \
  -H 'Content-Type: application/json' \
  -d '{"hypothesis":"A paper-based electrochemical biosensor functionalized with anti-CRP antibodies will detect C-reactive protein in human serum below 0.05 mg/L."}'

# Generate full plan (pipe lit-qc result in)
LITQC=$(curl -s -X POST http://localhost:3000/api/lit-qc \
  -H 'Content-Type: application/json' \
  -d '{"hypothesis":"..."}')

curl -X POST http://localhost:3000/api/generate-plan \
  -H 'Content-Type: application/json' \
  -d "{\"hypothesis\":\"...\",\"lit_qc\":$LITQC}"

# Submit a correction
curl -X POST http://localhost:3000/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"correction":{"experiment_type":"...","experiment_domain":"diagnostics","section":"protocol","field_path":"protocol[0].duration_hours","original_value":"4","corrected_value":"6"}}'
```

Expect ~25–35s for `/api/lit-qc` and `/api/generate-plan` (LLM-bound), and
sub-second for `/api/get-prices` and `/api/feedback`.

---

## Repository layout & contributors

The project was built across three workstreams:

| Branch                     | Owner                             | Scope                                          |
| -------------------------- | --------------------------------- | ---------------------------------------------- |
| `UI/UIX`                   | Human 1 (UI/UX)                   | `app/page.tsx`, `app/globals.css`, animations  |
| `main` (initial)           | Human 2 (Lit QC)                  | `app/api/lit-qc/route.ts` + Tavily integration |
| `feat/llm-orchestration`   | Human 3 (Plan generation)         | `app/api/generate-plan`, `app/api/feedback`, `app/api/get-prices`, `lib/*`, `types/experiment.ts` |
| `main` (final)             | All three, merged                 | Production-ready integration                   |

`feat/llm-orchestration` is preserved for traceability — it contains only the
plan-generation backend without UI or lit-QC commits.

---

## License

MIT
