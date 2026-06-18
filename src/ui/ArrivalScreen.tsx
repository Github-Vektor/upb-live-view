import './ArrivalScreen.css'

interface Props {
  destinationLabel: string
  onDone: () => void
}

export default function ArrivalScreen({ destinationLabel, onDone }: Props) {
  return (
    <div className="arrival-screen">
      <div className="arrival-card">
        <div className="arrival-icon">✓</div>
        <h2 className="arrival-title">You've arrived</h2>
        <p className="arrival-dest">{destinationLabel}</p>
        <button className="arrival-btn" onClick={onDone}>Done</button>
      </div>
    </div>
  )
}
