<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-backdrop" @click.self="close">
      <div class="modal-panel">
        <div class="modal-header">
          <div class="modal-title">管理基金列表</div>
          <button class="close-btn" @click="close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="add-fund-row">
            <input
              v-model="newCode"
              type="text"
              placeholder="输入6位基金代码"
              class="code-input"
              @keypress.enter="addFund"
              maxlength="6"
            />
            <button class="add-btn" @click="addFund" :disabled="adding || !newCode.trim()">
              <span v-if="adding" class="spinner"></span>
              {{ adding ? '添加中' : '添加' }}
            </button>
          </div>

          <div class="fund-count">共 {{ managedCodes.length }} 只基金</div>

          <div class="fund-list">
            <div v-for="code in managedCodes" :key="code" class="fund-item">
              <div class="fund-info">
                <span class="fund-code">{{ code }}</span>
                <span class="fund-name">{{ fundNames[code] || '--' }}</span>
              </div>
              <button class="del-btn" @click="removeFund(code)">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>

          <div v-if="managedCodes.length === 0" class="empty-state">
            暂无基金，请添加
          </div>
        </div>

        <div class="modal-footer">
          <button class="cancel-btn" @click="close">取消</button>
          <button class="save-btn" @click="save" :disabled="saving || managedCodes.length === 0">
            <span v-if="saving" class="spinner"></span>
            {{ saving ? '保存中' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { getFileContent, updateFile } from '../api/github'

const props = defineProps({
  keyValue: { type: String, required: true }
})

const emit = defineEmits(['close', 'saved'])

const visible = ref(true)
const newCode = ref('')
const adding = ref(false)
const saving = ref(false)
const managedCodes = ref([])
const fundNames = ref({})

// GitHub API 相关
const groupsSha = ref('')
const codesSha = ref('')
const allCodes = ref([])

// 加载当前分组的基金列表
async function loadGroupCodes() {
  try {
    // 从 GitHub API 加载获取 SHA
    const groups = await getFileContent('public/config/fund_groups.json')
    fundGroups.value = groups.content
    groupsSha.value = groups.sha
    managedCodes.value = groups.content[props.keyValue] || []

    // 加载基金名称
    await loadFundNames()
  } catch (e) {
    console.error('加载分组失败:', e)
    // 回退到本地加载
    const res = await fetch('/fund/config/fund_groups.json?t=' + Date.now())
    const groups = await res.json()
    managedCodes.value = groups[props.keyValue] || []
    await loadFundNames()
  }
}

// 加载所有配置（包括 fund_codes）
async function loadAllConfig() {
  try {
    const [codes, groups] = await Promise.all([
      getFileContent('public/config/fund_codes.json'),
      getFileContent('public/config/fund_groups.json')
    ])
    allCodes.value = codes.content
    codesSha.value = codes.sha
    fundGroups.value = groups.content
    groupsSha.value = groups.sha
    managedCodes.value = groups.content[props.keyValue] || []
    await loadFundNames()
  } catch (e) {
    console.error('加载配置失败:', e)
  }
}

const fundGroups = ref({})

// 加载基金名称
async function loadFundNames() {
  if (!managedCodes.value.length) return

  try {
    // 使用批量接口获取基金名称
    const codes = managedCodes.value.join(',')
    const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=200&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=Wap&Fcodes=${encodeURIComponent(codes)}`

    const res = await fetch(url)
    const data = await res.json()

    if (data.Datas) {
      data.Datas.forEach(item => {
        if (item.FCODE && item.SHORTNAME) {
          fundNames.value[item.FCODE] = item.SHORTNAME
        }
      })
    }
  } catch (e) {
    console.error('加载基金名称失败:', e)
  }
}

// 添加基金
async function addFund() {
  const code = newCode.value.trim()
  if (!/^\d{6}$/.test(code)) {
    alert('请输入6位基金代码')
    return
  }

  if (managedCodes.value.includes(code)) {
    alert('该基金已在列表中')
    return
  }

  adding.value = true

  try {
    managedCodes.value.push(code)

    // 获取新添加基金的名称
    await loadSingleFundName(code)

    newCode.value = ''
  } finally {
    adding.value = false
  }
}

// 加载单个基金名称
async function loadSingleFundName(code) {
  try {
    const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=200&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=Wap&Fcodes=${encodeURIComponent(code)}`

    const res = await fetch(url)
    const data = await res.json()

    if (data.Datas && data.Datas[0]) {
      fundNames.value[code] = data.Datas[0].SHORTNAME || '--'
    }
  } catch (e) {
    console.error('加载基金名称失败:', e)
    fundNames.value[code] = '--'
  }
}

// 删除基金
function removeFund(code) {
  managedCodes.value = managedCodes.value.filter(c => c !== code)
}

// 保存
async function save() {
  if (!managedCodes.value.length) {
    alert('基金列表不能为空')
    return
  }

  saving.value = true

  try {
    // 更新分组
    fundGroups.value[props.keyValue] = managedCodes.value

    // 合并所有代码（去重）
    const allGroupCodes = Object.values(fundGroups.value).flat()
    const uniqueCodes = [...new Set([...allCodes.value, ...allGroupCodes])]

    // 更新 fund_groups.json
    await updateFile(
      'public/config/fund_groups.json',
      fundGroups.value,
      groupsSha.value,
      undefined,
      `Update fund groups for ${props.keyValue}`
    )

    // 更新 fund_codes.json（如果有新代码）
    if (uniqueCodes.length !== allCodes.value.length) {
      await updateFile(
        'public/config/fund_codes.json',
        uniqueCodes,
        codesSha.value,
        undefined,
        'Update fund codes'
      )
    }

    alert('基金列表已保存到 GitHub')
    emit('saved')
    close()
  } catch (e) {
    console.error('保存失败:', e)
    alert('保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

function close() {
  visible.value = false
  emit('close')
}

onMounted(loadAllConfig)

watch(() => props.keyValue, loadAllConfig)
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-panel {
  background: #ffffff;
  border-radius: 16px;
  padding: 0;
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e5e7eb;
}

.modal-title {
  font-weight: 700;
  font-size: 18px;
  color: #1f2937;
}

.close-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #6b7280;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.close-btn:hover {
  background: #f3f4f6;
  color: #1f2937;
}

.modal-body {
  padding: 24px;
  max-height: 50vh;
  overflow-y: auto;
}

.add-fund-row {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.code-input {
  flex: 1;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid #d1d5db;
  font-size: 15px;
  background: #fff;
  transition: all 0.15s;
}

.code-input:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.add-btn {
  padding: 12px 24px;
  border-radius: 10px;
  border: none;
  background: #4f46e5;
  color: #fff;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}

.add-btn:hover:not(:disabled) {
  background: #4338ca;
}

.add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fund-count {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 12px;
  font-weight: 500;
}

.fund-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fund-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: #f9fafb;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  transition: all 0.15s;
}

.fund-item:hover {
  border-color: #d1d5db;
  background: #f3f4f6;
}

.fund-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.fund-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 15px;
  font-weight: 700;
  color: #1f2937;
}

.fund-name {
  font-size: 14px;
  color: #6b7280;
  font-weight: 500;
}

.del-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #9ca3af;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.del-btn:hover {
  background: #fee2e2;
  color: #dc2626;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #9ca3af;
  font-size: 14px;
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.cancel-btn {
  padding: 12px 24px;
  border-radius: 10px;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  transition: all 0.15s;
}

.cancel-btn:hover {
  border-color: #9ca3af;
  background: #f9fafb;
}

.save-btn {
  padding: 12px 28px;
  border-radius: 10px;
  border: none;
  background: #4f46e5;
  color: #fff;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}

.save-btn:hover:not(:disabled) {
  background: #4338ca;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>