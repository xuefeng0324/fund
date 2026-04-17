# 基金交易规则同步功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 GitHub Actions 定时任务，自动同步基金交易规则数据（买入确认日、卖出确认日）到 `public/config/fund_info.json`。

**Architecture:** 纯 GitHub Actions 后台任务，通过 Node.js 脚本串行请求 danjuanfunds.com API，数据写入 `public/config/fund_info.json`，push 到 main 分支后自动触发 pages-deploy 工作流部署。

**Tech Stack:** GitHub Actions, Node.js (Node.js 内置 https/http + fs 模块，无需第三方依赖)

---

## 文件结构

```
.github/workflows/fund-info-sync.yml  ← 新建：定时同步工作流
scripts/fund-info-sync.js             ← 新建：Node.js 同步脚本
public/config/fund_info.json          ← 新建：初始为空数组
```

---

## Task 1: 创建初始数据文件

**Files:**
- Create: `public/config/fund_info.json`

- [ ] **Step 1: 创建 fund_info.json 初始文件**

```json
[]
```

- [ ] **Step 2: 提交初始文件**

```bash
git add public/config/fund_info.json
git commit -m "chore: init fund_info.json"
```

---

## Task 2: 创建同步脚本

**Files:**
- Create: `scripts/fund-info-sync.js`
- Test: 本地运行 `node scripts/fund-info-sync.js` 验证

- [ ] **Step 1: 创建 scripts 目录**

```bash
mkdir -p scripts
```

- [ ] **Step 2: 编写 fund-info-sync.js 脚本**

```javascript
const fs = require('fs');
const path = require('path');
const https = require('https');

const FUND_GROUPS_PATH = path.join(__dirname, '../public/config/fund_groups.json');
const FUND_INFO_PATH = path.join(__dirname, '../public/config/fund_info.json');
const API_BASE = 'https://danjuanfunds.com/djapi/fund/detail';

/**
 * 读取 JSON 文件
 */
function readJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * 写入 JSON 文件
 */
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 从 fund_groups.json 提取所有基金代码
 */
function extractAllCodes(fundGroups) {
  const codes = new Set();
  for (const group of Object.values(fundGroups)) {
    for (const code of group) {
      codes.add(code);
    }
  }
  return codes;
}

/**
 * HTTP GET 请求（使用 Node.js 内置模块）
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 10000 }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * 获取单只基金交易规则
 */
async function fetchFundInfo(fundCode) {
  const url = `${API_BASE}/${fundCode}`;
  const response = await httpGet(url);

  if (response.result_code !== 0 || !response.data || !response.data.fund_date_conf) {
    throw new Error(`Failed to fetch fund info for ${fundCode}`);
  }

  return {
    fund_code: fundCode,
    buy_confirm_date: response.data.fund_date_conf.buy_confirm_date,
    sale_confirm_date: response.data.fund_date_conf.sale_confirm_date
  };
}

/**
 * 主流程
 */
async function main() {
  console.log('Starting fund info sync...');

  // 1. 读取 fund_groups.json 获取所有基金代码
  const fundGroups = readJson(FUND_GROUPS_PATH);
  const allCodes = extractAllCodes(fundGroups);
  console.log(`Found ${allCodes.size} fund codes in fund_groups.json`);

  // 2. 读取 fund_info.json 获取已有数据
  let fundInfo = [];
  if (fs.existsSync(FUND_INFO_PATH)) {
    fundInfo = readJson(FUND_INFO_PATH);
  }
  const existingCodes = new Set(fundInfo.map(item => item.fund_code));
  console.log(`Found ${existingCodes.size} existing fund codes in fund_info.json`);

  // 3. 找出需要同步的基金代码
  const needFetch = [...allCodes].filter(code => !existingCodes.has(code));
  console.log(`Need to fetch ${needFetch.length} fund codes`);

  if (needFetch.length === 0) {
    console.log('No new funds to sync. Exiting.');
    return;
  }

  // 4. 串行请求每只基金
  let newFundInfo = [];
  for (const code of needFetch) {
    try {
      console.log(`Fetching fund info for ${code}...`);
      const info = await fetchFundInfo(code);
      newFundInfo.push(info);
      console.log(`  Success: buy_confirm_date=${info.buy_confirm_date}, sale_confirm_date=${info.sale_confirm_date}`);
    } catch (error) {
      console.log(`  Failed: ${error.message}. Skipping.`);
    }
    // 串行请求，添加间隔避免限流
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // 5. 合并并写入 fund_info.json
  const updatedFundInfo = [...fundInfo, ...newFundInfo];
  writeJson(FUND_INFO_PATH, updatedFundInfo);
  console.log(`Updated fund_info.json with ${newFundInfo.length} new entries`);

  // 6. 检查是否有更新
  if (newFundInfo.length === 0) {
    console.log('No successful fetches. Not committing changes.');
    return;
  }

  console.log('Fund info sync completed successfully.');
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
```

- [ ] **Step 3: 本地测试脚本**

```bash
node scripts/fund-info-sync.js
```

**Expected output:** 脚本运行并输出同步日志，如果 fund_info.json 已存在且包含所有基金则输出 "No new funds to sync"

- [ ] **Step 4: 提交脚本**

```bash
git add scripts/fund-info-sync.js
git commit -m "feat: add fund info sync script"
```

---

## Task 3: 创建 GitHub Actions 工作流

**Files:**
- Create: `.github/workflows/fund-info-sync.yml`

- [ ] **Step 1: 创建工作流文件**

```yaml
name: Fund Info Sync

on:
  schedule:
    # 每天 17:00 UTC = 次日 01:00 北京时间
    - cron: "0 17 * * *"
  workflow_dispatch:  # 手动触发

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

      - name: Run fund info sync
        run: node scripts/fund-info-sync.js

      - name: Commit changes
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: sync fund info data"
          file_pattern: "public/config/fund_info.json"
```

- [ ] **Step 2: 提交工作流**

```bash
git add .github/workflows/fund-info-sync.yml
git commit -m "feat: add fund info sync workflow"
```

---

## Task 4: 验证完整流程

**Files:**
- Modify: `.gitignore`（如需确保无误）

- [ ] **Step 1: 本地完整测试**

```bash
# 确保 fund_info.json 存在且为空或已删除
# 运行同步脚本
node scripts/fund-info-sync.js

# 检查 fund_info.json 是否更新
cat public/config/fund_info.json
```

**Expected:** fund_info.json 包含从 API 获取的基金数据

- [ ] **Step 2: 在 GitHub Actions 页面验证**

1. 打开 GitHub 仓库 → Actions 页面
2. 选择 "Fund Info Sync" 工作流
3. 点击 "Run workflow" 手动触发
4. 验证工作流执行成功且 fund_info.json 已更新

- [ ] **Step 3: 提交所有更改**

```bash
git push origin main
```

---

## 验证清单

- [ ] `public/config/fund_info.json` 存在且包含正确格式的数据
- [ ] `scripts/fund-info-sync.js` 可独立运行
- [ ] `.github/workflows/fund-info-sync.yml` 在 GitHub Actions 可见
- [ ] 手动 Run Workflow 成功执行
- [ ] push 到 main 后 pages-deploy 工作流自动触发

---

## 依赖说明

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js 内置模块 | - | `fs`, `path`, `https` — 无需安装 |
| actions/checkout | v4 | 检出代码 |
| actions/setup-node | v4 | 安装 Node.js 环境 |
| stefanzweifel/git-auto-commit-action | v5 | 自动提交更改 |
