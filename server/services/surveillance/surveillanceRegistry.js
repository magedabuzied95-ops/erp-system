// What this build can actually talk to.
//
// Registration is the switch that decides whether a code path is reachable at
// all. Keeping it in one file means "can this deployment reach a real device?"
// is answered by reading twenty lines rather than by auditing a package.
//
// TODAY: the Dahua provider is registered (it is only a dialect — harmless
// without a transport), and the ONLY transport is the simulated device, gated
// behind an explicit flag that refuses to arm in production.
//
// The real transports are written and tested. They are commented out rather
// than conditionally registered so that turning them on is a visible diff
// somebody has to approve, not an environment variable somebody can set.

import { registerProvider } from "./providers/providerRegistry.js";
import { registerTransport } from "./transports/transportRegistry.js";
import { DahuaAdapter } from "./providers/dahua/DahuaAdapter.js";
import { MockSurveillanceTransport, mockTransportAllowed } from "./transports/MockSurveillanceTransport.js";

let registered = false;

export const registerSurveillanceRuntime = () => {
  if (registered) return;
  registered = true;

  // Vendors. A provider cannot reach anything on its own; it needs a transport.
  registerProvider(DahuaAdapter);

  // Transports. Exactly one, and only when explicitly asked for outside
  // production. See MockSurveillanceTransport for the three interlocks.
  if (mockTransportAllowed()) {
    registerTransport(MockSurveillanceTransport);
  }

  // Phase 2B-2, once a network path exists and has been approved:
  //
  //   const { DirectTransport, TunnelTransport } = await import("./transports/DirectTransport.js");
  //   registerTransport(DirectTransport);
  //   registerTransport(TunnelTransport);
  //
  // Nothing else changes. Devices already carry a `transport_type` column, the
  // provider does not know which transport it is using, and the API and UI
  // never mention one.
};

export const surveillanceRuntimeStatus = () => ({
  mock_enabled: mockTransportAllowed(),
  real_transports_enabled: false,
});
