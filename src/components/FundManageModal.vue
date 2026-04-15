<template>
  <el-dialog
    v-model="dialogVisible"
    title="管理基金列表"
    :close-on-click-modal="false"
    class="fund-manage-dialog"
    @closed="handleClosed"
  >
    <div class="add-fund-section">
      <div class="add-fund-row">
        <el-input
          v-model="newCode"
          placeholder="输入6位基金代码"
          maxlength="6"
          class="code-input"
          @keyup.enter="addFund"
        />
        <el-button
          type="primary"
          :loading="adding"
          :disabled="!newCode.trim()"
          @click="addFund"
        >
          {{ adding ? '添加中' : '添加' }}
        </el-button>
      </div>
    </div>

    <div class="fund-count">共 <span class="count-num">{{ managedCodes.length }}</span> 只基金</div>

    <div v-if="managedCodes.length > 0" class="fund-list">
      <div v-for="code in managedCodes" :key="code" class="fund-item">
        <div class="fund-info">
          <span class="fund-code">{{ code }}</span>
          <span class="fund-name">{{ props.fundNameMap[code] || '--' }}</span>
        </div>
        <button class="remove-btn" @click="removeFund(code)" title="移除">
          <el-icon><CircleCloseFilled /></el-icon>
        </button>
      </div>
    </div>

    <el-empty v-else description="暂无基金，请添加" :image-size="80" />

    <div v-if="loading" class="loading-mask">
      <el-icon class="loading-spinner"><Loading /></el-icon>
      <span>加载中...</span>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="close" :disabled="loading">取消</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="managedCodes.length === 0 || loading"
          @click="save"
        >
          {{ saving ? '保存中' : '保存' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { CircleCloseFilled, Loading } from '@element-plus/icons-vue'
import { getFileContent, updateFile } from '../api/github'
import { ElMessage } from 'element-plus'

const props = defineProps({
  keyValue: { type: String, required: true },
  fundNameMap: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['close', 'saved'])

// 使用 defineModel 双向绑定
const dialogVisible = defineModel({ default: true })

const newCode = ref('')
const adding = ref(false)
const saving = ref(false)
const loading = ref(false)
const managedCodes = ref([])

const groupsSha = ref('')
const fundGroups = ref({})

// 监听打开状态，重置内部状态
watch(dialogVisible, (val) => {
  if (val) {
    // 重置状态
    newCode.value = ''
    loadAllConfig()
  }
})

async function loadAllConfig() {
  loading.value = true
  try {
    const groups = await getFileContent('public/config/fund_groups.json')
    fundGroups.value = groups.content
    groupsSha.value = groups.sha
    managedCodes.value = groups.content[props.keyValue] || []
  } catch (e) {
    ElMessage.error('加载配置失败')
  } finally {
    loading.value = false
  }
}

async function addFund() {
  const code = newCode.value.trim()
  if (!/^\d{6}$/.test(code)) {
    ElMessage.warning('请输入6位基金代码')
    return
  }

  if (managedCodes.value.includes(code)) {
    ElMessage.warning('该基金已在列表中')
    return
  }

  adding.value = true
  try {
    managedCodes.value.push(code)
    newCode.value = ''
    ElMessage.success(`已添加 ${code}`)
  } finally {
    adding.value = false
  }
}

function removeFund(code) {
  managedCodes.value = managedCodes.value.filter(c => c !== code)
}

async function save() {
  if (!managedCodes.value.length) {
    ElMessage.warning('基金列表不能为空')
    return
  }

  saving.value = true

  try {
    fundGroups.value[props.keyValue] = managedCodes.value
    // 所有分组的代码合并去重生成 fundCodes
    const uniqueCodes = [...new Set(Object.values(fundGroups.value).flat())]

    await updateFile(
      'public/config/fund_groups.json',
      fundGroups.value,
      groupsSha.value,
      undefined,
      `Update fund groups for ${props.keyValue}`
    )

    ElMessage.success('基金列表已保存到 GitHub')

    // 直接传递更新后的数据给父组件，避免等待 GitHub Pages 部署
    emit('saved', {
      fundGroups: fundGroups.value,
      fundCodes: uniqueCodes,
      key: props.keyValue
    })
    close()
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

function close() {
  dialogVisible.value = false
}

function handleClosed() {
  emit('close')
}

// 监听 keyValue 变化，重新加载对应分组的基金
watch(() => props.keyValue, (newKey) => {
  if (dialogVisible.value && newKey) {
    managedCodes.value = fundGroups.value[newKey] || []
  }
})
</script>

<style scoped>
.loading-mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  z-index: 10;
  border-radius: 12px;
}

.loading-spinner {
  font-size: 32px;
  color: #0052ff;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loading-mask span {
  font-size: 14px;
  color: #5b616e;
}

.add-fund-section {
  margin-bottom: 20px;
}

.add-fund-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.code-input {
  flex: 1;
}

.fund-count {
  font-size: 13px;
  color: #5b616e;
  margin-bottom: 12px;
  font-weight: 500;
}

.count-num {
  color: #0052ff;
  font-weight: 700;
}

.fund-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 4px;
}

.fund-list::-webkit-scrollbar {
  width: 6px;
}

.fund-list::-webkit-scrollbar-track {
  background: transparent;
}

.fund-list::-webkit-scrollbar-thumb {
  background: rgba(91, 97, 110, 0.3);
  border-radius: 3px;
}

.fund-list::-webkit-scrollbar-thumb:hover {
  background: rgba(91, 97, 110, 0.5);
}

.fund-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid rgba(91, 97, 110, 0.2);
  transition: all 0.2s ease;
}

.fund-item:hover {
  border-color: #0052ff;
  box-shadow: 0 2px 8px rgba(0, 82, 255, 0.1);
}

.fund-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.fund-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  font-weight: 700;
  color: #0a0b0d;
  flex-shrink: 0;
}

.fund-name {
  font-size: 13px;
  color: #5b616e;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #5b616e;
  cursor: pointer;
  border-radius: 50%;
  transition: all 0.2s ease;
  flex-shrink: 0;
  margin-left: 8px;
}

.remove-btn:hover {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.1);
}

.remove-btn .el-icon {
  font-size: 18px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .add-fund-section {
    margin-bottom: 16px;
  }

  .add-fund-row {
    gap: 10px;
  }

  .fund-count {
    margin-bottom: 10px;
  }

  .fund-list {
    max-height: 45vh;
    gap: 6px;
  }

  .fund-item {
    padding: 10px 12px;
    border-radius: 12px;
  }

  .fund-info {
    gap: 8px;
  }

  .fund-code {
    font-size: 13px;
  }

  .fund-name {
    font-size: 12px;
  }

  .remove-btn {
    width: 26px;
    height: 26px;
    margin-left: 6px;
  }

  .remove-btn .el-icon {
    font-size: 16px;
  }

  .dialog-footer {
    gap: 6px;
  }
}

@media (max-width: 480px) {
  .add-fund-row {
    gap: 8px;
  }

  .fund-list {
    max-height: 40vh;
  }

  .fund-item {
    padding: 8px 10px;
  }

  .fund-code {
    font-size: 12px;
  }

  .fund-name {
    font-size: 11px;
  }
}
</style>

<style>
/* 全局样式 - 覆盖 Element Plus 内联样式 */
.fund-manage-dialog {
  --el-dialog-width: 480px;
}

.fund-manage-dialog .el-dialog {
  width: var(--el-dialog-width) !important;
  max-width: 90vw;
  border-radius: 24px;
}

.fund-manage-dialog .el-dialog__header {
  padding: 16px 20px;
  margin-right: 0;
}

.fund-manage-dialog .el-dialog__body {
  padding: 16px 20px;
}

.fund-manage-dialog .el-dialog__footer {
  padding: 12px 20px;
}

.fund-manage-dialog .el-dialog__footer .el-button {
  min-width: 80px;
}

/* 平板端 */
@media screen and (max-width: 768px) {
  .fund-manage-dialog {
    --el-dialog-width: 96%;
  }

  .fund-manage-dialog .el-dialog {
    width: var(--el-dialog-width) !important;
    max-width: 96% !important;
    margin: auto !important;
    top: 50% !important;
    transform: translateY(-50%);
    max-height: 85vh;
  }

  .fund-manage-dialog .el-dialog__header {
    padding: 14px 16px;
  }

  .fund-manage-dialog .el-dialog__title {
    font-size: 16px;
    font-weight: 600;
  }

  .fund-manage-dialog .el-dialog__body {
    padding: 14px 16px;
    max-height: calc(85vh - 130px);
    overflow-y: auto;
  }

  .fund-manage-dialog .el-dialog__footer {
    padding: 12px 16px;
  }

  .fund-manage-dialog .el-dialog__footer .el-button {
    min-width: 70px;
    padding: 8px 16px;
  }
}

/* 手机端 */
@media screen and (max-width: 480px) {
  .fund-manage-dialog {
    --el-dialog-width: 96%;
  }

  .fund-manage-dialog .el-dialog {
    width: var(--el-dialog-width) !important;
    max-width: 96% !important;
    margin: 0 auto !important;
    border-radius: 16px !important;
  }

  .fund-manage-dialog .el-dialog__header {
    padding: 12px 14px;
  }

  .fund-manage-dialog .el-dialog__title {
    font-size: 15px;
  }

  .fund-manage-dialog .el-dialog__body {
    padding: 12px 14px;
  }

  .fund-manage-dialog .el-dialog__footer {
    padding: 10px 14px;
  }

  .fund-manage-dialog .el-dialog__footer .el-button {
    min-width: 60px;
    padding: 6px 12px;
    font-size: 13px;
  }
}
</style>