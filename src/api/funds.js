/**
 * 基金数据 API 模块
 *
 * 主要功能：
 * 1. 批量获取基金实时估值（东财 FundMNFInfo 接口）
 * 2. 单只基金估值补齐（fundgz.1234567 JSONP 接口）
 * 3. 获取基金上一交易日涨跌数据（pingzhongdata 接口）
 */

import dayjs from 'dayjs'

const TIMEOUT_MS = 15000

// ===== 工具函数 =====

/**
 * 安全转换为浮点数
 */
function safeFloat(v) {
  if (v == null || v === '' || v === '--') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

// ===== 核心数据获取函数 =====

/**
 * 获取单只基金估值（fundgz.1234567 接口）
 *
 * 使用 JSONP 方式，支持并发请求
 * 注意：该接口有频率限制，请求过多会返回 514 错误
 */

// 等待中的请求映射：code -> { resolve, reject, timer }
const pendingRequests = new Map()

// 请求队列和延迟控制
const requestQueue = []
let isProcessingQueue = false
const REQUEST_DELAY = 150 // 每个请求间隔 150ms，避免频率限制

// 全局回调处理所有响应
window.jsonpgz = (data) => {
  if (!data || !data.fundcode) {
    // 空数据调用（无 code），取队列中最早的请求
    const firstEntry = pendingRequests.entries().next()
    if (!firstEntry.done) {
      const [code, pending] = firstEntry.value
      clearTimeout(pending.timer)
      pendingRequests.delete(code)
      const emptyResult = { FCODE: code, SHORTNAME: '', GSZ: null, GSZZL: null, DWJZ: null, GZTIME: '' }
      pending.resolvers.forEach(r => r.resolve(emptyResult))
    }
    return
  }

  const code = data.fundcode
  const pending = pendingRequests.get(code)
  if (!pending) return

  clearTimeout(pending.timer)
  pendingRequests.delete(code)
  const result = {
    FCODE: code,
    SHORTNAME: data.name || '',
    GSZ: safeFloat(data.gsz),
    GSZZL: safeFloat(data.gszzl),
    DWJZ: safeFloat(data.dwjz),
    GZTIME: data.gztime || ''
  }
  pending.resolvers.forEach(r => r.resolve(result))
}

// 处理请求队列
async function processQueue() {
  if (isProcessingQueue) return
  isProcessingQueue = true

  while (requestQueue.length > 0) {
    const { code, resolve, reject } = requestQueue.shift()

    // 相同 code 已在等待，追加 resolver 而非覆盖
    const existing = pendingRequests.get(code)
    if (existing) {
      existing.resolvers.push({ resolve, reject })
      continue
    }

    const timer = setTimeout(() => {
      const pending = pendingRequests.get(code)
      if (pending) {
        pendingRequests.delete(code)
        pending.resolvers.forEach(r => r.reject(new Error('jsonp timeout')))
      }
    }, TIMEOUT_MS)

    pendingRequests.set(code, { resolvers: [{ resolve, reject }], timer })

    const script = document.createElement('script')
    script.src = 'https://fundgz.1234567.com.cn/js/' + encodeURIComponent(code) + '.js?rt=' + Date.now()
    script.onerror = () => {
      clearTimeout(timer)
      if (script.parentNode) document.head.removeChild(script)
      const pending = pendingRequests.get(code)
      if (pending) {
        pendingRequests.delete(code)
        pending.resolvers.forEach(r => r.reject(new Error('jsonp error (likely frequency capped)')))
      }
      if (requestQueue.length > 0) {
        isProcessingQueue = false
        setTimeout(() => processQueue(), 500)
      }
    }
    script.onload = () => {
      if (script.parentNode) document.head.removeChild(script)
    }
    document.head.appendChild(script)

    // 等待延迟后再处理下一个
    await new Promise(r => setTimeout(r, REQUEST_DELAY))
  }

  isProcessingQueue = false
}

export function fetchSingleFundgz(code) {
  return new Promise((resolve, reject) => {
    // 加入队列
    requestQueue.push({ code, resolve, reject })
    processQueue()
  })
}

export function getLastTradingChange(code) {
  return fetchPingzhongdata(code).then(result => {
    // result 可能是数组或 { trend, name } 对象
    const trend = (result && result.trend) ? result.trend : (Array.isArray(result) ? result : [])
    if (!trend || !trend.length) return { change: null, date: '--', name: '', nav: null }
    const last = trend[trend.length - 1]
    const change = safeFloat(last.equityReturn)
    const nav = safeFloat(last.y)
    // 使用 dayjs 解析时间戳/日期，自动处理时区
    const dateStr = last.x ? dayjs(last.x).format('YYYY-MM-DD') : '--'
    // 基金名称通过 fS_name 获取
    const name = (result && result.name) ? result.name : ''
    return { change, date: dateStr, name: name || window.fS_name || '', nav }
  }).catch(e => {
    return { change: null, date: '--', name: '', nav: null }
  })
}

// ===== FundValuationLast 新接口 (替代 fundgz.1234567) =====
//
// 历史背景:
// - fundgz.1234567.com.cn JSONP 接口于 2026-02 起被天天基金主动下架
//   (证监会要求所有三方平台停止提供基金盘中实时估值)
// - 新接口 fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast
//   支持批量请求, CORS 开放, 返回 JSON, 字段与原 fundgz 100% 兼容
// - 实测 53 个基金批量 145ms, 35/53 有盘中估值 (GSZ/GSZZL/GZTIME 非 null),
//   其余基金 (QDII/商品/部分混合型) 受合规限制只有 NAV/NAVCHGRT
//
// 字段:
//   FCODE - 基金代码
//   SHORTNAME - 简称
//   GSZ - 估算净值 (盘中实时, 可能 null)
//   GSZZL - 估算涨跌幅 (%) (盘中实时, 可能 null)
//   GZTIME - 估值时间 (可能 null)
//   NAV - 上一个交易日单位净值 (一定会返回)
//   NAVCHGRT - 实际涨跌幅 (收盘后填写)
//   PDATE - 净值日期

const FV_ENDPOINTS = [
  'https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast',
  'https://fundcomapi.eastmoney.com/mm/newCore/FundValuationLast'
]
const FV_FIELDS = 'FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE,NAVCHGRT'

/**
 * 安全转 float
 */
function toFloat(v) {
  if (v == null || v === '' || v === '--') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

/**
 * 把 FV 原始返回结构转换为与 fetchSingleFundgz 同构的对象
 * (兼容现有 UI: GSZ/GSZZL/DWJZ/SHORTNAME/GZTIME)
 *
 * 关键规则:
 * - 若 GSZ 有值 → 用 GSZ/GSZZL/GZTIME (盘中估算)
 * - 若 GSZ 为 null → 退化为 NAV/NAVCHGRT (上一交易日实际值),
 *   同时把 GZTIME 清空 (UI 看到 null 时间就知道已收盘/无估值)
 */
function mapFVItem(it) {
  const hasGsz = it.GSZ != null
  return {
    FCODE: it.FCODE,
    SHORTNAME: it.SHORTNAME || '',
    GSZ: hasGsz ? toFloat(it.GSZ) : toFloat(it.NAV),
    GSZZL: hasGsz ? toFloat(it.GSZZL) : toFloat(it.NAVCHGRT),
    DWJZ: toFloat(it.NAV),
    GZTIME: hasGsz ? (it.GZTIME || '') : '',
    _hasEstimated: hasGsz
  }
}

/**
 * 批量获取多只基金估值 (POST, 一次最多 500 个)
 * 返回数组, 顺序与 codes 一一对应; 失败的 code 返回 null
 *
 * @param {string[]} codes - 基金代码列表
 * @returns {Promise<Map<string, Object>>} code → 估值对象
 */
export async function fetchFunvaluationBatch(codes) {
  if (!codes || !codes.length) return new Map()
  const body = `FCODES=${encodeURIComponent(codes.join(','))}&FIELDS=${encodeURIComponent(FV_FIELDS)}`

  let lastErr = null
  for (const url of FV_ENDPOINTS) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body,
        signal: controller.signal
      })
      clearTimeout(t)
      if (!r.ok) {
        lastErr = new Error(`FV http ${r.status} from ${url}`)
        continue
      }
      const j = await r.json()
      if (j.errorCode !== 0 || !Array.isArray(j.data)) {
        lastErr = new Error(`FV resp errCode=${j.errorCode} from ${url}`)
        continue
      }
      const map = new Map()
      for (const item of j.data) {
        if (!item || !item.FCODE) continue
        map.set(item.FCODE, mapFVItem(item))
      }
      // 缺失的 code 用 null 填充, 调用方可知道有哪些失败
      for (const code of codes) {
        if (!map.has(code)) map.set(code, null)
      }
      return map
    } catch (e) {
      lastErr = e
    }
  }
  // 所有 endpoint 都失败 → 全部填 null
  const map = new Map()
  for (const code of codes) map.set(code, null)
  map._error = lastErr
  return map
}

/**
 * 单只基金估值补齐 (GET, 用 query string)
 * 失败时返回 null
 */
export async function fetchFunvaluationOne(code) {
  const map = await fetchFunvaluationBatch([code])
  return map.get(code) || null
}


const pingzhongdataQueue = []
let isProcessingPingzhongdata = false

/**
 * 单次获取 pingzhongdata 净值趋势数据
 *
 * 注意：pingzhongdata 接口不支持 CORS，需要用 script 标签加载
 * 脚本会设置全局变量 Data_netWorthTrend 和 fS_name
 */
function fetchPingzhongdataOnce(code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('script load timeout'))
    }, TIMEOUT_MS)

    const script = document.createElement('script')
    // 直接请求外部 API（与 GitHub Pages 一致）
    script.src = `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js?v=${Date.now()}`

    function cleanup() {
      // 清理全局变量
      try { delete window.Data_netWorthTrend } catch (e) {}
      try { delete window.fS_name } catch (e) {}
      if (script.parentNode) {
        document.head.removeChild(script)
      }
    }

    script.onload = () => {
      clearTimeout(timer)
      const trend = window.Data_netWorthTrend || []
      const name = window.fS_name || ''
      resolve({ trend, name })
      cleanup()
    }

    script.onerror = () => {
      clearTimeout(timer)
      cleanup()
      reject(new Error('script load error'))
    }

    document.head.appendChild(script)
  })
}

/**
 * 处理 pingzhongdata 请求队列（带重试）
 */
async function processPingzhongdataQueue() {
  // 如果已有队列在处理中，新请求会等当前处理完后被处理
  if (isProcessingPingzhongdata) return

  isProcessingPingzhongdata = true

  while (pingzhongdataQueue.length > 0) {
    const { code, retries = 3, delay = 100, resolve, reject } = pingzhongdataQueue.shift()

    let lastError = null
    let success = false

    for (let i = 0; i < retries; i++) {
      try {
        const result = await fetchPingzhongdataOnce(code)
        // 有效数据直接返回
        if (result.trend && result.trend.length >= 10) {
          resolve(result)
          success = true
          break
        }
        // 数据无效，等待后重试
        lastError = new Error('insufficient data')
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, delay))
        }
      } catch (e) {
        lastError = e
        // 请求失败，等待后重试
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }

    // 所有重试都失败，拒绝 Promise
    if (!success) {
      reject(lastError || new Error('all retries failed'))
    }
  }

  isProcessingPingzhongdata = false
}

/**
 * 获取 pingzhongdata 净值趋势数据（带请求队列）
 *
 * @param {string} code - 基金代码
 * @param {number} retries - 重试次数（默认3次）
 * @param {number} delay - 重试间隔（默认100ms）
 * @returns {Promise<{trend: Array, name: string}>}
 */
export function fetchPingzhongdata(code, retries = 3, delay = 100) {
  return new Promise((resolve, reject) => {
    pingzhongdataQueue.push({ code, retries, delay, resolve, reject })
    processPingzhongdataQueue()
  })
}