/**
 * /api/get-prices
 *
 * Mock implementation of Human 2's supplier-grounding route.
 * Returns real-looking catalog numbers and prices for a list of reagent names.
 * Replace the MOCK_CATALOG body with a real Tavily scrape when Human 2's
 * implementation is ready — the interface contract stays identical.
 */

import { NextRequest, NextResponse } from "next/server";
import type { GetPricesRequest, GetPricesResponse } from "@/types/experiment";

// ---------------------------------------------------------------------------
// Static catalog — best-effort real catalog numbers from Sigma-Aldrich /
// Thermo Fisher.  Human 2 will replace this with live Tavily scraping.
// ---------------------------------------------------------------------------
const MOCK_CATALOG: Record<
  string,
  { catalog_number: string; supplier: string; unit: string; unit_price_usd: number }
> = {
  // --- Antibodies & proteins ---
  "anti-crp antibody": { catalog_number: "ab6", supplier: "Abcam", unit: "100 μg", unit_price_usd: 350 },
  "crp protein standard": { catalog_number: "C4063", supplier: "Sigma-Aldrich", unit: "1 mg", unit_price_usd: 185 },
  "bsa bovine serum albumin": { catalog_number: "A3294", supplier: "Sigma-Aldrich", unit: "10 g", unit_price_usd: 55 },

  // --- Coupling reagents ---
  edc: { catalog_number: "22980", supplier: "Thermo Fisher Scientific", unit: "25 g", unit_price_usd: 89 },
  nhs: { catalog_number: "130672", supplier: "Sigma-Aldrich", unit: "5 g", unit_price_usd: 42 },
  cysteamine: { catalog_number: "M6500", supplier: "Sigma-Aldrich", unit: "5 g", unit_price_usd: 48 },

  // --- Substrates & electrodes ---
  "whatman grade 1 paper": { catalog_number: "WHA1001917", supplier: "Sigma-Aldrich", unit: "100 sheets", unit_price_usd: 65 },
  "carbon paste": { catalog_number: "E-3449", supplier: "Ercon Inc.", unit: "100 g", unit_price_usd: 120 },

  // --- Electrochemistry ---
  "potassium ferricyanide": { catalog_number: "P8131", supplier: "Sigma-Aldrich", unit: "100 g", unit_price_usd: 38 },

  // --- Cell biology ---
  dmso: { catalog_number: "D2650", supplier: "Sigma-Aldrich", unit: "100 mL", unit_price_usd: 32 },
  trehalose: { catalog_number: "T9531", supplier: "Sigma-Aldrich", unit: "25 g", unit_price_usd: 74 },
  "fitc-dextran": { catalog_number: "FD4", supplier: "Sigma-Aldrich", unit: "250 mg", unit_price_usd: 198 },
  "lactobacillus rhamnosus gg": { catalog_number: "53103", supplier: "ATCC", unit: "1 vial", unit_price_usd: 365 },

  // --- Microbiology / bioelectrochemistry ---
  "sporomusa ovata": { catalog_number: "BAA-2963", supplier: "ATCC", unit: "1 vial", unit_price_usd: 420 },
  acetate: { catalog_number: "S2889", supplier: "Sigma-Aldrich", unit: "500 g", unit_price_usd: 28 },

  // --- Generic lab consumables ---
  "elisa kit": { catalog_number: "ab99995", supplier: "Abcam", unit: "96 wells", unit_price_usd: 480 },
  "pbs phosphate buffered saline": { catalog_number: "10010023", supplier: "Thermo Fisher Scientific", unit: "500 mL", unit_price_usd: 22 },
  "edta tubes": { catalog_number: "367861", supplier: "BD Vacutainer", unit: "100 tubes", unit_price_usd: 75 },
};

function fuzzyMatch(query: string): string | undefined {
  const q = query.toLowerCase().trim();
  // Exact key match first
  if (MOCK_CATALOG[q]) return q;
  // Substring match
  for (const key of Object.keys(MOCK_CATALOG)) {
    if (q.includes(key) || key.includes(q)) return key;
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body: GetPricesRequest = await request.json();
    const { reagent_names } = body;

    if (!Array.isArray(reagent_names) || reagent_names.length === 0) {
      return NextResponse.json({ error: "reagent_names must be a non-empty array" }, { status: 400 });
    }

    const reagents: GetPricesResponse["reagents"] = reagent_names.map((name) => {
      const matchKey = fuzzyMatch(name);
      if (matchKey) {
        return { name, ...MOCK_CATALOG[matchKey] };
      }
      // Unknown reagent — return a placeholder so generation isn't blocked
      return {
        name,
        catalog_number: "UNKNOWN",
        supplier: "Supplier TBD",
        unit: "unit",
        unit_price_usd: 0,
      };
    });

    return NextResponse.json({ reagents } satisfies GetPricesResponse);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
