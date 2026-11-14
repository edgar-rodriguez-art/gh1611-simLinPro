// @ts-check
// Web Worker de Monte Carlo: recibe un snapshot y escenarios, devuelve los resultados por réplica.
import { runScenarios } from './montecarlo.js';

self.onmessage = (e) => {
  const job = e.data;
  const t0 = performance.now();
  try {
    const results = runScenarios(job);
    self.postMessage({ id: job.id, results, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ id: job.id, error: String(err && err.message ? err.message : err) });
  }
};
