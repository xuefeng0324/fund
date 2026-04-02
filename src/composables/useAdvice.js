/**
 * 买卖建议组合式函数
 *
 * 基于波段心法计算基金的买卖建议：
 * - 使用 MA30/MA60 均线判断趋势
 * - 使用 KDJ 指标判断超买超卖
 * - 使用周K判断牛熊市
 */

import { ref } from 'vue'
import { fetchPingzhongdata } from '../api/funds'
import {
  computeKDJ,
  groupWeeklyLast,
  movingAverage,
  checkDeadCross,
  getPrevHighBeforeDeadCross,
  checkMainRise,
  pctChange
} from '../utils/kdj'

/**
 * 买卖建议管理 Hook
 */
export function useAdvice() {
  /** @type {import('vue').Ref<Object>} 建议数据 { code: advice } */
  const adviceData = ref({})
  /** @type {import('vue').Ref<boolean>} 加载状态 */
  const loading = ref(false)

  /**
   * 计算单只基金的买卖建议
   *
   * @param {string} code - 基金代码
   * @param {number} gszzl - 估算涨跌幅（可选）
   * @returns {Promise<Object>} 建议对象 { action, reasons, metrics }
   */
  async function getTradeAdvice(code, gszzl = null) {
    try {
      const result = await fetchPingzhongdata(code)
      const trend = result.trend || []

      if (!trend || trend.length < 10) {
        return { action: '观望', reasons: ['无法获取净值序列'], metrics: {} }
      }

      // 日线数据
      const closes = trend.map(it => it.y).filter(y => y != null)
      const lastNav = closes[closes.length - 1]
      const ma30 = movingAverage(closes, 30)
      const ma60 = movingAverage(closes, 60)

      // KDJ 指标
      const kdj = computeKDJ(closes, 9)

      // 周K数据
      const weeklyData = trend.map(it => [new Date(it.x).toISOString().slice(0, 10), it.y])
      const weeklyCloses = groupWeeklyLast(weeklyData)
      const weeklyClose = weeklyCloses[weeklyCloses.length - 1]
      const ma30Weekly = movingAverage(weeklyCloses, 30)
      const ma60Weekly = movingAverage(weeklyCloses, 60)

      // 计算历史均线序列（用于检测死叉）
      const ma30List = []
      const ma60List = []
      for (let i = 0; i < closes.length; i++) {
        ma30List.push(i >= 29 ? movingAverage(closes.slice(0, i + 1), 30) : null)
        ma60List.push(i >= 59 ? movingAverage(closes.slice(0, i + 1), 60) : null)
      }

      // 死叉/前高/主升浪判断
      const hasDeadCross = checkDeadCross(ma30List, ma60List) !== null
      const prevHigh = getPrevHighBeforeDeadCross(closes, ma30List, ma60List)
      const breakoutPrevHigh = prevHigh != null && lastNav > prevHigh
      const isMainRise = checkMainRise(prevHigh, lastNav, breakoutPrevHigh)

      const metrics = {
        ma30,
        ma60,
        latest: lastNav,
        kdj_k: kdj.k,
        kdj_d: kdj.d,
        kdj_j: kdj.j,
        j_daily_3m: kdj.j,
        j_weekly_1y: computeKDJ(weeklyCloses, 9).j,
        weekly_close: weeklyClose,
        ma30_weekly: ma30Weekly,
        ma60_weekly: ma60Weekly,
        has_dead_cross: hasDeadCross,
        prev_high: prevHigh,
        breakout_prev_high: breakoutPrevHigh,
        is_main_rise: isMainRise,
        gszzl
      }

      return buildAdvice(metrics, gszzl)
    } catch (e) {
      return { action: '观望', reasons: ['计算错误'], metrics: {} }
    }
  }

  /**
   * 构建买卖建议
   *
   * 建议优先级：清仓 > 止损 > 止盈 > 买入 > 持有/观望
   *
   * @param {Object} metrics - 技术指标数据
   * @param {number} gszzl - 估算涨跌幅
   * @returns {Object} 建议对象
   */
  function buildAdvice(metrics, gszzl) {
    const { ma30, ma60, latest, kdj_j, weekly_close, ma30_weekly, ma60_weekly, has_dead_cross, prev_high, breakout_prev_high, is_main_rise } = metrics

    const holdReasons = []
    const flatReasons = []
    let holdAction = '持有'
    let flatAction = '观望'
    let phase = '观望'

    const above60 = latest != null && ma60 != null && latest >= ma60
    const above30 = latest != null && ma30 != null && latest >= ma30
    const z = gszzl != null ? parseFloat(gszzl) : null

    // 规则1：清仓 - 周K跌破60日线（熊市信号）
    if (weekly_close != null && ma60_weekly != null && weekly_close < ma60_weekly) {
      phase = '熊市'
      holdAction = '清仓'
      holdReasons.push('周K跌破60日线：牛市结束')
      flatAction = '观望'
      flatReasons.push('周K跌破60日线：不进场')
      return { action: '清仓', reasons: holdReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
    }

    // 规则2：止损 - 跌破30日线
    if (!above30) {
      phase = '止损'
      holdAction = '减到半仓'
      holdReasons.push('跌破30日均线：止损控风险')
      flatAction = '观望'
      flatReasons.push('跌破30日均线：不进场')
      return { action: '减仓', reasons: holdReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
    }

    // 规则3：止盈 - 有涨幅且站上60线或突破前高
    const canTakeProfit = above60 || breakout_prev_high
    if (canTakeProfit && z != null && z > 0) {
      phase = '持有'
      if (z >= 3) {
        holdReasons.push(`涨幅${z.toFixed(1)}%：考虑减仓`)
      } else if (z >= 1) {
        holdReasons.push(`涨幅${z.toFixed(1)}%：可持有`)
      }
      if (kdj_j != null && kdj_j > 80) {
        holdReasons.push('KDJ超买(J>80)')
      }
      if (holdReasons.length) {
        holdAction = '持有'
        flatAction = '观望'
        flatReasons.push('已有涨幅：暂不追高')
        return { action: '持有', reasons: holdReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
      }
    }

    // 规则4：买入 - 跌幅大于1%
    const canBuy = z != null && z <= -1

    if (canBuy) {
      // 波段心法1：周K在60线上方 + 日K跌破60线
      if (weekly_close != null && ma60_weekly != null && weekly_close >= ma60_weekly && !above60) {
        phase = '波段心法1'
        holdAction = '持有'
        holdReasons.push('跌破60线：持有等待')
        flatAction = '买入'
        flatReasons.push('周K60线上，日K跌破60线：短线买入')
        return { action: '波段买入1', reasons: flatReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
      }

      // 波段心法2：日K在60线上方 + 未突破前高
      if (above60 && !breakout_prev_high) {
        phase = '波段心法2'
        holdAction = '持有'
        holdReasons.push('60线上持有')
        flatAction = '买入'
        flatReasons.push('60线上未突破前高：长线买入')
        if (kdj_j != null && kdj_j < 20) {
          flatReasons.push('J值低位，超跌反弹区')
        }
        return { action: '波段买入2', reasons: flatReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
      }

      // 波段心法3：突破前高后回踩30日线
      if (breakout_prev_high && !above60 && has_dead_cross) {
        if (weekly_close != null && ma30_weekly != null) {
          const dist = pctChange(weekly_close, ma30_weekly)
          if (dist != null && dist >= -2 && dist <= 1) {
            phase = '波段心法3'
            holdAction = '持有'
            holdReasons.push('牛回头持有')
            flatAction = '买入'
            flatReasons.push('突破前高后回踩30日线：牛回头买入')
            return { action: '波段买入3', reasons: flatReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
          }
        }
      }

      // 反弹心法：主升后回调 + J值低位
      if (is_main_rise && above30 && kdj_j != null && kdj_j < 20) {
        phase = '反弹心法'
        holdAction = '持有'
        holdReasons.push('主升回调持有')
        flatAction = '小仓买入'
        flatReasons.push('J<20未跌破30线：反弹概率高')
        return { action: '反弹买入', reasons: flatReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
      }
    }

    // 默认：趋势正常
    phase = '观望'
    holdAction = '持有'
    holdReasons.push('趋势正常')
    flatAction = '观望'
    flatReasons.push('无明显信号')
    return { action: '持有', reasons: holdReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
  }

  /**
   * 批量加载建议
   *
   * 使用请求间隔避免一次性请求过多
   *
   * @param {string[]} codes - 基金代码数组
   */
  async function loadAdvice(codes) {
    if (!codes || !codes.length) return

    loading.value = true

    const REQUEST_DELAY = 150 // 每个请求间隔 150ms

    try {
      // 串行请求，添加间隔
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i]
        const advice = await getTradeAdvice(code)
        adviceData.value[code] = advice

        // 最后一个请求不需要等待
        if (i < codes.length - 1) {
          await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY))
        }
      }
    } finally {
      loading.value = false
    }
  }

  return {
    adviceData,
    loading,
    getTradeAdvice,
    loadAdvice
  }
}