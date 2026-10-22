/**
 * 蚕房内部结构模型 v7
 *
 * 本轮修正（针对"动作不连贯 / 跳跃 / 伸太远"）：
 *  1. 机械臂伸缩量由**目标位置反解**：取放点精确对齐蚕架货位与传送带，不再过冲、不再跳跃
 *  2. 蚕盘全程**跟着托叉连续移动**（托叉随身携带），到货位/平台/传送带时才交接，交接点重合 → 无跳变
 *  3. 码垛机中间平台**可放两盘蚕盘**（槽 A / 槽 B），左右机械臂**同时作业**
 *  4. 节拍放慢（整周期 ≈30s），每段动作舒缓
 *  5. 抓取机**只在有蚕盘经过时工作**，平时待机在传送带一侧后方（不再悬在传送带正上方空转）
 *  6. 抓取机长宽加大（门架 3.2m × 3.0m），码放台离传送带更远（1.35m）且与立柱互不重叠
 *  7. 传送带上的蚕盘由码垛机放入后才出现；到另一端**等码垛机来取**，不会自己消失
 *
 * 主线：取盘(蚕架) → 放中间平台 → 行走到带旁 → 放到左蓝带 → 循环(绿带投叶) → 右蓝带 → 码垛机取回 → 放回蚕架
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { DeviceKind, DeviceState } from '@/mock/houses'

export const ROOM = { w: 16, d: 15, h: 5.5 }

/* ---------------- 蚕架区 ---------------- */
const RACK_LENGTH = 10
const RACK_DEPTH = 1.6
const RACK_LEVELS = 5
const RACK_COLS = 4
const RACK_LEVEL_H = 0.62
const RACK_BASE_Y = 1.35
const RACK_Z = [-5.8, -2.2]
const AISLE_Z = -4.0
/** 码垛机在蚕架侧的作业位（避开实例化蚕盘列，保证货位与托盘一一对应） */
const PICK_X = -1.6
const WORK_Y = RACK_BASE_Y + RACK_LEVEL_H

/* ---------------- 传送系统 ---------------- */
const BELT_Y = 1.05
const GREEN_Z = 1.6
const BLUE_X = [-6.5, 6.5]
const BLUE_Z_FROM = -2.6
const BLUE_Z_TO = GREEN_Z

/* ---------------- 码垛机 ---------------- */
const CAR_H = 0.8
const CAR_TOP_Y = 1.15
const CAR_D = 2.6
/** 平台两个槽位（相对车厢中心） */
const SLOT_Z = 0.68
/** 托叉目标位移（相对车厢中心）：货位 / 传送带 */
const REACH_RACK = 1.8
const REACH_BELT = Math.abs(BLUE_Z_FROM - AISLE_Z)

/* ---------------- 抓取机 ---------------- */
const GRABBER_X = [-2.6, 2.6]
/** 门架：长（X）3.2m、宽（Z）3.0m */
const GRABBER_HALF_X = 1.6
const GRABBER_HALF_Z = 1.5
/** 抓爪高度：待机收在门架横杠下方（上方待机）／取盘／码放 */
const GRIPPER_IDLE_Y = -0.45
const GRIPPER_GRIP_Y = -1.79
const GRIPPER_PLACE_Y = -1.09
const STACK_Z = GREEN_Z + 1.35
const STACK_BASE_Y = 1.95
const GRIP_FRAME_LONG = 2.4
const GRIP_FRAME_SHORT = 1.8

/** 规格书 §3.2 设备编号 → 场景配色与标注 */
const NODE_BASE_COLOR: Record<DeviceKind, number> = {
  th01: 0x00e5ff,
  heat01: 0xff7a45,
  fan01: 0x00ffaa,
  fan02: 0x7c4dff,
  mist01: 0x00d5ff,
}
const NODE_LABEL: Record<DeviceKind, string> = {
  th01: '温湿度传感器 th01',
  heat01: '加热片 heat01',
  fan01: '风扇1 送风',
  fan02: '风扇2 排风',
  mist01: '雾化片 mist01',
}

export interface StructureNode {
  kind: DeviceKind
  core: THREE.Vector3
  labelY: number
}

export interface HouseStructure {
  group: THREE.Group
  rackGroup: THREE.Group
  nodes: Record<DeviceKind, StructureNode>
  setNodeStates(
    states: Record<DeviceKind, DeviceState>,
    alarmKind: DeviceKind | null,
    level: 'info' | 'warn' | 'critical',
  ): void
  update(elapsed: number, delta: number): void
  dispose(): void
  /** 供真实建模绑定的运行时数据（例：码垛机升降量） */
  runtime: { palletizerLift: number; palletizerTravelX: number }
  /** 隐藏程序化几何（保留告警光柱/光环/引线标注），切换到真实模型 */
  hideProceduralGeometry(): void
  /** 用真实模型的部件位置覆盖某个告警锚点 */
  setAnchor(kind: DeviceKind, position: THREE.Vector3): void
}

function ease(t: number): number {
  const k = Math.min(1, Math.max(0, t))
  return k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k)
}

export function buildHouseStructure(): HouseStructure {
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  const track = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(item: T): T => {
    disposables.push(item)
    return item
  }

  const group = new THREE.Group()
  const { w: W, d: D, h: H } = ROOM

  /* ---------------- 材质 ---------------- */
  const frameMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1b3a63,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.18,
      metalness: 0.85,
      roughness: 0.3,
    }),
  )
  const steelMat = track(
    new THREE.MeshStandardMaterial({ color: 0x8fa4c4, metalness: 0.9, roughness: 0.28 }),
  )
  const darkMat = track(
    new THREE.MeshStandardMaterial({ color: 0x2b3a55, metalness: 0.7, roughness: 0.45 }),
  )
  const glassMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x0a84ff,
      transparent: true,
      opacity: 0.055,
      roughness: 0.1,
      metalness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  const blueBeltMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x2e9bff,
      emissive: 0x2e9bff,
      emissiveIntensity: 0.34,
      metalness: 0.5,
      roughness: 0.5,
    }),
  )
  const robotMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1b4fbf,
      emissive: 0x2f6bff,
      emissiveIntensity: 0.42,
      metalness: 0.75,
      roughness: 0.35,
    }),
  )
  const gripperMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x3d6df2,
      emissive: 0x5f8cff,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.3,
    }),
  )
  const trayMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xe8833a,
      emissive: 0xe8833a,
      emissiveIntensity: 0.12,
      metalness: 0.25,
      roughness: 0.65,
    }),
  )
  const rackShelfMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1d4a72,
      metalness: 0.6,
      roughness: 0.5,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  )
  const arrowMat = track(
    new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85 }),
  )
  const trayGeo = track(new THREE.BoxGeometry(1.85, 0.12, 1.3))

  const nodeMaterials: Partial<Record<DeviceKind, THREE.MeshStandardMaterial>> = {}
  function nodeMaterial(kind: DeviceKind): THREE.MeshStandardMaterial {
    const hex = NODE_BASE_COLOR[kind]
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: 0.82,
        metalness: 0.45,
        roughness: 0.35,
      }),
    )
    nodeMaterials[kind] = mat
    return mat
  }
  function makeTray(): THREE.Mesh {
    return new THREE.Mesh(trayGeo, trayMat)
  }

  /* ---------------- 土建 ---------------- */
  const floor = new THREE.Mesh(track(new THREE.BoxGeometry(W + 0.6, 0.2, D + 0.6)), frameMat)
  floor.position.y = 0.1
  group.add(floor)

  const columnGeo = track(new THREE.BoxGeometry(0.22, H, 0.22))
  for (const cx of [-W / 2, W / 2]) {
    for (const cz of [-D / 2, D / 2]) {
      const column = new THREE.Mesh(columnGeo, frameMat)
      column.position.set(cx, H / 2, cz)
      group.add(column)
    }
  }

  const roofMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1b3a63,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.2,
      metalness: 0.8,
      roughness: 0.3,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  )
  const roof = new THREE.Mesh(track(new THREE.BoxGeometry(W + 0.5, 0.16, D + 0.5)), roofMat)
  roof.position.y = H
  group.add(roof)

  const wallGeoX = track(new THREE.PlaneGeometry(W, H))
  const wallGeoZ = track(new THREE.PlaneGeometry(D, H))
  for (const cz of [-D / 2, D / 2]) {
    const wall = new THREE.Mesh(wallGeoX, glassMat)
    wall.position.set(0, H / 2, cz)
    if (cz > 0) wall.rotation.y = Math.PI
    group.add(wall)
  }
  for (const cx of [-W / 2, W / 2]) {
    const wall = new THREE.Mesh(wallGeoZ, glassMat)
    wall.position.set(cx, H / 2, 0)
    wall.rotation.y = cx > 0 ? -Math.PI / 2 : Math.PI / 2
    group.add(wall)
  }

  /* ---------------- 蚕架 ---------------- */
  const rackGroup = new THREE.Group()
  group.add(rackGroup)

  const postHeight = RACK_BASE_Y + RACK_LEVELS * RACK_LEVEL_H
  const rackPostGeo = track(new THREE.BoxGeometry(0.14, postHeight, 0.14))
  const shelfGeo = track(new THREE.BoxGeometry(RACK_LENGTH, 0.1, RACK_DEPTH))
  const trays = new THREE.InstancedMesh(trayGeo, trayMat, RACK_LEVELS * RACK_COLS * RACK_Z.length)
  trays.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const m4 = new THREE.Matrix4()
  let trayIndex = 0

  for (const rz of RACK_Z) {
    for (const px of [-RACK_LENGTH / 2, RACK_LENGTH / 2]) {
      for (const pz of [-RACK_DEPTH / 2, RACK_DEPTH / 2]) {
        const post = new THREE.Mesh(rackPostGeo, darkMat)
        post.position.set(px, postHeight / 2, rz + pz)
        rackGroup.add(post)
      }
    }
    for (let level = 0; level < RACK_LEVELS; level++) {
      const y = RACK_BASE_Y + level * RACK_LEVEL_H
      const shelf = new THREE.Mesh(shelfGeo, rackShelfMat)
      shelf.position.set(0, y, rz)
      rackGroup.add(shelf)
      for (let col = 0; col < RACK_COLS; col++) {
        const x = -RACK_LENGTH / 2 + 1.4 + col * ((RACK_LENGTH - 2.8) / (RACK_COLS - 1))
        m4.makeTranslation(x, y + 0.08, rz)
        trays.setMatrixAt(trayIndex++, m4)
      }
    }
  }
  rackGroup.add(trays)

  /* ================= 码垛机 v7：车厢 + 双槽 + 左右伸缩臂 =================
     （机械化输送系统，规格书 §2.3 N2 另立项，不计入 §3.2 设备台账） */
  const palletizerMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xff2d7a,
      emissive: 0xff2d7a,
      emissiveIntensity: 0.14,
      metalness: 0.62,
      roughness: 0.34,
    }),
  )
  const palletizer = new THREE.Group()
  group.add(palletizer)

  const trackPlate = new THREE.Mesh(track(new THREE.BoxGeometry(W - 2.6, 0.06, 3.2)), darkMat)
  trackPlate.position.set(0, 0.2, AISLE_Z)
  palletizer.add(trackPlate)
  for (const rz of [-1.2, 1.2]) {
    const rail = new THREE.Mesh(track(new THREE.BoxGeometry(W - 2.6, 0.09, 0.12)), steelMat)
    rail.position.set(0, 0.27, AISLE_Z + rz)
    palletizer.add(rail)
  }

  const car = new THREE.Group()
  car.position.set(PICK_X, CAR_TOP_Y - CAR_H / 2, AISLE_Z)
  palletizer.add(car)
  // 升降立柱：整机上下移动时随高度伸缩
  const liftMast = new THREE.Mesh(track(new THREE.BoxGeometry(0.6, 1, 0.6)), darkMat)
  liftMast.position.set(PICK_X, (CAR_TOP_Y - CAR_H / 2) / 2, AISLE_Z)
  palletizer.add(liftMast)
  car.add(new THREE.Mesh(track(new THREE.BoxGeometry(3.2, CAR_H, CAR_D)), palletizerMat))
  const carTop = new THREE.Mesh(track(new THREE.BoxGeometry(3.05, 0.06, CAR_D - 0.1)), steelMat)
  carTop.position.y = CAR_H / 2 + 0.03
  car.add(carTop)
  for (const wx of [-1.2, 0, 1.2]) {
    for (const wz of [-0.9, 0.9]) {
      const wheel = new THREE.Mesh(track(new THREE.BoxGeometry(0.26, 0.16, 0.4)), darkMat)
      wheel.position.set(wx, -CAR_H / 2 - 0.04, wz)
      car.add(wheel)
    }
  }
  // 平台两个槽位标记 + 槽内蚕盘
  const slotTrays: THREE.Mesh[] = []
  for (const dir of [-1, 1]) {
    const plate = new THREE.Mesh(track(new THREE.BoxGeometry(1.95, 0.04, 1.4)), darkMat)
    plate.position.set(0, CAR_H / 2 + 0.05, dir * SLOT_Z)
    car.add(plate)
    const slotTray = makeTray()
    slotTray.position.set(0, CAR_H / 2 + 0.13, dir * SLOT_Z)
    slotTray.visible = false
    car.add(slotTray)
    slotTrays.push(slotTray)
  }

  // 平台内转运用托盘（槽 A ↔ 槽 B 之间滑动，两盘按顺序流转）
  const transferTray = makeTray()
  transferTray.position.set(0, CAR_H / 2 + 0.13, 0)
  transferTray.visible = false
  car.add(transferTray)

  interface PalletizerArm {
    dir: number
    /** 托叉总成：沿 Z 平移，蚕盘放在上面 */
    fork: THREE.Group
    link1: THREE.Object3D
    link2: THREE.Object3D
    forkTray: THREE.Mesh
    slotTray: THREE.Mesh
  }
  const parcArms: PalletizerArm[] = []

  for (const dir of [-1, 1]) {
    const armRoot = new THREE.Group()
    armRoot.position.set(0, CAR_H / 2 - 0.06, (dir * CAR_D) / 2)
    car.add(armRoot)

    const link1 = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.22, 1.1)), robotMat)
    link1.position.z = (dir * 1.1) / 2
    armRoot.add(link1)

    const link2 = new THREE.Mesh(track(new THREE.BoxGeometry(0.38, 0.18, 1.0)), steelMat)
    armRoot.add(link2)

    const fork = new THREE.Group()
    armRoot.add(fork)
    const forkBase = new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 0.08, 0.9)), robotMat)
    fork.add(forkBase)
    for (const fx of [-0.6, 0.6]) {
      const tine = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.05, 1.0)), steelMat)
      tine.position.set(fx, 0.06, 0)
      fork.add(tine)
    }
    const forkTray = makeTray()
    forkTray.position.y = 0.15
    forkTray.visible = false
    fork.add(forkTray)

    parcArms.push({
      dir,
      fork,
      link1,
      link2,
      forkTray,
      slotTray: slotTrays[dir < 0 ? 0 : 1]!,
    })
  }

  /** 托叉沿 Z 的位移（相对车厢中心）：0 → 槽位，1 → 货位/传送带 */
  function forkZ(dir: number, extendTo: number): number {
    return dir * (SLOT_Z + (extendTo - SLOT_Z))
  }
  /** 由"目标 Z（相对车厢中心）"反解托叉位移，保证精确对齐、不过冲 */
  function extendFor(dir: number, targetOffset: number): number {
    const t = Math.abs(targetOffset)
    return Math.min(1, Math.max(0, (t - SLOT_Z) / (REACH_RACK - SLOT_Z)))
  }

  // 蚕架货位上的蚕盘（与 PICK_X 货位一一对应，取放时可见）
  const shelfTrays: THREE.Mesh[] = []
  for (const dir of [-1, 1]) {
    const shelfTray = makeTray()
    shelfTray.position.set(PICK_X, WORK_Y + 0.08, RACK_Z[dir < 0 ? 0 : 1]!)
    group.add(shelfTray)
    shelfTrays.push(shelfTray)
  }

  /* ---------------- 绿色传送带（机械化输送系统 · §2.3 N2 另立项） ---------------- */
  const greenMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x12c46a,
      emissive: 0x12c46a,
      emissiveIntensity: 0.14,
      metalness: 0.5,
      roughness: 0.42,
    }),
  )
  const greenBelt = new THREE.Mesh(track(new THREE.BoxGeometry(W - 2.2, 0.14, 0.85)), greenMat)
  greenBelt.position.set(0, BELT_Y, GREEN_Z)
  group.add(greenBelt)

  const greenRailGeo = track(new THREE.BoxGeometry(W - 2.2, 0.1, 0.06))
  for (const rz of [-0.48, 0.48]) {
    const side = new THREE.Mesh(greenRailGeo, steelMat)
    side.position.set(0, BELT_Y + 0.12, GREEN_Z + rz)
    group.add(side)
  }
  const beltLegGeo = track(new THREE.BoxGeometry(0.12, BELT_Y - 0.14, 0.12))
  for (const lx of [-5.4, -1.8, 1.8, 5.4]) {
    const leg = new THREE.Mesh(beltLegGeo, steelMat)
    leg.position.set(lx, (BELT_Y - 0.14) / 2, GREEN_Z)
    group.add(leg)
  }

  /* ---------------- 蓝色传送带 ---------------- */
  const blueLength = Math.abs(BLUE_Z_TO - BLUE_Z_FROM)
  const blueCenterZ = (BLUE_Z_FROM + BLUE_Z_TO) / 2
  const blueBeltGeo = track(new THREE.BoxGeometry(0.75, 0.14, blueLength))
  for (const bx of BLUE_X) {
    const belt = new THREE.Mesh(blueBeltGeo, blueBeltMat)
    belt.position.set(bx, BELT_Y - 0.06, blueCenterZ)
    group.add(belt)
    for (const lz of [BLUE_Z_FROM + 0.8, blueCenterZ, BLUE_Z_TO - 0.8]) {
      const leg = new THREE.Mesh(beltLegGeo, steelMat)
      leg.position.set(bx, (BELT_Y - 0.2) / 2, lz)
      group.add(leg)
    }
  }

  /* ---------------- 方向箭头 ---------------- */
  const arrowGeo = track(new THREE.ConeGeometry(0.17, 0.42, 3))
  function addArrows(positions: THREE.Vector3[], rotY: number): void {
    for (const p of positions) {
      const arrow = new THREE.Mesh(arrowGeo, arrowMat)
      arrow.position.copy(p)
      arrow.rotation.set(Math.PI / 2, 0, 0)
      arrow.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), rotY)
      group.add(arrow)
    }
  }
  addArrows(
    [-4.2, -1.4, 1.4, 4.2].map((x) => new THREE.Vector3(x, BELT_Y + 0.02, GREEN_Z)),
    Math.PI / 2,
  )
  addArrows(
    [BLUE_Z_FROM + 1.1, blueCenterZ, BLUE_Z_TO - 1.1].map(
      (z) => new THREE.Vector3(BLUE_X[0]!, BELT_Y - 0.06, z),
    ),
    0,
  )
  addArrows(
    [BLUE_Z_FROM + 1.1, blueCenterZ, BLUE_Z_TO - 1.1].map(
      (z) => new THREE.Vector3(BLUE_X[1]!, BELT_Y - 0.06, z),
    ),
    Math.PI,
  )

  /* ---------------- 传送循环路径 ---------------- */
  const blueY = BELT_Y + 0.14
  const loopPoints = [
    new THREE.Vector3(BLUE_X[0]!, blueY, BLUE_Z_FROM),
    new THREE.Vector3(BLUE_X[0]!, blueY, BLUE_Z_TO),
    new THREE.Vector3(BLUE_X[1]!, BELT_Y + 0.2, BLUE_Z_TO),
    new THREE.Vector3(BLUE_X[1]!, blueY, BLUE_Z_FROM),
  ]
  // 只保留三段真实带面（左蓝带 → 绿带 → 右蓝带）。右端→左端由码垛机搬运，
  // 绝不能再作为路径段，否则蚕盘会穿过蚕架"自己跑回起点"
  const loopSegments = loopPoints.slice(0, loopPoints.length - 1).map((p, i) => {
    const next = loopPoints[i + 1]!
    return { from: p, to: next, length: p.distanceTo(next) }
  })
  const loopLength = loopSegments.reduce((sum, s) => sum + s.length, 0)

  interface LoopTray {
    mesh: THREE.Mesh
    distance: number
    active: boolean
  }
  const LOOP_CAPACITY = 5
  const loopTrays: LoopTray[] = []
  for (let i = 0; i < LOOP_CAPACITY; i++) {
    const mesh = makeTray()
    mesh.visible = false
    group.add(mesh)
    loopTrays.push({ mesh, distance: 0, active: false })
  }

  const pointAt = (distance: number, out: THREE.Vector3): number => {
    let d = Math.min(distance, loopLength)
    for (const seg of loopSegments) {
      if (d <= seg.length) {
        out.lerpVectors(seg.from, seg.to, seg.length === 0 ? 0 : d / seg.length)
        const dx = seg.to.x - seg.from.x
        const dz = seg.to.z - seg.from.z
        return Math.abs(dx) > Math.abs(dz)
          ? dx > 0
            ? 0
            : Math.PI
          : dz > 0
            ? Math.PI / 2
            : -Math.PI / 2
      }
      d -= seg.length
    }
    out.copy(loopPoints[3]!)
    return Math.PI / 2
  }

  function spawnLoopTray(): void {
    const free = loopTrays.find((t) => !t.active)
    if (!free) return
    free.active = true
    free.distance = 0
    free.mesh.visible = true
    free.mesh.position.copy(loopPoints[0]!)
  }
  function waitingTray(): LoopTray | null {
    let best: LoopTray | null = null
    for (const t of loopTrays) {
      if (t.active && t.distance >= loopLength - 0.8 && (!best || t.distance > best.distance)) best = t
    }
    return best
  }

  /* ================= 抓取机 v7：加大门架 + 按需作业 ================= */
  interface Grabber {
    carriage: THREE.Group
    gripper: THREE.Group
    mast: THREE.Object3D
    carried: THREE.Mesh
    stack: THREE.Object3D[]
    /** 0 = 待机；>0 表示作业进度 0→1 */
    work: number
    working: boolean
    phase: number
    target: LoopTray | null
  }
  const grabbers: Grabber[] = []
  const beamY = 3.5
  const gripZ = GREEN_Z

  for (const [gi, gx] of GRABBER_X.entries()) {
    const grabber = new THREE.Group()
    grabber.position.x = gx
    group.add(grabber)

    // 4 根支撑柱（长 3.2m × 宽 3.0m 的门架）
    for (const sx of [-GRABBER_HALF_X, GRABBER_HALF_X]) {
      for (const sz of [GREEN_Z - GRABBER_HALF_Z, GREEN_Z + GRABBER_HALF_Z]) {
        const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.26, beamY, 0.26)), robotMat)
        post.position.set(sx, beamY / 2, sz)
        grabber.add(post)
        const base = new THREE.Mesh(track(new THREE.BoxGeometry(0.6, 0.14, 0.6)), darkMat)
        base.position.set(sx, 0.07, sz)
        grabber.add(base)
      }
    }

    // 横杠（贯通绿带上方，前后延伸到码放台）
    const beam = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.34, 0.34, GRABBER_HALF_Z * 2 + 0.4)),
      robotMat,
    )
    beam.position.set(0, beamY, GREEN_Z)
    grabber.add(beam)
    const rackBar = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.18, 0.12, GRABBER_HALF_Z * 2 + 0.4)),
      steelMat,
    )
    rackBar.position.set(0, beamY - 0.24, GREEN_Z)
    grabber.add(rackBar)

    // 夹爪总成
    const carriage = new THREE.Group()
    carriage.position.set(0, beamY - 0.32, GREEN_Z)
    grabber.add(carriage)
    carriage.add(new THREE.Mesh(track(new THREE.BoxGeometry(0.7, 0.4, 0.7)), gripperMat))
    // 可伸缩立柱（长度随抓爪升降变化）
    const mast = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 1, 0.16)), steelMat)
    carriage.add(mast)

    const gripper = new THREE.Group()
    gripper.position.y = GRIPPER_IDLE_Y
    carriage.add(gripper)
    for (const fz of [-GRIP_FRAME_SHORT / 2, GRIP_FRAME_SHORT / 2]) {
      const bar = new THREE.Mesh(track(new THREE.BoxGeometry(GRIP_FRAME_LONG, 0.18, 0.09)), gripperMat)
      bar.position.z = fz
      gripper.add(bar)
    }
    for (const fx of [-GRIP_FRAME_LONG / 2, GRIP_FRAME_LONG / 2]) {
      const bar = new THREE.Mesh(track(new THREE.BoxGeometry(0.09, 0.18, GRIP_FRAME_SHORT)), gripperMat)
      bar.position.x = fx
      gripper.add(bar)
    }

    // 夹爪携带的蚕盘：挂在抓爪上，随抓爪一起升降（交接点与带面/码放台重合，不跳变）
    const carried = makeTray()
    carried.position.y = -0.14
    carried.visible = false
    gripper.add(carried)

    // 码放台（离传送带 1.35m，与立柱不重叠：立柱在 X=±1.6、Z=±1.5）
    const stack: THREE.Object3D[] = []
    const legGeo = track(new THREE.BoxGeometry(0.14, STACK_BASE_Y - 0.18, 0.14))
    for (const sx of [-0.78, 0.78]) {
      for (const sz of [-0.5, 0.5]) {
        const leg = new THREE.Mesh(legGeo, darkMat)
        leg.position.set(sx, (STACK_BASE_Y - 0.18) / 2, STACK_Z + sz)
        grabber.add(leg)
      }
    }
    const stand = new THREE.Mesh(
      track(new THREE.BoxGeometry(GRIP_FRAME_LONG, 0.14, GRIP_FRAME_SHORT)),
      rackShelfMat,
    )
    stand.position.set(0, STACK_BASE_Y - 0.09, STACK_Z)
    grabber.add(stand)
    for (let i = 0; i < 3; i++) {
      const tray = makeTray()
      tray.position.set(0, STACK_BASE_Y + i * 0.18, STACK_Z)
      grabber.add(tray)
      stack.push(tray)
    }

    grabbers.push({
      carriage,
      gripper,
      mast,
      carried,
      stack,
      work: 0,
      working: false,
      phase: gi * 0.5,
      target: null,
    })
  }

  /* ---------------- 投叶漏斗 ---------------- */
  const hopper = new THREE.Group()
  hopper.position.set(0, 0, GREEN_Z)
  group.add(hopper)

  const hopperBin = new THREE.Mesh(
    track(new THREE.BoxGeometry(1.7, 0.9, 1.7)),
    track(
      new THREE.MeshStandardMaterial({
        color: 0x9fe8b8,
        emissive: 0x00ffaa,
        emissiveIntensity: 0.16,
        transparent: true,
        opacity: 0.5,
        metalness: 0.4,
        roughness: 0.5,
      }),
    ),
  )
  hopperBin.position.y = 4.8
  hopper.add(hopperBin)

  const cone = new THREE.Mesh(
    track(new THREE.CylinderGeometry(1.05, 0.18, 1.4, 22, 1, true)),
    track(
      new THREE.MeshStandardMaterial({
        color: 0xbdd7ff,
        metalness: 0.6,
        roughness: 0.35,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72,
      }),
    ),
  )
  cone.position.y = 3.65
  hopper.add(cone)

  const hopperGate = new THREE.Mesh(track(new THREE.BoxGeometry(0.55, 0.06, 0.55)), steelMat)
  hopperGate.position.y = 2.95
  hopper.add(hopperGate)

  const LEAF_COUNT = 48
  const leafPositions = new Float32Array(LEAF_COUNT * 3)
  const leafSpeed = new Float32Array(LEAF_COUNT)
  for (let i = 0; i < LEAF_COUNT; i++) {
    leafPositions[i * 3] = (Math.random() - 0.5) * 0.8
    leafPositions[i * 3 + 1] = 2.85 - Math.random() * 1.7
    leafPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.8
    leafSpeed[i] = 0.8 + Math.random() * 0.9
  }
  const leafGeo = track(new THREE.BufferGeometry())
  leafGeo.setAttribute('position', new THREE.BufferAttribute(leafPositions, 3))
  const leafMat = track(
    new THREE.PointsMaterial({
      color: 0x7ee06a,
      size: 0.12,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  )
  hopper.add(new THREE.Points(leafGeo, leafMat))

  /* ---------------- 风扇 / 节点 ---------------- */
  const fans: THREE.Object3D[] = []
  const fanBladeGeo = track(new THREE.BoxGeometry(0.34, 0.06, 0.05))
  function buildFan(radius: number): THREE.Object3D {
    const blades = new THREE.Group()
    const count = 5
    for (let i = 0; i < count; i++) {
      const blade = new THREE.Mesh(fanBladeGeo, steelMat)
      blade.scale.setScalar(radius / 0.68)
      blade.rotation.z = (i * Math.PI * 2) / count
      blade.position.set(
        Math.cos((i * Math.PI * 2) / count) * radius * 0.5,
        Math.sin((i * Math.PI * 2) / count) * radius * 0.5,
        0,
      )
      blades.add(blade)
    }
    fans.push(blades)
    return blades
  }

  const nodes = {} as Record<DeviceKind, StructureNode>
  function addNodeLabel(text: string, position: THREE.Vector3, cssColor: string): void {
    const div = document.createElement('div')
    div.textContent = text
    div.style.cssText = `color:${cssColor};font-size:11px;letter-spacing:1px;text-shadow:0 0 8px ${cssColor};white-space:nowrap;pointer-events:none;`
    const label = new CSS2DObject(div)
    label.position.copy(position)
    group.add(label)
  }

  /* ---------- th01 温湿度传感器（DHT22，蚕架中部，贴近蚕座） ---------- */
  const sensorMat = nodeMaterial('th01')
  const sensorPole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 8)), sensorMat)
  sensorPole.position.set(-7.0, 1.15, 0.9)
  group.add(sensorPole)
  const sensorCore = new THREE.Mesh(track(new THREE.SphereGeometry(0.27, 20, 16)), sensorMat)
  sensorCore.position.set(-7.0, 2.4, 0.9)
  group.add(sensorCore)
  nodes.th01 = { kind: 'th01', core: new THREE.Vector3(-7.0, 2.4, 0.9), labelY: 3.0 }
  addNodeLabel(NODE_LABEL.th01, new THREE.Vector3(-7.0, 3.0, 0.9), '#9fe8ff')

  /* ---------- fan01 送风 / fan02 排风（4010 风扇，对角墙面一送一排） ---------- */
  const fanDefs: { ax: number; kind: 'fan01' | 'fan02'; dir: number }[] = [
    { ax: -W / 2 + 0.35, kind: 'fan01', dir: 1 },
    { ax: W / 2 - 0.35, kind: 'fan02', dir: -1 },
  ]
  for (const f of fanDefs) {
    const mat = nodeMaterial(f.kind)
    const bodyFan = new THREE.Mesh(track(new THREE.BoxGeometry(0.55, 1.15, 2.0)), mat)
    bodyFan.position.set(f.ax, 3.5, 0)
    group.add(bodyFan)
    const grille = new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.78, 1.55)), darkMat)
    grille.position.set(f.ax + f.dir * 0.3, 3.5, 0)
    grille.rotation.y = Math.PI / 2
    group.add(grille)
    const blades = buildFan(0.55)
    blades.position.set(f.ax + f.dir * 0.32, 3.5, 0)
    blades.rotation.y = Math.PI / 2
    group.add(blades)
  }
  nodes.fan01 = { kind: 'fan01', core: new THREE.Vector3(-W / 2 + 0.7, 3.5, 0), labelY: 4.6 }
  addNodeLabel(NODE_LABEL.fan01, new THREE.Vector3(-W / 2 + 0.7, 4.6, 0), '#9fffdd')
  nodes.fan02 = { kind: 'fan02', core: new THREE.Vector3(W / 2 - 0.7, 3.5, 0), labelY: 4.6 }
  addNodeLabel(NODE_LABEL.fan02, new THREE.Vector3(W / 2 - 0.7, 4.6, 0), '#c9b6ff')

  /* ---------- heat01 加热片（ST201 自限温 PTC，装在蚕架下方） ---------- */
  const heatMat = nodeMaterial('heat01')
  const heatPlate = new THREE.Mesh(track(new THREE.BoxGeometry(1.8, 0.16, 1.0)), heatMat)
  heatPlate.position.set(-4.5, 0.3, RACK_Z[1]!)
  group.add(heatPlate)
  for (const hx of [-5.2, -3.8]) {
    const leg = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8)), darkMat)
    leg.position.set(hx, 0.17, RACK_Z[1]!)
    group.add(leg)
  }
  nodes.heat01 = { kind: 'heat01', core: new THREE.Vector3(-4.5, 0.42, RACK_Z[1]!), labelY: 1.05 }
  addNodeLabel(NODE_LABEL.heat01, new THREE.Vector3(-4.5, 1.05, RACK_Z[1]!), '#ffc0a0')

  /* ---------- mist01 雾化片（超声波 φ20，水箱上方出雾口朝上） ---------- */
  const mistMat = nodeMaterial('mist01')
  const mistTank = new THREE.Mesh(track(new THREE.BoxGeometry(0.78, 0.6, 0.78)), steelMat)
  mistTank.position.set(W / 2 - 1.7, 0.3, D / 2 - 1.7)
  group.add(mistTank)
  const mistDisc = new THREE.Mesh(track(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 18)), mistMat)
  mistDisc.position.set(W / 2 - 1.7, 0.64, D / 2 - 1.7)
  group.add(mistDisc)
  nodes.mist01 = { kind: 'mist01', core: new THREE.Vector3(W / 2 - 1.7, 0.72, D / 2 - 1.7), labelY: 1.5 }
  addNodeLabel(NODE_LABEL.mist01, new THREE.Vector3(W / 2 - 1.7, 1.5, D / 2 - 1.7), '#a8f0ff')

  const exhaustGrilleMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xff9900,
      emissive: 0xff9900,
      emissiveIntensity: 0.4,
      metalness: 0.5,
      roughness: 0.4,
    }),
  )
  for (const ax of [-3.2, 3.2]) {
    const supplyBody = new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 0.7, 0.34)), frameMat)
    supplyBody.position.set(ax, 4.9, -D / 2 + 0.22)
    group.add(supplyBody)
    const supplyGrille = new THREE.Mesh(track(new THREE.BoxGeometry(1.2, 0.48, 0.06)), darkMat)
    supplyGrille.position.set(ax, 4.9, -D / 2 + 0.42)
    group.add(supplyGrille)
    const supplyBlades = buildFan(0.42)
    supplyBlades.position.set(ax, 4.9, -D / 2 + 0.46)
    group.add(supplyBlades)

    const exhaustBody = new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 0.7, 0.34)), steelMat)
    exhaustBody.position.set(ax, 4.9, D / 2 - 0.22)
    group.add(exhaustBody)
    const exhaustGrille = new THREE.Mesh(
      track(new THREE.BoxGeometry(1.2, 0.48, 0.06)),
      exhaustGrilleMat,
    )
    exhaustGrille.position.set(ax, 4.9, D / 2 - 0.42)
    group.add(exhaustGrille)
    const exhaustBlades = buildFan(0.42)
    exhaustBlades.position.set(ax, 4.9, D / 2 - 0.46)
    group.add(exhaustBlades)
  }

  function setNodeStates(
    states: Record<DeviceKind, DeviceState>,
    alarmKind: DeviceKind | null,
    level: 'info' | 'warn' | 'critical',
  ): void {
    const alarmHex = level === 'critical' ? 0xff3333 : level === 'warn' ? 0xffd500 : 0x00e5ff
    for (const kind of Object.keys(nodeMaterials) as DeviceKind[]) {
      const mat = nodeMaterials[kind]
      if (!mat) continue
      const state = states[kind] ?? 'normal'
      const isAlarm = kind === alarmKind && state !== 'normal'
      if (state === 'offline') {
        mat.color.setHex(0x5b6b8c)
        mat.emissive.setHex(0x5b6b8c)
        mat.emissiveIntensity = 0.2
      } else if (isAlarm) {
        mat.color.setHex(alarmHex)
        mat.emissive.setHex(alarmHex)
        mat.emissiveIntensity = 1.85
      } else if (alarmKind) {
        mat.color.setHex(NODE_BASE_COLOR[kind]).multiplyScalar(0.45)
        mat.emissive.setHex(NODE_BASE_COLOR[kind]).multiplyScalar(0.45)
        mat.emissiveIntensity = 0.3
      } else {
        mat.color.setHex(NODE_BASE_COLOR[kind])
        mat.emissive.setHex(NODE_BASE_COLOR[kind])
        mat.emissiveIntensity = 0.82
      }
    }
  }

  /* ================= 码垛机时序：双槽 + 双臂同时作业 ================= */
  type PhaseName =
    | 'pick-both'
    | 'to-left'
    | 'place-left-1'
    | 'transfer-a'
    | 'place-left-2'
    | 'to-right'
    | 'pick-return-1'
    | 'transfer-back'
    | 'pick-return-2'
    | 'to-rack'
    | 'place-both'
  const PHASES: { name: PhaseName; dur: number; x: number }[] = [
    { name: 'pick-both', dur: 5.0, x: PICK_X },
    { name: 'to-left', dur: 4.2, x: BLUE_X[0]! },
    { name: 'place-left-1', dur: 3.0, x: BLUE_X[0]! },
    { name: 'transfer-a', dur: 1.0, x: BLUE_X[0]! },
    { name: 'place-left-2', dur: 3.0, x: BLUE_X[0]! },
    { name: 'to-right', dur: 5.0, x: BLUE_X[1]! },
    { name: 'pick-return-1', dur: 3.0, x: BLUE_X[1]! },
    { name: 'transfer-back', dur: 1.0, x: BLUE_X[1]! },
    { name: 'pick-return-2', dur: 3.0, x: BLUE_X[1]! },
    { name: 'to-rack', dur: 4.2, x: PICK_X },
    { name: 'place-both', dur: 5.0, x: PICK_X },
  ]
  const CYCLE = PHASES.reduce((sum, p) => sum + p.dur, 0)

  /** 随机货层（1 ~ 顶层，且与上一次不同）：整机要升到该层取放，体现上下移动 */
  const randLevel = () => 1 + Math.floor(Math.random() * (RACK_LEVELS - 1))
  const nextLevel = (prev: number) => {
    let lv = randLevel()
    while (lv === prev) lv = randLevel()
    return lv
  }
  /** 货层对应的蚕盘中心高度 */
  const shelfY = (level: number) => RACK_BASE_Y + level * RACK_LEVEL_H + 0.08
  /** 车厢基准高度（平台面 ≈ 传送带台面）／升到某货层时的高度 */
  const CAR_BASE_Y = CAR_TOP_Y - CAR_H / 2
  const carYForLevel = (level: number) => shelfY(level) - CAR_H / 2
  let pickLevel = randLevel()
  let placeLevel = nextLevel(pickLevel)
  let lastPhaseName: string | null = null
  /** 整机升降的起点与相位记录 */
  let carYStart = CAR_BASE_Y
  let lastPhaseForY: string | null = null
  /** 右端等待蚕盘到位的累计时长（秒） */
  let waitAccum = 0
  /** 对外暴露的运行时数据：码垛机相对基准高度的升降量（供真实模型绑定） */
  const runtime = { palletizerLift: 0, palletizerTravelX: 0 }
  /** 真实模型模式：只推进时序（驱动码垛机升降），跳过全部程序化几何动画 */
  let realMode = false

  /** 槽位是否有盘（索引与 parcArms 对应：0 = -Z 臂，1 = +Z 臂） */
  const slotFilled = [false, false]
  // 从第一段（双侧随机货层取盘）开始，开场即可看到"上下取放"的动作，且两盘都真实取到
  let cycleTime = 0
  let armExtend = [0, 0]
  let carriedVisible = [false, false]
  let shelfVisible = [false, false]
  let shelfLift = [0, 0]

  const leafAttr = leafGeo.getAttribute('position') as THREE.BufferAttribute
  const loopPos = new THREE.Vector3()

  function update(elapsed: number, delta: number): void {
    // ---- 真实模型模式：只推进时序，保证码垛机按原节拍升降 ----
    if (realMode) {
      cycleTime += delta
      if (cycleTime >= CYCLE) cycleTime -= CYCLE
      let acc2 = 0
      let ph = PHASES[0]!
      let lt2 = 0
      for (const p of PHASES) {
        if (cycleTime < acc2 + p.dur) {
          ph = p
          lt2 = (cycleTime - acc2) / p.dur
          break
        }
        acc2 += p.dur
      }
      if (ph.name !== lastPhaseName) {
        if (ph.name === 'pick-both') pickLevel = nextLevel(pickLevel)
        if (ph.name === 'place-both') placeLevel = nextLevel(pickLevel)
        lastPhaseName = ph.name
      }
      const targetY =
        ph.name === 'pick-both'
          ? carYForLevel(pickLevel)
          : ph.name === 'place-both' || ph.name === 'to-rack'
            ? carYForLevel(placeLevel)
            : CAR_BASE_Y
      car.position.y += (targetY - car.position.y) * Math.min(1, delta * 2.2)
      runtime.palletizerLift = car.position.y - CAR_BASE_Y
      // 整机沿地面轨道左右行走（与原时序一致）
      const fromX2 =
        ph.name === 'to-left'
          ? PICK_X
          : ph.name === 'to-right'
            ? BLUE_X[0]!
            : ph.name === 'to-rack'
              ? BLUE_X[1]!
              : undefined
      car.position.x = fromX2 === undefined ? ph.x : fromX2 + (ph.x - fromX2) * ease(lt2)
      runtime.palletizerTravelX = car.position.x - PICK_X
      return
    }

    /* ---------- 码垛机 ---------- */
    // 取盘段：若右蓝带端还没有蚕盘到位，则停在右端等待（不推进时序），
    // 保证"蚕盘到右端一定有码垛机来取"，而不是空跑一趟
    let probeAcc = 0
    let probeName = PHASES[0]!.name
    let probeT = 0
    for (const p of PHASES) {
      if (cycleTime < probeAcc + p.dur) {
        probeName = p.name
        probeT = (cycleTime - probeAcc) / p.dur
        break
      }
      probeAcc += p.dur
    }
    const wantWait =
      (probeName === 'pick-return-1' || probeName === 'pick-return-2') &&
      probeT > 0.6 &&
      !slotFilled[1] &&
      waitingTray() === null
    // 等待蚕盘到位（最多等 20s，避免极端情况下卡死）
    if (wantWait && waitAccum < 8) {
      waitAccum += delta
    } else {
      waitAccum = 0
      cycleTime += delta
      if (cycleTime >= CYCLE) cycleTime -= CYCLE
    }

    let acc = 0
    let phase = PHASES[0]!
    let localT = 0
    for (const p of PHASES) {
      if (cycleTime < acc + p.dur) {
        phase = p
        localT = (cycleTime - acc) / p.dur
        break
      }
      acc += p.dur
    }
    // 相位切换时重新随机货层
    if (phase.name !== lastPhaseName) {
      if (phase.name === 'pick-both') pickLevel = nextLevel(pickLevel)
      if (phase.name === 'place-both') placeLevel = nextLevel(pickLevel)
      lastPhaseName = phase.name
    }

    // 行走：仅在行走段插值，作业段停在工位
    const travelFrom: Partial<Record<PhaseName, number>> = {
      'to-left': PICK_X,
      'to-right': BLUE_X[0]!,
      'to-rack': BLUE_X[1]!,
    }
    const fromX = travelFrom[phase.name]
    car.position.x = fromX === undefined ? phase.x : fromX + (phase.x - fromX) * ease(localT)
    car.position.z = AISLE_Z

    // 整机上下移动：取/放蚕架时升到对应货层高度，去传送带时降回传送带高度
    if (phase.name !== lastPhaseForY) {
      carYStart = car.position.y
      lastPhaseForY = phase.name
    }
    const yTarget =
      phase.name === 'pick-both'
        ? carYForLevel(pickLevel)
        : phase.name === 'place-both' || phase.name === 'to-rack'
          ? carYForLevel(placeLevel)
          : CAR_BASE_Y
    const yProg =
      phase.name === 'pick-both'
        ? Math.min(1, localT / 0.45)
        : phase.name === 'place-both'
          ? Math.min(1, localT / 0.55)
          : ease(localT)
    car.position.y = carYStart + (yTarget - carYStart) * yProg
    runtime.palletizerLift = car.position.y - CAR_BASE_Y
    liftMast.position.x = car.position.x
    liftMast.position.y = Math.max(0.2, car.position.y) / 2
    liftMast.scale.y = Math.max(0.2, car.position.y)

    // 重置每帧姿态
    armExtend = [0, 0]
    carriedVisible = [false, false]
    shelfVisible = [false, false]
    shelfLift = [0, 0]
    transferTray.visible = false
    for (let i = 0; i < 2; i++) slotTrays[i]!.visible = slotFilled[i]!

    const isPlace = phase.name === 'place-left-1' || phase.name === 'place-left-2'
    const isPickReturn = phase.name === 'pick-return-1' || phase.name === 'pick-return-2'
    const isTransfer = phase.name === 'transfer-a' || phase.name === 'transfer-back'

    if (phase.name === 'pick-both') {
      // 左右臂同时伸入蚕架 A / B：托叉插入蚕盘下方 → 小抬起 → 收回放到平台双槽
      const k = localT
      if (k < 0.34) {
        armExtend = [ease(k / 0.34), ease(k / 0.34)]
        shelfVisible = [true, true]
      } else if (k < 0.52) {
        armExtend = [1, 1]
        shelfVisible = [true, true]
        const lift = ((k - 0.34) / 0.18) * 0.16
        shelfLift = [lift, lift]
      } else {
        armExtend = [1 - ease((k - 0.52) / 0.48), 1 - ease((k - 0.52) / 0.48)]
        carriedVisible = [true, true]
        if (k > 0.9) {
          slotFilled[0] = true
          slotFilled[1] = true
        }
      }
    } else if (isPlace) {
      // +Z 臂把槽 B 的蚕盘缓慢放到左蓝带；两盘由中转段串起来，按顺序依次上带
      const k = localT
      const targetExtend = extendFor(1, REACH_BELT)
      const hasTray = slotFilled[1]!
      if (k < 0.45) {
        armExtend = [0, ease(k / 0.45) * targetExtend]
        carriedVisible = [false, hasTray]
        slotTrays[1]!.visible = false
      } else if (k < 0.7) {
        armExtend = [0, targetExtend]
        carriedVisible = [false, hasTray]
        slotTrays[1]!.visible = false
      } else {
        armExtend = [0, targetExtend * (1 - ease((k - 0.7) / 0.3))]
        carriedVisible = [false, hasTray && k < 0.72]
        if (k > 0.72 && slotFilled[1]) {
          // 只在真正有盘时生成，且整段只生成一次（避免一盘变多盘 / 空放丢盘）
          spawnLoopTray()
          slotFilled[1] = false
        }
      }
    } else if (isTransfer) {
      // 平台内转运：槽 A ↔ 槽 B 滑动交接（可见的搬运，不是瞬间跳位）
      const k = ease(localT)
      const dir = phase.name === 'transfer-a' ? 1 : -1
      const fromFilled = phase.name === 'transfer-a' ? slotFilled[0]! : slotFilled[1]!
      transferTray.visible = fromFilled
      transferTray.position.z = -dir * SLOT_Z + dir * SLOT_Z * 2 * k
      slotTrays[0]!.visible = false
      slotTrays[1]!.visible = false
      if (k > 0.96) {
        if (phase.name === 'transfer-a') {
          slotFilled[0] = false
          slotFilled[1] = true
        } else {
          slotFilled[1] = false
          slotFilled[0] = true
        }
      }
    } else if (isPickReturn) {
      // +Z 臂从右蓝带端取回等待的蚕盘 → 搬回槽 B
      const k = localT
      const targetExtend = extendFor(1, REACH_BELT)
      if (k < 0.4) {
        armExtend = [0, ease(k / 0.4) * targetExtend]
      } else if (k < 0.6) {
        armExtend = [0, targetExtend]
      } else {
        const wait = slotFilled[1] ? null : waitingTray()
        if (wait && k > 0.62) {
          wait.active = false
          wait.mesh.visible = false
          slotFilled[1] = true
        }
        armExtend = [0, targetExtend * (1 - ease((k - 0.6) / 0.4))]
        carriedVisible = [false, slotFilled[1]!]
        slotTrays[1]!.visible = false
      }
    } else if (phase.name === 'place-both') {
      // 左右臂同时把两槽蚕盘放回蚕架 A / B
      const k = localT
      const target = extendFor(-1, REACH_RACK)
      if (k < 0.5) {
        armExtend = [ease(k / 0.5) * target, ease(k / 0.5) * target]
        carriedVisible = [slotFilled[0]!, slotFilled[1]!]
        slotTrays[0]!.visible = false
        slotTrays[1]!.visible = false
      } else if (k < 0.7) {
        armExtend = [target, target]
        shelfVisible = [true, true]
        const lift = (1 - (k - 0.5) / 0.2) * 0.16
        shelfLift = [lift, lift]
        slotFilled[0] = false
        slotFilled[1] = false
      } else {
        armExtend = [target * (1 - ease((k - 0.7) / 0.3)), target * (1 - ease((k - 0.7) / 0.3))]
      }
    }

    // 应用到模型
    parcArms.forEach((arm, i) => {
      const e = armExtend[i] ?? 0
      const forkOffset = forkZ(arm.dir, SLOT_Z + (REACH_RACK - SLOT_Z) * e)
      arm.fork.position.z = forkOffset - (arm.dir * CAR_D) / 2
      arm.link1.position.z = (arm.dir * (1.1 + e * 0.9)) / 2
      arm.link2.position.z = (arm.dir * (0.55 + e * 1.5)) / 2
      // 整机已经上下到货层高度，托叉只需在平台面高度平进平出（带 0.16m 小抬起）
      arm.fork.position.y = shelfLift[i] ?? 0
      arm.forkTray.visible = carriedVisible[i] ?? false
      arm.slotTray.visible = slotTrays[i]!.visible
    })
    for (let i = 0; i < 2; i++) {
      const level = phase.name === 'place-both' ? placeLevel : pickLevel
      shelfTrays[i]!.visible = shelfVisible[i] ?? false
      shelfTrays[i]!.position.y = shelfY(level) + (shelfLift[i] ?? 0)
    }

    /* ---------- 传送循环蚕盘（码垛机放盘后才出现，到端点等待被取走） ---------- */
    const beltSpeed = 2.0
    const sorted = loopTrays.filter((t) => t.active).sort((a, b) => b.distance - a.distance)
    let limit = loopLength
    for (const item of sorted) {
      item.distance = Math.min(item.distance + beltSpeed * delta, limit)
      limit = item.distance - 1.75
      const rotY = pointAt(item.distance, loopPos)
      item.mesh.position.copy(loopPos)
      item.mesh.rotation.y = rotY
    }

    /* ---------- 抓取机：只在有蚕盘经过时作业，平时待机 ---------- */
    grabbers.forEach((grabber) => {
      // 抓取机纯待机：抓爪收在门架横杠下方（上方待机），正对传送带中心线；
      // 蚕盘经过时也不动作（不抓取、不码放）
      grabber.carriage.position.z = gripZ
      grabber.gripper.position.y = GRIPPER_IDLE_Y
      grabber.carried.visible = false
      const gy = grabber.gripper.position.y
      grabber.mast.scale.y = Math.max(0.12, -0.2 - gy)
      grabber.mast.position.y = (-0.2 + gy) / 2
      grabber.stack.forEach((tray, ti) => {
        tray.position.y = STACK_BASE_Y + ti * 0.18 + Math.sin(elapsed * 1.6 + ti * 0.5) * 0.015
      })
    })

    /* ---------- 投叶漏斗 ---------- */
    const trayUnder = loopTrays.some(
      (t) =>
        t.active && Math.abs(t.mesh.position.x) < 1.2 && Math.abs(t.mesh.position.z - GREEN_Z) < 0.6,
    )
    hopperGate.position.y = 2.95 - (trayUnder ? 0.2 : 0)
    hopperGate.rotation.y = trayUnder ? Math.PI * 0.25 : 0
    leafMat.opacity += ((trayUnder ? 0.95 : 0) - leafMat.opacity) * 0.15

    if (leafMat.opacity > 0.05) {
      for (let i = 0; i < LEAF_COUNT; i++) {
        const speed = leafSpeed[i] ?? 1
        let y = leafAttr.getY(i) - speed * 0.022
        if (y < 1.2) {
          y = 2.85
          leafAttr.setX(i, (Math.random() - 0.5) * 0.8)
          leafAttr.setZ(i, (Math.random() - 0.5) * 0.8)
        }
        leafAttr.setY(i, y)
      }
      leafAttr.needsUpdate = true
    }

    for (const fan of fans) fan.rotation.z += 0.09
  }

  /** 真实模型模式：隐藏程序化几何，只保留告警光柱 / 光环 / 引线标注 */
  function hideProceduralGeometry(): void {
    realMode = true
    group.traverse((o) => {
      if (o.userData.keepOnRealModel) return
      const any = o as THREE.Object3D & {
        isMesh?: boolean
        isInstancedMesh?: boolean
        isPoints?: boolean
        isLine?: boolean
        isCSS2DObject?: boolean
      }
      if (any.isMesh || any.isInstancedMesh || any.isPoints || any.isLine || any.isCSS2DObject) {
        o.visible = false
      }
    })
  }

  /** 用真实模型的部件位置覆盖告警锚点 */
  function setAnchor(kind: DeviceKind, position: THREE.Vector3): void {
    const node = nodes[kind]
    if (!node) return
    node.core.copy(position)
    node.labelY = position.y + 0.6
  }

  function dispose(): void {
    for (const item of disposables) item.dispose()
    disposables.length = 0
  }

  return {
    group,
    rackGroup,
    nodes,
    runtime,
    setNodeStates,
    update,
    hideProceduralGeometry,
    setAnchor,
    dispose,
  }
}
