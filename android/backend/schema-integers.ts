import JSBI from 'jsbi';

/**
 * Zod eagerly constructs its unused int64 ranges even for our JSON-only schemas.
 * This build injection preserves those constants without exposing a fake global
 * BigInt. IPC never accepts bigint; arithmetic on these objects is unsupported.
 */
const schemaBigInt = typeof window.BigInt === 'function'
  ? window.BigInt : JSBI.BigInt;
export { schemaBigInt as BigInt };
