<script lang="ts">
  interface Props {
    label: string;
    value: string;
    oninput?: (e: Event) => void;
    onchange?: (e: Event) => void;
    type?: string;
    required?: boolean;
    readonly?: boolean;
    disabled?: boolean;
    placeholder?: string;
    class?: string;
    style?: string;
    id?: string;
    rows?: number;
    /** If set, renders as a textarea */
    multiline?: boolean;
    /** Supporting text or error below the field */
    supportingText?: string;
    error?: boolean;
  }

  let {
    label,
    value,
    oninput,
    onchange,
    type = 'text',
    required = false,
    readonly = false,
    disabled = false,
    placeholder = '',
    class: className = '',
    style = '',
    id = '',
    rows = 3,
    multiline = false,
    supportingText = '',
    error = false
  }: Props = $props();

  let focused = $state(false);
  let inputEl = $state<HTMLInputElement | HTMLTextAreaElement>();

  const fieldId = id || `md-field-${Math.random().toString(36).slice(2, 8)}`;

  function handleFocus() { focused = true; }
  function handleBlur() { focused = false; }
</script>

<div
  class="md-text-field {className}"
  class:md-text-field--focused={focused}
  class:md-text-field--has-value={value.length > 0}
  class:md-text-field--disabled={disabled}
  class:md-text-field--error={error}
  {style}
>
  {#if multiline}
    <textarea
      id={fieldId}
      bind:this={inputEl}
      class="md-text-field__input"
      {value}
      {placeholder}
      {disabled}
      {readonly}
      {required}
      {rows}
      {oninput}
      {onchange}
      onfocus={handleFocus}
      onblur={handleBlur}
    ></textarea>
  {:else}
    <input
      id={fieldId}
      bind:this={inputEl}
      class="md-text-field__input"
      {type}
      {value}
      {placeholder}
      {disabled}
      {readonly}
      {required}
      {oninput}
      {onchange}
      onfocus={handleFocus}
      onblur={handleBlur}
    />
  {/if}
  <label for={fieldId} class="md-text-field__label">{label}</label>
  {#if supportingText}
    <span class="md-text-field__supporting">{supportingText}</span>
  {/if}
</div>

<style>
  .md-text-field {
    position: relative;
    margin-bottom: 4px;
  }

  .md-text-field__input {
    width: 100%;
    height: 56px;
    padding: 24px 16px 8px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-extra-small);
    background: transparent;
    font-family: inherit;
    font-size: 1rem;
    line-height: 1.5;
    color: var(--md-sys-color-on-surface);
    outline: none;
    transition: border-color var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
    box-sizing: border-box;
  }

  .md-text-field textarea.md-text-field__input {
    height: auto;
    min-height: 56px;
    padding-top: 28px;
    resize: vertical;
  }

  .md-text-field__input:focus {
    border-color: var(--md-sys-color-primary);
    border-width: 2px;
    padding: 23px 15px 7px;
  }

  .md-text-field--error .md-text-field__input:not(:focus) {
    border-color: var(--md-sys-color-error);
  }

  .md-text-field--disabled .md-text-field__input {
    border-color: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
  }

  .md-text-field__label {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 1rem;
    color: var(--md-sys-color-on-surface-variant);
    pointer-events: none;
    transition: all var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-emphasized);
    transform-origin: left top;
    background: transparent;
  }

  .md-text-field--focused .md-text-field__label,
  .md-text-field--has-value .md-text-field__label {
    top: 12px;
    transform: translateY(0) scale(0.75);
    color: var(--md-sys-color-primary);
  }

  .md-text-field--error .md-text-field__label:not(.md-text-field--focused) {
    color: var(--md-sys-color-error);
  }

  .md-text-field--disabled .md-text-field__label {
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
  }

  .md-text-field__supporting {
    display: block;
    font-size: 0.75rem;
    line-height: 1rem;
    letter-spacing: 0.00625rem;
    color: var(--md-sys-color-on-surface-variant);
    padding: 4px 16px 0;
  }

  .md-text-field--error .md-text-field__supporting {
    color: var(--md-sys-color-error);
  }
</style>
