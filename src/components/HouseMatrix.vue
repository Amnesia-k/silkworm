<script setup lang="ts">
import { useSelectedHouse } from '@/composables/useSelectedHouse'
import {
  deviceStateMeta,
  houseStatusMeta,
  houses,
  parkSummary,
  type HouseNode,
} from '@/mock/houses'
import { alarmLevelMeta, controlModeMeta, overrunLevelMeta } from '@/mock/spec'

/**
 * 2D 蚕房总览（4 个厂区各 1 栋蚕房 = barn01～barn04 / zone01～zone04）
 *
 * 每张卡片按规格书口径展示：
 *   §6.1/§6.2 当前龄期与品种   §6.3 温湿度目标区间   §1.5 越限状态与时长
 *   §7.2 控制模式（auto/offline/manual/safe_lock/maint）   §13.2 告警编号
 * 点击卡片 → 该栋进入中间 3D 单独展示，底部趋势图同步切到这一栋。
 */
const emit = defineEmits<{ select: [house: HouseNode] }>()
const { selectedHouseId, selectHouse } = useSelectedHouse()

const summaryItems = [
  { key: 'total', label: '蚕房总数', value: parkSummary.total, color: '#00E5FF' },
  { key: 'normal', label: '运行正常', value: parkSummary.normal, color: '#00FFAA' },
  { key: 'warning', label: '预警', value: parkSummary.warning, color: '#FFD500' },
  { key: 'critical', label: '严重', value: parkSummary.critical, color: '#FF3333' },
  { key: 'offline', label: '离线', value: parkSummary.offline, color: '#5B6B8C' },
]

function onPick(house: HouseNode): void {
  selectHouse(house.id)
  emit('select', house)
}

function onlineCount(house: HouseNode): number {
  return house.devices.filter((d) => d.state !== 'offline').length
}

/** 实测值是否落在 §6.3 目标区间内 */
function inRange(v: number, lo: number, hi: number): boolean {
  return v >= lo && v <= hi
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- ============ 汇总条 ============ -->
    <div class="grid shrink-0 grid-cols-5 gap-2">
      <div
        v-for="item in summaryItems"
        :key="item.key"
        class="tech-panel flex items-center justify-between rounded-[3px] px-3 py-[7px]"
      >
        <span class="text-[11px] text-text-sub">{{ item.label }}</span>
        <span class="digital text-[20px] font-bold glow" :style="{ color: item.color }">
          {{ item.value }}
        </span>
      </div>
    </div>

    <!-- ============ 四个厂区 / 四个蚕房 ============ -->
    <div class="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3">
      <button
        v-for="house in houses"
        :key="house.id"
        class="tech-panel relative flex min-h-0 flex-col rounded-[4px] p-3 text-left transition-transform hover:-translate-y-[2px]"
        :class="[`st-${house.status}`, { selected: house.id === selectedHouseId }]"
        @click="onPick(house)"
      >
        <span class="corner corner-tl"></span>
        <span class="corner corner-tr"></span>
        <span class="corner corner-bl"></span>
        <span class="corner corner-br"></span>

        <!-- 卡片头：厂区 + barn/zone + 状态 -->
        <div class="flex shrink-0 items-center gap-2">
          <span class="panel-title !text-[13px]">{{ house.zoneName }}</span>
          <span
            class="px-[8px] py-[1px] text-[11px]"
            :style="{
              color: houseStatusMeta[house.status].color,
              border: `1px solid ${houseStatusMeta[house.status].color}`,
              background: houseStatusMeta[house.status].fill,
            }"
          >
            {{ houseStatusMeta[house.status].label }}
          </span>
          <span
            v-if="house.alarms.length"
            class="ml-auto flex items-center gap-1 text-[11px]"
            :style="{ color: alarmLevelMeta(house.alarms[0]!.level).color }"
          >
            <span class="animate-pulse">⚠</span>{{ house.alarms[0]!.no }}
          </span>
        </div>

        <div class="mt-[6px] flex shrink-0 items-baseline gap-2">
          <span class="text-[16px] font-semibold text-cyber-blue">{{ house.name }}</span>
          <span class="digital text-[11px] text-text-dim">{{ house.barn }}/{{ house.zone }}</span>
          <span
            class="ml-auto px-[6px] py-[1px] text-[10px]"
            :style="{
              color: controlModeMeta(house.mode).color,
              border: `1px solid ${controlModeMeta(house.mode).color}`,
            }"
          >
            {{ controlModeMeta(house.mode).state }}
          </span>
        </div>
        <div class="panel-rule my-2 shrink-0"></div>

        <!-- §12.1 实时温湿度 + §6.3 目标区间 -->
        <div class="grid shrink-0 grid-cols-2 gap-1 text-center">
          <div>
            <div class="text-[10px] text-text-sub">温度 · 目标 {{ house.target.tMin }}~{{ house.target.tMax }}℃</div>
            <div
              class="digital text-[20px] font-bold glow"
              :style="{
                color: inRange(house.temp, house.target.tMin, house.target.tMax) ? '#00FFAA' : '#FF3333',
              }"
            >
              {{ house.temp }}<span class="text-[11px]">℃</span>
            </div>
          </div>
          <div>
            <div class="text-[10px] text-text-sub">
              湿度 · 目标 {{ house.target.hMin }}~{{ house.target.hMax }}%
            </div>
            <div
              class="digital text-[20px] font-bold glow"
              :style="{
                color: inRange(house.hum, house.target.hMin, house.target.hMax) ? '#00FFAA' : '#FF3333',
              }"
            >
              {{ house.hum }}<span class="text-[11px]">%RH</span>
            </div>
          </div>
        </div>

        <!-- §6.1/§6.2 龄期品种 + §1.5 越限 -->
        <div class="mt-2 flex shrink-0 items-center justify-between text-[11px] text-text-sub">
          <span class="text-cyber-cyan/80">
            {{ house.instarName }} · {{ house.varietyName }}
          </span>
          <span :style="{ color: overrunLevelMeta[house.overrun.worst].color }">
            {{ overrunLevelMeta[house.overrun.worst].label }} {{ house.overrun.minutesToday }} min
          </span>
        </div>

        <!-- 执行器状态点（§3.2 设备台账） -->
        <div class="mt-2 flex shrink-0 items-center gap-2">
          <span class="text-[11px] text-text-sub">执行器</span>
          <span class="flex items-center gap-[6px]">
            <span
              v-for="device in house.devices"
              :key="device.id"
              class="status-dot"
              :style="{ color: deviceStateMeta[device.state].color }"
              :title="`${device.label} · ${deviceStateMeta[device.state].label} · ${device.on ? 'ON' : 'OFF'}`"
            ></span>
          </span>
          <span class="digital ml-auto text-[11px] text-text-sub">
            {{ onlineCount(house) }}/{{ house.devices.length }} 在线
          </span>
        </div>

        <!-- 告警摘要（§13.2 告警编号 + §8.6 事件码） -->
        <div
          v-if="house.alarms.length"
          class="mt-2 shrink-0 border-l-2 py-[5px] pl-2 text-[11.5px]"
          :style="{
            borderColor: alarmLevelMeta(house.alarms[0]!.level).color,
            background: `linear-gradient(90deg, ${houseStatusMeta[house.status].fill}, transparent 85%)`,
            color: houseStatusMeta[house.status].color,
          }"
        >
          {{ house.alarms[0]!.no }} {{ house.alarms[0]!.name }} {{ house.alarms[0]!.value }}
          <span class="text-text-dim">
            · {{ house.alarms[0]!.deviceLabel }} · {{ house.alarms[0]!.code }}
          </span>
        </div>
        <div v-else class="mt-2 shrink-0 text-[11.5px] text-cyber-cyan/70">
          温湿度处于目标区间内，执行器全关（§7.4 A9）
        </div>

        <span class="digital mt-auto pt-1 text-[10px] tracking-[1px] text-text-dim">
          点击进入 3D 单独展示 · 更新 {{ house.updatedAt }} · WiFi {{ house.rssi }} dBm
        </span>
      </button>
    </div>

    <!-- ============ 图例 ============ -->
    <div class="flex shrink-0 items-center gap-5 px-1">
      <span
        v-for="(meta, key) in houseStatusMeta"
        :key="key"
        class="flex items-center gap-2 text-[11px] text-text-sub"
      >
        <span
          class="h-[10px] w-[14px] rounded-[2px] border"
          :style="{ background: meta.fill, borderColor: meta.color }"
        ></span>
        {{ meta.label }}
      </span>
      <span class="ml-auto text-[11px] text-text-sub">
        点击任意蚕房 → 中间 3D 单独展示，底部同步该栋温湿度与目标区间
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 严重 / 预警 卡片呼吸提醒（伪元素 + opacity，合成器动画） */
.tech-panel.st-critical,
.tech-panel.st-warning {
  position: relative;
}

.tech-panel.st-critical {
  border-color: rgba(255, 51, 51, 0.75);
}

.tech-panel.st-warning {
  border-color: rgba(255, 213, 0, 0.7);
}

.tech-panel.st-critical::after,
.tech-panel.st-warning::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 4px;
  pointer-events: none;
  will-change: opacity;
  animation: card-glow 1.8s ease-in-out infinite;
}

.tech-panel.st-critical::after {
  box-shadow: inset 0 0 26px 2px rgba(255, 51, 51, 0.55);
}

.tech-panel.st-warning::after {
  box-shadow: inset 0 0 26px 2px rgba(255, 213, 0, 0.45);
  animation-duration: 2.4s;
}

.tech-panel.selected {
  outline: 2px solid rgba(0, 229, 255, 0.9);
  outline-offset: 1px;
}

@keyframes card-glow {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
</style>
