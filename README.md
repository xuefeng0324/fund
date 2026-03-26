# fund

基金监控本地服务。通过 Python 启动一个本地 HTTP 服务，聚合基金估值、净值与分组信息，并提供简单页面与 API 供查看。

## 功能概览

- 本地 HTTP 服务（默认 `127.0.0.1:8000`）
- 基金实时估值与历史净值相关接口
- 基金代码配置与密钥分组配置（JSON 文件）
- 估值相关缓存与分时数据本地存储

## 目录说明

- `fund_monitor.py`：主程序，启动服务并提供页面/API
- `run.bat`：Windows 一键启动脚本
- `fund_codes.json`：基金代码配置
- `fund_groups.json`：按密钥分组配置
- `intraday_store.json`：分时缓存数据（运行时生成/更新）

## 环境要求

- Python 3.9+
- 可联网访问基金数据源
- 可选依赖：`akshare`（未安装时会自动降级到其他数据路径）

## 快速开始（Windows）

1. 进入项目目录：

```powershell
cd G:\github\fund
```

2. 直接运行：

```powershell
run.bat
```

或手动运行：

```powershell
python .\fund_monitor.py
```

3. 浏览器访问：

- `http://127.0.0.1:8000`

## 配置说明

### 1) 基金代码：`fund_codes.json`

用于维护需要监控的基金列表。

### 2) 分组配置：`fund_groups.json`

用于按密钥过滤基金显示。请求带上密钥时，只返回对应分组基金。

### 3) 分时缓存：`intraday_store.json`

用于保存本地采样与缓存数据；通常无需手动编辑。

## 主要 API

- `GET /api/funds`：获取基金列表与估值数据
- `GET /api/index`：获取指数相关数据
- `GET /api/fund_codes`：读取基金代码配置
- `POST /api/fund_codes`：更新基金代码配置
- `GET /api/fund_groups`：读取分组配置
- `POST /api/fund_groups`：更新分组配置
- `GET /api/advice`：获取买卖建议
- `GET /api/sparkline/nav`：获取净值分时数据
- `GET /api/sparkline/nav/daily`：获取日维度净值数据
- `GET /api/sparkline/nav/weekly`：获取周维度净值数据
- `GET /api/sparkline/intraday`：获取本地分时缓存数据
- `GET /api/kdj`：获取 KDJ 指标相关数据
- `GET /api/log`：获取运行日志信息

## GitHub Pages 在线版

本项目已通过 GitHub Actions 自动部署到 GitHub Pages，支持 **实时数据获取**，点击「刷新数据」可获取最新基金估值。

**在线地址：** https://xuefeng0324.github.io/fund/

### 实时数据获取原理

页面在浏览器端直接调用外部基金 API，无需 Python 后端：

| 功能 | 外部 API | 调用方式 |
|------|----------|---------|
| 批量基金估值 | `fundmobapi.eastmoney.com` | CORS fetch（`Access-Control-Allow-Origin: *`） |
| 单只估值补齐 | `fundgz.1234567.com.cn` | JSONP（`jsonpgz` 回调） |
| 指数快照 | `push2.eastmoney.com` | CORS fetch |
| 净值趋势/Sparkline | `fund.eastmoney.com/pingzhongdata` | `<script>` 标签加载 JS |
| KDJ 计算 | 同 pingzhongdata | 基于净值序列前端计算 |

- **首次加载**：使用构建时嵌入的静态数据（保证快速首屏渲染）
- **点击刷新**：切换到实时外部 API 获取最新数据
- **API 失败时**：自动 fallback 到静态数据，页面不会崩溃

核心实现文件：`live_fetch.js`（浏览器端数据获取模块）

### 构建与部署流程

1. `build_pages.py` 临时启动 `fund_monitor.py` 服务，抓取首页 HTML + 关键 API 数据
2. 注入 `live_fetch.js`（实时获取模块）和 `window.fetch` 拦截器到 HTML
3. 生成 `docs/index.html`
4. GitHub Actions 部署到 Pages

### 触发方式

- **自动**：push 到 `main`
- **手动**：GitHub 仓库 → Actions → "Deploy GitHub Pages (fund)" → Run workflow

### 验证（可选）

- 线上页面在浏览器端通过 `live_fetch.js` 定时/手动刷新获取实时数据
- 如需本地做浏览器断言验证，可使用仓库内的 `local_verify.mjs` / `pages_verify.mjs` 自行运行

## 常见问题

- **端口占用**：如果 `8000` 被占用，请修改 `fund_monitor.py` 里的启动端口。
- **部分基金无实时估值**：数据源可能缺失该时段数据，程序会尝试备用来源补齐。
- **中文乱码**：程序内已做编码兼容策略，若仍异常请检查本机终端编码设置。

## 免责声明

本项目仅用于学习与数据观察，不构成任何投资建议。投资有风险，决策需谨慎。

## License

本项目采用 MIT 许可证，详见 `LICENSE`。
