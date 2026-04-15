# 基金监控项目 - 数据来源与字段计算文档

## 1. 项目概述

**项目名称**: Fund Monitor (基金实时监控面板)
**技术栈**: Vue 3 + Vite + Element Plus
**类型**: 纯前端单页应用 (SPA)，无后端服务器
**部署**: GitHub Pages

---

## 2. 数据来源 (APIs)

### 2.1 基金实时估值 - fundgz.1234567.com.cn

| 属性 | 值 |
|------|-----|
| **Endpoint** | `https://fundgz.1234567.com.cn/js/{code}.js?rt={timestamp}` |
| **请求方式** | JSONP (回调函数 `window.jsonpgz`) |
| **用途** | 获取基金实时估算净值和涨跌幅 |

**返回字段**:

| 字段 | 说明 |
|------|------|
| `fundcode` | 基金代码 |
| `name` | 基金名称 |
| `gsz` | 估算净值 (Estimated NAV) |
| `gszzl` | 估算涨跌幅 (Estimated Change %) |
| `dwjz` | 上日净值 (Previous Day NAV) |
| `gztime` | 估算时间 |

**请求策略**:
- 150ms 队列延迟避免并发限制 (514 错误)
- 单次请求超时 10 秒

---

### 2.2 历史净值趋势 - fund.eastmoney.com

| 属性 | 值 |
|------|-----|
| **Endpoint** | `https://fund.eastmoney.com/pingzhongdata/{code}.js` |
| **请求方式** | 动态 `<script>` 标签注入 |
| **用途** | 获取历史净值数据，用于 KDJ、均线等技术指标计算 |

**返回数据** (全局变量 `Data_netWorthTrend`):

```javascript
[{
  x: "2024-01-15",  // 日期
  y: 1.2345,       // 单位净值
  equityReturn: 1.5  // 日涨跌幅 (%)
}]
```

**重试策略**: 最多 3 次重试，间隔 100ms

---

### 2.3 指数实时行情 - push2.eastmoney.com

| 属性 | 值 |
|------|-----|
| **Endpoint** | `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,1.000300,0.399001,0.399006&fields=f2,f3,f4,f12,f14&cb={callback}` |
| **请求方式** | JSONP |
| **用途** | 获取 4 大指数实时快照 |

**监控的指数**:

| 代码 | 名称 |
|------|------|
| 1.000001 | 上证指数 |
| 1.000300 | 沪深 300 |
| 0.399001 | 深证成指 |
| 0.399006 | 创业板指 |

**返回字段**:

| 字段 | 说明 |
|------|------|
| `f2` | 当前价格 |
| `f3` | 涨跌幅 (%) |
| `f4` | 涨跌额 |
| `f12` | 指数代码 |
| `f14` | 指数名称 |

---

### 2.4 配置存储 - GitHub API

| 属性 | 值 |
|------|-----|
| **Base URL** | `https://api.github.com/repos/xuefeng0324/fund/contents/` |
| **分支** | `lyl-dev-claude` |
| **用途** | 存储基金分组配置 |

**管理的配置文件**:
- `public/config/fund_groups.json` - 基金分组配置
- `public/config/fund_codes.json` - 基金代码列表

**更新机制**: SHA-based 并发控制，防止更新冲突

---

## 3. 配置数据结构

### 3.1 fund_groups.json

```json
{
  "pxf": ["025209", "001595", "007467", ...],
  "lun": ["012414", "006328", "012847", ...]
}
```

- **Key** (`pxf`, `lun`) 作为访问密钥，用于区分不同基金组
- 所有基金代码通过合并、去重所有分组获得

---

## 4. 字段计算逻辑

### 4.1 技术指标计算 (src/utils/kdj.js)

#### 4.1.1 移动平均线 (MA)

```javascript
movingAverage(values, window)
```

- **MA30**: 30 日简单移动平均
- **MA60**: 60 日简单移动平均
- 用于判断趋势方向和支撑/压力位

#### 4.1.2 KDJ 指标

```javascript
computeKDJ(closes, n = 9)
```

- **n**: RSV 计算周期 (默认 9 日)
- **K 值**: 快速随机指标
- **D 值**: 慢速随机指标
- **J 值**: 3×K - 2×D

#### 4.1.3 周线聚合

```javascript
groupWeeklyLast(daily)
```

- 按 ISO 周聚合日线数据
- 取每周最后一个交易日的净值作为周线数据
- 用于长周期趋势判断

#### 4.1.4 死叉检测

```javascript
checkDeadCross(ma30List, ma60List)
```

- **死叉条件**: MA30 下穿 MA60 (MA30 < MA60)
- **触发**: 周线 KDJ 死叉确认趋势转空

#### 4.1.5 主升浪检测

```javascript
checkMainRise(prevHigh, latest, breakout)
```

- **条件**: 从前高突破后上涨 4-6%
- **用途**: 识别主升浪行情

#### 4.1.6 涨跌幅计算

```javascript
pctChange(a, b)
```

- 计算公式: `(a - b) / b × 100%`

---

### 4.2 交易信号计算 (src/composables/useAdvice.js)

核心函数 `buildAdvice()` 根据技术指标组合生成交易建议。

#### 4.2.1 信号优先级规则

| 优先级 | 信号 | 判断条件 | 含义 |
|:------:|------|----------|------|
| 1 | **清仓** | 周线 K < MA60 | 熊市信号，清空持仓 |
| 2 | **减仓** | 日线 K < MA30 | 止损信号，减持一半 |
| 3 | **止盈** | 价格 > MA60 且 突破前高 且 J > 80 且 涨幅 >= 3% | 考虑卖出 |
| 4 | **买入1** | 周线 > MA60，日线 < MA60，跌幅 >= 1% | 短线抄底买入 |
| 5 | **买入2** | 日线 > MA60，未突破前高，跌幅 >= 1% | 突破前买入 |
| 6 | **买入3** | 突破前高 + 周线回踩 MA30 + 死叉 | 牛市回调买入 |
| 7 | **反弹** | 主升浪 + J < 20 + 价格 > MA30 | 小仓位博反弹 |
| 8 | **观望** | 价格 > MA30，无其他信号 | 保持观望 |

#### 4.2.2 交易信号详解

```
清仓:  周线 K < MA60
减仓:  日线 K < MA30
止盈:  (price > MA60) AND breakout AND (J > 80) AND (gain >= 3%)
买入1: (weekly > MA60) AND (daily < MA60) AND (drop >= 1%)
买入2: (daily > MA60) AND (not broken prev high) AND (drop >= 1%)
买入3: (broken prev high) AND (weekly retest MA30) AND (death cross)
反弹:  (main rise) AND (J < 20) AND (price > MA30)
观望:  (price > MA30) AND (no signal)
```

---

## 5. 本地存储 (localStorage)

| Key | 存储内容 | 用途 |
|-----|----------|------|
| `fundMonitor_ValidKey` | 当前访问密钥 (如 "pxf", "lun") | 验证用户身份 |
| `fundMonitor_UserConfig` | `{fundGroups: {...}, updatedAt: timestamp}` | 用户配置缓存 |

---

## 6. 数据流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                         App.vue (根组件)                        │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   useConfig()             useIndex()              useFunds()
        │                       │                       │
   ┌────┴────┐           ┌────┴────┐            ┌────┴────┐
   ▼         ▼           ▼         ▼            ▼         ▼
┌───────┐ ┌───────┐ ┌──────┐ ┌────────┐  ┌────────┐ ┌─────────┐
│GitHub │ │本地   │ │push2 │ │fundgz │  │pingzhong│ │Advice   │
│API    │ │存储   │ │EM    │ │JSONP  │  │data    │ │计算     │
└───────┘ └───────┘ └──────┘ └────────┘  └────────┘ └─────────┘
```

**加载顺序**:
1. `loadConfig()` - 从本地或 GitHub 获取基金分组配置
2. `loadFunds(codes)` - 获取选中基金的实时数据
3. `loadIndex()` - 并行获取 4 个指数快照
4. `loadAdvice(codes, fundsMap)` - **异步**计算交易信号

---

## 7. 环境变量

| 变量名 | 用途 | 配置文件 |
|--------|------|----------|
| `VITE_GITHUB_TOKEN` | GitHub Personal Access Token | `.env.local` (可选) |

---

## 8. 请求限制与重试策略

| API | 限制 | 策略 |
|-----|------|------|
| fundgz | 514 错误 (并发过高) | 150ms 队列延迟 |
| pingzhongdata | 超时 | 3 次重试，100ms 间隔 |
| push2 | - | 标准 JSONP 请求 |
| GitHub API | Rate Limit | Token 认证提升限额 |

---

## 9. 自动刷新

- **刷新间隔**: 2 分钟
- **触发**: 自动定时刷新 + 手动刷新按钮

---

## 10. 文件结构

```
fund/
├── src/
│   ├── main.js                 # Vue 应用入口
│   ├── App.vue                 # 根组件，数据协调
│   ├── api/
│   │   ├── funds.js           # fundgz + pingzhongdata API
│   │   ├── index.js            # push2.eastmoney.com 指数 API
│   │   └── github.js           # GitHub Contents API
│   ├── composables/
│   │   ├── useFunds.js         # 基金数据状态管理
│   │   ├── useIndex.js         # 指数数据状态
│   │   ├── useAdvice.js        # 交易建议计算
│   │   ├── useConfig.js        # 配置加载
│   │   └── useAuth.js          # 密钥验证
│   ├── utils/
│   │   ├── kdj.js              # KDJ、MA、死叉计算
│   │   └── storage.js           # localStorage 封装
│   └── components/             # Vue 组件
├── public/
│   └── config/
│       └── fund_groups.json    # 基金分组配置
├── vite.config.js              # Vite 配置
└── package.json
```
