// Um three de mentira para o teste. O jsdom não tem WebGL: o WebGLRenderer de
// verdade lança ao criar o contexto, e o jogo nem monta. Este dublê é o
// `tests/setup/threeStub.js` do RoqueOS (o que o teste do Prisma usava lá, até
// 25/09/2026), recortado ao que o Prisma toca: cena, câmera, luzes com sombra,
// grupo, malha, os dois materiais, textura de canvas e as duas geometrias.
//
// Duas coisas a mais que lá: o renderer guarda as opções com que nasceu, o pixel
// ratio e se foi descartado, e se pendura no próprio canvas. É assim que o teste
// confere que o modo leve do host chega no código de GPU (sem antialias, sem
// sombra, pixel ratio menor) e que desmontar solta o contexto, sem abrir o
// componente por dentro.
//
// A `BoxGeometry` daqui não tem atributo de posição, então o `roundedBoxGeometry`
// do jogo cai no bloco `catch` e usa a caixa simples, como no teste do RoqueOS.
// Uso: vi.mock('three', async () => (await import('./threeStub.js')).criarThreeFalso())
export function criarThreeFalso() {
  class Vec2 {
    constructor(x = 0, y = 0) {
      this.x = x
      this.y = y
    }
    set(x, y) {
      this.x = x
      this.y = y
      return this
    }
  }
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }
    set(x, y, z) {
      this.x = x
      this.y = y
      this.z = z
      return this
    }
  }
  class Color {
    constructor(hex = 0xffffff) {
      this.hex = hex
    }
    setHex(hex) {
      this.hex = hex
      return this
    }
  }
  class Object3D {
    constructor() {
      this.children = []
      this.position = new Vec3()
      this.scale = new Vec3(1, 1, 1)
      this.rotation = new Vec3()
      this.visible = true
      this.castShadow = false
      this.receiveShadow = false
    }
    add(...filhos) {
      this.children.push(...filhos)
    }
    remove(x) {
      this.children = this.children.filter((c) => c !== x)
    }
  }
  class Mesh extends Object3D {
    constructor(geometry, material) {
      super()
      this.geometry = geometry
      this.material = material
    }
  }
  class Geometry {
    constructor() {
      this.attributes = {}
    }
    computeVertexNormals() {}
    dispose() {}
  }
  class Material {
    constructor(opcoes = {}) {
      Object.assign(this, opcoes)
      this.opacity = opcoes.opacity ?? 1
      this.color = opcoes.color ?? new Color()
      this.emissive = opcoes.emissive ?? new Color(0)
    }
    dispose() {}
  }
  class Camera extends Object3D {
    constructor(fov, aspect) {
      super()
      this.fov = fov
      this.aspect = aspect
    }
    updateProjectionMatrix() {}
    lookAt() {}
  }
  class ShadowLight extends Object3D {
    constructor() {
      super()
      this.shadow = {
        mapSize: new Vec2(),
        camera: { left: 0, right: 0, top: 0, bottom: 0, far: 0 },
        bias: 0,
      }
    }
  }
  class CanvasTexture {
    constructor(imagem) {
      this.image = imagem
    }
    dispose() {}
  }
  class WebGLRenderer {
    constructor(opcoes = {}) {
      this.opcoes = opcoes
      this.pixelRatio = 1
      this.descartado = false
      this.shadowMap = { enabled: false, type: 0 }
      this.domElement = document.createElement('canvas')
      this.domElement.width = 640
      this.domElement.height = 480
      this.domElement.__renderizador = this
    }
    setPixelRatio(r) {
      this.pixelRatio = r
    }
    setSize() {}
    render() {}
    dispose() {
      this.descartado = true
    }
  }
  return {
    Scene: Object3D,
    Group: Object3D,
    Mesh,
    PlaneGeometry: class extends Geometry {},
    BoxGeometry: class extends Geometry {},
    MeshStandardMaterial: class extends Material {},
    MeshPhysicalMaterial: class extends Material {},
    CanvasTexture,
    HemisphereLight: class extends Object3D {},
    DirectionalLight: ShadowLight,
    PointLight: class extends Object3D {},
    Fog: class {},
    PerspectiveCamera: Camera,
    Color,
    WebGLRenderer,
    PCFSoftShadowMap: 2,
  }
}
