import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Novelty = "not found" | "similar work exists" | "exact match found";

type Reference = {
  title: string;
  url: string;
};

type LitQcResponse = {
  novelty: Novelty;
  references: Reference[];
};

const NOVELTY_VALUES: Novelty[] = [
  "not found",
  "similar work exists",
  "exact match found",
];

function normalizeGeminiJson(rawText: string): unknown {
  const trimmed = rawText.trim();

  // Strip markdown wrappers (```json ... ```) before parsing.
  const withoutOpeningFence = trimmed.replace(/^```(?:json)?\s*/i, "");
  const withoutAnyFenceMarkers = withoutOpeningFence.replace(/```/g, "");
  const candidate = withoutAnyFenceMarkers.trim();

  return JSON.parse(candidate);
}

function toStrictResponse(payload: unknown): LitQcResponse {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const novelty = NOVELTY_VALUES.includes(obj.novelty as Novelty)
    ? (obj.novelty as Novelty)
    : "not found";

  const references = Array.isArray(obj.references)
    ? obj.references
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const rec = item as Record<string, unknown>;
          const title = typeof rec.title === "string" ? rec.title.trim() : "";
          const url = typeof rec.url === "string" ? rec.url.trim() : "";

          if (!title || !url) {
            return null;
          }

          return { title, url };
        })
        .filter((item): item is Reference => item !== null)
        .slice(0, 3)
    : [];

  return { novelty, references };
}

export async function POST(request: Request) {
  try {
    console.log(
      "Loaded Keys:",
      Object.keys(process.env).filter((k) => k.includes("TAVILY") || k.includes("GEMINI"))
    );

    const body = (await request.json()) as { hypothesis?: unknown };
    const hypothesis = typeof body.hypothesis === "string" ? body.hypothesis.trim() : "";

    if (!hypothesis) {
      throw new Error("Invalid request body: `hypothesis` must be a non-empty string.");
    }

    const tavilyApiKey = process.env.TAVILY_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!tavilyApiKey || !geminiApiKey) {
      throw new Error(
        `Missing API keys. TAVILY_API_KEY present: ${Boolean(tavilyApiKey)}; GEMINI_API_KEY present: ${Boolean(
          geminiApiKey
        )}`
      );
    }

    console.log("[lit-qc] Calling Tavily", {
      hypothesisLength: hypothesis.length,
      hasTavilyApiKey: Boolean(tavilyApiKey),
    });

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

    if (!tavilyResponse.ok) {
      const tavilyErrorText = await tavilyResponse.text();
      throw new Error(`Tavily request failed (${tavilyResponse.status}): ${tavilyErrorText}`);
    }

    const tavilyData = (await tavilyResponse.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    const results = Array.isArray(tavilyData.results) ? tavilyData.results : [];
    const context = results
      .map(
        (item, index) =>
          `Source ${index + 1}\nTitle: ${item.title ?? "Untitled"}\nURL: ${item.url ?? "N/A"}\nSnippet: ${item.content ?? ""}`
      )
      .join("\n\n");

    console.log("[lit-qc] Calling Gemini", {
      tavilyResultsCount: results.length,
      contextLength: context.length,
      hasGeminiApiKey: Boolean(geminiApiKey),
    });

    const model = new GoogleGenerativeAI(geminiApiKey).getGenerativeModel({
      model: "gemini-2.0-flash",
    });

    const prompt = [
      "You are a scientific novelty evaluator.",
      "Use only the supplied Tavily context and do not use outside knowledge.",
      `Hypothesis: "${hypothesis}"`,
      "Classify novelty as exactly one of:",
      '- "not found"',
      '- "similar work exists"',
      '- "exact match found"',
      "Return STRICT JSON only with this schema:",
      '{ "novelty": "...", "references": [{ "title": "string", "url": "string" }] }',
      "Rules:",
      "- references must be from the provided context only.",
      "- references length must be at most 3.",
      "- if context is insufficient, use novelty: not found and references: [].",
      "",
      "Tavily context:",
      context || "No results found.",
    ].join("\n");

    const geminiResult = await model.generateContent(prompt);
    const geminiText = geminiResult.response.text();
    const parsed = normalizeGeminiJson(geminiText);
    const strictResponse = toStrictResponse(parsed);

    console.log("[lit-qc] Returning final JSON", strictResponse);
    return NextResponse.json(strictResponse);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("[lit-qc] CRITICAL FAILURE", error);
    return NextResponse.json({ error: "CRITICAL FAILURE", message: error.message, stack: error.stack }, { status: 500 });
  }
}
