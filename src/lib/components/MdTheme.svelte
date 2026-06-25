<script lang="ts">
  // Material Design 3 theme provider – injects CSS custom properties
  // for light & dark dynamic color schemes.
  let darkMode = $state(false);

  function applyDarkMode() {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    darkMode = mq.matches;
    mq.addEventListener('change', (e) => { darkMode = e.matches; });
  }

  $effect(() => {
    applyDarkMode();
  });
</script>

<svelte:head>
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,300;8..144,400;8..144,500;8..144,600;8..144,700&family=Roboto+Mono:wght@400;500&display=swap"
  />
  <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" />
  <style>
    :root {
      /* ── Color palette – Material Design 3 dynamic (seed: #6750a4) ── */
      --md-ref-palette-primary0: #000000;
      --md-ref-palette-primary10: #21005d;
      --md-ref-palette-primary20: #381e72;
      --md-ref-palette-primary30: #4f378b;
      --md-ref-palette-primary40: #6750a4;
      --md-ref-palette-primary50: #7f67be;
      --md-ref-palette-primary60: #9a80da;
      --md-ref-palette-primary70: #b69df8;
      --md-ref-palette-primary80: #d0bcff;
      --md-ref-palette-primary90: #eaddff;
      --md-ref-palette-primary95: #f6edff;
      --md-ref-palette-primary99: #fffbfe;

      --md-ref-palette-secondary0: #000000;
      --md-ref-palette-secondary10: #1d192b;
      --md-ref-palette-secondary20: #332d41;
      --md-ref-palette-secondary30: #4a4458;
      --md-ref-palette-secondary40: #625b71;
      --md-ref-palette-secondary50: #7a7388;
      --md-ref-palette-secondary60: #958da2;
      --md-ref-palette-secondary70: #b0a7bd;
      --md-ref-palette-secondary80: #cbc2d9;
      --md-ref-palette-secondary90: #e7def8;
      --md-ref-palette-secondary95: #f6edff;
      --md-ref-palette-secondary99: #fffbfe;

      --md-ref-palette-tertiary0: #000000;
      --md-ref-palette-tertiary10: #31111d;
      --md-ref-palette-tertiary20: #492532;
      --md-ref-palette-tertiary30: #633b48;
      --md-ref-palette-tertiary40: #7d5260;
      --md-ref-palette-tertiary50: #986977;
      --md-ref-palette-tertiary60: #b48391;
      --md-ref-palette-tertiary70: #d29dab;
      --md-ref-palette-tertiary80: #efb8c8;
      --md-ref-palette-tertiary90: #ffd9e3;
      --md-ref-palette-tertiary95: #ffecf0;
      --md-ref-palette-tertiary99: #fffbff;

      --md-ref-palette-error0: #000000;
      --md-ref-palette-error10: #410e0b;
      --md-ref-palette-error20: #601410;
      --md-ref-palette-error30: #8c1d18;
      --md-ref-palette-error40: #b3261e;
      --md-ref-palette-error50: #dc362e;
      --md-ref-palette-error60: #e46962;
      --md-ref-palette-error70: #ec928e;
      --md-ref-palette-error80: #f2b8b5;
      --md-ref-palette-error90: #f9dedc;
      --md-ref-palette-error95: #fceeee;
      --md-ref-palette-error99: #fffbfe;

      --md-ref-palette-neutral0: #000000;
      --md-ref-palette-neutral10: #1c1b1f;
      --md-ref-palette-neutral20: #313033;
      --md-ref-palette-neutral30: #484649;
      --md-ref-palette-neutral40: #605d62;
      --md-ref-palette-neutral50: #79767a;
      --md-ref-palette-neutral60: #938f94;
      --md-ref-palette-neutral70: #aeaaae;
      --md-ref-palette-neutral80: #c9c5ca;
      --md-ref-palette-neutral90: #e6e1e5;
      --md-ref-palette-neutral95: #f4eff4;
      --md-ref-palette-neutral99: #fffbfe;

      /* ── Light theme colors ── */
      --md-sys-color-primary: var(--md-ref-palette-primary40);
      --md-sys-color-on-primary: var(--md-ref-palette-primary100, #ffffff);
      --md-sys-color-primary-container: var(--md-ref-palette-primary90);
      --md-sys-color-on-primary-container: var(--md-ref-palette-primary10);
      --md-sys-color-secondary: var(--md-ref-palette-secondary40);
      --md-sys-color-on-secondary: var(--md-ref-palette-secondary100, #ffffff);
      --md-sys-color-secondary-container: var(--md-ref-palette-secondary90);
      --md-sys-color-on-secondary-container: var(--md-ref-palette-secondary10);
      --md-sys-color-tertiary: var(--md-ref-palette-tertiary40);
      --md-sys-color-on-tertiary: var(--md-ref-palette-tertiary100, #ffffff);
      --md-sys-color-tertiary-container: var(--md-ref-palette-tertiary90);
      --md-sys-color-on-tertiary-container: var(--md-ref-palette-tertiary10);
      --md-sys-color-error: var(--md-ref-palette-error40);
      --md-sys-color-on-error: var(--md-ref-palette-error100, #ffffff);
      --md-sys-color-error-container: var(--md-ref-palette-error90);
      --md-sys-color-on-error-container: var(--md-ref-palette-error10);
      --md-sys-color-surface: var(--md-ref-palette-neutral99);
      --md-sys-color-on-surface: var(--md-ref-palette-neutral10);
      --md-sys-color-surface-variant: var(--md-ref-palette-neutral90);
      --md-sys-color-on-surface-variant: var(--md-ref-palette-neutral30);
      --md-sys-color-outline: var(--md-ref-palette-neutral50);
      --md-sys-color-outline-variant: var(--md-ref-palette-neutral80);
      --md-sys-color-shadow: var(--md-ref-palette-neutral0);
      --md-sys-color-surface-tint: var(--md-ref-palette-primary40);
      --md-sys-color-inverse-surface: var(--md-ref-palette-neutral20);
      --md-sys-color-inverse-on-surface: var(--md-ref-palette-neutral95);
      --md-sys-color-inverse-primary: var(--md-ref-palette-primary80);
      --md-sys-color-surface-dim: var(--md-ref-palette-neutral87, #d8d3d8);
      --md-sys-color-surface-bright: var(--md-ref-palette-neutral99);

      /* ── Elevation (Material Design 3 shadows) ── */
      --md-sys-elevation-level0: none;
      --md-sys-elevation-level1: 0px 1px 3px 1px rgba(0,0,0,0.15), 0px 1px 2px 0px rgba(0,0,0,0.30);
      --md-sys-elevation-level2: 0px 2px 6px 2px rgba(0,0,0,0.15), 0px 1px 2px 0px rgba(0,0,0,0.30);
      --md-sys-elevation-level3: 0px 4px 8px 3px rgba(0,0,0,0.15), 0px 1px 3px 0px rgba(0,0,0,0.30);
      --md-sys-elevation-level4: 0px 6px 10px 4px rgba(0,0,0,0.15), 0px 2px 3px 0px rgba(0,0,0,0.30);
      --md-sys-elevation-level5: 0px 8px 12px 6px rgba(0,0,0,0.15), 0px 4px 4px 0px rgba(0,0,0,0.30);

      /* ── Shape / Corners ── */
      --md-sys-shape-extra-small: 4px;
      --md-sys-shape-small: 8px;
      --md-sys-shape-medium: 12px;
      --md-sys-shape-large: 16px;
      --md-sys-shape-extra-large: 28px;
      --md-sys-shape-full: 9999px;

      /* ── Animation ── */
      --md-sys-motion-easing-emphasized: cubic-bezier(0.2, 0, 0, 1);
      --md-sys-motion-duration-short1: 100ms;
      --md-sys-motion-duration-short2: 200ms;
      --md-sys-motion-duration-medium1: 250ms;
      --md-sys-motion-duration-medium2: 400ms;
      --md-sys-motion-duration-long1: 500ms;
      --md-sys-motion-duration-long2: 600ms;
    }

    /* ── Global resets & base ── */
    *, *::before, *::after {
      box-sizing: border-box;
    }

    body {
      font-family: 'Roboto Flex', system-ui, -apple-system, sans-serif;
      font-weight: 400;
      background: var(--md-sys-color-surface);
      color: var(--md-sys-color-on-surface);
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .material-icons-round {
      font-family: 'Material Icons Round';
      font-weight: normal;
      font-style: normal;
      font-size: 24px;
      display: inline-block;
      line-height: 1;
      text-transform: none;
      letter-spacing: normal;
      word-wrap: normal;
      white-space: nowrap;
      direction: ltr;
      font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
    }
  </style>
</svelte:head>

<slot />
