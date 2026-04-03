/**
 * 基金数据 API 模块
 *
 * 主要功能：
 * 1. 批量获取基金实时估值（东财 FundMNFInfo 接口）
 * 2. 单只基金估值补齐（fundgz.1234567 JSONP 接口）
 * 3. 获取基金上一交易日涨跌数据（pingzhongdata 接口）
 */

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

/**
 * 获取昨天的日期字符串
 */
function yesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const m = d.getMonth() + 1
  const day = d.getDate()
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day
}

/**
 * 从 GZTIME 提取日期
 * @param {string} gztime - 如 "2026-04-03 15:00" 或 "2026-04-03"
 * @returns {string} - 如 "2026-04-03"
 */
function extractDateFromGztime(gztime) {
  if (!gztime) return ''
  const match = gztime.match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

/**
 * 判断是否为 T+2 基金（QDII 或香港互认基金）
 *
 * T+2 基金类型：
 * 1. QDII 基金：名称包含 (QDII)
 * 2. 香港互认基金：代码以 968 开头
 *
 * @param {string} code - 基金代码
 * @param {string} shortName - 基金名称
 * @returns {boolean}
 */
export function isT2Fund(code, shortName) {
  // 1. QDII 基金：名称包含 (QDII)
  if (shortName && shortName.toUpperCase().includes('QDII')) {
    return true
  }
  // 2. 香港互认基金：代码以 968 开头
  if (code && code.startsWith('968')) {
    return true
  }
  return false
}

/**
 * 判断基金净值是否已更新
 *
 * T+1 基金：gztime == today → 已更新
 * T+2 基金：gztime == yesterday → 已更新
 *
 * @param {string} gztime - 估值时间
 * @param {boolean} isT2 - 是否为 T+2 基金
 * @returns {boolean}
 */
export function isNavUpdated(gztime, isT2 = false) {
  const dateStr = extractDateFromGztime(gztime)
  if (!dateStr) return false

  const today = todayStr()
  const yesterday = yesterdayStr()

  if (isT2) {
    // T+2 基金：gztime 是昨天算已更新
    return dateStr === yesterday
  } else {
    // T+1 基金：gztime 是今天算已更新
    return dateStr === today
  }
}

// ===== 核心数据获取函数 =====

/**
 * 批量获取基金实时估值
 *
 * 使用东财 FundMNFInfo 接口，一次请求最多 200 只基金
 */
export function fetchRealtimeBatch(codes) {
  if (!codes || !codes.length) return Promise.resolve({})

  // 如果超过 200 只，分批并行请求
  const batchSize = 200
  if (codes.length > batchSize) {
    const batches = []
    for (let i = 0; i < codes.length; i += batchSize) {
      batches.push(codes.slice(i, i + batchSize))
    }
    return Promise.all(batches.map(batch => fetchSingleBatch(batch)))
      .then(results => Object.assign({}, ...results))
  }

  return fetchSingleBatch(codes)
}

function fetchSingleBatch(codes) {
  const url =
    'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo' +
    '?pageIndex=1&pageSize=200&plat=Android&appType=ttjj&product=EFund&Version=1' +
    '&deviceid=Wap&Fcodes=' + encodeURIComponent(codes.join(','))

  return fetch(url)
    .then(r => r.json())
    .then(data => {
      const map = {}
      const datas = (data && data.Datas) || []
      datas.forEach(item => {
        if (!item || !item.FCODE) return
        map[item.FCODE] = {
          FCODE: item.FCODE,
          SHORTNAME: item.SHORTNAME || '',
          GSZ: safeFloat(item.GSZ),
          GSZZL: safeFloat(item.GSZZL),
          DWJZ: safeFloat(item.NAV),
          GZTIME: item.GZTIME || '',
          PDATE: item.PDATE || ''
        }
      })
      return map
    })
    .catch(() => ({}))
}

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
  if (!data || !data.fundcode) return
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

/**
 * 自动获取基金实时估值（批量 + 单只补齐）
 *
 * 返回批量结果，缺失基金的 fundgz 请求列表
 */
export async function fetchRealtimeAuto(codes, mode = 'auto') {
  const batchMap = await fetchRealtimeBatch(codes)
  const missing = []
  codes.forEach(c => {
    const info = batchMap[c]
    if (!info || info.GSZ == null) missing.push(c)
  })
  return { batchMap, missing }
}

/**
 * 获取基金基本信息（名称等）
 */
export function fetchFundBasicInfo(codes) {
  if (!codes || !codes.length) return Promise.resolve({})

  const url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo' +
    '?pageIndex=1&pageSize=' + codes.length + '&plat=Android&appType=ttjj&product=EFund&Version=1' +
    '&deviceid=Wap&Fcodes=' + encodeURIComponent(codes.join(','))

  return fetch(url)
    .then(r => r.json())
    .then(data => {
      const map = {}
      const datas = (data && data.Datas) || []
      datas.forEach(item => {
        if (!item || !item.FCODE) return
        map[item.FCODE] = item.SHORTNAME || ''
      })
      return map
    })
    .catch(() => ({}))
}

export function getLastTradingChange(code) {
  return fetchPingzhongdata(code).then(result => {
    // result 可能是数组或 { trend, name } 对象
    const trend = (result && result.trend) ? result.trend : (Array.isArray(result) ? result : [])
    if (!trend || !trend.length) return { change: null, date: '--', name: '' }
    const last = trend[trend.length - 1]
    const change = safeFloat(last.equityReturn)
    let dateStr = '--'
    try { dateStr = new Date(last.x).toISOString().slice(0, 10) } catch (e) {}
    // 基金名称通过 fS_name 获取
    const name = (result && result.name) ? result.name : ''
    return { change, date: dateStr, name: name || window.fS_name || '' }
  }).catch(e => {
    return { change: null, date: '--', name: '' }
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
    const shortName = info.SHORTNAME || basicInfo[code] || ''
    const isT2 = isT2Fund(code, shortName)

    if (info && info.GSZ != null) {
      const pdate = (info.PDATE || '').trim()

      // 如果 PDATE 是今天且 DWJZ 不为空，用实际净值替换 GSZ
      // 这表示今天实际净值已公布
      if (pdate && pdate === today && info.DWJZ != null) {
        info.GSZ = info.DWJZ
        info.GZTIME = pdate
      }

      // 判断是否已更新
      // T+1: gztime == today
      // T+2: gztime == yesterday
      const updated = isNavUpdated(info.GZTIME, isT2)

      // 添加更新状态标记和 T+2 标记
      info.isNavUpdated = updated
      info.isT2 = isT2

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

    // 判断是否为 T+2 基金
    const isT2 = isT2Fund(item.code, shortName)

    // 判断是否已更新
    // T+1: lcd.date == today
    // T+2: lcd.date == yesterday
    const updated = isNavUpdated(lcd.date, isT2)

    results.push({
      FCODE: item.code,
      SHORTNAME: shortName,
      GSZ: null,
      GSZZL: null,
      GZTIME: lcd.date,
      LAST_CHG: lcd.change,
      isNavUpdated: updated,
      isT2: isT2
    })
  })
  await Promise.all(promises)
  return results
}

/**
 * 单次获取 pingzhongdata 净值趋势数据
 *
 * 注意：pingzhongdata 接口不支持 CORS，需要用 script 标签加载
 * 脚本会设置全局变量 Data_netWorthTrend
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
      try { delete window.fS_name } catch (e) {}
      try { delete window.Data_netWorthTrend } catch (e) {}
      if (script.parentNode) {
        document.head.removeChild(script)
      }
    }

    script.onload = () => {
      clearTimeout(timer)
      const trend = window.Data_netWorthTrend || []
      const name = window.fS_name || ''  // 先保存 name
      resolve({ trend, name })
      cleanup()  // cleanup 放在 resolve 之后
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
 * 获取 pingzhongdata 净值趋势数据（带重试策略）
 *
 * @param {string} code - 基金代码
 * @param {number} retries - 重试次数（默认3次）
 * @param {number} delay - 重试间隔（默认100ms）
 * @returns {Promise<{trend: Array, name: string}>}
 */
export async function fetchPingzhongdata(code, retries = 3, delay = 100) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await fetchPingzhongdataOnce(code)
      // 如果获取到有效数据，返回
      if (result.trend && result.trend.length >= 10) {
        return result
      }
      // 数据无效，等待后重试
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay))
      }
    } catch (e) {
      // 请求失败，等待后重试
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  // 所有重试都失败，返回空数据
  return { trend: [], name: '' }
}