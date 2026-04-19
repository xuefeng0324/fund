# 基金实时估值按买入确认日分组显示实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将基金实时估值数据按买入确认日（T+N）分组显示，每个分组对应一个可折叠的 FundTable 表格。

**Architecture:** 修改 `useConfig.js` 导入 `fund_info.json` 并构建 `fundInfoMap`；修改 `FundTable.vue` 支持折叠功能；修改 `App.vue` 按 `buy_confirm_date` 分组渲染多个 FundTable。

**Tech Stack:** Vue 3 Composition API, Element Plus

---

## 文件结构

```
src/
├── composables/
│   └── useConfig.js     ← 新增 fund_info.json 导入和 fundInfoMap
├── components/
│   └── FundTable.vue    ← 新增 collapsible props 和折叠功能
└── App.vue              ← 新增分组逻辑和多个 FundTable 渲染
```

---

## Task 1: 修改 useConfig.js 添加 fundInfoMap

**Files:**
- Modify: `src/composables/useConfig.js`

- [ ] **Step 1: 添加 fund_info.json 导入**

在文件顶部添加：
```javascript
import fundInfoData from '../../public/config/fund_info.json'
```

- [ ] **Step 2: 添加 fundInfoMap ref**

在 `useConfig()` 函数内添加：
```javascript
// 基金代码 → 买入确认日映射
const fundInfoMap = computed(() => {
  const map = {}
  if (Array.isArray(fundInfoData)) {
    fundInfoData.forEach(item => {
      if (item.fund_code) {
        map[item.fund_code] = item.buy_confirm_date
      }
    })
  }
  return map
})
```

- [ ] **Step 3: 在 return 中导出 fundInfoMap**

```javascript
return {
  fundCodes,
  fundGroups,
  fundInfoMap,  // 新增
  configSha,
  loading,
  error,
  loadConfig,
  loadConfigFromGitHub
}
```

- [ ] **Step 4: 提交**

```bash
git add src/composables/useConfig.js
git commit -m "feat: add fundInfoMap from fund_info.json"
```

---

## Task 2: 修改 FundTable.vue 添加折叠功能

**Files:**
- Modify: `src/components/FundTable.vue`

- [ ] **Step 1: 添加 collapsible 和 defaultCollapsed props**

在 `defineProps` 中添加：
```javascript
collapsible: { type: Boolean, default: false },
defaultCollapsed: { type: Boolean, default: false }
```

- [ ] **Step 2: 添加折叠状态 ref**

```javascript
const collapsed = ref(props.defaultCollapsed)
const toggleCollapse = () => { collapsed.value = !collapsed.value }
```

- [ ] **Step 3: 修改模板支持折叠**

在标题区域添加折叠图标和点击事件：
```vue
<div class="section-header">
  <div class="sub-section-title" @click="toggleCollapse" :style="{ cursor: props.collapsible ? 'pointer' : 'default' }">
    <span v-if="props.collapsible" class="collapse-icon">{{ collapsed ? '▶' : '▼' }}</span>
    {{ title }}
  </div>
  <!-- 现有功能按钮保持不变 -->
</div>
```

表格内容区域添加 v-show：
```vue
<el-table
  v-if="!isMobile"
  v-show="!collapsed"
  :data="sortedFunds"
  ...
>
```

移动端卡片同样添加：
```vue
<div v-else v-show="!collapsed" class="fund-cards">
```

- [ ] **Step 4: 添加折叠图标样式**

```css
.collapse-icon {
  margin-right: 8px;
  font-size: 12px;
  color: #5b616e;
}
```

- [ ] **Step 5: 提交**

```bash
git add src/components/FundTable.vue
git commit -m "feat: add collapsible feature to FundTable"
```

---

## Task 3: 修改 App.vue 实现分组逻辑

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: 从 useConfig 解构 fundInfoMap**

```javascript
const { fundCodes, fundGroups, fundInfoMap, loadConfig } = useConfig()
```

- [ ] **Step 2: 添加 groupedFunds computed**

```javascript
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
```

- [ ] **Step 3: 修改模板渲染多个 FundTable**

将单个 FundTable 替换为：
```vue
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
```

- [ ] **Step 4: 提交**

```bash
git add src/App.vue
git commit -m "feat: group funds by buy_confirm_date and render multiple collapsible FundTables"
```

---

## Task 4: 测试和验证

**Files:**
- None (verification only)

- [ ] **Step 1: 本地运行验证**

```bash
npm run dev
```

验证：
- [ ] 页面显示多个表格（T+1、T+2、未知）
- [ ] 点击标题可以折叠/展开表格
- [ ] 刷新后所有表格默认展开
- [ ] 基金正确分组

- [ ] **Step 2: 构建验证**

```bash
npm run build
```

- [ ] **Step 3: 推送到远程**

```bash
git push origin lyl-dev-claude
```

---

## 验证清单

- [ ] `fundInfoMap` 正确导入 fund_info.json
- [ ] FundTable 支持 collapsible 和 defaultCollapsed props
- [ ] App.vue 按 buy_confirm_date 分组渲染
- [ ] 折叠功能正常工作
- [ ] 本地 dev 和 build 均正常
