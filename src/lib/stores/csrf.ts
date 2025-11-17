import { writable } from 'svelte/store';

export const csrfFetched = writable<boolean>(false);
export const csrfToken = writable<string>('');