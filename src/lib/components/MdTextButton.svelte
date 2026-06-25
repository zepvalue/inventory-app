<script lang="ts">
  interface Props {
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    class?: string;
    style?: string;
    icon?: string;
  }

  let {
    onclick,
    disabled = false,
    type = 'button',
    class: className = '',
    style = '',
    icon,
    children
  }: Props = $props();
</script>

<button
  {type}
  class="md-text-btn {className}"
  {disabled}
  {onclick}
  {style}
>
  {#if icon}
    <i class="material-icons-round md-text-btn__icon">{icon}</i>
  {/if}
  <span class="md-text-btn__label">{@render children()}</span>
</button>

<style>
  .md-text-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    border: none;
    border-radius: var(--md-sys-shape-full);
    background: transparent;
    color: var(--md-sys-color-primary);
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
    letter-spacing: 0.00625rem;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: background var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
    text-transform: none;
  }

  .md-text-btn:hover {
    background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
  }

  .md-text-btn:active {
    background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent);
  }

  .md-text-btn:disabled {
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    cursor: not-allowed;
  }

  .md-text-btn__icon {
    font-size: 18px;
  }
</style>
