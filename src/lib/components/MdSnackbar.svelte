<script lang="ts">
  interface Props {
    message: string;
    visible: boolean;
    action?: { label: string; onclick: () => void };
    type?: 'info' | 'success' | 'error';
    duration?: number;
    onclose?: () => void;
  }

  let {
    message,
    visible,
    action,
    type = 'info',
    duration = 4000,
    onclose
  }: Props = $props();

  let timeout: ReturnType<typeof setTimeout>;

  $effect(() => {
    if (visible && duration > 0) {
      timeout = setTimeout(() => onclose?.(), duration);
      return () => clearTimeout(timeout);
    }
  });
</script>

{#if visible}
  <div class="md-snackbar" class:md-snackbar--error={type === 'error'} class:md-snackbar--success={type === 'success'}>
    <span class="md-snackbar__message">{message}</span>
    {#if action}
      <button class="md-snackbar__action" onclick={action.onclick}>{action.label}</button>
    {/if}
  </div>
{/if}

<style>
  .md-snackbar {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--md-sys-shape-small);
    background: var(--md-sys-color-inverse-surface);
    color: var(--md-sys-color-inverse-on-surface);
    box-shadow: var(--md-sys-elevation-level3);
    z-index: 300;
    animation: snackbarIn 250ms var(--md-sys-motion-easing-emphasized);
    max-width: calc(100vw - 32px);
  }

  .md-snackbar--error {
    background: var(--md-sys-color-error);
    color: var(--md-sys-color-on-error);
  }

  .md-snackbar--success {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
  }

  .md-snackbar__message {
    flex: 1;
    font-size: 0.875rem;
    line-height: 1.25rem;
    letter-spacing: 0.00625rem;
    padding: 14px 0;
  }

  .md-snackbar__action {
    background: none;
    border: none;
    color: var(--md-sys-color-primary);
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.25rem;
    letter-spacing: 0.00625rem;
    cursor: pointer;
    padding: 8px;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .md-snackbar--error .md-snackbar__action {
    color: var(--md-sys-color-on-error);
  }

  .md-snackbar--success .md-snackbar__action {
    color: var(--md-sys-color-on-primary);
  }

  @keyframes snackbarIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(16px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }
</style>
