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
const REQUEST_DELAY = 100 // 每个请求间隔 100ms，避免频率限制

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
 */
export function fetchRealtimeAuto(codes, mode = 'auto') {
  return fetchRealtimeBatch(codes).then(batchMap => {
    const missing = []
    codes.forEach(c => {
      const info = batchMap[c]
      if (!info || info.GSZ == null) missing.push(c)
    })
    if (!missing.length) return batchMap

    // 并行请求缺失的基金
    return Promise.all(
      missing.map(c =>
        fetchSingleFundgz(c)
          .then(r => { batchMap[c] = r })
          .catch(() => {})
      )
    ).then(() => batchMap)
  })
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
 * 获取基金数据列表（主入口函数）
 */
export async function fetchFundsLive(fundCodes, mode = 'auto') {
  // 获取基本信息（网络失败时返回空对象，不阻塞主流程）
  const basicInfo = await fetchFundBasicInfo(fundCodes).catch(() => ({}))

  const batchMap = await fetchRealtimeAuto(fundCodes, mode)
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
      // 确保有名称
      if (!info.SHORTNAME && basicInfo[code]) {
        info.SHORTNAME = basicInfo[code]
      }
      results.push(info)
    } else {
      noEstimateCodes.push({ code, info: info || {} })
    }
  })

  if (!noEstimateCodes.length) return results

  // 并行获取无估值基金的上一交易日涨跌
  const promises = noEstimateCodes.map(async item => {
    const lcd = await getLastTradingChange(item.code)
    // 优先使用 lcd 返回的名称
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
 * 获取 pingzhongdata 净值趋势数据（script 标签加载）
 *
 * 注意：pingzhongdata 接口不支持 CORS，需要用 script 标签加载
 * 脚本会设置全局变量 Data_netWorthTrend
 */
export async function fetchPingzhongdata(code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('script load timeout'))
    }, TIMEOUT_MS)

    const script = document.createElement('script')
    // 开发环境使用代理
    const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV
    const baseUrl = isDev ? '/api/eastmoney-fund' : 'https://fund.eastmoney.com'
    script.src = `${baseUrl}/pingzhongdata/${encodeURIComponent(code)}.js?v=${Date.now()}`

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
  }).catch(e => {
    return []
  })
}