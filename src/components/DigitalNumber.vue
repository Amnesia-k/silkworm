<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

/**
 * 数码管风格发光数字（带数字滚动动画）
 */
const props = withDefaults(
  defineProps<{
    value: number | string
    unit?: string
    color?: string
    size?: number
    duration?: number
  }>(),
  {
    unit: '',
    color: '#00E5FF',
    size: 44,
    duration: 1100,
  },
)

const shown = ref<string>('0')

function format(v: number): string {
  return v.toLocaleString('en-US')
}

function run(): void {
  if (typeof props.value !== 'number') {
    shown.value = String(props.value)
    return
  }
  const target = props.value
  const start = performance.now()
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / props.duration)
    const eased = 1 - Math.pow(1 - p, 3)
    shown.value = format(Math.round(target * eased))
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

onMounted(run)
watch(() => props.value, run)
</script>

<template>
  <div class="digital glow flex items-baseline" :style="{ color, fontSize: `${size}px` }">
    <span>{{ shown }}</span>
    <span v-if="unit" class="ml-1 font-sans" :style="{ fontSize: `${Math.round(size * 0.34)}px` }">
      {{ unit }}
    </span>
  </div>
</template>
