import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import ReadingsTrendChart from './components/ReadingsTrendChart'

const SAMPLE_COUNT = 40
const START_TIME = Date.now() - SAMPLE_COUNT * 15000

const history = Array.from({ length: SAMPLE_COUNT }, (_, i) => {
  const t = i / 5
  return {
    time: START_TIME + i * 15000,
    voltage: 230 + Math.sin(t) * 6 + Math.sin(t * 2.3) * 1.5,
    current: 2.1 + Math.sin(t + 1) * 0.35,
    relay1: 1,
    relay2: 1,
    relay3: 0,
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ReadingsTrendChart history={history} />
  </StrictMode>,
)
