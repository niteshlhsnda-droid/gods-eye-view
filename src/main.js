import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { probeApiAvailable } from './sources/staticHosting.js';

// Detect static hosting (GitHub Pages: no /api/* backend) as early as
// possible. The probe outcome is cached, so layers read it synchronously on
// their load paths and switch to keyless direct upstreams instead of
// attempting doomed backend requests.
void probeApiAvailable();

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application.start().catch((error) => {
  console.error("God's Eye View initialization failed:", error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = `Error: ${describeError(error)}`;
  loaderStatus.style.color = '#ff4444';
});

export { application };
