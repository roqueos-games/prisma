// O Prisma inteiro, montado pelo contrato do jogo-sdk com o host falso.
//
// Nenhum mock de store, de analytics ou de i18n do RoqueOS: se o jogo ainda
// alcançasse algo do RoqueOS, este arquivo não rodaria fora dele. Os nove casos
// do teste que rodava no front antes da extração, em 25/09/2026, estão aqui
// (marcados com "Do front:"), com os do contrato em volta. O único mock é o do
// three, porque o jsdom não tem WebGL (ver threeStub.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { VERSAO_DO_CONTRATO } from '@roqueos-games/jogo-sdk'
import { criarHostFalso } from '@roqueos-games/jogo-sdk/host-falso'
import jogo from '../src/index.js'
import { COLS, ROWS } from '../src/engine.js'
import ptBR from '../i18n/pt-BR.json'
import enUS from '../i18n/en-US.json'
import tela from '../src/JogoPrisma.vue?raw'

vi.mock('three', async () => (await import('./threeStub.js')).criarThreeFalso())

// O fundo do poço é desenhado num canvas 2D (a grade gravada). O jsdom não tem
// canvas 2D; este contexto aceita qualquer chamada e não desenha nada.
const ctx2d = () =>
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createLinearGradient' || p === 'createRadialGradient')
          return () => ({ addColorStop() {} })
        return () => {}
      },
      set: () => true,
    },
  )

let el = null
let host = null
let montagem = null
// O laço do jogo roda no requestAnimationFrame. Aqui o quadro só anda quando o
// teste manda, e a gravidade fica reproduzível. É uma fila, e não "o último
// callback", porque as <transition> do Vue também pedem quadro.
let fila = []
let relogio = 0
const rodar = (n = 1, passo = 50) => {
  for (let i = 0; i < n; i++) {
    relogio += passo
    for (const fn of fila.splice(0)) fn(relogio)
  }
}

const palco = () => {
  el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
const montou = () =>
  vi.waitFor(() => {
    if (!el.querySelector('.ros-prisma')) throw new Error('o Prisma ainda não montou')
  })
const montarCom = async (h, { ativo = true } = {}) => {
  host = h
  montagem = jogo.mount(palco(), host, { windowId: 'w1', ativo })
  // O app só monta com o texto do idioma carregado.
  await montou()
  await nextTick()
}
const montar = ({ ativo = true, ...opcoesDoHost } = {}) =>
  montarCom(criarHostFalso({ jogoId: 'prisma', ...opcoesDoHost }), { ativo })
const $ = (sel) => el.querySelector(sel)
const eventos = (nome) =>
  host.chamadas.filter((c) => c.capacidade === 'metricas' && c.args[0] === nome)
const tecla = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))
const tocar = (alvo) => alvo.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
const renderizador = () => $('.ros-prisma__canvas canvas').__renderizador
const sequencia = (st) => [st.cur.type, ...st.queue]
// Enche o poço até a linha 2, menos a última coluna (nenhuma linha fecha), e
// derruba peças até não caber a próxima.
const encherAteOFim = (st) => {
  for (let y = 2; y < ROWS; y++) for (let x = 0; x < COLS - 1; x++) st.board[y][x] = 2
  let guarda = 0
  while (st.status === 'playing' && guarda++ < 14) window.__prisma.hardDropNow()
}

describe('Prisma pelo jogo-sdk', () => {
  let origCtx
  beforeEach(() => {
    window.__ROS_E2E__ = {} // instala o gancho __prisma
    origCtx = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx2d())
    fila = []
    relogio = 0
    vi.stubGlobal('requestAnimationFrame', (fn) => fila.push(fn))
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => {
    montagem?.desmontar()
    el?.remove()
    montagem = null
    el = null
    host = null
    HTMLCanvasElement.prototype.getContext = origCtx
    delete window.__ROS_E2E__
    delete window.__prisma
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('é um jogo do SDK, com o id que o catálogo e o recorde usam', () => {
    expect(jogo.id).toBe('prisma')
    expect(jogo.versaoDoContrato).toBe(VERSAO_DO_CONTRATO)
    expect(jogo.capacidades).toEqual([])
  })

  // Do front: 'mounts the start screen with a ready engine'.
  it('abre na tela inicial, com o motor pronto e o texto do idioma do host', async () => {
    await montar()
    expect($('.ros-prisma__logo').textContent).toBe('PRISMA')
    expect($('.ros-prisma__cta').textContent).toBe(ptBR.tapToPlay)
    expect($('.ros-prisma__tagline').textContent).toBe(ptBR.tagline)
    expect($('.ros-prisma__hud')).toBeNull()
    expect(window.__prisma.state.status).toBe('idle')
    expect(window.__prisma.state.cur).toBeNull()
  })

  it('fala o idioma do host, e troca quando o host troca', async () => {
    await montar({ idioma: 'en-US' })
    expect($('.ros-prisma__cta').textContent).toBe(enUS.tapToPlay)
    host.disparar('idioma', 'pt-BR')
    await vi.waitFor(() => expect($('.ros-prisma__cta').textContent).toBe(ptBR.tapToPlay))
  })

  it('em árabe o jogo se desenha da direita para a esquerda', async () => {
    await montar({ idioma: 'ar-AR' })
    expect($('.ros-prisma').getAttribute('dir')).toBe('rtl')
  })

  // Do front: 'starts on a tap: HUD + preview panels appear, analytics fires'.
  it('um toque começa: placar e painéis aparecem, game_start com o nome de antes', async () => {
    await montar()
    tocar($('.ros-prisma'))
    await nextTick()
    expect(window.__prisma.state.status).toBe('playing')
    expect($('.ros-prisma__hud')).not.toBeNull()
    expect($('.ros-prisma__panels')).not.toBeNull()
    expect(window.__prisma.state.queue).toHaveLength(5)
    expect(eventos('game_start').map((c) => c.args)).toEqual([['game_start', {}]])
  })

  it('o toque que começa destrava o áudio no mesmo gesto', async () => {
    await montar()
    expect(host.contar('audio', 'destravar')).toBe(0)
    tocar($('.ros-prisma'))
    expect(host.contar('audio', 'destravar')).toBe(1)
  })

  // Do front: 'has no on-screen button pad; the HOLD slot is the tappable hold control'.
  it('não há teclado na tela; o quadro GUARDAR é o botão de guardar', async () => {
    // O founder reclamou: os seis botões cobriam o poço no celular. Saíram; os
    // gestos e o quadro GUARDAR, com rótulo, fazem o jogo, e o poço fica livre.
    await montar()
    tocar($('.ros-prisma'))
    await nextTick()
    expect($('.ros-prisma__pad')).toBeNull()
    const guardar = $('.ros-prisma__panel--hold')
    expect(guardar.tagName).toBe('BUTTON')
    expect(guardar.getAttribute('aria-label')).toBe(ptBR.hold)
    expect(window.__prisma.state.hold).toBeNull()
    guardar.click()
    expect(window.__prisma.state.hold).not.toBeNull()
  })

  // Do front: 'a left-arrow shifts the active piece'.
  it('a seta para a esquerda move a peça', async () => {
    await montar()
    window.__prisma.start()
    const x0 = window.__prisma.state.cur.x
    tecla('ArrowLeft')
    expect(window.__prisma.state.cur.x).toBe(x0 - 1)
  })

  // Do front: 'hard drop locks four minos and spawns the next piece'.
  it('derrubar assenta quatro blocos e traz a próxima peça', async () => {
    await montar()
    window.__prisma.start()
    window.__prisma.hardDropNow()
    expect(window.__prisma.state.board.flat().filter((v) => v !== 0)).toHaveLength(4)
    expect(window.__prisma.state.cur).toBeTruthy()
  })

  // Do front: 'hold stashes the current piece'.
  it('guardar tira a peça atual de jogo', async () => {
    await montar()
    window.__prisma.start()
    expect(window.__prisma.state.hold).toBeNull()
    window.__prisma.holdNow()
    expect(window.__prisma.state.hold).not.toBeNull()
  })

  it('a peça cai sozinha com o tempo', async () => {
    await montar()
    window.__prisma.start()
    const y0 = window.__prisma.state.cur.y
    rodar(20) // 1 s de jogo; no nível 1 a peça desce uma casa a cada 0,8 s
    expect(window.__prisma.state.cur.y).toBe(y0 + 1)
  })

  it('P pausa e despausa a partida', async () => {
    await montar()
    window.__prisma.start()
    tecla('p')
    await nextTick()
    expect($('.ros-prisma__pause-title').textContent).toBe(ptBR.paused)
    const y0 = window.__prisma.state.cur.y
    rodar(40)
    expect(window.__prisma.state.cur.y).toBe(y0)
    tecla('p')
    await nextTick()
    expect($('.ros-prisma__pause')).toBeNull()
  })

  it('só a janela ativa ouve o teclado', async () => {
    await montar({ ativo: false })
    tecla(' ')
    await nextTick()
    expect(eventos('game_start')).toHaveLength(0)
    expect($('.ros-prisma__start')).not.toBeNull()

    montagem.ativar(true)
    tecla(' ')
    await nextTick()
    expect(eventos('game_start')).toHaveLength(1)
    expect($('.ros-prisma__start')).toBeNull()
  })

  it('a janela que perde o foco pausa a partida, e a peça para de cair', async () => {
    await montar()
    window.__prisma.start()
    montagem.ativar(false)
    await nextTick()
    expect($('.ros-prisma__pause')).not.toBeNull()
    const y0 = window.__prisma.state.cur.y
    rodar(40)
    expect(window.__prisma.state.cur.y).toBe(y0)
    const x0 = window.__prisma.state.cur.x
    tecla('ArrowLeft')
    expect(window.__prisma.state.cur.x).toBe(x0)
  })

  // Do front: 'topping out shows the game-over overlay, fires analytics and persists a best'.
  it('encher o poço é fim de jogo: "Novo recorde!", game_over com o nome de antes, e o recorde na chave e na conta', async () => {
    await montar()
    window.__prisma.start()
    const st = window.__prisma.state
    window.__prisma.hardDropNow() // uma queda limpa no poço vazio: pontos acima de zero
    encherAteOFim(st)
    await nextTick()
    expect(st.status).toBe('over')
    expect($('.ros-prisma__over')).not.toBeNull()
    expect($('.ros-prisma__over-title').textContent.trim()).toBe(ptBR.newRecord)
    expect(eventos('game_over').map((c) => c.args)).toEqual([
      ['game_over', { score: st.score, lines: 0 }],
    ])
    expect(st.score).toBeGreaterThan(0)
    expect(host.storage.getItem('roqueos:prisma:best')).toBe(String(st.score))
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: st.score }))
  })

  it('fim de jogo abaixo do recorde é "Fim de jogo", e o recorde fica', async () => {
    const h = criarHostFalso({ jogoId: 'prisma' })
    h.storage.setItem('roqueos:prisma:best', '999999')
    await montarCom(h)
    // Espera o acerto com a conta da montagem, que sobe o recorde local.
    await vi.waitFor(() => expect(host.contar('placar', 'salvar')).toBe(1))
    window.__prisma.start()
    encherAteOFim(window.__prisma.state)
    await nextTick()
    expect($('.ros-prisma__over-title').textContent.trim()).toBe(ptBR.over)
    expect($('.ros-prisma__over-meta').textContent).toContain('999999')
    expect(host.storage.getItem('roqueos:prisma:best')).toBe('999999')
    expect(host.contar('placar', 'salvar')).toBe(1)
  })

  it('"Jogar de novo" recomeça com semente nova, e não a mesma sequência de peças', async () => {
    // Defeito do componente antigo: o motor só era criado se ainda não
    // existisse, e o `startGame` recomeça o sorteio da semente do motor, então
    // toda partida da mesma janela repetia as peças da primeira.
    const sorteios = [0.11, 0.52, 0.93]
    vi.spyOn(Math, 'random').mockImplementation(() => sorteios.shift() ?? 0.5)
    await montar()
    window.__prisma.start()
    const primeira = window.__prisma.state
    const pecasDaPrimeira = sequencia(primeira)
    encherAteOFim(primeira)
    await nextTick()
    $('.ros-prisma__retry').click()
    await nextTick()
    const segunda = window.__prisma.state
    expect(segunda.status).toBe('playing')
    expect(segunda.seed).not.toBe(primeira.seed)
    expect(sequencia(segunda)).not.toEqual(pecasDaPrimeira)
  })

  // Do front: 'mute toggle persists'.
  it('o som liga e desliga na mesma chave de antes da extração', async () => {
    await montar()
    window.__prisma.start()
    await nextTick()
    const botao = $('.ros-prisma__icon-btn')
    expect(botao.getAttribute('aria-label')).toBe(ptBR.soundOn)
    botao.click()
    expect(host.storage.getItem('roqueos:prisma:muted')).toBe('1')
    await nextTick()
    expect(botao.getAttribute('aria-label')).toBe(ptBR.soundOff)
    botao.click()
    expect(host.storage.getItem('roqueos:prisma:muted')).toBe('0')
  })

  it('lê o recorde e o mudo das chaves de antes da extração', async () => {
    const h = criarHostFalso({ jogoId: 'prisma' })
    h.storage.setItem('roqueos:prisma:best', '1234')
    h.storage.setItem('roqueos:prisma:muted', '1')
    await montarCom(h)
    expect($('.ros-prisma__start-best').textContent).toContain('1234')
    window.__prisma.start()
    await nextTick()
    expect($('.ros-prisma__icon-btn').getAttribute('aria-label')).toBe(ptBR.soundOff)
  })

  it('o recorde da conta maior que o local vem para a tela e para a chave da galeria', async () => {
    const h = criarHostFalso({ jogoId: 'prisma' })
    await h.placar.salvar({ best: 5000 })
    await montarCom(h)
    await vi.waitFor(() => expect(host.storage.getItem('roqueos:prisma:best')).toBe('5000'))
    await nextTick()
    expect($('.ros-prisma__start-best').textContent).toContain('5000')
  })

  it('o recorde local maior que o da conta sobe para a conta', async () => {
    const h = criarHostFalso({ jogoId: 'prisma' })
    h.storage.setItem('roqueos:prisma:best', '3000')
    await montarCom(h)
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: 3000 }))
  })

  // Convidado: o host do RoqueOS devolve null no carregar e false no salvar.
  it('convidado joga com o recorde local, sem placar na conta', async () => {
    const h = criarHostFalso({ jogoId: 'prisma' })
    h.placar = { carregar: async () => null, salvar: async () => false }
    h.storage.setItem('roqueos:prisma:best', '7')
    await montarCom(h)
    await nextTick()
    expect($('.ros-prisma__start-best').textContent).toContain('7')
    window.__prisma.start()
    const st = window.__prisma.state
    window.__prisma.hardDropNow()
    encherAteOFim(st)
    await nextTick()
    expect($('.ros-prisma__over-title').textContent.trim()).toBe(ptBR.newRecord)
    expect(host.storage.getItem('roqueos:prisma:best')).toBe(String(st.score))
  })

  it('placar fora do ar não derruba o jogo nem apaga o recorde local', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = criarHostFalso({ jogoId: 'prisma' })
    h.placar = {
      carregar: async () => {
        throw new Error('offline')
      },
      salvar: async () => {
        throw new Error('offline')
      },
    }
    h.storage.setItem('roqueos:prisma:best', '450')
    await montarCom(h)
    await vi.waitFor(() => expect(erro).toHaveBeenCalled())
    expect($('.ros-prisma__start-best').textContent).toContain('450')
    expect(host.storage.getItem('roqueos:prisma:best')).toBe('450')
  })

  it('entrar na conta com o jogo aberto busca o recorde da conta de novo', async () => {
    await montar()
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(1))
    host.disparar('identidade', { uid: 'u1', nome: 'Ana' })
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(2))
  })

  // O modo leve é a única coisa do código de GPU que muda de origem na
  // extração: vinha do composable do RoqueOS e agora vem do host.
  it('o perfil leve do host chega no three: sem antialias, sem sombra, pixel ratio menor', async () => {
    await montar({ modoLeve: true })
    expect($('.ros-prisma').classList.contains('ros-prisma--low')).toBe(true)
    const r = renderizador()
    expect(r.opcoes).toEqual({ antialias: false, alpha: true })
    expect(r.shadowMap.enabled).toBe(false)
    expect(r.pixelRatio).toBeLessThanOrEqual(1.25)
  })

  it('sem perfil leve o three nasce com antialias e sombra', async () => {
    await montar({ modoLeve: false })
    expect($('.ros-prisma').classList.contains('ros-prisma--low')).toBe(false)
    const r = renderizador()
    expect(r.opcoes).toEqual({ antialias: true, alpha: true })
    expect(r.shadowMap.enabled).toBe(true)
  })

  // Do front: 'cleans up the E2E hook on unmount'.
  it('desmontar solta tudo: o gancho, o contexto WebGL, a tela e o teclado', async () => {
    await montar()
    const r = renderizador()
    expect(window.__prisma).toBeTruthy()
    montagem.desmontar()
    expect(window.__prisma).toBeUndefined()
    expect(r.descartado).toBe(true)
    expect(el.querySelector('.ros-prisma')).toBeNull()
    expect(el.querySelector('canvas')).toBeNull()
    tecla(' ')
    expect(eventos('game_start')).toHaveLength(0)
    // Desmontar de novo acontece de verdade (a janela fecha e o componente em
    // volta desmonta depois) e não pode lançar.
    expect(() => montagem.desmontar()).not.toThrow()
  })

  it('desmontar antes de o texto chegar não monta nada depois', async () => {
    host = criarHostFalso({ jogoId: 'prisma' })
    montagem = jogo.mount(palco(), host, { ativo: true })
    montagem.desmontar()
    await new Promise((r) => setTimeout(r, 50))
    expect(el.querySelector('.ros-prisma')).toBeNull()
  })

  it('toda chave que a tela usa existe no pt-BR', () => {
    const usadas = [...tela.matchAll(/txt\('([\w.]+)'/g)].map((m) => m[1])
    expect(usadas.length).toBeGreaterThan(10)
    const faltando = usadas.filter((k) => typeof ptBR[k] !== 'string')
    expect(faltando).toEqual([])
  })
})
