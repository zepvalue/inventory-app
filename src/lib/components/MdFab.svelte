<script lang="ts">
  interface Props {
    icon: string;
    label: string;
    onclick: (e: MouseEvent) => void;
    class?: string;
    style?: string;
    type?: 'button' | 'submit' | 'reset';
  }

  let {
    icon,
    label,
    onclick,
    class: className = '',
    style = '',
    type = 'button'
  }: Props = $props();
</script>

<button
  {type}
  class="md-fab {className}"
  {onclick}
  aria-label={label}
  {style}
>
  <i class="material-icons-round">{icon}</i>
  <span class="md-fab__label">{label}</span>
</button>

<style>
  .md-fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 56px;
    padding: 0 20px;
    border: none;
    border-radius: 16px;
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
    cursor: pointer;
    box-shadow: var(--md-sys-elevation-level3);
    transition: box-shadow var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized),
                transform var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
    z-index: 90;
  }

  .md-fab:hover {
    box-shadow: var(--md-sys-elevation-level4);
    transform: translateY(-1px);
  }

  .md-fab:active {
    box-shadow: var(--md-sys-elevation-level2);
    transform: translateY(0);
  }

  .md-fab i {
    font-size: 24px;
  }

  .md-fab__label {
    padding-right: 4px;
  }

  @media (max-width: 480px) {
    .md-fab {
      bottom: 16px;
      right: 16px;
    }
  }
</style>
