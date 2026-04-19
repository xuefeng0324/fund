# 基金实时估值按买入确认日分组显示设计

## 概述

将基金实时估值数据按买入确认日（T+N）分组显示，每个分组对应一个可折叠的 FundTable 表格。

## 需求梳理

| 项目 | 说明 |
|------|------|
| 数据源 | `fund_info.json` 中的 `buy_confirm_date` 字段 |
| 分组规则 | 按 `buy_confirm_date` 值分组（1=T+1, 2=T+2, ...） |
| 无记录基金 | 归为"未知"组，显示在最后 |
| 折叠功能 | 表格标题可点击折叠/展开，刷新后全部展开 |
| 持久化 | 无需持久化 |

## UI 设计

```
┌─────────────────────────────────────┐
│ ▼ 基金实时估值（T+1）          [▼] │
├─────────────────────────────────────┤
│ 基金代码 │ 名称 │ 估值 │ 涨跌幅 │...│
├─────────────────────────────────────┤
│ 006328  │ xxx  │ 1.2  │ +2.5%  │...│
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ ▶ 基金实时估值（T+2）          [▶] │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ ▶ 基金实时估值（未知）         [▶] │
└─────────────────────────────────────┘
```

## 实现方案

### 架构设计

修改 `App.vue`，根据 `buy_confirm_date` 将基金分组，渲染多个 `<FundTable>` 组件。

### 文件变更

| 文件 | 变更内容 |
|------|----------|
| `src/App.vue` | 分组逻辑 + 渲染多个 FundTable |
| `src/components/FundTable.vue` | 支持折叠功能 |

### 分组逻辑

1. 读取 `fund_info.json` 构建 `{ fund_code: buy_confirm_date }` 映射
2. 遍历基金，按 `buy_confirm_date` 分组
3. 无记录基金归为"未知"组
4. 按 `buy_confirm_date` 值排序（1, 2, 3, ..., 未知）

### 数据结构

```javascript
const fundGroups = {
  1: [ /* T+1 基金列表 */ ],
  2: [ /* T+2 基金列表 */ ],
  'unknown': [ /* 无记录基金列表 */ ]
}
```

### 折叠功能实现

- FundTable 组件新增 `collapsible` props（默认 false 保持兼容）
- 组件内部维护 `collapsed` ref 状态
- 标题区域添加点击事件切换折叠状态
- 折叠时只显示标题栏，内容区域 v-show="!collapsed"

### FundTable Props 变更

```typescript
interface FundTableProps {
  // 现有 props...
  title: string
  funds: Fund[]
  advice: AdviceData
  loading: boolean
  adviceLoading: boolean

  // 新增 props
  collapsible?: boolean  // 是否可折叠，默认 false
  defaultCollapsed?: boolean  // 默认折叠状态，默认 false
}
```

## 组件变更

### FundTable.vue

```vue
<template>
  <div class="fund-table-container">
    <div class="table-header" @click="toggleCollapse" v-if="collapsible">
      <span class="collapse-icon">{{ collapsed ? '▶' : '▼' }}</span>
      <h3>{{ title }}</h3>
    </div>
    <h3 v-else>{{ title }}</h3>

    <el-table v-show="!collapsed" :data="funds" ...>
      ...
    </el-table>
  </div>
</template>

<script setup>
const props = defineProps({
  // ... existing props
  collapsible: { type: Boolean, default: false },
  defaultCollapsed: { type: Boolean, default: false }
})

const collapsed = ref(props.defaultCollapsed)
const toggleCollapse = () => { collapsed.value = !collapsed.value }
</script>
```

### App.vue

```vue
<template>
  <FundTable
    v-for="(funds, dateKey) in groupedFunds"
    :key="dateKey"
    :title="getTableTitle(dateKey)"
    :funds="funds"
    :collapsible="true"
    :default-collapsed="false"
    :advice="adviceData"
    :loading="loading"
    :advice-loading="adviceLoading"
  />
</template>

<script setup>
const groupedFunds = computed(() => {
  const groups = {}
  for (const fund of allFunds.value) {
    const dateKey = fundInfoMap[fund.code] ?? 'unknown'
    if (!groups[dateKey]) groups[dateKey] = []
    groups[dateKey].push(fund)
  }
  return groups
})

const getTableTitle = (dateKey) => {
  if (dateKey === 'unknown') return '基金实时估值（未知）'
  return `基金实时估值（T+${dateKey}）`
}
</script>
```

## 样式调整

- 折叠图标样式与标题对齐
- 折叠状态下的标题栏添加 hover 效果
- 多个表格之间保持适当间距

## 风险与限制

| 风险 | 说明 | 应对 |
|------|------|------|
| fund_info.json 加载时机 | 需要在分组前加载完成 | 确保配置加载后再渲染表格 |
| 性能问题 | 基金数量很多时分组计算开销 | 使用 computed 缓存分组结果 |
