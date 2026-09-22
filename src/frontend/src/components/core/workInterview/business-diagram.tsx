import {
  FileText,
  GitBranch,
  ListChecks,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { useId, useMemo } from "react";
import type { InterviewStep, WorkOpportunity } from "./types";

export function BusinessDiagram({
  opportunity,
  selectedId,
  onSelect,
  compact = false,
}: {
  opportunity: WorkOpportunity;
  selectedId?: string;
  onSelect: (step: InterviewStep) => void;
  compact?: boolean;
}) {
  const marker = useId().replace(/:/g, "");
  const layout = useMemo(() => {
    const levels = new Map(opportunity.steps.map((s) => [s.id, 0]));
    // Bounded layout even for malformed or cyclic imported diagrams.
    for (let pass = 0; pass < opportunity.steps.length; pass++) {
      let changed = false;
      for (const e of opportunity.edges) {
        if (!levels.has(e.source) || !levels.has(e.target)) continue;
        const next = Math.min(
          opportunity.steps.length - 1,
          levels.get(e.source)! + 1,
        );
        if (next > levels.get(e.target)!) {
          levels.set(e.target, next);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const rows = Array.from(new Set(levels.values())).sort((a, b) => a - b);
    const width = Math.max(
      316,
      ...rows.map(
        (r) =>
          opportunity.steps.filter((s) => levels.get(s.id) === r).length * 174,
      ),
    );
    const positions = new Map<
      string,
      { x: number; y: number; width: number }
    >();
    for (const [index, row] of rows.entries()) {
      const steps = opportunity.steps.filter((s) => levels.get(s.id) === row);
      const nodeWidth = steps.length === 1 ? 256 : 158;
      steps.forEach((step, column) =>
        positions.set(step.id, {
          x: (width / steps.length) * (column + 0.5) - nodeWidth / 2,
          y: index * 112 + 8,
          width: nodeWidth,
        }),
      );
    }
    return { positions, width, height: rows.length * 112 - 20 };
  }, [opportunity]);

  return (
    <div
      className={`wi-diagram-scroll ${compact ? "wi-diagram-compact" : ""}`}
      aria-label="업무 순서 그림"
    >
      <div
        className="wi-diagram"
        style={{ width: layout.width, height: layout.height }}
      >
        <svg
          className="wi-diagram-lines"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id={marker}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M0,0 L7,3.5 L0,7" fill="currentColor" />
            </marker>
          </defs>
          {opportunity.edges.map((edge, index) => {
            const from = layout.positions.get(edge.source);
            const to = layout.positions.get(edge.target);
            if (!from || !to) return null;
            const x1 = from.x + from.width / 2;
            const x2 = to.x + to.width / 2;
            const y1 = from.y + 72;
            const y2 = to.y - 4;
            return (
              <g key={`${edge.source}-${edge.target}-${index}`}>
                <path
                  d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  markerEnd={`url(#${marker})`}
                />
                {edge.label && (
                  <text
                    x={(x1 + x2) / 2 + 8}
                    y={(y1 + y2) / 2 + 4}
                    fontSize="11"
                    fill="currentColor"
                    stroke="var(--wi-panel)"
                    strokeWidth="5"
                    paintOrder="stroke"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {opportunity.steps.map((step) => {
          const position = layout.positions.get(step.id)!;
          const Icon =
            step.kind === "decision"
              ? GitBranch
              : step.kind === "human"
                ? UserRound
                : step.kind === "input"
                  ? FileText
                  : step.kind === "output"
                    ? ListChecks
                    : WandSparkles;
          return (
            <button
              key={step.id}
              type="button"
              className={`wi-diagram-step ${step.id === selectedId ? "is-selected" : ""}`}
              style={{
                left: position.x,
                top: position.y,
                width: position.width,
              }}
              onClick={() => onSelect(step)}
              aria-pressed={step.id === selectedId}
            >
              <span
                className={`wi-step-icon ${step.actor === "user" ? "is-human" : ""}`}
              >
                <Icon size={17} aria-hidden="true" />
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>
                  {step.actor === "user" ? "내가 하는 일" : "AI가 돕는 일"}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
