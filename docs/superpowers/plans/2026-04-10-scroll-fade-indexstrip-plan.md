# IndexStrip 滚动透明化效果实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现页面滚动时 IndexStrip 组件平滑透明化，直到表格顶部接触 sticky header 时完全透明

**Architecture:** App.vue 监听滚动事件，使用 requestAnimationFrame 计算 opacity 并传递给 IndexStrip；IndexStrip 接收 opacity prop 并应用样式

**Tech Stack:** Vue 3 Composition API, requestAnimationFrame, CSS transition

---

## File Structure

| 文件 | 变更 | 职责 |
|------|------|------|
| `src/App.vue` | Modify | 滚动监听、opacity 计算、元素引用 |
| `src/components/IndexStrip.vue` | Modify | 接收 opacity prop、应用样式 |

---

## Task 1: IndexStrip 接收 opacity prop

**Files:**
- Modify: `src/components/IndexStrip.vue`

- [ ] **Step 1: 添加 opacity prop 定义**

修改 `IndexStrip.vue` 的 script setup 部分，添加 opacity prop：

```vue
<script setup>
defineProps({
  data: {
    type: Array,
    default: () => []
  },
  opacity: {
    type: Number,
    default: 1
  }
})

// ... 其他函数保持不变
</script>
```

- [ ] **Step 2: 应用 opacity 到 .index-strip 元素**

修改 `IndexStrip.vue` 的 template，将 opacity 应用到根元素：

```vue
<template>
  <div class="index-strip" :style="{ opacity: opacity }">
    <div class="index-strip-inner">
      <!-- ... 保持不变 -->
    </div>
  </div>
</template>
```

- [ ] **Step 3: 添加 CSS transition 确保平滑过渡**

在 `IndexStrip.vue` 的 `<style scoped>` 中，修改 `.index-strip` 样式：

```css
.index-strip {
  display: flex;
  justify-content: center;
  padding: 12px 32px;
  background: #fff;
  border-bottom: 1px solid rgba(91, 97, 110, 0.2);
  box-sizing: border-box;
  transition: opacity 0.15s ease-out;
}
```

- [ ] **Step 4: 验证组件仍正常工作**

启动开发服务器验证 IndexStrip 组件渲染正常：

```bash
npm run dev
```

预期：IndexStrip 正常显示，opacity 默认为 1

- [ ] **Step 5: 提交变更**

```bash
git add src/components/IndexStrip.vue
git commit -m "feat: IndexStrip 组件添加 opacity prop 支持"
```

---

## Task 2: App.vue 添加滚动监听状态和元素引用

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: 添加 opacity 状态和元素引用**

在 `App.vue` 的 `<script setup>` 中，在现有状态变量后添加：

```javascript
// 滚动透明化相关状态
const indexStripOpacity = ref(1)
let ticking = false
let rafId = null
const stickyHeaderEl = ref(null)
const fundTableEl = ref(null)
```

确保从 Vue 导入 ref：

```javascript
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
```

- [ ] **Step 2: 添加 easeOutCubic 缓动函数**

在 `<script setup>` 中添加缓动函数定义（放在状态变量之后）：

```javascript
// 缓动函数：ease-out cubic
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}
```

- [ ] **Step 3: 添加 getFadeDistance 函数**

添加动态计算淡出距离的函数：

```javascript
// 动态计算淡出起始距离（基于 IndexStrip 高度）
function getFadeDistance() {
  const indexStripEl = stickyHeaderEl.value?.querySelector('.index-strip')
  if (!indexStripEl) return 200 // 默认值

  const stripHeight = indexStripEl.offsetHeight
  return stripHeight + 50 // IndexStrip 高度 + 缓冲
}
```

- [ ] **Step 4: 提交变更**

```bash
git add src/App.vue
git commit -m "feat: 添加滚动透明化状态变量和缓动函数"
```

---

## Task 3: App.vue 实现 calculateOpacity 函数

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: 实现 calculateOpacity 函数**

在 `getFadeDistance` 函数后添加 opacity 计算函数：

```javascript
// 计算并更新 IndexStrip opacity
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
  if (Math.abs(newOpacity - indexStripOpacity.value) > 0.01) {
    indexStripOpacity.value = newOpacity
  }
}
```

- [ ] **Step 2: 提交变更**

```bash
git add src/App.vue
git commit -m "feat: 实现 calculateOpacity 函数计算滚动透明度"
```

---

## Task 4: App.vue 实现滚动监听和生命周期管理

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: 实现滚动处理函数**

在 `calculateOpacity` 函数后添加滚动处理函数：

```javascript
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
```

- [ ] **Step 2: 在 onMounted 中初始化元素引用和滚动监听**

修改现有的 `onMounted` 函数，在 `loadConfig()` 之后添加滚动监听初始化：

找到现有的 `onMounted` 块（约第 202-226 行），修改为：

```javascript
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
  fundTableEl.value = document.querySelector('.fund-section')

  // 初始化 opacity（当前滚动位置）
  calculateOpacity()

  // 添加滚动监听
  window.addEventListener('scroll', onScroll, { passive: true })
})
```

- [ ] **Step 3: 在 onUnmounted 中清理滚动监听**

修改现有的 `onUnmounted` 函数（约第 228-234 行），添加滚动监听清理：

```javascript
// 组件卸载时清理定时器和滚动监听
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
```

- [ ] **Step 4: 提交变更**

```bash
git add src/App.vue
git commit -m "feat: 添加滚动监听逻辑，传递 progress 给 IndexStrip"
```

---

## Task 5: App.vue 将 opacity 传递给 IndexStrip

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: 修改 IndexStrip 组件调用，传递 opacity prop**

在 `<template>` 中找到 `<IndexStrip>` 组件调用（约第 5 行），添加 opacity prop：

```vue
<div class="sticky-header">
  <Header />
  <IndexStrip :data="indexData" :opacity="indexStripOpacity" />
</div>
```

- [ ] **Step 2: 验证完整功能**

启动开发服务器并测试滚动效果：

```bash
npm run dev
```

测试步骤：
1. 打开浏览器访问应用
2. 向下滚动页面，观察 IndexStrip 是否逐渐透明
3. 滚动到表格顶部接近 sticky header，观察是否完全透明
4. 向上滚动，观察是否恢复正常

预期：滚动时 IndexStrip 平滑透明化，无抖动

- [ ] **Step 3: 提交变更**

```bash
git add src/App.vue
git commit -m "feat: IndexStrip 接收并应用滚动计算的 opacity"
```

---

## Task 6: 最终验证和优化

**Files:**
- None (验证和测试)

- [ ] **Step 1: 测试移动端效果**

在浏览器中使用响应式设计模式（F12 -> Toggle device toolbar），选择移动端尺寸测试：

测试内容：
- 触摸滚动效果是否平滑
- 动态 fade distance 是否正确计算（IndexStrip 高度变化时）

- [ ] **Step 2: 测试边界情况**

测试以下边界情况：

1. **页面刷新后位置保持**: 刷新页面后如果滚动位置在 fade zone 内，opacity 应正确初始化
2. **快速滚动**: 快速上下滚动，确认无抖动、CSS transition 平滑过渡
3. **窗口 resize**: 改变窗口大小，确认 fade distance 动态更新
4. **数据加载中**: 表格数据加载时，opacity 计算不应报错

- [ ] **Step 3: 最终功能确认**

确认所有需求已实现：

| 需求 | 状态 |
|------|------|
| opacity 范围 0-1 | ✅ |
| 淡出起始距离动态计算 | ✅ |
| 完全透明时表格接触 header | ✅ |
| ease-out cubic 缓动 | ✅ |
| 移动端启用 | ✅ |
| 抖动预防（RAF + threshold + CSS transition） | ✅ |

- [ ] **Step 4: 完成实现**

无需额外提交，功能已完成。

---

## Summary

共 6 个任务，每个任务包含多个 bite-sized 步骤：

1. **Task 1**: IndexStrip 接收 opacity prop 并应用样式
2. **Task 2**: App.vue 添加状态变量和缓动函数
3. **Task 3**: 实现 calculateOpacity 函数
4. **Task 4**: 实现滚动监听和生命周期管理
5. **Task 5**: 将 opacity 传递给 IndexStrip
6. **Task 6**: 最终验证和测试