/**
 * /api/generate-plan
 *
 * Human 3 — Master experiment plan generator.
 *
 * Flow:
 *   1. Receive hypothesis + optional lit_qc result
 *   2. Detect the experiment domain from the hypothesis
 *   3. GROUNDING LOOP — call /api/get-prices to inject real catalog numbers
 *   4. LEARNING LOOP  — fetch domain-specific corrections from Vercel KV
 *   5. Build the master prompt and call Gemini
 *   6. Parse + validate the JSON response
 *   7. Return the typed ExperimentPlan
 */

import { NextRequest, NextResponse } from "next/server";
import type {
  GeneratePlanRequest,
  GeneratePlanResponse,
  ExperimentPlan,
  ExperimentDomain,
  GetPricesResponse,
  FeedbackCorrection,
} from "@/types/experiment";
import { getModel } from "@/lib/gemini";
import { buildUserPrompt, extractReagentNames } from "@/lib/prompt";
import { getCorrectionsForDomain } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Domain detection — lightweight keyword classifier
// ---------------------------------------------------------------------------
function detectDomain(hypothesis: string): ExperimentDomain {
  const h = hypothesis.toLowerCase();
  if (/biosensor|crp|antibod|elisa|diagnostic|immunoassay/.test(h)) return "diagnostics";
  if (/hela|cell.viab|cryoprot|freeze|thaw|trehalose|dmso/.test(h)) return "cell_biology";
  if (/gut|probiotic|lactobacillus|intestinal|microbiome|permeability/.test(h)) return "gut_health";
  if (/co2|carbon.captur|sporomusa|bioelectrochem|acetate/.test(h)) return "climate";
  if (/pcr|sequenc|genomic|dna|rna|crispr/.test(h)) return "genomics";
  if (/drug|pharmacol|ic50|inhibit|dose.response/.test(h)) return "pharmacology";
  if (/solar|material|nano|polymer|composite/.test(h)) return "materials_science";
  return "other";
}

// ---------------------------------------------------------------------------
// Grounding loop — calls /api/get-prices internally
// ---------------------------------------------------------------------------
async function fetchGroundingData(
  reagentNames: string[],
  baseUrl: string
): Promise<GetPricesResponse | null> {
  try {
    const res = await fetch(`${baseUrl}/api/get-prices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reagent_names: reagentNames }),
    });
    if (!res.ok) return null;
    return (await res.json()) as GetPricesResponse;
  } catch {
    // Non-fatal — generation continues without grounding
    console.warn("[generate-plan] get-prices call failed; continuing without grounding");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body: GeneratePlanRequest = await request.json();
    const { hypothesis, lit_qc } = body;

    if (!hypothesis || typeof hypothesis !== "string" || hypothesis.trim().length < 20) {
      return NextResponse.json(
        { error: "hypothesis must be a string of at least 20 characters" },
        { status: 400 }
      );
    }

    // 1. Detect domain
    const domain = detectDomain(hypothesis);

    // 2. Grounding loop — get real catalog numbers before prompting
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (request.headers.get("x-forwarded-proto") ?? "http") +
        "://" +
        (request.headers.get("host") ?? "localhost:3000");

    const reagentNames = await extractReagentNames(hypothesis, domain);
    const groundingData = await fetchGroundingData(reagentNames, baseUrl);

    // 3. Learning loop — fetch prior corrections for this domain from Vercel KV
    let fewShotCorrections: FeedbackCorrection[] = [];
    try {
      fewShotCorrections = await getCorrectionsForDomain(domain);
    } catch {
      // KV not set up yet — silently skip
    }

    // 4. Build the prompt
    const userPrompt = buildUserPrompt({
      hypothesis: hypothesis.trim(),
      litQC: lit_qc,
      groundingData: groundingData ?? undefined,
      fewShotCorrections,
    });

    // 5. Call Gemini — generateContent with systemInstruction already set on the model
    const model = getModel();
    const result = await model.generateContent(userPrompt);
    const rawText = result.response.text();

    // 6. Parse and enrich the JSON
    let plan: ExperimentPlan;
    try {
      plan = JSON.parse(rawText) as ExperimentPlan;
    } catch {
      // Gemini sometimes wraps JSON in markdown fences despite instructions
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        try {
          plan = JSON.parse(fenceMatch[1]) as ExperimentPlan;
        } catch {
          console.error("[generate-plan] Gemini raw output (fenced, unparsable):", rawText.slice(0, 4000));
          return NextResponse.json(
            { error: "LLM returned malformed JSON. Please retry." },
            { status: 502 }
          );
        }
      } else {
        // Detect truncation by checking if response was cut off mid-token
        const finishReason = result.response.candidates?.[0]?.finishReason;
        const truncated = finishReason === "MAX_TOKENS";
        console.error(
          `[generate-plan] Gemini raw output (finishReason=${finishReason}):`,
          rawText.slice(0, 4000)
        );
        return NextResponse.json(
          {
            error: truncated
              ? "LLM response was truncated (token limit). Please simplify the hypothesis or retry."
              : "LLM returned malformed JSON. Please retry.",
          },
          { status: 502 }
        );
      }
    }

    // Stamp server-side fields
    plan.generated_at = new Date().toISOString();
    plan.grounded = groundingData !== null && groundingData.reagents.length > 0;
    plan.domain = domain;
    plan.hypothesis = hypothesis.trim();
    if (lit_qc) plan.lit_qc = lit_qc;

    return NextResponse.json({ plan } satisfies GeneratePlanResponse);
  } catch (err) {
    // Surface Gemini rate-limit errors with the correct HTTP status and retry delay
    if (err instanceof Error && err.message.includes("429")) {
      const retryMatch = err.message.match(/retryDelay['":\s]+"?([\d.]+)s/);
      const retryAfter = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
      return NextResponse.json(
        { error: "Gemini rate limit reached. Please retry after the specified delay.", retry_after_seconds: retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }
    console.error("[generate-plan] Unhandled error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
