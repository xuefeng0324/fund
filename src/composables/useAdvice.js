/**
 * 买卖建议组合式函数
 *
 * 基于波段心法计算基金的买卖建议：
 * - 使用 MA30/MA60 均线判断趋势
 * - 使用 KDJ 指标判断超买超卖
 * - 使用周K判断牛熊市
 *
 * 对齐 Python 脚本逻辑：
 * - 分别计算持仓视角（has_position=true）和空仓视角（has_position=false）
 * - 合并两份建议供前端展示
 */

import { ref } from 'vue'
import dayjs from 'dayjs'
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
   * 计算单只基金的买卖建议（单一视角）
   *
   * @param {Object} metrics - 技术指标数据
   * @param {number} gszzl - 估算涨跌幅
   * @param {boolean} hasPosition - 是否持仓
   * @returns {Object} 建议对象 { action, reasons, metrics }
   */
  function buildAdvice(metrics, gszzl, hasPosition) {
    const {
      ma30, ma60, latest, kdj_j, kdj_prev_j,
      weekly_close, ma30_weekly, ma60_weekly,
      has_dead_cross, prev_high, breakout_prev_high, is_main_rise
    } = metrics

    const reasons = []
    let phase = '观望'

    const above60 = latest != null && ma60 != null && latest >= ma60
    const above30 = latest != null && ma30 != null && latest >= ma30
    const zRaw = parseFloat(gszzl)
    const z = Number.isFinite(zRaw) ? zRaw : null

    // KDJ 过滤（J 从下向上穿越 20 作为"低位回升"）
    const kdjOk = kdj_j != null && kdj_j < 20 && (kdj_prev_j == null || kdj_prev_j >= 20)

    // 规则0：清仓 - 周K跌破60日线（熊市信号）
    if (weekly_close != null && ma60_weekly != null && weekly_close < ma60_weekly) {
      if (hasPosition) {
        phase = '熊市'
        reasons.push('周K跌破60日线：牛市结束，建议清仓')
        return { action: '清仓', reasons, metrics: { ...metrics, phase } }
      }
      // 空仓视角：记录信号但不直接返回，继续判断
    }

    // 规则1：止损 - 跌破30日线
    if (!above30) {
      if (hasPosition) {
        phase = '半仓'
        metrics.hit_stop_loss = true
        reasons.push('跌破30日均线：无条件减到半仓（止损/控风险）')
        return { action: '减仓到半仓', reasons, metrics: { ...metrics, phase } }
      }
      // 空仓视角：记录风控信号，继续判断买入
    }

    // 规则2：止盈 - 有涨幅且站上60线或突破前高
    const canTakeProfit = above60 || breakout_prev_high
    let condText = null
    if (above60 && breakout_prev_high) {
      condText = '站上60线并突破前高'
    } else if (above60) {
      condText = '站上60线'
    } else if (breakout_prev_high) {
      condText = '突破前高'
    }

    const tpReasons = []
    if (canTakeProfit && z != null && z > 0) {
      if (z >= 3) {
        tpReasons.push(`${condText}且大涨${z.toFixed(1)}%：推荐卖出`)
      } else if (z >= 1) {
        tpReasons.push(`${condText}且涨幅${z.toFixed(1)}%：考虑卖出`)
      }
      if (kdj_j != null && kdj_j > 80) {
        tpReasons.push('KDJ超买(J>80)')
      }
    }

    if (tpReasons.length && hasPosition) {
      phase = '持有'
      return { action: '考虑减仓', reasons: tpReasons, metrics: { ...metrics, phase } }
    }

    // 反弹减仓提醒：之前跌破30线，反弹回到30线上方
    if (hasPosition && above30 && z != null && z > 0 && metrics.hit_stop_loss) {
      phase = '持有'
      reasons.push('反弹回到30日线上方：建议适当减仓')
      return { action: '反弹减仓', reasons, metrics: { ...metrics, phase } }
    }

    // 空仓视角：日K在30线上方，不追高，观望
    if (!hasPosition && above30) {
      phase = '观望'
      reasons.push('日K在30日线上方：观望，暂不买入')
      return { action: '观望', reasons, metrics: { ...metrics, phase } }
    }

    // 规则3：买入 - 前提：跌幅>=1% 且 周K在60线上方
    const canBuy = z != null && z <= -1 &&
      weekly_close != null && ma60_weekly != null && weekly_close >= ma60_weekly

    if (canBuy) {
      // 波段心法1：周K在60线上方 + 日K跌破60线
      if (weekly_close != null && ma60_weekly != null && weekly_close >= ma60_weekly && !above60) {
        phase = '波段心法1'
        reasons.push('波段心法1：周K突破60线，日K跌破60线后买入（牛市早期短线）')
        return { action: '波段买入1', reasons, metrics: { ...metrics, phase } }
      }

      // 波段心法2：日K在60线上方 + 未突破前高
      if (above60 && !breakout_prev_high) {
        phase = '波段心法2'
        reasons.push('波段心法2：日K60线上方，突破前高之前逢低买入（牛市前期长线）')
        if (kdjOk) {
          reasons.push('KDJ辅助：J值从高位回落到20以下，进入超跌反弹区')
        }
        return { action: '波段买入2', reasons, metrics: { ...metrics, phase } }
      }

      // 波段心法3：突破前高后回踩30日线 + 死叉
      if (breakout_prev_high && !above60 && has_dead_cross) {
        if (weekly_close != null && ma30_weekly != null) {
          const dist = pctChange(weekly_close, ma30_weekly)
          if (dist != null && dist >= -2 && dist <= 1) {
            phase = '波段心法3'
            if (dist < 0) {
              reasons.push('波段心法3：突破前高后，周K回踩30日线，日K死叉后买入（牛回头）')
            } else {
              reasons.push('波段心法3提示：接近周K30日线（1-2%），即将可以买入')
            }
            return { action: '波段买入3', reasons, metrics: { ...metrics, phase } }
          }
        }
      }

      // 反弹心法：主升后回调 + J值低位
      if (is_main_rise && above30 && kdj_j != null && kdj_j < 20) {
        phase = '反弹心法'
        reasons.push('反弹心法：主升后回调，J<20，未跌破30线，小仓位买入（反弹概率高）')
        return { action: '反弹买入', reasons, metrics: { ...metrics, phase } }
      }
    }

    // 默认：趋势正常
    if (hasPosition) {
      phase = '持有'
      reasons.push('趋势正常，持有观望')
      return { action: '持有', reasons, metrics: { ...metrics, phase } }
    } else {
      phase = '观望'
      reasons.push('趋势正常，暂无明显买卖信号，继续观望')
      return { action: '观望', reasons, metrics: { ...metrics, phase } }
    }
  }

  /**
   * 合并持仓视角和空仓视角的建议
   */
  function mergeAdvice(hold, flat) {
    if (!flat) return hold

    const actHold = (hold.action || '观望').trim()
    const actFlat = (flat.action || '观望').trim()

    const reasonsHold = hold.reasons || []
    const reasonsFlat = flat.reasons || []
    const mergedReasons = []
    if (reasonsHold.length) mergedReasons.push('持仓：' + reasonsHold.join('；'))
    if (reasonsFlat.length) mergedReasons.push('空仓：' + reasonsFlat.join('；'))

    const metrics = { ...(hold.metrics || {}) }
    const phaseHold = (hold.metrics || {}).phase
    const phaseFlat = (flat.metrics || {}).phase
    if (phaseHold || phaseFlat) {
      metrics.phase = phaseHold || phaseFlat
    }
    metrics.hold_action = actHold
    metrics.flat_action = actFlat
    metrics.hold_reasons = reasonsHold
    metrics.flat_reasons = reasonsFlat

    let action
    if (actHold === actFlat) {
      action = `持仓/空仓:${actHold}`
    } else {
      action = `持仓:${actHold} / 空仓:${actFlat}`
    }

    return { action, reasons: mergedReasons, metrics }
  }

  /**
   * 计算单只基金的买卖建议（持仓+空仓合并）
   *
   * @param {string} code - 基金代码
   * @param {number} gszzl - 估算涨跌幅
   * @returns {Promise<Object>} 建议对象
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
      const weeklyData = trend.map(it => [dayjs(it.x).format('YYYY-MM-DD'), it.y])
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
        kdj_prev_j: kdj.prevJ,
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

      if (lastNav == null || ma30 == null || ma60 == null) {
        return { action: '观望', reasons: ['数据不足'], metrics }
      }

      // 分别计算持仓视角和空仓视角
      const advHold = buildAdvice({ ...metrics }, gszzl, true)
      const advFlat = buildAdvice({ ...metrics }, gszzl, false)

      return mergeAdvice(advHold, advFlat)
    } catch (e) {
      return { action: '观望', reasons: ['计算错误'], metrics: {} }
    }
  }

  /**
   * 批量加载建议
   *
   * @param {string[]} codes - 基金代码数组
   * @param {Object} fundsMap - 基金实时数据映射 { code: { GSZZL, ... } }
   */
  async function loadAdvice(codes, fundsMap = {}) {
    if (!codes || !codes.length) return

    loading.value = true

    const REQUEST_DELAY = 150

    try {
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i]
        const fundData = fundsMap[code]
        const gszzl = fundData?.GSZZL ?? null
        const advice = await getTradeAdvice(code, gszzl)
        adviceData.value[code] = advice

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
