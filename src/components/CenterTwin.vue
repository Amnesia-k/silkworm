<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import DigitalNumber from '@/components/DigitalNumber.vue'
import HouseMatrix from '@/components/HouseMatrix.vue'
import { useSelectedHouse } from '@/composables/useSelectedHouse'
import { coreMetrics } from '@/mock/bigscreen'
import {
  houseStatusMeta,
  houses,
  zones,
  type DeviceKind,
  type DeviceState,
  type HouseNode,
  type HouseStatus,
  type ZoneNode,
} from '@/mock/houses'
import {
  alarmLevelMeta,
  controlModeMeta,
  overrunLevelMeta,
  type AlarmLevel,
} from '@/mock/spec'
import { ROOM, buildHouseStructure, type HouseStructure } from '@/three/houseStructure'
import { loadRealModel, type RealModel } from '@/three/modelLoader'

/**
 * 中央核心区：蚕房园区视图
 *
 * 交互主线：
 *  1. 首屏 = 2D 蚕房总览：4 个厂区各 1 栋，问题栋标红 / 标黄并呼吸闪烁。
 *  2. 点击任一卡片 → 该栋蚕房「搬到屏幕正中央」单独展示：整片园区隐藏，
 *     只剩这一栋真实内部结构（蚕架 / 传送带 / 码垛机 / 抓取机 / 投叶漏斗 / 空调 / 出排气）。
 *  3. 3D 内为「看结构」优化：相机可贴近 360° 环绕 + 平移 + 自动旋转；
 *     蚕架半透明且可一键隐藏；异常设备用告警光柱 + 地面光圈 + 引线标注框锁定。
 */

type ViewMode = 'matrix' | 'twin'
type PresetKind = 'top' | 'side' | 'front' | 'reset'

const hostEl = ref<HTMLDivElement | null>(null)
/** 首屏默认 2D 总览 */
const viewMode = ref<ViewMode>('matrix')
const focusedId = ref<string | null>(null)
/** 蚕架是否显示 */
const racksVisible = ref(true)
/** 自动旋转开关 */

const focused = computed<HouseNode | null>(
  () => houses.find((h) => h.id === focusedId.value) ?? null,
)

/** 与 2D 总览卡片、底部趋势图共用选中状态 */
const { selectHouse } = useSelectedHouse()

const viewTabs: { key: ViewMode; label: string; sub: string }[] = [
  { key: 'matrix', label: '蚕房总览', sub: '2D' },
  { key: 'twin', label: '园区三维', sub: '3D' },
]

/* ============================ 常量 ============================ */
const HOUSE_W = ROOM.w
const HOUSE_D = ROOM.d
const HOUSE_H = ROOM.h
/** 告警光柱顶端高度（穿出屋顶） */
const BEACON_TOP = HOUSE_H + 4.6

const BODY_TINT: Record<HouseStatus, number> = {
  normal: 0x14304f,
  warning: 0x3a3208,
  critical: 0x3d1414,
  offline: 0x272f45,
}
const CAP_COLOR: Record<HouseStatus, number> = {
  normal: 0x00e5ff,
  warning: 0xffd500,
  critical: 0xff3333,
  offline: 0x5b6b8c,
}

/** §13.1 告警分级配色：提示 info / 警告 warn / 紧急 critical */
const ALARM_HEX: Record<AlarmLevel, number> = {
  critical: 0xff3333,
  warn: 0xffd500,
  info: 0x00e5ff,
}
const ALARM_CSS: Record<AlarmLevel, { border: string; color: string; glow: string }> = {
  critical: { border: '#ff3333', color: '#ff8a8a', glow: 'rgba(255,51,51,.7)' },
  warn: { border: '#ffd500', color: '#ffe680', glow: 'rgba(255,213,0,.65)' },
  info: { border: '#00e5ff', color: '#9fe8ff', glow: 'rgba(0,229,255,.6)' },
}
/** §13.1 告警卡配色 */
const LEVEL_BG: Record<AlarmLevel, string> = {
  critical: 'rgba(255,51,51,.12)',
  warn: 'rgba(255,213,0,.1)',
  info: 'rgba(0,229,255,.1)',
}
const LEVEL_FG: Record<AlarmLevel, string> = {
  critical: '#ffb3b3',
  warn: '#ffe680',
  info: '#9fe8ff',
}
/** 实测值是否落在规格书 §6.3 目标区间内 */
function inRange(v: number, lo: number, hi: number): boolean {
  return v >= lo && v <= hi
}

/** 园区全景机位（4 栋 × 12m 的园区） */
const HOME_POS = new THREE.Vector3(0, 52, 58)
const HOME_TARGET = new THREE.Vector3(0, 2, 0)
/** 单栋居中展示的默认机位方向（右前上方 3/4 视角） */
const FOCUS_DIR = new THREE.Vector3(0.62, 0.5, 0.86).normalize()
const FOCUS_DISTANCE = { alarm: 20, normal: 27 }

/* ============================ 运行时对象 ============================ */
let renderer: THREE.WebGLRenderer | null = null
let labelRenderer: CSS2DRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
/** 园区（栋体 / 园区框 / 标签 / 全景告警标注）—— 单栋模式下整体隐藏 */
let parkGroup: THREE.Group | null = null
let parkBody: THREE.InstancedMesh | null = null
let parkCap: THREE.InstancedMesh | null = null
/** 单栋真实内部结构 */
let detailGroup: THREE.Group | null = null
let structure: HouseStructure | null = null
/** 真实建模（GLB）加载结果；为 null 时使用程序化模型 */
let realModel: RealModel | null = null
let realStacker: THREE.Object3D | null = null
let realStackerBaseY = 0
let realStackerBaseX = 0
/** 模型来源状态（用于界面提示） */
const modelStatus = ref<'loading' | 'real' | 'fallback'>('loading')
/** 场景灯光引用（切换真实模型时统一降亮度，避免纯色部件过曝成一片白） */
const sceneLights: THREE.Light[] = []
/** 真实模型部件名关键词（用于告警锚点与标红）——按规格书 §3.2 设备编号映射 */
const REAL_KEYS: Record<DeviceKind, string[]> = {
  th01: ['温湿度', '传感器', 'sensor'],
  heat01: ['加热片', 'heater'],
  fan01: ['换气扇', 'FAD', 'supply'],
  fan02: ['exhuted fan', '排气'],
  mist01: ['air conditioning', '雾化', 'mist'],
}
/** 机械化输送系统部件关键词（规格书 §2.3 N2 另立项，仅用于整机动画绑定） */
const MECH_KEYS: Record<string, string[]> = {
  palletizer: ['堆垛机'],
  conveyor: ['传送带'],
  rack: ['蚕架'],
}
/** 已克隆并着色的真实模型材质（便于恢复原色） */
const tintedParts: {
  mesh: THREE.Mesh
  mat: THREE.MeshStandardMaterial
  baseColor: THREE.Color
  baseEmissive: THREE.Color
}[] = []
let beacon: THREE.Mesh | null = null
let halo: THREE.Mesh | null = null
let deviceRing: THREE.Mesh | null = null
let focusRing: THREE.Mesh | null = null
let detailCallout: CSS2DObject | null = null
let detailCalloutLine: THREE.Line | null = null
let raf = 0
let observer: ResizeObserver | null = null
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []

interface AlarmInstance {
  index: number
  phase: number
  status: AlarmLevel
}
const alarmInstances: AlarmInstance[] = []

let focusLevel: AlarmLevel | null = null

/** 单栋居中：模型从园区原位平滑滑向原点 */
let detailSliding = false
const ORIGIN = new THREE.Vector3(0, 0, 0)

const camGoal = new THREE.Vector3()
const camTarget = new THREE.Vector3()
let flying = false

/**
 * 静止场景：不做任何常驻动画。
 * 只有「相机飞行 / 单栋滑入 / OrbitControls 阻尼收敛」才出帧，其余时间彻底停帧
 * （RAF 不常驻、无 60/30fps 节流、无动态分辨率），把 GPU 完全让给大屏本身。
 */

const tmpMatrix = new THREE.Matrix4()
const tmpQuat = new THREE.Quaternion()
const tmpVec = new THREE.Vector3()
const tmpScale = new THREE.Vector3()
const tmpColor = new THREE.Color()
const tmpColorA = new THREE.Color()
const tmpColorB = new THREE.Color()

/* ============================ 工具 ============================ */
function track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(item: T): T {
  disposables.push(item)
  return item
}

function makeHtmlLabel(html: string): CSS2DObject {
  const div = document.createElement('div')
  div.style.cssText = 'pointer-events:none;display:flex;align-items:center;gap:6px;'
  div.innerHTML = html
  return new CSS2DObject(div)
}

function makeTextLabel(text: string, cssText: string): CSS2DObject {
  const div = document.createElement('div')
  div.textContent = text
  div.style.cssText = cssText
  return new CSS2DObject(div)
}

function lineGeometry(a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Line {
  const geometry = track(new THREE.BufferGeometry().setFromPoints([a, b]))
  const material = track(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }))
  return new THREE.Line(geometry, material)
}

function updateLine(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3): void {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute
  attr.setXYZ(0, a.x, a.y, a.z)
  attr.setXYZ(1, b.x, b.y, b.z)
  attr.needsUpdate = true
  line.geometry.computeBoundingSphere()
}

/** 该栋的异常设备：优先取首个未清除告警指向的设备（规格书 §13.2 告警→设备） */
function badDevice(house: HouseNode) {
  const alarm = house.alarms.find((a) => a.status !== 'cleared')
  if (alarm) {
    const hit = house.devices.find((d) => d.label === alarm.deviceLabel)
    if (hit) return hit
  }
  return house.devices.find((d) => d.state !== 'normal') ?? null
}

/** 单栋居中后的相机焦点：有异常对准异常设备，否则对准房间中心 */
function framingTarget(house: HouseNode): THREE.Vector3 {
  const bad = badDevice(house)
  if (!bad || !structure) return new THREE.Vector3(0, 2.2, 0)
  const node = structure.nodes[bad.kind]
  return node.core.clone().setY(node.core.y + 0.6)
}

/* ============================ 环境 / 园区 ============================ */
function buildEnvironment(): void {
  if (!scene) return

  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(600, 600)),
    track(new THREE.MeshStandardMaterial({ color: 0x060b1c, metalness: 0.4, roughness: 0.9 })),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.6
  scene.add(ground)

  const pad = new THREE.Mesh(
    track(new THREE.BoxGeometry(108, 0.6, 88)),
    track(new THREE.MeshStandardMaterial({ color: 0x0a1430, metalness: 0.65, roughness: 0.5 })),
  )
  pad.position.y = -0.3
  scene.add(pad)

  const grid = new THREE.GridHelper(108, 36, 0x00e5ff, 0x0d3b57)
  const gridMaterial = grid.material as THREE.Material
  gridMaterial.transparent = true
  gridMaterial.opacity = 0.22
  track(gridMaterial)
  grid.position.y = 0.01
  scene.add(grid)

  parkGroup = new THREE.Group()
  scene.add(parkGroup)

  for (const zone of zones) {
    const frameGeo = track(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(zone.width + 7, 0.14, zone.depth + 7)),
    )
    const frameMat = track(
      new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.4 }),
    )
    const frame = new THREE.LineSegments(frameGeo, frameMat)
    frame.position.set(zone.x, 0.16, zone.z)
    parkGroup.add(frame)

    parkGroup.add(createZoneLabel(zone))
  }
}

function createZoneLabel(zone: ZoneNode): CSS2DObject {
  const badge = zone.critical + zone.warning
  const badgeColor = zone.critical ? '#ff3333' : '#ffd500'
  const badgeText = zone.critical ? '#ff8a8a' : '#ffe680'
  const html =
    `<span style="padding:2px 8px;border-left:2px solid #00e5ff;background:rgba(6,16,40,.72);color:#8fe9ff;font-size:12px;letter-spacing:2px;white-space:nowrap;">${zone.name}</span>` +
    (badge
      ? `<span style="padding:1px 6px;border:1px solid ${badgeColor};background:rgba(10,15,36,.82);color:${badgeText};font-size:10px;white-space:nowrap;">⚠ ${badge}</span>`
      : '')
  const label = makeHtmlLabel(html)
  label.position.set(zone.x, 7.6, zone.z)
  return label
}

/** 实例化园区：全部蚕房 = 栋体 + 状态盖板 共 2 个 draw call */
function buildPark(): void {
  if (!scene || !parkGroup) return

  const bodyGeo = track(new THREE.BoxGeometry(HOUSE_W, HOUSE_H, HOUSE_D))
  const capGeo = track(new THREE.BoxGeometry(HOUSE_W * 0.9, 0.26, HOUSE_D * 0.9))
  const bodyMat = track(
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.78, roughness: 0.38 }),
  )
  const capMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }))

  parkBody = new THREE.InstancedMesh(bodyGeo, bodyMat, houses.length)
  parkCap = new THREE.InstancedMesh(capGeo, capMat, houses.length)

  houses.forEach((house, i) => {
    tmpMatrix.makeTranslation(house.x, HOUSE_H / 2, house.z)
    parkBody!.setMatrixAt(i, tmpMatrix)
    tmpMatrix.makeTranslation(house.x, HOUSE_H + 0.14, house.z)
    parkCap!.setMatrixAt(i, tmpMatrix)

    parkBody!.setColorAt(i, tmpColor.setHex(BODY_TINT[house.status]))
    // 告警级别配色；严重栋顶盖略微抬高做静态强调（原先靠逐帧缩放呼吸）
    const capLift = house.alarms.some((a) => a.status !== 'cleared' && a.level === 'critical') ? 0.14 : 0
    if (capLift) {
      tmpMatrix.compose(
        tmpVec.set(house.x, HOUSE_H + 0.14 + capLift, house.z),
        tmpQuat,
        tmpScale.set(1.05, 1, 1.05),
      )
      parkCap!.setMatrixAt(i, tmpMatrix)
    }
    parkCap!.setColorAt(i, tmpColor.setHex(CAP_COLOR[house.status]))

    const parkAlarm = house.alarms.find((a) => a.status !== 'cleared')
    if (parkAlarm) {
      alarmInstances.push({
        index: i,
        phase: Math.random() * Math.PI * 2,
        status: parkAlarm.level,
      })
    }
  })

  parkBody.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  parkCap.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  if (parkBody.instanceColor) parkBody.instanceColor.needsUpdate = true
  if (parkCap.instanceColor) parkCap.instanceColor.needsUpdate = true

  parkGroup.add(parkBody)
  parkGroup.add(parkCap)

  for (const house of houses) {
    const alarm = house.alarms.find((a) => a.status !== 'cleared')
    if (!alarm) continue
    const hex = ALARM_HEX[alarm.level]
    const css = ALARM_CSS[alarm.level]
    const anchor = new THREE.Vector3(house.x, HOUSE_H + 6.2, house.z)
    const line = lineGeometry(new THREE.Vector3(house.x, HOUSE_H + 0.3, house.z), anchor, hex)
    parkGroup.add(line)
    const label = makeTextLabel(
      `⚠ ${house.code} ${alarm.no} ${alarm.name} ${alarm.value}`,
      `padding:5px 10px;border:1px solid ${css.border};background:rgba(10,15,36,.9);color:${css.color};font-size:12px;letter-spacing:1px;white-space:nowrap;box-shadow:0 0 16px ${css.glow};pointer-events:none;`,
    )
    label.position.copy(anchor)
    parkGroup.add(label)
  }
}

/* ============================ 单栋真实结构 ============================ */
function buildDetailHouse(): void {
  if (!scene) return

  const group = new THREE.Group()
  group.visible = false
  scene.add(group)
  detailGroup = group

  // 现场结构模型（蚕架/传送带/码垛机/抓取机/漏斗/空调/出排气）
  structure = buildHouseStructure()
  group.add(structure.group)

  // 蚕房名称标签
  const nameLabel = makeTextLabel(
    '蚕房',
    'padding:3px 10px;border:1px solid rgba(0,229,255,.6);background:rgba(6,16,40,.85);color:#8fe9ff;font-size:13px;letter-spacing:2px;white-space:nowrap;pointer-events:none;',
  )
  nameLabel.position.set(0, HOUSE_H + 2.6, 0)
  nameLabel.name = 'detail-name'
  group.add(nameLabel)

  // 告警光柱
  beacon = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.1, 0.1, BEACON_TOP, 10, 1, true)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0xff3333,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  )
  beacon.position.y = BEACON_TOP / 2
  beacon.visible = false
  group.add(beacon)

  // 异常设备外扩光环
  halo = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.9, 20, 16)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0xff3333,
        transparent: true,
        opacity: 0.35,
        wireframe: true,
        depthWrite: false,
      }),
    ),
  )
  halo.visible = false
  group.add(halo)

  // 异常设备地面光圈
  deviceRing = new THREE.Mesh(
    track(new THREE.TorusGeometry(1.4, 0.08, 8, 48)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0xff3333,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    ),
  )
  deviceRing.rotation.x = Math.PI / 2
  deviceRing.visible = false
  group.add(deviceRing)

  // 告警引线 + 标注框
  const calloutLine = lineGeometry(
    new THREE.Vector3(0, 2.5, 0),
    new THREE.Vector3(0, BEACON_TOP + 0.9, 0),
    0xff3333,
  )
  calloutLine.visible = false
  group.add(calloutLine)
  detailCalloutLine = calloutLine

  const callout = makeTextLabel(
    '',
    'padding:6px 12px;border:1px solid #ff3333;background:rgba(10,15,36,.95);color:#ff8a8a;font-size:13px;letter-spacing:1px;white-space:nowrap;box-shadow:0 0 18px rgba(255,51,51,.65);pointer-events:none;',
  )
  callout.position.set(0, BEACON_TOP + 0.9, 0)
  callout.visible = false
  group.add(callout)
  detailCallout = callout

  // 底座光圈
  const ring = new THREE.Mesh(
    track(new THREE.TorusGeometry(HOUSE_W * 0.62, 0.13, 8, 96)),
    track(new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.8 })),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.set(0, 0.26, 0)
  ring.visible = false
  scene.add(ring)
  focusRing = ring
}

/** 真实模型部件标红／恢复原色（告警联动） */
function applyRealTint(kind: DeviceKind | null, level: AlarmLevel): void {
  if (!realModel) return
  // 先恢复上一次着色
  for (const rec of tintedParts) {
    rec.mat.color.copy(rec.baseColor)
    rec.mat.emissive.copy(rec.baseEmissive)
    rec.mat.emissiveIntensity = 0
  }
  tintedParts.length = 0
  if (!kind) return

  const target = realModel.find(REAL_KEYS[kind])
  if (!target) return
  const hex = ALARM_HEX[level]
  target.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    // SolidWorks 材质是共享的：先克隆再改色，避免整机一起变色
    if (!mesh.userData.tintCloned) {
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        | THREE.MeshStandardMaterial
        | undefined
      if (!src) return
      mesh.material = src.clone()
      mesh.userData.tintCloned = true
    }
    const mat = mesh.material as THREE.MeshStandardMaterial
    tintedParts.push({
      mesh,
      mat,
      baseColor: mat.color.clone(),
      baseEmissive: mat.emissive ? mat.emissive.clone() : new THREE.Color(0x000000),
    })
    mat.color.setHex(hex)
    if (mat.emissive) {
      mat.emissive.setHex(hex)
      mat.emissiveIntensity = level === 'critical' ? 1.1 : 0.85
    }
  })
}

/** 加载真实建模：成功后替换程序化几何，并把告警锚点对齐到真实部件 */
async function attachRealModel(): Promise<void> {
  const model = await loadRealModel()
  if (!model || !detailGroup) {
    modelStatus.value = 'fallback'
    return
  }
  modelStatus.value = 'real'
  realModel = model
  detailGroup.add(model.group)
  // 隐藏程序化几何，只保留告警光柱 / 光环 / 引线标注
  structure?.hideProceduralGeometry()
  // 用真实部件位置覆盖告警锚点（找不到就保留程序化锚点）
  const anchorY: Record<DeviceKind, number> = {
    th01: 2.4,
    heat01: 0.45,
    fan01: 3.5,
    fan02: 3.5,
    mist01: 0.8,
  }
  for (const kind of Object.keys(REAL_KEYS) as DeviceKind[]) {
    const pos = model.anchorOf(REAL_KEYS[kind], detailGroup, anchorY[kind])
    if (pos) structure?.setAnchor(kind, pos)
  }
  // 绑定码垛机升降（机械化输送系统 · §2.3 N2 另立项，仅作展示动画）
  realStacker = model.find(MECH_KEYS.palletizer ?? [])
  if (realStacker) {
    realStackerBaseY = realStacker.position.y
    realStackerBaseX = realStacker.position.x
  }
  // 不做动画演示：真模型即静态底模，不再叠加蚕盘循环 / 投叶 / 夹爪 / 托叉等运动道具

  // ---- 性能：真实模型面数大，渲染分辨率降到 1.0 倍（像素量减半以上）----
  renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1))
  handleResize()

  // ---- 光照瘦身：Lambert 材质下只需半球光 + 平行光，点光源直接关掉（片元开销大） ----
  for (const light of sceneLights) {
    if ((light as THREE.HemisphereLight).isHemisphereLight) {
      light.intensity = 0.8
      light.visible = true
    } else if ((light as THREE.DirectionalLight).isDirectionalLight) {
      light.intensity = 1.0
      light.visible = true
    } else {
      light.visible = false
    }
  }
  if (renderer) renderer.toneMappingExposure = 1.0

  // 静态摆位：码垛机停在 t=0 的位置，不再升降/行走
  if (realStacker && structure) {
    realStacker.position.y = realStackerBaseY + structure.runtime.palletizerLift * 0.8
    realStacker.position.x = realStackerBaseX + structure.runtime.palletizerTravelX
    realStacker.updateMatrix()
  }
  requestRender()

  console.info(
    `[CenterTwin] 已切换为真实模型（静态展示，无动画）：${model.triangles.toLocaleString()} 三角面 / ${model.drawCalls} draw call`,
  )
}

/** 按下钻蚕房的状态着色设备、摆放告警光柱与标注 */
function applyHouseState(house: HouseNode): void {
  const bad = badDevice(house)
  const alarm = house.alarms.find((a) => a.status !== 'cleared')
  focusLevel = alarm?.level ?? null

  // 设备节点着色（告警源高亮，其余压暗）
  const states = Object.fromEntries(house.devices.map((d) => [d.kind, d.state])) as Record<
    DeviceKind,
    DeviceState
  >
  structure?.setNodeStates(states, bad?.kind ?? null, alarm?.level ?? 'warn')
  // 真实模型：把对应部件标红／标黄，其余恢复原色
  applyRealTint(alarm && bad ? bad.kind : null, alarm?.level ?? 'warn')

  const nameLabel = detailGroup?.getObjectByName('detail-name') as CSS2DObject | undefined
  if (nameLabel) nameLabel.element.textContent = house.name

  if (alarm && bad && structure && beacon && halo && deviceRing && detailCallout && detailCalloutLine) {
    const node = structure.nodes[bad.kind]
    const pos = node.core
    const hex = ALARM_HEX[alarm.level]
    const css = ALARM_CSS[alarm.level]

    // 静止场景：光柱/光环/地面圈用固定亮度与尺寸，不做呼吸动画
    const pulse = focusLevel === 'critical' ? 1 : 0.82

    const beaconMat = beacon.material as THREE.MeshBasicMaterial
    beaconMat.color.setHex(hex)
    beaconMat.opacity = 0.34 * pulse
    beacon.position.set(pos.x, BEACON_TOP / 2, pos.z)
    beacon.scale.set(1.4, 1, 1.4)
    beacon.visible = true

    const haloMat = halo.material as THREE.MeshBasicMaterial
    haloMat.color.setHex(hex)
    haloMat.opacity = 0.5 * pulse
    halo.position.copy(pos)
    halo.scale.setScalar(1.08)
    halo.visible = true

    const ringMat = deviceRing.material as THREE.MeshBasicMaterial
    ringMat.color.setHex(hex)
    ringMat.opacity = 0.62 * pulse
    deviceRing.position.set(pos.x, 0.3, pos.z)
    deviceRing.scale.setScalar(1.04)
    deviceRing.visible = true

    // 标注框略向房间中心收，避免超出面板被裁切
    const anchor = new THREE.Vector3(pos.x * 0.4, BEACON_TOP + 0.9, pos.z * 0.4)
    detailCallout.element.textContent = `⚠ ${alarm.no} ${alarm.name} ${alarm.value}｜${alarm.code}`
    detailCallout.element.style.borderColor = css.border
    detailCallout.element.style.color = css.color
    detailCallout.element.style.boxShadow = `0 0 18px ${css.glow}`
    detailCallout.position.copy(anchor)
    detailCallout.visible = true

    const lineMat = detailCalloutLine.material as THREE.LineBasicMaterial
    lineMat.color.setHex(hex)
    updateLine(detailCalloutLine, new THREE.Vector3(pos.x, BEACON_TOP - 0.2, pos.z), anchor)
    detailCalloutLine.visible = true
  } else {
    if (beacon) beacon.visible = false
    if (halo) halo.visible = false
    if (deviceRing) deviceRing.visible = false
    if (detailCallout) detailCallout.visible = false
    if (detailCalloutLine) detailCalloutLine.visible = false
  }

  requestRender()
}

/* ============================ 相机档位 ============================ */
function applyControlProfile(isFocus: boolean): void {
  if (!controls) return
  if (isFocus) {
    controls.minDistance = 5
    controls.maxDistance = 70
    controls.minPolarAngle = 0.06
    controls.maxPolarAngle = 1.62
    controls.enablePan = true
  } else {
    controls.minDistance = 10
    controls.maxDistance = 120
    controls.minPolarAngle = Math.PI / 14
    controls.maxPolarAngle = Math.PI / 2.2
    controls.enablePan = false
  }
}

/* ============================ 进入 / 退出单栋舞台 ============================ */
function focusHouse(house: HouseNode): void {
  if (!detailGroup || !controls) return

  // 整片园区隐藏：屏幕只剩这一栋
  if (parkGroup) parkGroup.visible = false

  detailGroup.position.set(house.x, 0, house.z)
  detailGroup.visible = true
  detailSliding = true
  if (structure) structure.rackGroup.visible = racksVisible.value
  applyHouseState(house)

  if (focusRing) {
    ;(focusRing.material as THREE.MeshBasicMaterial).opacity = 0.6
    focusRing.scale.setScalar(1.02)
    focusRing.visible = true
  }

  focusedId.value = house.id
  selectHouse(house.id)

  applyControlProfile(true)
  controls.autoRotate = false

  const target = framingTarget(house)
  const distance = badDevice(house) ? FOCUS_DISTANCE.alarm : FOCUS_DISTANCE.normal
  camTarget.copy(target)
  camGoal.copy(target).addScaledVector(FOCUS_DIR, distance)
  flying = true
}

function exitFocus(): void {
  if (detailGroup) detailGroup.visible = false
  if (focusRing) focusRing.visible = false
  if (beacon) beacon.visible = false
  if (halo) halo.visible = false
  if (deviceRing) deviceRing.visible = false
  if (detailCallout) detailCallout.visible = false
  if (detailCalloutLine) detailCalloutLine.visible = false
  focusLevel = null
  detailSliding = false

  if (parkGroup) parkGroup.visible = true
  focusedId.value = null
  selectHouse(null)

  applyControlProfile(false)
  if (controls) controls.autoRotate = false

  camGoal.copy(HOME_POS)
  camTarget.copy(HOME_TARGET)
  flying = true
  requestRender()
}

/** 返回 2D 总览（找下一个问题） */
function backToOverview(): void {
  exitFocus()
  viewMode.value = 'matrix'
}

function resetFocusCamera(): void {
  cameraPreset('reset')
}

/** 相机预设：俯视 / 侧视 / 正面 / 复位 */
function cameraPreset(kind: PresetKind): void {
  const house = focused.value
  if (!house || !controls) return
  const p = framingTarget(house)
  if (kind === 'reset') {
    camTarget.copy(p)
    camGoal
      .copy(p)
      .addScaledVector(FOCUS_DIR, badDevice(house) ? FOCUS_DISTANCE.alarm : FOCUS_DISTANCE.normal)
    flying = true
    requestRender()
    return
  }

  const center = new THREE.Vector3(0, 2.0, 0)
  camTarget.copy(center)
  if (kind === 'top') {
    camGoal.set(0.2, 40, 0.2)
  } else if (kind === 'side') {
    camGoal.set(34, 8, 0)
  } else {
    camGoal.set(0, 8, 34)
  }
  flying = true
  requestRender()
}

function setRacksVisible(value: boolean): void {
  racksVisible.value = value
  if (structure) structure.rackGroup.visible = value
  requestRender()
}

/**
 * 3D 子系统配色图例 —— 必须与 src/three/modelLoader.ts 的 BUCKETS 保持一致。
 * 注意：3D 画布 alpha 透明，身后是 CyberBackground 的深蓝底 + 青色辉光，
 * 所以机组用暖色/中性高亮，青色系一律不用（会和背景辉光融在一起）。
 */
const TWIN_LEGEND: { name: string; css: string }[] = [
  { name: '空调', css: '#FFE000' },
  { name: '换气扇', css: '#FFFFFF' },
  { name: '排气扇', css: '#FF4D00' },
  { name: '蚕盘', css: '#FF8A1F' },
  { name: '投叶漏斗', css: '#A8E04F' },
  { name: '传送带', css: '#12C46A' },
  { name: '码垛机', css: '#FF2D7A' },
  { name: '抓取机', css: '#2F6BFF' },
  { name: '蚕架', css: '#4F8FD8' },
]

/* ============================ 拾取 ============================ */
let pointerDownAt = { x: 0, y: 0 }

function handlePointerDown(event: PointerEvent): void {
  pointerDownAt = { x: event.clientX, y: event.clientY }
}

function handlePointerUp(event: PointerEvent): void {
  const dx = event.clientX - pointerDownAt.x
  const dy = event.clientY - pointerDownAt.y
  if (Math.hypot(dx, dy) > 6) return
  if (focusedId.value) return
  if (!parkBody || !camera || !hostEl.value) return

  const rect = hostEl.value.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  const hit = raycaster.intersectObject(parkBody, false)[0]
  if (hit && hit.instanceId !== undefined) {
    const house = houses[hit.instanceId]
    if (house) focusHouse(house)
  }
}

/* ============================ 渲染循环 ============================ */
function handleResize(): void {
  const host = hostEl.value
  if (!host || !renderer || !camera || !labelRenderer) return
  const width = host.clientWidth
  const height = host.clientHeight
  if (width === 0 || height === 0) return
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
  labelRenderer.setSize(width, height)
  requestRender()
}

/** 仅 3D 视图下出帧；2D 总览时彻底停掉。场景静止，因此 RAF 不常驻 */
function startLoop(): void {
  requestRender()
}

/** 请求出一帧（选中变化 / 模型加载完成 / 尺寸变化 / 用户交互时调用） */
function requestRender(): void {
  if (viewMode.value !== 'twin') return
  // raf 非 0 表示已有一帧在排队，无需重复排队
  if (raf) return
  raf = requestAnimationFrame(animate)
}

/** 单次绘制（含 CSS2D 标签层，标签只在出帧时重算） */
function drawScene(): void {
  const host = hostEl.value
  if (!host || host.clientWidth <= 0 || !renderer || !scene || !camera) return
  renderer.render(scene, camera)
  labelRenderer?.render(scene, camera)
}

/**
 * 按需渲染帧 —— 场景是静止的，不做任何动画演示。
 * 只有三种「过渡」需要连续出帧：
 *   1. 相机机位飞行（切换机位 / 复位 / 进入单栋）
 *   2. 单栋从园区原位滑到屏幕中央
 *   3. OrbitControls 阻尼收敛（用户拖动后的惯性）
 * 三者都停下后不再排下一帧，RAF 归零，GPU 占用回到 0。
 */
function animate(): void {
  // 先清零：本帧内任何 requestRender 都能重新排队，不会丢请求
  raf = 0
  if (viewMode.value !== 'twin' || !renderer || !scene || !camera) return

  let busy = false

  // 单栋居中：模型从园区原位滑向原点
  if (detailSliding && detailGroup) {
    detailGroup.position.lerp(ORIGIN, 0.12)
    if (detailGroup.position.lengthSq() < 0.02) {
      detailGroup.position.copy(ORIGIN)
      detailSliding = false
    }
    busy = true
  }

  // 相机飞行
  if (flying && controls) {
    camera.position.lerp(camGoal, 0.08)
    controls.target.lerp(camTarget, 0.1)
    if (camera.position.distanceTo(camGoal) < 0.4) flying = false
    busy = true
  }

  // OrbitControls 阻尼：位置还在变就继续出帧，收敛后自然停
  if (controls) {
    const px = camera.position.x
    const py = camera.position.y
    const pz = camera.position.z
    const tx = controls.target.x
    const ty = controls.target.y
    const tz = controls.target.z
    controls.update()
    if (
      Math.abs(camera.position.x - px) > 1e-5 ||
      Math.abs(camera.position.y - py) > 1e-5 ||
      Math.abs(camera.position.z - pz) > 1e-5 ||
      Math.abs(controls.target.x - tx) > 1e-5 ||
      Math.abs(controls.target.y - ty) > 1e-5 ||
      Math.abs(controls.target.z - tz) > 1e-5
    ) {
      busy = true
    }
  }

  drawScene()

  if (busy) raf = requestAnimationFrame(animate)
}

function init(): void {
  const host = hostEl.value
  if (!host) return
  const width = host.clientWidth || 1040
  const height = host.clientHeight || 660

  scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x0a0f24, 110, 380)

  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 800)
  camera.position.copy(HOME_POS)

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  // 电影级色调映射：避免纯色部件糊成一片白
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.setSize(width, height)
  renderer.domElement.style.display = 'block'
  host.appendChild(renderer.domElement)

  labelRenderer = new CSS2DRenderer()
  labelRenderer.setSize(width, height)
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.top = '0'
  labelRenderer.domElement.style.left = '0'
  labelRenderer.domElement.style.pointerEvents = 'none'
  host.appendChild(labelRenderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.target.copy(HOME_TARGET)
  applyControlProfile(false)
  controls.autoRotate = false

  const hemi = new THREE.HemisphereLight(0x7fd8ff, 0x0a0f24, 0.8)
  scene.add(hemi)
  sceneLights.push(hemi)
  const key = new THREE.DirectionalLight(0xffffff, 1.15)
  key.position.set(40, 70, 45)
  sceneLights.push(key)
  scene.add(key)
  const rim = new THREE.PointLight(0x00e5ff, 900, 260)
  rim.position.set(-70, 55, -55)
  sceneLights.push(rim)
  scene.add(rim)
  const fill = new THREE.PointLight(0x7c4dff, 700, 240)
  fill.position.set(70, 45, 60)
  sceneLights.push(fill)
  scene.add(fill)
  // 单栋展台上方补光（照清房间内部）
  const roomLight = new THREE.PointLight(0xffffff, 1000, 100)
  roomLight.position.set(0, 11, 4)
  sceneLights.push(roomLight)
  scene.add(roomLight)

  buildEnvironment()
  buildPark()
  buildDetailHouse()
  // 不做动画演示：只按 t=0 定一次静态姿态，之后不再推进时序
  structure?.update(0, 0.016)
  if (realStacker && structure) {
    realStacker.position.y = realStackerBaseY + structure.runtime.palletizerLift * 0.8
    realStacker.position.x = realStackerBaseX + structure.runtime.palletizerTravelX
    realStacker.updateMatrix()
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown)
  renderer.domElement.addEventListener('pointerup', handlePointerUp)
  renderer.domElement.addEventListener('pointermove', requestRender)
  renderer.domElement.addEventListener('wheel', requestRender, { passive: true })

  observer = new ResizeObserver(handleResize)
  observer.observe(host)

  startLoop()
}

/* ============================ 交互 ============================ */
async function onMatrixSelect(house: HouseNode): Promise<void> {
  viewMode.value = 'twin'
  await nextTick()
  handleResize()
  focusHouse(house)
}

watch(viewMode, async (mode) => {
  if (mode === 'twin') {
    await nextTick()
    handleResize()
    startLoop()
  }
})

/** 切到「园区三维」时：有聚焦栋保持单栋居中，否则显示园区全景 */
function onTabChange(key: ViewMode): void {
  if (key === 'twin' && focusedId.value) {
    viewMode.value = 'twin'
    resetFocusCamera()
    return
  }
  viewMode.value = key
}

onMounted(async () => {
  await nextTick()
  init()
  // 后台加载真实建模（GLB）；加载失败或文件缺失时自动回退程序化模型
  void attachRealModel()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
  observer = null
  renderer?.domElement.removeEventListener('pointerdown', handlePointerDown)
  renderer?.domElement.removeEventListener('pointerup', handlePointerUp)
  renderer?.domElement.removeEventListener('pointermove', requestRender)
  renderer?.domElement.removeEventListener('wheel', requestRender)
  controls?.dispose()
  controls = null
  structure?.dispose()
  structure = null
  for (const item of disposables) item.dispose()
  disposables.length = 0
  alarmInstances.length = 0
  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement)
  }
  if (labelRenderer?.domElement.parentElement) {
    labelRenderer.domElement.parentElement.removeChild(labelRenderer.domElement)
  }
  renderer?.dispose()
  renderer = null
  labelRenderer = null
  scene = null
  camera = null
  parkBody = null
  parkCap = null
  parkGroup = null
  detailGroup = null
  beacon = null
  halo = null
  deviceRing = null
  focusRing = null
  detailCallout = null
  detailCalloutLine = null
})
</script>

<template>
  <div class="tech-panel relative h-full min-h-0 w-full overflow-hidden rounded-[4px]">
    <span class="corner corner-tl"></span>
    <span class="corner corner-tr"></span>
    <span class="corner corner-bl"></span>
    <span class="corner corner-br"></span>

    <!-- ============ 2D 蚕房总览（首屏） ============ -->
    <div v-show="viewMode === 'matrix'" class="absolute inset-0 p-3">
      <HouseMatrix @select="onMatrixSelect" />
    </div>

    <!-- ============ 3D 视图（单栋居中 / 园区全景） ============ -->
    <div
      ref="hostEl"
      v-show="viewMode === 'twin'"
      class="absolute inset-0"
      :class="{ 'twin-enter': viewMode === 'twin' }"
    ></div>

    <!-- 顶部：标题 / 面包屑 / 视图切换 -->
    <div class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4">
      <div>
        <h3 class="panel-title">
          {{ viewMode === 'matrix' ? '蚕房状态总览' : focused ? '蚕房内部结构' : '园区三维' }}
        </h3>
        <div class="pointer-events-auto mt-1 flex items-center gap-2 text-[11px]">
          <template v-if="viewMode === 'twin' && focused">
            <button class="crumb" @click="backToOverview">全部园区</button>
            <span class="text-text-dim">›</span>
            <span class="text-cyber-blue">{{ focused.zoneName }}</span>
            <span class="text-text-dim">›</span>
            <span class="text-cyber-blue">{{ focused.name }}</span>
            <span class="ml-1 text-text-dim">· 已居中单独展示</span>
            <span
              class="ml-2 border px-[6px] py-[1px] text-[10px]"
              :style="{
                color:
                  modelStatus === 'real'
                    ? '#00FFAA'
                    : modelStatus === 'loading'
                      ? '#FFD500'
                      : '#7F93B8',
                borderColor:
                  modelStatus === 'real'
                    ? 'rgba(0,255,170,.6)'
                    : modelStatus === 'loading'
                      ? 'rgba(255,213,0,.6)'
                      : 'rgba(127,147,184,.5)',
              }"
            >
              {{
                modelStatus === 'real'
                  ? '真实建模 · 已接入'
                  : modelStatus === 'loading'
                    ? '真实建模加载中…'
                    : '程序化模型（未找到 GLB）'
              }}
            </span>
          </template>
          <span v-else class="digital text-text-dim">
            · {{ houses.length }} 栋 · {{ zones.length }} 个厂区 · 点击任意蚕房进入 3D
          </span>
        </div>
      </div>

      <div class="pointer-events-auto flex items-center gap-2">
        <div class="flex border border-cyber-blue/35 bg-ink-900/70 p-[2px]">
          <button
            v-for="tab in viewTabs"
            :key="tab.key"
            class="flex items-baseline gap-1 px-3 py-[4px] text-[12px] tracking-wider transition-colors"
            :class="
              viewMode === tab.key
                ? 'bg-cyber-blue/90 text-ink-900'
                : 'text-cyber-blue hover:bg-cyber-blue/15'
            "
            @click="onTabChange(tab.key)"
          >
            {{ tab.label }}
            <span class="digital text-[9px] opacity-70">{{ tab.sub }}</span>
          </button>
        </div>
        <button v-if="viewMode === 'twin' && focused" class="back-btn" @click="backToOverview">
          返回总览
        </button>
      </div>
    </div>

    <!-- 全景：核心指标数字块 -->
    <div v-if="viewMode === 'twin' && !focused" class="pointer-events-none absolute inset-0 z-10">
      <div
        v-for="(metric, index) in coreMetrics"
        :key="metric.key"
        class="tech-panel absolute w-[176px] rounded-[3px] px-3 py-2"
        :class="[
          index === 0 ? 'left-4 top-[96px]' : '',
          index === 1 ? 'right-4 top-[96px]' : '',
          index === 2 ? 'bottom-[56px] left-4' : '',
          index === 3 ? 'bottom-[56px] right-4' : '',
        ]"
      >
        <span class="corner corner-tl !h-2 !w-2"></span>
        <span class="corner corner-br !h-2 !w-2"></span>
        <div class="text-[11px] tracking-wider text-text-sub">{{ metric.label }}</div>
        <div class="mt-1">
          <DigitalNumber :value="metric.value" :unit="metric.unit" :size="26" :color="metric.color" />
        </div>
      </div>
    </div>

    <!-- ============ 单栋 3D：蚕房详情卡 ============ -->
    <div
      v-if="viewMode === 'twin' && focused"
      class="tech-panel absolute right-4 top-[92px] z-10 w-[268px] rounded-[3px] p-3"
    >
      <span class="corner corner-tl !h-2 !w-2"></span>
      <span class="corner corner-br !h-2 !w-2"></span>

      <div class="flex items-center justify-between">
        <span class="text-[14px] font-semibold text-cyber-blue">{{ focused.name }}</span>
        <span
          class="px-[8px] py-[1px] text-[11px]"
          :style="{
            color: houseStatusMeta[focused.status].color,
            border: `1px solid ${houseStatusMeta[focused.status].color}`,
            background: houseStatusMeta[focused.status].fill,
          }"
        >
          {{ houseStatusMeta[focused.status].label }}
        </span>
      </div>
      <div class="panel-rule my-2"></div>

      <div
        v-if="focused.alarms.length"
        class="mb-2 border p-2 text-[11px]"
        :style="{
          borderColor: alarmLevelMeta(focused.alarms[0]!.level).color,
          background: LEVEL_BG[focused.alarms[0]!.level],
          color: LEVEL_FG[focused.alarms[0]!.level],
        }"
      >
        <div class="font-semibold">
          ⚠ {{ focused.alarms[0]!.no }} {{ focused.alarms[0]!.name }}：{{ focused.alarms[0]!.value }}
        </div>
        <div class="mt-1 text-[10px] opacity-80">
          事件码 {{ focused.alarms[0]!.code }} · 设备 {{ focused.alarms[0]!.deviceLabel }}（3D 已用光柱标出）
        </div>
      </div>

      <!-- §12.1 P01：实时温湿度 + §6.3 目标区间 -->
      <div class="grid grid-cols-2 gap-1 text-center">
        <div>
          <div class="text-[10px] text-text-sub">
            温度 · 目标 {{ focused.target.tMin }}~{{ focused.target.tMax }}℃
          </div>
          <div
            class="digital text-[18px] font-bold glow"
            :style="{ color: inRange(focused.temp, focused.target.tMin, focused.target.tMax) ? '#00FFAA' : '#FF3333' }"
          >
            {{ focused.temp }}℃
          </div>
        </div>
        <div>
          <div class="text-[10px] text-text-sub">
            湿度 · 目标 {{ focused.target.hMin }}~{{ focused.target.hMax }}%
          </div>
          <div
            class="digital text-[18px] font-bold glow"
            :style="{ color: inRange(focused.hum, focused.target.hMin, focused.target.hMax) ? '#00FFAA' : '#FF3333' }"
          >
            {{ focused.hum }}%RH
          </div>
        </div>
      </div>

      <!-- §6.1/§6.2 龄期品种 · §7.2 控制模式 · §1.5 越限 -->
      <div class="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
        <div class="border border-cyber-blue/20 py-[3px]">
          <div class="text-[9px] text-text-dim">龄期品种</div>
          <div class="text-cyber-cyan/90">{{ focused.instarName }}·{{ focused.varietyName }}</div>
        </div>
        <div class="border border-cyber-blue/20 py-[3px]">
          <div class="text-[9px] text-text-dim">控制模式</div>
          <div :style="{ color: controlModeMeta(focused.mode).color }">
            {{ controlModeMeta(focused.mode).state }}
          </div>
        </div>
        <div class="border border-cyber-blue/20 py-[3px]">
          <div class="text-[9px] text-text-dim">越限 / 容许</div>
          <div :style="{ color: overrunLevelMeta[focused.overrun.worst].color }">
            {{ focused.overrun.minutesToday }} / {{ focused.target.toleranceMin }} min
          </div>
        </div>
      </div>

      <div class="mt-1 flex items-center justify-between text-[10.5px] text-text-sub">
        <span class="font-mono">{{ focused.barn }}/{{ focused.zone }}</span>
        <span :style="{ color: focused.rssi < -70 ? '#FFD500' : '#00FFAA' }">
          WiFi {{ focused.rssi }} dBm
        </span>
        <span class="text-text-dim">更新 {{ focused.updatedAt }}</span>
      </div>

      <div class="mt-2 text-[11px] text-text-sub">
        执行器（§3.2）
        <span v-if="!focused.sensorOk" class="text-cyber-red">· sensor_ok=false</span>
      </div>
      <div class="mt-1 grid grid-cols-5 gap-1">
        <div
          v-for="device in focused.devices"
          :key="device.id"
          class="flex flex-col items-center gap-1 border py-[4px]"
          :style="{
            borderColor:
              device.state === 'normal'
                ? 'rgba(0,229,255,.15)'
                : houseStatusMeta[device.state].color,
            background:
              device.state === 'normal' ? 'rgba(0,229,255,.05)' : houseStatusMeta[device.state].fill,
          }"
          :title="`${device.label} · ${device.model}`"
        >
          <span
            class="status-dot"
            :style="{
              color:
                device.state === 'normal'
                  ? '#00FFAA'
                  : device.state === 'offline'
                    ? '#5B6B8C'
                    : houseStatusMeta[device.state].color,
            }"
          ></span>
          <span class="text-[9px] leading-none text-text-dim">{{ device.label.slice(0, 3) }}</span>
          <span
            class="text-[9px] leading-none font-semibold"
            :style="{ color: device.on ? '#00FFAA' : '#5B6B8C' }"
          >
            {{ device.on ? 'ON' : 'OFF' }}
          </span>
        </div>
      </div>

      <div class="mt-2 text-[9px] leading-tight text-text-dim/70">
        蚕架 / 传送带 / 码垛机 / 抓取机 = 机械化输送系统，规格书 §2.3 N2 另立项
      </div>
    </div>

    <!-- 单栋模式工具条 -->
    <div
      v-if="viewMode === 'twin' && focused"
      class="absolute inset-x-0 bottom-3 z-10 flex justify-center"
    >
      <div
        class="pointer-events-auto flex items-center gap-2 rounded-[3px] border border-cyber-blue/30 bg-ink-900/80 px-3 py-[6px]"
      >
        <button class="tool-btn" @click="setRacksVisible(!racksVisible)">
          {{ racksVisible ? '隐藏蚕架' : '显示蚕架' }}
        </button>
        <span class="h-[14px] w-[1px] bg-cyber-blue/25"></span>
        <button class="tool-btn" @click="cameraPreset('top')">俯视</button>
        <button class="tool-btn" @click="cameraPreset('side')">侧视</button>
        <button class="tool-btn" @click="cameraPreset('front')">正面</button>
        <button class="tool-btn" @click="cameraPreset('reset')">复位</button>

        <span class="h-[14px] w-[1px] bg-cyber-blue/25"></span>
        <span class="flex items-center gap-[9px] text-[10px] text-text-sub">
          <span v-for="item in TWIN_LEGEND" :key="item.name" class="flex items-center gap-[4px]">
            <span
              class="h-[8px] w-[8px] rounded-[1px]"
              :style="{ background: item.css, boxShadow: `0 0 6px ${item.css}` }"
            ></span>
            {{ item.name }}
          </span>
        </span>
      </div>
    </div>

    <!-- 单栋模式操作提示 -->
    <div
      v-if="viewMode === 'twin' && focused"
      class="pointer-events-none absolute inset-x-0 bottom-[52px] z-10 flex justify-center"
    >
      <span class="digital text-[10px] tracking-[2px] text-text-dim">
        左键拖拽环绕 · 右键拖拽平移 · 滚轮缩放 · 可贴近看蚕架与传送带
      </span>
    </div>

    <!-- 园区全景提示 -->
    <div
      v-if="viewMode === 'twin' && !focused"
      class="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center"
    >
      <span class="digital text-[10px] tracking-[2px] text-text-dim">
        单击蚕房 → 居中单独展示 · 拖拽旋转 · 滚轮缩放
      </span>
    </div>
  </div>
</template>

<style scoped>
.crumb {
  color: var(--color-text-sub);
  transition: color 0.2s;
}

.crumb:hover {
  color: var(--color-cyber-blue);
  text-shadow: 0 0 8px rgba(0, 229, 255, 0.8);
}

.back-btn {
  padding: 3px 12px;
  border: 1px solid rgba(0, 229, 255, 0.5);
  background: rgba(0, 229, 255, 0.12);
  color: #8fe9ff;
  font-size: 12px;
  letter-spacing: 1px;
  transition: background 0.2s;
}

.back-btn:hover {
  background: rgba(0, 229, 255, 0.28);
}

.tool-btn {
  padding: 2px 10px;
  border: 1px solid rgba(0, 229, 255, 0.35);
  background: rgba(0, 229, 255, 0.08);
  color: #9fe8ff;
  font-size: 12px;
  letter-spacing: 1px;
  transition:
    background 0.2s,
    border-color 0.2s;
}

.tool-btn:hover {
  background: rgba(0, 229, 255, 0.24);
  border-color: rgba(0, 229, 255, 0.7);
}

.tool-btn-on {
  background: rgba(0, 255, 170, 0.22);
  border-color: rgba(0, 255, 170, 0.8);
  color: #b6ffe0;
}

.twin-enter {
  animation: twin-in 0.42s ease;
}

@keyframes twin-in {
  from {
    opacity: 0;
    transform: scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
