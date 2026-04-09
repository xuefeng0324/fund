<template>
  <el-menu
    mode="horizontal"
    :ellipsis="false"
    class="header-menu"
  >
    <div class="header-left">
      <div class="logo">
        <el-icon><TrendCharts /></el-icon>
        <span class="title">基金监控</span>
        <span class="subtitle">实时估值 · 智能建议</span>
      </div>
    </div>
    <div class="header-right">
      <span class="current-time">{{ formatFullTime(currentTime) }}</span>
    </div>
  </el-menu>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { TrendCharts } from '@element-plus/icons-vue'

function formatFullTime(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const M = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const s = date.getSeconds().toString().padStart(2, '0')
  return `${y}-${M}-${d} ${h}:${m}:${s}`
}

const currentTime = ref(new Date())
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    currentTime.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
  }
})
</script>

<style scoped>
.header-menu {
  padding: 0 24px;
  border-bottom: 1px solid rgba(91, 97, 110, 0.2);
  background: #fff;
}

.header-left {
  flex: 1;
  display: flex;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 60px;
}

.logo :deep(.el-icon) {
  font-size: 24px;
  color: #0052ff;
}

.title {
  font-size: 18px;
  font-weight: 700;
  color: #0a0b0d;
  letter-spacing: -0.3px;
}

.subtitle {
  font-size: 12px;
  color: #0052ff;
  font-weight: 500;
  margin-left: 4px;
}

.header-right {
  display: flex;
  align-items: center;
}

.current-time {
  font-size: 13px;
  color: #5b616e;
  font-weight: 600;
  margin-right: 8px;
}

.header-right :deep(.el-menu-item) {
  height: 60px;
  line-height: 60px;
  font-size: 13px;
  color: #5b616e;
}

.header-right :deep(.el-icon) {
  margin-right: 4px;
}

@media (max-width: 768px) {
  .header-menu {
    padding: 0 16px;
  }

  .subtitle {
    display: none;
  }

  .title {
    font-size: 16px;
  }

  .current-time {
    font-size: 12px;
  }

  .header-right :deep(.el-menu-item) {
    display: none;
  }
}

@media (max-width: 480px) {
  .header-menu {
    padding: 0 12px;
  }

  .logo :deep(.el-icon) {
    font-size: 20px;
  }

  .title {
    font-size: 15px;
  }

  .header-right :deep(.el-menu-item) {
    font-size: 12px;
    padding: 0 12px;
  }
}
</style>