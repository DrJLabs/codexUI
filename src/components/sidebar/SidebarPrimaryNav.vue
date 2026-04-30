<template>
  <nav class="sidebar-primary-nav">
    <SidebarMenuRow
      as="button"
      class="sidebar-nav-item"
      type="button"
      :data-active="activeRoute === 'home'"
      @click="$emit('start-new-thread')"
    >
      <template #left>
        <IconTablerFilePencil class="sidebar-nav-icon" />
      </template>
      <span class="sidebar-nav-copy">
        <span class="sidebar-nav-title">{{ t('New thread') }}</span>
        <span class="sidebar-nav-subtitle">{{ t('Choose a folder') }}</span>
      </span>
    </SidebarMenuRow>
    <SidebarMenuRow
      as="button"
      class="sidebar-nav-item"
      type="button"
      :data-active="activeRoute === 'automations'"
      @click="$emit('navigate-automations')"
    >
      <template #left>
        <IconTablerBolt class="sidebar-nav-icon" />
      </template>
      <span class="sidebar-nav-copy">
        <span class="sidebar-nav-title">{{ t('Automations') }}</span>
        <span class="sidebar-nav-subtitle">{{ t('Heartbeat schedules') }}</span>
      </span>
    </SidebarMenuRow>
    <SidebarMenuRow
      as="button"
      class="sidebar-nav-item"
      type="button"
      :data-active="activeRoute === 'skills'"
      @click="$emit('navigate-skills')"
    >
      <template #left>
        <IconTablerBolt class="sidebar-nav-icon" />
      </template>
      <span class="sidebar-nav-copy">
        <span class="sidebar-nav-title">{{ t('Skills') }}</span>
        <span class="sidebar-nav-subtitle">{{ t('Plugins, apps, MCPs') }}</span>
      </span>
    </SidebarMenuRow>
    <SidebarMenuRow
      as="button"
      class="sidebar-nav-item"
      type="button"
      :data-active="activeRoute === 'kanban'"
      @click="$emit('navigate-kanban')"
    >
      <template #left>
        <IconTablerLayoutKanban class="sidebar-nav-icon" />
      </template>
      <span class="sidebar-nav-copy">
        <span class="sidebar-nav-title">{{ t('Kanban') }}</span>
        <span class="sidebar-nav-subtitle">{{ t('Local task board') }}</span>
      </span>
    </SidebarMenuRow>
  </nav>
</template>

<script setup lang="ts">
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerLayoutKanban from '../icons/IconTablerLayoutKanban.vue'
import { useUiLanguage } from '../../composables/useUiLanguage'
import SidebarMenuRow from './SidebarMenuRow.vue'

defineProps<{
  activeRoute: 'home' | 'thread' | 'automations' | 'skills' | 'kanban'
}>()

defineEmits<{
  'start-new-thread': []
  'navigate-automations': []
  'navigate-skills': []
  'navigate-kanban': []
}>()

const { t } = useUiLanguage()
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-primary-nav {
  @apply flex flex-col gap-1;
}

.sidebar-nav-item {
  @apply text-sm font-normal text-slate-700 hover:bg-slate-200;
}

.sidebar-nav-item[data-active='true'] {
  @apply bg-slate-200 text-slate-950;
}

.sidebar-nav-icon {
  @apply size-4;
}

.sidebar-nav-copy {
  @apply flex min-w-0 flex-col;
}

.sidebar-nav-title {
  @apply truncate text-sm font-semibold;
}

.sidebar-nav-subtitle {
  @apply truncate text-xs text-slate-500;
}

:global(:root.dark) .sidebar-nav-item {
  @apply text-slate-200 hover:bg-slate-800;
}

:global(:root.dark) .sidebar-nav-item[data-active='true'] {
  @apply bg-slate-800 text-white;
}

:global(:root.dark) .sidebar-nav-subtitle {
  @apply text-slate-400;
}
</style>
