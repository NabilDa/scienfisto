import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_PROMPT } from "@/lib/prompt";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("Missing env var: GEMINI_API_KEY");
}

export const genAI = new GoogleGenerativeAI(apiKey);

export const MODEL_NAME = "gemini-3-flash-preview";

export function getModel() {
  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    // systemInstruction is the correct way to set a system prompt in Gemini —
    // passing it as a user turn in chat history breaks the conversation structure.
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.2,
      // Experiment plans are large nested JSON objects with multiple protocol
      // steps, materials, budget items, and timeline phases.  8192 was not
      // enough — the model truncated mid-protocol.  32768 is the safe ceiling
      // for current flash-class models.
      maxOutputTokens: 32768,
      // Force structured output so the model cannot wrap the JSON in markdown
      // fences or add prose.  This drastically reduces parser failures.
      responseMimeType: "application/json",
    },
  });
}
