<template>
  <div class="fund-section">
    <div class="sub-section-title">{{ title }}</div>

    <!-- PC端表格 -->
    <el-table
      v-if="!isMobile"
      :data="sortedFunds"
      stripe
      class="fund-table"
      @header-click="sortBy"
    >
      <el-table-column prop="FCODE" label="代码" width="90" sortable />
      <el-table-column label="名称" min-width="120" sortable #default="{ row }">
        {{ getFundName(row) }}
      </el-table-column>
      <el-table-column label="估算净值" width="110" sortable #default="{ row }">
        <span :class="getChangeClass(row)">{{ row.GSZ ?? '-' }}</span>
      </el-table-column>
      <el-table-column label="估算涨跌" width="110" sortable #default="{ row }">
        <span :class="getChangeClass(row)" class="chg">{{ formatChange(row) }}</span>
      </el-table-column>
      <el-table-column label="J(日)" width="80" #default="{ row }">
        <span :class="getKDJClass(row)">{{ getKDJValue(row) }}</span>
      </el-table-column>
      <el-table-column label="阶段" width="80" #default="{ row }">
        <el-tag v-if="getPhase(row)" :type="getPhaseType(row)" size="small">{{ getPhase(row) }}</el-tag>
      </el-table-column>
      <el-table-column label="建议" width="120" #default="{ row }">
        <span :class="getAdviceClass(row)" class="advice-cell">{{ getAdvice(row) }}</span>
      </el-table-column>
      <el-table-column label="原因" min-width="180" #default="{ row }">
        <span class="reason-cell">{{ getReason(row) }}</span>
      </el-table-column>
      <el-table-column prop="GZTIME" label="更新时间" width="110" sortable />
    </el-table>

    <!-- 移动端卡片 -->
    <div v-else class="fund-cards">
      <el-card
        v-for="fund in sortedFunds"
        :key="fund.FCODE"
        class="fund-card"
        shadow="hover"
      >
        <div class="card-header">
          <div class="fund-info">
            <span class="fund-name">{{ getFundName(fund) }}</span>
            <span class="fund-code">{{ fund.FCODE }}</span>
          </div>
          <div class="fund-change" :class="getChangeClass(fund)">
            {{ formatChange(fund) }}
          </div>
        </div>
        <div class="card-body">
          <div class="card-item">
            <span class="label">估算净值</span>
            <span class="value" :class="getChangeClass(fund)">{{ fund.GSZ ?? '-' }}</span>
          </div>
          <div class="card-item">
            <span class="label">J(日)</span>
            <span class="value" :class="getKDJClass(fund)">{{ getKDJValue(fund) }}</span>
          </div>
          <div class="card-item">
            <span class="label">阶段</span>
            <el-tag v-if="getPhase(fund)" :type="getPhaseType(fund)" size="small">
              {{ getPhase(fund) }}
            </el-tag>
            <span v-else class="value">-</span>
          </div>
          <div class="card-item">
            <span class="label">建议</span>
            <span :class="getAdviceClass(fund)">{{ getAdvice(fund) }}</span>
          </div>
        </div>
        <div class="card-footer">
          <span class="reason">{{ getReason(fund) }}</span>
          <span class="time">{{ fund.GZTIME }}</span>
        </div>
      </el-card>
    </div>

    <el-empty v-if="sortedFunds.length === 0" description="暂无数据" />
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  funds: { type: Array, default: () => [] },
  advice: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false }
})

// 获取基金名称
function getFundName(fund) {
  return fund.SHORTNAME || fund.FCODE
}

const sortKey = ref(null)
const sortAsc = ref(true)
const windowWidth = ref(window.innerWidth)

function checkMobile() {
  return windowWidth.value < 768
}

const isMobile = computed(() => checkMobile())

function handleResize() {
  windowWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

function sortBy(column) {
  const key = column.property
  if (!key) return
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    sortAsc.value = true
  }
}

function getChangeValue(fund) {
  if (fund.GSZ != null && fund.GSZZL != null) {
    return parseFloat(fund.GSZZL)
  }
  if (fund.LAST_CHG != null) {
    return parseFloat(fund.LAST_CHG)
  }
  return null
}

function getChangeClass(fund) {
  const val = getChangeValue(fund)
  if (val == null) return ''
  return val > 0 ? 'positive' : val < 0 ? 'negative' : ''
}

function formatChange(fund) {
  const val = getChangeValue(fund)
  if (val == null) return '-'
  return (val > 0 ? '+' : '') + val.toFixed(2) + '%'
}

function getKDJValue(fund) {
  const advice = props.advice[fund.FCODE]
  return advice?.metrics?.j_daily_3m?.toFixed(1) ?? '-'
}

function getKDJClass(fund) {
  const j = props.advice[fund.FCODE]?.metrics?.j_daily_3m
  if (j == null) return ''
  if (j < -20) return 'kdj-oversold'
  if (j > 80) return 'kdj-overbought'
  return ''
}

function getPhase(fund) {
  const advice = props.advice[fund.FCODE]
  return advice?.metrics?.phase ?? ''
}

function getPhaseType(fund) {
  const phase = getPhase(fund)
  if (phase === '熊市' || phase === '止损') return 'danger'
  if (phase === '持有') return 'success'
  if (phase === '观望') return 'info'
  return 'warning'
}

function getAdvice(fund) {
  const advice = props.advice[fund.FCODE]
  const holdAction = advice?.metrics?.hold_action
  const flatAction = advice?.metrics?.flat_action
  // 显示格式：持仓：持有 / 空仓：买入
  if (holdAction || flatAction) {
    const parts = []
    if (holdAction) parts.push(`持仓：${holdAction}`)
    if (holdAction && flatAction) parts.push('————')
    if (flatAction) parts.push(`空仓：${flatAction}`)
    return parts.join('\n')
  }
  return advice?.action ?? '-'
}

function getAdviceClass(fund) {
  const advice = props.advice[fund.FCODE]
  const action = advice?.action
  const buyKeywords = ['买入', '加仓', '建仓', '小仓']
  if (buyKeywords.some(k => action?.includes(k))) return 'advice-buy'
  if (action?.includes('清仓') || action?.includes('减仓')) return 'advice-sell'
  return ''
}

function getReason(fund) {
  const advice = props.advice[fund.FCODE]
  const holdReasons = advice?.metrics?.hold_reasons
  const flatReasons = advice?.metrics?.flat_reasons
  // 显示格式：持仓：原因1 / ———— / 空仓：原因1
  if (holdReasons?.length || flatReasons?.length) {
    const parts = []
    if (holdReasons?.length) parts.push(`持仓：${holdReasons.join('，')}`)
    if (holdReasons?.length && flatReasons?.length) parts.push('————')
    if (flatReasons?.length) parts.push(`空仓：${flatReasons.join('，')}`)
    return parts.join('\n')
  }
  if (advice?.reasons?.length) {
    return advice.reasons.join('，')
  }
  return '-'
}

const sortedFunds = computed(() => {
  if (!sortKey.value) {
    return [...props.funds].sort((a, b) => {
      const va = getChangeValue(a)
      const vb = getChangeValue(b)
      if (va == null) return 1
      if (vb == null) return -1
      return vb - va
    })
  }

  if (sortKey.value === 'GSZZL') {
    return [...props.funds].sort((a, b) => {
      const va = getChangeValue(a)
      const vb = getChangeValue(b)
      if (va == null) return 1
      if (vb == null) return -1
      return sortAsc.value ? va - vb : vb - va
    })
  }

  return [...props.funds].sort((a, b) => {
    const va = a[sortKey.value]
    const vb = b[sortKey.value]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1

    const na = parseFloat(va)
    const nb = parseFloat(vb)
    if (!isNaN(na) && !isNaN(nb)) {
      return sortAsc.value ? na - nb : nb - na
    }
    return sortAsc.value
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va))
  })
})
</script>

<style scoped>
.fund-section {
  margin-top: 24px;
}

.sub-section-title {
  margin-bottom: 16px;
  font-weight: 700;
  font-size: 16px;
  color: #1a1a1a;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-section-title::before {
  content: '';
  width: 4px;
  height: 20px;
  background: #4f46e5;
  border-radius: 2px;
}

.fund-table {
  --el-table-border-color: #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  font-weight: 600;
}

.fund-table :deep(td) {
  font-weight: 600;
}

.positive {
  color: #dc2626;
}

.negative {
  color: #16a34a;
}

.chg {
  font-weight: 700;
}

.advice-buy {
  color: #4f46e5 !important;
  font-weight: 700;
}

.advice-sell {
  color: #dc2626 !important;
  font-weight: 700;
}

.kdj-oversold {
  color: #16a34a;
}

.kdj-overbought {
  color: #dc2626;
}

/* 移动端卡片 */
.fund-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fund-card {
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.fund-card :deep(.el-card__body) {
  padding: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.fund-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fund-name {
  font-size: 15px;
  font-weight: 700;
  color: #1a1a1a;
}

.fund-code {
  font-size: 12px;
  color: #888;
}

.fund-change {
  font-size: 18px;
  font-weight: 700;
}

.card-body {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.card-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-item .label {
  font-size: 12px;
  color: #9ca3af;
}

.card-item .value {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
}

.card-item span:not(.label) {
  white-space: pre-line;
  line-height: 1.4;
  font-size: 13px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f3f4f6;
}

.reason {
  font-size: 12px;
  color: #666;
  flex: 1;
  white-space: pre-line;
  line-height: 1.4;
}

.reason-cell {
  white-space: pre-line;
  line-height: 1.6;
}

.advice-cell {
  white-space: pre-line;
  line-height: 1.6;
}

.time {
  font-size: 11px;
  color: #9ca3af;
  white-space: nowrap;
  margin-left: 8px;
}

@media (max-width: 768px) {
  .fund-section {
    margin-top: 16px;
  }

  .sub-section-title {
    font-size: 14px;
    margin-bottom: 12px;
  }
}
</style>