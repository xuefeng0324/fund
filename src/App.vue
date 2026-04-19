<template>
  <div id="app">
    <div class="sticky-header">
      <Header />
      <IndexStrip :data="indexData" :opacity="indexStripOpacity" />
    </div>
    <div class="container">
      <Toolbar
        v-model:key-value="keyValue"
        v-model:show-all="showAll"
        :valid-key="validKey"
        :last-update="lastUpdate"
        :loading="loading"
        :advice-loading="adviceLoading"
        @refresh="handleRefresh"
        @manage="showManageModal = true"
        @search="searchKeyword = $event"
      />
      <FundTable
        v-for="dateKey in sortedGroupKeys"
        :key="dateKey"
        :title="getTableTitle(dateKey)"
        :funds="groupedFunds[dateKey]"
        :advice="adviceData"
        :loading="loading"
        :advice-loading="adviceLoading"
        :collapsible="true"
        :default-collapsed="false"
      />
    </div>
    <FundManageModal
      v-model="showManageModal"
      :key-value="validKey"
      :fund-name-map="fundNameMap"
      @saved="onFundSaved"
    />
    <CustomAlert />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import Header from './components/Header.vue'
import IndexStrip from './components/IndexStrip.vue'
import Toolbar from './components/Toolbar.vue'
import FundTable from './components/FundTable.vue'
import FundManageModal from './components/FundManageModal.vue'
import CustomAlert from './components/CustomAlert.vue'
import { useFunds } from './composables/useFunds'
import { useIndex } from './composables/useIndex'
import { useAdvice } from './composables/useAdvice'
import { useConfig } from './composables/useConfig'
import { useAuth } from './composables/useAuth'

// 状态
const keyValue = ref('')
const showAll = ref(true)
const loading = ref(false)
const adviceLoading = ref(false)  // 建议数据加载状态
const showManageModal = ref(false)
const validKey = ref('')
const lastUpdate = ref(null)
const searchKeyword = ref('')

// 滚动透明化相关状态
const indexStripOpacity = ref(1)
let ticking = false
let rafId = null
const stickyHeaderEl = ref(null)
const toolbarEl = ref(null)

// 自动刷新定时器
let refreshTimer = null
const REFRESH_INTERVAL = 2 * 60 * 1000 // 2分钟

// 缓动函数：ease-out cubic
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

// 动态计算淡出起始距离（基于 IndexStrip 高度）
function getFadeDistance() {
  const indexStripEl = stickyHeaderEl.value?.querySelector('.index-strip')
  if (!indexStripEl) return 200 // 默认值

  const stripHeight = indexStripEl.offsetHeight
  return stripHeight + 50 // IndexStrip 高度 + 缓冲
}

// 计算并更新 IndexStrip opacity
function calculateOpacity() {
  if (!stickyHeaderEl.value || !toolbarEl.value) return

  // IndexStrip 完全透明的条件：toolbar 上沿 <= sticky-header 中 header 的下沿
  // 即搜索框滚动到"基金监控"标题底部时，指数数据完全不可见
  const headerBottom = stickyHeaderEl.value.querySelector('.header-menu').getBoundingClientRect().bottom
  const toolbarTop = toolbarEl.value.getBoundingClientRect().top

  const distance = toolbarTop - headerBottom
  const fadeDistance = getFadeDistance()

  // 进度映射: distance 从 fadeDistance 到 0，progress 从 1 到 0
  let progress = Math.min(Math.max(distance / fadeDistance, 0), 1)

  // 应用 ease-out 缓动
  const newOpacity = easeOutCubic(progress)

  // 只有值变化超过阈值才更新，避免频繁触发响应式更新
  if (Math.abs(newOpacity - indexStripOpacity.value) > 0.01) {
    indexStripOpacity.value = newOpacity
  }
}

// 滚动事件处理（使用 requestAnimationFrame 包装）
function onScroll() {
  if (!ticking) {
    rafId = requestAnimationFrame(() => {
      calculateOpacity()
      ticking = false
    })
    ticking = true
  }
}

// 重置定时器（手动刷新后调用，避免短时间内连续触发）
function resetTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }
  refreshTimer = setInterval(() => {
    loadData()
  }, REFRESH_INTERVAL)
}

// 组合式函数
const { fundCodes, fundGroups, fundInfoMap, loadConfig } = useConfig()
const { funds, fundNameMap, loadFunds } = useFunds()
const { indexData, loadIndex } = useIndex()
const { adviceData, loadAdvice } = useAdvice()
const { validateKey: authValidateKey } = useAuth()

// 搜索过滤
const filteredNormalFunds = computed(() => {
  if (!searchKeyword.value) return funds.value
  const kw = searchKeyword.value.toLowerCase()
  return funds.value.filter(f =>
    f.FCODE?.toLowerCase().includes(kw) ||
    f.SHORTNAME?.toLowerCase().includes(kw)
  )
})

// 按买入确认日分组
const groupedFunds = computed(() => {
  const groups = {}
  for (const fund of funds.value) {
    const code = fund.FCODE
    const dateKey = fundInfoMap.value[code] ?? 'unknown'
    if (!groups[dateKey]) groups[dateKey] = []
    groups[dateKey].push(fund)
  }
  return groups
})

// 获取表格标题
function getTableTitle(dateKey) {
  if (dateKey === 'unknown') return '基金实时估值（未知）'
  return `基金实时估值（T+${dateKey}）`
}

// 按 dateKey 排序（1, 2, 3, ..., unknown）
const sortedGroupKeys = computed(() => {
  return Object.keys(groupedFunds.value).sort((a, b) => {
    if (a === 'unknown') return 1
    if (b === 'unknown') return -1
    return parseInt(a) - parseInt(b)
  })
})

// 方法
async function loadData() {
  if (loading.value) return
  loading.value = true
  try {
    const codes = getEffectiveCodes()
    if (!codes || !codes.length) {
      loading.value = false
      return
    }
    // 先加载基金数据和指数数据
    await Promise.all([
      loadFunds(codes),
      loadIndex()
    ])
    // 基金数据加载完成，立即更新时间
    lastUpdate.value = new Date()
  } finally {
    loading.value = false
  }

  // 异步加载建议数据（不阻塞主流程）
  // 构建 code -> fund 映射，将实时估值（GSZZL）传给建议计算
  const codes2 = getEffectiveCodes()
  if (codes2 && codes2.length) {
    const fundsMap = {}
    funds.value.forEach(f => {
      if (f.FCODE) fundsMap[f.FCODE] = f
    })
    adviceLoading.value = true
    loadAdvice(codes2, fundsMap).finally(() => {
      adviceLoading.value = false
    })
  }
}

// 手动刷新处理（重置定时器，避免短时间内连续触发）
function handleRefresh() {
  loadData()
  resetTimer()
}

function getEffectiveCodes() {
  // 如果是"看全部"模式或者没有有效密钥，返回全部基金
  if (showAll.value || !validKey.value) {
    return fundCodes.value
  }
  // 否则返回对应分组的基金
  if (fundGroups.value[validKey.value]) {
    return fundGroups.value[validKey.value]
  }
  return fundCodes.value
}

function onFundSaved(data) {
  if (data && data.fundGroups && data.fundCodes) {
    // 直接使用保存后返回的数据更新本地状态
    fundGroups.value = data.fundGroups
    fundCodes.value = data.fundCodes
    // 刷新数据
    loadData()
  } else {
    // 兼容旧的调用方式
    loadConfig().then(loadData)
  }
}

// 监听密钥变化
watch(keyValue, async (newKey, oldKey) => {
  // 避免初始化时重复触发
  if (newKey === oldKey) return

  if (newKey) {
    const isValid = await authValidateKey(newKey, fundGroups.value)
    if (isValid) {
      validKey.value = newKey
      showAll.value = false
      localStorage.setItem('fundMonitorValidKey', newKey)
      loadData()
    }
  } else {
    // 密钥清空时，清除有效密钥并显示全部
    validKey.value = ''
    showAll.value = true
    localStorage.removeItem('fundMonitorValidKey')
    loadData()
  }
})

// 初始化
onMounted(async () => {
  await loadConfig()

  // 恢复密钥
  const storedKey = localStorage.getItem('fundMonitorValidKey')
  if (storedKey) {
    keyValue.value = storedKey
    const isValid = await authValidateKey(storedKey, fundGroups.value)
    if (isValid) {
      validKey.value = storedKey
      showAll.value = false
    } else {
      showAll.value = true
    }
  } else {
    showAll.value = true
  }

  loadData()

  // 启动定时自动刷新
  refreshTimer = setInterval(() => {
    loadData()
  }, REFRESH_INTERVAL)

  // --- 滚动透明化初始化 ---
  // 获取元素引用
  stickyHeaderEl.value = document.querySelector('.sticky-header')
  toolbarEl.value = document.querySelector('.toolbar')

  // 初始化 opacity（当前滚动位置）
  calculateOpacity()

  // 添加滚动监听
  window.addEventListener('scroll', onScroll, { passive: true })
})

// 组件卸载时清理定时器
onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }

  // 清理滚动监听
  window.removeEventListener('scroll', onScroll)
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
})
</script>

<style>
.sticky-header {
  position: sticky;
  top: 0;
  z-index: 100;
  pointer-events: none;
}

.sticky-header > * {
  pointer-events: auto;
}

.container {
  padding: 24px 32px;
  max-width: 1400px;
  margin: 0 auto;
}

@media (max-width: 768px) {
  .container {
    padding: 16px;
  }
}

@media (max-width: 480px) {
  .container {
    padding: 12px;
  }
}
</style>
