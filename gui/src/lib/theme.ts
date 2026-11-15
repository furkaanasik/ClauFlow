/**
 * Atölye themes. `cream` is the default (no class on <html>); `night` adds
 * `html.night`. The value is persisted in `localStorage.theme`.
 *
 * Migration from the pre-redesign values: the old app defaulted to dark and
 * wrote "light" | "dark" when toggled. An explicit choice is preserved:
 * "light" → "cream", "dark" → "night". No value → the new default (cream).
 *
 * Kept free of "use client" so the server layout can inline the boot script.
 */
export type Theme = "cream" | "night";

export const THEME_STORAGE_KEY = "theme";
export const NIGHT_CLASS = "night";

/** Runs in <head> before paint: migrates the stored value and applies it. */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,k='${THEME_STORAGE_KEY}',t=localStorage.getItem(k);if(t==='light')t='cream';else if(t==='dark')t='night';if(t==='cream'||t==='night'){localStorage.setItem(k,t)}else{t=null}d.classList.remove('light');if(t==='night')d.classList.add('${NIGHT_CLASS}');}catch(e){}})()`;
