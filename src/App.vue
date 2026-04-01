<template>
  <div id="app">
    <div class="sticky-header">
      <Header :last-update="lastUpdate" />
      <IndexStrip :data="indexData" />
    </div>
    <div class="container">
      <Toolbar
        v-model:key-value="keyValue"
        v-model:source-mode="sourceMode"
        v-model:show-all="showAll"
        :valid-key="validKey"
        :last-update="lastUpdate"
        :loading="loading"
        @refresh="handleRefresh"
        @manage="showManageModal = true"
        @search="searchKeyword = $event"
      />
      <FundTable
        title="实时估值基金"
        :funds="filteredNormalFunds"
        :advice="adviceData"
        :loading="loading"
      />
      <FundTable
        title="上一交易日涨跌"
        :funds="filteredSpecialFunds"
        :advice="adviceData"
        :loading="loading"
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
    <!-- 诊断面板 -->
    <div v-if="showDiag" class="diag-panel">
      <div class="diag-title">数据链路诊断 <button class="diag-close" @click="showDiag = false">×</button></div>
      <div class="diag-section">
        <div class="diag-row">
          <span class="diag-label">配置加载：</span>
          <span :class="['diag-val', diagConfigClass]">{{ configDiag.succeeded || (configDiag.failed ? '失败:' + configDiag.failed : '加载中...') }}</span>
        </div>
        <div v-if="configDiag.tried && configDiag.tried.length" class="diag-row">
          <span class="diag-label">已尝试路径：</span>
          <span class="diag-val">{{ configDiag.tried.join(' → ') }}</span>
        </div>
        <div class="diag-row">
          <span class="diag-label">配置基金数：</span>
          <span class="diag-val">{{ fundCodes.length }}</span>
        </div>
        <div class="diag-row">
          <span class="diag-label">数据请求：</span>
          <span :class="['diag-val', funds.length > 0 ? 'ok' : 'err']">{{ funds.length > 0 ? '有数据' : '无数据' }}</span>
        </div>
        <div v-if="configError" class="diag-row">
          <span class="diag-label">配置错误：</span>
          <span class="diag-val err">{{ configError }}</span>
        </div>
      </div>
      <div class="diag-tip">刷新后重新检测，开发者可据此判断卡在哪一步</div>
    </div>
    <button class="diag-toggle" @click="showDiag = !showDiag">{{ showDiag ? '隐藏诊断' : '诊断' }}</button>
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
const sourceMode = ref('auto')
const showAll = ref(true)
const loading = ref(false)
const showManageModal = ref(false)
const validKey = ref('')
const lastUpdate = ref(null)
const searchKeyword = ref('')
const showDiag = ref(false)
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
const { fundCodes, fundGroups, loadConfig, configDiag, error: configError } = useConfig()
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

const diagConfigClass = computed(() => {
  if (!configDiag.value.succeeded && !configDiag.value.failed) return ''
  return configDiag.value.succeeded ? 'ok' : 'err'
})

// 方法
async function loadData() {
  if (loading.value) return
  loading.value = true
  try {
    const codes = getEffectiveCodes()
    await Promise.all([
      loadFunds(codes, sourceMode.value),
      loadIndex()
    ])
    await loadAdvice(codes)
    lastUpdate.value = new Date()
  } finally {
    loading.value = false
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

function onFundSaved() {
  loadConfig().then(loadData)
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
  }
  // 如果 keyValue 为空，由 showAll 状态控制是否显示全部
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

/* 诊断面板 */
.diag-panel {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 9999;
  background: #1e1e1e;
  color: #d4d4d4;
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 12px;
  min-width: 240px;
  max-width: 320px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.diag-title {
  font-weight: 700;
  margin-bottom: 8px;
  color: #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.diag-close {
  background: none;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}
.diag-section { display: flex; flex-direction: column; gap: 4px; }
.diag-row { display: flex; gap: 6px; align-items: flex-start; }
.diag-label { color: #888; flex-shrink: 0; }
.diag-val { color: #d4d4d4; word-break: break-all; }
.diag-val.ok { color: #4caf50; }
.diag-val.err { color: #f44336; }
.diag-tip { margin-top: 8px; color: #666; font-size: 11px; }
.diag-toggle {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 9998;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(79,70,229,0.4);
}
</style>