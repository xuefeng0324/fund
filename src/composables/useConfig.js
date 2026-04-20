/**
 * 配置管理组合式函数
 *
 * 负责加载和管理基金配置数据：
 * - 基金分组配置（fund_groups.json）
 * - 基金交易规则（fund_info.json）
 *
 * 配置在构建时直接 import 嵌入 bundle，
 * 不依赖运行时网络请求，规避 GitHub Pages 路径/缓存问题。
 * 用户通过「管理基金」保存的配置仍优先从 localStorage 读取。
 */

import { ref, computed } from 'vue'
import { getFileContent } from '../api/github'
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage'

import fundGroupsData from '../../public/config/fund_groups.json'
import fundInfoData from '../../public/config/fund_info.json'

/**
 * 配置管理 Hook
 */
export function useConfig() {
  const fundGroups = ref({})
  // fundCodes 由 fund_groups.json 中所有分组代码合并去重生成
  const fundCodes = computed(() => {
    const allCodes = Object.values(fundGroups.value).flat()
    return [...new Set(allCodes)]
  })

  // 基金代码 → 买入确认日映射
  const fundInfoMap = computed(() => {
    const map = {}
    if (Array.isArray(fundInfoData)) {
      fundInfoData.forEach(item => {
        if (item.fund_code) {
          map[item.fund_code] = item.buy_confirm_date
        }
      })
    }
    return map
  })
  const configSha = ref({ fundGroups: null })
  const loading = ref(false)
  const error = ref(null)

  /**
   * 加载配置：localStorage 用户覆盖优先，否则使用构建时嵌入的 JSON
   */
  async function loadConfig() {
    loading.value = true
    error.value = null

    try {
      const cached = getStorage(STORAGE_KEYS.USER_CONFIG)
      const hasUserConfig = cached &&
        Array.isArray(cached.fundCodes) &&
        cached.fundCodes.length > 0 &&
        cached.fundGroups

      if (hasUserConfig) {
        fundGroups.value = cached.fundGroups
        console.info('[PXF] 使用用户已保存的配置（localStorage）')
      } else {
        fundGroups.value = (fundGroupsData && typeof fundGroupsData === 'object') ? fundGroupsData : {}
        console.info('[PXF] 使用构建时嵌入的配置数据')
      }

      return { fundCodes: fundCodes.value, fundGroups: fundGroups.value }
    } catch (e) {
      error.value = e.message
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 通过 GitHub API 获取配置
   */
  async function loadConfigFromGitHub(token) {
    try {
      const groups = await getFileContent('public/config/fund_groups.json', token)

      fundGroups.value = groups.content
      configSha.value = {
        fundGroups: groups.sha
      }

      return {
        fundCodes: fundCodes.value,
        fundGroups: fundGroups.value,
        sha: configSha.value
      }
    } catch (e) {
      return null
    }
  }

  return {
    fundCodes,
    fundInfoMap,
    fundGroups,
    configSha,
    loading,
    error,
    loadConfig,
    loadConfigFromGitHub
  }
}
