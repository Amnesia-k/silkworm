<script setup lang="ts">
import { onMounted } from 'vue'
import DigitalNumber from '@/components/DigitalNumber.vue'
import PanelBox from '@/components/PanelBox.vue'
import { useECharts } from '@/composables/useECharts'
import { rightData } from '@/mock/bigscreen'
import { MECH_NOTE } from '@/mock/houses'
import { buildRuntimeArea } from '@/utils/charts'

/**
 * 右侧数据面板（口径全部来自规格书）
 * 1. 蚕盘总数 —— 机械化输送系统，§2.3 N2 另立项，仅作展示
 * 2. 执行器运行情况（§4.1 加热片 / 风扇 1 / 风扇 2 / 雾化片）
 * 3. 控制参数（§7.3）+ 执行器运行时长
 * 4. 安全联锁（§7.5 S1～S6，最高优先级 L1）
 */
const { el: runtimeEl, setOption: setRuntime } = useECharts()

const runtimeTrend = {
  categories: ['00', '03', '06', '09', '12', '15', '18', '21', '24'],
  heater: [0.4, 0.9, 1.6, 0.7, 0.2, 0.2, 0.5, 1.1, 0.6],
  fan: [0.2, 0.3, 0.8, 1.4, 2.1, 1.9, 1.2, 0.6, 0.3],
}

onMounted(() => {
  setRuntime(buildRuntimeArea(runtimeTrend))
})

const primaryParams = rightData.params.filter((p) => rightData.paramHighlight.includes(p.key))

const priorityColor: Record<string, string> = {
  最高: '#FF3333',
  高: '#FFD500',
  中: '#00E5FF',
}

/** 安全联锁：悬浮显示完整动作与恢复方式，面板上只留编号 + 触发条件 */
function interlockTip(it: (typeof rightData.interlocks)[number]): string {
  return `${it.id} ${it.trigger}\n阈值：${it.threshold}\n动作：${it.action}\n恢复：${it.recover}`
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <!-- ============ 蚕盘总数（机械化 · 另立项） ============ -->
    <PanelBox title="蚕盘总数" sub="§2.3 N2 另立项" class="shrink-0">
      <div class="flex items-baseline gap-3">
        <DigitalNumber :value="rightData.trayTotal" unit="盘" :size="32" color="#00FFAA" />
        <span class="text-[11px] text-text-sub">
          {{ rightData.trayHouseCount }} 房 · 均 {{ rightData.trayAverage }} 盘
        </span>
        <span class="ml-auto truncate text-[10px] text-text-dim/80" :title="MECH_NOTE">
          机械化输送系统
        </span>
      </div>
    </PanelBox>

    <!-- ============ 执行器运行情况 ============ -->
    <PanelBox title="执行器运行情况" sub="§4.1 BOM" class="shrink-0">
      <ul class="flex flex-col gap-[6px]">
        <li v-for="item in rightData.running" :key="item.name">
          <div class="mb-[3px] flex items-center justify-between text-[12px]">
            <span class="flex items-center gap-2 text-text-main">
              <span class="status-dot" :style="{ color: item.color }"></span>
              {{ item.name }}
            </span>
            <span class="digital font-bold" :style="{ color: item.color }">{{ item.value }}%</span>
          </div>
          <div class="h-[4px] w-full overflow-hidden rounded-full bg-cyber-blue/10">
            <div
              class="h-full rounded-full transition-[width] duration-700"
              :style="{
                width: `${item.value}%`,
                background: `linear-gradient(90deg, ${item.color}55, ${item.color})`,
                boxShadow: `0 0 10px ${item.color}`,
              }"
            ></div>
          </div>
        </li>
      </ul>
    </PanelBox>

    <!-- ============ 控制参数 + 运行时长 ============ -->
    <PanelBox title="控制参数" sub="§7.3" class="min-h-0 flex-1">
      <div class="grid shrink-0 grid-cols-2 gap-2">
        <div
          v-for="item in primaryParams"
          :key="item.key"
          class="capsule flex-col !items-start !justify-center gap-[1px] py-[4px]"
          :title="`${item.label} ${item.symbol} · 可调范围 ${item.range} · 生效位置 ${item.place}`"
        >
          <span class="text-[10px] text-text-sub">{{ item.label }}</span>
          <span class="digital text-[14px] font-bold text-cyber-cyan">{{ item.value }}</span>
        </div>
      </div>

      <div ref="runtimeEl" class="mt-2 min-h-[88px] w-full flex-1"></div>
    </PanelBox>

    <!-- ============ 安全联锁 ============ -->
    <PanelBox title="安全联锁" sub="§7.5 L1" class="shrink-0">
      <ul class="grid grid-cols-2 gap-x-3 gap-y-[4px]">
        <li
          v-for="it in rightData.interlocks"
          :key="it.id"
          class="flex items-center gap-2 border-l-2 py-[1px] pl-2 text-[11px]"
          :style="{ borderColor: priorityColor[it.priority] ?? '#00E5FF' }"
          :title="interlockTip(it)"
        >
          <span class="digital font-bold" :style="{ color: priorityColor[it.priority] ?? '#00E5FF' }">
            {{ it.id }}
          </span>
          <span class="truncate text-text-sub">{{ it.trigger }}</span>
        </li>
      </ul>
      <div class="mt-1 flex items-center justify-between text-[10px] text-text-dim">
        <span>S3 硬编码危险温度 {{ rightData.tempSafetyMax }} ℃</span>
        <span :style="{ color: rightData.safeLockHouses ? '#FF3333' : '#00FFAA' }">
          锁定 {{ rightData.safeLockHouses }} 栋
        </span>
      </div>
    </PanelBox>
  </div>
</template>
