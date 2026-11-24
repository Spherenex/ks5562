const STEPS = ['Monitoring', 'Fault Detected', 'Relay Isolating', 'Section Restored']

function FaultDetectionStepper({ isFault, recentlyRestored }) {
  const activeIndex = isFault ? 2 : recentlyRestored ? 3 : 0
  const toneVar = isFault ? '--status-critical' : '--wave-power'

  return (
    <ol className="detection-stepper" aria-label="Fault detection flow">
      {STEPS.map((label, index) => {
        const isActive = index === activeIndex
        const isDone = index < activeIndex || (index === 0 && !isFault)
        return (
          <li
            key={label}
            className={[
              'detection-stepper__step',
              isDone ? 'detection-stepper__step--done' : '',
              isActive ? 'detection-stepper__step--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={isActive ? { '--stepper-tone': `var(${toneVar})` } : undefined}
          >
            <span className="detection-stepper__dot" />
            <span className="detection-stepper__label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export default FaultDetectionStepper
