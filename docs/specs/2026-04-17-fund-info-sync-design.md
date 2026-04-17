# 基金交易规则同步功能设计

## 概述

新增 GitHub Actions 定时任务，自动同步基金交易规则数据（买入确认日、卖出确认日）到 `public/config/fund_info.json`。

## 数据源

| 项目 | 说明 |
|------|------|
| API | `https://danjuanfunds.com/djapi/fund/detail/{fund_code}` |
| 请求方式 | HTTP GET |
| 数据字段 | `fund_date_conf.buy_confirm_date`, `fund_date_conf.sale_confirm_date` |

## 存储结构

**public/config/fund_info.json**
```json
[{
  "fund_code": "006328",
  "buy_confirm_date": 2,
  "sale_confirm_date": 2
}]
```

## 触发条件

- 定时执行：每天 01:00 北京时间（`cron: "0 17 * * *"`，UTC 01:00 = 北京 09:00，需确认）
- 手动触发：通过 GitHub Actions 页面手动运行

> **注意**：用户需求为每天1点执行，但 GitHub Actions cron 使用 UTC 时间。
> - UTC 17:00 = 北京时间次日 01:00
> - 实际使用 `cron: "0 17 * * *"` 触发

## 执行流程

1. 读取 `public/config/fund_groups.json` 获取所有基金代码（合并所有分组）
2. 读取 `public/config/fund_info.json` 获取已有数据
3. 对比找出 `fund_info.json` 中不存在的基金代码
4. 串行请求 danjuanfunds.com API 获取每只基金详情
5. 请求失败的基金直接跳过，继续处理下一只
6. 成功获取的数据合并写入 `fund_info.json`
7. 提交更改到 main 分支（触发 pages-deploy 工作流）

## 同步策略

| 策略 | 说明 |
|------|------|
| 更新时机 | 仅同步 `fund_info.json` 中不存在的基金 |
| 数据持久性 | 已写入的数据永不更新 |
| 错误处理 | 请求失败的基金跳过，不阻塞其他基金 |
| 请求方式 | 串行请求，避免限流 |

## 文件变更

### 新增文件

| 文件 | 说明 |
|------|------|
| `.github/workflows/fund-info-sync.yml` | 定时同步工作流 |
| `scripts/fund-info-sync.js` | Node.js 同步脚本 |
| `public/config/fund_info.json` | 初始为空数组 `[]` |

### 修改文件

无

## 前端读取方式

```javascript
// 直接读取静态配置文件
fetch('/config/fund_info.json')
  .then(res => res.json())
  .then(data => console.log(data))
```

**注意**：无需触发重新构建部署，`public/config/` 下的文件在每次 push 到 main 时自动通过 `pages-deploy.yml` 重新构建并部署。

## 工作流配置

```yaml
name: Fund Info Sync

on:
  schedule:
    - cron: "0 17 * * *"  # 每天 17:00 UTC = 次日 01:00 北京时间
  workflow_dispatch:       # 手动触发

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node scripts/fund-info-sync.js
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: sync fund info data"
```

## 脚本逻辑伪代码

```
FUNDS_IN_INFO = read('public/config/fund_info.json')
ALL_CODES = extractAllCodes(read('public/config/fund_groups.json'))
NEED_FETCH = ALL_CODES - FUNDS_IN_INFO

for code in NEED_FETCH:
  result = httpGet(`https://danjuanfunds.com/djapi/fund/detail/${code}`)
  if result.success:
    FUNDS_IN_INFO.push({
      fund_code: code,
      buy_confirm_date: result.data.fund_date_conf.buy_confirm_date,
      sale_confirm_date: result.data.fund_date_conf.sale_confirm_date
    })
  else:
    continue  # 跳过失败的，继续处理下一只

write('public/config/fund_info.json', FUNDS_IN_INFO)
```

## 部署后效果

1. fund-info-sync 工作流执行 → 更新 `public/config/fund_info.json`
2. push 到 main → 自动触发 `pages-deploy.yml`
3. pages-deploy 重新构建 → `dist/config/fund_info.json` 更新
4. GitHub Pages 部署新版本
5. 前端可访问 `/config/fund_info.json` 获取最新数据

## 风险与限制

| 风险 | 说明 | 应对 |
|------|------|------|
| API 不稳定 | danjuanfunds.com 可能响应慢或超时 | 串行请求 + 跳过失败 |
| 数据缺失 | 部分基金可能返回无此字段 | 使用默认值或跳过 |
| 并发冲突 | 同时触发多个工作流可能冲突 | 使用串行执行，无并发问题 |
