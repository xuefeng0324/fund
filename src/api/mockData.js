/**
 * Mock 数据模块
 * 当所有外部 API 均不可用时，用本地 mock 数据作为降级方案
 * 确保页面至少能展示基金列表和基本涨跌信息
 */

function safeFloat(v) {
  if (v == null || v === '' || v === '--') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function todayStr() {
  const d = new Date()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day
}

/**
 * 生成基于 fundCodes 的稳定 mock 数据
 * 使用基金代码作为种子，确保每次刷新数据有合理波动
 */
export function generateMockData(fundCodes) {
  const today = todayStr()
  return fundCodes.map((code, idx) => {
    // 用代码字符生成伪随机种子
    const seed = code.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const pseudoRandom = (n) => {
      const x = Math.sin(seed + n) * 10000
      return x - Math.floor(x)
    }

    // 生成合理范围的涨跌数据
    const changePct = (pseudoRandom(1) - 0.48) * 6 // -3% ~ +3%
    const gsz = 1 + (pseudoRandom(2) - 0.5) * 0.5 // 0.75 ~ 1.25
    const dwjz = gsz / (1 + changePct / 100)

    const names = [
      '沪深300指数A', '中证500指数C', '创业板指基', '上证50增强',
      '军工ETF联接', '医药卫生ETF', '新能源车ETF', '半导体ETF',
      '食品饮料ETF', '银行ETF联接', '券商ETF基金', '地产ETF链接'
    ]
    const name = names[idx % names.length] + (idx >= names.length ? ` ${Math.floor(idx / names.length) + 1}号` : '')

    return {
      FCODE: code,
      SHORTNAME: name,
      GSZ: safeFloat(gsz.toFixed(4)),
      GSZZL: safeFloat(changePct.toFixed(2)),
      DWJZ: safeFloat(dwjz.toFixed(4)),
      GZTIME: today + ' 15:00',
      PDATE: today,
      IS_MOCK: true
    }
  })
}

/**
 * 判断是否所有 API 均失败（用于决定是否启用 mock）
 * 由 funds.js 在 fetchRealtimeAuto 中调用
 */
export function shouldUseMockData(results, originalCodes) {
  if (!originalCodes || !originalCodes.length) return false
  // 如果超过 80% 的基金代码在结果中没有数据，启用 mock
  const hasData = originalCodes.filter(code => {
    const info = results[code]
    return info && (info.GSZ != null || info.LAST_CHG != null)
  }).length
  return hasData / originalCodes.length < 0.2
}
