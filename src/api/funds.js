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

/**
 * 获取今日日期字符串
 */
function todayStr() {
  const d = new Date()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day
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
    // jsonpgz(); 空数据调用，没有 code 信息
    // 假设是等待队列中最早的请求
    const firstEntry = pendingRequests.entries().next()
    if (!firstEntry.done) {
      const [code, pending] = firstEntry.value
      clearTimeout(pending.timer)
      pendingRequests.delete(code)
      // 返回空数据，resolve 而不是 reject，让调用方检查 GSZ/GSZZL
      pending.resolve({
        FCODE: code,
        SHORTNAME: '',
        GSZ: null,
        GSZZL: null,
        DWJZ: null,
        GZTIME: ''
      })
    }
    return
  }

  const code = data.fundcode
  const pending = pendingRequests.get(code)
  if (!pending) return

  clearTimeout(pending.timer)
  pendingRequests.delete(code)
  pending.resolve({
    FCODE: code,
    SHORTNAME: data.name || '',
    GSZ: safeFloat(data.gsz),
    GSZZL: safeFloat(data.gszzl),
    DWJZ: safeFloat(data.dwjz),
    GZTIME: data.gztime || ''
  })
}

// 处理请求队列
async function processQueue() {
  if (isProcessingQueue) return
  isProcessingQueue = true

  while (requestQueue.length > 0) {
    const { code, resolve, reject } = requestQueue.shift()

    // 检查是否已有相同请求在等待
    const existing = pendingRequests.get(code)
    if (existing) {
      existing.resolve = resolve
      existing.reject = reject
      continue
    }

    const timer = setTimeout(() => {
      pendingRequests.delete(code)
      reject(new Error('jsonp timeout'))
    }, TIMEOUT_MS)

    pendingRequests.set(code, { resolve, reject, timer })

    const script = document.createElement('script')
    script.src = 'https://fundgz.1234567.com.cn/js/' + encodeURIComponent(code) + '.js?rt=' + Date.now()
    script.onerror = () => {
      pendingRequests.delete(code)
      clearTimeout(timer)
      reject(new Error('jsonp error (likely frequency capped)'))
      if (script.parentNode) document.head.removeChild(script)
      // 频率限制时，暂停一段时间
      if (requestQueue.length > 0) {
        setTimeout(() => processQueue(), 500)
        isProcessingQueue = false
        return
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

/**
 * 构建基金结果数组
 *
 * @param {string[]} fundCodes 基金代码数组
 * @param {Object} batchMap 批量结果映射
 * @param {Object} basicInfo 基金名称映射
 * @returns {Object} { results, noEstimateCodes }
 */
export function buildResults(fundCodes, batchMap, basicInfo = {}) {
  const results = []
  const noEstimateCodes = []
  const today = todayStr()

  fundCodes.forEach(code => {
    const info = batchMap[code]
    if (info && info.GSZ != null) {
      const pdate = (info.PDATE || '').trim()
      if (pdate && pdate === today && info.DWJZ != null) {
        info.GSZ = info.DWJZ
        info.GZTIME = pdate
      }
      results.push(info)
    } else {
      noEstimateCodes.push({ code, info: info || {} })
    }
  })
  return { results, noEstimateCodes }
}

/**
 * 获取无估值基金的上一交易日涨跌数据
 *
 * @param {Array} noEstimateCodes 无估值基金列表 [{ code, info }]
 * @param {Object} basicInfo 基金名称映射
 * @returns {Promise<Array>} 补充的基金数据数组
 */
export async function fetchNoEstimateFunds(noEstimateCodes, basicInfo = {}) {
  const results = []
  const promises = noEstimateCodes.map(async item => {
    const lcd = await getLastTradingChange(item.code)
    const shortName = lcd.name || basicInfo[item.code] || item.info.SHORTNAME || ''
    results.push({
      FCODE: item.code,
      SHORTNAME: shortName,
      GSZ: null,
      GSZZL: null,
      GZTIME: lcd.date,
      LAST_CHG: lcd.change
    })
  })
  await Promise.all(promises)
  return results
}

/**
 * pingzhongdata 请求队列
 *
 * 由于 pingzhongdata 使用全局变量 Data_netWorthTrend 和 fS_name，
 * 并发请求会导致竞态条件。使用请求队列确保同一时间只有一个请求执行。
 */
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