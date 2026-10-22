<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 大屏背景层：科技网格 + 静态粒子 + 中心辉光 + 暗角
 *
 * 不做动画演示：本层**只绘制一次**即静止，仅窗口尺寸变化时重绘。
 * （原先 40 颗粒子以 30fps 全屏重绘；4K 下这是常驻的显存带宽开销，
 *   而现在 3D 场景也已改为按需出帧，整屏静止后 GPU/CPU 占用归零。）
 *
 * 粒子仍用预烘焙的径向渐变精灵（drawImage），避免逐粒子 shadowBlur。
 */
interface Particle {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  alpha: number
  sprite: HTMLCanvasElement
}

const canvasRef = ref<HTMLCanvasElement | null>(null)

const PARTICLE_COUNT = 40
const SPRITE_COLORS: [number, number, number][] = [
  [0, 229, 255],
  [0, 255, 170],
  [124, 77, 255],
]

let particles: Particle[] = []
const sprites: HTMLCanvasElement[] = []

function buildSprite(rgb: [number, number, number]): HTMLCanvasElement {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const [r, g, b] = rgb
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.95)`)
    gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.32)`)
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  return canvas
}

function init(count: number): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const w = (canvas.width = window.innerWidth)
  const h = (canvas.height = window.innerHeight)
  particles = Array.from({ length: count }, (_, i) => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: Math.random() * 2.4 + 0.8,
    vx: (Math.random() - 0.5) * 0.16,
    vy: -(Math.random() * 0.3 + 0.06),
    alpha: Math.random() * 0.5 + 0.2,
    sprite: sprites[i % sprites.length] ?? sprites[0]!,
  }))
}

/** 一次性绘制：粒子静止不动，所以画完这一帧就够了 */
function draw(): void {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const p of particles) {
    const size = p.r * 9
    ctx.globalAlpha = p.alpha
    ctx.drawImage(p.sprite, p.x - size / 2, p.y - size / 2, size, size)
  }
  ctx.globalAlpha = 1
}

function handleResize(): void {
  init(PARTICLE_COUNT)
  draw()
}

onMounted(() => {
  for (const color of SPRITE_COLORS) sprites.push(buildSprite(color))
  init(PARTICLE_COUNT)
  draw()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 overflow-hidden bg-ink-800">
    <!-- 科技网格 -->
    <div class="cyber-grid absolute inset-0 opacity-70"></div>
    <!-- 中心辉光 -->
    <div
      class="absolute inset-0"
      style="
        background:
          radial-gradient(ellipse 60% 50% at 50% 42%, rgba(0, 229, 255, 0.16), transparent 65%),
          radial-gradient(ellipse 40% 40% at 12% 88%, rgba(124, 77, 255, 0.14), transparent 70%),
          radial-gradient(ellipse 40% 40% at 88% 88%, rgba(0, 255, 170, 0.1), transparent 70%);
      "
    ></div>
    <!-- 粒子层 -->
    <canvas ref="canvasRef" class="absolute inset-0 h-full w-full"></canvas>
    <!-- 暗角 -->
    <div
      class="absolute inset-0"
      style="
        background: linear-gradient(
          180deg,
          rgba(5, 10, 26, 0.72) 0%,
          transparent 22%,
          transparent 74%,
          rgba(5, 10, 26, 0.85) 100%
        );
      "
    ></div>
  </div>
</template>
