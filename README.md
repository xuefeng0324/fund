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

## 常见问题

- **端口占用**：如果 `8000` 被占用，请修改 `fund_monitor.py` 里的启动端口。
- **部分基金无实时估值**：数据源可能缺失该时段数据，程序会尝试备用来源补齐。
- **中文乱码**：程序内已做编码兼容策略，若仍异常请检查本机终端编码设置。

## 免责声明

本项目仅用于学习与数据观察，不构成任何投资建议。投资有风险，决策需谨慎。

## License

本项目采用 MIT 许可证，详见 `LICENSE`。
