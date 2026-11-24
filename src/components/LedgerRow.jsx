function LedgerRow({ label, value, tone = 'neutral', hint }) {
  return (
    <tr className="ledger__row">
      <th scope="row" className="ledger__label">
        {label}
      </th>
      <td className="ledger__value">
        <span className={`ledger__badge ledger__badge--${tone}`}>{value}</span>
        {hint ? <span className="ledger__hint">{hint}</span> : null}
      </td>
    </tr>
  )
}

export default LedgerRow
