import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

/**
 * ECharts 实例管理：自动初始化、容器尺寸自适应、销毁清理
 * 返回的 el 绑定到容器 div，setOption 用于推送新数据（实现实时刷新）
 */
export function useECharts() {
  const el = ref<HTMLDivElement | null>(null)
  let chart: ReturnType<typeof echarts.init> | null = null
  let observer: ResizeObserver | null = null

  function setOption(option: EChartsOption): void {
    if (!el.value) return
    if (!chart) chart = echarts.init(el.value)
    // 性能优先：数据静态，关闭悬停动画，入场动画只跑一次
    chart.setOption({ hoverAnimation: false, animationDuration: 600, ...option })
  }

  function resize(): void {
    chart?.resize()
  }

  onMounted(() => {
    if (el.value) {
      observer = new ResizeObserver(() => chart?.resize())
      observer.observe(el.value)
    }
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    chart?.dispose()
    chart = null
  })

  return { el: el as Ref<HTMLDivElement | null>, setOption, resize }
}
