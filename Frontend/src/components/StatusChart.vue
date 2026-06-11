<template>
  <div ref="chartRef" class="chart"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { STATUS_META } from '../utils/progress'

const props = defineProps({
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
  label: '#bddff2',
  line: 'rgba(34, 191, 242, 0.28)'
}

function renderChart() {
  if (!chartRef.value) return
  if (!chart) {
    chart = echarts.init(chartRef.value)
  }
  const data = Object.entries(STATUS_META).map(([key, meta]) => ({
    name: meta.label,
    value: props.summary[key] || 0,
    itemStyle: { color: meta.color }
  }))
  chart.setOption({
    tooltip: {
      trigger: 'item',
      backgroundColor: chartTheme.tooltipBg,
      borderColor: chartTheme.tooltipBorder,
      textStyle: { color: chartTheme.text }
    },
    series: [
      {
        type: 'pie',
        radius: ['58%', '78%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        label: {
          color: chartTheme.label,
          formatter: '{b}\n{c}'
        },
        labelLine: {
          lineStyle: { color: chartTheme.line }
        },
        data
      }
    ]
  })
}

watch(() => props.summary, renderChart, { deep: true })

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
