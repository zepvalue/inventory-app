<script lang="ts">
  interface Props {
    icon: string;
    label: string;
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    selected?: boolean;
    class?: string;
    style?: string;
    type?: 'button' | 'submit' | 'reset';
  }

  let {
    icon,
    label,
    onclick,
    disabled = false,
    selected = false,
    class: className = '',
    style = '',
    type = 'button'
  }: Props = $props();
</script>

<button
  {type}
  class="md-icon-btn {className}"
  class:md-icon-btn--selected={selected}
  {disabled}
  aria-label={label}
  {onclick}
  {style}
>
  <i class="material-icons-round">{icon}</i>
</button>

<style>
  .md-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: none;
    border-radius: var(--md-sys-shape-full);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: background var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized),
                color var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
  }

  .md-icon-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  .md-icon-btn:active {
    background: rgba(0, 0, 0, 0.1);
  }

  .md-icon-btn:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  .md-icon-btn--selected {
    color: var(--md-sys-color-primary);
  }
</style>
