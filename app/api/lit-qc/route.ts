import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import type { LitQCResult, LitQCReference, NoveltySignal } from "@/types/experiment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOVELTY_VALUES: NoveltySignal[] = [
  "not found",
  "similar work exists",
  "exact match found",
];

function normalizeGeminiJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  const withoutOpeningFence = trimmed.replace(/^```(?:json)?\s*/i, "");
  const withoutAnyFenceMarkers = withoutOpeningFence.replace(/```/g, "");
  return JSON.parse(withoutAnyFenceMarkers.trim());
}

function toStrictResponse(payload: unknown): LitQCResult {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const novelty = NOVELTY_VALUES.includes(obj.novelty as NoveltySignal)
    ? (obj.novelty as NoveltySignal)
    : "not found";

  const references = Array.isArray(obj.references)
    ? obj.references
        .map((item): LitQCReference | null => {
          if (!item || typeof item !== "object") return null;
          const rec = item as Record<string, unknown>;
          const title = typeof rec.title === "string" ? rec.title.trim() : "";
          const url = typeof rec.url === "string" ? rec.url.trim() : "";
          if (!title || !url) return null;

          const authors = Array.isArray(rec.authors)
            ? rec.authors.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
            : [];
          const yearRaw = typeof rec.year === "number" ? rec.year : parseInt(String(rec.year ?? ""), 10);
          const year = Number.isFinite(yearRaw) && yearRaw > 1800 ? yearRaw : new Date().getFullYear();
          const relevance_note =
            typeof rec.relevance_note === "string" && rec.relevance_note.trim().length > 0
              ? rec.relevance_note.trim()
              : "Relevance note unavailable.";

          return { title, url, authors, year, relevance_note };
        })
        .filter((item): item is LitQCReference => item !== null)
        .slice(0, 3)
    : [];

  return { novelty, references };
}

function fallbackReferences(
  results: Array<{ title?: string; url?: string; content?: string }>
): LitQCReference[] {
  const currentYear = new Date().getFullYear();
  return results
    .map((item): LitQCReference | null => {
      const title = item.title?.trim();
      const url = item.url?.trim();
      if (!title || !url) return null;
      return {
        title,
        url,
        authors: [],
        year: currentYear,
        relevance_note: item.content?.slice(0, 240) || "Surfaced via Tavily search.",
      };
    })
    .filter((item): item is LitQCReference => item !== null)
    .slice(0, 3);
}

export async function POST(request: Request) {
  try {
    let body: { hypothesis?: unknown };
    try {
      body = (await request.json()) as { hypothesis?: unknown };
    } catch {
      return NextResponse.json(
        { error: "Invalid request body: expected JSON with `hypothesis`." },
        { status: 400 }
      );
    }

    const hypothesis = typeof body.hypothesis === "string" ? body.hypothesis.trim() : "";
    if (!hypothesis) {
      return NextResponse.json(
        { error: "Invalid request body: `hypothesis` must be a non-empty string." },
        { status: 400 }
      );
    }

    const tavilyApiKey = process.env.TAVILY_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      return NextResponse.json(
        { error: "Server configuration error: missing GEMINI_API_KEY." },
        { status: 500 }
      );
    }

    // ---- Tavily search (graceful fallback when key missing or call fails) ----
    let results: Array<{ title?: string; url?: string; content?: string }> = [];
    if (tavilyApiKey) {
      try {
        const tavilyResponse = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyApiKey,
            query: `Recent scientific papers or articles about: ${hypothesis}`,
            search_depth: "advanced",
            max_results: 8,
          }),
        });
        if (tavilyResponse.ok) {
          const tavilyData = (await tavilyResponse.json()) as {
            results?: Array<{ title?: string; url?: string; content?: string }>;
          };
          results = Array.isArray(tavilyData.results) ? tavilyData.results : [];
        } else {
          console.warn("[lit-qc] Tavily request failed:", tavilyResponse.status);
        }
      } catch (tavilyError) {
        console.warn("[lit-qc] Tavily call errored:", tavilyError);
      }
    } else {
      console.warn("[lit-qc] TAVILY_API_KEY not set, skipping web search");
    }

    const context = results
      .map(
        (item, i) =>
          `Source ${i + 1}\nTitle: ${item.title ?? "Untitled"}\nURL: ${item.url ?? "N/A"}\nSnippet: ${item.content ?? ""}`
      )
      .join("\n\n");

    // ---- Gemini novelty classification ----
    const model = new GoogleGenerativeAI(geminiApiKey).getGenerativeModel({
      model: "gemini-3-flash-preview",
    });

    const prompt = [
      "You are a scientific novelty evaluator.",
      "Use only the supplied Tavily context and do not invent references.",
      `Hypothesis: "${hypothesis}"`,
      "",
      "Classify novelty as exactly one of:",
      '  - "not found"            (no related work in the context)',
      '  - "similar work exists"  (related but not identical work)',
      '  - "exact match found"    (the exact protocol has been done)',
      "",
      "Return STRICT JSON only with this schema:",
      "{",
      '  "novelty": "...",',
      '  "references": [',
      "    {",
      '      "title": "string",',
      '      "url": "string",',
      '      "authors": ["string", ...],   // best-effort, [] if unknown',
      '      "year": number,                // best-effort, current year if unknown',
      '      "relevance_note": "1-2 sentences explaining how it relates"',
      "    }",
      "  ]",
      "}",
      "",
      "Rules:",
      "- references must come ONLY from the provided context.",
      "- references length must be at most 3.",
      "- if context is insufficient, set novelty: \"not found\" and references: [].",
      "- relevance_note must be specific to the hypothesis (not a generic summary).",
      "",
      "Tavily context:",
      context || "No results found.",
    ].join("\n");

    let response: LitQCResult;
    try {
      const geminiResult = await model.generateContent(prompt);
      const geminiText = geminiResult.response.text();
      response = toStrictResponse(normalizeGeminiJson(geminiText));
    } catch (geminiError) {
      console.warn("[lit-qc] Gemini unavailable, using fallback", geminiError);
      response = {
        novelty: results.length > 0 ? "similar work exists" : "not found",
        references: fallbackReferences(results),
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[lit-qc] CRITICAL FAILURE", error);
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: "CRITICAL FAILURE", message }, { status: 500 });
  }
}
