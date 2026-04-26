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

type AppState = "input" | "checking" | "checkpoint" | "plan";
type Novelty = "similar work exists" | "not found" | "exact match found";

type Reference = {
  title: string;
  meta: string;
  href: string;
};

type ProtocolStep = {
  id: string;
  phase: string;
  title: string;
  description: string;
  duration: string;
  notes: string;
};

type Material = {
  name: string;
  supplier: string;
  catalog: string;
  qty: string;
  unit: string;
  total: string;
};

type TimelinePhase = {
  name: string;
  days: string;
  fill: number;
  dependency: string;
};

const checkingSteps = [
  "Parsing hypothesis",
  "Searching literature via Tavily",
  "Evaluating novelty signal",
];

const mockData: {
  litQC: {
    novelty: Novelty;
    summary: string;
    references: Reference[];
  };
  protocol: ProtocolStep[];
  materials: Material[];
  budgetStats: { label: string; value: string }[];
  budgetBreakdown: { category: string; fill: number; amount: string }[];
  timeline: TimelinePhase[];
  validation: {
    primary: string;
    secondary: string[];
    success: string;
  };
} = {
  litQC: {
    novelty: "similar work exists",
    summary:
      "Your hypothesis aligns with recent mRNA delivery optimization studies in epithelial tumor models, but no direct protocol with the exact co-factor pairing was found.",
    references: [
      {
        title: "Lipid nanoparticle tuning for tumor-targeted mRNA delivery",
        meta: "Y. Chen et al. · Nature Biotech · 2024",
        href: "#",
      },
      {
        title: "In-vivo expression durability in mRNA immunotherapy models",
        meta: "M. Rao et al. · Cell Reports · 2023",
        href: "#",
      },
      {
        title: "Rapid pipeline for mRNA response profiling in cancer lines",
        meta: "A. Farouk et al. · PNAS · 2022",
        href: "#",
      },
    ],
  },
  protocol: [
    {
      id: "01",
      phase: "Preparation",
      title: "Cell Line Conditioning",
      description:
        "Culture and normalize target cell density to ensure response comparability across treatment arms.",
      duration: "4h",
      notes: "Keep passage number under 15 for consistent expression behavior.",
    },
    {
      id: "02",
      phase: "Delivery",
      title: "mRNA-LNP Complex Assembly",
      description:
        "Assemble mRNA and lipid nanoparticles using low-shear mixing and immediate buffer correction.",
      duration: "2h",
      notes: "Validate pH before introducing mRNA to avoid degradation.",
    },
    {
      id: "03",
      phase: "Transfection",
      title: "Dose Curve Application",
      description:
        "Apply graded dose series to define response curve and identify efficacy thresholds.",
      duration: "3h",
      notes: "Record exact incubation start and end times for each plate.",
    },
    {
      id: "04",
      phase: "Readout",
      title: "Signal Acquisition",
      description:
        "Capture primary fluorescence and viability markers at standardized read windows.",
      duration: "6h",
      notes: "Lock exposure settings before first capture to preserve comparability.",
    },
  ],
  materials: [
    {
      name: "mRNA reporter construct",
      supplier: "Thermo Fisher",
      catalog: "MRNA-23944",
      qty: "5",
      unit: "$168",
      total: "$840",
    },
    {
      name: "LNP transfection kit",
      supplier: "Sigma-Aldrich",
      catalog: "LNP-1180",
      qty: "3",
      unit: "$289",
      total: "$867",
    },
    {
      name: "HEK293 media bundle",
      supplier: "Promega",
      catalog: "MED-HEK-771",
      qty: "4",
      unit: "$94",
      total: "$376",
    },
    {
      name: "Fluorescence viability panel",
      supplier: "BioLegend",
      catalog: "FVP-6021",
      qty: "2",
      unit: "$211",
      total: "$422",
    },
  ],
  budgetStats: [
    { label: "Total Budget", value: "$2,505" },
    { label: "Consumables", value: "$1,983" },
    { label: "Contingency", value: "$522" },
  ],
  budgetBreakdown: [
    { category: "Reagents", fill: 78, amount: "$1,954" },
    { category: "Cell Culture", fill: 46, amount: "$551" },
    { category: "Validation", fill: 29, amount: "$364" },
  ],
  timeline: [
    {
      name: "Sample Preparation",
      days: "Day 1-4",
      fill: 10,
      dependency: "None",
    },
    {
      name: "Transfection & Exposure",
      days: "Day 5-10",
      fill: 15,
      dependency: "Sample preparation complete",
    },
    {
      name: "Readout & Analysis",
      days: "Day 11-18",
      fill: 20,
      dependency: "Exposure logs validated",
    },
  ],
  validation: {
    primary:
      "Primary endpoint confirms expression gain over baseline by >= 25% at optimized dose window.",
    secondary: [
      "Replicate variance remains under 10%.",
      "Viability maintains above 80% at peak expression.",
      "Signal trend remains monotonic across dose increments.",
    ],
    success:
      "At least 2 dose groups demonstrate statistically significant improvement with controlled toxicity profile.",
  },
};

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
      // Snappy pointer follow so particles feel alive, not stuck.
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
          // Stronger damping while reacting to the cursor keeps motion controlled.
          n.vx *= 0.92;
          n.vy *= 0.92;
        } else {
          // Outside the cursor's reach, ease velocity back toward each particle's
          // own gentle baseline drift so it returns to its normal alive state.
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

export default function Home() {
  const [appState, setAppState] = useState<AppState>("input");
  const [hypothesis, setHypothesis] = useState("");
  const [typedMessage, setTypedMessage] = useState("");
  const [showDots, setShowDots] = useState(true);
  const [checkingIndex, setCheckingIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [activeSection, setActiveSection] = useState("protocol");
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [openCorrection, setOpenCorrection] = useState<string | null>(null);

  const reducedMotion = useReducedMotion();
  const [theme, toggleTheme] = useTheme();
  const stateRef = useRef<HTMLDivElement | null>(null);
  const hypothesisTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const noveltyTone = useMemo(() => {
    if (mockData.litQC.novelty === "not found") return "green";
    if (mockData.litQC.novelty === "exact match found") return "red";
    return "amber";
  }, []);

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

  useEffect(() => {
    if (!stateRef.current || reducedMotion) return;
    animate(stateRef.current, {
      opacity: [0, 1],
      translateY: [16, 0],
      duration: 460,
      ease: "cubicBezier(0.16, 1, 0.3, 1)",
    });
  }, [appState, reducedMotion]);

  useEffect(() => {
    if (appState !== "input" || reducedMotion) return;
    const timeline = createTimeline({
      defaults: {
        ease: "cubicBezier(0.16, 1, 0.3, 1)",
      },
    });
    timeline
      .add(".sf-header", { opacity: [0, 1], translateY: [-8, 0], duration: 260 })
      .add(".hero-eyebrow", { opacity: [0, 1], translateY: [8, 0], duration: 180 })
      .add(".hero-line-1", { opacity: [0, 1], translateY: [18, 0], duration: 420 })
      .add(".hero-line-2", { opacity: [0, 1], translateY: [18, 0], duration: 420 }, "-=340")
      .add(".sf-chat-shell", { opacity: [0, 1], translateY: [16, 0], duration: 360 }, "-=140");
  }, [appState, reducedMotion]);

  useEffect(() => {
    if (appState !== "checking") return;

    const totalMs = 6000;
    const started = Date.now();

    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const pct = Math.min(100, (elapsed / totalMs) * 100);
      setProgress(pct);
      if (pct >= 100) window.clearInterval(progressTimer);
    }, 60);

    const stepTimer = window.setInterval(() => {
      setCheckingIndex((prev) => Math.min(prev + 1, checkingSteps.length - 1));
    }, 2000);

    const doneTimer = window.setTimeout(() => {
      window.clearInterval(stepTimer);
      setCheckingIndex(checkingSteps.length - 1);
      window.setTimeout(() => setAppState("checkpoint"), 800);
    }, totalMs);

    return () => {
      window.clearInterval(progressTimer);
      window.clearInterval(stepTimer);
      window.clearTimeout(doneTimer);
    };
  }, [appState]);

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
        if (top - headerOffset <= scrollY) {
          current = id;
        } else {
          break;
        }
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

  useEffect(() => {
    if (appState !== "checkpoint" || reducedMotion) return;
    const timeline = createTimeline({
      defaults: { ease: "cubicBezier(0.16, 1, 0.3, 1)" },
    });
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
    const timeline = createTimeline({
      defaults: { ease: "cubicBezier(0.16, 1, 0.3, 1)" },
    });
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

  const onSubmitHypothesis = () => {
    setCheckingIndex(0);
    setProgress(0);
    setAppState("checking");
  };

  const onRevise = () => {
    setShowDots(true);
    setTypedMessage("");
    setAppState("input");
  };

  const onGoHome = () => {
    setShowDots(true);
    setTypedMessage("");
    setCheckingIndex(0);
    setProgress(0);
    setAppState("input");
    window.scrollTo({ top: 0, behavior: "smooth" });
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

      {appState === "checking" && (
        <div className="sf-progress-wrap">
          <div className="sf-progress" style={{ width: `${progress}%` }} />
        </div>
      )}

      <main className="sf-main" key={appState} ref={stateRef}>
        {(appState === "input" || appState === "checking" || appState === "checkpoint") && (
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
                  {appState === "input" && <span>{showDots ? <span className="sf-dots">● ● ●</span> : typedMessage}</span>}
                  {appState === "checking" && <span>On it. Searching the literature and evaluating your hypothesis.</span>}
                  {appState === "checkpoint" && <span>Here&apos;s what I found in the literature before generating your plan.</span>}
                </p>
              </div>

              {(appState === "input" || appState === "checking") && (
                <div className="sf-input-stack">
                  <textarea
                    ref={hypothesisTextareaRef}
                    value={hypothesis}
                    onChange={onHypothesisChange}
                    placeholder="Describe your scientific question in plain language..."
                  />
                  <div className="sf-input-row">
                    <span className="sf-input-meta">
                      <span className="sf-input-meta-dot" aria-hidden />
                      ScienFisto · Research v1
                    </span>
                    <button type="button" onClick={onSubmitHypothesis}>
                      Explore
                    </button>
                  </div>
                </div>
              )}
            </div>

            {appState === "checking" && (
              <div className="sf-stepper">
                {checkingSteps.map((step, index) => {
                  const done = index < checkingIndex;
                  const active = index === checkingIndex;
                  return (
                    <div className={`sf-step ${active ? "is-active" : ""}`} key={step}>
                      <span className={`sf-step-icon ${done ? "done" : active ? "active" : "pending"}`}>
                        {done ? "✓" : ""}
                      </span>
                      <span className={done ? "done" : active ? "active" : "pending"}>
                        {step}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {appState === "checkpoint" && (
              <div className="sf-checkpoint">
                <p className="sf-mini-label">LITERATURE REVIEW</p>
                <article className="sf-signal-card">
                  <div className={`sf-signal-strip ${noveltyTone}`} />
                  <div className="sf-signal-body">
                    <span className={`sf-signal-badge ${noveltyTone}`}>{mockData.litQC.novelty}</span>
                    <p>{mockData.litQC.summary}</p>
                    <hr />
                    {mockData.litQC.references.map((ref) => (
                      <div key={ref.title} className="sf-ref-row">
                        <div>
                          <h4>{ref.title}</h4>
                          <small>{ref.meta}</small>
                        </div>
                        <a href={ref.href} aria-label="Open reference">
                          ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </article>
                <div className="sf-action-row">
                  <button type="button" className="ghost" onClick={onRevise}>
                    ← Revise
                  </button>
                  <button type="button" className="primary" onClick={() => setAppState("plan")}>
                    Generate experiment plan →
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {appState === "plan" && (
          <section className="sf-plan-layout">
            <aside className="sf-sidebar">
              <p className="sf-mini-label">SECTIONS</p>
              {["protocol", "materials", "budget", "timeline", "validation", "feedback"].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={`sf-nav-item ${activeSection === item ? "active" : ""}`}
                  onClick={() => {
                    const target = document.getElementById(item);
                    if (!target) return;
                    const top =
                      target.getBoundingClientRect().top + window.scrollY - 88;
                    window.scrollTo({ top, behavior: "smooth" });
                  }}
                >
                  <span>{item[0].toUpperCase() + item.slice(1)}</span>
                  <span className="count">{item === "protocol" ? "4" : item === "materials" ? "4" : ""}</span>
                </button>
              ))}
              <p className="sf-hypo-preview">{hypothesis || "Hypothesis preview will appear here."}</p>
            </aside>

            <div className="sf-plan-main">
              <div className="sf-lit-banner">
                <span className={`sf-signal-badge ${noveltyTone}`}>{mockData.litQC.novelty}</span>
                <p>{mockData.litQC.summary}</p>
                <a href="#">References ↗</a>
              </div>

              <section id="protocol" className="sf-section">
                <h2>Protocol</h2>
                {mockData.protocol.map((step) => (
                  <article key={step.id} className="sf-protocol-card">
                    <div className="top">
                      <span className="pill">{step.phase}</span>
                      <span className="duration">{step.duration}</span>
                    </div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    <div className="bottom">
                      <button type="button">Annotate →</button>
                    </div>
                    <small>{step.notes}</small>
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
                    {mockData.materials.map((item) => (
                      <tr key={item.catalog}>
                        <td>{item.name}</td>
                        <td>{item.supplier}</td>
                        <td>
                          <span className="catalog">{item.catalog}</span>
                        </td>
                        <td>{item.qty}</td>
                        <td>{item.unit}</td>
                        <td>{item.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section id="budget" className="sf-section">
                <h2>Budget</h2>
                <div className="sf-stat-grid">
                  {mockData.budgetStats.map((stat) => (
                    <article key={stat.label}>
                      <small>{stat.label}</small>
                      <strong>{stat.value}</strong>
                    </article>
                  ))}
                </div>
                {mockData.budgetBreakdown.map((row) => (
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
                {mockData.timeline.map((phase) => (
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
                  <small>Primary endpoint</small>
                  <p>{mockData.validation.primary}</p>
                </article>
                <ul className="sf-validation-list">
                  {mockData.validation.secondary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <article className="sf-validation-primary secondary">
                  <small>Success criteria</small>
                  <p>{mockData.validation.success}</p>
                </article>
              </section>

              <section id="feedback" className="sf-section">
                <h2>
                  Feedback <span className="sf-beta">BETA</span>
                </h2>
                <p className="sf-feedback-desc">
                  Rate each protocol step and leave corrections to improve future generations.
                </p>
                {mockData.protocol.map((step) => (
                  <div key={step.id} className="sf-feedback-row">
                    <span>{step.title}</span>
                    <div className="actions">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          type="button"
                          key={star}
                          className="star"
                          onClick={() => setRatings((prev) => ({ ...prev, [step.id]: star }))}
                        >
                          {star <= (ratings[step.id] ?? 0) ? "★" : "☆"}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="correct"
                        onClick={() => setOpenCorrection((prev) => (prev === step.id ? null : step.id))}
                      >
                        Correct →
                      </button>
                    </div>
                    <div className={`correction ${openCorrection === step.id ? "open" : ""}`}>
                      <textarea placeholder="Add correction details..." />
                      <button type="button">Save</button>
                    </div>
                  </div>
                ))}
                <button type="button" className="submit-feedback">
                  Submit all feedback
                </button>
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
