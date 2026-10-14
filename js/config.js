// Site-wide switches, kept in one place.

/**
 * Canonical address; challenge links and the share image point here, never at localhost.
 * Changing it? Also update the meta tags in index.html and run `node tools/qr.mjs`.
 */
export const SITE_URL = 'https://tcchen2026.github.io/allow-overflow/';

/**
 * Dry-run / Atuin Shell Guard messaging: the guarded replay, the comparison,
 * the pitch and the share taglines. Off = a plain mini game.
 * Elements marked [data-promo] in index.html follow this switch.
 */
export const PROMO = false;
