/**
 * 动态道具（方案 A）：以真实模型为背景，叠加"会动的部分"
 *
 * 真实模型里这些零件已经被合并成整块网格（无法单独运动），因此按真实部件的位置
 * 叠加程序化的动态件，并用原来的工艺节拍驱动：
 *  - 蚕盘：沿真实传送带运行（两条长带方向相反）
 *  - 投叶：真实漏斗下方开闸 + 桑叶粒子
 *  - 抓取机夹爪：沿真实门架前后移动
 *  - 码垛机托叉：从整机两侧伸出/缩回（配合整机升降与行走）
 */
import * as THREE from 'three'

export interface PartBox {
  name: string
  box: THREE.Box3
}

/** 真实部件名关键词 */
const KEY = {
  conveyor: '传送带',
  hopper: '下料',
  claw: '机械爪子',
}

const TRAY_COLOR = 0xff8a1f
const METAL_COLOR = 0x9aa7bd
const DARK_COLOR = 0x4a5a75
const LEAF_COLOR = 0x7ee06a

export interface DynamicProps {
  group: THREE.Group
  update(elapsed: number): void
  dispose(): void
}

export function buildDynamicProps(parts: PartBox[]): DynamicProps | null {
  if (parts.length === 0) return null

  const disposables: (THREE.BufferGeometry | THREE.Material)[] = []
  const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
    disposables.push(x)
    return x
  }
  const group = new THREE.Group()
  group.name = 'dynamicProps'

  const trayMat = track(
    new THREE.MeshLambertMaterial({ color: TRAY_COLOR, emissive: TRAY_COLOR, emissiveIntensity: 0.12 }),
  )
  const metalMat = track(new THREE.MeshLambertMaterial({ color: METAL_COLOR }))
  const darkMat = track(new THREE.MeshLambertMaterial({ color: DARK_COLOR }))
  const leafMat = track(
    new THREE.PointsMaterial({ color: LEAF_COLOR, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }),
  )

  /* ---------------- ① 蚕盘沿真实传送带运行 ---------------- */
  interface BeltRunner {
    meshes: THREE.Mesh[]
    minX: number
    maxX: number
    y: number
    z: number
    dir: 1 | -1
    speed: number
  }
  const runners: BeltRunner[] = []

  const belts = parts
    .filter((p) => p.name.includes(KEY.conveyor))
    .map((p) => ({ p, size: p.box.getSize(new THREE.Vector3()) }))
    .sort((a, b) => b.size.x - a.size.x)
    .slice(0, 3) // 两条长带 + 一条短带（短带的长度较小，速度按比例）

  belts.forEach((item, bi) => {
    const { box } = item.p
    const size = item.size
    const alongX = size.x >= size.z
    const length = alongX ? size.x : size.z
    const width = alongX ? size.z : size.x
    if (length < 1) return

    // 蚕盘按带宽的 0.85 定尺寸，长度取带长的 1/6（长带放大一些）
    const trayLen = Math.min(2.4, length / 5)
    const trayWid = Math.max(0.8, width * 0.85)
    const geo = alongX
      ? track(new THREE.BoxGeometry(trayLen, 0.16, trayWid))
      : track(new THREE.BoxGeometry(trayWid, 0.16, trayLen))

    const count = 4
    const meshes: THREE.Mesh[] = []
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, trayMat)
      mesh.visible = true
      group.add(mesh)
      meshes.push(mesh)
    }

    runners.push({
      meshes,
      minX: alongX ? box.min.x : box.min.z,
      maxX: alongX ? box.max.x : box.max.z,
      y: box.max.y + 0.1,
      z: alongX ? (box.min.z + box.max.z) / 2 : (box.min.x + box.max.x) / 2,
      dir: bi % 2 === 0 ? 1 : -1,
      speed: 1.1,
    })
  })
  const alongXFlags = belts.map((b) => b.size.x >= b.size.z)

  /* ---------------- ② 投叶：闸门 + 桑叶粒子 ---------------- */
  const hopperPart = parts.find((p) => p.name.includes(KEY.hopper))
  let hopperGate: THREE.Mesh | null = null
  let leaves: THREE.Points | null = null
  let leafAttr: THREE.BufferAttribute | null = null
  const LEAF_COUNT = 40
  const leafSpeeds = new Float32Array(LEAF_COUNT)
  let hopperX = 0
  let hopperZ = 0
  let hopperY = 0

  if (hopperPart) {
    const b = hopperPart.box
    const c = b.getCenter(new THREE.Vector3())
    const size = b.getSize(new THREE.Vector3())
    hopperX = c.x
    hopperZ = c.z
    hopperY = b.min.y
    hopperGate = new THREE.Mesh(track(new THREE.BoxGeometry(size.x * 0.35, 0.08, size.z * 0.35)), darkMat)
    hopperGate.position.set(c.x, b.min.y - 0.05, c.z)
    group.add(hopperGate)

    const positions = new Float32Array(LEAF_COUNT * 3)
    for (let i = 0; i < LEAF_COUNT; i++) {
      positions[i * 3] = c.x + (Math.random() - 0.5) * size.x * 0.4
      positions[i * 3 + 1] = b.min.y - Math.random() * 1.6
      positions[i * 3 + 2] = c.z + (Math.random() - 0.5) * size.z * 0.4
      leafSpeeds[i] = 0.7 + Math.random() * 0.8
    }
    const leafGeo = track(new THREE.BufferGeometry())
    leafAttr = new THREE.BufferAttribute(positions, 3)
    leafGeo.setAttribute('position', leafAttr)
    leaves = new THREE.Points(leafGeo, leafMat)
    group.add(leaves)
  }

  /* ---------------- ③ 抓取机夹爪：沿真实门架前后移动 ---------------- */
  interface ClawRig {
    jaw: THREE.Group
    zMin: number
    zMax: number
    x: number
    y: number
    phase: number
  }
  const claws: ClawRig[] = []
  const clawParts = parts.filter((p) => p.name.includes(KEY.claw))
  const clawGeoLong = track(new THREE.BoxGeometry(1.6, 0.16, 0.1))
  const clawGeoShort = track(new THREE.BoxGeometry(0.1, 0.16, 1.2))

  for (const [ci, part] of clawParts.entries()) {
    const b = part.box
    const c = b.getCenter(new THREE.Vector3())
    const jaw = new THREE.Group()
    jaw.position.set(c.x, c.y, c.z)
    // 长方形夹爪（两口长边 + 两口短边）
    for (const dz of [-0.6, 0.6]) {
      const bar = new THREE.Mesh(clawGeoLong, metalMat)
      bar.position.z = dz
      jaw.add(bar)
    }
    for (const dx of [-0.8, 0.8]) {
      const bar = new THREE.Mesh(clawGeoShort, metalMat)
      bar.position.x = dx
      jaw.add(bar)
    }
    group.add(jaw)
    claws.push({
      jaw,
      zMin: c.z - 1.2,
      zMax: c.z + 1.2,
      x: c.x,
      y: c.y,
      phase: ci * 0.5,
    })
  }

  /* ---------------- ④ 码垛机托叉：两侧伸出/缩回 ---------------- */
  const palletizerPart = parts.find((p) => p.name.includes('装配体part11') || p.name.includes('托盘底板'))
  interface ForkRig {
    fork: THREE.Group
    z: number
    dir: 1 | -1
  }
  const forks: ForkRig[] = []
  let palletizerX = 0
  let palletizerY = 0
  let palletizerHalfZ = 1.2

  if (palletizerPart) {
    const b = palletizerPart.box
    const c = b.getCenter(new THREE.Vector3())
    const size = b.getSize(new THREE.Vector3())
    palletizerX = c.x
    palletizerY = c.y
    palletizerHalfZ = Math.max(0.8, size.z / 2)
    for (const dir of [-1, 1] as const) {
      const fork = new THREE.Group()
      fork.position.set(c.x, c.y, c.z + (dir * size.z) / 2)
      const tines = new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 0.1, 1.1)), darkMat)
      fork.add(tines)
      const carry = new THREE.Mesh(track(new THREE.BoxGeometry(1.8, 0.16, 1.3)), trayMat)
      carry.position.y = 0.16
      fork.add(carry)
      group.add(fork)
      forks.push({ fork, z: c.z + (dir * size.z) / 2, dir })
    }
  }

  /* ---------------- 每帧动画 ---------------- */
  function update(elapsed: number): void {
    // 蚕盘循环
    runners.forEach((runner, ri) => {
      const span = runner.maxX - runner.minX
      const alongX = alongXFlags[ri] ?? true
      runner.meshes.forEach((mesh, i) => {
        const travel = (((elapsed * runner.speed + (i * span) / runner.meshes.length) % span) + span) % span
        const v = runner.dir > 0 ? runner.minX + travel : runner.maxX - travel
        if (alongX) mesh.position.set(v, runner.y, runner.z)
        else mesh.position.set(runner.z, runner.y, v)
      })
    })

    // 投叶：每 7 秒开闸投叶一次
    if (hopperGate && leaves && leafAttr) {
      const cycle = elapsed % 7
      const open = cycle > 4.2 && cycle < 6.2
      hopperGate.position.y = hopperY - 0.05 - (open ? 0.18 : 0)
      leafMat.opacity = open ? 0.95 : 0.15
      for (let i = 0; i < LEAF_COUNT; i++) {
        const speed = leafSpeeds[i] ?? 1
        let y = leafAttr.getY(i) - speed * 0.02
        if (y < hopperY - 1.8) {
          y = hopperY - 0.1
          leafAttr.setX(i, hopperX + (Math.random() - 0.5) * 0.8)
          leafAttr.setZ(i, hopperZ + (Math.random() - 0.5) * 0.8)
        }
        leafAttr.setY(i, y)
      }
      leafAttr.needsUpdate = true
    }

    // 抓取机：待机状态，夹爪停在中位不做动作（与设备清单"抓取机·待机"一致）
    claws.forEach((claw) => {
      claw.jaw.position.z = (claw.zMin + claw.zMax) / 2
      claw.jaw.position.y = claw.y
    })

    // 码垛机托叉：与整机节拍一致的伸缩
    forks.forEach((rig) => {
      const cycle = (elapsed * 0.12) % 1
      const k = cycle < 0.5 ? cycle / 0.5 : (1 - cycle) / 0.5
      rig.fork.position.z = rig.z + rig.dir * (0.2 + k * 1.9)
    })
  }

  function dispose(): void {
    for (const item of disposables) item.dispose()
    disposables.length = 0
  }

  return { group, update, dispose }
}
