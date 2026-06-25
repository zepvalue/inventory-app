<script lang="ts">
  interface Props {
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    class?: string;
    style?: string;
    icon?: string;
    loading?: boolean;
  }

  let {
    onclick,
    disabled = false,
    type = 'button',
    class: className = '',
    style = '',
    icon,
    loading = false,
    children
  }: Props = $props();
</script>

<button
  {type}
  class="md-filled-btn {className}"
  {disabled}
  {onclick}
  {style}
>
  {#if loading}
    <span class="md-filled-btn__spinner"></span>
  {/if}
  {#if icon}
    <i class="material-icons-round md-filled-btn__icon">{icon}</i>
  {/if}
  <span class="md-filled-btn__label">{@render children()}</span>
</button>

<style>
  .md-filled-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 40px;
    padding: 0 24px;
    border: none;
    border-radius: var(--md-sys-shape-full);
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
    letter-spacing: 0.00625rem;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: box-shadow var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized),
                background var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
    box-shadow: var(--md-sys-elevation-level0);
    text-transform: none;
  }

  .md-filled-btn:hover {
    box-shadow: var(--md-sys-elevation-level1);
    background: color-mix(in srgb, var(--md-sys-color-primary) 90%, black);
  }

  .md-filled-btn:active {
    box-shadow: var(--md-sys-elevation-level0);
    background: color-mix(in srgb, var(--md-sys-color-primary) 85%, black);
  }

  .md-filled-btn:disabled {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    box-shadow: none;
    cursor: not-allowed;
  }

  .md-filled-btn__icon {
    font-size: 18px;
  }

  .md-filled-btn__spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--md-sys-color-on-primary);
    border-top-color: transparent;
    border-radius: 50%;
    animation: md-spin 0.6s linear infinite;
  }

  @keyframes md-spin {
    to { transform: rotate(360deg); }
  }
</style>
