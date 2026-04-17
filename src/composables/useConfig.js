/**
 * 配置管理组合式函数
 *
 * 负责加载和管理基金配置数据：
 * - 基金分组配置（fund_groups.json）
 *
<<<<<<< HEAD
 * 配置在构建时直接 import 嵌入 bundle，
 * 不依赖运行时网络请求，规避 GitHub Pages 路径/缓存问题。
 * 用户通过「管理基金」保存的配置仍优先从 localStorage 读取。
=======
 * 配置文件放在 public/config/ 目录，运行时请求加载
 * 修改配置文件后无需重新构建，刷新页面即可生效
 *
 * fundCodes 由 fund_groups.json 中所有分组的代码合并后去重生成
>>>>>>> lyl-dev-claude
 */

import { ref, computed } from 'vue'
import { getFileContent } from '../api/github'
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage'

import fundCodesData from '../../public/config/fund_codes.json'
import fundGroupsData from '../../public/config/fund_groups.json'

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
<<<<<<< HEAD
      const cached = getStorage(STORAGE_KEYS.USER_CONFIG)
      const hasUserConfig = cached &&
        Array.isArray(cached.fundCodes) &&
        cached.fundCodes.length > 0 &&
        cached.fundGroups

      if (hasUserConfig) {
        fundCodes.value = cached.fundCodes
        fundGroups.value = cached.fundGroups
        console.info('[PXF] 使用用户已保存的配置（localStorage）')
      } else {
        fundCodes.value = Array.isArray(fundCodesData) ? fundCodesData : []
        fundGroups.value = (fundGroupsData && typeof fundGroupsData === 'object') ? fundGroupsData : {}
        console.info('[PXF] 使用构建时嵌入的配置数据')
      }

=======
      const t = Date.now()
      const primaryGroups = `/fund/config/fund_groups.json?t=${t}`
      const fallbackGroups = `https://xuefeng0324.github.io/fund/config/fund_groups.json?t=${t}`

      let groups = null

      try {
        groups = await fetchJsonWithTimeout(primaryGroups)
      } catch (e1) {
        try {
          groups = await fetchJsonWithTimeout(fallbackGroups)
        } catch (e2) {
          const cached = getStorage(STORAGE_KEYS.USER_CONFIG)
          if (cached && cached.fundGroups) {
            fundGroups.value = cached.fundGroups
            return { fundCodes: fundCodes.value, fundGroups: fundGroups.value, fromCache: true }
          }
          throw new Error('配置加载失败')
        }
      }

      fundGroups.value = groups && typeof groups === 'object' ? groups : {}
      setStorage(STORAGE_KEYS.USER_CONFIG, {
        fundGroups: fundGroups.value,
        updatedAt: Date.now()
      })

>>>>>>> lyl-dev-claude
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
    fundGroups,
    configSha,
    loading,
    error,
    loadConfig,
    loadConfigFromGitHub
  }
}
