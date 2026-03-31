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

      <el-select v-model="localSourceMode" class="source-select" placeholder="数据源">
        <el-option label="自动" value="auto" />
        <el-option label="fundgz" value="fundgz" />
        <el-option label="东财" value="em" />
      </el-select>

      <el-button
        type="primary"
        :loading="loading"
        @click="$emit('refresh')"
      >
        <el-icon v-if="!props.loading"><Refresh /></el-icon>
        {{ props.loading ? '刷新中' : '刷新' }}
      </el-button>

      <!-- PC端更新时间 -->
      <span v-if="lastUpdate && !props.loading" class="update-time pc-update-time">{{ formatTime(lastUpdate) }}</span>
    </div>

    <div class="toolbar-row">
      <div class="key-input-wrapper">
        <el-input
          v-model="localKey"
          placeholder="密钥"
          class="key-input"
          clearable
          @change="onKeyChange"
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
          :class="['switch-label', { active: !showAll, disabled: props.loading }]"
          @click="handleSwitchClick(false)"
        >
          看自己
        </span>
        <el-switch
          v-model="showAll"
          :disabled="props.loading"
          @change="handleSwitchChange"
        />
        <span
          :class="['switch-label', { active: showAll, disabled: props.loading }]"
          @click="handleSwitchClick(true)"
        >
          看全部
        </span>
      </div>
    </div>

    <div v-if="lastUpdate && !props.loading" class="toolbar-row">
      <span class="update-time">{{ formatTime(lastUpdate) }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { Search, Refresh, Setting, Key } from '@element-plus/icons-vue'

const props = defineProps({
  keyValue: { type: String, default: '' },
  sourceMode: { type: String, default: 'auto' },
  validKey: { type: String, default: '' },
  showAll: { type: Boolean, default: true },
  lastUpdate: { type: Date, default: null },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['update:keyValue', 'update:sourceMode', 'update:showAll', 'refresh', 'manage', 'search'])

const localSourceMode = ref(props.sourceMode)
const localKeyword = ref('')
const localKey = ref(props.keyValue)

// showAll 从 props 获取，与父组件同步
const showAll = computed({
  get: () => props.showAll,
  set: (val) => emit('update:showAll', val)
})

const showManageBtn = computed(() => !!props.validKey)

watch(() => props.sourceMode, (val) => {
  localSourceMode.value = val
})

watch(localSourceMode, (val) => {
  emit('update:sourceMode', val)
})

// 标记是否正在切换视图模式（避免 watch 清除密钥）
let isSwitchingView = false

watch(() => props.keyValue, (val) => {
  if (isSwitchingView) return
  localKey.value = val
})

// switch 变化时触发
function handleSwitchChange(val) {
  if (props.loading) {
    // 如果正在 loading，恢复 switch 状态
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
  if (props.loading) return
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

.source-select {
  width: 110px;
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

.toolbar :deep(.el-input__wrapper) {
  border-radius: 10px;
}

.toolbar :deep(.el-select .el-input__wrapper) {
  border-radius: 10px;
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

  .source-select {
    width: 90px;
  }

  .key-input-wrapper {
    width: 100px;
  }

  /* 隐藏PC端更新时间，显示移动端第三行 */
  .pc-update-time {
    display: none;
  }

  .toolbar-row:not(:only-child) .update-time {
    display: none;
  }

  .toolbar-row:only-child .update-time {
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
  .source-select,
  .key-input-wrapper {
    flex: 1;
    min-width: 80px;
    width: auto;
  }
}
</style>