// Visual step indicator — shows numbered steps with completion state.
// Used for onboarding and multi-step workflows to help users
// understand where they are and what comes next.

interface Step {
  label: string;
  description?: string;
  done?: boolean;
  active?: boolean;
}

interface StepIndicatorProps {
  steps: Step[];
}

export function StepIndicator({ steps }: StepIndicatorProps) {
  return (
    <div className="step-indicator">
      {steps.map((step, i) => (
        <div
          key={i}
          className={`step-item${step.done ? ' is-done' : ''}${step.active ? ' is-active' : ''}`}
        >
          <span className="step-number">
            {step.done ? '\u2713' : i + 1}
          </span>
          <span className="step-content">
            <span className="step-label">{step.label}</span>
            {step.description && (
              <span className="step-desc">{step.description}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
