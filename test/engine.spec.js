import { describe, it, expect } from 'vitest'
import {
  COLS,
  ROWS,
  PIECES,
  mulberry32,
  newBag,
  createGame,
  startGame,
  cellsOf,
  collides,
  move,
  rotate,
  softDrop,
  hardDrop,
  ghostY,
  holdPiece,
  dropIntervalMs,
  isOver,
} from '../src/engine.js'

const play = (seed = 7) => startGame(createGame(seed))

describe('prisma/engine — setup', () => {
  it('starts with an empty well, an active piece and a 5-deep preview', () => {
    const s = play()
    expect(s.status).toBe('playing')
    expect(s.board).toHaveLength(ROWS)
    expect(s.board[0]).toHaveLength(COLS)
    expect(s.board.flat().every((c) => c === 0)).toBe(true)
    expect(s.cur).toBeTruthy()
    expect(s.queue).toHaveLength(5)
    expect(s.level).toBe(1)
  })

  it('newBag is a permutation of the 7 piece ids', () => {
    const bag = newBag(() => 0.5)
    expect(bag.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('same seed → identical piece sequence', () => {
    const a = play(42)
    const b = play(42)
    expect([a.cur.type, ...a.queue]).toEqual([b.cur.type, ...b.queue])
  })
})

describe('prisma/engine — movement + rotation', () => {
  it('moves left/right but not through a wall', () => {
    const s = play()
    s.cur = { type: 0, rot: 0, x: 3, y: 2 }
    expect(move(s, -1)).toBe(true)
    expect(s.cur.x).toBe(2)
    // shove all the way to the left wall
    for (let i = 0; i < 10; i++) move(s, -1)
    const minX = Math.min(...cellsOf(s.cur).map((c) => c[0]))
    expect(minX).toBe(0)
    expect(move(s, -1)).toBe(false)
  })

  it('rotates the T piece through its states', () => {
    const s = play()
    s.cur = { type: 2, rot: 0, x: 3, y: 2 } // T
    expect(rotate(s, 1)).toBe(true)
    expect(s.cur.rot).toBe(1)
    rotate(s, 1)
    rotate(s, 1)
    rotate(s, 1)
    expect(s.cur.rot).toBe(0) // full cycle
  })

  it('a rotation against the wall kicks the piece into a legal spot', () => {
    const s = play()
    s.cur = { type: 2, rot: 0, x: -1, y: 2 } // T hugging the left edge
    const ok = rotate(s, 1)
    expect(ok).toBe(true)
    expect(collides(s.board, cellsOf(s.cur))).toBe(false)
  })
})

describe('prisma/engine — dropping + locking', () => {
  it('softDrop moves down until it rests, ghostY marks the landing row', () => {
    const s = play()
    s.cur = { type: 0, rot: 0, x: 3, y: 0 }
    const landing = ghostY(s)
    expect(landing).toBeGreaterThan(0)
    let steps = 0
    while (softDrop(s)) steps++
    expect(steps).toBeGreaterThan(0)
    expect(s.cur.y).toBe(landing)
  })

  it('hardDrop merges the piece into the board and spawns the next', () => {
    const s = play()
    const beforeType = s.cur.type
    const res = hardDrop(s)
    expect(res.dropped).toBeGreaterThan(0)
    expect(s.board.flat().filter((c) => c !== 0)).toHaveLength(4) // 4 minos landed
    expect(s.cur).toBeTruthy()
    expect(s.cur.type).not.toBe(undefined)
    expect(PIECES[beforeType]).toBeTruthy()
  })

  it('completing a row clears it and scores by level', () => {
    const s = play(9)
    // fill the bottom row except column 0, then drop a vertical I into it
    for (let x = 1; x < COLS; x++) s.board[ROWS - 1][x] = 2
    s.cur = { type: 0, rot: 1, x: -2, y: 0 } // I, vertical, occupying column 0
    expect(cellsOf(s.cur).every(([x]) => x === 0)).toBe(true)
    const res = hardDrop(s)
    expect(res.cleared).toBe(1)
    expect(s.lines).toBe(1)
    expect(s.score).toBeGreaterThan(0)
    expect(s.board[ROWS - 1].some((c) => c === 0)).toBe(true) // the completed row is gone
  })
})

describe('prisma/engine — hold + game over', () => {
  it('hold stashes a piece and blocks a second hold until the next lock', () => {
    const s = play()
    const held = s.cur.type
    expect(holdPiece(s)).toBe(true)
    expect(s.hold).toBe(held)
    expect(holdPiece(s)).toBe(false) // canHold consumed
  })

  it('tops out when new pieces can no longer spawn', () => {
    const s = play(3)
    // fill everything above the floor except the last column so nothing clears
    for (let y = 2; y < ROWS; y++) for (let x = 0; x < COLS - 1; x++) s.board[y][x] = 2
    let over = false
    for (let i = 0; i < 10 && !over; i++) over = hardDrop(s).over
    expect(over).toBe(true)
    expect(isOver(s)).toBe(true)
  })
})

describe('prisma/engine — gravity curve', () => {
  it('drop interval shrinks as the level rises and is floored', () => {
    expect(dropIntervalMs(1)).toBeGreaterThan(dropIntervalMs(5))
    expect(dropIntervalMs(50)).toBe(70)
  })
})

describe('prisma/engine: o saco de peças é a sequência exata da semente', () => {
  /**
   * A partida é reproduzível pela semente, e o saco é a primeira coisa que ela
   * decide. Um Fisher-Yates que pula a última troca ainda devolve as sete peças
   * (o teste de permutação passaria) e ainda assim é OUTRA sequência: o replay
   * e o placar comparável deixam de valer sem ninguém notar.
   */
  it('a semente 1 dá exatamente este saco', () => {
    // Valor de ouro: gravado da implementação atual, e é por isso que vale.
    // Qualquer mudança no embaralhamento quebra aqui antes de quebrar um
    // replay salvo.
    expect(newBag(mulberry32(1))).toEqual([1, 5, 6, 3, 2, 0, 4])
  })

  it('o rng constante em zero rotaciona o saco inteiro, uma casa por passo', () => {
    // Com rng() === 0 toda troca é com o índice 0, e o resultado é um
    // deslocamento circular. Pular a última troca deixaria as duas primeiras
    // peças paradas.
    expect(newBag(() => 0)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })
})
