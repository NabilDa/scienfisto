/**
 * /api/feedback
 *
 * Learning Loop — receives structured corrections from Human 1's UI and
 * persists them to Vercel KV, tagged by experiment domain.
 *
 * POST /api/feedback
 *   body: FeedbackRequest
 *   returns: FeedbackResponse
 *
 * GET /api/feedback?domain=<domain>&limit=<n>
 *   returns: { corrections: FeedbackCorrection[] }
 *   (convenience endpoint for debugging / Human 1 to display correction history)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import type {
  FeedbackRequest,
  FeedbackResponse,
  FeedbackCorrection,
  ExperimentDomain,
} from "@/types/experiment";
import { storeCorrection, getCorrectionsForDomain } from "@/lib/kv";

const VALID_DOMAINS: ExperimentDomain[] = [
  "diagnostics",
  "cell_biology",
  "gut_health",
  "climate",
  "genomics",
  "pharmacology",
  "materials_science",
  "other",
];

const VALID_SECTIONS = ["protocol", "materials", "budget", "timeline", "validation"];

// ---------------------------------------------------------------------------
// POST — store a correction
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body: FeedbackRequest = await request.json();
    const { correction } = body;

    // Validate required fields
    if (!correction) {
      return NextResponse.json({ error: "correction object is required" }, { status: 400 });
    }
    if (!VALID_DOMAINS.includes(correction.experiment_domain)) {
      return NextResponse.json(
        { error: `experiment_domain must be one of: ${VALID_DOMAINS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!VALID_SECTIONS.includes(correction.section)) {
      return NextResponse.json(
        { error: `section must be one of: ${VALID_SECTIONS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!correction.field_path || !correction.original_value || !correction.corrected_value) {
      return NextResponse.json(
        { error: "field_path, original_value, and corrected_value are required" },
        { status: 400 }
      );
    }
    if (correction.original_value === correction.corrected_value) {
      return NextResponse.json(
        { error: "original_value and corrected_value must differ" },
        { status: 400 }
      );
    }

    // Stamp and store
    const full: FeedbackCorrection = {
      ...correction,
      id: uuidv4(),
      submitted_at: new Date().toISOString(),
    };

    await storeCorrection(full);

    return NextResponse.json({ ok: true, id: full.id } satisfies FeedbackResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    // Surface KV configuration errors clearly to aid setup
    if (message.includes("KV is not configured")) {
      return NextResponse.json(
        {
          error:
            "Vercel KV is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN to your environment variables. See .env.local.example.",
        },
        { status: 503 }
      );
    }
    console.error("[feedback] Unhandled error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET — retrieve stored corrections for a domain (debugging / history view)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get("domain") as ExperimentDomain | null;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "10", 10), 50);

    if (!domain || !VALID_DOMAINS.includes(domain)) {
      return NextResponse.json(
        { error: `domain query param required. Must be one of: ${VALID_DOMAINS.join(", ")}` },
        { status: 400 }
      );
    }

    const corrections = await getCorrectionsForDomain(domain, limit);
    return NextResponse.json({ corrections });
  } catch (err) {
    console.error("[feedback] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
