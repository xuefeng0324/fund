<template>
  <div id="app">
    <div class="sticky-header">
      <Header />
      <IndexStrip :data="indexData" />
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
        title="实时估值基金"
        :funds="filteredNormalFunds"
        :advice="adviceData"
        :loading="loading"
        :advice-loading="adviceLoading"
      />
      <FundTable
        title="上一交易日涨跌"
        :funds="filteredSpecialFunds"
        :advice="adviceData"
        :loading="loading"
        :advice-loading="adviceLoading"
        style="margin-top: 16px;"
      />
    </div>
    <FundManageModal
      v-if="showManageModal"
      :key-value="validKey"
      :fund-name-map="fundNameMap"
      @close="showManageModal = false"
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
// 自动刷新定时器
let refreshTimer = null
const REFRESH_INTERVAL = 2 * 60 * 1000 // 2分钟

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
const { fundCodes, fundGroups, loadConfig } = useConfig()
const { funds, fundNameMap, loadFunds } = useFunds()
const { indexData, loadIndex } = useIndex()
const { adviceData, loadAdvice } = useAdvice()
const { validateKey: authValidateKey } = useAuth()

// 计算属性
const normalFunds = computed(() => funds.value.filter(f => f.GSZ != null))
const specialFunds = computed(() => funds.value.filter(f => f.GSZ == null))

// 搜索过滤
const filteredNormalFunds = computed(() => {
  if (!searchKeyword.value) return normalFunds.value
  const kw = searchKeyword.value.toLowerCase()
  return normalFunds.value.filter(f =>
    f.FCODE?.toLowerCase().includes(kw) ||
    f.SHORTNAME?.toLowerCase().includes(kw)
  )
})

const filteredSpecialFunds = computed(() => {
  if (!searchKeyword.value) return specialFunds.value
  const kw = searchKeyword.value.toLowerCase()
  return specialFunds.value.filter(f =>
    f.FCODE?.toLowerCase().includes(kw) ||
    f.SHORTNAME?.toLowerCase().includes(kw)
  )
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
  const codes = getEffectiveCodes()
  if (codes && codes.length) {
    adviceLoading.value = true
    loadAdvice(codes).finally(() => {
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
})

// 组件卸载时清理定时器
onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
})
</script>

<style>
.sticky-header {
  position: sticky;
  top: 0;
  z-index: 100;
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