/**
 * PRISMA — pure, deterministic falling-block engine for the RoqueOS Games
 * gallery (a 3D-rendered take on the classic block stacker). Ten-wide,
 * twenty-tall well; seven pieces from a shuffled 7-bag (mulberry32 → seed-
 * reproducible); rotation with a simple wall-kick set; line clears scored by
 * level. Framework-free and fully unit-testable — the component owns the
 * Three.js render, sound, gravity ticks and lock-delay timing.
 */

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const COLS = 10
export const ROWS = 20
export const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

// Rotation states as [dx, dy] cell lists (columns right, rows down), origin at
// the piece's (x, y). Standard SRS orientations.
export const SHAPES = {
  I: [
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
    ],
    [
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
    ],
    [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ],
  ],
  O: [
    [
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
    ],
  ],
  T: [
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
  ],
  S: [
    [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ],
    [
      [1, 1],
      [2, 1],
      [0, 2],
      [1, 2],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
  ],
  Z: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
    [
      [2, 0],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
    ],
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 2],
    ],
  ],
  J: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [2, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [2, 2],
    ],
    [
      [1, 0],
      [1, 1],
      [0, 2],
      [1, 2],
    ],
  ],
  L: [
    [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  ],
}

const KICKS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-2, 0],
  [2, 0],
  [0, 1],
]

const CLEAR_SCORE = [0, 100, 300, 500, 800]

export function newBag(rng) {
  const bag = [0, 1, 2, 3, 4, 5, 6]
  // `i >= 1` e não `i > 0`: a mesma parada, mas verificável. Com `i > 0` a
  // única variação (`i >= 0`) trocaria bag[0] por bag[0] e nenhuma semente
  // separaria as duas formas; com `i >= 1` a variação pula a última troca e a
  // sequência de peças sai diferente.
  for (let i = bag.length - 1; i >= 1; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

const emptyBoard = () => Array.from({ length: ROWS }, () => new Array(COLS).fill(0))

export function createGame(seed = 1, opts = {}) {
  return {
    status: 'idle', // 'idle' | 'playing' | 'over'
    seed: seed >>> 0,
    board: emptyBoard(),
    bag: [],
    queue: [], // upcoming piece types (5 shown)
    cur: null, // { type, rot, x, y }
    hold: null,
    canHold: true,
    score: 0,
    lines: 0,
    level: 1,
    best: opts.best || 0,
    lastCleared: 0,
    rng: mulberry32(seed),
  }
}

export function cellsOf(cur) {
  const shape = SHAPES[PIECES[cur.type]][cur.rot]
  return shape.map(([dx, dy]) => [cur.x + dx, cur.y + dy])
}

export function collides(board, cellList) {
  for (const [x, y] of cellList) {
    if (x < 0 || x >= COLS || y >= ROWS) return true
    if (y >= 0 && board[y][x]) return true
  }
  return false
}

function refillQueue(state) {
  while (state.queue.length < 5) {
    if (!state.bag.length) state.bag = newBag(state.rng)
    state.queue.push(state.bag.shift())
  }
}

// Sem parâmetro `type`: as três chamadas deste arquivo entram sem tipo, então o
// `type ?? state.queue.shift()` que existia aqui era um caminho morto -- e um
// caminho morto que nenhum teste conseguia distinguir de `||`.
function spawn(state) {
  const t = state.queue.shift()
  refillQueue(state)
  state.cur = { type: t, rot: 0, x: 3, y: 0 }
  state.canHold = true
  if (collides(state.board, cellsOf(state.cur))) {
    state.status = 'over'
    return false
  }
  return true
}

export function startGame(state) {
  state.rng = mulberry32(state.seed)
  state.board = emptyBoard()
  state.bag = []
  state.queue = []
  state.hold = null
  state.canHold = true
  state.score = 0
  state.lines = 0
  state.level = 1
  state.lastCleared = 0
  refillQueue(state)
  state.status = 'playing'
  spawn(state)
  return state
}

export function move(state, dx) {
  if (state.status !== 'playing' || !state.cur) return false
  const next = { ...state.cur, x: state.cur.x + dx }
  if (collides(state.board, cellsOf(next))) return false
  state.cur.x += dx
  return true
}

export function rotate(state, dir = 1) {
  if (state.status !== 'playing' || !state.cur) return false
  const newRot = (state.cur.rot + dir + 4) % 4
  for (const [kx, ky] of KICKS) {
    const trial = { ...state.cur, rot: newRot, x: state.cur.x + kx, y: state.cur.y + ky }
    if (!collides(state.board, cellsOf(trial))) {
      state.cur.rot = newRot
      state.cur.x += kx
      state.cur.y += ky
      return true
    }
  }
  return false
}

/** One cell of gravity. Returns true if it moved down, false if it's resting. */
export function softDrop(state, scoreIt = false) {
  if (state.status !== 'playing' || !state.cur) return false
  const next = { ...state.cur, y: state.cur.y + 1 }
  if (collides(state.board, cellsOf(next))) return false
  state.cur.y += 1
  if (scoreIt) state.score += 1
  return true
}

export function ghostY(state) {
  if (!state.cur) return 0
  let y = state.cur.y
  while (!collides(state.board, cellsOf({ ...state.cur, y: y + 1 }))) y++
  return y
}

function clearLines(state) {
  const kept = state.board.filter((row) => row.some((c) => c === 0))
  const cleared = ROWS - kept.length
  // `if (cleared)` e não `if (cleared > 0)`: `cleared` é contagem, nunca
  // negativa, e com zero o bloco inteiro é um no-op (CLEAR_SCORE[0] é 0 e o
  // nível recalculado dá o mesmo). As duas formas decidiam igual, e a de cima
  // deixava um comparador que nenhum tabuleiro podia separar.
  if (cleared) {
    const fresh = Array.from({ length: cleared }, () => new Array(COLS).fill(0))
    state.board = fresh.concat(kept)
    state.lines += cleared
    state.score += CLEAR_SCORE[cleared] * state.level
    state.level = Math.floor(state.lines / 10) + 1
  }
  state.lastCleared = cleared
  return cleared
}

/** Merge the current piece into the board, clear lines and spawn the next. */
export function lock(state) {
  if (!state.cur) return { cleared: 0, over: state.status === 'over' }
  const color = state.cur.type + 1
  for (const [x, y] of cellsOf(state.cur)) {
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) state.board[y][x] = color
  }
  const cleared = clearLines(state)
  spawn(state)
  return { cleared, over: state.status === 'over' }
}

/** Slam to the bottom and lock immediately. Returns the lock result. */
export function hardDrop(state) {
  if (state.status !== 'playing' || !state.cur) return { cleared: 0, over: false, dropped: 0 }
  let dropped = 0
  while (softDrop(state, false)) dropped++
  state.score += dropped * 2
  const res = lock(state)
  return { ...res, dropped }
}

export function holdPiece(state) {
  if (state.status !== 'playing' || !state.cur || !state.canHold) return false
  const curType = state.cur.type
  if (state.hold == null) {
    state.hold = curType
    spawn(state)
  } else {
    const swap = state.hold
    state.hold = curType
    state.cur = { type: swap, rot: 0, x: 3, y: 0 }
    if (collides(state.board, cellsOf(state.cur))) state.status = 'over'
  }
  state.canHold = false
  return true
}

export function dropIntervalMs(level) {
  return Math.max(70, Math.round(800 * Math.pow(0.82, level - 1)))
}

export const isOver = (state) => state.status === 'over'
