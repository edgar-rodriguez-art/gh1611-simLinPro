// @ts-check
// PRNG con semilla (mulberry32) y distribuciones usadas por el motor.

/** Mezcla un entero de 32 bits (para derivar semillas por réplica). */
export function hash32(a, b = 0) {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  /** @param {number} seed */
  constructor(seed) {
    this.state = seed >>> 0;
  }

  /** Uniforme en [0, 1). */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(a, b) {
    return a + (b - a) * this.next();
  }

  normal() {
    // Box-Muller (una muestra)
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Lognormal con mediana `median` y desviación logarítmica `sigma`. */
  lognormal(median, sigma) {
    return median * Math.exp(sigma * this.normal());
  }

  exponential(mean) {
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    return -Math.log(u) * mean;
  }

  triangular(min, mode, max) {
    const u = this.next();
    const c = (mode - min) / (max - min);
    if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }

  /** Poisson: Knuth para λ pequeño, aproximación normal redondeada para λ grande. */
  poisson(lambda) {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.next();
      } while (p > L);
      return k - 1;
    }
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
  }

  /** Binomial: exacta para n pequeño, aproximación normal para n grande. */
  binomial(n, p) {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n < 40) {
      let k = 0;
      for (let i = 0; i < n; i++) if (this.next() < p) k++;
      return k;
    }
    const mean = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    return Math.min(n, Math.max(0, Math.round(mean + sd * this.normal())));
  }
}
