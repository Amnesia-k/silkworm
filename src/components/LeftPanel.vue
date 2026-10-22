<script setup lang="ts">
import { onMounted } from 'vue'
import DigitalNumber from '@/components/DigitalNumber.vue'
import PanelBox from '@/components/PanelBox.vue'
import { useECharts } from '@/composables/useECharts'
import { leftData } from '@/mock/bigscreen'
import { buildAlertBars, buildOnlineGauge, buildOverrunTrend } from '@/utils/charts'

/**
 * 左侧数据面板（口径全部来自规格书）
 * 1. 在线设备总数（§3.1 设备层级 / §8.5.2 status）—— 超大数字 + 在线率环形进度
 * 2. 越限时长趋势（§1.5 越限判定 / §15.5 验收红线 ≤30 min/日）
 * 3. 告警级别统计（§13.1 info / warn / critical）
 */
const { el: gaugeEl, setOption: setGauge } = useECharts()
const { el: overrunEl, setOption: setOverrun } = useECharts()
const { el: alertEl, setOption: setAlert } = useECharts()

onMounted(() => {
  setGauge(buildOnlineGauge(leftData.onlineRate))
  setOverrun(buildOverrunTrend(leftData.overrunTrend))
  setAlert(buildAlertBars(leftData.alertTypes))
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- ============ 在线设备总数 ============ -->
    <PanelBox title="在线设备总数" sub="§3.1 设备台账 · ONLINE DEVICES" class="shrink-0">
      <div class="flex items-center justify-between">
        <div class="min-w-0">
          <DigitalNumber :value="leftData.onlineDevices" :size="46" color="#00E5FF" />
          <div class="mt-2 flex items-center gap-2 text-[11px] text-text-sub">
            <span class="status-dot text-cyber-cyan"></span>
            设备总台数 {{ leftData.deviceTotal.toLocaleString('en-US') }} 台
            <span class="text-cyber-red">离线 {{ leftData.offlineDevices }} 台</span>
          </div>
        </div>

        <!-- 在线率环形进度 -->
        <div class="relative h-[118px] w-[118px] shrink-0">
          <div ref="gaugeEl" class="h-full w-full"></div>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="digital text-[24px] font-bold text-cyber-cyan glow">
              {{ leftData.onlineRate }}%
            </span>
            <span class="mt-[2px] text-[10px] tracking-wider text-text-sub">在线率</span>
          </div>
        </div>
      </div>
    </PanelBox>

    <!-- ============ 越限时长趋势 ============ -->
    <PanelBox title="越限时长趋势" sub="§15.5 重度越限 ≤30 min/日" class="shrink-0">
      <div class="grid grid-cols-3 gap-2">
        <div class="capsule flex-col !items-center !justify-center gap-1 py-[7px]">
          <span class="text-[11px] text-text-sub">今日累计</span>
          <span
            class="digital text-[19px] font-bold glow"
            :style="{ color: leftData.overrunOverTarget > 0 ? '#FF3333' : '#00FFAA' }"
          >
            {{ leftData.overrunToday }}
          </span>
        </div>
        <div class="capsule flex-col !items-center !justify-center gap-1 py-[7px]">
          <span class="text-[11px] text-text-sub">单栋最高</span>
          <span class="digital text-[19px] font-bold text-cyber-red glow">
            {{ leftData.overrunMax }}
          </span>
        </div>
        <div class="capsule flex-col !items-center !justify-center gap-1 py-[7px]">
          <span class="text-[11px] text-text-sub">超标栋数</span>
          <span class="digital text-[19px] font-bold text-cyber-orange glow">
            {{ leftData.overrunOverTarget }}
          </span>
        </div>
      </div>

      <div ref="overrunEl" class="mt-2 h-[104px] w-full"></div>
    </PanelBox>

    <!-- ============ 告警级别统计 ============ -->
    <PanelBox title="告警级别统计" :sub="leftData.alertRange" class="min-h-0 flex-1">
      <div ref="alertEl" class="min-h-[128px] w-full flex-1"></div>
      <!-- §10.2 alarm.status：待确认 / 已确认 / 已清除 -->
      <div class="mt-1 flex shrink-0 items-center justify-around text-[11px] text-text-sub">
        <span
          v-for="st in leftData.alarmStatus"
          :key="st.status"
          class="flex items-center gap-1"
        >
          <span class="text-text-dim">
            {{ st.status === 'active' ? '待确认' : st.status === 'confirmed' ? '已确认' : '已清除' }}
          </span>
          <span class="digital text-cyber-cyan">{{ st.value }}</span>
        </span>
      </div>
    </PanelBox>
  </div>
</template>
