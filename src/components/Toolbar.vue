<template>
  <div class="toolbar">
    <div class="toolbar-row">
      <el-input
        v-model="localKeyword"
        placeholder="搜索代码/名称"
        class="search-input"
        clearable
        @input="onSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>

      <el-button
        type="primary"
        :loading="isLoading"
        :disabled="isLoading"
        @click="$emit('refresh')"
      >
        {{ isLoading ? '更新中' : '更新' }}
      </el-button>

      <!-- PC端更新时间 -->
      <span v-if="lastUpdate && !isLoading" class="update-time pc-update-time">{{ formatTime(lastUpdate) }}</span>
    </div>

    <div class="toolbar-row">
      <div class="key-input-wrapper">
        <el-input
          v-model="localKey"
          placeholder="密钥"
          class="key-input"
          clearable
          @change="onKeyChange"
          @clear="onKeyClear"
          @keyup.enter="onKeyChange"
        >
          <template #prefix>
            <el-icon><Key /></el-icon>
          </template>
        </el-input>
      </div>

      <el-button
        v-if="showManageBtn"
        @click="$emit('manage')"
      >
        <el-icon><Setting /></el-icon>
        管理基金
      </el-button>

      <div class="view-switch">
        <span
          :class="['switch-label', { active: !showAll, disabled: isLoading || !validKey }]"
          @click="handleSwitchClick(false)"
        >
          看自己
        </span>
        <el-switch
          v-model="showAll"
          :disabled="isLoading || !validKey"
          @change="handleSwitchChange"
        />
        <span
          :class="['switch-label', { active: showAll, disabled: isLoading || !validKey }]"
          @click="handleSwitchClick(true)"
        >
          看全部
        </span>
      </div>
    </div>

    <div v-if="lastUpdate && !isLoading" class="toolbar-row">
      <span class="update-time">{{ formatTime(lastUpdate) }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { Search, Refresh, Setting, Key } from '@element-plus/icons-vue'

const props = defineProps({
  keyValue: { type: String, default: '' },
  validKey: { type: String, default: '' },
  showAll: { type: Boolean, default: true },
  lastUpdate: { type: Date, default: null },
  loading: { type: Boolean, default: false },
  adviceLoading: { type: Boolean, default: false }
})

const emit = defineEmits(['update:keyValue', 'update:showAll', 'refresh', 'manage', 'search'])

const localKeyword = ref('')
const localKey = ref(props.keyValue)

// showAll 从 props 获取，与父组件同步
const showAll = computed({
  get: () => props.showAll,
  set: (val) => emit('update:showAll', val)
})

const showManageBtn = computed(() => !!props.validKey)

// 按钮是否处于加载状态（基金数据加载中或建议计算中）
const isLoading = computed(() => props.loading || props.adviceLoading)

// 标记是否正在切换视图模式（避免 watch 清除密钥）
let isSwitchingView = false

watch(() => props.keyValue, (val) => {
  if (isSwitchingView) return
  localKey.value = val
})

// switch 变化时触发
function handleSwitchChange(val) {
  if (isLoading.value || !props.validKey) {
    // 如果正在 loading 或没有有效密钥，恢复 switch 状态
    showAll.value = !val
    return
  }

  // 先更新本地状态
  showAll.value = val

  isSwitchingView = true
  if (val) {
    // 切换到全部
    emit('update:showAll', true)
    emit('update:keyValue', '')
  } else {
    // 切换到自己
    emit('update:showAll', false)
    if (localKey.value.trim()) {
      emit('update:keyValue', localKey.value.trim())
    }
  }

  // 延迟后触发刷新
  setTimeout(() => {
    isSwitchingView = false
    // 切换后自动刷新数据
    emit('refresh')
  }, 0)
}

// 点击文字切换
function handleSwitchClick(val) {
  if (isLoading.value || !props.validKey) return
  // 如果值没变，不做处理
  if (showAll.value === val) return
  handleSwitchChange(val)
}

function onSearch() {
  emit('search', localKeyword.value.trim())
}

function onKeyChange() {
  const val = localKey.value.trim()
  emit('update:keyValue', val)
}

function onKeyClear() {
  // 清空密钥，由父组件 watch 处理切换到"看全部"并刷新
  emit('update:keyValue', '')
}

function formatTime(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  const h = date.getHours().toString().padStart(2, '0')
  const min = date.getMinutes().toString().padStart(2, '0')
  return `更新时间：${y}-${m}-${d} ${h}:${min}`
}
</script>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
}

.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.search-input {
  width: 180px;
}

.key-input-wrapper {
  width: 140px;
}

.view-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.switch-label {
  font-size: 14px;
  color: #9ca3af;
  cursor: pointer;
  transition: color 0.2s;
}

.switch-label.active {
  color: #4f46e5;
  font-weight: 500;
}

.switch-label.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.update-time {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
  margin-left: 8px;
}

.toolbar :deep(.el-button) {
  border-radius: 10px;
}

.toolbar :deep(.el-button .is-loading) {
  animation: rotating 1.5s linear infinite;
}

.is-loading-btn {
  cursor: wait;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.toolbar :deep(.el-input__wrapper) {
  border-radius: 10px;
}

.toolbar :deep(.el-select .el-input__wrapper) {
  border-radius: 10px;
}

/* PC端隐藏第三行更新时间 */
@media (min-width: 769px) {
  .toolbar-row:last-child .update-time:not(.pc-update-time) {
    display: none;
  }
}

@media (max-width: 768px) {
  .toolbar {
    gap: 10px;
    padding: 12px 0;
  }

  .toolbar-row {
    gap: 8px;
  }

  .search-input {
    width: 140px;
  }

  .key-input-wrapper {
    width: 100px;
  }

  /* 隐藏PC端更新时间，显示移动端第三行 */
  .pc-update-time {
    display: none;
  }

  /* 移动端第三行更新时间样式 */
  .toolbar-row:last-child .update-time:not(.pc-update-time) {
    display: block;
    width: 100%;
    font-size: 14px;
    font-weight: 600;
    margin-top: 4px;
    text-align: left;
  }
}

@media (max-width: 480px) {
  .toolbar {
    gap: 8px;
    padding: 10px 0;
  }

  .toolbar-row {
    gap: 6px;
  }

  .search-input,
  .key-input-wrapper {
    flex: 1;
    min-width: 80px;
    width: auto;
  }
}
</style>