<template>
  <div
    ref="rootRef"
    class="ros-prisma"
    :class="{ 'ros-prisma--low': modoLeve }"
    :dir="estado.idioma === 'ar-AR' ? 'rtl' : 'ltr'"
  >
    <div ref="canvasHost" class="ros-prisma__canvas" />

    <!-- flash on line clear -->
    <div class="ros-prisma__flash" :style="{ opacity: flash }" aria-hidden="true" />

    <!-- HUD -->
    <div v-if="status !== 'ready'" class="ros-prisma__hud" aria-hidden="true">
      <div class="ros-prisma__stat">
        <span class="ros-prisma__stat-label">{{ txt('score') }}</span>
        <span class="ros-prisma__stat-val">{{ score }}</span>
      </div>
      <div class="ros-prisma__stat">
        <span class="ros-prisma__stat-label">{{ txt('lines') }}</span>
        <span class="ros-prisma__stat-val">{{ lines }}</span>
      </div>
      <div class="ros-prisma__stat">
        <span class="ros-prisma__stat-label">{{ txt('level') }}</span>
        <span class="ros-prisma__stat-val">{{ level }}</span>
      </div>
    </div>

    <!-- side panels: hold (tappable) + next preview -->
    <div v-if="status !== 'ready'" class="ros-prisma__panels">
      <button
        type="button"
        class="ros-prisma__panel ros-prisma__panel--hold"
        :aria-label="txt('hold')"
        @click="holdNow"
      >
        <span class="ros-prisma__panel-label">{{ txt('hold') }}</span>
        <div class="ros-prisma__mini">
          <span
            v-for="(c, i) in miniCells(holdType)"
            :key="i"
            class="ros-prisma__mini-cell"
            :style="miniStyle(c)"
          />
        </div>
      </button>
      <div class="ros-prisma__panel" aria-hidden="true">
        <span class="ros-prisma__panel-label">{{ txt('next') }}</span>
        <div v-for="(nt, ni) in nextTypes.slice(0, 3)" :key="ni" class="ros-prisma__mini">
          <span
            v-for="(c, i) in miniCells(nt)"
            :key="i"
            class="ros-prisma__mini-cell"
            :style="miniStyle(c)"
          />
        </div>
      </div>
    </div>

    <!-- top-right controls -->
    <div v-if="status !== 'ready'" class="ros-prisma__top-actions">
      <button
        class="ros-prisma__icon-btn"
        :aria-label="muted ? txt('soundOff') : txt('soundOn')"
        @click="toggleMute"
      >
        <Icone :nome="muted ? 'mudo' : 'som'" :tamanho="18" />
      </button>
    </div>

    <!-- Start -->
    <div v-if="status === 'ready'" class="ros-prisma__start" @click="start">
      <div class="ros-prisma__logo">{{ TITULO }}</div>
      <div class="ros-prisma__tagline">{{ txt('tagline') }}</div>
      <div v-if="best > 0" class="ros-prisma__start-best">👑 {{ txt('best') }} · {{ best }}</div>
      <div class="ros-prisma__cta">{{ txt('tapToPlay') }}</div>
    </div>

    <!-- Game over -->
    <transition name="prisma-pop">
      <div v-if="status === 'over'" class="ros-prisma__over">
        <div class="ros-prisma__over-title">
          {{ isRecord ? txt('newRecord') : txt('over') }}
        </div>
        <div class="ros-prisma__over-score">{{ score }}</div>
        <div class="ros-prisma__over-meta">
          {{ lines }} {{ txt('lines') }} · {{ txt('level') }} {{ level }} · 👑 {{ best }}
        </div>
        <button class="ros-prisma__retry" @click="start">
          <Icone nome="reiniciar" :tamanho="19" />
          {{ txt('retry') }}
        </button>
      </div>
    </transition>

    <!-- Pause -->
    <div v-if="paused && status === 'playing'" class="ros-prisma__pause" @click="paused = false">
      <div class="ros-prisma__pause-title">{{ txt('paused') }}</div>
      <div class="ros-prisma__pause-cta">{{ txt('tapToResume') }}</div>
    </div>

    <!-- Touch controls are gestures on the board itself (drag = move, tap =
         rotate, drag down = soft drop, flick up = hard drop) + the tappable HOLD
         slot above — no on-screen pad obscures the well. -->
  </div>
</template>

<script setup>
// O Prisma. Fala com o sistema só pelo `host` do jogo-sdk: placar, áudio,
// modo leve, métricas e armazenamento chegam por ele, e é por isso que o mesmo
// arquivo roda dentro do RoqueOS, no `yarn dev` do repo e no teste.
//
// O que toca a GPU (renderer, pixel ratio, sombras, materiais, luzes, textura,
// geometria e o corte de qualidade do modo leve) veio do componente do RoqueOS
// SEM MUDANÇA, em 25/09/2026. Só mudou de onde vêm o modo leve, o áudio, o
// texto e o placar. Mexer ali pede teste no iPhone de verdade antes de subir:
// verde no desktop não é verde no iPhone.
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { emModoE2E } from '@roqueos-games/jogo-sdk'
import {
  createGame,
  startGame,
  move,
  rotate,
  softDrop,
  hardDrop,
  holdPiece,
  ghostY,
  lock,
  cellsOf,
  collides,
  dropIntervalMs,
  PIECES,
  SHAPES,
  COLS,
  ROWS,
} from './engine.js'
import { criarSom } from './som.js'
import { traduzir } from './textos.js'
import Icone from './Icone.vue'

const props = defineProps({
  /** O host do contrato v1 do jogo-sdk. */
  host: { type: Object, required: true },
  /** `{ ativo, idioma, textos }`, reativo; quem escreve é o `montar` do jogo. */
  estado: { type: Object, required: true },
})

// O `initThree` lá embaixo tem um `host` só dele (o elemento do canvas) que
// esconde este dentro da função. Ficou assim porque aquele trecho é código de
// GPU e viaja sem mudança; ele não usa o host do SDK.
const host = props.host
const txt = (chave, valores) => traduzir(props.estado.textos, chave, valores)

// "PRISMA" é o nome nos dez idiomas (o `nome` do jogo.json). No front o logo
// lia `prisma.title`, mas essa chave ficou no front, para a doca, e não entrou
// no i18n/ do jogo. Ler o jogo.json daqui não serve: o build do RoqueOS quebra
// com import de JSON direto (ver textos.js).
const TITULO = 'PRISMA'

const COLOR_HEX = ['#22d3ee', '#facc15', '#a855f7', '#4ade80', '#f43f5e', '#3b82f6', '#fb923c']
const COLOR_NUM = COLOR_HEX.map((h) => parseInt(h.slice(1), 16))

// ── Reactive UI ──────────────────────────────────────────────────────────────
const rootRef = ref(null)
const canvasHost = ref(null)
const status = ref('ready')
const paused = ref(false)
const score = ref(0)
const lines = ref(0)
const level = ref(1)
const best = ref(0)
const isRecord = ref(false)
const muted = ref(false)
const isTouch = ref(false)
const flash = ref(0)
const holdType = ref(null)
const nextTypes = ref([])
// O perfil leve para o CSS. O `lowEnd` de baixo é o mesmo valor, para o three.
const modoLeve = ref(false)

// ── Engine + Three (plain) ───────────────────────────────────────────────────
let game = null
let lowEnd = false
let renderer = null
let scene = null
let camera = null
let wellGroup = null
let solidPool = []
let ghostPool = []
let sharedGeo = null
let disposables = []
let rafId = 0
let running = false
let lastT = 0
let resizeObserver = null
let pararIdentidade = null

// gravity / lock-delay
let gravityAcc = 0
let lockAcc = 0
let lockResets = 0
const LOCK_DELAY = 0.5
let camShake = 0

// ── Mini previews (hold / next) ──────────────────────────────────────────────
const miniCells = (type) => {
  if (type == null || type === undefined) return []
  const shape = SHAPES[PIECES[type]][0]
  return shape.map(([x, y]) => ({ x, y, type }))
}
const miniStyle = (c) => ({
  left: `${c.x * 25}%`,
  top: `${c.y * 25}%`,
  background: COLOR_HEX[c.type],
})

// ── Audio ────────────────────────────────────────────────────────────────────
const som = criarSom(host.audio, () => muted.value)

// Chamado de dentro do gesto (toque, clique, tecla), sem `await` antes: o iOS
// só libera o áudio assim.
const primeAudio = () => {
  try {
    host.audio.destravar()?.catch?.(() => {})
  } catch {
    /* best-effort */
  }
}

const buzz = (p) => {
  try {
    navigator.vibrate?.(p)
  } catch {
    /* best-effort */
  }
}

// A chave `muted` vira `roqueos:prisma:muted` no host, a mesma de antes da
// extração.
const toggleMute = () => {
  muted.value = !muted.value
  host.armazenamento.gravar('muted', muted.value ? '1' : '0')
}

// ── Three setup ──────────────────────────────────────────────────────────────
const worldOf = (x, y) => ({ x: x - (COLS - 1) / 2, y: (ROWS - 1) / 2 - y })

const track = (obj) => {
  disposables.push(obj)
  return obj
}

// Faint engraved grid for the back of the well (echoes the reference's dotted
// playfield). Cheap CanvasTexture — dark slab + hairline cell lines + dots.
const makeWellGridTexture = () => {
  const cv = document.createElement('canvas')
  const cell = 40
  cv.width = COLS * cell
  cv.height = ROWS * cell
  let g = null
  try {
    g = cv.getContext('2d')
  } catch {
    g = null
  }
  if (!g) return cv
  const grad = g.createLinearGradient(0, 0, 0, cv.height)
  grad.addColorStop(0, '#141a26')
  grad.addColorStop(1, '#0a0d15')
  g.fillStyle = grad
  g.fillRect(0, 0, cv.width, cv.height)
  g.strokeStyle = 'rgba(150,180,230,0.10)'
  g.lineWidth = 1.5
  for (let x = 0; x <= COLS; x++) {
    g.beginPath()
    g.moveTo(x * cell + 0.5, 0)
    g.lineTo(x * cell + 0.5, cv.height)
    g.stroke()
  }
  for (let y = 0; y <= ROWS; y++) {
    g.beginPath()
    g.moveTo(0, y * cell + 0.5)
    g.lineTo(cv.width, y * cell + 0.5)
    g.stroke()
  }
  g.fillStyle = 'rgba(170,200,255,0.16)'
  for (let x = 0; x <= COLS; x++)
    for (let y = 0; y <= ROWS; y++) {
      g.beginPath()
      g.arc(x * cell, y * cell, 1.5, 0, Math.PI * 2)
      g.fill()
    }
  return cv
}

// Rounded, beveled cube so blocks read as soft "candy gel" bricks (like the
// reference) instead of hard boxes. Built by clamping a segmented box to an
// inner cube then pushing the surplus out by a fixed radius — proper radiused
// edges & corners. Falls back to a plain box where the geometry API is stubbed
// (unit tests), so the render path never throws.
const roundedBoxGeometry = (size, radius, seg) => {
  try {
    const geo = new THREE.BoxGeometry(size, size, size, seg, seg, seg)
    const pos = geo.attributes.position
    const inner = size / 2 - radius
    for (let i = 0; i < pos.count; i++) {
      const cx = Math.max(-inner, Math.min(inner, pos.getX(i)))
      const cy = Math.max(-inner, Math.min(inner, pos.getY(i)))
      const cz = Math.max(-inner, Math.min(inner, pos.getZ(i)))
      const dx = pos.getX(i) - cx
      const dy = pos.getY(i) - cy
      const dz = pos.getZ(i) - cz
      const len = Math.hypot(dx, dy, dz) || 1
      pos.setXYZ(i, cx + (dx / len) * radius, cy + (dy / len) * radius, cz + (dz / len) * radius)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  } catch {
    return new THREE.BoxGeometry(size, size, size)
  }
}

// Glossy translucent gel — clearcoat + inner glow + a touch of transparency so
// stacked bricks read like backlit candy. Low-end degrades to a cheap standard
// material (no clearcoat) but keeps the emissive glow.
const makeBlockMat = () => {
  if (lowEnd) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.45,
      metalness: 0,
      roughness: 0.4,
    })
  }
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xffffff),
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0.34,
    metalness: 0,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    reflectivity: 0.6,
    transparent: true,
    opacity: 0.94,
    envMapIntensity: 1.1,
  })
}

const initThree = () => {
  const host = canvasHost.value
  const w = host.clientWidth || 480
  const h = host.clientHeight || 640

  renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2))
  renderer.setSize(w, h)
  if (!lowEnd) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
  }
  host.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x06070d, 30, 60)

  // gentle downward tilt so the tops of the glossy bricks catch the light
  camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 100)
  camera.position.set(0, 3.4, 23.5)
  camera.lookAt(0, -0.4, 0)

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x10131c, 0.85))
  const key = new THREE.DirectionalLight(0xffffff, 1.15)
  key.position.set(6, 15, 12)
  if (!lowEnd) {
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -COLS
    key.shadow.camera.right = COLS
    key.shadow.camera.top = ROWS
    key.shadow.camera.bottom = -ROWS
    key.shadow.camera.far = 60
    key.shadow.bias = -0.0006
  }
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6688ff, 0.5)
  rim.position.set(-8, -4, 6)
  scene.add(rim)
  // sharp bright spark for the candy specular highlight on the gloss
  const spark = new THREE.PointLight(0xffffff, 0.55, 60)
  spark.position.set(-4, 10, 14)
  scene.add(spark)

  wellGroup = new THREE.Group()
  wellGroup.rotation.y = 0.13
  wellGroup.rotation.x = -0.05
  scene.add(wellGroup)

  // back panel: dark slab with a faint engraved grid (echoes the reference)
  const backMat = track(
    new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(makeWellGridTexture()),
      color: new THREE.Color(0x0d1018),
      roughness: 0.95,
      metalness: 0,
    }),
  )
  const backGeo = track(new THREE.PlaneGeometry(COLS + 1.4, ROWS + 1.4))
  const back = new THREE.Mesh(backGeo, backMat)
  back.position.set(0, 0, -0.62)
  back.receiveShadow = true
  wellGroup.add(back)

  const frameMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x232838),
      emissive: new THREE.Color(0x0a1830),
      emissiveIntensity: 0.4,
      roughness: 0.5,
      metalness: 0.3,
    }),
  )
  const bottomY = worldOf(0, ROWS - 1).y - 0.7
  const floorGeo = track(new THREE.BoxGeometry(COLS + 0.6, 0.35, 1.5))
  const floor = new THREE.Mesh(floorGeo, frameMat)
  floor.position.set(0, bottomY, 0)
  floor.receiveShadow = true
  wellGroup.add(floor)
  const railGeo = track(new THREE.BoxGeometry(0.28, ROWS + 0.4, 1.2))
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, frameMat)
    rail.position.set(sx * (COLS / 2 + 0.02), 0, 0)
    rail.receiveShadow = true
    wellGroup.add(rail)
  }

  sharedGeo = track(roundedBoxGeometry(0.9, lowEnd ? 0.1 : 0.16, lowEnd ? 2 : 4))
}

const solidBlock = (i) => {
  while (solidPool.length <= i) {
    const mat = makeBlockMat()
    disposables.push(mat)
    const m = new THREE.Mesh(sharedGeo, mat)
    m.visible = false
    if (!lowEnd) m.castShadow = true
    wellGroup.add(m)
    solidPool.push(m)
  }
  return solidPool[i]
}

const ghostBlock = (i) => {
  while (ghostPool.length <= i) {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      transparent: true,
      opacity: 0.16,
      roughness: 0.4,
      metalness: 0,
    })
    disposables.push(mat)
    const m = new THREE.Mesh(sharedGeo, mat)
    m.visible = false
    wellGroup.add(m)
    ghostPool.push(m)
  }
  return ghostPool[i]
}

const renderBlocks = () => {
  if (!game) return
  let si = 0
  // settled board
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = game.board[y][x]
      if (!v) continue
      const b = solidBlock(si++)
      const w = worldOf(x, y)
      b.position.set(w.x, w.y, 0)
      b.material.color.setHex(COLOR_NUM[v - 1])
      b.material.emissive.setHex(COLOR_NUM[v - 1])
      b.material.emissiveIntensity = 0.28
      b.visible = true
    }
  }
  // active piece (brighter)
  let gi = 0
  if (game.cur && status.value === 'playing') {
    const hex = COLOR_NUM[game.cur.type]
    for (const [x, y] of cellsOf(game.cur)) {
      if (y < 0) continue
      const b = solidBlock(si++)
      const w = worldOf(x, y)
      b.position.set(w.x, w.y, 0)
      b.material.color.setHex(hex)
      b.material.emissive.setHex(hex)
      b.material.emissiveIntensity = 0.85
      b.visible = true
    }
    // ghost
    const gy = ghostY(game)
    if (gy > game.cur.y) {
      for (const [x, y] of cellsOf({ ...game.cur, y: gy })) {
        if (y < 0) continue
        const g = ghostBlock(gi++)
        const w = worldOf(x, y)
        g.position.set(w.x, w.y, 0)
        g.material.color.setHex(hex)
        g.visible = true
      }
    }
  }
  for (let i = si; i < solidPool.length; i++) solidPool[i].visible = false
  for (let i = gi; i < ghostPool.length; i++) ghostPool[i].visible = false
}

// ── Loop ─────────────────────────────────────────────────────────────────────
const resize = () => {
  if (!renderer || !camera || !canvasHost.value) return
  const w = canvasHost.value.clientWidth || 480
  const h = canvasHost.value.clientHeight || 640
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

const doLock = () => {
  const r = lock(game)
  afterLock(r)
}

const afterLock = (r) => {
  gravityAcc = 0
  lockAcc = 0
  lockResets = 0
  score.value = game.score
  lines.value = game.lines
  const prevLevel = level.value
  level.value = game.level
  syncPreview()
  if (r.cleared > 0) {
    flash.value = r.cleared >= 4 ? 1 : 0.6
    camShake = r.cleared >= 4 ? 0.6 : 0.3
    som.acorde(r.cleared)
    buzz(r.cleared >= 4 ? [30, 40, 30, 60] : [18, 30])
  } else {
    som.baque()
    buzz(10)
  }
  if (level.value > prevLevel) som.bip(880, 'triangle', 0.14, 0.24)
  if (r.over) endGame()
}

const loop = (now) => {
  if (!running) return
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0
  lastT = now

  if (status.value === 'playing' && !paused.value && props.estado.ativo && !document.hidden) {
    const interval = dropIntervalMs(game.level) / 1000
    const canDrop = !collides(game.board, cellsOf({ ...game.cur, y: game.cur.y + 1 }))
    if (canDrop) {
      lockAcc = 0
      gravityAcc += dt
      let guard = 0
      while (gravityAcc >= interval && guard < 4) {
        if (!softDrop(game, false)) break
        gravityAcc -= interval
        guard++
      }
    } else {
      lockAcc += dt
      if (lockAcc >= LOCK_DELAY) doLock()
    }
  }

  if (flash.value > 0) flash.value = Math.max(0, flash.value - dt * 2.5)
  if (camShake > 0) {
    camShake = Math.max(0, camShake - dt * 2)
    if (camera) {
      camera.position.x = (Math.random() - 0.5) * camShake
      camera.position.y = 1.2 + (Math.random() - 0.5) * camShake
    }
  } else if (camera && camera.position.x !== 0) {
    camera.position.set(0, 1.2, 24)
  }

  renderBlocks()
  if (renderer && scene && camera) renderer.render(scene, camera)
  rafId = requestAnimationFrame(loop)
}

const startLoop = () => {
  if (running || !renderer) return
  running = true
  lastT = 0
  rafId = requestAnimationFrame(loop)
}
const stopLoop = () => {
  running = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

// ── Actions ──────────────────────────────────────────────────────────────────
const onShift = () => {
  if (lockResets < 15) {
    lockAcc = 0
    lockResets++
  }
}

const moveLeft = () => {
  if (blocked()) return
  if (move(game, -1)) {
    som.bip(300, 'square', 0.05, 0.05)
    onShift()
  }
}
const moveRight = () => {
  if (blocked()) return
  if (move(game, 1)) {
    som.bip(300, 'square', 0.05, 0.05)
    onShift()
  }
}
const rotateCW = () => {
  if (blocked()) return
  if (rotate(game, 1)) {
    som.bip(520, 'square', 0.06, 0.06)
    buzz(5)
    onShift()
  }
}
const rotateCCW = () => {
  if (blocked()) return
  if (rotate(game, -1)) {
    som.bip(520, 'square', 0.06, 0.06)
    onShift()
  }
}
const softDropOne = () => {
  if (blocked()) return
  if (softDrop(game, true)) {
    score.value = game.score
    gravityAcc = 0
    som.bip(220, 'sine', 0.05, 0.04)
  }
}
const hardDropNow = () => {
  if (blocked()) return
  const r = hardDrop(game)
  score.value = game.score
  afterLock(r)
}
const holdNow = () => {
  if (blocked()) return
  if (holdPiece(game)) {
    holdType.value = game.hold
    syncPreview()
    lockResets = 0
    lockAcc = 0
    som.bip(400, 'triangle', 0.08, 0.1)
    if (game.status === 'over') endGame()
  }
}

const blocked = () => status.value !== 'playing' || paused.value

const syncPreview = () => {
  nextTypes.value = game.queue.slice(0, 3)
  holdType.value = game.hold
}

// ── Game flow ────────────────────────────────────────────────────────────────
const start = () => {
  primeAudio()
  // Semente nova a cada partida. Antes o motor só era criado se ainda não
  // houvesse um, e o do onMounted sempre havia; como o `startGame` recomeça o
  // sorteio da mesma semente, todo "Jogar de novo" repetia a sequência de
  // peças da primeira partida. Defeito do componente antigo, achado na
  // extração em 25/09/2026.
  game = createGame(Math.floor(Math.random() * 1e9) || 1, { best: best.value })
  startGame(game)
  status.value = 'playing'
  paused.value = false
  score.value = 0
  lines.value = 0
  level.value = 1
  isRecord.value = false
  gravityAcc = 0
  lockAcc = 0
  lockResets = 0
  flash.value = 0
  syncPreview()
  host.metricas.evento('game_start')
}

const endGame = () => {
  status.value = 'over'
  camShake = 0.4
  som.perdeu()
  buzz([40, 60, 40])
  if (score.value > best.value) {
    best.value = score.value
    isRecord.value = true
    persistScore()
  }
  host.metricas.evento('game_over', { score: score.value, lines: lines.value })
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
// Só a janela ativa ouve o teclado. O ouvinte é do `window`, então com duas
// janelas de jogo abertas a seta moveria as duas; o `ativo` vem do host (a
// janela em foco, no RoqueOS).
const onKey = (e) => {
  if (!props.estado.ativo) return
  const k = e.key
  if (k === 'p' || k === 'P') {
    if (status.value === 'playing') paused.value = !paused.value
    return
  }
  if ((k === ' ' || k === 'Enter') && status.value !== 'playing') {
    e.preventDefault()
    start()
    return
  }
  if (status.value !== 'playing' || paused.value) return
  switch (k) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      e.preventDefault()
      moveLeft()
      break
    case 'ArrowRight':
    case 'd':
    case 'D':
      e.preventDefault()
      moveRight()
      break
    case 'ArrowDown':
    case 's':
    case 'S':
      e.preventDefault()
      softDropOne()
      break
    case 'ArrowUp':
    case 'x':
    case 'X':
      e.preventDefault()
      rotateCW()
      break
    case 'z':
    case 'Z':
    case 'Control':
      e.preventDefault()
      rotateCCW()
      break
    case ' ':
      e.preventDefault()
      hardDropNow()
      break
    case 'Shift':
    case 'c':
    case 'C':
      e.preventDefault()
      holdNow()
      break
  }
}

// ── Swipe (board) ────────────────────────────────────────────────────────────
let swipe = null
const onPointerDown = (e) => {
  if (e.pointerType !== 'mouse') isTouch.value = true
  if (status.value === 'ready') {
    start()
    return
  }
  if (paused.value) {
    paused.value = false
    return
  }
  if (e.target.closest('button')) return
  swipe = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false }
}
const onPointerMove = (e) => {
  if (!swipe || status.value !== 'playing' || paused.value) return
  const dx = e.clientX - swipe.x
  const dy = e.clientY - swipe.y
  const STEP = 26
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > STEP) {
      moveRight()
      swipe.x = e.clientX
      swipe.moved = true
    } else if (dx < -STEP) {
      moveLeft()
      swipe.x = e.clientX
      swipe.moved = true
    }
  } else if (dy > STEP) {
    softDropOne()
    swipe.y = e.clientY
    swipe.moved = true
  }
}
const onPointerUp = (e) => {
  if (swipe && !swipe.moved && status.value === 'playing' && !paused.value) {
    const dt = Date.now() - swipe.t
    const dy = e.clientY - swipe.y
    if (dy < -40) hardDropNow()
    else if (dt < 250) rotateCW() // a quick tap rotates
  }
  swipe = null
}

// ── Persistence ──────────────────────────────────────────────────────────────
// As chaves `best` e `muted` viram `roqueos:prisma:best` e `roqueos:prisma:muted`
// no host, as mesmas de antes da extração: quem já jogava não perde o recorde,
// e a galeria continua lendo o best dali.
const loadLocal = () => {
  best.value = parseInt(host.armazenamento.ler('best'), 10) || 0
  muted.value = host.armazenamento.ler('muted') === '1'
}
const persistScore = () => {
  host.armazenamento.gravar('best', String(best.value))
  Promise.resolve()
    .then(() => host.placar.salvar({ best: best.value }))
    .catch(() => {})
}
// O placar da conta ganha do local quando é maior, e o local sobe quando é o
// maior. Convidado não tem placar na conta: o host devolve null e ignora o
// salvar.
const syncRemote = async () => {
  try {
    const remoto = await host.placar.carregar()
    const daConta = Number(remoto?.best) || 0
    if (daConta > best.value) {
      best.value = daConta
      host.armazenamento.gravar('best', String(daConta))
    } else if (best.value > daConta) {
      await host.placar.salvar({ best: best.value })
    }
  } catch (err) {
    console.error('[PRISMA] Score sync failed:', err)
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
// A janela que perde o foco pausa a partida e para o laço; a que ganha volta a
// desenhar. O `ativo` vem do host (a janela em foco, no RoqueOS).
watch(
  () => props.estado.ativo,
  (active) => {
    if (!active) {
      if (status.value === 'playing') paused.value = true
      stopLoop()
    } else {
      startLoop()
    }
  },
)

const onVisibility = () => {
  if (document.hidden) {
    if (status.value === 'playing') paused.value = true
    stopLoop()
  } else if (props.estado.ativo) {
    startLoop()
  }
}

onMounted(() => {
  lowEnd = Boolean(host.desempenho.modoLeve())
  modoLeve.value = lowEnd
  isTouch.value = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  loadLocal()
  game = createGame(Math.floor(Math.random() * 1e9) || 1, { best: best.value })
  initThree()
  renderBlocks()
  syncRemote()
  // Quem entra na conta com o jogo aberto vê o recorde da conta sem reabrir.
  pararIdentidade = host.identidade.aoMudar(() => syncRemote())
  startLoop()

  rootRef.value.addEventListener('pointerdown', onPointerDown)
  rootRef.value.addEventListener('pointermove', onPointerMove)
  rootRef.value.addEventListener('pointerup', onPointerUp)
  rootRef.value.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvasHost.value)

  if (emModoE2E()) {
    window.__prisma = {
      get state() {
        return game
      },
      start,
      moveLeft,
      moveRight,
      rotateCW,
      softDropOne,
      hardDropNow,
      holdNow,
      // Cover aid: a colourful jagged stack + an active piece mid-fall.
      stage: () => {
        start()
        const pat = [4, 2, 6, 1, 5, 3, 7, 2, 4, 6]
        for (let y = ROWS - 8; y < ROWS; y++) {
          const h = ROWS - y
          for (let x = 0; x < COLS; x++) {
            // jagged skyline — taller near the middle, a couple of gaps
            if (y >= ROWS - Math.min(8, 2 + ((x * 3 + h) % 6)) && (x + y) % 7 !== 0) {
              game.board[y][x] = pat[(x + y) % pat.length]
            }
          }
        }
        game.cur = { type: 2, rot: 0, x: 3, y: 4 } // a T falling
        score.value = game.score = 8400
        lines.value = game.lines = 24
        level.value = game.level = 3
        syncPreview()
        renderBlocks()
      },
    }
  }
})

onUnmounted(() => {
  stopLoop()
  rootRef.value?.removeEventListener('pointerdown', onPointerDown)
  rootRef.value?.removeEventListener('pointermove', onPointerMove)
  rootRef.value?.removeEventListener('pointerup', onPointerUp)
  rootRef.value?.removeEventListener('pointercancel', onPointerUp)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisibility)
  resizeObserver?.disconnect()
  pararIdentidade?.()
  for (const d of disposables) {
    try {
      d.dispose?.()
    } catch {
      /* best-effort */
    }
  }
  disposables = []
  solidPool = []
  ghostPool = []
  try {
    renderer?.dispose?.()
    if (renderer?.domElement?.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement)
  } catch {
    /* best-effort */
  }
  renderer = null
  scene = null
  camera = null
  if (emModoE2E()) delete window.__prisma
})
</script>

<style scoped lang="scss">
.ros-prisma {
  // Cores de identidade do jogo, como custom property para que um tema consiga
  // alcançá-las. As que vêm do sistema herdam o token do RoqueOS quando ele
  // existe e caem no valor que o tema padrão do RoqueOS dá, em 25/09/2026,
  // quando o jogo roda sozinho: fora do RoqueOS não há `tokens-root.scss`
  // nenhum carregado.
  --ros-prisma-texto: var(--ros-text, rgba(255, 255, 255, 0.95));
  --ros-prisma-texto-100: var(--ros-text-100, #ffffff);
  --ros-prisma-texto-suave: var(--ros-text-muted, rgba(255, 255, 255, 0.72));
  --ros-prisma-texto-sutil: var(--ros-text-subtle, rgba(255, 255, 255, 0.62));
  --ros-prisma-borda-suave: var(--ros-border-soft, rgba(255, 255, 255, 0.1));
  --ros-prisma-preenchimento-08: var(--ros-fill-08, rgba(255, 255, 255, 0.08));
  --ros-prisma-sombra-40: var(--ros-shadow-40, rgba(0, 0, 0, 0.4));
  --ros-prisma-sombra-60: var(--ros-shadow-60, rgba(0, 0, 0, 0.6));
  --ros-prisma-veu-30: var(--ros-scrim-30, rgba(0, 0, 0, 0.3));
  --ros-prisma-veu-55: var(--ros-scrim-55, rgba(0, 0, 0, 0.55));
  --ros-prisma-branco-rgb: var(--ros-white-rgb, 255, 255, 255);
  --ros-prisma-preto-rgb: var(--ros-black-rgb, 0, 0, 0);
  --ros-prisma-desfoque: var(--ros-backdrop-blur, blur(20px));
  --ros-prisma-bg-1: rgba(59, 130, 246, 0.14);
  --ros-prisma-bg-2: rgba(168, 85, 247, 0.12);
  --ros-prisma-bg-3: #0a0b14;
  --ros-prisma-bg-4: #06070d;
  --ros-prisma-bg-5: rgba(16, 20, 30, 0.5);
  --ros-prisma-shadow-1: rgba(0, 0, 0, 0.35);
  --ros-prisma-shadow-2: rgba(255, 255, 255, 0.08);
  --ros-prisma-shadow-3: rgba(255, 255, 255, 0.3);
  --ros-prisma-shadow-4: rgba(0, 0, 0, 0.25);
  --ros-prisma-bg-6: #3b82f6;
  --ros-prisma-bg-7: #22d3ee;
  --ros-prisma-bg-8: #a855f7;
  --ros-prisma-shadow-5: rgba(59, 130, 246, 0.45);
  --ros-prisma-bg-9: #2563eb;
}

.ros-prisma {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  background: radial-gradient(120% 90% at 50% -10%, var(--ros-prisma-bg-1), transparent 55%),
    radial-gradient(120% 90% at 50% 112%, var(--ros-prisma-bg-2), transparent 55%),
    linear-gradient(180deg, var(--ros-prisma-bg-3) 0%, var(--ros-prisma-bg-4) 100%);

  &__canvas {
    position: absolute;
    inset: 0;

    :deep(canvas) {
      display: block;
      width: 100% !important;
      height: 100% !important;
    }
  }

  &__flash {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      circle at 50% 60%,
      rgba(var(--ros-prisma-branco-rgb), 0.85),
      transparent 65%
    );
    pointer-events: none;
    z-index: 3;
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────
  &__hud {
    position: absolute;
    top: 14px;
    left: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
    z-index: 4;

    @media (max-width: 768px) {
      flex-direction: row;
      gap: 16px;
    }
  }

  &__stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 14px;
    min-width: 62px;
    border-radius: 14px;
    background: var(--ros-prisma-bg-5);
    border: 1px solid var(--ros-prisma-borda-suave);
    box-shadow:
      0 6px 18px var(--ros-prisma-shadow-1),
      inset 0 1px 0 var(--ros-prisma-shadow-2);
    backdrop-filter: blur(14px) saturate(160%);
    -webkit-backdrop-filter: blur(14px) saturate(160%);
  }

  &__stat-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: var(--ros-prisma-texto-sutil);
  }

  &__stat-val {
    font-size: 22px;
    font-weight: 800;
    color: var(--ros-prisma-texto);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-shadow: 0 1px 6px var(--ros-prisma-sombra-40);
  }

  // ── panels ──────────────────────────────────────────────────────────────────
  &__panels {
    position: absolute;
    top: 14px;
    right: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
    z-index: 4;

    @media (max-width: 768px) {
      top: 48px;
      gap: 8px;
    }
  }

  &__panel {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
  }

  // The labeled HOLD slot doubles as the touch "hold" control, so the well is
  // never covered by an on-screen button pad.
  &__panel--hold {
    pointer-events: auto;
    border: none;
    background: transparent;
    padding: 4px;
    margin: -4px;
    border-radius: 10px;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    color: inherit;
    font: inherit;
    transition: background 0.15s ease;

    &:hover,
    &:active {
      background: var(--ros-prisma-preenchimento-08);
    }
  }

  &__panel-label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--ros-prisma-texto-sutil);
  }

  &__mini {
    position: relative;
    width: 52px;
    height: 52px;
    background: var(--ros-prisma-veu-30);
    border: 1px solid rgba(var(--ros-prisma-branco-rgb), 0.07);
    border-radius: 8px;

    @media (max-width: 768px) {
      width: 40px;
      height: 40px;
    }
  }

  &__mini-cell {
    position: absolute;
    width: 25%;
    height: 25%;
    border-radius: 2px;
    box-shadow:
      inset 0 1px 2px var(--ros-prisma-shadow-3),
      inset 0 -2px 3px var(--ros-prisma-shadow-4);
  }

  &__top-actions {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    z-index: 6;
  }

  &__icon-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgba(var(--ros-prisma-preto-rgb), 0.32);
    color: var(--ros-prisma-texto-suave);
    cursor: pointer;
    transition: background 0.15s ease;

    &:hover {
      background: var(--ros-prisma-veu-55);
      color: var(--ros-prisma-texto);
    }
  }

  // ── Start ───────────────────────────────────────────────────────────────────
  &__start {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: clamp(44px, 15%, 130px);
    z-index: 5;
  }

  &__logo {
    font-size: clamp(44px, 12vw, 66px);
    font-weight: 800;
    letter-spacing: 12px;
    margin-left: 12px;
    background: linear-gradient(
      120deg,
      var(--ros-prisma-bg-6) 5%,
      var(--ros-prisma-bg-7) 45%,
      var(--ros-prisma-bg-8) 95%
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 4px 26px var(--ros-prisma-shadow-5));
  }

  &__tagline {
    margin-top: 6px;
    font-size: 14px;
    font-weight: 500;
    color: var(--ros-prisma-texto-suave);
    text-align: center;
    padding: 0 26px;
  }

  &__start-best {
    margin-top: 22px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ros-prisma-texto);
    background: var(--ros-prisma-veu-30);
    padding: 6px 14px;
    border-radius: 999px;
  }

  &__cta {
    position: absolute;
    bottom: calc(16% + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--ros-prisma-texto);
    animation: prisma-pulse 1.6s ease-in-out infinite;
  }

  // ── Over ────────────────────────────────────────────────────────────────────
  &__over {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: var(--ros-prisma-veu-55);
    backdrop-filter: var(--ros-prisma-desfoque);
    -webkit-backdrop-filter: var(--ros-prisma-desfoque);
    z-index: 7;
  }

  &__over-title {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 1px;
    color: var(--ros-prisma-texto-100);
    text-shadow: 0 2px 18px var(--ros-prisma-sombra-60);
  }

  &__over-score {
    font-size: 74px;
    font-weight: 200;
    line-height: 1;
    color: var(--ros-prisma-texto-100);
    font-variant-numeric: tabular-nums;
  }

  &__over-meta {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ros-prisma-texto-suave);
    margin-bottom: 14px;
  }

  &__retry {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 11px 24px;
    border: none;
    border-radius: 999px;
    background: linear-gradient(135deg, var(--ros-prisma-bg-6), var(--ros-prisma-bg-9));
    color: var(--ros-prisma-texto-100);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 6px 22px var(--ros-prisma-shadow-5);
    transition: transform 0.15s ease;

    &:hover {
      transform: translateY(-2px);
    }
  }

  // ── Pause ───────────────────────────────────────────────────────────────────
  &__pause {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(var(--ros-prisma-preto-rgb), 0.44);
    z-index: 6;
  }

  &__pause-title {
    font-size: 26px;
    font-weight: 700;
    color: var(--ros-prisma-texto);
    letter-spacing: 2px;
  }

  &__pause-cta {
    font-size: 14px;
    color: var(--ros-prisma-texto-suave);
  }
}

@keyframes prisma-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

.prisma-pop-enter-active {
  transition:
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.3s ease;
}
.prisma-pop-enter-from {
  transform: scale(0.7);
  opacity: 0;
}

// O perfil leve vem do host (`desempenho.modoLeve`), não do atributo que o
// RoqueOS põe no <html>: fora do RoqueOS esse atributo não existe.
.ros-prisma--low {
  .ros-prisma__over {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: rgba(var(--ros-prisma-preto-rgb), 0.72);
  }
}
</style>
