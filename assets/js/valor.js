/* ============================================================================
 * LOTOCALC — Probabilidades por faixa, valor esperado e prêmio em reais
 * ----------------------------------------------------------------------------
 * Tudo aqui depende do concurso: as chances são fixas, mas o quanto cada faixa
 * paga muda a cada sorteio. A faixa principal usa a ESTIMATIVA divulgada para
 * o próximo concurso; as demais usam a média paga por ganhador nos concursos
 * recentes (faixas de valor fixo, como os 11 acertos da Lotofácil, saem
 * exatas porque a média de um valor constante é ele mesmo).
 *
 * Cada faixa é descrita por "acertos exatos" numa aposta SIMPLES, na mesma
 * ordem do rateio da CAIXA (faixa 1, 2, 3...). Uma aposta de k dezenas vale
 * C(k, base) apostas simples, e o valor esperado é linear: o EV por real
 * apostado é o mesmo para qualquer tamanho de aposta.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});
  var C = function (n, k) { return LC.comb(n, k); };

  /* ---- estrutura das faixas, na ordem do rateio -------------------------- */

  function faixasDezenas(lista) {
    return lista.map(function (h) { return { h: h, nome: h + ' acertos' }; });
  }

  var ESTRUTURA = {
    megasena: faixasDezenas([6, 5, 4]),
    lotofacil: faixasDezenas([15, 14, 13, 12, 11]),
    quina: faixasDezenas([5, 4, 3, 2]),
    lotomania: faixasDezenas([20, 19, 18, 17, 16, 15, 0]),
    duplasena: faixasDezenas([6, 5, 4, 3]).map(function (f) { f.nome += ' · 1º sorteio'; f.sorteio = 1; return f; })
      .concat(faixasDezenas([6, 5, 4, 3]).map(function (f) { f.nome += ' · 2º sorteio'; f.sorteio = 2; return f; })),
    timemania: faixasDezenas([7, 6, 5, 4, 3]).concat([{ extra: true, nome: 'Time do Coração' }]),
    diadesorte: faixasDezenas([7, 6, 5, 4]).concat([{ extra: true, nome: 'Mês da Sorte' }]),
    supersete: [7, 6, 5, 4, 3].map(function (h) { return { h: h, nome: h + ' colunas' }; }),
    maismilionaria: [
      { h: 6, t: [2], nome: '6 + 2 trevos' },
      { h: 6, t: [0, 1], nome: '6 + 1 ou nenhum trevo' },
      { h: 5, t: [2], nome: '5 + 2 trevos' },
      { h: 5, t: [0, 1], nome: '5 + 1 ou nenhum trevo' },
      { h: 4, t: [2], nome: '4 + 2 trevos' },
      { h: 4, t: [0, 1], nome: '4 + 1 ou nenhum trevo' },
      { h: 3, t: [2], nome: '3 + 2 trevos' },
      { h: 3, t: [1], nome: '3 + 1 trevo' },
      { h: 2, t: [2], nome: '2 + 2 trevos' },
      { h: 2, t: [1], nome: '2 + 1 trevo' }
    ],
    // só para o prêmio em reais: placares reais não são equiprováveis, então sem EV
    loteca: [{ h: 14, nome: '14 acertos' }, { h: 13, nome: '13 acertos' }]
  };

  /** Valor esperado exige chances conhecidas — Loteca e Federal ficam de fora. */
  function suporta(lot) { return !!ESTRUTURA[lot.id] && lot.tipo !== 'placares'; }
  function estrutura(lot) { return ESTRUTURA[lot.id] || []; }

  /* ---- probabilidades ---------------------------------------------------- */

  /** P(exatamente h acertos) ao marcar k de um universo N com d sorteadas. */
  function hiper(N, d, k, h) {
    if (h < 0 || h > k || h > d || k - h > N - d) return 0;
    return C(d, h) * C(N - d, k - h) / C(N, k);
  }

  function tamanhoUniverso(lot) { return lot.max - lot.min + 1; }

  /** Probabilidade de cada faixa para UMA aposta simples. */
  function probSimples(lot) {
    var N = lot.tipo === 'dezenas' ? tamanhoUniverso(lot) : 0;
    return estrutura(lot).map(function (f) {
      if (f.extra) return 1 / lot.extra.opcoes.length;
      if (lot.tipo === 'colunas') {
        return C(lot.colunas, f.h) * Math.pow(0.1, f.h) * Math.pow(0.9, lot.colunas - f.h);
      }
      var p = hiper(N, lot.sorteadas, lot.base, f.h);
      if (f.t) {
        var ex = lot.extra;
        var pt = 0;
        f.t.forEach(function (s) { pt += hiper(ex.max - ex.min + 1, ex.sorteadas, ex.base, s); });
        p *= pt;
      }
      return p;
    });
  }

  /* ---- quantas apostas simples de cada faixa um jogo contém -------------- */

  /**
   * a = { k, kt, lens, m, m2, mt, hits, extraOk }
   *   k/kt   dezenas e trevos marcados      m/m2/mt  acertos (1º, 2º sorteio, trevos)
   *   lens   algarismos por coluna (Super Sete)   hits  coluna acertada? (bool[])
   */
  function contagens(lot, a) {
    var est = estrutura(lot);

    if (lot.tipo === 'colunas' || lot.tipo === 'placares') {
      // polinômio: coluna acertada contribui (x + L−1); errada, L
      var poli = [1];
      for (var c = 0; c < a.lens.length; c++) {
        var L = a.lens[c], novo = new Array(poli.length + 1).fill(0);
        for (var g = 0; g < poli.length; g++) {
          if (a.hits[c]) { novo[g + 1] += poli[g]; novo[g] += poli[g] * (L - 1); }
          else novo[g] += poli[g] * L;
        }
        poli = novo;
      }
      return est.map(function (f) { return poli[f.h] || 0; });
    }

    return est.map(function (f) {
      if (f.extra) return a.extraOk ? 1 : 0;
      var m = f.sorteio === 2 ? a.m2 : a.m;
      if (m == null) return 0;
      var n = C(m, f.h) * C(a.k - m, lot.base - f.h);
      if (f.t) {
        var ex = lot.extra, soma = 0;
        f.t.forEach(function (s) { soma += C(a.mt || 0, s) * C(a.kt - (a.mt || 0), ex.base - s); });
        n *= soma;
      }
      return n;
    });
  }

  function algumPremio(cont) {
    for (var i = 0; i < cont.length; i++) if (cont[i] > 0) return true;
    return false;
  }

  /**
   * Chance de um jogo com este formato ganhar QUALQUER faixa.
   * formato = { k, kt, lens }
   */
  function chanceAlgumPremio(lot, formato) {
    if (!suporta(lot)) return null;
    var est = estrutura(lot);

    if (lot.tipo === 'colunas') {
      var lens = formato.lens;
      var dist = [1];   // distribuição do nº de colunas acertadas
      lens.forEach(function (L) {
        var p = L / 10, nd = new Array(dist.length + 1).fill(0);
        dist.forEach(function (v, i) { nd[i + 1] += v * p; nd[i] += v * (1 - p); });
        dist = nd;
      });
      var minH = Math.min.apply(null, est.map(function (f) { return f.h; }));
      return dist.reduce(function (s, v, i) { return i >= minH ? s + v : s; }, 0);
    }

    var N = tamanhoUniverso(lot), k = formato.k;
    var semExtra = est.filter(function (f) { return !f.extra; });
    var umSorteio = semExtra.filter(function (f) { return f.sorteio !== 2; });

    var p = 0;
    for (var m = 0; m <= Math.min(k, lot.sorteadas); m++) {
      var pm = hiper(N, lot.sorteadas, k, m);
      if (!pm) continue;
      if (lot.extra && lot.extra.tipo === 'dezenas') {
        var ex = lot.extra, nt = ex.max - ex.min + 1;
        for (var mt = 0; mt <= Math.min(formato.kt, ex.sorteadas); mt++) {
          var pmt = hiper(nt, ex.sorteadas, formato.kt, mt);
          var cont = contagens(lot, { k: k, kt: formato.kt, m: m, mt: mt });
          if (algumPremio(cont)) p += pm * pmt;
        }
      } else {
        var c = umSorteio.map(function (f) {
          return C(m, f.h) * C(k - m, lot.base - f.h);
        });
        if (algumPremio(c)) p += pm;
      }
    }

    if (lot.sorteios === 2) p = 1 - (1 - p) * (1 - p);             // dois sorteios independentes
    if (lot.extra && lot.extra.tipo === 'lista') p = 1 - (1 - p) * (1 - 1 / lot.extra.opcoes.length);
    return p;
  }

  function formatoDoJogo(lot, jogo) {
    if (lot.tipo === 'colunas') return { lens: jogo.colunas.map(function (c) { return c.length; }) };
    return { k: jogo.dezenas.length, kt: (jogo.trevos || []).length };
  }

  /* ---- prêmio estimado por faixa ----------------------------------------- */

  /**
   * Apostas simples no último concurso, medidas pela faixa com mais ganhadores
   * (milhares de ganhadores = estimativa precisa). A arrecadação dividida pelo
   * preço serve de reserva — ela inclui tarifas de bolão e superestima.
   */
  function apostasEstimadas(lot, ult) {
    if (!ult) return 0;
    var est = estrutura(lot), probs = probSimples(lot), melhor = null;
    (ult.rateio || []).forEach(function (r, i) {
      if (!est[i] || est[i].extra || r.ganhadores < 200) return;
      if (!melhor || r.ganhadores > melhor.g) melhor = { g: r.ganhadores, p: probs[i] };
    });
    if (melhor) return melhor.g / melhor.p;
    return ult.arrecadado ? ult.arrecadado / lot.preco : 0;
  }

  /**
   * Valor esperado de uma aposta simples no PRÓXIMO concurso.
   *
   * ctx = {
   *   ultimo      concurso normalizado mais recente (traz a estimativa)
   *   amostra     concursos recentes (para a média das faixas variáveis)
   *   dividir     considerar que o prêmio principal pode ser dividido
   *   apostas     apostas simples esperadas no próximo concurso
   *   principal   substitui a estimativa do prêmio principal
   *   ir          descontar 30% de IR dos prêmios acima de limiteIR
   *   limiteIR
   *   manual      { indiceFaixa: valor } — prêmios digitados pelo usuário
   * }
   */
  function valorEsperado(lot, ctx) {
    var est = estrutura(lot);
    var probs = probSimples(lot);
    var amostra = ctx.amostra || [];
    var ult = ctx.ultimo;
    var apostas = ctx.apostas || apostasEstimadas(lot, ult);

    var linhas = est.map(function (f, i) {
      var p = probs[i];
      var pagos = amostra.map(function (r) { return r.rateio && r.rateio[i]; })
        .filter(function (x) { return x && x.ganhadores > 0 && x.valor > 0; });
      var media = pagos.length
        ? pagos.reduce(function (s, x) { return s + x.valor; }, 0) / pagos.length
        : 0;
      var fixo = pagos.length > 2 && pagos.every(function (x) { return Math.abs(x.valor - pagos[0].valor) < 0.005; });

      var bruto, base;
      if (i === 0 && ult && ult.proximo && ult.proximo.estimativa) {
        bruto = ult.proximo.estimativa;
        base = 'estimativa';
      } else if (pagos.length) {
        bruto = media;
        base = fixo ? 'fixo' : 'media';
      } else {
        bruto = 0;
        base = 'sem-dados';
      }
      if (i === 0 && ctx.principal) { bruto = ctx.principal; base = 'manual'; }
      if (ctx.manual && ctx.manual[i] != null && !isNaN(ctx.manual[i])) { bruto = ctx.manual[i]; base = 'manual'; }

      // divisão do principal: outros ganhadores ~ Poisson(λ = apostas · p)
      var divisor = 1;
      if (i === 0 && ctx.dividir && apostas > 0) {
        var lambda = apostas * p;
        divisor = lambda > 1e-9 ? (1 - Math.exp(-lambda)) / lambda : 1;
      }
      var liquido = bruto * divisor;
      var taxado = ctx.ir && liquido > (ctx.limiteIR || 0);
      if (taxado) liquido *= 0.7;

      var ganhadoresUlt = ult && ult.rateio && ult.rateio[i] ? ult.rateio[i].ganhadores : null;
      var apostasUlt = ult && ult.arrecadado ? ult.arrecadado / lot.preco : 0;

      return {
        i: i,
        nome: f.nome,
        p: p,
        bruto: bruto,
        base: base,
        amostraPagos: pagos.length,
        divisor: divisor,
        taxado: taxado,
        liquido: liquido,
        contribuicao: p * liquido,
        esperadosUlt: apostasUlt ? apostasUlt * p : null,
        ganhadoresUlt: ganhadoresUlt
      };
    });

    var ev = linhas.reduce(function (s, l) { return s + l.contribuicao; }, 0);
    var resto = ev - linhas[0].contribuicao;
    var p1 = linhas[0].p;
    var irFator = ctx.ir ? 0.7 : 1;

    return {
      linhas: linhas,
      ev: ev,                           // por aposta simples
      preco: lot.preco,
      retorno: ev / lot.preco,          // devolvido por real apostado
      apostas: apostas,
      // prêmio principal (bruto) que zeraria a perda esperada
      empate: p1 > 0 ? Math.max(0, (lot.preco - resto) / (p1 * irFator)) : null,
      empateComDivisao: p1 > 0 && linhas[0].divisor > 0
        ? Math.max(0, (lot.preco - resto) / (p1 * irFator * linhas[0].divisor))
        : null
    };
  }

  /* ---- prêmio real de um jogo conferido ---------------------------------- */

  function contarComuns(a, b) {
    var set = {}, c = 0;
    (b || []).forEach(function (n) { set[n] = 1; });
    (a || []).forEach(function (n) { if (set[n]) c++; });
    return c;
  }

  /**
   * Quanto um jogo recebe num concurso apurado, com o rateio oficial.
   * Uma aposta múltipla recebe por todas as apostas simples que contém.
   */
  function premioDoJogo(lot, jogo, res) {
    if (!ESTRUTURA[lot.id] || !res || !res.rateio || !res.rateio.length) return null;
    var a;
    if (lot.tipo === 'placares') {
      a = {
        lens: jogo.placares.map(function (p) { return p.length; }),
        hits: jogo.placares.map(function (p, i) { return !!res.placares && p.indexOf(res.placares[i]) !== -1; })
      };
    } else if (lot.tipo === 'colunas') {
      a = {
        lens: jogo.colunas.map(function (c) { return c.length; }),
        hits: jogo.colunas.map(function (c, i) { return res.colunas && c.indexOf(res.colunas[i]) !== -1; })
      };
    } else {
      a = {
        k: jogo.dezenas.length,
        kt: (jogo.trevos || []).length,
        m: contarComuns(jogo.dezenas, res.dezenas),
        m2: res.dezenas2 ? contarComuns(jogo.dezenas, res.dezenas2) : null,
        mt: contarComuns(jogo.trevos, res.trevos),
        extraOk: !!res.extra && jogo.extra === res.extra
      };
    }
    var cont = contagens(lot, a);
    var est = estrutura(lot);
    var itens = [], total = 0;
    cont.forEach(function (q, i) {
      if (!q) return;
      var r = res.rateio[i];
      var valor = r ? r.valor : 0;
      itens.push({ nome: est[i].nome, qtd: q, unitario: valor, valor: q * valor });
      total += q * valor;
    });
    return { total: total, itens: itens };
  }

  LC.valor = {
    suporta: suporta,
    estrutura: estrutura,
    probSimples: probSimples,
    chanceAlgumPremio: chanceAlgumPremio,
    formatoDoJogo: formatoDoJogo,
    valorEsperado: valorEsperado,
    premioDoJogo: premioDoJogo,
    apostasEstimadas: apostasEstimadas,
    hiper: hiper
  };

})(this);
