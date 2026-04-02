/**
 * 基金数据组合式函数
 *
 * 封装基金数据的获取、状态管理和错误处理逻辑
 * 作为组件与 API 模块之间的桥梁
 */

import { ref, reactive } from 'vue'
import {
  fetchRealtimeAuto,
  fetchSingleFundgz,
  fetchFundBasicInfo,
  buildResults,
  fetchNoEstimateFunds
} from '../api/funds'

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
   * 加载基金数据
   *
   * 流程：
   * 1. 批量获取基金数据，立即显示有估值的基金
   * 2. 无估值基金立即获取上一交易日涨跌数据
   * 3. fundgz 异步补齐，结果返回时替换对应基金数据
   *
   * @param {string[]} codes - 基金代码数组
   * @param {string} mode - 数据获取模式（'auto' | 'em' | 'fundgz' 等）
   */
  async function loadFunds(codes, mode = 'auto') {
    if (!codes || !codes.length) {
      funds.value = []
      return
    }

    loading.value = true
    error.value = null

    try {
      // 并行获取基本信息和批量数据
      const [basicInfo, { batchMap, missing }] = await Promise.all([
        fetchFundBasicInfo(codes).catch(() => ({})),
        fetchRealtimeAuto(codes, mode)
      ])

      // 构建初始结果（有估值的基金）
      const { results, noEstimateCodes } = buildResults(codes, batchMap)

      // 立即更新名称缓存（从 basicInfo）
      Object.entries(basicInfo).forEach(([code, name]) => {
        if (name) {
          fundNameMap[code] = name
        }
      })

      // 立即设置有估值的结果
      funds.value = results

      // 同时处理无估值基金（获取上一交易日涨跌）和 fundgz 补齐
      // 1. 无估值基金获取上一交易日涨跌数据
      if (noEstimateCodes.length > 0) {
        // 异步获取，不阻塞 fundgz
        fetchNoEstimateFunds(noEstimateCodes, basicInfo).then(extraResults => {
          // 添加到 funds（只添加还没有 fundgz 结果的基金）
          extraResults.forEach(f => {
            // 更新名称缓存
            if (f.SHORTNAME) {
              fundNameMap[f.FCODE] = f.SHORTNAME
            }
            const existing = funds.value.find(item => item.FCODE === f.FCODE)
            // 只添加还没有估值数据的基金（fundgz 可能已经返回了）
            if (!existing || existing.GSZ == null) {
              if (!existing) {
                funds.value.push(f)
              }
            }
          })
          lastUpdate.value = new Date()
        })
      }

      // 2. fundgz 异步补齐缺失数据（带重试）
      if (missing.length > 0) {
        missing.forEach(code => {
          async function fetchWithRetry(remainRetries = 3) {
            try {
              const r = await fetchSingleFundgz(code)
              // 查找是否已存在这只基金
              const idx = funds.value.findIndex(f => f.FCODE === code)
              if (idx >= 0) {
                // 替换为 fundgz 结果（有实时估值）
                funds.value[idx] = r
              } else {
                // 添加新基金
                funds.value.push(r)
              }
              // 更新名称缓存
              if (r.SHORTNAME) {
                fundNameMap[code] = r.SHORTNAME
              }
              lastUpdate.value = new Date()
            } catch (e) {
              // 请求失败，重试
              if (remainRetries > 0) {
                await new Promise(resolve => setTimeout(resolve, 150))
                return fetchWithRetry(remainRetries - 1)
              }
              // 重试耗尽，不做处理
            }
          }
          fetchWithRetry()
        })
      }

      // 补充名称（从 basicInfo）
      funds.value.forEach(f => {
        if (!f.SHORTNAME && basicInfo[f.FCODE]) {
          f.SHORTNAME = basicInfo[f.FCODE]
          fundNameMap[f.FCODE] = f.SHORTNAME
        }
      })

      lastUpdate.value = new Date()
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
    loadFunds
  }
}