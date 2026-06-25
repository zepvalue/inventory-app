<script lang="ts">
  interface Props {
    label: string;
    value: string;
    oninput?: (e: Event) => void;
    options: Array<{ value: string; label: string }>;
    required?: boolean;
    disabled?: boolean;
    class?: string;
    style?: string;
    id?: string;
  }

  let {
    label,
    value,
    oninput,
    options,
    required = false,
    disabled = false,
    class: className = '',
    style = '',
    id = ''
  }: Props = $props();

  let focused = $state(false);

  const fieldId = id || `md-select-${Math.random().toString(36).slice(2, 8)}`;

  function handleFocus() { focused = true; }
  function handleBlur() { focused = false; }
</script>

<div
  class="md-select {className}"
  class:md-select--focused={focused}
  class:md-select--has-value={value.length > 0}
  class:md-select--disabled={disabled}
  {style}
>
  <select
    id={fieldId}
    class="md-select__input"
    {value}
    {disabled}
    {required}
    {oninput}
    onfocus={handleFocus}
    onblur={handleBlur}
  >
    <option value="" disabled>Select {label.toLowerCase()}</option>
    {#each options as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
  <label for={fieldId} class="md-select__label">{label}</label>
  <i class="material-icons-round md-select__arrow">arrow_drop_down</i>
</div>

<style>
  .md-select {
    position: relative;
  }

  .md-select__input {
    width: 100%;
    height: 56px;
    padding: 24px 40px 8px 16px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-extra-small);
    background: transparent;
    font-family: inherit;
    font-size: 1rem;
    line-height: 1.5;
    color: var(--md-sys-color-on-surface);
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    transition: border-color var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
    box-sizing: border-box;
  }

  .md-select__input:focus {
    border-color: var(--md-sys-color-primary);
    border-width: 2px;
    padding: 23px 39px 7px 15px;
  }

  .md-select--disabled .md-select__input {
    border-color: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
  }

  .md-select__label {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 1rem;
    color: var(--md-sys-color-on-surface-variant);
    pointer-events: none;
    transition: all var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
    transform-origin: left top;
  }

  .md-select--focused .md-select__label,
  .md-select--has-value .md-select__label {
    top: 12px;
    transform: translateY(0) scale(0.75);
    color: var(--md-sys-color-primary);
  }

  .md-select--disabled .md-select__label {
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
  }

  .md-select__arrow {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--md-sys-color-on-surface-variant);
    pointer-events: none;
    font-size: 24px;
  }
</style>
