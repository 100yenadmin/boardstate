// Public surface of @boardstate/conformance: the reusable transport-conformance
// suite a host runs against its own transport (SPEC §2, §12), plus the canonical
// fixture documents it seeds with.
export { runTransportConformance } from "./suite.js";
export type {
  TransportConformanceOptions,
  TransportHarness,
  MakeTransport,
  OperatorHarness,
} from "./suite.js";
export * from "./fixtures.js";
