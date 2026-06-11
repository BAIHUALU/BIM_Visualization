<template>
  <div ref="chartRef" class="chart"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { VARIANCE_META } from '../utils/progress'

const props = defineProps({
  type: {
    type: String,
    default: 'variance'
  },
  summary: {
    type: Object,
    default: () => ({})
  }
})

const chartRef = ref(null)
let chart
let observer

const chartTheme = {
  tooltipBg: 'rgba(2, 12, 39, 0.96)',
  tooltipBorder: 'rgba(26, 139, 211, 0.28)',
  text: '#e9f7ff',
  axis: '#82abc9',
  label: '#bddff2',
  split: 'rgba(26, 139, 211, 0.1)',
  plan: '#0aa3e8',
  actual: '#27c98d',
  coverage: '#22bff2',
  delayed: '#e95f63'
}

function themedTooltip(trigger) {
  return {
    trigger,
    backgroundColor: chartTheme.tooltipBg,
    borderColor: chartTheme.tooltipBorder,
    textStyle: { color: chartTheme.text }
  }
}

function renderVarianceChart() {
  const distribution = props.summary.distribution || {}
  const data = Object.entries(VARIANCE_META).map(([key, meta]) => ({
    name: meta.label,
    value: distribution[key] || 0,
    itemStyle: { color: meta.color }
  }))
  return {
    tooltip: themedTooltip('item'),
    series: [
      {
        type: 'pie',
        radius: ['56%', '76%'],
        center: ['50%', '52%'],
        label: {
          color: chartTheme.label,
          formatter: '{b}\n{c}'
        },
        labelLine: {
          lineStyle: { color: 'rgba(34, 191, 242, 0.28)' }
        },
        data
      }
    ]
  }
}

function renderZoneChart() {
  const rows = (props.summary.byZone || []).slice(0, 8).reverse()
  return {
    grid: {
      top: 10,
      right: 18,
      bottom: 22,
      left: 36
    },
    tooltip: themedTooltip('axis'),
    xAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: chartTheme.axis },
      splitLine: { lineStyle: { color: chartTheme.split } }
    },
    yAxis: {
      type: 'category',
      data: rows.map((row) => row.zone),
      axisLabel: { color: chartTheme.label },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: '实际',
        type: 'bar',
        barWidth: 10,
        data: rows.map((row) => row.actual_percent),
        itemStyle: { color: chartTheme.actual, borderRadius: 4 }
      },
      {
        name: '计划',
        type: 'bar',
        barWidth: 10,
        data: rows.map((row) => row.plan_percent),
        itemStyle: { color: chartTheme.plan, borderRadius: 4 }
      }
    ]
  }
}

function renderZoneCompareChart() {
  const rows = [...(props.summary.byZone || [])]
    .sort((a, b) => Math.abs((b.actual_percent || 0) - b.plan_percent) - Math.abs((a.actual_percent || 0) - a.plan_percent))
    .slice(0, 6)
    .reverse()
  return {
    grid: { top: 18, right: 14, bottom: 20, left: 36 },
    tooltip: themedTooltip('axis'),
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: chartTheme.axis }
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: chartTheme.axis },
      splitLine: { lineStyle: { color: chartTheme.split } }
    },
    yAxis: {
      type: 'category',
      data: rows.map((row) => row.zone),
      axisLabel: { color: chartTheme.label },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: '实际',
        type: 'bar',
        barWidth: 10,
        data: rows.map((row) => row.actual_percent),
        itemStyle: { color: chartTheme.actual, borderRadius: 4 }
      },
      {
        name: '计划',
        type: 'bar',
        barWidth: 10,
        data: rows.map((row) => row.plan_percent),
        itemStyle: { color: chartTheme.plan, borderRadius: 4 }
      }
    ]
  }
}

function renderZoneCoverageChart() {
  const rows = (props.summary.byZone || []).slice(0, 9).reverse()
  return {
    grid: { top: 10, right: 14, bottom: 18, left: 38 },
    tooltip: themedTooltip('axis'),
    xAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: chartTheme.axis },
      splitLine: { lineStyle: { color: chartTheme.split } }
    },
    yAxis: {
      type: 'category',
      data: rows.map((row) => row.zone),
      axisLabel: { color: chartTheme.label },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: '录入覆盖率',
        type: 'bar',
        barWidth: 10,
        data: rows.map((row) => row.coverage_percent),
        itemStyle: { color: chartTheme.coverage, borderRadius: 4 },
        label: {
          show: true,
          position: 'right',
          color: chartTheme.label,
          formatter: ({ dataIndex }) => `${rows[dataIndex].recorded}/${rows[dataIndex].count}`
        }
      }
    ]
  }
}

function renderZoneVarianceRankChart() {
  const rows = (props.summary.zoneVarianceRank || [])
    .filter((row) => row.variance_percent < 0)
    .slice(0, 6)
    .reverse()
  return {
    grid: { top: 12, right: 24, bottom: 18, left: 36 },
    tooltip: themedTooltip('axis'),
    xAxis: {
      type: 'value',
      axisLabel: { color: chartTheme.axis, formatter: '{value}%' },
      splitLine: { lineStyle: { color: chartTheme.split } }
    },
    yAxis: {
      type: 'category',
      data: rows.map((row) => row.zone),
      axisLabel: { color: chartTheme.label },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: '区域偏差',
        type: 'bar',
        barWidth: 12,
        data: rows.map((row) => row.variance_percent),
        itemStyle: {
          borderRadius: 4,
          color: ({ value }) => (value < 0 ? chartTheme.delayed : chartTheme.actual)
        },
        label: {
          show: true,
          position: 'right',
          color: chartTheme.label,
          formatter: ({ value }) => `${value > 0 ? '+' : ''}${value}%`
        }
      }
    ]
  }
}

function renderChart() {
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  const optionsByType = {
    zone: renderZoneChart,
    zoneCompare: renderZoneCompareChart,
    zoneCoverage: renderZoneCoverageChart,
    zoneVarianceRank: renderZoneVarianceRankChart,
    variance: renderVarianceChart
  }
  chart.setOption((optionsByType[props.type] || renderVarianceChart)(), true)
}

watch(() => props.summary, renderChart, { deep: true })
watch(() => props.type, renderChart)

onMounted(() => {
  renderChart()
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(chartRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
})
</script>
