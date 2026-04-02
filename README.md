# Fund Monitor - 基金监控系统

一个基于 Vue 3 + Vite 构建的基金实时监控面板，支持实时估值、技术指标分析、买卖建议生成等功能。

## 版本信息

| 版本 | 发布日期 | 说明 |
|------|----------|------|
| v2.1.13 | 2026-04-02 | 右上角显示当前时间，移动端指数4行显示 |
| v2.1.12 | 2026-04-02 | 移除数据来源下拉框，使用auto模式 |
| v2.1.11 | 2026-04-02 | 加载状态优化、密钥清空修复、无密钥禁用看自己、请求间隔150ms |
| v2.1.10 | 2026-04-02 | pingzhongdata 重试策略：请求失败时重试3次，间隔100ms |
| v2.1.9 | 2026-04-02 | 请求间隔优化：历史估值数据添加 100ms 请求间隔 |
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
| Composition API | - | 组合式逻辑复用 |

## 项目结构

```
fund/
├── src/                          # 源代码
│   ├── App.vue                  # 根组件
│   ├── main.js                  # 入口文件
│   ├── components/              # Vue 组件
│   │   ├── Header.vue           # 顶部导航栏
│   │   ├── IndexStrip.vue       # 指数卡片条
│   │   ├── Toolbar.vue          # 工具栏
│   │   ├── FundTable.vue        # 基金列表表格
│   │   ├── FundRow.vue          # 单行基金数据
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
│   │   ├── fund_codes.json      # 基金代码配置
│   │   └── fund_groups.json     # 分组配置
│   └── favicon.svg
├── changelog/                    # 变更日志
│   └── YYYY-MM-DD-变更标题.md    # 按日期记录变更
├── dist/                         # 构建输出
├── package.json
├── vite.config.js
└── .github/workflows/
    └── pages-deploy.yml         # GitHub Pages 部署
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

开发服务器配置了 API 代理以解决 CORS 问题：

| 代理路径 | 目标域名 | 用途 |
|----------|----------|------|
| `/api/eastmoney-fund` | `fund.eastmoney.com` | 净值数据 |
| `/api/eastmoney-fundmob` | `fundmobapi.eastmoney.com` | 批量估值 |
| `/api/eastmoney-push` | `push2.eastmoney.com` | 指数快照 |

### 构建生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```

## 配置说明

### 基金代码配置

编辑 `public/config/fund_codes.json`：

```json
[
  "001549",
  "012922",
  "024195"
]
```

### 分组配置

编辑 `public/config/fund_groups.json`：

```json
{
  "pxf": ["001549", "012922"],
  "lun": ["006328", "008591"]
}
```

### 密钥验证

- 输入分组配置中的密钥（如 `pxf`、`lun`）可查看对应分组基金
- 密钥存储在 localStorage，刷新后自动恢复

## API 接口

### 基金数据 API (`src/api/funds.js`)

| 函数 | 说明 |
|------|------|
| `fetchRealtimeBatch(codes)` | 批量获取基金实时估值 |
| `fetchSingleFundgz(code)` | 获取单只基金估值（JSONP） |
| `fetchRealtimeAuto(codes)` | 多源自动补齐 |
| `fetchFundsLive(codes, mode)` | 主入口函数 |
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
| 批量基金估值 | `fundmobapi.eastmoney.com` | fetch（支持 CORS） |
| 单只估值补齐 | `fundgz.1234567.com.cn` | JSONP |
| 指数快照 | `push2.eastmoney.com` | JSONP |
| 净值数据 | `fund.eastmoney.com/pingzhongdata` | script 标签 |

> **注意**：`fundmobapi.eastmoney.com` 支持 CORS，可直接使用 fetch。其他接口使用 JSONP 或 script 标签加载方式绕过 CORS 限制。

## 部署

### GitHub Pages 自动部署

推送到 `lyl-dev-claude` 分支会自动触发 GitHub Actions 部署：

```bash
# 构建并提交
npm run build
git add .
git commit -m "update"
git push origin lyl-dev-claude
```

**提交规范**：

提交代码前必须完成以下检查：

| 项目 | 说明 |
|------|------|
| 代码审查 | 检查代码质量，确保逻辑正确 |
| 补充注释 | 为新增/修改的代码添加必要注释 |
| 更新版本信息 | README 顶部版本表添加新版本 |
| 简要更新日志 | README 底部更新日志添加简要说明 |
| 更新 changelog | `changelog/` 目录添加详细变更记录 |
| 部署 dist 产物 | 运行 `npm run build` 并提交 dist 目录 |

**开发规范**：

| 项目 | 说明 |
|------|------|
| API 请求间隔 | 避免一次性请求全部数据，添加请求间隔（如 fundgz 100ms、历史估值 100ms） |
| 异步数据加载 | 批量结果先展示，缺失数据异步补充，提升用户体验 |

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

详细的变更记录请查看 [changelog/](./changelog/) 目录，按日期记录。

### v2.1.13 (2026-04-02)

**UI 优化**
- 右上角显示当前时间（格式 yyyy-MM-dd HH:mm:ss），去掉了数据更新时间
- 移动端指数卡片改为 4 个一行显示，4 行布局：指数名称（加粗）、净值（加粗）、涨跌净值、涨跌幅（加粗）

**代码优化**
- 移除 Header 组件不再使用的 lastUpdate prop

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

### v2.1.10 (2026-04-02)

**稳定性优化**
- pingzhongdata 请求添加重试策略，失败时重试3次
- 每次重试间隔 100ms，提升数据获取成功率

### v2.1.9 (2026-04-02)

**性能优化**
- 历史估值数据请求添加 100ms 间隔，避免一次性请求过多
- 建议数据逐步显示，提升加载体验

**文档更新**
- README 添加开发规范清单（API 请求间隔、异步数据加载）

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