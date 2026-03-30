/**
 * GitHub REST API 封装模块
 *
 * 主要功能：
 * 1. 读取仓库中的配置文件（fund_codes.json, fund_groups.json）
 * 2. 更新仓库中的配置文件（需要 GitHub Token 授权）
 *
 * API 文档：https://docs.github.com/zh/rest/repos/contents
 */

const GITHUB_API = 'https://api.github.com'
const REPO_OWNER = 'xuefeng0324'
const REPO_NAME = 'fund'
const BRANCH = 'lyl-dev-claude'  // 指定分支

// 从环境变量获取 GitHub Token（VITE_GITHUB_TOKEN）
const GITHUB_TOKEN = import.meta.env.VITE_GITHUB_TOKEN || ''

/**
 * 获取文件内容和 SHA 值
 *
 * 调用 GitHub Contents API 获取指定文件的内容
 * 返回解析后的 JSON 内容和文件的 SHA 值（用于后续更新）
 *
 * @param {string} path - 文件路径（相对于仓库根目录）
 * @param {string} token - GitHub Personal Access Token（可选，默认使用环境变量）
 * @returns {Promise<Object>} { content, sha }
 *
 * @throws {Error} 如果请求失败（如文件不存在、无权限等）
 */
export async function getFileContent(path, token = GITHUB_TOKEN) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${BRANCH}`, {
    headers: {
      'Authorization': token ? `token ${token}` : '',
      'Accept': 'application/vnd.github.v3+json'
    }
  })
  if (!res.ok) {
    throw new Error(`获取文件失败: ${res.status}`)
  }
  const data = await res.json()
  return {
    content: JSON.parse(atob(data.content)),
    sha: data.sha
  }
}

/**
 * 更新 GitHub 仓库中的文件
 *
 * 调用 GitHub Contents API 更新指定文件
 * 需要提供文件的 SHA 值（通过 getFileContent 获取）
 *
 * @param {string} path - 文件路径
 * @param {Object} content - 新的文件内容（JSON 对象）
 * @param {string} sha - 文件的当前 SHA 值
 * @param {string} token - GitHub Personal Access Token
 * @param {string} message - 提交信息
 * @returns {Promise<Object>} GitHub API 响应
 *
 * @throws {Error} 如果更新失败（如 SHA 不匹配、无权限等）
 */
export async function updateFile(path, content, sha, token = GITHUB_TOKEN, message) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': token ? `token ${token}` : '',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: message || `Update ${path}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
      sha: sha,
      branch: BRANCH
    })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`更新文件失败: ${res.status} - ${text}`)
  }
  // 处理 204 No Content
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return { success: true, status: res.status }
  }
  return res.json()
}

/**
 * 获取所有配置文件
 *
 * 同时获取 fund_codes.json 和 fund_groups.json
 * 用于在管理界面初始化时加载当前配置
 *
 * @returns {Promise<Object>} { fundCodes, fundCodesSha, fundGroups, fundGroupsSha }
 */
export async function getConfigFiles() {
  const [codes, groups] = await Promise.all([
    getFileContent('public/config/fund_codes.json'),
    getFileContent('public/config/fund_groups.json')
  ])
  return {
    fundCodes: codes.content,
    fundCodesSha: codes.sha,
    fundGroups: groups.content,
    fundGroupsSha: groups.sha
  }
}

/**
 * 更新配置文件
 *
 * 批量更新 fund_codes.json 和 fund_groups.json
 * 使用 Promise.allSettled 确保即使某个文件更新失败，也不会影响其他文件
 *
 * @param {Array} fundCodes - 基金代码数组
 * @param {string} fundCodesSha - fund_codes.json 的 SHA 值
 * @param {Object} fundGroups - 基金分组对象 { key: [codes] }
 * @param {string} fundGroupsSha - fund_groups.json 的 SHA 值
 * @param {string} message - 提交信息
 * @returns {Promise<Array>} 更新结果数组
 */
export async function updateConfigFiles(fundCodes, fundCodesSha, fundGroups, fundGroupsSha, message) {
  const results = await Promise.allSettled([
    fundCodes && fundCodesSha ? updateFile('public/config/fund_codes.json', fundCodes, fundCodesSha, GITHUB_TOKEN, message) : null,
    fundGroups && fundGroupsSha ? updateFile('public/config/fund_groups.json', fundGroups, fundGroupsSha, GITHUB_TOKEN, message) : null
  ])
  return results
}