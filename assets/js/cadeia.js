/* ============================================================================
 * LOTOCALC — Cadeia: hash encadeado com projeção em parâmetros
 * ----------------------------------------------------------------------------
 * A ideia: o digest NUNCA vira dezena diretamente. Cada volta da cadeia é uma
 * quarter-round no estilo ChaCha sobre 128 bits de estado (4 × uint32). Desse
 * estado extraímos um VETOR DE PARÂMETROS — centro, largura, paridade, ritmo —
 * que deforma a curva de probabilidade sobre o universo de dezenas. Só então
 * os números são sorteados dessa curva.
 *
 * Cada jogo extraído é reabsorvido pelo estado (elo → elo), de modo que o jogo
 * seguinte nasce do anterior. O slider de temperatura interpola entre a curva
 * uniforme (0) e a curva deformada pela cadeia (1).
 *
 * Tudo em aritmética inteira de 32 bits: determinístico, sem alocação no laço.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});

  var U32 = 4294967296;

  function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

  function popcount32(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    x = (x + (x >>> 4)) & 0x0f0f0f0f;
    return (Math.imul(x, 0x01010101) >>> 24);
  }

  function hexde(x) {
    var s = (x >>> 0).toString(16);
    while (s.length < 8) s = '0' + s;
    return s;
  }

  /* ---------------------------------------------------------------------- */

  function Cadeia(semente) {
    this.hist = [];          // bits virados por volta (para o gráfico)
    this.elos = [];          // digests dos jogos já forjados
    this.reiniciar(semente);
  }

  Cadeia.prototype.reiniciar = function (semente) {
    this.semente = String(semente == null ? '' : semente);
    // FNV-1a sobre a semente → splitmix32 para preencher os 4 registradores
    var h = 2166136261 >>> 0, i;
    for (i = 0; i < this.semente.length; i++) {
      h ^= this.semente.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    var s = h >>> 0, r = [];
    for (i = 0; i < 4; i++) {
      s = (s + 0x9E3779B9) >>> 0;
      var z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35) >>> 0;
      r.push((z ^ (z >>> 16)) >>> 0);
    }
    // Constantes "expa nd 3 2-b yte k" da ChaCha, para o estado nunca nascer zerado
    this.a = (r[0] ^ 0x61707865) >>> 0;
    this.b = (r[1] ^ 0x3320646E) >>> 0;
    this.c = (r[2] ^ 0x79622D32) >>> 0;
    this.d = (r[3] ^ 0x6B206574) >>> 0;
    this.voltas = 0;
    this.virados = 0;
    this.mascara = [0, 0, 0, 0];  // bits que mudaram na última volta
    this.hist.length = 0;
    this.elos.length = 0;
    return this;
  };

  /** Uma volta da cadeia. Devolve quantos dos 128 bits viraram. */
  Cadeia.prototype.volta = function () {
    var a = this.a, b = this.b, c = this.c, d = this.d;
    var a0 = a, b0 = b, c0 = c, d0 = d;

    a = (a + b) >>> 0; d = rotl(d ^ a, 16);
    c = (c + d) >>> 0; b = rotl(b ^ c, 12);
    a = (a + b) >>> 0; d = rotl(d ^ a, 8);
    c = (c + d) >>> 0; b = rotl(b ^ c, 7);

    this.a = a; this.b = b; this.c = c; this.d = d;

    var ma = (a ^ a0) >>> 0, mb = (b ^ b0) >>> 0, mc = (c ^ c0) >>> 0, md = (d ^ d0) >>> 0;
    this.mascara[0] = ma; this.mascara[1] = mb; this.mascara[2] = mc; this.mascara[3] = md;
    this.virados = popcount32(ma) + popcount32(mb) + popcount32(mc) + popcount32(md);

    this.voltas++;
    this.hist.push(this.virados);
    if (this.hist.length > 96) this.hist.shift();
    return this.virados;
  };

  Cadeia.prototype.rodar = function (n) {
    for (var i = 0; i < n; i++) this.volta();
    return this;
  };

  /** Mistura valores externos no estado (o jogo anterior vira semente do próximo). */
  Cadeia.prototype.absorver = function (valores) {
    for (var i = 0; i < valores.length; i++) {
      var v = (valores[i] | 0) >>> 0;
      this.a = (this.a ^ Math.imul(v + i + 1, 0x9E3779B1)) >>> 0;
      this.c = (this.c + rotl(v + 0x85EBCA6B, (i % 31) + 1)) >>> 0;
      this.volta();
    }
    return this;
  };

  /** Float em [0,1) — consome uma volta, então a cadeia nunca fica parada. */
  Cadeia.prototype.proximo = function () {
    this.volta();
    return (((this.a ^ this.c) >>> 0) + (((this.b ^ this.d) >>> 0) / U32)) / U32;
  };

  Cadeia.prototype.digest = function () {
    return ((this.a ^ this.b ^ this.c ^ this.d) >>> 0);
  };

  Cadeia.prototype.hex = function () {
    return hexde(this.a) + hexde(this.b) + hexde(this.c) + hexde(this.d);
  };

  Cadeia.prototype.hexCurto = function () {
    return hexde(this.digest()).slice(0, 6);
  };

  /** Os 128 bits do estado, do mais significativo de A ao menos de D. */
  Cadeia.prototype.bits = function (destino) {
    var out = destino || new Uint8Array(128);
    var reg = [this.a, this.b, this.c, this.d];
    for (var r = 0; r < 4; r++) {
      for (var i = 0; i < 32; i++) {
        out[r * 32 + i] = (reg[r] >>> (31 - i)) & 1;
      }
    }
    return out;
  };

  /** Máscara dos bits que viraram na última volta, no mesmo layout de bits(). */
  Cadeia.prototype.bitsVirados = function (destino) {
    var out = destino || new Uint8Array(128);
    for (var r = 0; r < 4; r++) {
      var m = this.mascara[r];
      for (var i = 0; i < 32; i++) {
        out[r * 32 + i] = (m >>> (31 - i)) & 1;
      }
    }
    return out;
  };

  /* ---- projeção do estado no vetor de parâmetros ------------------------ */

  /**
   * Quatro números do estado viram os controles da curva:
   *   centro   posição do pico no universo        (0..1)
   *   largura  dispersão em torno do centro       (0.10..0.95)
   *   paridade puxão para pares (+) ou ímpares (−) (−1..1)
   *   ritmo    frequência da modulação periódica  (0.5..6)
   *   fase     deslocamento da modulação          (0..2π)
   */
  Cadeia.prototype.parametros = function () {
    var a = this.a / U32, b = this.b / U32, c = this.c / U32, d = this.d / U32;
    return {
      centro: 0.10 + a * 0.80,
      largura: 0.10 + b * 0.85,
      paridade: c * 2 - 1,
      ritmo: 0.5 + d * 5.5,
      fase: ((this.a ^ this.d) >>> 0) / U32 * Math.PI * 2
    };
  };

  /**
   * Curva de probabilidade sobre um conjunto de dezenas.
   * temperatura 0 → uniforme; 1 → totalmente moldada pela cadeia.
   */
  Cadeia.prototype.curva = function (dezenas, lot, temperatura, p) {
    p = p || this.parametros();
    var span = (lot.max - lot.min) || 1;
    var n = dezenas.length;
    var bruto = new Array(n);
    var soma = 0, i;

    for (i = 0; i < n; i++) {
      var x = (dezenas[i] - lot.min) / span;
      var dx = x - p.centro;
      var g = Math.exp(-(dx * dx) / (2 * p.largura * p.largura));
      var par = 1 + p.paridade * (dezenas[i] % 2 === 0 ? 0.55 : -0.55);
      var mod = 1 + 0.45 * Math.sin(2 * Math.PI * p.ritmo * x + p.fase);
      var w = g * par * mod;
      if (!(w > 0)) w = 0.0001;
      bruto[i] = w;
      soma += w;
    }

    // normaliza para média 1 e interpola com a curva plana
    var media = soma / n || 1;
    var t = Math.max(0, Math.min(1, temperatura));
    var out = new Array(n);
    for (i = 0; i < n; i++) {
      var rel = bruto[i] / media;
      out[i] = Math.max(0.015, 1 + t * (rel - 1));
    }
    return out;
  };

  /** Sorteia k dezenas da curva, sem reposição, usando a própria cadeia como fonte. */
  Cadeia.prototype.sortear = function (dezenas, k, lot, temperatura, p) {
    var itens = dezenas.slice();
    var pesos = this.curva(itens, lot, temperatura, p);
    var out = [];
    k = Math.min(k, itens.length);

    for (var n = 0; n < k; n++) {
      var total = 0, i;
      for (i = 0; i < pesos.length; i++) total += pesos[i];
      var alvo = this.proximo() * total, acc = 0, idx = pesos.length - 1;
      for (i = 0; i < pesos.length; i++) {
        acc += pesos[i];
        if (alvo <= acc) { idx = i; break; }
      }
      out.push(itens[idx]);
      itens.splice(idx, 1);
      pesos.splice(idx, 1);
      if (!itens.length) break;
    }
    return out.sort(function (x, y) { return x - y; });
  };

  /** Fecha um elo: registra o digest do jogo e o realimenta no estado. */
  Cadeia.prototype.fecharElo = function (dezenas, deriva) {
    var marca = this.hexCurto();
    this.elos.push({ n: this.elos.length + 1, hex: marca, dezenas: dezenas.slice() });
    if (this.elos.length > 200) this.elos.shift();
    this.absorver(dezenas);
    if (deriva > 0) this.rodar(deriva);
    return marca;
  };

  /* ---- métricas de qualidade da mistura --------------------------------- */

  /** Média de bits virados por volta. O ideal teórico é 64 de 128 (avalanche). */
  Cadeia.prototype.avalanche = function () {
    if (!this.hist.length) return 0;
    var s = 0;
    for (var i = 0; i < this.hist.length; i++) s += this.hist[i];
    return s / this.hist.length;
  };

  LC.Cadeia = Cadeia;
  LC.popcount32 = popcount32;

})(this);
