/** Standard APIs absent from the television's Chromium 66, shared by both WebViews. */
import 'core-js/es/array/at';
import 'core-js/es/array/flat';
import 'core-js/es/array/flat-map';
import 'core-js/es/array/find-last';
import 'core-js/es/array/find-last-index';
import 'core-js/es/object/from-entries';
import 'core-js/es/object/has-own';
import 'core-js/es/string/match-all';
import 'core-js/es/promise/all-settled';
import 'core-js/es/promise/finally';
import 'core-js/es/global-this';

if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  };
}
