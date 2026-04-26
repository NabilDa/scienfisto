"use client";

import { animate, createTimeline } from "animejs";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ExperimentPlan,
  LitQCResult,
  FeedbackCorrection,
  FeedbackSection,
} from "@/types/experiment";

type AppState = "input" | "checking" | "checkpoint" | "generating" | "plan";

const checkingSteps = [
  "Parsing hypothesis",
  "Searching literature via Tavily",
  "Evaluating novelty signal",
];

const generatingSteps = [
  "Grounding catalog data",
  "Drafting protocol & materials",
  "Costing budget & timeline",
];

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handle = () => setReduced(media.matches);
    handle();
    media.addEventListener("change", handle);
    return () => media.removeEventListener("change", handle);
  }, []);
  return reduced;
}

type Theme = "light" | "dark";

const subscribeToTheme = (cb: () => void) => {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
};

const readTheme = (): Theme => {
  const v = document.documentElement.getAttribute("data-theme");
  return v === "dark" ? "dark" : "light";
};

const readServerTheme = (): Theme => "light";

function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, readServerTheme);
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sf-theme", next);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, toggle];
}

// ---------------------------------------------------------------------------
// Particle background (unchanged from Human 1's UI)
// ---------------------------------------------------------------------------

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, tx: 0, ty: 0, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let rafId = 0;
    let pointerFrame = 0;

    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const nodeCount = window.innerWidth <= 768 ? 56 : 96;
    const nodes = Array.from({ length: nodeCount }, () => {
      const baseVx = (Math.random() - 0.5) * 0.32;
      const baseVy = (Math.random() - 0.5) * 0.32;
      return {
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: baseVx,
        vy: baseVy,
        baseVx,
        baseVy,
        radius: 1.1 + Math.random() * 1.6,
        depth: 0.7 + Math.random() * 0.6,
      };
    });

    pointerRef.current.x = window.innerWidth / 2;
    pointerRef.current.y = window.innerHeight / 2;
    pointerRef.current.tx = window.innerWidth / 2;
    pointerRef.current.ty = window.innerHeight / 2;

    const onMove = (ev: PointerEvent) => {
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerRef.current.tx = ev.clientX;
        pointerRef.current.ty = ev.clientY;
        pointerRef.current.active = true;
        pointerFrame = 0;
      });
    };

    const onLeave = () => {
      pointerRef.current.active = false;
    };

    let visible = true;
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) rafId = requestAnimationFrame(loop);
      else cancelAnimationFrame(rafId);
    };

    const rootStyles = getComputedStyle(document.documentElement);
    const readColor = (name: string, fallback: string) =>
      rootStyles.getPropertyValue(name).trim() || fallback;

    const loop = () => {
      if (!visible) return;
      const pointer = pointerRef.current;
      pointer.x += (pointer.tx - pointer.x) * 0.55;
      pointer.y += (pointer.ty - pointer.y) * 0.55;

      const fillColor = readColor("--particle-fill", "rgba(37,99,235,0.4)");
      const lineBase = readColor("--particle-line", "rgba(37,99,235,0.1)");
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const influenceRadius = 240;
      const repelRadius = 56;

      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        n.x += n.vx * n.depth;
        n.y += n.vy * n.depth;
        if (n.x <= 0 || n.x >= window.innerWidth) n.vx *= -1;
        if (n.y <= 0 || n.y >= window.innerHeight) n.vy *= -1;

        let withinInfluence = false;
        if (pointer.active) {
          const dx = pointer.x - n.x;
          const dy = pointer.y - n.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < influenceRadius) {
            withinInfluence = true;
            const falloff = 1 - dist / influenceRadius;
            n.vx += (dx / dist) * 0.18 * falloff * n.depth;
            n.vy += (dy / dist) * 0.18 * falloff * n.depth;
          }
          if (dist > 0 && dist < repelRadius) {
            const push = (1 - dist / repelRadius) * 0.42;
            n.vx -= (dx / dist) * push;
            n.vy -= (dy / dist) * push;
          }
        }

        if (withinInfluence) {
          n.vx *= 0.92;
          n.vy *= 0.92;
        } else {
          n.vx += (n.baseVx - n.vx) * 0.06;
          n.vy += (n.baseVy - n.vy) * 0.06;
        }

        const speed = Math.hypot(n.vx, n.vy);
        if (speed > 4) {
          n.vx = (n.vx / speed) * 4;
          n.vy = (n.vy / speed) * 4;
        }
      }

      const linkDist = 90;
      ctx.strokeStyle = lineBase;
      ctx.lineWidth = 0.5;
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < linkDist) {
            ctx.globalAlpha = 1 - d / linkDist;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = fillColor;
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(loop);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
    };
  }, []);

  return <canvas id="particle-bg" ref={canvasRef} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Helpers — formatting / derivation
// ---------------------------------------------------------------------------

const fmtUSD = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const formatRefMeta = (ref: { authors: string[]; year: number; url: string }) => {
  const authorsLabel =
    ref.authors.length === 0
      ? "Unknown authors"
      : ref.authors.length <= 3
        ? ref.authors.join(", ")
        : `${ref.authors.slice(0, 2).join(", ")} et al.`;
  let host = "Source";
  try {
    host = new URL(ref.url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore invalid URLs */
  }
  return `${authorsLabel} · ${host} · ${ref.year}`;
};

const litSummary = (lit: LitQCResult): string => {
  if (lit.references.length === 0) {
    return "No related work was found in the literature search. Your hypothesis appears to break new ground.";
  }
  return `Surfaced ${lit.references.length} related ${lit.references.length === 1 ? "study" : "studies"}. Review the references below before generating the experiment plan.`;
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Home() {
  const [appState, setAppState] = useState<AppState>("input");
  const [hypothesis, setHypothesis] = useState("");
  const [typedMessage, setTypedMessage] = useState("");
  const [showDots, setShowDots] = useState(true);
  const [checkingIndex, setCheckingIndex] = useState(0);
  const [generatingIndex, setGeneratingIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [activeSection, setActiveSection] = useState("protocol");

  // ---- API state ----
  const [litQC, setLitQC] = useState<LitQCResult | null>(null);
  const [plan, setPlan] = useState<ExperimentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- Feedback state ----
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [openCorrection, setOpenCorrection] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const reducedMotion = useReducedMotion();
  const [theme, toggleTheme] = useTheme();
  const stateRef = useRef<HTMLDivElement | null>(null);
  const hypothesisTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const noveltyTone = useMemo(() => {
    if (!litQC) return "amber";
    if (litQC.novelty === "not found") return "green";
    if (litQC.novelty === "exact match found") return "red";
    return "amber";
  }, [litQC]);

  // ---- Greeting typewriter ----
  useEffect(() => {
    if (appState !== "input") return;
    const dotsTimeout = window.setTimeout(() => {
      setShowDots(false);
      const sentence = "Hello. What scientific question will you explore today?";
      let i = 0;
      const typer = window.setInterval(() => {
        i += 1;
        setTypedMessage(sentence.slice(0, i));
        if (i >= sentence.length) window.clearInterval(typer);
      }, 22);
      return () => window.clearInterval(typer);
    }, 400);
    return () => window.clearTimeout(dotsTimeout);
  }, [appState]);

  // ---- Stage entrance animation ----
  useEffect(() => {
    if (!stateRef.current || reducedMotion) return;
    animate(stateRef.current, {
      opacity: [0, 1],
      translateY: [16, 0],
      duration: 460,
      ease: "cubicBezier(0.16, 1, 0.3, 1)",
    });
  }, [appState, reducedMotion]);

  // ---- Input intro animation ----
  useEffect(() => {
    if (appState !== "input" || reducedMotion) return;
    const timeline = createTimeline({
      defaults: { ease: "cubicBezier(0.16, 1, 0.3, 1)" },
    });
    timeline
      .add(".sf-header", { opacity: [0, 1], translateY: [-8, 0], duration: 260 })
      .add(".hero-eyebrow", { opacity: [0, 1], translateY: [8, 0], duration: 180 })
      .add(".hero-line-1", { opacity: [0, 1], translateY: [18, 0], duration: 420 })
      .add(".hero-line-2", { opacity: [0, 1], translateY: [18, 0], duration: 420 }, "-=340")
      .add(".sf-chat-shell", { opacity: [0, 1], translateY: [16, 0], duration: 360 }, "-=140");
  }, [appState, reducedMotion]);

  // ---- Lit-QC API call (triggered when entering "checking") ----
  useEffect(() => {
    if (appState !== "checking") return;

    setCheckingIndex(0);
    setProgress(0);
    setError(null);
    const started = Date.now();
    const minDurationMs = 2000;

    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const pct = Math.min(95, (elapsed / 5000) * 100);
      setProgress(pct);
    }, 60);

    const stepTimer = window.setInterval(() => {
      setCheckingIndex((prev) => Math.min(prev + 1, checkingSteps.length - 1));
    }, 1500);

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/lit-qc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hypothesis }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? `Literature check failed (${res.status})`);
        }
        const data = (await res.json()) as LitQCResult;
        if (cancelled) return;

        const elapsed = Date.now() - started;
        const wait = Math.max(0, minDurationMs - elapsed);
        window.setTimeout(() => {
          if (cancelled) return;
          setLitQC(data);
          setCheckingIndex(checkingSteps.length - 1);
          setProgress(100);
          setAppState("checkpoint");
        }, wait);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Literature check failed.");
        setAppState("input");
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(progressTimer);
      window.clearInterval(stepTimer);
    };
  }, [appState, hypothesis]);

  // ---- Generate-plan API call (triggered when entering "generating") ----
  useEffect(() => {
    if (appState !== "generating") return;
    if (!litQC) return;

    setGeneratingIndex(0);
    setProgress(0);
    setError(null);
    const started = Date.now();

    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const pct = Math.min(92, (elapsed / 30000) * 100);
      setProgress(pct);
    }, 100);

    const stepTimer = window.setInterval(() => {
      setGeneratingIndex((prev) => Math.min(prev + 1, generatingSteps.length - 1));
    }, 5000);

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/generate-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hypothesis, lit_qc: litQC }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? `Plan generation failed (${res.status})`);
        }
        const data = (await res.json()) as { plan: ExperimentPlan };
        if (cancelled) return;
        setPlan(data.plan);
        setProgress(100);
        setAppState("plan");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Plan generation failed.");
        setAppState("checkpoint");
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(progressTimer);
      window.clearInterval(stepTimer);
    };
  }, [appState, litQC, hypothesis]);

  // ---- Active section tracking on the plan page ----
  useEffect(() => {
    if (appState !== "plan") return;
    const ids = ["protocol", "materials", "budget", "timeline", "validation", "feedback"];
    const headerOffset = 120;

    const computeActive = () => {
      const scrollY = window.scrollY;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top + scrollY;
        if (top - headerOffset <= scrollY) current = id;
        else break;
      }
      const nearBottom =
        window.innerHeight + scrollY >= document.documentElement.scrollHeight - 24;
      if (nearBottom) current = ids[ids.length - 1];
      setActiveSection(current);
    };

    computeActive();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        computeActive();
        raf = 0;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [appState]);

  // ---- Animations on entering checkpoint and plan stages ----
  useEffect(() => {
    if (appState !== "checkpoint" || reducedMotion) return;
    const timeline = createTimeline({ defaults: { ease: "cubicBezier(0.16, 1, 0.3, 1)" } });
    timeline
      .add(".sf-checkpoint", { opacity: [0, 1], translateY: [14, 0], duration: 360 })
      .add(".sf-signal-strip", { scaleX: [0, 1], duration: 420, transformOrigin: "0% 50%" }, "-=240")
      .add(
        ".sf-ref-row",
        {
          opacity: [0, 1],
          translateY: [6, 0],
          duration: 180,
          delay: (_: unknown, i: number) => i * 45,
        },
        "-=180",
      );
  }, [appState, reducedMotion]);

  useEffect(() => {
    if (appState !== "plan" || reducedMotion) return;
    const timeline = createTimeline({ defaults: { ease: "cubicBezier(0.16, 1, 0.3, 1)" } });
    timeline
      .add(".sf-nav-item", {
        opacity: [0, 1],
        translateX: [-8, 0],
        duration: 220,
        delay: (_: unknown, i: number) => i * 35,
      })
      .add(".sf-lit-banner", { opacity: [0, 1], translateY: [10, 0], duration: 260 }, "-=120")
      .add("#protocol h2", { opacity: [0, 1], translateY: [8, 0], duration: 200 }, "-=160")
      .add(".sf-protocol-card:nth-of-type(-n+2)", { opacity: [0, 1], translateY: [8, 0], duration: 220 }, "-=120");

    const sidebar = document.querySelector(".sf-sidebar");
    sidebar?.classList.add("ready-pulse");
    const pulseTimeout = window.setTimeout(() => sidebar?.classList.remove("ready-pulse"), 620);
    return () => window.clearTimeout(pulseTimeout);
  }, [appState, reducedMotion]);

  useEffect(() => {
    if (appState !== "plan" || reducedMotion) return;
    const activeEl = document.querySelector(".sf-nav-item.active");
    if (!activeEl) return;
    animate(activeEl, {
      opacity: [0.75, 1],
      duration: 160,
      ease: "cubicBezier(0.4, 0, 0.2, 1)",
    });
  }, [activeSection, appState, reducedMotion]);

  // ---- Handlers ----
  const onSubmitHypothesis = () => {
    if (hypothesis.trim().length < 20) {
      setError("Please describe your hypothesis in at least 20 characters.");
      return;
    }
    setError(null);
    setLitQC(null);
    setPlan(null);
    setAppState("checking");
  };

  const onRevise = () => {
    setShowDots(true);
    setTypedMessage("");
    setError(null);
    setAppState("input");
  };

  const onGoHome = () => {
    setShowDots(true);
    setTypedMessage("");
    setCheckingIndex(0);
    setGeneratingIndex(0);
    setProgress(0);
    setHypothesis("");
    setLitQC(null);
    setPlan(null);
    setRatings({});
    setCorrections({});
    setFeedbackSubmitted(false);
    setError(null);
    setAppState("input");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onGeneratePlan = () => {
    setError(null);
    setAppState("generating");
  };

  const autoResizeTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  };

  const onHypothesisChange = (ev: React.ChangeEvent<HTMLTextAreaElement>) => {
    setHypothesis(ev.target.value);
    autoResizeTextarea(ev.target);
  };

  useEffect(() => {
    if (!hypothesisTextareaRef.current) return;
    autoResizeTextarea(hypothesisTextareaRef.current);
  }, [hypothesis, appState]);

  // ---- Feedback submission ----
  const onSubmitFeedback = async () => {
    if (!plan) return;
    setFeedbackSubmitting(true);
    setError(null);

    type Pending = Omit<FeedbackCorrection, "id" | "submitted_at">;
    const pending: Pending[] = [];

    plan.protocol.forEach((step, idx) => {
      const stepKey = String(step.step_number);
      const rating = ratings[stepKey];
      const correctionText = corrections[stepKey]?.trim();
      if (!correctionText && !rating) return;

      const section: FeedbackSection = "protocol";
      const fieldPath = `protocol[${idx}].description`;
      const reasonParts: string[] = [];
      if (rating) reasonParts.push(`User rating: ${rating}/5`);
      const correctedValue =
        correctionText && correctionText.length > 0 ? correctionText : step.description;
      if (correctedValue === step.description) return;

      pending.push({
        experiment_domain: plan.domain,
        experiment_type: plan.experiment_type,
        section,
        field_path: fieldPath,
        original_value: step.description,
        corrected_value: correctedValue,
        correction_reason: reasonParts.join(" | ") || undefined,
      });
    });

    if (pending.length === 0) {
      setFeedbackSubmitting(false);
      setError("Add at least one correction before submitting.");
      return;
    }

    try {
      await Promise.all(
        pending.map((correction) =>
          fetch("/api/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correction }),
          }).then((r) => {
            if (!r.ok) throw new Error(`Feedback save failed (${r.status})`);
          })
        )
      );
      setFeedbackSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save feedback.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // ---- Derived plan visuals ----
  const budgetStats = useMemo(() => {
    if (!plan) return [] as { label: string; value: string }[];
    const reagents = plan.budget.line_items
      .filter((li) => li.category === "reagents" || li.category === "consumables")
      .reduce((s, li) => s + li.total_usd, 0);
    return [
      { label: "Total Budget", value: fmtUSD(plan.budget.total_usd) },
      { label: "Consumables", value: fmtUSD(reagents) },
      { label: "Contingency", value: fmtUSD(plan.budget.contingency_usd) },
    ];
  }, [plan]);

  const budgetBreakdown = useMemo(() => {
    if (!plan) return [] as { category: string; fill: number; amount: string }[];
    const items = plan.budget.line_items;
    const max = Math.max(...items.map((li) => li.total_usd), 1);
    const labelMap: Record<string, string> = {
      reagents: "Reagents",
      consumables: "Consumables",
      equipment_rental: "Equipment",
      personnel: "Personnel",
      other: "Other",
    };
    return items.map((li) => ({
      category: labelMap[li.category] ?? li.category,
      fill: Math.round((li.total_usd / max) * 100),
      amount: fmtUSD(li.total_usd),
    }));
  }, [plan]);

  const timelineCards = useMemo(() => {
    if (!plan) return [] as { name: string; days: string; fill: number; dependency: string }[];
    const totalDays = Math.max(...plan.timeline.map((p) => p.end_day), 1);
    return plan.timeline.map((phase) => ({
      name: phase.name,
      days: `Day ${phase.start_day}–${phase.end_day}`,
      fill: Math.round(((phase.end_day - phase.start_day + 1) / totalDays) * 100),
      dependency:
        phase.dependencies.length === 0
          ? "No dependencies"
          : `Depends on phase ${phase.dependencies.join(", ")}`,
    }));
  }, [plan]);

  return (
    <div className="sf-app">
      {appState === "input" && <ParticleCanvas />}

      <header className="sf-header">
        <button type="button" className="sf-wordmark sf-wordmark-btn" onClick={onGoHome}>
          <span className="sf-wordmark-serif">Scien</span>
          <span className="sf-wordmark-mono">Fisto</span>
        </button>
        <div className="sf-header-right">
          <span className="sf-badge">AI Scientist Challenge · 2026</span>
          <button
            type="button"
            className="sf-theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {(appState === "checking" || appState === "generating") && (
        <div className="sf-progress-wrap">
          <div className="sf-progress" style={{ width: `${progress}%` }} />
        </div>
      )}

      <main className="sf-main" key={appState} ref={stateRef}>
        {(appState === "input" ||
          appState === "checking" ||
          appState === "checkpoint" ||
          appState === "generating") && (
          <section className={`sf-center-stage ${appState === "input" ? "input-stage" : ""}`}>
            {appState === "input" && (
              <>
                <p className="hero-eyebrow">AI-POWERED RESEARCH ENGINE</p>
                <h1 className="sf-hero-title">
                  <span className="hero-line-1">Your hypothesis,</span>
                  <span className="hero-line-2">amplified.</span>
                </h1>
              </>
            )}

            <div className="sf-chat-shell">
              <div className="sf-chat-lead">
                <span className="sf-chat-avatar" aria-hidden>
                  <span className="sf-chat-avatar-dot" />
                </span>
                <p>
                  {appState === "input" && (
                    <span>{showDots ? <span className="sf-dots">● ● ●</span> : typedMessage}</span>
                  )}
                  {appState === "checking" && (
                    <span>On it. Searching the literature and evaluating your hypothesis.</span>
                  )}
                  {appState === "checkpoint" && (
                    <span>Here&apos;s what I found in the literature before generating your plan.</span>
                  )}
                  {appState === "generating" && (
                    <span>Generating your operationally realistic experiment plan.</span>
                  )}
                </p>
              </div>

              {(appState === "input" || appState === "checking") && (
                <div className="sf-input-stack">
                  <textarea
                    ref={hypothesisTextareaRef}
                    value={hypothesis}
                    onChange={onHypothesisChange}
                    placeholder="Describe your scientific question in plain language..."
                    readOnly={appState === "checking"}
                  />
                  <div className="sf-input-row">
                    <span className="sf-input-meta">
                      <span className="sf-input-meta-dot" aria-hidden />
                      ScienFisto · Research v1
                    </span>
                    <button type="button" onClick={onSubmitHypothesis} disabled={appState === "checking"}>
                      {appState === "checking" ? "Working..." : "Explore"}
                    </button>
                  </div>
                </div>
              )}

              {error && appState === "input" && (
                <div className="sf-error-banner">{error}</div>
              )}
            </div>

            {(appState === "checking" || appState === "generating") && (
              <div className="sf-stepper">
                {(appState === "checking" ? checkingSteps : generatingSteps).map((step, index) => {
                  const idx = appState === "checking" ? checkingIndex : generatingIndex;
                  const done = index < idx;
                  const active = index === idx;
                  return (
                    <div className={`sf-step ${active ? "is-active" : ""}`} key={step}>
                      <span className={`sf-step-icon ${done ? "done" : active ? "active" : "pending"}`}>
                        {done ? "✓" : ""}
                      </span>
                      <span className={done ? "done" : active ? "active" : "pending"}>{step}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {appState === "checkpoint" && litQC && (
              <div className="sf-checkpoint">
                <p className="sf-mini-label">LITERATURE REVIEW</p>
                <article className="sf-signal-card">
                  <div className={`sf-signal-strip ${noveltyTone}`} />
                  <div className="sf-signal-body">
                    <span className={`sf-signal-badge ${noveltyTone}`}>{litQC.novelty}</span>
                    <p>{litSummary(litQC)}</p>
                    {litQC.references.length > 0 && <hr />}
                    {litQC.references.map((ref) => (
                      <div key={ref.url} className="sf-ref-row">
                        <div>
                          <h4>{ref.title}</h4>
                          <small>{formatRefMeta(ref)}</small>
                          <p style={{ margin: "4px 0 0", fontSize: "0.85em", opacity: 0.78 }}>
                            {ref.relevance_note}
                          </p>
                        </div>
                        <a href={ref.url} target="_blank" rel="noopener noreferrer" aria-label="Open reference">
                          ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </article>
                {error && <div className="sf-error-banner">{error}</div>}
                <div className="sf-action-row">
                  <button type="button" className="ghost" onClick={onRevise}>
                    ← Revise
                  </button>
                  <button type="button" className="primary" onClick={onGeneratePlan}>
                    Generate experiment plan →
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {appState === "plan" && plan && litQC && (
          <section className="sf-plan-layout">
            <aside className="sf-sidebar">
              <p className="sf-mini-label">SECTIONS</p>
              {(["protocol", "materials", "budget", "timeline", "validation", "feedback"] as const).map(
                (item) => (
                  <button
                    type="button"
                    key={item}
                    className={`sf-nav-item ${activeSection === item ? "active" : ""}`}
                    onClick={() => {
                      const target = document.getElementById(item);
                      if (!target) return;
                      const top = target.getBoundingClientRect().top + window.scrollY - 88;
                      window.scrollTo({ top, behavior: "smooth" });
                    }}
                  >
                    <span>{item[0].toUpperCase() + item.slice(1)}</span>
                    <span className="count">
                      {item === "protocol"
                        ? plan.protocol.length
                        : item === "materials"
                          ? plan.materials.length
                          : item === "timeline"
                            ? plan.timeline.length
                            : ""}
                    </span>
                  </button>
                )
              )}
              <p className="sf-hypo-preview">{hypothesis || "Hypothesis preview will appear here."}</p>
            </aside>

            <div className="sf-plan-main">
              <div className="sf-lit-banner">
                <span className={`sf-signal-badge ${noveltyTone}`}>{litQC.novelty}</span>
                <p>{litSummary(litQC)}</p>
                {litQC.references[0] && (
                  <a href={litQC.references[0].url} target="_blank" rel="noopener noreferrer">
                    References ↗
                  </a>
                )}
              </div>

              <section id="protocol" className="sf-section">
                <h2>Protocol</h2>
                {plan.protocol.map((step) => (
                  <article key={step.step_number} className="sf-protocol-card">
                    <div className="top">
                      <span className="pill">Step {step.step_number}</span>
                      <span className="duration">{step.duration_hours}h</span>
                    </div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.source_protocol && (
                      <small>Source: {step.source_protocol}</small>
                    )}
                    {step.critical_notes.length > 0 && (
                      <small style={{ display: "block", marginTop: 4 }}>
                        ⚠ {step.critical_notes.join(" · ")}
                      </small>
                    )}
                  </article>
                ))}
              </section>

              <section id="materials" className="sf-section">
                <h2>Materials</h2>
                <table className="sf-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Supplier</th>
                      <th>Cat. No.</th>
                      <th>Qty</th>
                      <th>Unit Price</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.materials.map((item) => (
                      <tr key={`${item.catalog_number}-${item.name}`}>
                        <td>{item.name}</td>
                        <td>{item.supplier}</td>
                        <td>
                          <span className="catalog">{item.catalog_number}</span>
                        </td>
                        <td>
                          {item.quantity_needed} {item.unit}
                        </td>
                        <td>{fmtUSD(item.unit_price_usd)}</td>
                        <td>{fmtUSD(item.total_price_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.grounded && (
                  <small style={{ marginTop: 8, display: "block", opacity: 0.7 }}>
                    Catalog numbers grounded against live supplier data.
                  </small>
                )}
              </section>

              <section id="budget" className="sf-section">
                <h2>Budget</h2>
                <div className="sf-stat-grid">
                  {budgetStats.map((stat) => (
                    <article key={stat.label}>
                      <small>{stat.label}</small>
                      <strong>{stat.value}</strong>
                    </article>
                  ))}
                </div>
                {budgetBreakdown.map((row) => (
                  <div key={row.category} className="sf-budget-row">
                    <span>{row.category}</span>
                    <span className="bar">
                      <span style={{ width: `${row.fill}%` }} />
                    </span>
                    <span>{row.amount}</span>
                  </div>
                ))}
              </section>

              <section id="timeline" className="sf-section">
                <h2>Timeline</h2>
                {timelineCards.map((phase) => (
                  <article key={phase.name} className="sf-timeline-card">
                    <div className="top">
                      <h3>{phase.name}</h3>
                      <span>{phase.days}</span>
                    </div>
                    <span className="line">
                      <span style={{ width: `${phase.fill}%` }} />
                    </span>
                    <small>{phase.dependency}</small>
                  </article>
                ))}
              </section>

              <section id="validation" className="sf-section">
                <h2>Validation</h2>
                <article className="sf-validation-primary">
                  <small>Primary metric</small>
                  <p>{plan.validation.primary_metric}</p>
                </article>
                <article className="sf-validation-primary secondary">
                  <small>Success threshold</small>
                  <p>{plan.validation.success_threshold}</p>
                </article>
                {plan.validation.control_conditions.length > 0 && (
                  <ul className="sf-validation-list">
                    {plan.validation.control_conditions.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                <article className="sf-validation-primary secondary">
                  <small>Statistical method · n = {plan.validation.expected_n_samples}</small>
                  <p>{plan.validation.statistical_method}</p>
                </article>
                {plan.validation.failure_modes.length > 0 && (
                  <ul className="sf-validation-list">
                    {plan.validation.failure_modes.map((f) => (
                      <li key={f}>⚠ {f}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section id="feedback" className="sf-section">
                <h2>
                  Feedback <span className="sf-beta">BETA</span>
                </h2>
                <p className="sf-feedback-desc">
                  Rate each protocol step and leave corrections to improve future generations.
                </p>
                {plan.protocol.map((step) => {
                  const stepKey = String(step.step_number);
                  return (
                    <div key={stepKey} className="sf-feedback-row">
                      <span>{step.title}</span>
                      <div className="actions">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            type="button"
                            key={star}
                            className="star"
                            onClick={() => setRatings((prev) => ({ ...prev, [stepKey]: star }))}
                          >
                            {star <= (ratings[stepKey] ?? 0) ? "★" : "☆"}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="correct"
                          onClick={() =>
                            setOpenCorrection((prev) => (prev === stepKey ? null : stepKey))
                          }
                        >
                          Correct →
                        </button>
                      </div>
                      <div className={`correction ${openCorrection === stepKey ? "open" : ""}`}>
                        <textarea
                          placeholder="Describe what should change in this step..."
                          value={corrections[stepKey] ?? ""}
                          onChange={(ev) =>
                            setCorrections((prev) => ({ ...prev, [stepKey]: ev.target.value }))
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setOpenCorrection(null)}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  );
                })}
                {error && <div className="sf-error-banner">{error}</div>}
                {feedbackSubmitted ? (
                  <div className="sf-feedback-success">
                    Thanks — your feedback was saved and will improve the next plan in this domain.
                  </div>
                ) : (
                  <button
                    type="button"
                    className="submit-feedback"
                    onClick={onSubmitFeedback}
                    disabled={feedbackSubmitting}
                  >
                    {feedbackSubmitting ? "Saving..." : "Submit all feedback"}
                  </button>
                )}
              </section>
            </div>
          </section>
        )}
      </main>

      <footer className="sf-footer">
        <div className="sf-footer-inner">
          <span className="sf-footer-mark">
            <span className="sf-wordmark-serif">Scien</span>
            <span className="sf-wordmark-mono">Fisto</span>
          </span>
          <span className="sf-footer-meta">
            © {new Date().getFullYear()} ScienFisto Research. All rights reserved.
          </span>
          <span className="sf-footer-meta sf-footer-version">v1.0 · Research Preview</span>
        </div>
      </footer>
    </div>
  );
}
