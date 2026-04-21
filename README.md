# Fund Monitor - 基金监控系统

一个基于 Vue 3 + Vite 构建的基金实时监控面板，支持实时估值、技术指标分析、买卖建议生成等功能。

## 版本信息

| 版本 | 发布日期 | 说明 |
|------|----------|------|
| v2.6.3 | 2026-04-21 | feat: 新增净值已更新功能，根据 T+N 规则判断并在基金名称后显示徽标 |
| v2.6.2 | 2026-04-20 | 代码审查：修复多处 JS bug，删除无用函数，提升稳定性 |
| v2.6.1 | 2026-04-19 | 优化折叠箭头为 SVG chevron 图标，Coinbase 风格统一 |
| v2.6.0 | 2026-04-19 | 基金实时估值按买入确认日分组显示，支持折叠展开 |
| v2.5.0 | 2026-04-18 | 新增基金交易规则同步功能，GitHub Actions 定时同步买入卖出确认日数据 |
| v2.4.9 | 2026-04-15 | 移除上一交易日涨跌表格，统一显示基金实时估值 |
| v2.4.8 | 2026-04-15 | 引入 dayjs 处理日期，修复 pingzhongdata 时区转换问题 |
| v2.4.7 | 2026-04-15 | 优化 fundgz 空数据判断，空数据时跳过重试直接调用 pingzhongdata |
| v2.4.6 | 2026-04-15 | 优化 pingzhongdata 请求队列，解决并发请求竞态条件 |
| v2.4.5 | 2026-04-15 | 修复弹窗打开时 GitHub API 多次请求问题，添加 Loading 加载提示 |
| v2.4.4 | 2026-04-15 | IndexStrip 透明化触发点优化：搜索框滚动到"基金监控"标题底部时指数数据完全透明 |
| v2.4.3 | 2026-04-14 | 移除不稳定且存在 CORS 限制的 FundMNFInfo 接口，完全使用 JSONP 方案 |
| v2.4.2 | 2026-04-14 | FundMNFInfo 接口添加移动端 User-Agent |
| v2.4.1 | 2026-04-14 | 修复指数面板透明后遮挡下方区域点击的问题 |
| v2.4.0 | 2026-04-10 | IndexStrip 滚动透明化效果：页面下滑时指数区域渐隐，提升视觉体验 |
| v2.3.1 | 2026-04-09 | 卡片样式优化：基金名称自适应、代码与时间对齐 |
| v2.3.0 | 2026-04-09 | 全面重构UI为Coinbase设计风格，统一颜色系统、圆角规范 |
| v2.2.3 | 2026-04-09 | 修复切换视图后管理基金按钮消失的问题 |
| v2.2.2 | 2026-04-08 | 移除 fund_codes.json，基金代码由 fund_groups.json 合并去重生成 |
| v2.2.1 | 2026-04-03 | 修复建议逻辑：对齐 Python 脚本，修复 gszzl 未传递、持仓/空仓独立计算、ISO 周算法等问题 |
| v2.1.15 | 2026-04-03 | 重构管理基金列表页面，修复弹窗无法再次打开的问题 |
| v2.1.14 | 2026-04-02 | fundgz 补齐添加重试策略 |
| v2.1.13 | 2026-04-02 | 右上角显示当前时间，移动端指数4行显示 |
| v2.1.12 | 2026-04-02 | 移除数据来源下拉框，使用auto模式 |
| v2.1.11 | 2026-04-02 | 加载状态优化、密钥清空修复、无密钥禁用看自己、请求间隔150ms |
| v2.1.10 | 2026-04-02 | pingzhongdata 重试策略：请求失败时重试3次，间隔100ms |
| v2.1.9 | 2026-04-02 | 请求间隔优化：历史估值数据添加 100ms 请求间隔；文档：部署分支说明与 README 提交规范 |
| v2.1.8 | 2026-04-02 | 基金估值即时显示：批量结果先展示，fundgz 结果异步补充 |
| v2.1.7 | 2026-04-02 | 优化加载体验：估算涨跌先展示，建议原因异步加载 |
| v2.1.6 | 2026-04-02 | 代码清理：移除调试代码、Mock 数据、诊断面板 |
| v2.1.5 | 2026-04-01 | 修复 fundmobapi 接口调用问题，该接口不支持 JSONP |
| v2.1.4 | 2026-04-01 | 修复 GitHub Pages CORS 问题，部分接口改用 JSONP |
| v2.1.3 | 2026-04-01 | 修复 fundgz API 频率限制问题，请求队列串行处理 |
| v2.1.2 | 2026-04-01 | 建议颜色方案调整，清仓减仓绿色，持有观望灰色，买入加仓红色 |
| v2.1.1 | 2026-03-31 | 添加定时自动刷新功能，每2分钟自动更新数据 |
| v2.1.0 | 2026-03-30 | Element Plus UI 升级，响应式重构，修复基金名称显示 |
| v2.0.1 | 2026-03-27 | 优化页面布局，指数条固定顶部，增强移动端响应式 |
| v2.0.0 | 2026-03-27 | 重构为 Vue 3 + Vite 架构，移除 Python 后端依赖 |

## 功能特性

- **实时估值**：支持东财批量接口 + fundgz 单只接口多数据源自动切换
- **自动刷新**：每2分钟自动刷新基金数据，无需手动操作
- **指数快照**：上证指数、沪深300、深证成指、创业板指实时行情
- **技术指标**：KDJ 计算、MA30/MA60 均线、周线聚合
- **买卖建议**：基于波段心法的智能买卖信号生成
- **动态配置**：配置文件运行时加载，修改无需重新部署
- **基金管理**：支持通过 GitHub API 动态管理基金列表

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue 3 | ^3.4.0 | 前端框架 |
| Vite | ^5.0.0 | 构建工具 |
| Element Plus | ^2.5.0 | UI 组件库 |
| Composition API | - | 组合式逻辑复用 |

## 项目结构

```
fund/
├── src/                          # 源代码
│   ├── App.vue                  # 根组件
│   ├── main.js                  # 入口文件
│   ├── assets/
│   │   └── style.css            # 全局样式（Coinbase风格）
│   ├── components/              # Vue 组件
│   │   ├── Header.vue           # 顶部导航栏
│   │   ├── IndexStrip.vue       # 指数卡片条
│   │   ├── Toolbar.vue          # 工具栏
│   │   ├── FundTable.vue        # 基金列表表格
│   │   ├── FundManageModal.vue  # 管理基金弹窗
│   │   └── CustomAlert.vue      # 自定义提示框
│   ├── composables/             # 组合式函数
│   │   ├── useFunds.js          # 基金数据逻辑
│   │   ├── useIndex.js          # 指数数据逻辑
│   │   ├── useAdvice.js         # 买卖建议逻辑
│   │   ├── useAuth.js           # 密钥验证逻辑
│   │   └── useConfig.js         # 配置加载逻辑
│   ├── api/                     # API 模块
│   │   ├── funds.js             # 基金数据获取
│   │   ├── index.js             # 指数数据获取
│   │   └── github.js            # GitHub REST API
│   └── utils/                   # 工具函数
│       ├── kdj.js               # KDJ 计算算法
│       └── storage.js           # localStorage 管理
├── public/                       # 静态文件（不打包）
│   ├── config/
│   │   ├── fund_groups.json     # 分组配置（包含所有基金代码）
│   │   └── fund_info.json       # 基金信息（名称、交易规则等）
│   └── favicon.svg
├── DESIGN.md                     # 设计规范文档
├── changelog/                    # 变更日志
│   └── YYYY-MM-DD-v版本-变更标题.md    # 按日期-版本-变更信息记录
├── dist/                         # 构建输出
├── package.json
├── vite.config.js
└── .github/workflows/
    ├── pages-deploy.yml         # GitHub Pages 部署
    └── fund-info-sync.yml       # 基金交易规则同步
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
# 访问 http://localhost:5173/fund/（如果端口被占用会自动递增）
```

**环境变量配置（可选）**

如需测试 GitHub API 保存功能，创建 `.env.local`：
```
VITE_GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

### 构建生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```

## 配置说明

### 分组配置

编辑 `public/config/fund_groups.json`：

```json
{
  "pxf": ["001549", "012922"],
  "lun": ["006328", "008591"]
}
```

所有基金代码由各分组的代码合并后去重生成，无需单独维护基金代码列表。

### 密钥验证

- 输入分组配置中的密钥（如 `pxf`、`lun`）可查看对应分组基金
- 密钥存储在 localStorage，刷新后自动恢复

## API 接口

### 基金数据 API (`src/api/funds.js`)

| 函数 | 说明 |
|------|------|
| `fetchSingleFundgz(code)` | 获取单只基金估值（JSONP） |
| `fetchPingzhongdata(code)` | 获取基金详细数据 |

### 指数数据 API (`src/api/index.js`)

| 函数 | 说明 |
|------|------|
| `fetchIndexLive()` | 获取四大指数快照 |

## 买卖建议系统

### 建议优先级

```
清仓 > 止损 > 止盈 > 买入 > 持有/观望
```

### 建议规则

| 规则 | 条件 | 建议 |
|------|------|------|
| 清仓 | 周K跌破60日线 | 建议清仓 |
| 止损 | 日K跌破30日线 | 减到半仓 |
| 止盈 | 站上60线且大涨≥3% | 推荐卖出 |
| 波段买入1 | 周K在60线上方 + 日K跌破60线 + 跌幅≥1% | 牛市早期短线买入 |
| 波段买入2 | 日K在60线上方 + 未突破前高 + 跌幅≥1% | 牛市前期长线买入 |
| 波段买入3 | 突破前高后 + 周K回踩30日线 + 日K死叉 | 牛回头买入 |
| 反弹买入 | 主升后回调 + J<20 + 未跌破30线 | 小仓位买入 |

## 数据来源

| 功能 | 外部 API | 调用方式 |
|------|----------|---------|
| 单只估值补齐 | `fundgz.1234567.com.cn` | JSONP |
| 指数快照 | `push2.eastmoney.com` | JSONP |
| 净值数据 | `fund.eastmoney.com/pingzhongdata` | script 标签 |
| 配置存储 | `api.github.com` | REST API |

> **注意**：所有接口使用 JSONP 或 script 标签加载方式绕过 CORS 限制。

## 部署

### GitHub Pages 自动部署

推送到 **`main`**、**`lyl-dev-claude`** 或 **`pxf-dev-cursor`** 均可触发 GitHub Actions 部署（以 `.github/workflows/pages-deploy.yml` 的 `push.branches` 为准）。

```bash
# 构建并提交（示例：PXF 默认在 pxf-dev-cursor 上开发）
npm run build
git add .
git commit -m "docs(fund): 符合规范的说明性提交示例"
git push origin pxf-dev-cursor
```

**提交规范**：

提交信息须使用 **Conventional Commits**（与方法论仓库 `AGENTS.md` 一致）：`<type>(<scope>): <中文描述>`，禁止使用模糊描述（如 `update`、泛泛的 `fix bug`）。提交代码前必须按以下顺序完成：

| 步骤 | 项目 | 说明 |
|------|------|------|
| 1 | 代码审查 | 检查代码质量，确保逻辑正确。先检查是否存在相关 code review skill 进行辅助审查 |
| 2 | 补充注释 | 为新增/修改的代码添加必要注释 |
| 3 | 更新版本信息 | README 顶部版本表添加新版本（只能新增，不能修改旧版本信息） |
| 4 | 简要更新日志 | README 底部更新日志添加简要说明 |
| 5 | 更新 changelog | `changelog/` 目录添加详细变更记录，包含需求背景、实现方案、相关代码实现 |
| 6 | 部署 dist 产物 | 运行 `npm run build` 并提交 dist 目录 |

**在线地址：** https://xuefeng0324.github.io/fund/

### GitHub Token 配置（用于基金管理保存功能）

如需通过界面管理基金列表并保存到 GitHub：

1. 生成 Personal Access Token：
   - 访问 https://github.com/settings/tokens
   - 点击 "Generate new token (classic)"
   - 勾选 `repo` 权限
   - 生成并复制 Token

2. 配置到 GitHub Secrets：
   - 仓库 Settings → Secrets → Actions
   - 添加 `VITE_GITHUB_TOKEN` 密钥

3. 重新部署后生效

### 手动部署

1. 构建项目
```bash
npm run build
```

2. 将 `dist` 目录部署到任意静态服务器

## 更新日志

详细的变更记录请查看 [changelog/](./changelog/) 目录，按日期-版本-变更信息记录。

### v2.6.3 (2026-04-21)

**新功能 — 净值已更新功能**

- 新增 `checkIsUpdated` 函数，根据 T+N 规则判断基金是否已更新
- 基金名称后显示蓝色药丸徽标"已更新"
- 已更新时净值、涨跌幅取历史确认数据
- 徽标样式：透明背景 + #0052ff 边框 + 100000px 圆角

### v2.6.2 (2026-04-20)

**代码审查修复 — JS Bug 修复与代码清理**

- `useAdvice.js`：修复周线数据日期用 `dayjs` 替换 `new Date().toISOString()`，消除 UTC 偏移导致的日期错位
- `useAdvice.js`：用 `Number.isFinite()` 替换 `!= null`，防止 NaN 被误判为有效涨跌幅
- `useConfig.js`：删除对 `computed` ref 的非法直接赋值，恢复响应式派生逻辑
- `useFunds.js`：改为 `Promise.allSettled` 等待所有请求完成后再关闭 loading 状态
- `funds.js`：修复 JSONP 请求合并 bug（resolvers 数组替代覆盖），删除未使用的 `buildResults`、`fetchNoEstimateFunds`、`todayStr`
- `github.js`：用 `TextEncoder` 替换废弃的 `unescape`；token 为空时省略 Authorization header
- `kdj.js`：用 `dayjs` 替换 `new Date()` 修复日期本地时区解析；`checkMainRise` 增加 `prevHigh <= 0` 保护；`Math.min/max` 展开替换为 `reduce` 避免栈溢出

### v2.6.1 (2026-04-19)

**UI 优化 — 折叠箭头 SVG 图标**

- 将折叠箭头从 Unicode 字符改为 SVG chevron 图标
- 折叠时 chevron 旋转 -90° 动画
- hover 颜色变为 Coinbase Blue (#0052ff)
- 符合 Coinbase 设计风格统一性

### v2.6.0 (2026-04-19)

**功能优化 — 基金实时估值按买入确认日分组显示**

- 按 `buy_confirm_date` 分组显示基金（T+1、T+2、未知）
- 每个表格可折叠/展开，刷新后默认全部展开

### v2.5.0 (2026-04-18)

**新功能 — 基金交易规则同步功能**

- 新增 GitHub Actions 定时任务，每天 17:00 UTC 自动同步基金交易规则
- 支持手动触发 workflow
- 数据源：danjuanfunds.com 基金详情接口
- 同步买入/卖出确认日（T+N）数据到 `public/config/fund_info.json`

### v2.4.9 (2026-04-15)

**功能优化 — 移除上一交易日涨跌表格**

- 移除"上一交易日涨跌"基金表格，统一显示所有基金在"基金实时估值"表格
- 表格标题从"实时估值基金"更名为"基金实时估值"
- 基金数据统一使用实时估值或 pingzhongdata 的净值和涨跌幅

### v2.4.8 (2026-04-15)

**依赖更新 — 引入 dayjs 处理日期**

- 引入 dayjs 替代原生 Date 处理时间戳和日期
- 修复 `getLastTradingChange` 时区转换问题，`toISOString()` 会产生 UTC 偏差
- 使用 `dayjs(timestamp).format('YYYY-MM-DD')` 自动处理本地时区

### v2.4.7 (2026-04-15)

**Bug 修复 — fundgz 空数据判断优化**

- 修复 `fetchSingleFundgz` 无法识别 `jsonpgz();` 空数据的问题
- 空数据时立即 resolve，避免 10 秒超时等待
- `useFunds` 检测到 fundgz 空数据后直接调用 `pingzhongdata` 作为备选，不再无效重试
- 优化数据加载流程，减少等待时间

### v2.4.6 (2026-04-15)

**稳定性优化 — pingzhongdata 请求队列优化**

- 新增 `pingzhongdataQueue` 请求队列，确保同一时间只有一个请求执行
- 解决并发请求时全局变量 `window.Data_netWorthTrend` 竞态条件问题
- 保留原有的 3 次重试策略和 100ms 重试间隔

### v2.4.5 (2026-04-15)

**Bug 修复 — 修复弹窗打开时 GitHub API 多次请求问题**

- 移除 `FundManageModal` 组件中的 `onMounted` 自动加载，避免页面加载时立即触发 GitHub API 请求
- 保留 `dialogVisible` watcher 作为唯一的配置加载触发点
- 优化 `keyValue` watcher，仅在弹窗打开时更新 `managedCodes`

**体验优化 — 添加加载状态提示**

- 加载配置时显示 Loading 遮罩层，旋转图标 + "加载中..." 文字
- 加载过程中禁用底部按钮，防止误操作

### v2.4.4 (2026-04-15)

**IndexStrip 透明化触发点优化**
- 优化 IndexStrip 滚动透明化触发逻辑
- 旧逻辑：以基金表格作为触发参考点
- 新逻辑：以 Toolbar 搜索框作为触发参考点，搜索框滚动到"基金监控"标题底部时 IndexStrip 完全透明
- 提升视觉体验，搜索场景下指数数据更早渐隐

### v2.4.3 (2026-04-14)

**API 移除与简化**
- 彻底移除 `FundMNewApi/FundMNFInfo` 接口的调用逻辑。由于浏览器的安全限制，该接口经常出现 CORS 问题和 User-Agent 限制。
- `fetchRealtimeBatch` 和 `fetchFundBasicInfo` 等关联函数已一并移除。
- 项目现在完全依赖于不受跨域限制的 `fundgz` (JSONP) 和 `pingzhongdata` (Script 标签) 接口，提升稳定性和环境兼容性。

### v2.4.2 (2026-04-14)

**API 优化**
- 为 FundMNFInfo 接口请求添加移动端 User-Agent，模拟移动端请求。

### v2.4.1 (2026-04-14)

**Bug 修复**
- 修复指数面板完全透明后仍占据 sticky 顶层区域，导致下方工具栏和表格无法点击的问题
- 为指数面板透明态添加 `pointer-events: none`，透明后点击自动穿透到下层内容
- 调整 `sticky-header` 事件命中策略，仅保留真实头部内容可交互，空白区域不再拦截点击

### v2.4.0 (2026-04-10)

**新功能 — IndexStrip 滚动透明化效果**
- 页面下滑时指数数据区域逐渐透明，表格顶部接触 sticky header 时完全透明
- 使用 requestAnimationFrame 实现平滑滚动节流
- 动态计算淡出距离，适配不同屏幕尺寸
- ease-out cubic 缓动函数，过渡更自然
- CSS transition 确保视觉平滑，防止抖动

### v2.3.1 (2026-04-09)

**UI 优化**
- 卡片基金名称使用 clamp 自适应字体大小
- 卡片基金代码与更新时间字体大小统一为 12px
- 移除卡片标题行 gap，紧密排列

### v2.3.0 (2026-04-09)

**UI 重构 — Coinbase 设计风格**
- 全面重构 UI 为 Coinbase 设计风格，统一颜色系统、圆角规范
- 新增 DESIGN.md 设计规范文档
- 品牌色：#0052ff，深色：#0a0b0d，背景：#ffffff
- 圆角规范：按钮 56px、卡片 16px、对话框 24px
- 表格头部蓝色背景，标题蓝色装饰条
- 指数卡片四行显示（名称、价格、涨跌、百分比）
- 管理基金弹窗全端适配

### v2.2.3 (2026-04-09)

**Bug 修复**
- 修复点击"看全部"后，管理基金按钮不显示、不能切回"看自己"的问题
- 切换视图时保留密钥认证状态，不再清空有效密钥

### v2.2.2 (2026-04-08)

**配置重构**
- 移除 `fund_codes.json` 配置文件
- 基金代码由 `fund_groups.json` 中所有分组合并后去重生成
- 简化配置管理，只需维护一份配置文件
- FundManageModal 保存逻辑简化，不再同步 fund_codes.json

### v2.2.1 (2026-04-03)

**Bug 修复 — 对齐 Python 脚本**
- 修复 gszzl（估算涨跌幅）未传递到建议计算，导致止盈、所有买入规则永远不触发
- 修复持仓/空仓建议合并为单次计算，改为两次独立计算再合并
- 修复买入前提条件遗漏"周K在60线上方"
- 修复周线聚合 ISO 周算法，跨年周归类错误
- 补全空仓30线上方观望逻辑（不追高）
- 补全反弹减仓提醒逻辑

### v2.1.15 (2026-04-03)

**UI 重构**
- 重构管理基金列表页面，适配主页样式
- 修复弹窗关闭后无法再次打开的问题（使用 defineModel 双向绑定）
- 移动端弹窗高度调整，对齐指数数据顶部
- 基金代码输入框和添加按钮改为同一行

### v2.1.14 (2026-04-02)

**稳定性优化**
- fundgz 补齐添加重试策略：请求失败时重试 3 次，间隔 150ms
- 提升无实时估值基金的补齐成功率

### v2.1.11 (2026-04-02)

**UI 优化**
- 加载状态优化：更新中禁用看自己/看全部、排序、展开全部
- 密钥清空后自动切换看全部并刷新数据
- 无密钥时禁用看自己/看全部开关
- 移动端第三行更新时间显示修复
- 移动端管理基金列表名称宽度调整为 180px

**配置刷新**
- 保存基金后立即生效，无需等待 GitHub Pages 部署

**请求优化**
- fundgz 和 pingzhongdata 请求间隔调整为 150ms

### v2.1.8 (2026-04-02)

**体验优化**
- 基金估值即时显示：批量结果立即展示，fundgz 异步补充
- 无估值基金快速显示上一交易日涨跌数据
- 添加 fadeInUp/fadeInLeft 淡入动画效果
- 移动端卡片展开/收起动画优化

**Bug 修复**
- 修复 JSONP 回调函数时序问题
- 修复管理基金列表名称不显示问题

**UI 改进**
- 按钮文字从"刷新"改为"更新"
- 卡片布局优化，基金名称和涨跌幅位置固定

### v2.1.7 (2026-04-02)

**体验优化**
- 估算涨跌先展示，建议原因异步加载
- 基金数据和指数数据加载完成后立即显示
- 建议计算在后台进行，不阻塞主界面

**代码优化**
- 删除未使用的 useKDJ.js 组合式函数
- 补充 API 模块注释
- 移除无用代码和参数

### v2.1.6 (2026-04-02)

**代码清理**
- 移除 vConsole 调试工具
- 移除 Mock 数据降级代码
- 移除诊断面板
- 移除所有调试日志
- 优化 fundgz 请求间隔为 100ms，频率限制暂停为 0.5 秒

### v2.1.5 (2026-04-01)

**Bug 修复**
- 修复 `fundmobapi.eastmoney.com` 接口调用问题
- 该接口不支持 JSONP，返回纯 JSON 格式，改回 fetch 方式
- 添加 vConsole 调试工具便于生产环境排查问题

**问题原因**
- `fundmobapi.eastmoney.com` 接口支持 CORS，可直接使用 fetch
- 之前误以为需要 JSONP，导致回调无法触发，请求卡住
- `push2.eastmoney.com` 和 `fundgz.1234567.com.cn` 支持 JSONP

### v2.1.4 (2026-04-01)

**Bug 修复**
- 修复 GitHub Pages CORS 跨域问题
- `push2.eastmoney.com` 改用 JSONP（参数 `cb`）
- `fundgz.1234567.com.cn` 使用 JSONP
- 删除无用的 `fetchJSON` 函数

**技术变更**
- 移除自定义请求头避免触发 CORS 预检
- 根据接口特性选择合适的调用方式

### v2.1.3 (2026-04-01)

**Bug 修复**
- 修复 fundgz API 频率限制问题（514 错误）
- 添加请求队列，串行处理请求避免并发过多

### v2.1.2 (2026-04-01)

**功能优化**
- 建议颜色方案调整：清仓减仓绿色，持有观望灰色，买入加仓红色
- 持仓和空仓建议分别显示，各自应用对应颜色

**UI 改进**
- 建议列分行显示持仓和空仓建议
- 建议列宽度调整为 140px 适应新布局
- 移动端卡片建议区域同步更新

### v2.1.1 (2026-03-31)

**新增功能**
- 添加定时自动刷新功能，每 2 分钟自动刷新基金数据
- 页面打开后自动开始定时刷新，无需手动操作
- 移动端卡片支持展开/收起全部功能
- 移动端标题右侧添加排序开关（降序/升序）

**UI 优化**
- "看自己/看全部"改为开关样式，文字在两侧显示
- 移动端卡片默认收起，点击展开详情
- 移动端更新时间显示在第三行，字体加大加粗
- 所有按钮和输入框统一圆角 10px

**Bug 修复**
- 修复切换"看自己/看全部"时数据不同步的问题
- 修复 loading 时仍可切换导致数据错乱的问题
- 修复展开状态缺少基金代码和更新时间的问题

**优化**
- 手动刷新后重置定时器，避免短时间内连续触发
- 正在加载时禁用刷新按钮、排序开关、展开全部按钮
- 组件卸载时自动清理定时器，避免内存泄漏

### v2.1.0 (2026-03-30)

**UI 升级**
- 集成 Element Plus UI 库，现代化设计风格
- 全新 Header 导航栏，集成更新时间显示
- 全新 Toolbar 工具栏，使用 Element Plus 组件
- FundTable 桌面端使用 el-table 表格，移动端自动切换为卡片布局
- 管理基金弹窗适配移动端

**响应式优化**
- PC 端完整表格，平板端紧凑表格，移动端卡片布局
- 响应式布局适配移动端、平板端、PC端
- 移动端卡片添加涨跌幅排序按钮（升序/降序）

**功能修复**
- 修复"看全部"不刷新数据的问题
- 修复"看全部"时清空密钥输入框的问题，现在保留密钥
- 修复"上一交易日涨跌"不显示基金名称的问题
- 优化表格字体加粗显示
- 建议和原因列支持多行显示
- 更新时间格式改为 "更新时间：YYYY-MM-DD HH:mm"
- 修复移动端卡片建议原因换行显示
- 修复移动端卡片名称显示顺序（名称在上加粗，代码在下）
- 修复表格列排序不生效问题（添加 prop 属性）

**技术变更**
- 新增依赖：element-plus、@element-plus/icons-vue
- fetchPingzhongdata 现在返回 { trend, name }
- getLastTradingChange 返回 { change, date, name }

### v2.0.2 (2026-03-27)

**Bug 修复**
- 修复管理基金列表获取名称时提示"网络繁忙"的问题
- 修复 pingzhongdata 接口在生产环境 CORS 跨域问题（改用 script 标签加载）

**优化**
- 简化 fetchPingzhongdata 函数，仅返回净值趋势数据（基金名称使用缓存）

**涉及文件**
- `src/composables/useFunds.js` - 添加 fundNameMap 缓存
- `src/App.vue` - 传递 fundNameMap 给 FundManageModal
- `src/components/FundManageModal.vue` - 使用缓存的基金名称
- `src/api/funds.js` - pingzhongdata 改用 script 标签加载
- `src/composables/useKDJ.js` - 适配 fetchPingzhongdata 返回值变化
- `src/composables/useAdvice.js` - 适配 fetchPingzhongdata 返回值变化

### v2.0.1 (2026-03-27)

**UI 风格改版**
- 全新浅色撞色设计风格
- 统一圆角按钮、卡片式布局
- 优化指数条、表格、弹窗样式

**功能优化**
- 添加「看自己 | 看全部」快捷切换
- 管理基金弹窗全新设计，支持显示基金名称
- 统一全站字体大小和粗细

**Bug 修复**
- 修复切换视图时密钥输入框被清空的问题
- 修复管理基金列表不显示名称的问题

### v2.0.0 (2026-03-27)

**重大变更**
- 完全重构为 Vue 3 + Vite 架构
- 移除 Python 后端依赖
- 配置文件改为运行时加载
- 移除趋势图功能，简化界面

**新增功能**
- 支持动态修改基金配置（通过 GitHub API）
- 支持多数据源自动切换（东财、fundgz 等）
- 完整的 KDJ 计算和买卖建议系统

**改进**
- 更快的构建速度（Vite）
- 更好的开发体验（HMR）
- 更清晰的代码结构（组合式 API）

---

## 免责声明

本项目仅用于学习与数据观察，不构成任何投资建议。投资有风险，决策需谨慎。

## License

MIT License
