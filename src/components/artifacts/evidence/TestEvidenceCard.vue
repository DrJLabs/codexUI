<template>
  <CommandEvidenceCard :summary="summary" />
</template>

<script setup lang="ts">
import type { ArtifactEvidenceSummary } from '../../../types/evidence'
import CommandEvidenceCard from './CommandEvidenceCard.vue'

defineProps<{
  summary: ArtifactEvidenceSummary
}>()
</script>
