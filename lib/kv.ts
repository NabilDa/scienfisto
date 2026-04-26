/**
 * Vercel KV helpers for the Learning Loop.
 * Subtask 2 stub — returns empty arrays until Vercel KV is configured.
 * Full implementation added in Subtask 3.
 */

import type { FeedbackCorrection, ExperimentDomain } from "@/types/experiment";

// KV key prefix used by all learning loop operations
export const KV_PREFIX = "scienfisto:feedback";

export function correctionKey(domain: ExperimentDomain): string {
  return `${KV_PREFIX}:${domain}`;
}

/**
 * Fetch the most recent corrections for a given domain.
 * Returns an empty array when KV is not yet configured or the key doesn't exist.
 */
export async function getCorrectionsForDomain(
  domain: ExperimentDomain,
  limit = 5
): Promise<FeedbackCorrection[]> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return [];
  }

  // Dynamically import @vercel/kv to avoid crashing when KV env vars are absent
  const { kv } = await import("@vercel/kv");
  const key = correctionKey(domain);
  const raw = await kv.lrange<FeedbackCorrection>(key, 0, limit - 1);
  return raw ?? [];
}

/**
 * Store a correction in the KV list for its domain.
 * LPUSH keeps the most recent correction at index 0.
 * List is capped at 50 entries per domain to avoid unbounded growth.
 */
export async function storeCorrection(correction: FeedbackCorrection): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error("Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN.");
  }

  const { kv } = await import("@vercel/kv");
  const key = correctionKey(correction.experiment_domain);
  await kv.lpush(key, correction);
  await kv.ltrim(key, 0, 49); // keep latest 50 corrections per domain
}
