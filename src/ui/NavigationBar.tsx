import type { RouteStep, StepAction } from '../navigation/types'
import './NavigationBar.css'

const ACTION_ICON: Record<StepAction, string> = {
  start:        '↑',
  continue:     '↑',
  'turn-left':  '↰',
  'turn-right': '↱',
  'turn-around':'↩',
  arrive:       '●',
}

const ACTION_LABEL: Record<StepAction, string> = {
  start:        'Head',
  continue:     'Continue toward',
  'turn-left':  'Turn left toward',
  'turn-right': 'Turn right toward',
  'turn-around':'Turn around toward',
  arrive:       'Arrive at',
}

interface Props {
  step: RouteStep
  stepIndex: number
  totalSteps: number
  onCancel: () => void
  /** Render in normal flow (not absolutely positioned over the content). */
  inline?: boolean
}

export default function NavigationBar({ step, stepIndex, totalSteps, onCancel, inline }: Props) {
  const isLast = stepIndex === totalSteps - 1

  return (
    <div className={`nav-bar${inline ? ' nav-bar--inline' : ''}`}>
      <div className="nav-bar__progress">
        Step {stepIndex + 1} / {totalSteps}
      </div>

      <div className="nav-bar__instruction">
        <span className="nav-bar__icon">{ACTION_ICON[step.action]}</span>
        <div className="nav-bar__text">
          <span className="nav-bar__verb">{ACTION_LABEL[step.action]}</span>
          <span className="nav-bar__dest">{step.toNodeLabel}</span>
        </div>
        {step.action !== 'arrive' && (
          <span className="nav-bar__dist">{step.distanceMeters} m</span>
        )}
      </div>

      <div className="nav-bar__controls">
        {/* Advancement is automatic (localisation-driven); only cancel/done is manual. */}
        <button className="nav-bar__btn nav-bar__btn--cancel" onClick={onCancel}>
          {isLast ? 'Done' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
