import { Fragment } from 'react'

const NODE_LABELS = ['A', 'B', 'C', 'D', 'E']

function BoltIcon() {
  return (
    <svg className="fault-locator__bolt" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13.5 2 4 13.5h6.5L9 22l10-12.5h-6.6L13.5 2Z" fill="currentColor" />
    </svg>
  )
}

function FaultLocatorBar({ segments, faultIndex, isFault, inferred }) {
  const faultSegment = faultIndex >= 0 ? segments[faultIndex] : null

  let readout
  if (faultSegment) {
    readout = (
      <>
        <strong>Fault located on section {faultSegment.section}</strong> — between Pole {NODE_LABELS[faultIndex]} and Pole{' '}
        {NODE_LABELS[faultIndex + 1]}, {faultSegment.label ?? `Relay ${faultIndex + 1}`} (
        {faultSegment.isOpen ? 'span still energized' : 'span isolated'}).
        {inferred ? ' Location inferred from the isolated relay — the device did not report a recognised section.' : ''}
      </>
    )
  } else if (isFault) {
    readout = <strong>Fault reported — the device did not identify which section.</strong>
  } else {
    readout = 'No fault on the feeder. All spans are monitored live.'
  }

  return (
    <div className={`fault-locator${faultSegment ? ' fault-locator--fault' : ''}`}>
      <div className="fault-locator__track" aria-hidden="true">
        {NODE_LABELS.map((label, index) => {
          const segment = segments[index]
          const isAdjacent = faultSegment && (index === faultIndex || index === faultIndex + 1)
          const isFaultSpan = index === faultIndex
          const spanTone = isFaultSpan ? 'fault' : segment?.isOpen ? 'energized' : 'isolated'
          return (
            <Fragment key={label}>
              <span className={`fault-locator__pole${isAdjacent ? ' fault-locator__pole--fault' : ''}`}>{label}</span>
              {index < NODE_LABELS.length - 1 && segment ? (
                <span className={`fault-locator__span fault-locator__span--${spanTone}`}>
                  {isFaultSpan ? <BoltIcon /> : null}
                  <span className="fault-locator__span-label">{segment.label ?? segment.section}</span>
                </span>
              ) : null}
            </Fragment>
          )
        })}
      </div>
      <p className="fault-locator__readout" role="status">
        {readout}
      </p>
    </div>
  )
}

export default FaultLocatorBar
