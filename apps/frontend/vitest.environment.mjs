import { builtinEnvironments } from 'vitest/environments';

// Keep multipart bodies in the same Web API implementation as Node's fetch.
// jsdom provides the DOM and storage; mixing its FormData with native fetch
// serialises uploads as text on modern Node instead of multipart/form-data.
export default {
  ...builtinEnvironments.jsdom,
  name: 'wise-jsdom',
  async setup(global, options) {
    const web = Object.fromEntries(['fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File'].map((name) => [name, global[name]]));
    const environment = await builtinEnvironments.jsdom.setup(global, options);
    const DomFormData = global.jsdom.window.FormData;
    const NativeFormData = web.FormData;
    // React constructs FormData(form, submitter) for DOM form events. Node's
    // implementation has no DOM constructor, so retain jsdom for that overload.
    web.FormData = class FormData extends NativeFormData {
      constructor(form, submitter) {
        super();
        if (form !== undefined) return new DomFormData(form, submitter);
      }
    };
    for (const [name, value] of Object.entries(web)) Object.defineProperty(global, name, { configurable: true, writable: true, value });
    Object.defineProperty(global, 'localStorage', { configurable: true, writable: true, value: global.jsdom.window.localStorage });
    Object.defineProperty(global, 'sessionStorage', { configurable: true, writable: true, value: global.jsdom.window.sessionStorage });
    return environment;
  },
};
