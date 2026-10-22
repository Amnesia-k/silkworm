/**
 * 大屏 ECharts 图表配置（统一暗色科技风主题）
 * 所有图表共用一套坐标轴 / 提示框 / 网格样式，保证视觉一致性
 *
 * 图表口径全部来自《蚕房环境调控系统 规格书》v1.0：
 *   §1.5 / §15.5 越限判定与验收红线   §6.3 温湿度目标区间   §7.3 控制参数
 */
import type { EChartsOption } from 'echarts'

/* ------------------------------ 主题常量 ------------------------------ */
export const CYBER = {
  blue: '#00E5FF',
  cyan: '#00FFAA',
  purple: '#7C4DFF',
  yellow: '#FFD500',
  orange: '#FF9900',
  red: '#FF3333',
  textMain: '#D6E4FF',
  textSub: '#7F93B8',
  textDim: '#4D5F80',
  line: 'rgba(0, 229, 255, 0.18)',
  split: 'rgba(0, 229, 255, 0.08)',
}

const AXIS_LABEL = { color: CYBER.textSub, fontSize: 11 }
const LEGEND = {
  top: 0,
  right: 0,
  itemWidth: 12,
  itemHeight: 6,
  icon: 'roundRect' as const,
  textStyle: { color: CYBER.textSub, fontSize: 11 },
}
const TOOLTIP = {
  trigger: 'axis' as const,
  backgroundColor: 'rgba(6, 14, 34, 0.94)',
  borderColor: 'rgba(0, 229, 255, 0.45)',
  borderWidth: 1,
  textStyle: { color: CYBER.textMain, fontSize: 12 },
  axisPointer: {
    type: 'line' as const,
    lineStyle: { color: 'rgba(0, 229, 255, 0.45)', type: 'dashed' as const },
  },
}

function verticalGradient(from: string, to: string) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: from },
      { offset: 1, color: to },
    ],
  }
}

function categoryAxis(data: string[], boundaryGap: boolean) {
  return {
    type: 'category' as const,
    boundaryGap,
    data,
    axisLine: { lineStyle: { color: CYBER.line } },
    axisTick: { show: false },
    axisLabel: AXIS_LABEL,
  }
}

/* ==================== 1. 在线率环形进度 ==================== */
export function buildOnlineGauge(rate: number): EChartsOption {
  return {
    series: [
      {
        type: 'gauge',
        startAngle: 215,
        endAngle: -35,
        min: 0,
        max: 100,
        radius: '92%',
        center: ['50%', '56%'],
        progress: {
          show: true,
          width: 10,
          roundCap: true,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 1,
              colorStops: [
                { offset: 0, color: CYBER.blue },
                { offset: 1, color: CYBER.cyan },
              ],
            },
            shadowBlur: 16,
            shadowColor: 'rgba(0, 229, 255, 0.85)',
          },
        },
        axisLine: { lineStyle: { width: 10, color: [[1, 'rgba(0, 229, 255, 0.12)']] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: { show: false },
        data: [{ value: rate }],
      },
    ],
  }
}

/* ==================== 2. 越限时长趋势（§1.5 / §15.5 验收红线） ==================== */
export function buildOverrunTrend(data: {
  categories: string[]
  current: number[]
  limit: number
  limitLabel: string
}): EChartsOption {
  return {
    tooltip: TOOLTIP,
    grid: { left: 8, right: 10, top: 22, bottom: 4, containLabel: true },
    xAxis: categoryAxis(data.categories, true),
    yAxis: {
      type: 'value',
      name: 'min',
      nameTextStyle: { color: CYBER.textDim, fontSize: 10 },
      axisLabel: AXIS_LABEL,
      splitLine: { lineStyle: { color: CYBER.split } },
    },
    series: [
      {
        name: '重度越限时长',
        type: 'bar',
        barWidth: 16,
        data: data.current.map((v) => ({
          value: v,
          itemStyle: {
            borderRadius: [3, 3, 0, 0],
            color:
              v > data.limit
                ? verticalGradient('rgba(255,51,51,.95)', 'rgba(255,51,51,.15)')
                : verticalGradient('rgba(0,229,255,.9)', 'rgba(0,229,255,.12)'),
          },
        })),
        label: {
          show: true,
          position: 'top',
          color: CYBER.textMain,
          fontSize: 10,
          fontFamily: 'Orbitron, monospace',
        },
        markLine: {
          silent: true,
          symbol: 'none',
          precision: 0,
          label: {
            formatter: data.limitLabel,
            color: CYBER.yellow,
            fontSize: 10,
            position: 'insideStartTop',
          },
          lineStyle: { color: CYBER.yellow, type: 'dashed', width: 1.4 },
          data: [{ yAxis: data.limit }],
        },
      },
    ],
  }
}

/* ==================== 3. 告警级别统计（横向柱状，§13.1） ==================== */
export function buildAlertBars(
  levels: { name: string; value: number; color: string }[],
): EChartsOption {
  return {
    tooltip: { ...TOOLTIP, trigger: 'item' },
    grid: { left: 8, right: 44, top: 8, bottom: 4, containLabel: true },
    xAxis: {
      type: 'value',
      show: false,
      max: Math.max(1, ...levels.map((l) => l.value)) * 1.25,
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: levels.map((l) => l.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        barWidth: 11,
        showBackground: true,
        backgroundStyle: { color: 'rgba(0, 229, 255, 0.07)', borderRadius: 5 },
        itemStyle: {
          borderRadius: 5,
          color: (params: { dataIndex: number }) => levels[params.dataIndex]?.color ?? CYBER.blue,
          shadowBlur: 12,
          shadowColor: 'rgba(0, 229, 255, 0.45)',
        },
        label: {
          show: true,
          position: 'right',
          color: CYBER.textMain,
          fontSize: 12,
          fontFamily: 'Orbitron, monospace',
          formatter: '{c}',
        },
        data: levels.map((l) => l.value),
      },
    ],
  }
}

/* ==================== 4. 执行器运行时长（立体质感，近 24h） ==================== */
export function buildRuntimeArea(data: {
  categories: string[]
  heater: number[]
  fan: number[]
}): EChartsOption {
  /** 用一条下移的暗色副线模拟 3D 厚度 */
  const thickness = (arr: number[], offset: number) => arr.map((v) => Math.max(0, v - offset))

  return {
    tooltip: TOOLTIP,
    legend: { ...LEGEND, data: ['加热片', '风扇合计'] },
    grid: { left: 8, right: 10, top: 28, bottom: 4, containLabel: true },
    xAxis: categoryAxis(data.categories, false),
    yAxis: {
      type: 'value',
      name: 'h',
      nameTextStyle: { color: CYBER.textDim, fontSize: 10 },
      axisLabel: AXIS_LABEL,
      splitLine: { lineStyle: { color: CYBER.split } },
    },
    series: [
      {
        name: '风扇底层',
        type: 'line',
        smooth: true,
        symbol: 'none',
        silent: true,
        data: thickness(data.fan, 0.6),
        lineStyle: { width: 0 },
        areaStyle: { color: verticalGradient('rgba(0, 255, 170, 0.10)', 'rgba(0, 255, 170, 0)') },
        tooltip: { show: false },
        legendHoverLink: false,
      },
      {
        name: '风扇合计',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: data.fan,
        lineStyle: { width: 2, color: CYBER.cyan, shadowBlur: 14, shadowColor: 'rgba(0,255,170,.85)' },
        areaStyle: { color: verticalGradient('rgba(0, 255, 170, 0.42)', 'rgba(0, 255, 170, 0.02)') },
      },
      {
        name: '加热片底层',
        type: 'line',
        smooth: true,
        symbol: 'none',
        silent: true,
        data: thickness(data.heater, 0.4),
        lineStyle: { width: 0 },
        areaStyle: { color: verticalGradient('rgba(255, 122, 69, 0.10)', 'rgba(255, 122, 69, 0)') },
        tooltip: { show: false },
        legendHoverLink: false,
      },
      {
        name: '加热片',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: data.heater,
        lineStyle: { width: 2, color: '#FF7A45', shadowBlur: 14, shadowColor: 'rgba(255,122,69,.85)' },
        areaStyle: { color: verticalGradient('rgba(255, 122, 69, 0.38)', 'rgba(255, 122, 69, 0.02)') },
      },
    ],
  }
}

/* ==================== 5. 单栋温湿度 + §6.3 目标区间带（选中某个蚕房时用） ==================== */
export function buildEnvCombo(data: {
  categories: string[]
  temp: number[]
  hum: number[]
  target: { tMin: number; tMax: number; hMin: number; hMax: number }
  /** 越限点（曲线标红，对应 §1.5 轻度/重度越限） */
  overrun?: boolean[]
}): EChartsOption {
  const overrun = data.overrun ?? []
  // 坐标轴范围必须包住目标区间带，否则 markArea 会被裁掉看不见
  const tMin = Math.floor(Math.min(...data.temp, data.target.tMin) - 0.5)
  const tMax = Math.ceil(Math.max(...data.temp, data.target.tMax) + 0.5)
  const hMin = Math.floor(Math.min(...data.hum, data.target.hMin) - 2)
  const hMax = Math.ceil(Math.max(...data.hum, data.target.hMax) + 2)

  return {
    tooltip: TOOLTIP,
    legend: { ...LEGEND, data: ['温度', '湿度'] },
    grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
    xAxis: categoryAxis(data.categories, true),
    yAxis: [
      {
        type: 'value',
        name: '℃',
        nameTextStyle: { color: CYBER.textDim, fontSize: 10 },
        min: tMin,
        max: tMax,
        axisLabel: AXIS_LABEL,
        splitLine: { lineStyle: { color: CYBER.split } },
      },
      {
        type: 'value',
        name: '%RH',
        nameTextStyle: { color: CYBER.textDim, fontSize: 10 },
        min: hMin,
        max: hMax,
        axisLabel: AXIS_LABEL,
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '温度',
        type: 'bar',
        barWidth: 12,
        data: data.temp.map((v, i) => ({
          value: v,
          itemStyle: {
            borderRadius: [3, 3, 0, 0] as [number, number, number, number],
            color: overrun[i]
              ? verticalGradient('rgba(255,51,51,.95)', 'rgba(255,51,51,.15)')
              : verticalGradient('rgba(0,229,255,.95)', 'rgba(0,229,255,.12)'),
            shadowBlur: 10,
            shadowColor: overrun[i] ? 'rgba(255,51,51,.55)' : 'rgba(0, 229, 255, 0.5)',
          },
        })),
        markArea: {
          silent: true,
          itemStyle: { color: 'rgba(0, 255, 170, 0.07)' },
          label: {
            show: true,
            formatter: '温度目标区间',
            color: 'rgba(0, 255, 170, 0.6)',
            fontSize: 9,
            position: 'insideTopLeft',
          },
          data: [[{ yAxis: data.target.tMin }, { yAxis: data.target.tMax }]],
        },
      },
      {
        name: '湿度',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: data.hum,
        itemStyle: { color: CYBER.cyan },
        lineStyle: { width: 2, color: CYBER.cyan, shadowBlur: 12, shadowColor: 'rgba(0,255,170,.8)' },
        markArea: {
          silent: true,
          itemStyle: { color: 'rgba(124, 77, 255, 0.07)' },
          data: [[{ yAxis: data.target.hMin }, { yAxis: data.target.hMax }]],
        },
      },
    ],
  }
}

/* ==================== 6. 四个蚕房温度对比（底部趋势图默认态） ==================== */
export function buildHouseTempOverview(
  categories: string[],
  series: { name: string; color: string; data: number[] }[],
  /** 各栋目标区间参考线（取选中栋，或园区上下限包络） */
  band?: { tMin: number; tMax: number; label: string },
): EChartsOption {
  const all = series.flatMap((s) => s.data)
  const min = Math.floor(Math.min(...all, band?.tMin ?? Infinity) - 1)
  const max = Math.ceil(Math.max(...all, band?.tMax ?? -Infinity) + 1)

  return {
    tooltip: TOOLTIP,
    legend: { ...LEGEND, data: series.map((s) => s.name) },
    grid: { left: 8, right: 10, top: 30, bottom: 4, containLabel: true },
    xAxis: categoryAxis(categories, false),
    yAxis: {
      type: 'value',
      name: '℃',
      nameTextStyle: { color: CYBER.textDim, fontSize: 10 },
      min,
      max,
      axisLabel: AXIS_LABEL,
      splitLine: { lineStyle: { color: CYBER.split } },
    },
    series: series.map((s, si) => ({
      name: s.name,
      type: 'line' as const,
      smooth: true,
      symbol: 'circle',
      symbolSize: 5,
      data: s.data,
      itemStyle: { color: s.color },
      lineStyle: { width: 2, color: s.color, shadowBlur: 10, shadowColor: s.color },
      ...(si === 0 && band
        ? {
            markArea: {
              silent: true,
              itemStyle: { color: 'rgba(0, 255, 170, 0.06)' },
              label: {
                show: true,
                formatter: band.label,
                color: 'rgba(0, 255, 170, 0.55)',
                fontSize: 9,
                position: 'insideTopRight' as const,
              },
              data: [[{ yAxis: band.tMin }, { yAxis: band.tMax }]],
            },
          }
        : {}),
    })),
  }
}
