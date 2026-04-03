<template>
  <el-dialog
    v-model="dialogVisible"
    title="管理基金列表"
    width="90%"
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

    <div class="fund-count">共 {{ managedCodes.length }} 只基金</div>

    <div v-if="managedCodes.length > 0" class="fund-list">
      <div v-for="code in managedCodes" :key="code" class="fund-item">
        <div class="fund-info">
          <span class="fund-code">{{ code }}</span>
          <span class="fund-name">{{ props.fundNameMap[code] || '--' }}</span>
        </div>
        <el-button
          type="danger"
          plain
          size="small"
          circle
          @click="removeFund(code)"
        >
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
    </div>

    <el-empty v-else description="暂无基金，请添加" />

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="close">取消</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="managedCodes.length === 0"
          @click="save"
        >
          {{ saving ? '保存中' : '保存' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import { Delete } from '@element-plus/icons-vue'
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
const managedCodes = ref([])

const groupsSha = ref('')
const codesSha = ref('')
const allCodes = ref([])
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
  } catch (e) {
    ElMessage.error('加载配置失败')
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
    const allGroupCodes = Object.values(fundGroups.value).flat()
    const uniqueCodes = [...new Set([...allCodes.value, ...allGroupCodes])]

    await updateFile(
      'public/config/fund_groups.json',
      fundGroups.value,
      groupsSha.value,
      undefined,
      `Update fund groups for ${props.keyValue}`
    )

    if (uniqueCodes.length !== allCodes.value.length) {
      await updateFile(
        'public/config/fund_codes.json',
        uniqueCodes,
        codesSha.value,
        undefined,
        'Update fund codes'
      )
    }

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

onMounted(loadAllConfig)
watch(() => props.keyValue, loadAllConfig)
</script>

<style scoped>
.add-fund-section {
  margin-bottom: 16px;
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
  color: #6b7280;
  margin-bottom: 12px;
  font-weight: 500;
}

.fund-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.fund-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fafafa;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  transition: all 0.15s;
}

.fund-item:hover {
  border-color: #4f46e5;
  background: #f5f7ff;
}

.fund-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.fund-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  font-weight: 700;
  color: #1a1a1a;
}

.fund-name {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 移动端适配 */
@media (max-width: 768px) {
  :deep(.el-dialog) {
    width: 92% !important;
    max-width: 92%;
    margin: auto !important;
    top: 50% !important;
    transform: translateY(-50%);
    max-height: 85vh;
    border-radius: 8px;
  }

  :deep(.el-dialog__header) {
    padding: 12px 16px;
    margin-right: 0;
  }

  :deep(.el-dialog__title) {
    font-size: 16px;
    font-weight: 600;
    color: #1a1a1a;
  }

  :deep(.el-dialog__body) {
    padding: 12px 16px;
    max-height: calc(85vh - 120px);
    overflow-y: auto;
  }

  :deep(.el-dialog__footer) {
    padding: 10px 16px;
  }

  .add-fund-row {
    flex-direction: row;
    gap: 10px;
  }

  .code-input {
    flex: 1;
  }

  .fund-list {
    max-height: 50vh;
  }

  .fund-item {
    padding: 10px 12px;
  }

  .fund-info {
    flex: 1;
    min-width: 0;
    gap: 8px;
  }

  .fund-code {
    font-size: 13px;
  }

  .fund-name {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    max-width: 160px;
  }
}
</style>