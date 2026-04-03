<template>
  <div class="fund-section">
    <div class="section-header">
      <div class="sub-section-title">{{ title }}</div>
      <!-- 移动端功能按钮（标题右侧） -->
      <div v-if="isMobile" class="header-actions">
        <!-- 排序开关 -->
        <div class="sort-switch-wrap">
          <span :class="['sort-label-text', { active: !sortAsc, disabled: isLoading }]">降序</span>
          <el-switch
            v-model="sortAsc"
            class="sort-switch"
            :disabled="isLoading"
            @change="sortKey = 'GSZZL'"
          />
          <span :class="['sort-label-text', { active: sortAsc, disabled: isLoading }]">升序</span>
        </div>
        <!-- 展开/收起按钮 -->
        <span
          :class="['expand-btn', { disabled: isLoading }]"
          @click="!isLoading && (allExpanded ? collapseAll() : expandAll())"
        >
          {{ allExpanded ? '收起全部' : '展开全部' }}
        </span>
      </div>
    </div>

    <!-- PC端表格 -->
    <el-table
      v-if="!isMobile"
      :data="sortedFunds"
      stripe
      class="fund-table"
      @header-click="sortBy"
    >
      <el-table-column prop="FCODE" label="代码" width="90" sortable />
      <el-table-column prop="SHORTNAME" label="名称" min-width="120" sortable #default="{ row }">
        {{ getFundName(row) }}
      </el-table-column>
      <el-table-column prop="GSZ" label="估算净值" width="110" sortable #default="{ row }">
        <span :class="getChangeClass(row)">{{ row.GSZ ?? '-' }}</span>
      </el-table-column>
      <el-table-column prop="GSZZL" label="估算涨跌" width="110" sortable #default="{ row }">
        <span :class="getChangeClass(row)" class="chg">{{ formatChange(row) }}</span>
      </el-table-column>
      <el-table-column label="J(日)" width="80" #default="{ row }">
        <span :class="getKDJClass(row)">{{ getKDJValue(row) }}</span>
      </el-table-column>
      <el-table-column label="阶段" width="80" #default="{ row }">
        <el-tag v-if="getPhase(row)" :type="getPhaseType(row)" size="small">{{ getPhase(row) }}</el-tag>
      </el-table-column>
      <el-table-column label="建议" min-width="140" #default="{ row }">
        <div class="advice-cell">
          <template v-if="props.adviceLoading && !props.advice[row.FCODE]">
            <span class="loading-text">计算中...</span>
          </template>
          <template v-else>
            <div v-if="getHoldAdvice(row)" :class="getHoldAdviceClass(row)">
              持仓：{{ getHoldAdvice(row) }}
            </div>
            <div v-if="getHoldAdvice(row) && getFlatAdvice(row)" class="advice-divider">————</div>
            <div v-if="getFlatAdvice(row)" :class="getFlatAdviceClass(row)">
              空仓：{{ getFlatAdvice(row) }}
            </div>
            <span v-if="!getHoldAdvice(row) && !getFlatAdvice(row)" :class="getAdviceClass(row)">{{ getSimpleAdvice(row) }}</span>
          </template>
        </div>
      </el-table-column>
      <el-table-column label="原因" min-width="180" #default="{ row }">
        <span class="reason-cell">
          <template v-if="props.adviceLoading && !props.advice[row.FCODE]">
            <span class="loading-text">计算中...</span>
          </template>
          <template v-else>{{ getReason(row) }}</template>
        </span>
      </el-table-column>
      <el-table-column prop="GZTIME" label="更新时间" width="110" sortable />
    </el-table>

    <!-- 移动端卡片 -->
    <div v-else class="fund-cards">
      <el-card
        v-for="fund in sortedFunds"
        :key="fund.FCODE"
        class="fund-card"
        :class="{ expanded: isExpanded(fund) }"
        shadow="hover"
        @click="toggleExpand(fund)"
      >
        <!-- 标题行（始终显示，位置固定） -->
        <div class="card-title-row">
          <div class="fund-title-info">
            <span class="fund-name">{{ getFundName(fund) }}</span>
            <span class="fund-code">{{ fund.FCODE }}</span>
          </div>
          <div class="fund-change-wrap">
            <span class="fund-change" :class="getChangeClass(fund)">
              {{ formatChange(fund) }}
            </span>
            <span class="time card-collapsed-time">{{ fund.GZTIME || fund.PDATE }}</span>
          </div>
        </div>

        <!-- 展开后的详细信息 -->
        <div class="card-expand-content">
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
              <div class="advice-detail">
                <template v-if="props.adviceLoading && !props.advice[fund.FCODE]">
                  <span class="loading-text">计算中...</span>
                </template>
                <template v-else>
                  <div v-if="getHoldAdvice(fund)" :class="getHoldAdviceClass(fund)">
                    持仓：{{ getHoldAdvice(fund) }}
                  </div>
                  <div v-if="getHoldAdvice(fund) && getFlatAdvice(fund)" class="advice-divider">————</div>
                  <div v-if="getFlatAdvice(fund)" :class="getFlatAdviceClass(fund)">
                    空仓：{{ getFlatAdvice(fund) }}
                  </div>
                  <span v-if="!getHoldAdvice(fund) && !getFlatAdvice(fund)" :class="getAdviceClass(fund)">{{ getSimpleAdvice(fund) }}</span>
                </template>
              </div>
            </div>
          </div>
          <div class="card-footer">
            <span class="reason">
              <template v-if="props.adviceLoading && !props.advice[fund.FCODE]">
                <span class="loading-text">计算中...</span>
              </template>
              <template v-else>{{ getReason(fund) }}</template>
            </span>
            <span class="time">{{ fund.GZTIME || fund.PDATE }}</span>
          </div>
        </div>

        <!-- PC端：始终显示完整信息 -->
        <template v-if="!isMobile">
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
              <div class="advice-detail">
                <div v-if="getHoldAdvice(fund)" :class="getHoldAdviceClass(fund)">
                  持仓：{{ getHoldAdvice(fund) }}
                </div>
                <div v-if="getHoldAdvice(fund) && getFlatAdvice(fund)" class="advice-divider">————</div>
                <div v-if="getFlatAdvice(fund)" :class="getFlatAdviceClass(fund)">
                  空仓：{{ getFlatAdvice(fund) }}
                </div>
                <span v-if="!getHoldAdvice(fund) && !getFlatAdvice(fund)" :class="getAdviceClass(fund)">{{ getSimpleAdvice(fund) }}</span>
              </div>
            </div>
          </div>
          <div class="card-footer">
            <span class="reason">{{ getReason(fund) }}</span>
            <span class="time">{{ fund.GZTIME }}</span>
          </div>
        </template>
      </el-card>
    </div>

    <el-empty v-if="sortedFunds.length === 0" description="暂无数据" />
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  funds: { type: Array, default: () => [] },
  advice: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
  adviceLoading: { type: Boolean, default: false }
})

// 组合 loading 状态（基金数据加载中或建议计算中）
const isLoading = computed(() => props.loading || props.adviceLoading)

// 获取基金名称
function getFundName(fund) {
  const baseName = fund.SHORTNAME || fund.FCODE
  // 如果净值已更新，添加 [已更新] 标签
  if (fund.isNavUpdated) {
    return `${baseName}[已更新]`
  }
  return baseName
}

const sortKey = ref('GSZZL')
const sortAsc = ref(false)
const windowWidth = ref(window.innerWidth)
const expandedFunds = ref(new Set()) // 展开的基金
const allExpanded = ref(false) // 是否全部展开

// 当 funds 变化时重置展开状态
watch(() => props.funds, (newFunds, oldFunds) => {
  // 只在基金列表真正变化时重置（不是首次加载）
  if (oldFunds && oldFunds.length > 0 && newFunds.length !== oldFunds.length) {
    expandedFunds.value.clear()
    allExpanded.value = false
  }
}, { deep: false })

function checkMobile() {
  return windowWidth.value < 768
}

const isMobile = computed(() => checkMobile())

function toggleExpand(fund) {
  if (expandedFunds.value.has(fund.FCODE)) {
    expandedFunds.value.delete(fund.FCODE)
  } else {
    expandedFunds.value.add(fund.FCODE)
  }
  // 同步更新 allExpanded 状态
  allExpanded.value = expandedFunds.value.size === props.funds.length
}

function isExpanded(fund) {
  return expandedFunds.value.has(fund.FCODE)
}

// 一键展开所有
function expandAll() {
  props.funds.forEach(fund => {
    expandedFunds.value.add(fund.FCODE)
  })
  allExpanded.value = true
}

// 一键收起所有
function collapseAll() {
  expandedFunds.value.clear()
  allExpanded.value = false
}

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

// 获取持仓建议
function getHoldAdvice(fund) {
  const advice = props.advice[fund.FCODE]
  return advice?.metrics?.hold_action ?? ''
}

// 获取空仓建议
function getFlatAdvice(fund) {
  const advice = props.advice[fund.FCODE]
  return advice?.metrics?.flat_action ?? ''
}

// 获取简单建议（用于没有持仓/空仓区分的情况）
function getSimpleAdvice(fund) {
  const advice = props.advice[fund.FCODE]
  return advice?.action ?? '-'
}

function getAdviceClass(fund) {
  const advice = props.advice[fund.FCODE]
  const action = advice?.action
  const holdAction = advice?.metrics?.hold_action
  const flatAction = advice?.metrics?.flat_action

  // 根据主建议判断颜色
  // 清仓、减仓 → 绿色
  if (action?.includes('清仓') || action?.includes('减仓')) return 'advice-sell-green'
  // 加仓、买入 → 红色
  const buyKeywords = ['买入', '加仓', '建仓', '小仓']
  if (buyKeywords.some(k => action?.includes(k))) return 'advice-buy-red'

  // 持有、观望 → 灰色（默认）
  return 'advice-neutral'
}

// 获取持仓建议的颜色类
function getHoldAdviceClass(fund) {
  const advice = props.advice[fund.FCODE]
  const holdAction = advice?.metrics?.hold_action
  if (!holdAction) return ''

  // 清仓、减仓、减到半仓 → 绿色（卖出/降低仓位）
  if (holdAction.includes('清仓') || holdAction.includes('减')) return 'advice-sell-green'
  // 持有、观望 → 灰色
  if (holdAction.includes('持有') || holdAction.includes('观望')) return 'advice-neutral'
  // 加仓 → 红色
  if (holdAction.includes('加仓')) return 'advice-buy-red'
  return ''
}

// 获取空仓建议的颜色类
function getFlatAdviceClass(fund) {
  const advice = props.advice[fund.FCODE]
  const flatAction = advice?.metrics?.flat_action
  if (!flatAction) return ''

  // 观望 → 灰色
  if (flatAction.includes('观望')) return 'advice-neutral'
  // 买入、小仓 → 红色
  const buyKeywords = ['买入', '建仓', '小仓']
  if (buyKeywords.some(k => flatAction.includes(k))) return 'advice-buy-red'
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
  font-weight: 700;
  font-size: 16px;
  color: #1a1a1a;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  vertical-align: middle;
}

.sub-section-title::before {
  content: '';
  width: 4px;
  height: 16px;
  background: #4f46e5;
  border-radius: 2px;
  flex-shrink: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  margin-bottom: 16px;
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

/* 建议颜色方案 */
/* 清仓、减仓 → 绿色 */
.advice-sell-green {
  color: #16a34a !important;
  font-weight: 700;
  font-size: 14px;
}

/* 加仓、买入 → 红色 */
.advice-buy-red {
  color: #dc2626 !important;
  font-weight: 700;
  font-size: 14px;
}

/* 持有、观望 → 灰色 */
.advice-neutral {
  color: #6b7280 !important;
  font-weight: 600;
  font-size: 14px;
}

/* 已废弃的旧样式 */
.advice-buy {
  color: #dc2626 !important;
  font-weight: 700;
}

.advice-sell {
  color: #16a34a !important;
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

.mobile-sort {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px;
}

.mobile-sort :deep(.el-button) {
  border-radius: 10px;
}

.sort-switch-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 24px;
}

.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  height: 24px;
}

.expand-btn {
  font-size: 12px;
  color: #4f46e5;
  cursor: pointer;
  white-space: nowrap;
}

.expand-btn.disabled {
  color: #9ca3af;
  cursor: not-allowed;
}

.sort-label-text.disabled {
  color: #9ca3af;
  cursor: not-allowed;
}

.sort-label-text {
  font-size: 13px;
  color: #9ca3af;
  cursor: pointer;
  transition: color 0.2s;
}

.sort-label-text.active {
  color: #4f46e5;
  font-weight: 500;
}

.sort-switch {
  --el-switch-on-color: #4f46e5;
}

.sort-label {
  font-size: 13px;
  color: #666;
  font-weight: 500;
}

.fund-card {
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.fund-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.fund-card :deep(.el-card__body) {
  padding: 16px;
}

/* 卡片标题行（始终显示，位置固定） */
.card-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.fund-title-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.fund-title-info .fund-name {
  word-break: break-all;
}

.fund-change-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}

.card-collapsed-time {
  transition: opacity 0.3s ease;
}

.fund-card.expanded .card-collapsed-time {
  opacity: 0;
}

/* 卡片展开内容动画 */
.card-expand-content {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height 0.4s cubic-bezier(0.25, 0.8, 0.25, 1),
              opacity 0.3s ease,
              margin-top 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
  margin-top: 0;
}

.fund-card.expanded .card-expand-content {
  max-height: 300px;
  opacity: 1;
  margin-top: 12px;
}

/* PC端隐藏移动端的标题行和展开内容 */
@media (min-width: 768px) {
  .card-title-row,
  .card-expand-content {
    display: none;
  }
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

.advice-detail {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
}

.advice-divider {
  color: #9ca3af;
  font-size: 12px;
  font-weight: 400;
  line-height: 1;
}

.time {
  font-size: 11px;
  color: #9ca3af;
  white-space: nowrap;
  margin-left: 8px;
}

.loading-text {
  color: #9ca3af;
}

@media (max-width: 768px) {
  .fund-section {
    margin-top: 16px;
  }

  .sub-section-title {
    font-size: 14px;
    margin-bottom: 24px;
  }
}

/* 卡片淡入动画 - 模仿 Animate.css fadeInUp */
.fund-card {
  animation-name: fadeInUp;
  animation-duration: 0.6s;
  animation-fill-mode: both;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.fund-card:nth-child(1) { animation-delay: 0.05s; }
.fund-card:nth-child(2) { animation-delay: 0.1s; }
.fund-card:nth-child(3) { animation-delay: 0.15s; }
.fund-card:nth-child(4) { animation-delay: 0.2s; }
.fund-card:nth-child(5) { animation-delay: 0.25s; }
.fund-card:nth-child(6) { animation-delay: 0.3s; }
.fund-card:nth-child(7) { animation-delay: 0.35s; }
.fund-card:nth-child(8) { animation-delay: 0.4s; }

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translate3d(0, 20px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

/* 表格行淡入动画 */
.fund-table :deep(.el-table__row) {
  animation-name: fadeInLeft;
  animation-duration: 0.5s;
  animation-fill-mode: both;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.fund-table :deep(.el-table__row:nth-child(1)) { animation-delay: 0.05s; }
.fund-table :deep(.el-table__row:nth-child(2)) { animation-delay: 0.1s; }
.fund-table :deep(.el-table__row:nth-child(3)) { animation-delay: 0.15s; }
.fund-table :deep(.el-table__row:nth-child(4)) { animation-delay: 0.2s; }
.fund-table :deep(.el-table__row:nth-child(5)) { animation-delay: 0.25s; }
.fund-table :deep(.el-table__row:nth-child(6)) { animation-delay: 0.3s; }
.fund-table :deep(.el-table__row:nth-child(7)) { animation-delay: 0.35s; }
.fund-table :deep(.el-table__row:nth-child(8)) { animation-delay: 0.4s; }

@keyframes fadeInLeft {
  from {
    opacity: 0;
    transform: translate3d(-20px, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
</style>