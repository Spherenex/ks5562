import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import FaultLocatorBar from './FaultLocatorBar'
import { locateFault } from '../lib/faultLocation'

const NODE_LABELS = ['A', 'B', 'C', 'D', 'E']
const NODE_SPACING = 3.6
const NODE_X = NODE_LABELS.map((_, index) => (index - (NODE_LABELS.length - 1) / 2) * NODE_SPACING)
const SEGMENT_MID_X = NODE_X.slice(0, -1).map((x, index) => (x + NODE_X[index + 1]) / 2)
const TOWER_HEIGHT = 2.5
const INSULATOR_LENGTH = 0.3
const ATTACH_Y = TOWER_HEIGHT - INSULATOR_LENGTH
// DC feeder: a positive conductor carries current out from the source (A → E) and a
// negative conductor returns it (E → A). There are no phases and no alternation.
const DC_POLES = [
  { key: 'positive', symbol: '+', z: 0.45, direction: 1 },
  { key: 'negative', symbol: '−', z: -0.45, direction: -1 },
]
const POSITIVE_Z = DC_POLES[0].z
const NEGATIVE_Z = DC_POLES[1].z
const SAG = 0.34
const WIRE_MID_Y = ATTACH_Y - SAG
const FAULT_CENTER_Z = 0
const CABINET_Z = 1.75
const SOURCE_Z = 2.5
const PULSES_PER_WIRE = 9
const SPARK_COUNT = 260
const ARC_POINTS = 18
const RESTORE_SWEEP_S = 1.9
const BATTERY_SCALE = 1.4
const CHARGE_PARTICLES_PER_LEAD = 8
const FLIGHT_MS = 1700
const SHAKE_MS = 600
const DRILL_DURATION_MS = 9000
const BASE_TARGET = new THREE.Vector3(0, 1.35, 0)
const BASE_OFFSET = new THREE.Vector3(0, 3.1, 12.8)
const FAULT_OFFSET = new THREE.Vector3(0, 2.3, 9.6)
const FAULT_TARGET_LIFT = 0.6
const HALF_WIDTH_TO_FIT = 9.2
const UP = new THREE.Vector3(0, 1, 0)

const COLORS = {
  good: new THREE.Color('#22d39a'),
  dcReturn: new THREE.Color('#38bdf8'),
  warning: new THREE.Color('#f2b33d'),
  critical: new THREE.Color('#ff3d3d'),
  idle: new THREE.Color('#465066'),
  steel: new THREE.Color('#7f8ba6'),
  hot: new THREE.Color('#fff1c9'),
  bgNormal: new THREE.Color('#070910'),
  bgFault: new THREE.Color('#1c0507'),
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.22, 'rgba(255,255,255,0.85)')
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.18)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Grayscale ramp for alphaMap: bright at the bottom (v=0), fading out toward the top.
function makeVerticalFadeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, 0, 128)
  gradient.addColorStop(0, '#000')
  gradient.addColorStop(0.6, '#555')
  gradient.addColorStop(1, '#fff')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 4, 128)
  return new THREE.CanvasTexture(canvas)
}

function createLabelSprite(text, { scale = 0.6, ring = 'rgba(255,255,255,0.35)', fontSize = 64 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(8, 10, 16, 0.85)'
  ctx.beginPath()
  ctx.arc(64, 64, 56, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = ring
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.fillStyle = '#fffdf7'
  ctx.font = `700 ${fontSize}px "Times New Roman", Georgia, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 70)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.setScalar(scale)
  return sprite
}

function cylinderBetween(a, b, radius, material) {
  const direction = new THREE.Vector3().subVectors(b, a)
  const length = direction.length()
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6), material)
  mesh.position.copy(a).addScaledVector(direction, 0.5)
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize())
  return mesh
}

function additiveMaterial(color, extra = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    ...extra,
  })
}

function buildTower(x, steelMaterial, insulatorMaterial) {
  const group = new THREE.Group()
  group.position.x = x

  const halfAt = (y) => 0.42 - 0.3 * (y / TOWER_HEIGHT)
  const cornersAt = (y) => {
    const h = halfAt(y)
    return [
      new THREE.Vector3(-h, y, -h),
      new THREE.Vector3(h, y, -h),
      new THREE.Vector3(h, y, h),
      new THREE.Vector3(-h, y, h),
    ]
  }

  // Lattice bracing — rings at each level plus an X on every face between levels.
  const levels = [0.05, 0.6, 1.12, 1.6, 2.05, TOWER_HEIGHT]
  const points = []
  levels.forEach((y, levelIndex) => {
    const ring = cornersAt(y)
    for (let k = 0; k < 4; k += 1) {
      points.push(ring[k], ring[(k + 1) % 4])
    }
    if (levelIndex < levels.length - 1) {
      const next = cornersAt(levels[levelIndex + 1])
      for (let k = 0; k < 4; k += 1) {
        points.push(ring[k], next[(k + 1) % 4], ring[(k + 1) % 4], next[k])
      }
    }
  })

  const armZ = 0.85
  const top = cornersAt(TOWER_HEIGHT)
  const armLow = cornersAt(TOWER_HEIGHT - 0.45)
  ;[-armZ, armZ].forEach((z) => {
    const tip = new THREE.Vector3(0, TOWER_HEIGHT, z)
    const side = z < 0 ? [armLow[0], armLow[1]] : [armLow[2], armLow[3]]
    points.push(tip, side[0], tip, side[1])
  })
  const spireTip = new THREE.Vector3(0, TOWER_HEIGHT + 0.5, 0)
  top.forEach((corner) => points.push(corner, spireTip))

  const lineMaterial = new THREE.LineBasicMaterial({ color: COLORS.steel.clone(), transparent: true, opacity: 0.85 })
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), lineMaterial))

  const bottom = cornersAt(0)
  for (let k = 0; k < 4; k += 1) {
    group.add(cylinderBetween(bottom[k], top[k], 0.03, steelMaterial))
  }
  group.add(cylinderBetween(new THREE.Vector3(0, TOWER_HEIGHT, -armZ), new THREE.Vector3(0, TOWER_HEIGHT, armZ), 0.038, steelMaterial))

  const discGeometry = new THREE.CylinderGeometry(0.068, 0.068, 0.024, 14)
  DC_POLES.forEach(({ z }) => {
    group.add(
      cylinderBetween(new THREE.Vector3(0, TOWER_HEIGHT, z), new THREE.Vector3(0, ATTACH_Y, z), 0.016, insulatorMaterial),
    )
    for (let d = 0; d < 4; d += 1) {
      const disc = new THREE.Mesh(discGeometry, insulatorMaterial)
      disc.position.set(0, TOWER_HEIGHT - 0.06 - d * 0.065, z)
      group.add(disc)
    }
  })

  const padMaterial = additiveMaterial(COLORS.good.clone(), { opacity: 0.5, side: THREE.DoubleSide })
  const pad = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.64, 48), padMaterial)
  pad.rotation.x = -Math.PI / 2
  pad.position.y = 0.012
  group.add(pad)

  const beaconMaterial = new THREE.MeshBasicMaterial({ color: COLORS.good.clone(), toneMapped: false })
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 16), beaconMaterial)
  beacon.position.y = TOWER_HEIGHT + 0.56
  group.add(beacon)

  return { group, lineMaterial, padMaterial, beaconMaterial, beacon }
}

function buildRelayCabinet(index, steelMaterial) {
  const group = new THREE.Group()
  group.position.set(SEGMENT_MID_X[index], 0, CABINET_Z)

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.62, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x232838, metalness: 0.65, roughness: 0.4 }),
  )
  body.position.y = 0.31
  group.add(body)

  const lampMaterial = new THREE.MeshBasicMaterial({ color: COLORS.good.clone(), toneMapped: false })
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), lampMaterial)
  lamp.position.set(0.17, 0.5, 0.185)
  group.add(lamp)

  const postGeometry = new THREE.BoxGeometry(0.05, 0.12, 0.05)
  ;[-0.16, 0.16].forEach((x) => {
    const post = new THREE.Mesh(postGeometry, steelMaterial)
    post.position.set(x, 0.68, 0)
    group.add(post)
  })

  // Knife switch: blade lies flat across both posts when the span is energized and
  // lifts away from the right-hand post when the relay isolates the span.
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9aa6c0,
    metalness: 0.8,
    roughness: 0.25,
    emissive: COLORS.good.clone(),
    emissiveIntensity: 0.6,
  })
  const pivot = new THREE.Group()
  pivot.position.set(-0.16, 0.75, 0)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.026, 0.042), bladeMaterial)
  blade.position.x = 0.17
  pivot.add(blade)
  group.add(pivot)

  const label = createLabelSprite(`R${index + 1}`, { scale: 0.34, fontSize: 54 })
  label.position.y = 1.1
  group.add(label)

  const tetherMaterial = new THREE.LineDashedMaterial({
    color: COLORS.good.clone(),
    dashSize: 0.08,
    gapSize: 0.06,
    transparent: true,
    opacity: 0.45,
  })
  const tether = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(SEGMENT_MID_X[index], 0.9, CABINET_Z),
      new THREE.Vector3(SEGMENT_MID_X[index], WIRE_MID_Y, POSITIVE_Z),
    ]),
    tetherMaterial,
  )
  tether.computeLineDistances()

  return { group, tether, tetherMaterial, lampMaterial, bladeMaterial, pivot }
}

function dashedLead(from, to, color) {
  const material = new THREE.LineDashedMaterial({ color, dashSize: 0.1, gapSize: 0.06, transparent: true, opacity: 0.6 })
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material)
  line.computeLineDistances()
  return { line, material }
}

// Battery bank feeding the line at Pole A, with + and − leads up to the conductors.
function buildDcSource(steelMaterial) {
  const x = NODE_X[0] + 0.15
  const group = new THREE.Group()
  group.position.set(x, 0, SOURCE_Z)

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.12, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1c2130, metalness: 0.6, roughness: 0.45 }),
  )
  plinth.position.y = 0.06
  group.add(plinth)

  // Glass cells with a glowing charge level inside, driven by the 2relay1 charging relay.
  const cellGeometry = new THREE.CylinderGeometry(0.11, 0.11, 0.5, 20)
  const capGeometry = new THREE.CylinderGeometry(0.112, 0.112, 0.08, 20)
  const coreHeight = 0.44
  const coreGeometry = new THREE.CylinderGeometry(0.08, 0.08, coreHeight, 16)
  coreGeometry.translate(0, coreHeight / 2, 0)
  const cellMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b7a99,
    metalness: 0.2,
    roughness: 0.1,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  })
  const capMaterial = new THREE.MeshBasicMaterial({ color: COLORS.good.clone(), toneMapped: false })
  const coreMaterial = new THREE.MeshBasicMaterial({ color: COLORS.good.clone(), toneMapped: false })
  const cores = []
  ;[-0.28, 0, 0.28].forEach((cx) => {
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    core.position.set(cx, 0.15, 0)
    group.add(core)
    cores.push(core)
    const cell = new THREE.Mesh(cellGeometry, cellMaterial)
    cell.position.set(cx, 0.37, 0)
    group.add(cell)
    const cap = new THREE.Mesh(capGeometry, capMaterial)
    cap.position.set(cx, 0.58, 0)
    group.add(cap)
  })
  const terminalGeometry = new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10)
  const positiveTerminal = new THREE.Mesh(terminalGeometry, new THREE.MeshBasicMaterial({ color: 0xff8a5c, toneMapped: false }))
  positiveTerminal.position.set(0.28, 0.66, 0)
  group.add(positiveTerminal)
  const negativeTerminal = new THREE.Mesh(terminalGeometry, steelMaterial)
  negativeTerminal.position.set(-0.28, 0.66, 0)
  group.add(negativeTerminal)

  group.scale.setScalar(BATTERY_SCALE)

  // Leads run from the line at Pole A down to the battery terminals. While charging,
  // current flows in along + (line → battery) and back out along − (battery → line).
  const positivePath = [
    new THREE.Vector3(NODE_X[0], ATTACH_Y, POSITIVE_Z),
    new THREE.Vector3(x + 0.28 * BATTERY_SCALE, 0.7 * BATTERY_SCALE, SOURCE_Z),
  ]
  const negativePath = [
    new THREE.Vector3(x - 0.28 * BATTERY_SCALE, 0.7 * BATTERY_SCALE, SOURCE_Z),
    new THREE.Vector3(NODE_X[0], ATTACH_Y, NEGATIVE_Z),
  ]
  const positiveLead = dashedLead(positivePath[0], positivePath[1], COLORS.good.clone())
  const negativeLead = dashedLead(negativePath[0], negativePath[1], COLORS.dcReturn.clone())

  return {
    group,
    capMaterial,
    coreMaterial,
    cores,
    leads: [positiveLead, negativeLead],
    chargePaths: [
      { from: positivePath[0], to: positivePath[1], color: COLORS.good },
      { from: negativePath[0], to: negativePath[1], color: COLORS.dcReturn },
    ],
    labelAnchor: new THREE.Vector3(x, 1.05 * BATTERY_SCALE, SOURCE_Z),
  }
}

// DC load at Pole E — its lamp only lights while every span from A to E is energized.
function buildDcLoad() {
  const x = NODE_X[NODE_X.length - 1] - 0.15
  const group = new THREE.Group()
  group.position.set(x, 0, SOURCE_Z)

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.5, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x232838, metalness: 0.6, roughness: 0.4 }),
  )
  body.position.y = 0.25
  group.add(body)

  const bulbMaterial = new THREE.MeshBasicMaterial({ color: COLORS.hot.clone(), toneMapped: false })
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 20), bulbMaterial)
  bulb.position.y = 0.66
  group.add(bulb)

  const label = createLabelSprite('LOAD', { scale: 0.42, fontSize: 34 })
  label.position.y = 1.08
  group.add(label)

  const positiveLead = dashedLead(
    new THREE.Vector3(NODE_X[NODE_X.length - 1], ATTACH_Y, POSITIVE_Z),
    new THREE.Vector3(x + 0.2, 0.5, SOURCE_Z),
    COLORS.good.clone(),
  )
  const negativeLead = dashedLead(
    new THREE.Vector3(NODE_X[NODE_X.length - 1], ATTACH_Y, NEGATIVE_Z),
    new THREE.Vector3(x - 0.2, 0.5, SOURCE_Z),
    COLORS.dcReturn.clone(),
  )

  return { group, bulb, bulbMaterial, leads: [positiveLead, negativeLead] }
}

function fillBolt(attribute, from, to, jitter, axisA, axisB) {
  const array = attribute.array
  const count = attribute.count
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1)
    const envelope = i === 0 || i === count - 1 ? 0 : Math.sin(t * Math.PI)
    const a = (Math.random() - 0.5) * jitter * envelope
    const b = (Math.random() - 0.5) * jitter * envelope
    array[i * 3] = from.x + (to.x - from.x) * t + axisA.x * a + axisB.x * b
    array[i * 3 + 1] = from.y + (to.y - from.y) * t + axisA.y * a + axisB.y * b
    array[i * 3 + 2] = from.z + (to.z - from.z) * t + axisA.z * a + axisB.z * b
  }
  attribute.needsUpdate = true
}

function makeBoltLine(color, opacity) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3))
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  line.frustumCulled = false
  return line
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function buildAriaLabel({ segments, voltage, currentRatio, isFault, faultSegment, systemStatus }) {
  const voltageText = typeof voltage === 'number' ? `${voltage.toFixed(0)} volts` : 'voltage unknown'
  const currentText =
    typeof currentRatio === 'number' ? `${(currentRatio * 100).toFixed(0)} percent of nominal current` : 'current unknown'
  const segmentText = segments.map((segment) => `${segment.section} ${segment.isOpen ? 'energized' : 'isolated'}`).join(', ')
  const faultText = isFault ? ` Fault active${faultSegment ? ` at section ${faultSegment.section}` : ''}.` : ''
  return `3D DC feeder animation. System ${systemStatus}. ${voltageText}, ${currentText}. Spans: ${segmentText}.${faultText}`
}

function ProcessAnimation({
  segments,
  voltage,
  current,
  currentRatio,
  isFault,
  faultSection,
  systemStatus,
  batteryCharging = null,
  chargingTarget = null,
  chargingWriteError = '',
}) {
  const mountRef = useRef(null)
  const calloutRef = useRef(null)
  const batteryCalloutRef = useRef(null)
  const stateRef = useRef({ segments: [], voltage: null, currentRatio: null, isFault: false, faultIndex: -1 })
  const drillCycleRef = useRef(0)
  const [drill, setDrill] = useState(null)

  // A drill is a purely local, visual rehearsal of a fault on one span. It never
  // touches App state or the Firebase fault log, and a real fault always wins.
  const isDrill = drill !== null && !isFault
  // The drill previews the fault behaviour (charging cut), but writes nothing to 2relay1.
  const effectiveCharging = isDrill ? false : batteryCharging
  const chargeStatus = (() => {
    if (effectiveCharging === null) {
      return { tone: 'unknown', title: 'Battery', detail: '2relay1 not reported' }
    }
    if (effectiveCharging) {
      return { tone: 'on', title: 'Charging', detail: '2relay1 = 1' }
    }
    if (isFault || isDrill) {
      return { tone: 'off', title: 'Not charging', detail: `Fault${isDrill ? ' (preview)' : ''} · 2relay1 = 0` }
    }
    if (chargingTarget && chargingWriteError) {
      return { tone: 'off', title: 'Not charging', detail: 'Could not set 2relay1 = 1' }
    }
    if (chargingTarget) {
      return { tone: 'pending', title: 'Not charging', detail: 'Switching on… 2relay1 → 1' }
    }
    return { tone: 'off', title: 'Not charging', detail: '2relay1 = 0' }
  })()
  const baseSegments = segments || []
  const effectiveSegments = isDrill
    ? baseSegments.map((segment, index) => (index === drill.index ? { ...segment, isOpen: false } : segment))
    : baseSegments
  const effectiveIsFault = isFault || isDrill
  const effectiveFaultSection = isDrill ? effectiveSegments[drill.index]?.section : faultSection
  const location = locateFault({ isFault: effectiveIsFault, faultSection: effectiveFaultSection, segments: effectiveSegments })
  const faultSegment = location.index >= 0 ? effectiveSegments[location.index] : null

  const [previousFault, setPreviousFault] = useState(effectiveIsFault)
  const [restoreCount, setRestoreCount] = useState(0)
  if (previousFault !== effectiveIsFault) {
    setPreviousFault(effectiveIsFault)
    if (!effectiveIsFault) {
      setRestoreCount((count) => count + 1)
    }
  }

  useEffect(() => {
    stateRef.current = {
      segments: effectiveSegments,
      voltage,
      currentRatio,
      isFault: effectiveIsFault,
      faultIndex: location.index,
      batteryCharging: effectiveCharging,
    }
  })

  useEffect(() => {
    if (!drill) {
      return undefined
    }
    const timeoutId = window.setTimeout(() => setDrill(null), DRILL_DURATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [drill])

  function startDrill() {
    const count = Math.max(1, baseSegments.length)
    const index = drillCycleRef.current % count
    drillCycleRef.current += 1
    setDrill({ index })
  }

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) {
      return undefined
    }

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false

    // ---------- Renderer, scene, camera ----------
    const scene = new THREE.Scene()
    scene.background = COLORS.bgNormal.clone()
    scene.fog = new THREE.FogExp2(COLORS.bgNormal.clone(), 0.035)

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200)
    const basePosition = BASE_TARGET.clone().add(BASE_OFFSET)
    camera.position.copy(basePosition)

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.05
    mount.appendChild(renderer.domElement)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.18)
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(BASE_TARGET)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.enableZoom = false
    controls.minPolarAngle = 0.55
    controls.maxPolarAngle = Math.PI / 2.08
    controls.minAzimuthAngle = -0.8
    controls.maxAzimuthAngle = 0.8
    controls.autoRotateSpeed = 0.35
    if (isCoarsePointer) {
      // Let touch scrolling pass through the canvas instead of trapping the page.
      controls.enabled = false
      renderer.domElement.style.touchAction = 'auto'
    }

    // ---------- Lights ----------
    scene.add(new THREE.HemisphereLight(0x8fa6ff, 0x0b0c12, 0.55))
    const keyLight = new THREE.DirectionalLight(0xfff0dc, 1.1)
    keyLight.position.set(5, 9, 7)
    scene.add(keyLight)
    const rimLight = new THREE.DirectionalLight(0x5d8bff, 0.6)
    rimLight.position.set(-7, 4, -6)
    scene.add(rimLight)

    // ---------- Environment ----------
    const glowTexture = makeGlowTexture()
    const fadeTexture = makeVerticalFadeTexture()

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x090b12, roughness: 0.92, metalness: 0.1 }),
    )
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    const grid = new THREE.GridHelper(80, 80, 0x2c3a5c, 0x141a2a)
    grid.position.y = 0.004
    grid.material.transparent = true
    grid.material.opacity = 0.55
    scene.add(grid)

    const corridor = new THREE.Mesh(
      new THREE.PlaneGeometry(NODE_SPACING * 4 + 2.4, 2.2),
      additiveMaterial(new THREE.Color('#1d3b7a'), { opacity: 0.1 }),
    )
    corridor.rotation.x = -Math.PI / 2
    corridor.position.y = 0.008
    scene.add(corridor)

    const starCount = 700
    const starPositions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i += 1) {
      const radius = 55 + Math.random() * 25
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI * 0.42
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      starPositions[i * 3 + 1] = radius * Math.cos(phi) * 0.6 + 4
      starPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 20
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starMaterial = new THREE.PointsMaterial({
      color: 0xaebdff,
      size: 0.22,
      map: glowTexture,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      fog: false,
    })
    const stars = new THREE.Points(starGeometry, starMaterial)
    scene.add(stars)

    // ---------- Towers ----------
    const steelMaterial = new THREE.MeshStandardMaterial({ color: 0x3d4558, metalness: 0.75, roughness: 0.35 })
    const insulatorMaterial = new THREE.MeshStandardMaterial({
      color: 0x9fb6d0,
      metalness: 0.1,
      roughness: 0.2,
      emissive: 0x2b4a6e,
      emissiveIntensity: 0.4,
    })
    const towers = NODE_X.map((x, index) => {
      const tower = buildTower(x, steelMaterial, insulatorMaterial)
      const label = createLabelSprite(NODE_LABELS[index])
      label.position.y = TOWER_HEIGHT + 1.05
      tower.group.add(label)
      scene.add(tower.group)
      return tower
    })

    const shieldPoints = []
    for (let i = 0; i < NODE_X.length - 1; i += 1) {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(NODE_X[i], TOWER_HEIGHT + 0.5, 0),
        new THREE.Vector3(SEGMENT_MID_X[i], TOWER_HEIGHT + 0.5 - 0.36, 0),
        new THREE.Vector3(NODE_X[i + 1], TOWER_HEIGHT + 0.5, 0),
      )
      shieldPoints.push(...curve.getPoints(20))
    }
    scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(shieldPoints),
        new THREE.LineBasicMaterial({ color: 0x56607a, transparent: true, opacity: 0.6 }),
      ),
    )

    // ---------- Conductors, relays, pulses ----------
    const segmentEntries = SEGMENT_MID_X.map((midX, index) => {
      const conductors = DC_POLES.map((pole) => {
        const material = new THREE.MeshStandardMaterial({
          color: pole.direction > 0 ? 0x2e2a2a : 0x262a36,
          metalness: 0.55,
          roughness: 0.4,
          emissive: COLORS.idle.clone(),
          emissiveIntensity: 0.2,
        })
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(NODE_X[index], ATTACH_Y, pole.z),
          new THREE.Vector3(midX, ATTACH_Y - SAG * 2, pole.z),
          new THREE.Vector3(NODE_X[index + 1], ATTACH_Y, pole.z),
        )
        scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.028, 8, false), material))
        return { pole, curve, material }
      })

      const cabinet = buildRelayCabinet(index, steelMaterial)
      scene.add(cabinet.group)
      scene.add(cabinet.tether)

      return { conductors, ...cabinet }
    })

    // Polarity tags just past Pole A so the + feed and − return are unmistakable.
    DC_POLES.forEach((pole) => {
      const tag = createLabelSprite(pole.symbol, {
        scale: 0.3,
        fontSize: 80,
        ring: pole.direction > 0 ? 'rgba(34,211,154,0.9)' : 'rgba(56,189,248,0.9)',
      })
      tag.position.set(NODE_X[0] + 0.55, ATTACH_Y + 0.22, pole.z)
      scene.add(tag)
    })

    const dcSource = buildDcSource(steelMaterial)
    const dcLoad = buildDcLoad()
    scene.add(dcSource.group, dcLoad.group)
    ;[...dcSource.leads, ...dcLoad.leads].forEach(({ line }) => scene.add(line))

    const chargeCount = dcSource.chargePaths.length * CHARGE_PARTICLES_PER_LEAD
    const chargePositions = new Float32Array(chargeCount * 3)
    const chargeColors = new Float32Array(chargeCount * 3)
    const chargeGeometry = new THREE.BufferGeometry()
    chargeGeometry.setAttribute('position', new THREE.BufferAttribute(chargePositions, 3))
    chargeGeometry.setAttribute('color', new THREE.BufferAttribute(chargeColors, 3))
    const chargeParticles = new THREE.Points(
      chargeGeometry,
      new THREE.PointsMaterial({
        size: 0.26,
        map: glowTexture,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    chargeParticles.frustumCulled = false
    scene.add(chargeParticles)

    const pulseCount = segmentEntries.length * DC_POLES.length * PULSES_PER_WIRE
    const pulsePositions = new Float32Array(pulseCount * 3)
    const pulseColors = new Float32Array(pulseCount * 3)
    const pulseMeta = []
    segmentEntries.forEach((entry, segmentIndex) => {
      entry.conductors.forEach(({ pole, curve }) => {
        for (let i = 0; i < PULSES_PER_WIRE; i += 1) {
          pulseMeta.push({ segmentIndex, curve, direction: pole.direction, offset: i / PULSES_PER_WIRE })
        }
      })
    })
    const pulseGeometry = new THREE.BufferGeometry()
    pulseGeometry.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3))
    pulseGeometry.setAttribute('color', new THREE.BufferAttribute(pulseColors, 3))
    const pulses = new THREE.Points(
      pulseGeometry,
      new THREE.PointsMaterial({
        size: 0.3,
        map: glowTexture,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    pulses.frustumCulled = false
    scene.add(pulses)

    // ---------- Fault effects ----------
    const faultGroup = new THREE.Group()
    faultGroup.visible = false
    scene.add(faultGroup)

    const rings = [0, 1, 2].map(() => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 64),
        additiveMaterial(COLORS.critical.clone(), { opacity: 0, side: THREE.DoubleSide }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(0, 0.02, FAULT_CENTER_Z)
      faultGroup.add(ring)
      return ring
    })

    const dangerDisk = new THREE.Mesh(
      new THREE.CircleGeometry(1.8, 48),
      additiveMaterial(COLORS.critical.clone(), { map: glowTexture, opacity: 0.45 }),
    )
    dangerDisk.rotation.x = -Math.PI / 2
    dangerDisk.position.set(0, 0.016, FAULT_CENTER_Z)
    faultGroup.add(dangerDisk)

    const beamHeight = 9
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.26, beamHeight, 28, 1, true),
      additiveMaterial(COLORS.critical.clone(), { alphaMap: fadeTexture, opacity: 0.45, side: THREE.DoubleSide }),
    )
    beam.position.set(0, beamHeight / 2, FAULT_CENTER_Z)
    faultGroup.add(beam)

    const marker = new THREE.Group()
    marker.position.set(0, TOWER_HEIGHT + 1.25, FAULT_CENTER_Z)
    const markerCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.44, 4),
      new THREE.MeshBasicMaterial({ color: COLORS.critical.clone().multiplyScalar(1.6), toneMapped: false }),
    )
    markerCone.rotation.x = Math.PI
    marker.add(markerCone)
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.35, 48),
      additiveMaterial(COLORS.critical.clone(), { opacity: 0.8, side: THREE.DoubleSide }),
    )
    marker.add(halo)
    faultGroup.add(marker)

    const flare = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: new THREE.Color('#ff7a5c'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    flare.position.set(0, WIRE_MID_Y, FAULT_CENTER_Z)
    faultGroup.add(flare)

    const faultLight = new THREE.PointLight(0xff4a3a, 0, 9, 1.4)
    faultLight.position.set(0, WIRE_MID_Y + 0.2, FAULT_CENTER_Z + 0.4)
    faultGroup.add(faultLight)

    const arcCore = makeBoltLine(0xfff4e0, 1)
    const arcGlowA = makeBoltLine(0xff4a3a, 0.9)
    const arcGlowB = makeBoltLine(0xffa24a, 0.7)
    const strike = makeBoltLine(0xffd9b0, 0.9)
    const arcLines = [arcCore, arcGlowA, arcGlowB, strike]
    arcLines.forEach((line) => {
      line.visible = false
      scene.add(line)
    })

    const sparkPositions = new Float32Array(SPARK_COUNT * 3).fill(-50)
    const sparkColors = new Float32Array(SPARK_COUNT * 3)
    const sparkVelocity = new Float32Array(SPARK_COUNT * 3)
    const sparkLife = new Float32Array(SPARK_COUNT)
    const sparkDecay = new Float32Array(SPARK_COUNT)
    const sparkGeometry = new THREE.BufferGeometry()
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3))
    sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3))
    const sparks = new THREE.Points(
      sparkGeometry,
      new THREE.PointsMaterial({
        size: 0.11,
        map: glowTexture,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    sparks.frustumCulled = false
    scene.add(sparks)
    let sparkCursor = 0
    let sparkBudget = 0

    function emitSpark(x, y, z, power) {
      const i = sparkCursor
      sparkCursor = (sparkCursor + 1) % SPARK_COUNT
      sparkPositions[i * 3] = x
      sparkPositions[i * 3 + 1] = y
      sparkPositions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.55
      const angle = Math.random() * Math.PI * 2
      const speed = (0.5 + Math.random() * 1.9) * power
      sparkVelocity[i * 3] = Math.cos(angle) * speed
      sparkVelocity[i * 3 + 1] = (0.2 + Math.random() * 1.8) * power
      sparkVelocity[i * 3 + 2] = Math.sin(angle) * speed
      sparkLife[i] = 1
      sparkDecay[i] = 1 / (0.45 + Math.random() * 1.0)
    }

    // Restoration sweep: a green wavefront that runs down the line once a fault clears.
    const wavefront = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 3.6),
      additiveMaterial(COLORS.good.clone(), { alphaMap: fadeTexture, opacity: 0, side: THREE.DoubleSide }),
    )
    wavefront.position.set(0, 1.8, 0)
    wavefront.rotation.y = Math.PI / 2
    wavefront.visible = false
    scene.add(wavefront)
    const wavefrontGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: COLORS.good.clone(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    wavefrontGlow.scale.setScalar(1.4)
    wavefrontGlow.visible = false
    scene.add(wavefrontGlow)

    // ---------- Sizing ----------
    let viewWidth = 1
    let viewHeight = 1
    let fitScale = 1

    function resize() {
      viewWidth = mount.clientWidth || 1
      viewHeight = mount.clientHeight || 1
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75)
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(viewWidth, viewHeight, false)
      composer.setPixelRatio(pixelRatio)
      composer.setSize(viewWidth, viewHeight)
      camera.aspect = viewWidth / viewHeight
      camera.updateProjectionMatrix()

      // Pull the camera back on narrow screens so the whole A–E line stays in frame.
      const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      const neededDistance = HALF_WIDTH_TO_FIT / (halfTan * camera.aspect)
      fitScale = Math.max(1, neededDistance / BASE_OFFSET.length())
      basePosition.copy(BASE_TARGET).addScaledVector(BASE_OFFSET, fitScale)
    }
    resize()
    camera.position.copy(basePosition)
    controls.update()

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(mount)

    let isVisible = true
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting
    })
    intersectionObserver.observe(mount)

    // ---------- Camera choreography ----------
    let flight = null
    let shakeUntil = 0
    let lastUserInput = -Infinity
    controls.addEventListener('start', () => {
      lastUserInput = performance.now()
      flight = null
    })
    controls.addEventListener('end', () => {
      lastUserInput = performance.now()
    })

    function flyTo(position, target, now) {
      if (prefersReducedMotion) {
        camera.position.copy(position)
        controls.target.copy(target)
        flight = null
        return
      }
      flight = {
        start: now,
        fromPosition: camera.position.clone(),
        toPosition: position.clone(),
        fromTarget: controls.target.clone(),
        toTarget: target.clone(),
      }
    }

    function faultCenter(index, out) {
      return out.set(SEGMENT_MID_X[index], WIRE_MID_Y, FAULT_CENTER_Z)
    }

    // ---------- Frame loop ----------
    const tmp = new THREE.Vector3()
    const tmpTarget = new THREE.Vector3()
    const shakeOffset = new THREE.Vector3()
    const arcFrom = new THREE.Vector3()
    const arcTo = new THREE.Vector3()
    const strikeTo = new THREE.Vector3()
    const AXIS_X = new THREE.Vector3(1, 0, 0)
    const AXIS_Y = new THREE.Vector3(0, 1, 0)
    const AXIS_Z = new THREE.Vector3(0, 0, 1)
    const color = new THREE.Color()
    const startTime = performance.now()
    let lastFrame = startTime
    let lastArcAt = 0
    let previousFault = false
    let previousFaultIndex = -1
    let sweepStart = -Infinity
    let faultMix = 0
    let frameId

    function animate(now) {
      frameId = requestAnimationFrame(animate)
      if (!isVisible) {
        lastFrame = now
        return
      }

      const dt = Math.min(0.05, (now - lastFrame) / 1000)
      lastFrame = now
      const time = (now - startTime) / 1000
      const state = stateRef.current
      const segmentStates = state.segments || []
      const faultIndex = state.isFault ? state.faultIndex : -1
      const hasLocation = faultIndex >= 0 && faultIndex < SEGMENT_MID_X.length
      const currentRatioValue = typeof state.currentRatio === 'number' ? state.currentRatio : 0.6
      const blink = 0.5 + 0.5 * Math.sin(time * 9)

      // --- State transitions ---
      if (state.isFault && !previousFault) {
        shakeUntil = now + SHAKE_MS
        if (hasLocation) {
          faultCenter(faultIndex, tmpTarget)
          for (let i = 0; i < 90; i += 1) {
            emitSpark(tmpTarget.x, tmpTarget.y, tmpTarget.z, 1.6)
          }
        }
      }
      if (hasLocation && (faultIndex !== previousFaultIndex || !previousFault)) {
        faultCenter(faultIndex, tmpTarget)
        tmpTarget.y += FAULT_TARGET_LIFT
        const offsetX = -SEGMENT_MID_X[faultIndex] * 0.35
        tmp.set(tmpTarget.x + offsetX, tmpTarget.y + FAULT_OFFSET.y * fitScale, tmpTarget.z + FAULT_OFFSET.z * fitScale)
        flyTo(tmp, tmpTarget, now)
      }
      if (!state.isFault && previousFault) {
        sweepStart = time
        flyTo(basePosition, BASE_TARGET, now)
      }
      previousFault = state.isFault
      previousFaultIndex = faultIndex

      // --- Atmosphere ---
      faultMix += ((state.isFault ? 1 : 0) - faultMix) * Math.min(1, dt * 2.5)
      const throb = 0.7 + 0.3 * Math.sin(time * 4)
      scene.background.copy(COLORS.bgNormal).lerp(COLORS.bgFault, faultMix * throb)
      scene.fog.color.copy(scene.background)
      bloomPass.strength = 0.85 + faultMix * 0.5
      stars.rotation.y = time * 0.004

      // --- Restoration sweep ---
      const sweepT = (time - sweepStart) / RESTORE_SWEEP_S
      const sweepActive = sweepT >= 0 && sweepT <= 1
      const sweepX = sweepActive
        ? THREE.MathUtils.lerp(NODE_X[0] - 0.9, NODE_X[NODE_X.length - 1] + 0.9, easeInOutCubic(sweepT))
        : Infinity
      wavefront.visible = sweepActive
      wavefrontGlow.visible = sweepActive
      if (sweepActive) {
        wavefront.position.x = sweepX
        wavefront.material.opacity = Math.sin(sweepT * Math.PI) * 0.9
        wavefrontGlow.position.set(sweepX, WIRE_MID_Y, 0)
        wavefrontGlow.material.opacity = Math.sin(sweepT * Math.PI)
      }

      // --- Towers ---
      towers.forEach((tower, index) => {
        const left = segmentStates[index - 1]
        const right = segmentStates[index]
        const energized = [left, right].some((segment) => segment?.isOpen)
        const isAdjacent = hasLocation && (index === faultIndex || index === faultIndex + 1)
        const sweepBoost = sweepActive ? Math.max(0, 1 - Math.abs(sweepX - NODE_X[index]) / 1.1) : 0

        const baseColor = isAdjacent ? COLORS.critical : energized ? COLORS.good : COLORS.warning
        // DC is steady: healthy beacons hold a constant glow, only a fault makes them blink.
        const intensity = isAdjacent ? 0.6 + blink * 1.4 : 1.15
        tower.beaconMaterial.color.copy(baseColor).multiplyScalar(intensity + sweepBoost * 1.5)
        tower.beacon.scale.setScalar(1 + sweepBoost * 1.3 + (isAdjacent ? blink * 0.5 : 0))
        tower.lineMaterial.color
          .copy(COLORS.steel)
          .lerp(COLORS.critical, isAdjacent ? 0.55 + blink * 0.3 : 0)
          .lerp(COLORS.good, sweepBoost * 0.85)
        tower.padMaterial.color.copy(baseColor)
        tower.padMaterial.opacity = (isAdjacent ? 0.4 + blink * 0.5 : 0.35) + sweepBoost * 0.6
      })

      // --- Spans & relays ---
      segmentEntries.forEach((entry, index) => {
        const info = segmentStates[index]
        // This system's relay convention is inverted from a typical breaker: isOpen means the
        // section is energized/available, while a closed relay isolates the section.
        const energized = info ? info.isOpen : false
        const isFaultSpan = index === faultIndex
        const sweepBoost = sweepActive ? Math.max(0, 1 - Math.abs(sweepX - SEGMENT_MID_X[index]) / 2) : 0
        const flicker = Math.random()

        entry.conductors.forEach(({ pole, material }) => {
          const poleColor = pole.direction > 0 ? COLORS.good : COLORS.dcReturn
          material.emissive.copy(isFaultSpan ? COLORS.critical : energized ? poleColor : COLORS.idle)
          material.emissiveIntensity = isFaultSpan
            ? 0.8 + flicker * 1.4
            : energized
              ? 0.45 + Math.min(0.6, currentRatioValue * 0.22) + sweepBoost * 1.2
              : 0.12
        })

        const targetAngle = energized ? 0 : 1.05
        entry.pivot.rotation.z += (targetAngle - entry.pivot.rotation.z) * Math.min(1, dt * (prefersReducedMotion ? 30 : 5))
        const lampColor = isFaultSpan ? COLORS.critical : energized ? COLORS.good : COLORS.warning
        entry.lampMaterial.color.copy(lampColor).multiplyScalar(isFaultSpan ? 0.4 + blink * 1.8 : 1.3)
        entry.bladeMaterial.emissive.copy(lampColor)
        entry.bladeMaterial.emissiveIntensity = isFaultSpan ? 0.4 + blink : 0.5
        entry.tetherMaterial.color.copy(lampColor)
        entry.tetherMaterial.opacity = isFaultSpan ? 0.4 + blink * 0.5 : 0.35
      })

      // --- Energy pulses ---
      pulseMeta.forEach((meta, k) => {
        const info = segmentStates[meta.segmentIndex]
        const energized = info ? info.isOpen : false
        const isFaultSpan = meta.segmentIndex === faultIndex
        if (!energized) {
          pulsePositions[k * 3 + 1] = -50
          pulseColors[k * 3] = 0
          pulseColors[k * 3 + 1] = 0
          pulseColors[k * 3 + 2] = 0
          return
        }
        // DC: constant-speed, constant-brightness flow in one direction per conductor —
        // out along + (A → E), back along − (E → A). Speed tracks the live current.
        const speed = isFaultSpan ? 0.9 : THREE.MathUtils.clamp(0.1 + currentRatioValue * 0.16, 0.08, 0.55)
        const progress = (time * speed + meta.offset) % 1
        const t = meta.direction > 0 ? progress : 1 - progress
        meta.curve.getPointAt(t, tmp)
        if (isFaultSpan) {
          tmp.x += (Math.random() - 0.5) * 0.05
          tmp.y += (Math.random() - 0.5) * 0.05
        }
        pulsePositions[k * 3] = tmp.x
        pulsePositions[k * 3 + 1] = tmp.y
        pulsePositions[k * 3 + 2] = tmp.z
        color
          .copy(isFaultSpan ? COLORS.critical : meta.direction > 0 ? COLORS.good : COLORS.dcReturn)
          .multiplyScalar(isFaultSpan ? 0.8 + Math.random() * 0.8 : 1.25)
        pulseColors[k * 3] = color.r
        pulseColors[k * 3 + 1] = color.g
        pulseColors[k * 3 + 2] = color.b
      })
      pulseGeometry.attributes.position.needsUpdate = true
      pulseGeometry.attributes.color.needsUpdate = true

      // --- DC source & load ---
      // Series feeder: the load at E is only supplied while every span from A is energized.
      const loadPowered = segmentEntries.every((_, index) => segmentStates[index]?.isOpen) && !state.isFault
      // Battery charging relay (2relay1): 1 → cells fill up in a repeating charge cycle,
      // 0 → charging stopped, level frozen low and blinking red. null → field absent.
      const charging = state.batteryCharging
      dcSource.cores.forEach((core, index) => {
        let level = 0.35
        if (charging === true) {
          level = prefersReducedMotion ? 0.8 : 0.2 + 0.8 * Math.min(1, ((time * 0.45 + index * 0.12) % 1.25) / 1)
        }
        core.scale.y = level
      })
      if (charging === true) {
        dcSource.coreMaterial.color.copy(COLORS.good).multiplyScalar(1.3)
        dcSource.capMaterial.color.copy(COLORS.good).multiplyScalar(1.2)
      } else if (charging === false) {
        dcSource.coreMaterial.color.copy(COLORS.critical).multiplyScalar(0.7)
        dcSource.capMaterial.color.copy(COLORS.critical).multiplyScalar(0.4 + blink)
      } else {
        dcSource.coreMaterial.color.copy(COLORS.idle)
        dcSource.capMaterial.color.copy(COLORS.idle)
      }
      dcSource.leads.forEach(({ material }, index) => {
        material.color.copy(
          charging === true ? dcSource.chargePaths[index].color : charging === false ? COLORS.critical : COLORS.idle,
        )
        material.opacity = charging === true ? 0.75 : 0.3
      })
      dcSource.chargePaths.forEach((path, pathIndex) => {
        for (let i = 0; i < CHARGE_PARTICLES_PER_LEAD; i += 1) {
          const k = pathIndex * CHARGE_PARTICLES_PER_LEAD + i
          if (charging !== true) {
            chargePositions[k * 3 + 1] = -50
            chargeColors[k * 3] = 0
            chargeColors[k * 3 + 1] = 0
            chargeColors[k * 3 + 2] = 0
            continue
          }
          const t = (time * (prefersReducedMotion ? 0.15 : 0.55) + i / CHARGE_PARTICLES_PER_LEAD) % 1
          tmp.lerpVectors(path.from, path.to, t)
          chargePositions[k * 3] = tmp.x
          chargePositions[k * 3 + 1] = tmp.y
          chargePositions[k * 3 + 2] = tmp.z
          color.copy(path.color).multiplyScalar(1.5)
          chargeColors[k * 3] = color.r
          chargeColors[k * 3 + 1] = color.g
          chargeColors[k * 3 + 2] = color.b
        }
      })
      chargeGeometry.attributes.position.needsUpdate = true
      chargeGeometry.attributes.color.needsUpdate = true
      dcLoad.bulbMaterial.color.copy(loadPowered ? COLORS.hot : COLORS.idle).multiplyScalar(loadPowered ? 1.6 : 0.6)
      dcLoad.bulb.scale.setScalar(loadPowered ? 1 : 0.85)
      dcLoad.leads.forEach(({ material }) => {
        material.opacity = loadPowered ? 0.6 : 0.15
      })

      // --- Fault location effects ---
      faultGroup.visible = hasLocation
      arcLines.forEach((line) => {
        line.visible = hasLocation && line !== strike
      })
      if (hasLocation) {
        const centerX = SEGMENT_MID_X[faultIndex]
        faultGroup.position.x = centerX

        rings.forEach((ring, r) => {
          const p = (time * 0.65 + r / rings.length) % 1
          ring.scale.setScalar(0.25 + p * 3.4)
          ring.material.opacity = (1 - p) * 0.75
        })
        dangerDisk.material.opacity = 0.3 + 0.2 * Math.sin(time * 5)
        beam.material.opacity = 0.32 + 0.18 * Math.sin(time * 6)
        marker.position.y = TOWER_HEIGHT + 1.25 + Math.sin(time * 2.6) * 0.12
        markerCone.rotation.y += dt * 2
        halo.quaternion.copy(camera.quaternion)
        halo.scale.setScalar(1 + blink * 0.25)

        const flicker = Math.random()
        flare.scale.setScalar(0.9 + flicker * 1.2)
        flare.material.opacity = 0.65 + flicker * 0.35
        faultLight.intensity = 8 + flicker * 22

        if (now - lastArcAt > (prefersReducedMotion ? 240 : 55)) {
          lastArcAt = now
          // Pole-to-pole short: the arc bridges the + and − conductors.
          arcFrom.set(centerX, WIRE_MID_Y, NEGATIVE_Z)
          arcTo.set(centerX, WIRE_MID_Y, POSITIVE_Z)
          fillBolt(arcCore.geometry.attributes.position, arcFrom, arcTo, 0.22, AXIS_X, AXIS_Y)
          fillBolt(arcGlowA.geometry.attributes.position, arcFrom, arcTo, 0.34, AXIS_X, AXIS_Y)
          fillBolt(arcGlowB.geometry.attributes.position, arcFrom, arcTo, 0.45, AXIS_X, AXIS_Y)
          strike.userData.show = Math.random() < 0.28
          if (strike.userData.show) {
            strikeTo.set(centerX + (Math.random() - 0.5) * 0.8, 0.02, FAULT_CENTER_Z + (Math.random() - 0.5) * 0.8)
            fillBolt(strike.geometry.attributes.position, arcTo, strikeTo, 0.5, AXIS_X, AXIS_Z)
          }
        }
        strike.visible = Boolean(strike.userData.show)

        sparkBudget += dt * (prefersReducedMotion ? 20 : 120)
        while (sparkBudget >= 1) {
          emitSpark(centerX, WIRE_MID_Y, FAULT_CENTER_Z, 1)
          sparkBudget -= 1
        }
      } else {
        sparkBudget = 0
      }

      // --- Spark physics ---
      for (let i = 0; i < SPARK_COUNT; i += 1) {
        if (sparkLife[i] <= 0) {
          sparkColors[i * 3] = 0
          sparkColors[i * 3 + 1] = 0
          sparkColors[i * 3 + 2] = 0
          continue
        }
        sparkLife[i] -= dt * sparkDecay[i]
        sparkVelocity[i * 3 + 1] -= 6.5 * dt
        sparkPositions[i * 3] += sparkVelocity[i * 3] * dt
        sparkPositions[i * 3 + 1] += sparkVelocity[i * 3 + 1] * dt
        sparkPositions[i * 3 + 2] += sparkVelocity[i * 3 + 2] * dt
        if (sparkPositions[i * 3 + 1] < 0.02) {
          sparkPositions[i * 3 + 1] = 0.02
          sparkVelocity[i * 3 + 1] *= -0.35
          sparkVelocity[i * 3] *= 0.6
          sparkVelocity[i * 3 + 2] *= 0.6
        }
        const life = Math.max(0, sparkLife[i])
        sparkColors[i * 3] = 1.6 * life
        sparkColors[i * 3 + 1] = (0.35 + 0.9 * life) * life
        sparkColors[i * 3 + 2] = 0.6 * life * life * life
      }
      sparkGeometry.attributes.position.needsUpdate = true
      sparkGeometry.attributes.color.needsUpdate = true

      // --- Camera ---
      if (flight) {
        const t = Math.min(1, (now - flight.start) / FLIGHT_MS)
        const eased = easeInOutCubic(t)
        camera.position.lerpVectors(flight.fromPosition, flight.toPosition, eased)
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased)
        if (t >= 1) {
          flight = null
        }
      }
      const idle = now - lastUserInput > 8000
      controls.autoRotate = !prefersReducedMotion && !flight && !state.isFault && idle
      if (controls.autoRotate) {
        const azimuth = controls.getAzimuthalAngle()
        if (azimuth > 0.45) {
          controls.autoRotateSpeed = -Math.abs(controls.autoRotateSpeed)
        } else if (azimuth < -0.45) {
          controls.autoRotateSpeed = Math.abs(controls.autoRotateSpeed)
        }
      }
      controls.update(dt)

      const shaking = !prefersReducedMotion && now < shakeUntil
      if (shaking) {
        const amplitude = 0.14 * ((shakeUntil - now) / SHAKE_MS)
        shakeOffset.set((Math.random() - 0.5) * amplitude, (Math.random() - 0.5) * amplitude, 0)
        camera.position.add(shakeOffset)
      }

      composer.render(dt)

      if (shaking) {
        camera.position.sub(shakeOffset)
      }

      // --- HTML callout anchored above the battery bank ---
      const batteryCallout = batteryCalloutRef.current
      if (batteryCallout) {
        tmp.copy(dcSource.labelAnchor).project(camera)
        const bx = (tmp.x * 0.5 + 0.5) * viewWidth
        const by = (-tmp.y * 0.5 + 0.5) * viewHeight
        // Clamp so the label never hangs off the edge of the canvas.
        const clampedX = Math.min(Math.max(bx, 100), viewWidth - 100)
        batteryCallout.style.transform = `translate3d(${clampedX.toFixed(1)}px, ${by.toFixed(1)}px, 0)`
        batteryCallout.style.visibility = tmp.z < 1 && bx > -40 && bx < viewWidth + 40 ? 'visible' : 'hidden'
      }

      // --- HTML callout anchored to the fault marker ---
      const callout = calloutRef.current
      if (callout) {
        if (hasLocation) {
          tmp.set(SEGMENT_MID_X[faultIndex], marker.position.y + 0.35, FAULT_CENTER_Z).project(camera)
          const x = (tmp.x * 0.5 + 0.5) * viewWidth
          const y = (-tmp.y * 0.5 + 0.5) * viewHeight
          callout.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
          callout.style.visibility = tmp.z < 1 ? 'visible' : 'hidden'
        } else {
          callout.style.visibility = 'hidden'
        }
      }
    }

    frameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      controls.dispose()
      scene.traverse((object) => {
        object.geometry?.dispose()
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => {
            Object.values(material).forEach((value) => {
              if (value?.isTexture) {
                value.dispose()
              }
            })
            material.dispose()
          })
        }
      })
      glowTexture.dispose()
      fadeTexture.dispose()
      bloomPass.dispose()
      composer.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  const statusTone = effectiveIsFault ? (isDrill ? 'drill' : 'critical') : 'good'
  const statusText = effectiveIsFault ? (isDrill ? 'Fault drill (preview)' : 'Fault detected') : 'System normal'

  return (
    <div className="process-animation">
      <div className={`process-animation__stage${effectiveIsFault ? ' process-animation__stage--fault' : ''}`}>
        <div
          className="process-animation__canvas"
          ref={mountRef}
          role="img"
          aria-label={buildAriaLabel({
            segments: effectiveSegments,
            voltage,
            currentRatio,
            isFault: effectiveIsFault,
            faultSegment,
            systemStatus,
          })}
        />
        <div className="process-animation__vignette" aria-hidden="true" />

        <div className="feeder-hud" aria-hidden="true">
          <span className="feeder-hud__stack">
            <span className={`feeder-hud__status feeder-hud__status--${statusTone}`}>
              <span className="feeder-hud__dot" />
              {statusText}
            </span>
            <span className={`feeder-hud__charge feeder-hud__charge--${chargeStatus.tone}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M13.5 2 4 13.5h6.5L9 22l10-12.5h-6.6L13.5 2Z" fill="currentColor" />
              </svg>
              Battery: {chargeStatus.title}
            </span>
          </span>
          <span className="feeder-hud__readings">
            <span>
              <em>V DC</em> {typeof voltage === 'number' ? voltage.toFixed(1) : '—'} V
            </span>
            <span>
              <em>I DC</em> {typeof current === 'number' ? current.toFixed(3) : '—'} A
            </span>
          </span>
        </div>

        <div ref={batteryCalloutRef} className={`battery-callout battery-callout--${chargeStatus.tone}`}>
          <div className="battery-callout__inner">
            <span className="battery-callout__icon" aria-hidden="true">
              <span className="battery-callout__fill" />
            </span>
            <span className="battery-callout__text">
              <span className="battery-callout__title">{chargeStatus.title}</span>
              <span className="battery-callout__detail">{chargeStatus.detail}</span>
            </span>
          </div>
        </div>

        <div ref={calloutRef} className={`fault-callout${faultSegment ? ' fault-callout--active' : ''}`} aria-hidden="true">
          <div className="fault-callout__inner">
            <span className="fault-callout__kicker">Fault here</span>
            <span className="fault-callout__section">{faultSegment?.section ?? ''}</span>
          </div>
        </div>

        {effectiveIsFault ? (
          <div className="fault-banner" aria-hidden="true">
            <span className="fault-banner__icon">!</span>
            <span>
              {faultSegment ? (
                <>
                  Fault on <strong>{faultSegment.section}</strong> &middot; Pole {NODE_LABELS[location.index]} &rarr; Pole{' '}
                  {NODE_LABELS[location.index + 1]} &middot; {faultSegment.label ?? `Relay ${location.index + 1}`}{' '}
                  {faultSegment.isOpen ? 'still energized' : 'isolating'}
                </>
              ) : (
                'Fault flagged — section not reported by device'
              )}
            </span>
          </div>
        ) : null}

        {restoreCount > 0 && !effectiveIsFault ? (
          <div key={restoreCount} className="restored-toast" aria-hidden="true">
            Section restored &middot; DC flowing A &rarr; E
          </div>
        ) : null}

        <button type="button" className="process-animation__drill" onClick={startDrill} disabled={isFault || isDrill}>
          {isDrill ? 'Preview running…' : 'Preview fault animation'}
        </button>
        <span className="process-animation__hint" aria-hidden="true">
          Drag to orbit
        </span>
      </div>

      <FaultLocatorBar
        segments={effectiveSegments}
        faultIndex={location.index}
        isFault={effectiveIsFault}
        inferred={location.inferred}
      />

      <ul className="process-animation__legend">
        <li>
          <span className="process-animation__swatch process-animation__swatch--good" />
          + conductor, DC out A &rarr; E (speed tracks current)
        </li>
        <li>
          <span className="process-animation__swatch process-animation__swatch--return" />
          &minus; conductor, DC return E &rarr; A
        </li>
        <li>
          <span className="process-animation__swatch process-animation__swatch--idle" />
          Span isolated (relay switch lifted)
        </li>
        <li>
          <span className="process-animation__swatch process-animation__swatch--critical" />
          Fault location (+/&minus; arc, beam &amp; marker)
        </li>
      </ul>
      <p className="process-animation__caption">
        DC feeder: a battery source at Pole A supplies the load at Pole E, and the load lamp goes dark if any span is
        isolated. The camera flies to a fault the moment it is flagged and sweeps green down the line when the section is
        restored.
        &ldquo;Preview fault animation&rdquo; is a local visual drill only &mdash; it is not logged.
      </p>
    </div>
  )
}

export default ProcessAnimation
