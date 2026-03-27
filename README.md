# Fund Monitor - 基金监控系统

一个基于 Vue 3 + Vite 构建的基金实时监控面板，支持实时估值、技术指标分析、买卖建议生成等功能。

## 版本信息

| 版本 | 发布日期 | 说明 |
|------|----------|------|
| v2.0.0 | 2026-03-27 | 重构为 Vue 3 + Vite 架构，移除 Python 后端依赖 |

## 功能特性

- **实时估值**：支持东财批量接口 + fundgz 单只接口多数据源自动切换
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
│   │   ├── useKDJ.js            # KDJ 计算逻辑
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
| 批量基金估值 | `fundmobapi.eastmoney.com` | fetch（开发时通过代理） |
| 单只估值补齐 | `fundgz.1234567.com.cn` | JSONP |
| 指数快照 | `push2.eastmoney.com` | fetch（开发时通过代理） |
| 净值数据 | `fund.eastmoney.com/pingzhongdata` | fetch（开发时通过代理） |

> **注意**：开发环境下通过 Vite 代理绕过 CORS 限制，生产环境部署到 GitHub Pages 后可直接访问这些 API（大多数支持跨域）。

## 部署

### GitHub Pages 自动部署

推送到 `lyl-dev-claude` 分支会自动触发 GitHub Actions 部署：

```bash
git add .
git commit -m "update"
git push origin lyl-dev-claude
```

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