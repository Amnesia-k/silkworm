<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 帧率计（性能自检）
 * 独立测量浏览器实际帧率，每秒刷新；颜色分级：≥50 绿 / ≥30 黄 / <30 红
 */
const fps = ref(0)
let raf = 0
let frames = 0
let lastAt = performance.now()

const color = computed(() =>
  fps.value >= 50 ? '#00FFAA' : fps.value >= 30 ? '#FFD500' : '#FF3333',
)

function loop(): void {
  raf = requestAnimationFrame(loop)
  frames += 1
  const now = performance.now()
  if (now - lastAt >= 1000) {
    fps.value = Math.round((frames * 1000) / (now - lastAt))
    frames = 0
    lastAt = now
  }
}

onMounted(() => {
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="text-right leading-none">
    <div
      class="digital text-[13px] font-bold"
      :style="{ color, textShadow: `0 0 8px ${color}` }"
    >
      {{ fps }}<span class="ml-[2px] text-[9px] opacity-75">FPS</span>
    </div>
    <div class="mt-[3px] text-[10px] text-text-sub">渲染帧率</div>
  </div>
</template>
