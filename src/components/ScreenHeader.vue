<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FpsMeter from '@/components/FpsMeter.vue'
import { overview } from '@/mock/bigscreen'
import { deviceSummary, houses, overrunSummary } from '@/mock/houses'

/**
 * 顶部导航区
 * 中央发光标题 · 左侧双 Tab 核心功能切换 · 右侧时间/天气/系统状态
 * 系统状态按规格书口径展示：§7.2 控制模式 / §7.5 安全锁定 / §8.5.2 设备在线率 / §13.1 未清除告警
 */
export type ScreenMode = 'overview' | 'camera'

defineProps<{ mode: ScreenMode }>()
const emit = defineEmits<{ change: [mode: ScreenMode] }>()

const tabs: { key: ScreenMode; label: string; en: string }[] = [
  { key: 'overview', label: '数据总览大屏', en: 'DATA OVERVIEW' },
  { key: 'camera', label: '蚕房实景监控', en: 'LIVE CAMERA' },
]

/** §7.5 处于安全锁定的蚕房数 */
const lockCount = computed(() => overrunSummary.safeLockHouses)
/** §13.1 未清除告警总数 */
const activeAlarms = computed(() =>
  houses.reduce((n, h) => n + h.alarms.filter((a) => a.status !== 'cleared').length, 0),
)
/** §7.2 离线自治的蚕房数 */
const offlineHouses = computed(() => houses.filter((h) => h.mode === 'offline').length)

const time = ref('--:--:--')
const date = ref('')
const pad = (n: number) => String(n).padStart(2, '0')
let timer: number | undefined

function tick(): void {
  const d = new Date()
  time.value = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]
  date.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${week}`
}

onMounted(() => {
  tick()
  timer = window.setInterval(tick, 1000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <header class="relative h-[92px] w-full shrink-0">
    <!-- 标题光晕 -->
    <div
      class="pointer-events-none absolute left-1/2 top-0 h-[92px] w-[900px] -translate-x-1/2"
      style="background: radial-gradient(ellipse at 50% 30%, rgba(0, 229, 255, 0.28), transparent 68%)"
    ></div>

    <!-- ============ 左侧：核心功能 Tab ============ -->
    <div class="absolute left-4 top-1/2 flex -translate-y-1/2 items-center gap-3">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="group relative h-[42px] w-[190px] transition-all duration-300"
        style="clip-path: polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%)"
        :class="
          mode === tab.key
            ? 'bg-gradient-to-r from-cyber-blue/90 to-cyber-cyan/80 text-ink-900'
            : 'bg-cyber-blue/8 text-cyber-blue hover:bg-cyber-blue/20'
        "
        @click="emit('change', tab.key)"
      >
        <span class="flex flex-col items-center justify-center leading-none">
          <span class="text-[15px] font-semibold tracking-[2px]">{{ tab.label }}</span>
          <span class="digital mt-[3px] text-[9px] opacity-70">{{ tab.en }}</span>
        </span>
        <span
          v-if="mode === tab.key"
          class="absolute inset-0"
          style="box-shadow: 0 0 22px rgba(0, 229, 255, 0.75) inset"
        ></span>
      </button>
    </div>

    <!-- ============ 中央：发光标题 ============ -->
    <div class="absolute left-1/2 top-[18px] -translate-x-1/2">
      <div class="flex items-center gap-5">
        <span class="h-[1px] w-[150px] bg-gradient-to-l from-cyber-blue to-transparent"></span>
        <h1
          class="whitespace-nowrap text-[34px] font-black tracking-[10px] text-glow-blue"
          style="
            background: linear-gradient(180deg, #ffffff 8%, #b8f4ff 45%, #00e5ff 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
          "
        >
          {{ overview.title }}
        </h1>
        <span class="h-[1px] w-[150px] bg-gradient-to-r from-cyber-blue to-transparent"></span>
      </div>
      <div class="mt-[3px] text-center text-[10px] tracking-[3px] text-text-sub">
        {{ overview.subtitle }}
      </div>
    </div>

    <!-- ============ 右侧：时间 / 天气 / 运行状态 ============ -->
    <div class="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-5">
      <FpsMeter />
      <span class="h-[34px] w-[1px] bg-cyber-blue/25"></span>
      <div class="text-right">
        <div class="digital text-[26px] font-bold text-cyber-blue glow">{{ time }}</div>
        <div class="mt-[2px] text-[11px] tracking-wider text-text-sub">{{ date }}</div>
      </div>

      <span class="h-[34px] w-[1px] bg-cyber-blue/25"></span>

      <div class="text-right">
        <div class="text-[13px] text-text-main">
          {{ overview.weather.text }} {{ overview.weather.temp }}
        </div>
        <div class="mt-[2px] text-[11px] text-text-sub">湿度 {{ overview.weather.humidity }}</div>
      </div>

      <span class="h-[34px] w-[1px] bg-cyber-blue/25"></span>

      <div class="flex items-center gap-2">
        <span
          class="status-dot"
          :class="{ 'animate-pulse': lockCount > 0 }"
          :style="{ color: lockCount > 0 ? '#FF3333' : '#00FFAA' }"
        ></span>
        <div>
          <div class="text-[13px]" :style="{ color: lockCount > 0 ? '#FF8A8A' : '#00FFAA' }">
            {{ lockCount > 0 ? `${lockCount} 栋安全锁定 SAFE_LOCK` : '全园区自动调控中 AUTO' }}
          </div>
          <div class="digital mt-[2px] text-[11px] text-text-sub">
            在线 {{ deviceSummary.online }}/{{ deviceSummary.total }} · 未清除告警 {{ activeAlarms }}
            <span v-if="offlineHouses" class="text-cyber-yellow"> · 离线自治 {{ offlineHouses }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部装饰分隔线 -->
    <div class="absolute bottom-0 left-0 w-full">
      <div class="relative h-[2px] w-full bg-gradient-to-r from-transparent via-cyber-blue/70 to-transparent">
        <span
          class="absolute left-1/2 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-cyber-blue"
          style="box-shadow: 0 0 12px rgba(0, 229, 255, 0.95)"
        ></span>
      </div>
    </div>
  </header>
</template>
