<script lang="ts">
  interface Props {
    label: string;
    checked: boolean;
    oninput?: (e: Event) => void;
    onchange?: (e: Event) => void;
    disabled?: boolean;
    class?: string;
    style?: string;
    id?: string;
  }

  let {
    label,
    checked,
    oninput,
    onchange,
    disabled = false,
    class: className = '',
    style = '',
    id = ''
  }: Props = $props();

  const fieldId = id || `md-check-${Math.random().toString(36).slice(2, 8)}`;
</script>

<label
  class="md-checkbox {className}"
  class:md-checkbox--disabled={disabled}
  {style}
  for={fieldId}
>
  <input
    id={fieldId}
    type="checkbox"
    bind:checked
    {disabled}
    {oninput}
    {onchange}
  />
  <span class="md-checkbox__check"></span>
  <span class="md-checkbox__label">{label}</span>
</label>

<style>
  .md-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    padding: 4px 0;
    user-select: none;
  }

  .md-checkbox input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .md-checkbox__check {
    position: relative;
    width: 18px;
    height: 18px;
    border: 2px solid var(--md-sys-color-on-surface-variant);
    border-radius: 2px;
    flex-shrink: 0;
    transition: all var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
  }

  .md-checkbox input:checked + .md-checkbox__check {
    background: var(--md-sys-color-primary);
    border-color: var(--md-sys-color-primary);
  }

  .md-checkbox input:checked + .md-checkbox__check::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 1px;
    width: 6px;
    height: 10px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .md-checkbox--disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  .md-checkbox__label {
    font-size: 0.875rem;
    line-height: 1.25rem;
    color: var(--md-sys-color-on-surface);
  }
</style>
