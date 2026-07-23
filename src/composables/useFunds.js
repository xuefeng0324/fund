/**
 * 基金数据组合式函数
 *
 * 封装基金数据的获取、状态管理和错误处理逻辑
 * 作为组件与 API 模块之间的桥梁
 */

import { ref, reactive } from 'vue'
import dayjs from 'dayjs'
import {
  fetchSingleFundgz,
  fetchFunvaluationBatch,
  fetchPingzhongdata,
  getLastTradingChange
} from '../api/funds'

// 工作日判断（周一到周五）
function isBusinessDay(date) {
  const day = date.day()
  return day !== 0 && day !== 6
}

// 获取前N个工作日
function getPrevBusinessDay(date, n) {
  let d = dayjs(date)
  let count = 0
  while (count < n) {
    d = d.subtract(1, 'day')
    if (isBusinessDay(d)) {
      count++
    }
  }
  return d
}

/**
 * 基金数据管理 Hook
 *
 * @returns {Object} {
 *   funds,       // 基金列表响应式数据
 *   fundNameMap, // 基金代码→名称映射缓存
 *   loading,     // 加载状态
 *   error,       // 错误信息
 *   lastUpdate,  // 最后更新时间
 *   loadFunds    // 加载基金数据方法
 * }
 */
export function useFunds() {
  // 基金列表数据
  const funds = ref([])
  // 基金名称缓存：{ code: name }（使用 reactive 确保深层响应式）
  const fundNameMap = reactive({})
  // 加载状态
  const loading = ref(false)
  // 错误信息
  const error = ref(null)
  // 最后更新时间
  const lastUpdate = ref(null)

  /**
   * 检查基金是否已更新（净值已更新）
   * @param {number} buyConfirmDate - 买入确认日（T+N）
   * @param {string} historyDate - 历史净值日期（YYYY-MM-DD格式）
   * @returns {boolean}
   */
  function checkIsUpdated(buyConfirmDate, historyDate) {
    if (!buyConfirmDate || !historyDate || historyDate === '--') {
      return false
    }
    const today = dayjs()
    // 期望的历史日期：今天 - (T+N - 1) 个工作日
    // T+1: today - 0 = today → 今天
    // T+2: today - 1 = 昨天 → 今天-1
    const expectedDate = getPrevBusinessDay(today, buyConfirmDate - 1)
    const historyDateObj = dayjs(historyDate)
    return historyDateObj.isSame(expectedDate, 'day')
  }

  /**
   * 加载基金数据
   *
   * 流程：
   * 1. 一次批量调用 FundValuationLast (替代 fundgz, 53 个基金 145ms)
   * 2. 有 GSZ 的 → 直接用作盘中估算
   * 3. 无 GSZ 但有 NAV → 退化为上一交易日实际值, 标记 _hasEstimated=false
   * 4. FV 完全没返回 → 调用 pingzhongdata 兜底
   *
   * @param {string[]} codes - 基金代码数组
   * @param {Object} fundInfoMap - 基金信息映射 { code: buyConfirmDate }
   */
  async function loadFunds(codes, fundInfoMap = {}) {
    if (!codes || !codes.length) {
      funds.value = []
      return
    }

    loading.value = true
    error.value = null

    // 刷新前先清空表格数据
    funds.value = []

    try {
      // ===== 第 1 步: 批量 FV 接口 (替代 fundgz) =====
      const fvMap = await fetchFunvaluationBatch(codes)
      if (fvMap._error) {
        // 批量接口失败 → 把错误留给下面的兜底处理
        // eslint-disable-next-line no-console
        console.warn('FV batch failed, fallback to pingzhongdata', fvMap._error)
      }

      const failedCodes = []
      let hasAny = false

      for (const code of codes) {
        const r = fvMap.get(code)
        const buyConfirmDate = fundInfoMap[code]

        // PDATE 是 FV 返回的"净值日期" (YYYY-MM-DD),
        // 跟原 pingzhongdata 拉到的 historyDate 含义一致, 直接用
        // 仅在 FV 没数据或日期无效时, 才退回到 pingzhongdata
        let historyDate = (r && r.PDATE) || null
        let historyNav = r ? r.DWJZ : null
        let historyChange = r ? r.GSZZL : null
        let isUpdated = false

        if (historyDate) {
          // 兼容: PDATE 可能 "2026-07-22" (10 字符) 或 "20260722" (8 字符)
          if (historyDate.length === 8 && !historyDate.includes('-')) {
            historyDate = `${historyDate.slice(0,4)}-${historyDate.slice(4,6)}-${historyDate.slice(6,8)}`
          }
          isUpdated = checkIsUpdated(buyConfirmDate, historyDate)
        }
        if (isNaN(historyNav)) historyNav = null
        if (isNaN(historyChange)) historyChange = null

        if (r && (r.GSZ != null || r.GSZZL != null)) {
          // FV 有估算 (盘中) 或有 NAV 收盘值
          const fundData = {
            FCODE: r.FCODE,
            SHORTNAME: r.SHORTNAME,
            GSZ: r.GSZ,
            GSZZL: r.GSZZL,
            DWJZ: r.DWJZ,
            GZTIME: r.GZTIME,
            LAST_CHG: r.GSZZL, // 兼容字段, UI 用作"上一交易日涨跌幅"等
            isUpdated,
            historyNav,
            historyChange,
            historyDate,
            // 标记是盘中估值还是上一交易日实际值, UI 可用 (角标/样式)
            _hasEstimated: r._hasEstimated,
            PDATE: r.PDATE
          }
          const idx = funds.value.findIndex(f => f.FCODE === code)
          if (idx >= 0) funds.value[idx] = fundData
          else funds.value.push(fundData)
          if (r.SHORTNAME) fundNameMap[code] = r.SHORTNAME
          hasAny = true
        } else {
          // FV 没数据 → 进入 pingzhongdata 兜底队列
          failedCodes.push(code)
        }
      }

      // ===== 第 2 步: FV 失败的代码走 pingzhongdata 串行兜底 =====
      if (failedCodes.length > 0) {
        async function fallbackOne(code) {
          try {
            const lcd = await getLastTradingChange(code)
            if (lcd.change !== null || lcd.nav !== null) {
              const buyConfirmDate = fundInfoMap[code]
              const isUpdated = checkIsUpdated(buyConfirmDate, lcd.date)
              const fundData = {
                FCODE: code,
                SHORTNAME: lcd.name || '',
                GSZ: lcd.nav,
                GSZZL: lcd.change,
                DWJZ: lcd.nav,
                GZTIME: lcd.date,
                LAST_CHG: lcd.change,
                isUpdated,
                historyNav: lcd.nav,
                historyChange: lcd.change,
                historyDate: lcd.date,
                _hasEstimated: false,
                _dataSource: 'pingzhongdata'
              }
              const idx = funds.value.findIndex(f => f.FCODE === code)
              if (idx >= 0) funds.value[idx] = fundData
              else funds.value.push(fundData)
              if (lcd.name) fundNameMap[code] = lcd.name
              hasAny = true
            }
          } catch {
            // 彻底拿不到数据, 跳过
          }
        }
        // 串行执行, 避免 pingzhongdata 全局变量竞态
        for (const code of failedCodes) {
          await fallbackOne(code)
        }
      }

      if (hasAny) {
        lastUpdate.value = new Date()
      }
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  return {
    funds,
    fundNameMap,
    loading,
    error,
    lastUpdate,
    loadFunds,
    checkIsUpdated
  }
}