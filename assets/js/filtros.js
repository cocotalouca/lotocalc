/* ============================================================================
 * LOTOCALC — Métricas de um jogo e filtros estatísticos
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});

  /* ---- tabelas auxiliares ------------------------------------------------ */

  var PRIMOS = (function () {
    var lim = 120, crivo = new Array(lim + 1).fill(true), out = {};
    crivo[0] = crivo[1] = false;
    for (var i = 2; i * i <= lim; i++) {
      if (crivo[i]) for (var j = i * i; j <= lim; j += i) crivo[j] = false;
    }
    for (var k = 0; k <= lim; k++) if (crivo[k]) out[k] = true;
    return out;
  })();

  var FIBO = { 1: true, 2: true, 3: true, 5: true, 8: true, 13: true, 21: true, 34: true, 55: true, 89: true };

  /* Moldura da Lotofácil: borda da grade 5x5 (16 dezenas). Miolo: as 9 centrais. */
  var MOLDURA_LF = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 10: 1, 11: 1, 15: 1, 16: 1, 20: 1, 21: 1, 22: 1, 23: 1, 24: 1, 25: 1 };

  /* ---- métricas ---------------------------------------------------------- */

  /**
   * Calcula todas as métricas de um jogo.
   * @param {object} lot modalidade
   * @param {number[]} dezenas jogo já ordenado ou não
   * @param {object} [ctx] { anterior: number[] } concurso anterior para "repetidas"
   */
  function metricas(lot, dezenas, ctx) {
    var d = dezenas.slice().sort(function (a, b) { return a - b; });
    var m = {
      soma: 0, pares: 0, impares: 0, primos: 0, fibo: 0, mult3: 0,
      consecutivos: 0, amplitude: 0, moldura: 0, miolo: 0,
      repetidas: 0, maxTerminacao: 0, linhas: 0, colunas: 0, quadrantes: 0
    };
    if (!d.length) return m;

    var terminacoes = {}, linhas = {}, colunas = {}, quadr = {};
    var grade = lot.grade || 10;
    var meioLinha = Math.ceil(((lot.max - lot.min + 1) / grade) / 2);
    var meioCol = Math.ceil(grade / 2);
    var run = 1, maxRun = 1;

    for (var i = 0; i < d.length; i++) {
      var n = d[i];
      m.soma += n;
      if (n % 2 === 0) m.pares++; else m.impares++;
      if (PRIMOS[n]) m.primos++;
      if (FIBO[n]) m.fibo++;
      if (n % 3 === 0) m.mult3++;

      var t = n % 10;
      terminacoes[t] = (terminacoes[t] || 0) + 1;

      var idx = n - lot.min;
      var lin = Math.floor(idx / grade), col = idx % grade;
      linhas[lin] = 1; colunas[col] = 1;
      quadr[(lin < meioLinha ? 'A' : 'B') + (col < meioCol ? '1' : '2')] = 1;

      if (lot.id === 'lotofacil') { if (MOLDURA_LF[n]) m.moldura++; else m.miolo++; }

      if (i > 0) {
        if (d[i] === d[i - 1] + 1) { run++; if (run > maxRun) maxRun = run; }
        else run = 1;
      }
    }

    m.amplitude = d[d.length - 1] - d[0];
    m.consecutivos = maxRun;
    m.linhas = Object.keys(linhas).length;
    m.colunas = Object.keys(colunas).length;
    m.quadrantes = Object.keys(quadr).length;
    m.maxTerminacao = Math.max.apply(null, Object.keys(terminacoes).map(function (k) { return terminacoes[k]; }));

    if (ctx && ctx.anterior && ctx.anterior.length) {
      var set = {};
      ctx.anterior.forEach(function (x) { set[x] = 1; });
      m.repetidas = d.filter(function (x) { return set[x]; }).length;
    }
    return m;
  }

  /* ---- filtros ----------------------------------------------------------- */

  /** Definição declarativa dos filtros disponíveis. */
  var DEFS = [
    { id: 'soma', rotulo: 'Soma das dezenas', tipo: 'faixa', campo: 'soma', dica: 'Soma total do jogo dentro da faixa mais provável.' },
    { id: 'pares', rotulo: 'Dezenas pares', tipo: 'faixa', campo: 'pares', dica: 'Equilíbrio entre pares e ímpares.' },
    { id: 'primos', rotulo: 'Números primos', tipo: 'faixa', campo: 'primos', dica: 'Quantidade de primos no jogo.' },
    { id: 'consecutivos', rotulo: 'Sequência máxima', tipo: 'max', campo: 'consecutivos', dica: 'Maior sequência de dezenas seguidas (ex.: 14-15-16 = 3).' },
    { id: 'amplitude', rotulo: 'Amplitude', tipo: 'faixa', campo: 'amplitude', dica: 'Distância entre a menor e a maior dezena.' },
    { id: 'maxTerminacao', rotulo: 'Mesma terminação', tipo: 'max', campo: 'maxTerminacao', dica: 'Máximo de dezenas terminadas no mesmo algarismo.' },
    { id: 'colunas', rotulo: 'Colunas cobertas', tipo: 'min', campo: 'colunas', dica: 'Mínimo de colunas diferentes do volante.' },
    { id: 'linhas', rotulo: 'Linhas cobertas', tipo: 'min', campo: 'linhas', dica: 'Mínimo de linhas diferentes do volante.' },
    { id: 'moldura', rotulo: 'Moldura (Lotofácil)', tipo: 'faixa', campo: 'moldura', somente: ['lotofacil'], dica: 'Dezenas na borda da grade 5×5.' },
    { id: 'repetidas', rotulo: 'Repetidas do concurso anterior', tipo: 'faixa', campo: 'repetidas', requerAnterior: true, dica: 'Quantas dezenas se repetem do último resultado informado.' },
    { id: 'mult3', rotulo: 'Múltiplos de 3', tipo: 'faixa', campo: 'mult3', dica: 'Quantidade de múltiplos de 3.' },
    { id: 'fibo', rotulo: 'Fibonacci', tipo: 'faixa', campo: 'fibo', dica: 'Dezenas da sequência 1,2,3,5,8,13,21,34,55,89.' }
  ];

  /** Faixas sugeridas — média teórica ± 1 desvio-padrão para k dezenas de um universo N. */
  function sugerir(lot, k) {
    var N = lot.max - lot.min + 1;
    var s = {};

    // Soma: distribuição de uma amostra sem reposição.
    var media = k * (lot.min + lot.max) / 2;
    var varSoma = (k * (N * N - 1) / 12) * ((N - k) / (N - 1));
    var dp = Math.sqrt(Math.max(varSoma, 0));
    s.soma = { min: Math.round(media - dp), max: Math.round(media + dp) };

    // Pares: hipergeométrica, aproximada por k/2 ± 1.
    var pares = Math.floor(N / 2);
    var mp = k * pares / N;
    var dpp = Math.max(1, Math.round(Math.sqrt(k * 0.25) * 1.1));
    s.pares = { min: Math.max(0, Math.round(mp - dpp)), max: Math.min(k, Math.round(mp + dpp)) };

    // Primos no universo.
    var qp = 0;
    for (var i = lot.min; i <= lot.max; i++) if (PRIMOS[i]) qp++;
    var mpr = k * qp / N;
    s.primos = { min: Math.max(0, Math.floor(mpr - Math.sqrt(mpr) - 0.5)), max: Math.min(k, Math.ceil(mpr + Math.sqrt(mpr) + 0.5)) };

    s.consecutivos = { max: k <= 6 ? 2 : 3 };
    s.amplitude = { min: Math.round(N * 0.55), max: N - 1 };
    s.maxTerminacao = { max: Math.max(2, Math.ceil(k / 3)) };
    s.colunas = { min: Math.min(lot.grade || 10, Math.max(3, Math.round((lot.grade || 10) * 0.6))) };
    s.linhas = { min: Math.max(2, Math.round(Math.min(k, Math.ceil(N / (lot.grade || 10))) * 0.5)) };

    var m3 = k * Math.floor(N / 3) / N;
    s.mult3 = { min: Math.max(0, Math.floor(m3 - Math.sqrt(m3) - 0.5)), max: Math.min(k, Math.ceil(m3 + Math.sqrt(m3) + 0.5)) };

    var qf = 0;
    for (var j = lot.min; j <= lot.max; j++) if (FIBO[j]) qf++;
    var mf = k * qf / N;
    s.fibo = { min: 0, max: Math.min(k, Math.ceil(mf + 1.5)) };

    if (lot.id === 'lotofacil') {
      var mm = k * 16 / 25;
      s.moldura = { min: Math.round(mm - 1.5), max: Math.round(mm + 1.5) };
    }

    var mr = k * (lot.sorteadas || k) / N;
    s.repetidas = { min: Math.max(0, Math.floor(mr - Math.sqrt(mr) - 0.5)), max: Math.min(k, Math.ceil(mr + Math.sqrt(mr) + 1)) };

    return s;
  }

  /** Testa um jogo contra a configuração de filtros. Retorna o id do 1º filtro reprovado, ou null. */
  function reprovaEm(m, filtros) {
    for (var i = 0; i < DEFS.length; i++) {
      var def = DEFS[i], f = filtros[def.id];
      if (!f || !f.ativo) continue;
      var v = m[def.campo];
      if (def.tipo === 'faixa' && (v < f.min || v > f.max)) return def.id;
      if (def.tipo === 'max' && v > f.max) return def.id;
      if (def.tipo === 'min' && v < f.min) return def.id;
    }
    return null;
  }

  LC.PRIMOS = PRIMOS;
  LC.FIBO = FIBO;
  LC.MOLDURA_LF = MOLDURA_LF;
  LC.metricas = metricas;
  LC.FILTROS_DEFS = DEFS;
  LC.sugerirFiltros = sugerir;
  LC.reprovaEm = reprovaEm;

})(this);
