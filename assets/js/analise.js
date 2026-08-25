/* ============================================================================
 * LOTOCALC — Estatística dos jogos, leitura de histórico e conferidor
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});

  /* ---- leitura de números em texto livre -------------------------------- */

  function numerosDoTexto(txt) {
    var achados = String(txt || '').match(/\d+/g) || [];
    return achados.map(Number);
  }

  /**
   * Lê um histórico colado: uma linha por concurso.
   * Números fora do universo são descartados; se sobrar mais que o sorteio,
   * ficam os últimos (assim uma linha "2650 04 12 ..." ignora o nº do concurso).
   * A ordem esperada é do concurso mais recente para o mais antigo.
   */
  function lerHistorico(txt, lot) {
    var linhas = String(txt || '').split(/[\r\n;]+/);
    var out = [];
    linhas.forEach(function (linha) {
      if (!linha.trim()) return;
      var nums = numerosDoTexto(linha).filter(function (n) {
        return n >= lot.min && n <= lot.max;
      });
      // remove duplicatas preservando a ordem
      var vistos = {}, limpos = [];
      nums.forEach(function (n) { if (!vistos[n]) { vistos[n] = 1; limpos.push(n); } });
      if (limpos.length > lot.sorteadas) limpos = limpos.slice(limpos.length - lot.sorteadas);
      if (limpos.length >= Math.max(2, Math.floor(lot.sorteadas * 0.6))) {
        out.push(limpos.sort(function (a, b) { return a - b; }));
      }
    });
    return out;
  }

  /* ---- estatísticas do histórico ---------------------------------------- */

  function estatisticasHistorico(lot, historico) {
    var uni = LC.universo(lot);
    var freq = {}, atraso = {};
    uni.forEach(function (n) { freq[n] = 0; atraso[n] = historico.length; });
    historico.forEach(function (sorteio, i) {
      sorteio.forEach(function (n) {
        if (freq[n] === undefined) return;
        freq[n]++;
        if (atraso[n] === historico.length) atraso[n] = i;
      });
    });
    var lista = uni.map(function (n) {
      return { n: n, freq: freq[n], atraso: atraso[n], pct: historico.length ? freq[n] / historico.length : 0 };
    });
    return {
      concursos: historico.length,
      lista: lista,
      quentes: lista.slice().sort(function (a, b) { return b.freq - a.freq || a.n - b.n; }),
      frios: lista.slice().sort(function (a, b) { return a.freq - b.freq || a.n - b.n; }),
      atrasadas: lista.slice().sort(function (a, b) { return b.atraso - a.atraso || a.n - b.n; })
    };
  }

  /* ---- estatísticas do conjunto gerado ---------------------------------- */

  function estatisticasGeradas(lot, jogos) {
    var uni = LC.universo(lot);
    var freq = {};
    uni.forEach(function (n) { freq[n] = 0; });

    var somas = [], pares = {}, primos = {}, total = 0, custo = 0;
    var comDezenas = jogos.filter(function (j) { return j.dezenas; });

    comDezenas.forEach(function (j) {
      j.dezenas.forEach(function (n) { if (freq[n] !== undefined) freq[n]++; });
      somas.push(j.metricas.soma);
      pares[j.metricas.pares] = (pares[j.metricas.pares] || 0) + 1;
      primos[j.metricas.primos] = (primos[j.metricas.primos] || 0) + 1;
      total++;
    });
    jogos.forEach(function (j) { custo += j.custo || 0; });

    var maxFreq = 0;
    uni.forEach(function (n) { if (freq[n] > maxFreq) maxFreq = freq[n]; });

    somas.sort(function (a, b) { return a - b; });
    var mediaSoma = somas.length ? somas.reduce(function (a, b) { return a + b; }, 0) / somas.length : 0;

    return {
      total: jogos.length,
      custo: custo,
      frequencia: uni.map(function (n) { return { n: n, c: freq[n] }; }),
      maxFreq: maxFreq,
      usadas: uni.filter(function (n) { return freq[n] > 0; }).length,
      universo: uni.length,
      soma: {
        min: somas[0] || 0,
        max: somas[somas.length - 1] || 0,
        media: mediaSoma,
        mediana: somas.length ? somas[Math.floor(somas.length / 2)] : 0,
        valores: somas
      },
      pares: pares,
      primos: primos,
      jogosComDezenas: total
    };
  }

  /* ---- conferidor -------------------------------------------------------- */

  function faixaDe(lot, acertos, acertosExtra) {
    if (lot.id === 'lotomania' && acertos === 0) {
      return { n: 0, nome: 'Nenhum acerto' };
    }
    for (var i = 0; i < lot.faixas.length; i++) {
      var f = lot.faixas[i];
      if (f.n === 0) continue;
      if (f.t !== undefined) {
        if (acertos >= f.n && (acertosExtra || 0) >= f.t) return f;
      } else if (acertos >= f.n) {
        return f;
      }
    }
    return null;
  }

  function contarComuns(a, b) {
    var set = {}, c = 0;
    (b || []).forEach(function (n) { set[n] = 1; });
    (a || []).forEach(function (n) { if (set[n]) c++; });
    return c;
  }

  /**
   * Confere os jogos contra um resultado.
   * @param {object} lot
   * @param {Array} jogos
   * @param {object} res { dezenas, trevos, extra, colunas, placares, bilhete }
   */
  function conferir(lot, jogos, res) {
    var linhas = jogos.map(function (j) {
      var r = { n: j.n, jogo: j, acertos: 0, extraOk: false, faixa: null, marcados: [] };

      if (lot.tipo === 'colunas') {
        var col = res.colunas || [];
        for (var c = 0; c < (j.colunas || []).length; c++) {
          var ok = col[c] !== undefined && col[c] !== null && j.colunas[c].indexOf(col[c]) !== -1;
          if (ok) r.acertos++;
          r.marcados.push(ok);
        }
      } else if (lot.tipo === 'placares') {
        var pl = res.placares || [];
        for (var p = 0; p < (j.placares || []).length; p++) {
          var okp = pl[p] && j.placares[p].indexOf(pl[p]) !== -1;
          if (okp) r.acertos++;
          r.marcados.push(!!okp);
        }
      } else if (lot.tipo === 'bilhete') {
        var alvo = String(res.bilhete || '');
        var meu = String(j.bilhete || '');
        var iguais = 0;
        for (var d = 1; d <= meu.length; d++) {
          if (alvo.slice(-d) === meu.slice(-d)) iguais = d; else break;
        }
        r.acertos = iguais;
      } else {
        r.acertos = contarComuns(j.dezenas, res.dezenas);
        if (lot.extra && lot.extra.tipo === 'dezenas') {
          r.acertosExtra = contarComuns(j.trevos, res.trevos);
        }
        if (lot.extra && lot.extra.tipo === 'lista') {
          r.extraOk = !!res.extra && j.extra === res.extra;
        }
      }

      r.faixa = faixaDe(lot, r.acertos, r.acertosExtra);
      return r;
    });

    var porFaixa = {}, premiados = 0;
    linhas.forEach(function (l) {
      if (!l.faixa) return;
      premiados++;
      porFaixa[l.faixa.nome] = (porFaixa[l.faixa.nome] || 0) + 1;
    });

    var melhor = linhas.reduce(function (a, b) { return b.acertos > a.acertos ? b : a; }, linhas[0] || { acertos: 0 });

    return {
      linhas: linhas,
      premiados: premiados,
      porFaixa: porFaixa,
      melhor: melhor ? melhor.acertos : 0,
      totalJogos: jogos.length
    };
  }

  LC.numerosDoTexto = numerosDoTexto;
  LC.lerHistorico = lerHistorico;
  LC.estatisticasHistorico = estatisticasHistorico;
  LC.estatisticasGeradas = estatisticasGeradas;
  LC.conferir = conferir;
  LC.faixaDe = faixaDe;

})(this);
