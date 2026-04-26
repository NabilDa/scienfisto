// ---------------------------------------------------------------------------
// Core experiment plan types — shared across all API routes and the UI
// ---------------------------------------------------------------------------

export type NoveltySignal = "not found" | "similar work exists" | "exact match found";

export interface LitQCReference {
  title: string;
  authors: string[];
  year: number;
  url: string;
  relevance_note: string;
}

export interface LitQCResult {
  novelty: NoveltySignal;
  references: LitQCReference[];
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

export interface ProtocolStep {
  step_number: number;
  title: string;
  description: string;
  duration_hours: number;
  critical_notes: string[];
  source_protocol?: string; // e.g. "protocols.io/view/xxx" or "Nature Protocols 2019"
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface Material {
  name: string;
  catalog_number: string;
  supplier: string;
  unit: string;
  quantity_needed: number;
  unit_price_usd: number;
  total_price_usd: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface BudgetItem {
  category: "reagents" | "consumables" | "equipment_rental" | "personnel" | "other";
  description: string;
  unit_price_usd: number;
  quantity: number;
  total_usd: number;
}

export interface BudgetSummary {
  line_items: BudgetItem[];
  subtotal_usd: number;
  contingency_percent: number;
  contingency_usd: number;
  total_usd: number;
  currency: "USD";
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelinePhase {
  phase_number: number;
  name: string;
  start_day: number;
  end_day: number;
  tasks: string[];
  dependencies: number[]; // phase_numbers this phase depends on
  milestone?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationApproach {
  primary_metric: string;
  success_threshold: string;
  control_conditions: string[];
  statistical_method: string;
  expected_n_samples: number;
  failure_modes: string[];
}

// ---------------------------------------------------------------------------
// Top-level experiment plan
// ---------------------------------------------------------------------------

export type ExperimentDomain =
  | "diagnostics"
  | "cell_biology"
  | "gut_health"
  | "climate"
  | "genomics"
  | "pharmacology"
  | "materials_science"
  | "other";

export interface ExperimentPlan {
  experiment_type: string;
  domain: ExperimentDomain;
  summary: string;
  hypothesis: string;
  lit_qc: LitQCResult;
  protocol: ProtocolStep[];
  materials: Material[];
  budget: BudgetSummary;
  timeline: TimelinePhase[];
  validation: ValidationApproach;
  generated_at: string; // ISO timestamp
  grounded: boolean; // true if real catalog data was injected
}

// ---------------------------------------------------------------------------
// Feedback / Learning Loop
// ---------------------------------------------------------------------------

export type FeedbackSection = "protocol" | "materials" | "budget" | "timeline" | "validation";

export interface FeedbackCorrection {
  id: string; // uuid
  experiment_domain: ExperimentDomain;
  experiment_type: string;
  section: FeedbackSection;
  field_path: string; // e.g. "protocol[2].description"
  original_value: string;
  corrected_value: string;
  correction_reason?: string;
  submitted_at: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// API request / response shapes
// ---------------------------------------------------------------------------

export interface GeneratePlanRequest {
  hypothesis: string;
  lit_qc?: LitQCResult;
}

export interface GeneratePlanResponse {
  plan: ExperimentPlan;
}

export interface GetPricesRequest {
  reagent_names: string[];
  domain?: ExperimentDomain;
}

export interface GetPricesResponse {
  reagents: Pick<Material, "name" | "catalog_number" | "supplier" | "unit" | "unit_price_usd">[];
}

export interface FeedbackRequest {
  correction: Omit<FeedbackCorrection, "id" | "submitted_at">;
}

export interface FeedbackResponse {
  ok: boolean;
  id: string;
}
