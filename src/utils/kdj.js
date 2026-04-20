import dayjs from 'dayjs'

/**
 * 计算移动平均值
 *
 * @param {number[]} values - 数值序列
 * @param {number} window - 窗口大小
 * @returns {number|null} 移动平均值，数据不足时返回 null
 */
export function movingAverage(values, window) {
  if (!values || values.length < window) return null
  return values.slice(-window).reduce((a, b) => a + b, 0) / window
}

/**
 * 计算 KDJ 指标
 *
 * 算法说明：
 * 1. 计算 RSV（未成熟随机值）= (收盘价 - N日最低价) / (N日最高价 - N日最低价) × 100
 * 2. K = 2/3 × 前一日K + 1/3 × 当日RSV（首日 K=50）
 * 3. D = 2/3 × 前一日D + 1/3 × 当日K（首日 D=50）
 * 4. J = 3K - 2D
 *
 * @param {number[]} closes - 收盘价序列（按时间升序）
 * @param {number} n - 计算周期，默认 9
 * @returns {Object} { k, d, j, prevJ }
 *   - k: K 线值
 *   - d: D 线值
 *   - j: J 线值（当前）
 *   - prevJ: J 线值（前一日）
 */
export function computeKDJ(closes, n = 9) {
  if (!closes || closes.length < n + 1) {
    return { k: null, d: null, j: null, prevJ: null }
  }

  let k = 50  // 初始 K 值
  let d = 50  // 初始 D 值
  const jList = []

  for (let i = n - 1; i < closes.length; i++) {
    const window = closes.slice(i - n + 1, i + 1)
    const llv = window.reduce((a, b) => a < b ? a : b)
    const hhv = window.reduce((a, b) => a > b ? a : b)
    const c = closes[i]              // 当日收盘价

    // 计算 RSV
    const rsv = hhv === llv ? 50 : ((c - llv) / (hhv - llv)) * 100

    // 计算 K、D
    k = (2 / 3) * k + (1 / 3) * rsv
    d = (2 / 3) * d + (1 / 3) * k
    jList.push(3 * k - 2 * d)
  }

  return {
    k,
    d,
    j: jList[jList.length - 1],
    prevJ: jList.length >= 2 ? jList[jList.length - 2] : null
  }
}

/**
 * 将日净值序列聚合为周线
 *
 * 使用 ISO 周作为聚合键，同一周内取最后一个交易日的净值作为周收盘价
 *
 * @param {Array<Array<string|number>>} daily - 日净值序列 [[日期, 净值], ...]
 * @returns {number[]} 周收盘价序列（按时间升序）
 */
export function groupWeeklyLast(daily) {
  const buckets = {}

  for (const [date, close] of daily) {
    try {
      const d = dayjs(date).toDate()
      // 标准 ISO 周算法：ISO 周四所在的年 + ISO 周数
      const thu = new Date(d)
      thu.setDate(thu.getDate() + 3 - ((thu.getDay() + 6) % 7))
      const isoYear = thu.getFullYear()
      const jan1 = new Date(isoYear, 0, 1)
      const isoWeek = Math.ceil(((thu - jan1) / 86400000 + 1) / 7)
      const key = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`
      buckets[key] = close
    } catch (e) {}
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, close]) => close)
}

/**
 * 检测死叉（MA30 下穿 MA60）
 *
 * 死叉是指短期均线下穿长期均线，通常被视为卖出信号
 *
 * @param {(number|null)[]} ma30List - MA30 序列
 * @param {(number|null)[]} ma60List - MA60 序列
 * @returns {number|null} 死叉位置的索引，无死叉返回 null
 */
export function checkDeadCross(ma30List, ma60List) {
  if (!ma30List || !ma60List || ma30List.length < 2) return null

  // 从后往前查找死叉
  for (let i = ma30List.length - 1; i > 0; i--) {
    const a0 = ma30List[i]
    const b0 = ma60List[i]
    const a1 = ma30List[i - 1]
    const b1 = ma60List[i - 1]

    // 跳过无效数据
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue

    // MA30 下穿 MA60：当日 MA30 < MA60，前一日 MA30 >= MA60
    if (a0 < b0 && a1 >= b1) return i
  }
  return null
}

/**
 * 获取死叉前的最高点（前高）
 *
 * 前高用于判断后续是否突破，是买入/卖出策略的重要参考
 *
 * @param {number[]} closes - 收盘价序列
 * @param {(number|null)[]} ma30List - MA30 序列
 * @param {(number|null)[]} ma60List - MA60 序列
 * @returns {number|null} 前高价格，无法计算时返回 null
 */
export function getPrevHighBeforeDeadCross(closes, ma30List, ma60List) {
  if (!closes || closes.length < 2) return null

  const deadIdx = checkDeadCross(ma30List, ma60List)

  // 无死叉时，取历史最高点
  if (deadIdx === null) {
    return closes.reduce((a, b) => a > b ? a : b)
  }

  // 死叉前取最高点
  if (deadIdx > 0) {
    const prevSlice = closes.slice(0, deadIdx)
    return prevSlice.length ? prevSlice.reduce((a, b) => a > b ? a : b) : null
  }
  return null
}

/**
 * 判断是否进入主升浪
 *
 * 主升浪定义：突破前高后涨幅在 4%-6% 之间
 * 此时通常处于牛市主升阶段，可能继续上涨
 *
 * @param {number} prevHigh - 前高价格
 * @param {number} latest - 当前价格
 * @param {boolean} breakoutPrevHigh - 是否已突破前高
 * @returns {boolean} 是否处于主升浪
 */
export function checkMainRise(prevHigh, latest, breakoutPrevHigh) {
  if (prevHigh == null || prevHigh <= 0 || !breakoutPrevHigh) return false
  const pctRise = ((latest - prevHigh) / prevHigh) * 100
  return pctRise >= 4 && pctRise <= 6
}

/**
 * 计算百分比变化
 *
 * @param {number} a - 当前值
 * @param {number} b - 基准值
 * @returns {number|null} 百分比变化，如 5.5 表示增长 5.5%
 */
export function pctChange(a, b) {
  if (a == null || b == null || b === 0) return null
  return ((a - b) / b) * 100
}