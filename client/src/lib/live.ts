/**
 * How often lists and call details fetch fresh data while their tab is visible.
 * Screens holding an editable form do not use it, so typing is never overwritten.
 */
export const LIVE_REFRESH_MS = 5000;
