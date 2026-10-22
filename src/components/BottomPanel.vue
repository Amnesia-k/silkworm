<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import PanelBox from '@/components/PanelBox.vue'
import { useECharts } from '@/composables/useECharts'
import { useSelectedHouse } from '@/composables/useSelectedHouse'
import { logs } from '@/mock/bigscreen'
import { houseStatusMeta, houses } from '@/mock/houses'
import { controlModeMeta } from '@/mock/spec'
import { buildEnvCombo, buildHouseTempOverview } from '@/utils/charts'

/**
 * 底部数据面板
 * 左：蚕房温湿度趋势 —— 默认展示 4 个蚕房各自的温度曲线（不做平均），叠加目标区间带；
 *     点击某个蚕房（卡片 / 下方胶囊）即切换为该栋「温度 + 湿度 + §6.3 目标区间带」详情曲线，
 *     越限点标红（§1.5 轻度/重度越限），与中间 3D 舞台、上方 2D 总览共用同一份选中状态。
 * 右：最新告警 / 操作日志（自动向上滚动，critical 红色高亮，内容带 AL 编号与 E 事件码）
 */
const { el: envEl, setOption: setEnv } = useECharts()
const { selectedHouse, selectHouse } = useSelectedHouse()

/** 双份数据用于无缝滚动（translateY -50% 循环） */
const scrollLogs = [...logs, ...logs]

const times = houses[0]?.trend.times ?? []
const subTitle = computed(() =>
  selectedHouse.value
    ? `${selectedHouse.value.name} · ${selectedHouse.value.instarName}${selectedHouse.value.varietyName} · 温度 / 湿度 + 目标区间`
    : '4 个蚕房独立曲线（园区温度包络） · 点击查看单栋详情',
)

/** 园区温度包络（各栋目标区间上下限的并集） */
const parkBand = computed(() => {
  const tMin = Math.min(...houses.map((h) => h.target.tMin))
  const tMax = Math.max(...houses.map((h) => h.target.tMax))
  return { tMin, tMax, label: `园区目标包络 ${tMin}~${tMax}℃` }
})

function render(): void {
  const house = selectedHouse.value
  if (house) {
    setEnv(
      buildEnvCombo({
        categories: house.trend.times,
        temp: house.trend.temp,
        hum: house.trend.hum,
        target: house.target,
        overrun: house.trend.overrun,
      }),
    )
    return
  }
  setEnv(
    buildHouseTempOverview(
      times,
      houses.map((h) => ({ name: h.name, color: h.chartColor, data: h.trend.temp })),
      parkBand.value,
    ),
  )
}

onMounted(render)
watch(selectedHouse, render)
</script>

<template>
  <div class="grid h-full min-h-0 grid-cols-[1.35fr_1fr] gap-3">
    <!-- ============ 温湿度趋势 ============ -->
    <PanelBox title="蚕房温湿度趋势统计" :sub="subTitle">
      <!-- 蚕房快捷切换 -->
      <div class="mb-1 flex shrink-0 items-center gap-2">
        <button
          class="house-chip"
          :class="{ 'house-chip-on': !selectedHouse }"
          @click="selectHouse(null)"
        >
          全部蚕房
        </button>
        <button
          v-for="house in houses"
          :key="house.id"
          class="house-chip"
          :class="{ 'house-chip-on': selectedHouse?.id === house.id }"
          :title="`${house.name} · ${house.instarName}${house.varietyName} · ${controlModeMeta(house.mode).label}（${controlModeMeta(house.mode).state}）· 目标 ${house.target.tMin}~${house.target.tMax}℃ / ${house.target.hMin}~${house.target.hMax}%RH`"
          @click="selectHouse(house.id)"
        >
          <span class="status-dot" :style="{ color: houseStatusMeta[house.status].color }"></span>
          {{ house.name }}
          <span class="digital" :style="{ color: house.chartColor }">
            {{ house.temp }}℃ / {{ house.hum }}%
          </span>
        </button>
      </div>

      <div ref="envEl" class="min-h-[150px] w-full flex-1"></div>
    </PanelBox>

    <!-- ============ 告警 / 操作日志 ============ -->
    <PanelBox title="最新告警 · 操作日志" sub="REAL-TIME LOGS">
      <div class="log-head">
        <span>时间</span>
        <span>来源</span>
        <span>内容</span>
      </div>
      <div class="panel-rule mb-1"></div>

      <div class="relative min-h-0 flex-1 overflow-hidden">
        <div class="auto-scroll">
          <div
            v-for="(item, index) in scrollLogs"
            :key="`${item.id}-${index}`"
            class="log-row"
            :class="`level-${item.level}`"
          >
            <span class="digital text-[11px] opacity-80">{{ item.time }}</span>
            <span class="truncate">{{ item.source }}</span>
            <span class="truncate">{{ item.content }}</span>
          </div>
        </div>
        <!-- 上下渐隐遮罩 -->
        <div
          class="pointer-events-none absolute inset-x-0 top-0 h-6"
          style="background: linear-gradient(180deg, #0a0f24, transparent)"
        ></div>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 h-6"
          style="background: linear-gradient(0deg, #0a0f24, transparent)"
        ></div>
      </div>
    </PanelBox>
  </div>
</template>

<style scoped>
/* 日志表头与数据行保持同一栅格：时间 / 来源 / 内容 */
.log-head {
  display: grid;
  grid-template-columns: 66px 104px 1fr;
  gap: 10px;
  padding: 0 10px 4px;
  font-size: 11px;
  color: var(--color-text-dim);
}

.log-row {
  grid-template-columns: 66px 104px 1fr;
  padding: 5px 10px;
}

/* 蚕房快捷切换胶囊 */
.house-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border: 1px solid rgba(0, 229, 255, 0.28);
  background: rgba(0, 229, 255, 0.06);
  color: #9fe8ff;
  font-size: 12px;
  letter-spacing: 1px;
  transition:
    background 0.2s,
    border-color 0.2s;
}

.house-chip:hover {
  background: rgba(0, 229, 255, 0.18);
  border-color: rgba(0, 229, 255, 0.6);
}

.house-chip-on {
  background: rgba(0, 229, 255, 0.22);
  border-color: rgba(0, 229, 255, 0.9);
  color: #eaf6ff;
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.35);
}
</style>
