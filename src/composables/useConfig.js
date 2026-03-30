/**
 * 配置管理组合式函数
 *
 * 负责加载和管理基金配置数据：
 * - 基金代码列表（fund_codes.json）
 * - 基金分组配置（fund_groups.json）
 *
 * 配置文件放在 public/config/ 目录，运行时请求加载
 * 修改配置文件后无需重新构建，刷新页面即可生效
 */

import { ref } from 'vue'
import { getFileContent } from '../api/github'

/**
 * 配置管理 Hook
 *
 * @returns {Object} {
 *   fundCodes,          // 基金代码列表
 *   fundGroups,         // 基金分组配置
 *   configSha,          // 配置文件的 SHA 值（用于 GitHub API 更新）
 *   loading,            // 加载状态
 *   error,              // 错误信息
 *   loadConfig,         // 从 public/config/ 加载配置
 *   loadConfigFromGitHub // 从 GitHub API 加载配置（带 SHA）
 * }
 */
export function useConfig() {
  // 基金代码列表
  const fundCodes = ref([])
  // 基金分组配置 { groupName: [codes] }
  const fundGroups = ref({})
  // 配置文件 SHA 值（用于 GitHub API 更新时检测冲突）
  const configSha = ref({ fundCodes: null, fundGroups: null })
  // 加载状态
  const loading = ref(false)
  // 错误信息
  const error = ref(null)

  /**
   * 加载配置文件
   *
   * 从 public/config/ 目录请求配置文件
   * 添加时间戳参数避免浏览器缓存
   *
   * @returns {Object|null} { fundCodes, fundGroups } 或 null（失败时）
   */
  async function loadConfig() {
    loading.value = true
    error.value = null

    try {
      const t = Date.now()

      // 并行请求两个配置文件
      const [codesRes, groupsRes] = await Promise.all([
        fetch(`/fund/config/fund_codes.json?t=${t}`),
        fetch(`/fund/config/fund_groups.json?t=${t}`)
      ])

      if (!codesRes.ok || !groupsRes.ok) {
        throw new Error('配置文件加载失败')
      }

      fundCodes.value = await codesRes.json()
      fundGroups.value = await groupsRes.json()

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
   *
   * 用于需要更新配置时，获取文件的 SHA 值
   * SHA 是 Git 文件的版本标识，更新时必须提供
   *
   * @param {string} token - GitHub Personal Access Token
   * @returns {Object|null} { fundCodes, fundGroups, sha } 或 null（失败时）
   */
  async function loadConfigFromGitHub(token) {
    try {
      const config = await getFileContent('public/config/fund_codes.json', token)
      const groups = await getFileContent('public/config/fund_groups.json', token)

      fundCodes.value = config.content
      fundGroups.value = groups.content
      configSha.value = {
        fundCodes: config.sha,
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