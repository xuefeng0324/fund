/**
 * 配置管理组合式函数
 *
 * 负责加载和管理基金配置数据：
 * - 基金分组配置（fund_groups.json）
 *
 * 配置文件放在 public/config/ 目录，运行时请求加载
 * 修改配置文件后无需重新构建，刷新页面即可生效
 *
 * fundCodes 由 fund_groups.json 中所有分组的代码合并后去重生成
 */

import { ref, computed } from 'vue'
import { getFileContent } from '../api/github'
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage'

const CONFIG_FETCH_TIMEOUT = 8000

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
   * 加载配置文件
   */
  async function loadConfig() {
    loading.value = true
    error.value = null

    try {
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

      return { fundCodes: fundCodes.value, fundGroups: fundGroups.value }
    } catch (e) {
      error.value = e.message
      return null
    } finally {
      loading.value = false
    }
  }

  async function fetchJsonWithTimeout(url, timeout = CONFIG_FETCH_TIMEOUT) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => {
      if (ctrl) ctrl.abort()
    }, timeout)
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
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