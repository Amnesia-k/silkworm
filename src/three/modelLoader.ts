/**
 * 真实建模（GLB）加载 / 归一化 / 上色 / 合并优化
 *
 * 针对现场导出的 `总装配体彩彩.glb`（SOLIDWORKS）：
 *  1. 文件里 2 个场景是同一套装配体重复导出 → 只取第一个场景（省一半面数）
 *  2. 使用 KHR_draco_mesh_compression → 挂 DRACOLoader（解码器在 public/draco）
 *  3. 模型是 Z-up → 绕 X 轴 −90° 立起
 *  4. 归一化：居中到原点、落地 y=0、按长边缩放到 16m
 *  5. **按子系统合并几何体**：492 个网格 / 782 个图元 → 约 11 个 draw call（流畅度关键）
 *  6. **按子系统上色**：SOLIDWORKS 原材质多为米白，在暗色大屏上分不清结构，
 *     这里改用青蓝科技风配色（蚕架灰蓝 / 蚕盘橙 / 传送带绿 / 码垛机粉 / 抓取机蓝 / 空调橙 / 换气青）
 *  7. 合并后仍保留：受监控设备的告警锚点、码垛机整机节点（用于升降绑定）、按子系统标红
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DeviceKind } from '@/mock/houses'

export const MODEL_URL = '/models/canfang.glb'
const DRACO_DECODER_PATH = '/draco/'
/** 归一化后的长边尺寸（与园区/相机档位一致） */
const TARGET_LENGTH = 16

interface BucketDef {
  name: string
  /** 科技风配色 */
  color: number
  emissive?: number
  /** 部件名关键词（中文优先，兼容英文） */
  keys: string[]
  exclude?: string[]
  /** 该子系统对应的受监控设备（用于告警锚点/标红） */
  kind?: DeviceKind
  /** 锚点高度系数（0=底部 1=顶部） */
  anchorFactor?: number
  /** 透明度（房体外壳用，便于看到装在墙上的空调/排气等设备） */
  opacity?: number
}

const BUCKETS: BucketDef[] = [
  { name: 'rack', color: 0x4f8fd8, keys: ['蚕架'], anchorFactor: 0.78 },
  { name: 'tray', color: 0xff8a1f, emissive: 0.08, keys: ['蚕盘'] },
  { name: 'palletizer', color: 0xff2d7a, emissive: 0.12, keys: ['堆垛机', '装配体part11', '托盘底板'], exclude: ['轨道', '地轨'], anchorFactor: 0.55 },
  { name: 'conveyor', color: 0x12c46a, emissive: 0.14, keys: ['传送带'], anchorFactor: 0.6 },
  { name: 'hopper', color: 0xa8e04f, emissive: 0.22, keys: ['下料搅拌机'] },
  { name: 'grabber', color: 0x2f6bff, emissive: 0.14, keys: ['机械爪子', '15A001', '15A002Part', '15A003'] },
  /*
   * 规格书 §3.2：真实装配体中「air conditioning」作雾化/加湿侧锚点，换气扇=风扇1，排气扇=风扇2。
   *
   * 配色约束（重要）：3D 画布是 alpha 透明的，身后就是 CyberBackground 的
   * **深蓝底 + 青色辉光 + 青色/紫色粒子**。所以机组一律用「暖色 / 中性高亮」，
   * 绝不用青色系（0x00d5ff / 0x00ffe0 这类会和背景辉光融成一片，实测看不清）。
   * 三台机组之间也两两拉开色相：空调=亮黄、换气=纯白、排气=橙红。
   */
  { name: 'air', color: 0xffe000, emissive: 1.0, keys: ['air conditioning'], kind: 'mist01', anchorFactor: 0.5 },
  { name: 'exhaust', color: 0xff4d00, emissive: 0.6, keys: ['exhuted fan'], kind: 'fan02', anchorFactor: 0.5 },
  { name: 'supply', color: 0xffffff, emissive: 0.85, keys: ['换气扇', 'FAD'], kind: 'fan01', anchorFactor: 0.5 },
  // 房体外壳降低不透明度，避免墙上的空调 / 排换气机组被"蒙灰"
  { name: 'room', color: 0x37496b, keys: ['房'], opacity: 0.18 },
  { name: 'static', color: 0x8892a6, keys: [] },
]

export interface RealModel {
  group: THREE.Group
  triangles: number
  drawCalls: number
  /** 各真实部件的包围盒（供动态道具定位：传送带 / 漏斗 / 夹爪 / 码垛机） */
  partBoxes: { name: string; box: THREE.Box3 }[]
  /** 各受监控设备的告警锚点（group 局部坐标） */
  anchors: Partial<Record<DeviceKind, THREE.Vector3>>
  /** 码垛机合并网格（用于整机升降绑定） */
  palletizerMesh: THREE.Mesh | null
  /** 告警着色：整个子系统标红/黄/青；传 null 恢复主题配色 */
  tintKind(kind: DeviceKind | null, level: 'info' | 'warn' | 'critical'): void
  /** 兼容接口：按关键词返回对应子系统合并网格（合并后无原节点层级） */
  find(keywords: string[], exclude?: string[]): THREE.Object3D | null
  /** 兼容接口：按关键词取告警锚点（parent 局部坐标） */
  anchorOf(keywords: string[], parent: THREE.Object3D, fallbackY?: number): THREE.Vector3 | null
  dispose(): void
}

function countTriangles(root: THREE.Object3D): number {
  let tris = 0
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const geo = mesh.geometry as THREE.BufferGeometry
    const index = geo.getIndex()
    const pos = geo.getAttribute('position')
    tris += index ? index.count / 3 : pos ? pos.count / 3 : 0
  })
  return Math.round(tris)
}

/** 取对象名 + 祖先名组成的"名链"：SolidWorks 导出时子网格名常是父装配体名，
 *  只按自身名匹配会大量漏配（落进兜底桶 → 全是白的），因此必须连祖先一起匹配 */
function chainOf(o: THREE.Object3D): string {
  let s = o.name ?? ''
  let p = o.parent
  let depth = 0
  while (p && depth < 8) {
    s += '|' + (p.name ?? '')
    p = p.parent
    depth++
  }
  return s
}

function bucketOf(name: string): BucketDef {
  for (const b of BUCKETS) {
    if (b.keys.length === 0) continue
    if (b.exclude?.some((k) => name.includes(k))) continue
    if (b.keys.some((k) => name.includes(k))) return b
  }
  return BUCKETS[BUCKETS.length - 1]!
}

export async function loadRealModel(): Promise<RealModel | null> {
  const draco = new DRACOLoader()
  draco.setDecoderPath(DRACO_DECODER_PATH)
  const loader = new GLTFLoader()
  loader.setDRACOLoader(draco)

  let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>
  try {
    gltf = await loader.loadAsync(MODEL_URL)
  } catch (error) {
    console.warn('[modelLoader] 真实模型加载失败，回退程序化模型：', error)
    draco.dispose()
    return null
  }

  /* ① 只取第一个场景，剔除自带灯光 */
  const source = gltf.scenes[0] ?? gltf.scene
  const lights: THREE.Object3D[] = []
  source.traverse((o) => {
    if ((o as THREE.Light).isLight) lights.push(o)
  })
  for (const l of lights) l.parent?.remove(l)

  /* ② Z-up → Y-up */
  source.updateMatrixWorld(true)
  const rawBox = new THREE.Box3().setFromObject(source)
  const rawSize = rawBox.getSize(new THREE.Vector3())
  const wasZup = rawSize.z < rawSize.y * 0.75
  if (wasZup) source.rotation.x = -Math.PI / 2

  /* ③ 归一化：缩放到长边 16m + 居中 + 落地 */
  source.updateMatrixWorld(true)
  let box = new THREE.Box3().setFromObject(source)
  let size = box.getSize(new THREE.Vector3())
  source.scale.setScalar(TARGET_LENGTH / Math.max(size.x, size.z))
  source.updateMatrixWorld(true)
  box = new THREE.Box3().setFromObject(source)
  const center = box.getCenter(new THREE.Vector3())
  source.position.x -= center.x
  source.position.z -= center.z
  source.position.y -= box.min.y
  source.updateMatrixWorld(true)

  /* ④ 按子系统分桶并烘焙世界变换（合并的关键） */
  const partBoxes: { name: string; box: THREE.Box3 }[] = []
  const buckets = new Map<string, { def: BucketDef; geos: THREE.BufferGeometry[]; box: THREE.Box3 }>()
  for (const def of BUCKETS) buckets.set(def.name, { def, geos: [], box: new THREE.Box3() })

  source.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const bucket = buckets.get(bucketOf(chainOf(mesh)).name)
    if (!bucket) return
    const geo = mesh.geometry.clone()
    // 只保留 position + normal：属性集合一致才能合并（纯色材质不需要 uv）
    for (const attr of Object.keys(geo.attributes)) {
      if (attr !== 'position' && attr !== 'normal') geo.deleteAttribute(attr)
    }
    if (!geo.getAttribute('normal')) geo.computeVertexNormals()
    geo.applyMatrix4(mesh.matrixWorld) // 烘焙变换 → 合并后无需层级
    bucket.geos.push(geo)
    geo.computeBoundingBox()
    if (geo.boundingBox) {
      bucket.box.union(geo.boundingBox)
      partBoxes.push({ name: mesh.name ?? '', box: geo.boundingBox.clone() })
    }
  })

  /* ⑤ 每桶合并为 1 个网格 + 1 个主题材质（draw call 由 782 → 约 11） */
  const group = new THREE.Group()
  group.name = 'realHouse'
  const bucketMats = new Map<string, THREE.MeshLambertMaterial>()
  const bucketMeshes = new Map<string, THREE.Mesh>()
  const anchors: Partial<Record<DeviceKind, THREE.Vector3>> = {}
  let drawCalls = 0

  for (const [name, bucket] of buckets) {
    if (bucket.geos.length === 0) continue
    const merged = mergeGeometries(bucket.geos, false)
    for (const g of bucket.geos) g.dispose()
    if (!merged) continue

    // 用轻量 Lambert（无 PBR/环境贴图/高光计算）：240 万面下片元开销远低于 Standard
    const mat = new THREE.MeshLambertMaterial({
      color: bucket.def.color,
      emissive: bucket.def.emissive ? bucket.def.color : 0x000000,
      emissiveIntensity: bucket.def.emissive ?? 0,
      transparent: bucket.def.opacity !== undefined,
      opacity: bucket.def.opacity ?? 1,
      depthWrite: bucket.def.opacity === undefined,
    })
    bucketMats.set(name, mat)

    const mesh = new THREE.Mesh(merged, mat)
    mesh.name = 'bucket_' + name
    // 码垛机需要整机升降，必须保留矩阵自动更新；其余静态冻结以省 CPU
    mesh.matrixAutoUpdate = name === 'palletizer'
    group.add(mesh)
    bucketMeshes.set(name, mesh)
    drawCalls++

    if (bucket.def.kind) {
      const c = bucket.box.getCenter(new THREE.Vector3())
      const h = bucket.box.max.y - bucket.box.min.y
      c.y = bucket.box.min.y + h * (bucket.def.anchorFactor ?? 0.5)
      anchors[bucket.def.kind] = c
    }
  }

  const triangles = countTriangles(group)

  // 释放原始模型资源
  source.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) m?.dispose()
  })
  gltf.scene.clear()

  console.info(
    `[modelLoader] 真实模型就绪：${triangles.toLocaleString()} 三角面，` +
      `${drawCalls} 个 draw call（原始 782 图元）` +
      (wasZup ? '，已从 Z-up 转 Y-up' : ''),
  )

  const kindBucket: Partial<Record<DeviceKind, string>> = {}
  for (const def of BUCKETS) if (def.kind) kindBucket[def.kind] = def.name

  return {
    group,
    triangles,
    drawCalls,
    partBoxes,
    anchors,
    palletizerMesh: (bucketMeshes.get('palletizer') as THREE.Mesh | undefined) ?? null,
    find(keywords, exclude = []) {
      for (const def of BUCKETS) {
        if (exclude.some((k) => def.keys.includes(k))) continue
        if (keywords.some((k) => def.keys.includes(k))) {
          const mesh = bucketMeshes.get(def.name)
          if (mesh) return mesh
        }
      }
      return null
    },
    anchorOf(keywords, parent) {
      for (const def of BUCKETS) {
        if (!def.kind) continue
        if (keywords.some((k) => def.keys.includes(k))) {
          const pos = anchors[def.kind]
          if (!pos) return null
          parent.updateMatrixWorld(true)
          return parent.worldToLocal(pos.clone())
        }
      }
      return null
    },
    tintKind(kind, level) {
      const bucketName = kind ? kindBucket[kind] : undefined
      const mat = bucketName ? bucketMats.get(bucketName) : undefined
      // 先把所有受监控子系统恢复主题色
      for (const [name, m] of bucketMats) {
        const def = BUCKETS.find((b) => b.name === name)
        if (!def?.kind) continue
        m.color.setHex(def.color)
        m.emissive.setHex(def.emissive ? def.color : 0x000000)
        m.emissiveIntensity = def.emissive ?? 0
      }
      if (!mat || !level) return
      const hex = level === 'critical' ? 0xff3333 : level === 'warn' ? 0xffd500 : 0x00e5ff
      mat.color.setHex(hex)
      mat.emissive.setHex(hex)
      mat.emissiveIntensity = level === 'critical' ? 0.9 : 0.65
    },
    dispose() {
      for (const [name, mesh] of bucketMeshes) {
        mesh.geometry.dispose()
        bucketMats.get(name)?.dispose()
      }
      bucketMeshes.clear()
      bucketMats.clear()
      draco.dispose()
    },
  }
}
