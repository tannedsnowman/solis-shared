/**
 * The shared CARDS: presentation only.
 *
 * Everything exported here draws what it is handed. Nothing here reads
 * `localStorage`, calls Modbus, or knows which app it is running in -- each
 * app keeps its own back end (its raw-register readers and its register-write
 * hooks) and passes the results in as props. That separation is what lets the
 * extension and SolisConnect render the same card without sharing a transport.
 *
 * See `tsconfig.ui.json` for why this subtree gets the DOM lib and the rest of
 * the package does not.
 */
export {};
