function PoleStatusStrip({ poleStatuses, faultSection }) {
  return (
    <div className="pole-status">
      {poleStatuses.map((pole) => {
        const isFaultAdjacent = Boolean(faultSection) && faultSection !== 'NONE' && pole.neighborSections.includes(faultSection)
        const tone = isFaultAdjacent ? 'critical' : pole.energized ? 'good' : 'warning'
        return (
          <div key={pole.label} className={`pole-status__item pole-status__item--${tone}`}>
            <span className="pole-status__id">Pole {pole.label}</span>
            <span className="pole-status__badge">{pole.energized ? 'Energized' : 'Isolated'}</span>
          </div>
        )
      })}
    </div>
  )
}

export default PoleStatusStrip
