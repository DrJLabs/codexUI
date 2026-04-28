<template>
  <div class="plan-card" :data-streaming="message.messageType === 'plan.live'">
    <div class="plan-card-header">
      <p class="plan-card-title">{{ title }}</p>
      <span v-if="message.messageType === 'plan.live'" class="plan-card-badge">Updating</span>
    </div>
    <div
      v-if="planExplanation"
      class="plan-card-explanation plan-card-markdown"
      v-html="renderMarkdownBlocksAsHtml(planExplanation)"
    />
    <ol v-if="planSteps.length > 0" class="plan-step-list">
      <li
        v-for="(step, stepIndex) in planSteps"
        :key="`${message.id}:plan-step:${stepIndex}`"
        class="plan-step-item"
        :data-status="step.status"
      >
        <span class="plan-step-status" :data-status="step.status">{{ planStepStatusIcon(step.status) }}</span>
        <div class="plan-step-text plan-card-markdown" v-html="renderMarkdownBlocksAsHtml(step.step)" />
      </li>
    </ol>
    <div v-else class="plan-card-markdown" v-html="renderMarkdownBlocksAsHtml(message.text)" />
    <div v-if="showImplementPlanButton(message)" class="plan-card-actions">
      <button
        type="button"
        class="plan-card-implement-button"
        @click="$emit('implementPlan', message)"
      >
        Implement plan
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { UiMessage } from '../../types/codex'
import {
  planStepStatusIcon,
  readPlanExplanation,
  readPlanSteps,
  showImplementPlanButton,
} from './planUtils'

const props = withDefaults(defineProps<{
  message: UiMessage
  title?: string
  renderMarkdownBlocksAsHtml: (text: string) => string
}>(), {
  title: 'Plan',
})

defineEmits<{
  implementPlan: [message: UiMessage]
}>()

const planExplanation = computed(() => readPlanExplanation(props.message))
const planSteps = computed(() => readPlanSteps(props.message))
</script>
