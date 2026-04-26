# The AI Scientist (scienfisto)

End-to-end AI system for the **Fulcrum Challenge**: transforming a plain-English scientific hypothesis into an operationally realistic experiment plan.

## 🧬 Challenge Context

Designing a runnable experiment from a scientific idea is typically an expert-heavy, multi-day workflow:

- protocol design
- reagent and supplier selection
- budget estimation
- timeline and dependency planning

In most research organizations, this operational scoping is the bottleneck, not ideation. The AI Scientist compresses this process into seconds while keeping outputs grounded in retrievable evidence.

## 🚀 What We Built

The AI Scientist is a Next.js application that accepts a natural-language hypothesis and produces structured outputs intended for real lab operations.

Core objective:

> Generate a complete experiment plan that a Principal Investigator could review, validate, and operationalize.

## 🧠 Core System Features

### 1) Literature QC Engine (Novelty Gate)

Before full plan generation, the system runs a rapid literature novelty check ("plagiarism check for science"):

- queries Tavily for relevant papers/articles
- evaluates novelty with Gemini against retrieved context
- emits one of three novelty labels:
  - `not found`
  - `similar work exists`
  - `exact match found`
- includes 1-3 references for follow-up

**Resilience behavior:** if Gemini is rate-limited/unavailable, the endpoint gracefully degrades to retrieval-only fallback rather than failing hard.

### 2) Grounded Generation (Anti-Hallucination Strategy)

The intended planning pipeline uses retrieval-grounded context (e.g., protocols, supplier documentation, catalog data) to constrain generation and reduce hallucinated materials/costs.

This architecture is designed to surface operational details such as:

- protocol steps derived from prior art
- supplier-backed materials
- line-item budgets
- realistic execution timelines

### 3) Strict Structured Output

System outputs are schema-constrained JSON for deterministic UI rendering and downstream processing:

- Protocol
- Materials
- Budget
- Timeline

For the current Literature QC module, output is strictly normalized to:

```json
{
  "novelty": "not found | similar work exists | exact match found",
  "references": [{ "title": "string", "url": "string" }]
}
```

## 🏗️ Architecture Snapshot

- `app/api/lit-qc/route.ts`: novelty classification endpoint
- Retrieval: Tavily Search API
- Reasoning/classification: Google Gemini
- Output normalization: strict server-side schema guard + sanitization
- Runtime controls: explicit Node.js runtime and robust request validation

## 🛠️ Tech Stack

- **Frontend/Backend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Infrastructure:** Vercel (target deployment)
- **AI/Retrieval:**
  - Google Gemini (current implementation: `gemini-2.0-flash`)
  - Tavily API (current implementation uses direct Tavily Search API calls)

> Note: Some challenge drafts may mention `gemini-1.5-flash` and `@tavily/core`. The repository currently uses `gemini-2.0-flash` via `@google/generative-ai` and direct Tavily API integration.

## ⚙️ Local Development

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

Create `.env.local` in the repository root:

```env
TAVILY_API_KEY=your_tavily_key
GEMINI_API_KEY=your_gemini_key
```

### 3) Run the app

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## 🔌 API Reference (Current)

### `POST /api/lit-qc`

Performs novelty classification from a user hypothesis.

Request body:

```json
{
  "hypothesis": "Using CRISPR-Cas9 to modify ..."
}
```

Success response:

```json
{
  "novelty": "similar work exists",
  "references": [
    { "title": "Paper title", "url": "https://..." }
  ]
}
```

Validation behavior:

- Invalid JSON -> `400`
- Missing/empty `hypothesis` -> `400`
- Missing server keys -> `500`
- Gemini rate-limit/unavailable -> graceful fallback (retrieval-only response, still structured)

## 📈 Project Direction

The current repository includes the Literature QC foundation and strict response handling. The full challenge trajectory extends this into complete experiment-plan generation with:

- protocol synthesis
- supplier-grounded bill of materials
- cost modeling
- phased timeline and dependencies
- scientist-in-the-loop review/feedback loop
