import { GoogleGenerativeAI } from "@google/generative-ai";

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("Missing env var: GOOGLE_GENERATIVE_AI_API_KEY");
}

export const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

// gemini-2.0-flash is fast, cheap, and supports large context windows — ideal
// for the structured JSON generation task.
export const MODEL_NAME = "gemini-2.0-flash";

export function getModel() {
  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0.2, // low temperature for deterministic structured output
      responseMimeType: "application/json",
    },
  });
}
