/**
 * 买卖建议组合式函数
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

export function useAdvice() {
  const adviceData = ref({})
  const loading = ref(false)

  /**
   * 计算单只基金的买卖建议
   */
  async function getTradeAdvice(code, gszzl = null, hasPosition = true) {
    try {
      const result = await fetchPingzhongdata(code)
      const trend = result.trend || []

      if (!trend || trend.length < 10) {
        return { action: '观望', reasons: ['无法获取净值序列'], metrics: {} }
      }

      const closes = trend.map(it => it.y).filter(y => y != null)
      const lastNav = closes[closes.length - 1]
      const ma30 = movingAverage(closes, 30)
      const ma60 = movingAverage(closes, 60)

      // KDJ
      const kdj = computeKDJ(closes, 9)

      // 周K数据
      const weeklyData = trend.map(it => [new Date(it.x).toISOString().slice(0, 10), it.y])
      const weeklyCloses = groupWeeklyLast(weeklyData)
      const weeklyClose = weeklyCloses[weeklyCloses.length - 1]
      const ma30Weekly = movingAverage(weeklyCloses, 30)
      const ma60Weekly = movingAverage(weeklyCloses, 60)

      // 死叉/前高/主升浪
      const ma30List = []
      const ma60List = []
      for (let i = 0; i < closes.length; i++) {
        ma30List.push(i >= 29 ? movingAverage(closes.slice(0, i + 1), 30) : null)
        ma60List.push(i >= 59 ? movingAverage(closes.slice(0, i + 1), 60) : null)
      }

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

      return buildAdvice(metrics, gszzl, hasPosition)
    } catch (e) {
      return { action: '观望', reasons: ['计算错误'], metrics: {} }
    }
  }

  /**
   * 构建建议
   */
  function buildAdvice(metrics, gszzl, hasPosition) {
    const { ma30, ma60, latest, kdj_j, weekly_close, ma30_weekly, ma60_weekly, has_dead_cross, prev_high, breakout_prev_high, is_main_rise } = metrics

    const holdReasons = []
    const flatReasons = []
    let holdAction = '持有'
    let flatAction = '观望'
    let phase = '观望'

    const above60 = latest != null && ma60 != null && latest >= ma60
    const above30 = latest != null && ma30 != null && latest >= ma30
    const z = gszzl != null ? parseFloat(gszzl) : null

    // 1. 清仓规则：周K跌破60日线
    if (weekly_close != null && ma60_weekly != null && weekly_close < ma60_weekly) {
      phase = '熊市'
      holdAction = '清仓'
      holdReasons.push('周K跌破60日线：牛市结束')
      flatAction = '观望'
      flatReasons.push('周K跌破60日线：不进场')
      return { action: '清仓', reasons: holdReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
    }

    // 2. 止损规则：跌破30日线
    if (!above30) {
      phase = '止损'
      holdAction = '减到半仓'
      holdReasons.push('跌破30日均线：止损控风险')
      flatAction = '观望'
      flatReasons.push('跌破30日均线：不进场')
      return { action: '减仓', reasons: holdReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
    }

    // 3. 止盈规则
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

    // 4. 买入规则
    const canBuy = z != null && z <= -1

    if (canBuy) {
      // 波段心法1
      if (weekly_close != null && ma60_weekly != null && weekly_close >= ma60_weekly && !above60) {
        phase = '波段心法1'
        holdAction = '持有'
        holdReasons.push('跌破60线：持有等待')
        flatAction = '买入'
        flatReasons.push('周K60线上，日K跌破60线：短线买入')
        return { action: '波段买入1', reasons: flatReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
      }

      // 波段心法2
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

      // 波段心法3
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

      // 反弹心法
      if (is_main_rise && above30 && kdj_j != null && kdj_j < 20) {
        phase = '反弹心法'
        holdAction = '持有'
        holdReasons.push('主升回调持有')
        flatAction = '小仓买入'
        flatReasons.push('J<20未跌破30线：反弹概率高')
        return { action: '反弹买入', reasons: flatReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
      }
    }

    // 默认
    phase = '观望'
    holdAction = '持有'
    holdReasons.push('趋势正常')
    flatAction = '观望'
    flatReasons.push('无明显信号')
    return { action: '持有', reasons: holdReasons, metrics: { ...metrics, phase, hold_action: holdAction, flat_action: flatAction, hold_reasons: holdReasons, flat_reasons: flatReasons } }
  }

  /**
   * 批量加载建议
   */
  async function loadAdvice(codes) {
    if (!codes || !codes.length) return

    loading.value = true

    try {
      const promises = codes.map(async code => {
        const advice = await getTradeAdvice(code)
        return [code, advice]
      })

      const results = await Promise.all(promises)
      adviceData.value = Object.fromEntries(results)
    } catch (e) {
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