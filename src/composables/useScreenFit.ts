import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 大屏等比缩放适配
 * 设计基准 1920x1080，按视口等比缩放（4K 下 scale=2），保证任何分辨率下版式一致
 */
export function useScreenFit(designWidth = 1920, designHeight = 1080) {
  const scale = ref(1)

  const canvasStyle = computed(() => ({
    width: `${designWidth}px`,
    height: `${designHeight}px`,
    transform: `scale(${scale.value})`,
  }))

  function update(): void {
    scale.value = Math.min(window.innerWidth / designWidth, window.innerHeight / designHeight)
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', update)
  })

  return { scale, canvasStyle }
}
