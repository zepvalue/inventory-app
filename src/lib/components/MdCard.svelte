<script lang="ts">
  interface Props {
    class?: string;
    style?: string;
    onclick?: (e: MouseEvent) => void;
    role?: string;
    tabindex?: string;
  }

  let {
    class: className = '',
    style = '',
    onclick,
    role = '',
    tabindex,
    children
  }: Props = $props();
</script>

<div
  class="md-card {className}"
  class:md-card--clickable={!!onclick}
  {style}
  {onclick}
  {role}
  {tabindex}
>
  {@render children()}
</div>

<style>
  .md-card {
    background: var(--md-sys-color-surface);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--md-sys-shape-large);
    padding: 16px;
    transition: box-shadow var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized),
                border-color var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
  }

  .md-card--clickable {
    cursor: pointer;
  }

  .md-card--clickable:hover {
    border-color: var(--md-sys-color-outline);
    box-shadow: var(--md-sys-elevation-level1);
  }
</style>
