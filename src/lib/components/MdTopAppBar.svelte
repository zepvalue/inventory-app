<script lang="ts">
  interface Props {
    title: string;
    onMenuClick?: () => void;
    class?: string;
    style?: string;
  }

  let { title, onMenuClick, children, class: className = '', style = '' }: Props = $props();
</script>

<header class="md-top-app-bar {className}" {style}>
  <div class="md-top-app-bar__row">
    {#if onMenuClick}
      <button class="md-icon-btn md-top-app-bar__nav" onclick={onMenuClick} aria-label="Menu">
        <i class="material-icons-round">menu</i>
      </button>
    {/if}
    <h1 class="md-top-app-bar__title">{title}</h1>
    <div class="md-top-app-bar__actions">
      {@render children()}
    </div>
  </div>
</header>

<style>
  .md-top-app-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--md-sys-color-surface);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    padding: 0 4px;
  }

  .md-top-app-bar__row {
    display: flex;
    align-items: center;
    height: 64px;
    padding: 0 12px;
    gap: 4px;
  }

  .md-top-app-bar__nav {
    flex-shrink: 0;
  }

  .md-top-app-bar__title {
    font-size: 1.375rem;
    font-weight: 400;
    line-height: 1.75rem;
    letter-spacing: 0;
    color: var(--md-sys-color-on-surface);
    margin: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .md-top-app-bar__actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
</style>
