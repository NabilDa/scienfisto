import type {
  LitQCResult,
  GetPricesResponse,
  FeedbackCorrection,
  ExperimentDomain,
} from "@/types/experiment";

// ---------------------------------------------------------------------------
// JSON schema description embedded in the system prompt to force the LLM to
// output a strictly typed experiment plan.
// ---------------------------------------------------------------------------
const JSON_SCHEMA_DESCRIPTION = `
You MUST return a single JSON object (no markdown fences, no extra text) that
conforms EXACTLY to this schema:

{
  "experiment_type": string,          // concise name of the experiment
  "domain": one of ["diagnostics","cell_biology","gut_health","climate",
                     "genomics","pharmacology","materials_science","other"],
  "summary": string,                  // 2-3 sentence plain-English summary
  "hypothesis": string,               // the original hypothesis verbatim
  "lit_qc": { ... },                  // pass through the lit_qc input unchanged
  "protocol": [                       // 4-8 steps
    {
      "step_number": integer,
      "title": string,
      "description": string,          // detailed, actionable, ≥3 sentences
      "duration_hours": number,
      "critical_notes": string[],     // 1-3 practical warnings
      "source_protocol": string       // cite protocols.io, Nature Protocols, etc.
    }
  ],
  "materials": [                      // one object per distinct reagent/item
    {
      "name": string,
      "catalog_number": string,       // MUST come from the grounding data below
      "supplier": string,
      "unit": string,
      "quantity_needed": number,
      "unit_price_usd": number,       // MUST come from the grounding data below
      "total_price_usd": number,
      "notes": string | null
    }
  ],
  "budget": {
    "line_items": [
      {
        "category": one of ["reagents","consumables","equipment_rental","personnel","other"],
        "description": string,
        "unit_price_usd": number,
        "quantity": number,
        "total_usd": number
      }
    ],
    "subtotal_usd": number,
    "contingency_percent": 15,
    "contingency_usd": number,
    "total_usd": number,
    "currency": "USD"
  },
  "timeline": [                       // 3-6 phases
    {
      "phase_number": integer,
      "name": string,
      "start_day": integer,
      "end_day": integer,
      "tasks": string[],
      "dependencies": integer[],      // phase_numbers this phase depends on
      "milestone": string
    }
  ],
  "validation": {
    "primary_metric": string,
    "success_threshold": string,
    "control_conditions": string[],
    "statistical_method": string,
    "expected_n_samples": integer,
    "failure_modes": string[]
  },
  "generated_at": string,             // ISO 8601 UTC timestamp
  "grounded": boolean                 // true when real catalog data was injected
}
`.trim();

// ---------------------------------------------------------------------------
// System prompt — injected once per model session
// ---------------------------------------------------------------------------
export const SYSTEM_PROMPT = `
You are an expert scientific protocol architect and laboratory operations specialist.
Your sole job is to convert a scientific hypothesis into an operationally realistic
experiment plan that a real Principal Investigator (PI) could pick up on Monday
and begin executing by Friday.

STRICT RULES:
1. Every protocol step MUST cite a real, published source (protocols.io, Nature
   Protocols, Bio-protocol, Thermo Fisher App Notes, etc.).
2. Every material MUST have a real catalog number and supplier. If grounding data
   is provided below, you MUST use it — do NOT invent catalog numbers.
3. Budget line items MUST be individually itemised. Include equipment rental and
   personnel costs where applicable. Apply a 15% contingency on the subtotal.
4. Timeline phases MUST declare dependencies on prior phases.
5. Validation MUST define explicit success thresholds and name ≥2 failure modes.
6. Output ONLY the JSON object. No markdown, no explanation, no apology.

${JSON_SCHEMA_DESCRIPTION}
`.trim();

// ---------------------------------------------------------------------------
// User-turn prompt builder
// ---------------------------------------------------------------------------

export interface BuildPromptOptions {
  hypothesis: string;
  litQC?: LitQCResult;
  groundingData?: GetPricesResponse;
  fewShotCorrections?: FeedbackCorrection[];
}

export function buildUserPrompt({
  hypothesis,
  litQC,
  groundingData,
  fewShotCorrections,
}: BuildPromptOptions): string {
  const sections: string[] = [];

  // --- Hypothesis ---
  sections.push(`## HYPOTHESIS\n${hypothesis}`);

  // --- Lit QC context ---
  if (litQC) {
    const refs = litQC.references
      .map((r) => `  - "${r.title}" (${r.year}) — ${r.relevance_note} [${r.url}]`)
      .join("\n");
    sections.push(
      `## LITERATURE QC RESULT\nNovelty signal: ${litQC.novelty}\nReferences:\n${refs || "  (none)"}`
    );
  }

  // --- Grounding data (real catalog numbers) ---
  if (groundingData && groundingData.reagents.length > 0) {
    const rows = groundingData.reagents
      .map(
        (r) =>
          `  - ${r.name} | Cat# ${r.catalog_number} | ${r.supplier} | ${r.unit} | $${r.unit_price_usd}`
      )
      .join("\n");
    sections.push(
      `## GROUNDING DATA (use these EXACT catalog numbers and prices in the materials array)\n${rows}`
    );
  }

  // --- Few-shot corrections from the learning loop ---
  if (fewShotCorrections && fewShotCorrections.length > 0) {
    const examples = fewShotCorrections
      .slice(0, 5) // cap at 5 to avoid context bloat
      .map(
        (c, i) =>
          `  [Example ${i + 1}] Section: ${c.section} | Field: ${c.field_path}\n` +
          `    Original: ${c.original_value}\n` +
          `    Expert correction: ${c.corrected_value}` +
          (c.correction_reason ? `\n    Reason: ${c.correction_reason}` : "")
      )
      .join("\n\n");
    sections.push(
      `## EXPERT CORRECTIONS FROM SIMILAR EXPERIMENTS (incorporate this knowledge)\n${examples}`
    );
  }

  // --- Final instruction ---
  sections.push(
    `## TASK\nGenerate the complete experiment plan JSON for the hypothesis above. ` +
      `Current UTC time: ${new Date().toISOString()}.`
  );

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Helper: extract reagent names from a hypothesis for the grounding call
// ---------------------------------------------------------------------------
export async function extractReagentNames(
  hypothesis: string,
  domain: ExperimentDomain
): Promise<string[]> {
  // Domain-specific reagent seeds — ensures the grounding call has something
  // to work with even before the LLM has run.
  const DOMAIN_SEEDS: Record<ExperimentDomain, string[]> = {
    diagnostics: ["anti-crp antibody", "EDC", "NHS", "BSA bovine serum albumin", "ELISA kit"],
    cell_biology: ["DMSO", "trehalose", "PBS phosphate buffered saline"],
    gut_health: ["Lactobacillus rhamnosus GG", "FITC-dextran", "PBS phosphate buffered saline"],
    climate: ["Sporomusa ovata", "acetate"],
    genomics: ["PBS phosphate buffered saline"],
    pharmacology: ["PBS phosphate buffered saline"],
    materials_science: [],
    other: [],
  };

  // Simple keyword extraction from the hypothesis text
  const lower = hypothesis.toLowerCase();
  const keywords: string[] = [...(DOMAIN_SEEDS[domain] ?? [])];

  const KEYWORD_MAP: [RegExp, string][] = [
    [/cysteamine/i, "cysteamine"],
    [/whatman/i, "Whatman Grade 1 paper"],
    [/carbon paste/i, "carbon paste"],
    [/ferricyanide/i, "potassium ferricyanide"],
    [/dmso/i, "DMSO"],
    [/trehalose/i, "trehalose"],
    [/fitc.?dextran/i, "FITC-dextran"],
    [/lactobacillus/i, "Lactobacillus rhamnosus GG"],
    [/sporomusa/i, "Sporomusa ovata"],
    [/bsa|albumin/i, "BSA bovine serum albumin"],
    [/elisa/i, "ELISA kit"],
    [/edc/i, "EDC"],
    [/nhs/i, "NHS"],
    [/pbs/i, "PBS phosphate buffered saline"],
  ];

  for (const [regex, name] of KEYWORD_MAP) {
    if (regex.test(lower) && !keywords.includes(name)) {
      keywords.push(name);
    }
  }

  return [...new Set(keywords)];
}
