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
   * 1. fundgz 获取实时数据，成功则直接使用
   * 2. fundgz 返回空数据或失败重试3次后，调用 pingzhongdata 作为备选
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
      // 所有代码都需要通过 fundgz 获取
      const missing = [...codes]

      // 逐个获取基金数据，全部完成后再关闭 loading
      async function fetchWithRetry(code, remainRetries = 3) {
        try {
          const r = await fetchSingleFundgz(code)
          if (r && (r.GSZ != null || r.GSZZL != null)) {
            // 获取历史净值数据用于判断是否已更新
            const buyConfirmDate = fundInfoMap[code]
            let historyData = null
            try {
              historyData = await getLastTradingChange(code)
            } catch {}
            const isUpdated = checkIsUpdated(buyConfirmDate, historyData?.date)

            const fundData = {
              ...r,
              isUpdated,
              historyNav: historyData?.nav,
              historyChange: historyData?.change,
              historyDate: historyData?.date
            }
            const idx = funds.value.findIndex(f => f.FCODE === code)
            if (idx >= 0) funds.value[idx] = fundData
            else funds.value.push(fundData)
            if (r.SHORTNAME) fundNameMap[code] = r.SHORTNAME
            lastUpdate.value = new Date()
          } else {
            throw new Error('fundgz empty response')
          }
        } catch (e) {
          if (remainRetries > 0 && e.message !== 'fundgz empty response') {
            await new Promise(resolve => setTimeout(resolve, 150))
            return fetchWithRetry(code, remainRetries - 1)
          }
          try {
            const lcd = await getLastTradingChange(code)
            if (lcd.change !== null) {
              const buyConfirmDate = fundInfoMap[code]
              const isUpdated = checkIsUpdated(buyConfirmDate, lcd.date)
              const fundData = {
                FCODE: code,
                SHORTNAME: lcd.name || '',
                GSZ: lcd.nav,
                GSZZL: lcd.change,
                GZTIME: lcd.date,
                LAST_CHG: lcd.change,
                isUpdated,
                historyNav: lcd.nav,
                historyChange: lcd.change,
                historyDate: lcd.date
              }
              const idx = funds.value.findIndex(f => f.FCODE === code)
              if (idx >= 0) funds.value[idx] = fundData
              else funds.value.push(fundData)
              if (lcd.name) fundNameMap[code] = lcd.name
              lastUpdate.value = new Date()
            }
          } catch {
            // 两个数据源都失败，跳过该基金
          }
        }
      }

      await Promise.allSettled(missing.map(code => fetchWithRetry(code)))
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