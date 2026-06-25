<script lang="ts">
  interface Props {
    label: string;
    icon?: string;
    color?: 'primary' | 'secondary' | 'tertiary' | 'error' | 'success' | 'warning' | 'neutral';
    class?: string;
    style?: string;
  }

  let {
    label,
    icon,
    color = 'neutral',
    class: className = '',
    style = ''
  }: Props = $props();

  const colorMap = {
    primary: '--md-sys-color-primary-container',
    secondary: '--md-sys-color-secondary-container',
    tertiary: '--md-sys-color-tertiary-container',
    error: '--md-sys-color-error-container',
    success: '--md-ref-palette-primary80',
    warning: '--md-ref-palette-secondary80',
    neutral: 'var(--md-sys-color-surface-variant, #e7e0ec)',
  };

  const onColorMap = {
    primary: '--md-sys-color-on-primary-container',
    secondary: '--md-sys-color-on-secondary-container',
    tertiary: '--md-sys-color-on-tertiary-container',
    error: '--md-sys-color-on-error-container',
    success: '--md-ref-palette-primary10',
    warning: '--md-ref-palette-secondary10',
    neutral: '--md-sys-color-on-surface-variant',
  };
</script>

<span
  class="md-chip {className}"
  class:md-chip--with-icon={!!icon}
  {style}
>
  {#if icon}
    <i class="material-icons-round md-chip__icon">{icon}</i>
  {/if}
  <span class="md-chip__label">{label}</span>
</span>

<style>
  .md-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--md-sys-shape-small);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1rem;
    letter-spacing: 0.0125rem;
    white-space: nowrap;
    transition: box-shadow var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
  }

  .md-chip__icon {
    font-size: 16px;
    margin-left: -4px;
  }

  .md-chip__label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
