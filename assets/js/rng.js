/* ============================================================================
 * LOTOCALC — Gerador pseudoaleatório determinístico
 * ----------------------------------------------------------------------------
 * Mulberry32: rápido, com estado de 32 bits e semente reprodutível. Guardar a
 * semente permite reproduzir exatamente o mesmo conjunto de jogos depois.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});

  function hashSemente(str) {
    var h = 2166136261 >>> 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function Rng(semente) {
    this.semente = (semente === undefined || semente === null || semente === '')
      ? novaSemente()
      : String(semente);
    this.estado = hashSemente(this.semente);
  }

  Rng.prototype.next = function () {
    this.estado = (this.estado + 0x6D2B79F5) >>> 0;
    var t = this.estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Inteiro em [min, max] inclusive. */
  Rng.prototype.int = function (min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  };

  Rng.prototype.escolher = function (arr) {
    return arr[Math.floor(this.next() * arr.length)];
  };

  /** Fisher–Yates, sobre uma cópia. */
  Rng.prototype.embaralhar = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(this.next() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  /** k elementos distintos, sem reposição. */
  Rng.prototype.amostra = function (arr, k) {
    if (k >= arr.length) return this.embaralhar(arr);
    var a = arr.slice(), out = [];
    for (var i = 0; i < k; i++) {
      var j = i + Math.floor(this.next() * (a.length - i));
      var t = a[i]; a[i] = a[j]; a[j] = t;
      out.push(a[i]);
    }
    return out;
  };

  /**
   * k elementos distintos com probabilidade proporcional a pesos[i].
   * Amostragem sequencial: sorteia, remove, renormaliza.
   */
  Rng.prototype.amostraPonderada = function (arr, pesos, k) {
    var itens = arr.slice(), p = pesos.slice(), out = [];
    k = Math.min(k, itens.length);
    for (var n = 0; n < k; n++) {
      var total = 0, i;
      for (i = 0; i < p.length; i++) total += p[i];
      var alvo = this.next() * total, acc = 0, idx = p.length - 1;
      for (i = 0; i < p.length; i++) {
        acc += p[i];
        if (alvo <= acc) { idx = i; break; }
      }
      out.push(itens[idx]);
      itens.splice(idx, 1);
      p.splice(idx, 1);
      if (!itens.length) break;
    }
    return out;
  };

  var ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function novaSemente() {
    var s = '';
    for (var i = 0; i < 8; i++) {
      s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
    }
    return s;
  }

  LC.Rng = Rng;
  LC.novaSemente = novaSemente;

})(this);
