<script lang="ts">
  import { tick } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    class?: string;
    style?: string;
  }

  let {
    open,
    title,
    onclose,
    class: className = '',
    style = '',
    children
  }: Props = $props();

  let backdropEl = $state<HTMLDivElement>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === backdropEl) onclose();
  }

  $effect(() => {
    if (open) {
      tick().then(() => backdropEl?.focus());
    }
  });
</script>

{#if open}
  <div
    class="md-dialog-backdrop"
    bind:this={backdropEl}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    onkeydown={handleKeydown}
    onclick={handleBackdropClick}
  >
    <div class="md-dialog {className}" {style}>
      <div class="md-dialog__animation">
        <h2 class="md-dialog__title">{title}</h2>
        <div class="md-dialog__content">
          {@render children()}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .md-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 24px 16px;
    animation: fadeIn 150ms ease-out;
  }

  .md-dialog {
    background: var(--md-sys-color-surface);
    border-radius: var(--md-sys-shape-extra-large);
    width: 100%;
    max-width: 400px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: var(--md-sys-elevation-level3);
    animation: slideUp 250ms var(--md-sys-motion-easing-emphasized);
  }

  .md-dialog__animation {
    padding: 24px;
  }

  .md-dialog__title {
    font-size: 1.5rem;
    font-weight: 400;
    line-height: 2rem;
    color: var(--md-sys-color-on-surface);
    margin: 0 0 16px;
  }

  .md-dialog__content {
    color: var(--md-sys-color-on-surface-variant);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
