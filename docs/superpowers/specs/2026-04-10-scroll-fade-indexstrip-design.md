---
name: scroll-fade-indexstrip
description: 实现滚动时 IndexStrip 透明化效果，当页面下滑时指数数据区域逐渐透明，直到表格顶部接触 sticky header 时完全透明
type: project
created: 2026-04-10
---

# IndexStrip 滚动透明化效果设计

## 概述

当页面向下滚动时，IndexStrip（指数数据区域）逐渐透明化，直到"实时估值基金"表格的顶部接近/接触 sticky header 区域时完全透明。向上滚动时效果相反。

## 需求参数

| 参数 | 值 |
|------|-----|
| 透明范围 | opacity 0（完全透明）到 1（完全可见） |
| 淡出起始距离 | 动态计算（IndexStrip 高度 + 50px 缓冲） |
| 完全透明触发点 | 表格顶部接触 sticky header 底部（distance = 0） |
| 移动端 | 同样启用效果 |

## 架构设计

### 数据流

```
App.vue                           IndexStrip.vue
├─ onScroll()                     ├─ :opacity prop
├─ calculateOpacity()         ──► └─ :style="{ opacity }"
├─ indexStripOpacity ref          ├─ CSS transition
```

### 变更文件

- `App.vue`: 添加滚动监听逻辑、opacity 状态管理、元素引用
- `IndexStrip.vue`: 接收 opacity prop 并应用样式

## 实现细节

### 1. 滚动事件处理

使用 `requestAnimationFrame` 包装滚动回调，防止同一帧内多次触发计算：

```javascript
let ticking = false
let rafId = null

function onScroll() {
  if (!ticking) {
    rafId = requestAnimationFrame(() => {
      calculateOpacity()
      ticking = false
    })
    ticking = true
  }
}

// 使用 passive: true 提升滚动性能
window.addEventListener('scroll', onScroll, { passive: true })
```

### 2. 位置计算与缓动

使用 `getBoundingClientRect` 获取元素位置，应用 ease-out cubic 缓动函数：

```javascript
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

function calculateOpacity() {
  if (!stickyHeaderEl.value || !fundTableEl.value) return

  const headerBottom = stickyHeaderEl.value.getBoundingClientRect().bottom
  const tableTop = fundTableEl.value.getBoundingClientRect().top

  const distance = tableTop - headerBottom
  const fadeDistance = getFadeDistance()

  // 进度映射: distance 从 fadeDistance 到 0，progress 从 1 到 0
  let progress = Math.min(Math.max(distance / fadeDistance, 0), 1)

  // 应用 ease-out 缓动
  const newOpacity = easeOutCubic(progress)

  // 只有值变化超过阈值才更新，避免频繁触发响应式更新
  if (Math.abs(newOpacity - opacity.value) > 0.01) {
    opacity.value = newOpacity
  }
}
```

### 3. 动态 Fade Distance 计算

基于 IndexStrip 高度动态计算淡出起始距离：

```javascript
function getFadeDistance() {
  const indexStripEl = stickyHeaderEl.value?.querySelector('.index-strip')
  if (!indexStripEl) return 200 // 默认值

  const stripHeight = indexStripEl.offsetHeight
  return stripHeight + 50 // IndexStrip 高度 + 缓冲
}
```

### 4. 抖动预防

- 缓存元素引用，避免每次 scroll 都查询 DOM
- 只有 opacity 变化超过阈值（0.01）才触发响应式更新
- CSS transition 确保视觉平滑过渡：

```css
.index-strip {
  transition: opacity 0.15s ease-out;
}
```

### 5. IndexStrip 组件变更

接收 opacity prop 并应用：

```vue
<script setup>
defineProps({
  data: { type: Array, default: () => [] },
  opacity: { type: Number, default: 1 }
})
</script>

<template>
  <div class="index-strip" :style="{ opacity: opacity }">
    ...
  </div>
</template>
```

### 6. 初始化与清理

页面加载时如果已在 fade zone 内，需正确初始化 opacity：

```javascript
onMounted(() => {
  // 获取元素引用
  stickyHeaderEl.value = document.querySelector('.sticky-header')
  fundTableEl.value = document.querySelector('.fund-section')

  // 初始化 opacity（当前滚动位置）
  calculateOpacity()

  // 添加滚动监听
  window.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  if (rafId) cancelAnimationFrame(rafId)
})
```

## 测试场景

| 场景 | 验证内容 |
|------|---------|
| 初始状态 | IndexStrip opacity = 1，完全可见 |
| 向下滚动开始 | 表格进入 fade zone，opacity 开始下降 |
| 滚动到接触 | 表格顶部接触 sticky header，opacity = 0 |
| 向上滚动 | opacity 恢复，反向过程平滑 |
| 快速滚动 | 无抖动、无跳跃，CSS transition 平滑过渡 |
| 移动端 | 触摸滚动效果同样平滑 |
| 窗口 resize | fade distance 动态更新 |
| 页面刷新后 | 如果已在 fade zone 内，opacity 正确初始化 |

## 边界情况

- **表格数据加载中**: 正常工作，表格高度变化时动态适应
- **多个 FundTable**: 只参考第一个（"实时估值基金"）
- **元素不存在**: 使用默认值，避免报错

## 技术选型理由

选择 `requestAnimationFrame` 方案：
- 兼容性最好，所有浏览器支持
- 平滑度最佳，与浏览器渲染帧同步
- 精确控制 opacity 线性变化
- 容易处理抖动问题
- Vue 项目中已有类似的滚动监听经验