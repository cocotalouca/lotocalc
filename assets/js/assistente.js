/* ============================================================================
 * LOTOCALC — Assistente de apostas
 * ----------------------------------------------------------------------------
 * Junta o que se sabe de cada modalidade no dia (prêmio estimado, acumulado,
 * data do próximo sorteio, valor esperado por real) e monta "cestas": formas
 * diferentes de gastar o mesmo orçamento, cada uma com um objetivo — retorno,
 * prêmio máximo, ganhar alguma coisa, diversificar, uma múltipla, um
 * fechamento com garantia ou uma aposta em cada sorteio.
 *
 * Nada aqui muda a chance de um número sair. O que muda entre as cestas é
 * onde o dinheiro vai e em que formato — e isso muda o retorno esperado, a
 * chance de algum prêmio e o tamanho do prêmio possível.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});
  var DIA = 86400000;
  var MAX_JOGOS_ITEM = 300;

  /* ---- datas -------------------------------------------------------------- */

  function lerData(s) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || '');
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }

  function diasAte(data, hoje) {
    if (!data) return null;
    var base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.round((data - base) / DIA);
  }

  var SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  function quando(dias, data) {
    if (dias == null) return 'data a confirmar';
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'amanhã';
    if (dias < 0) return 'aguardando resultado';
    return SEMANA[data.getDay()] + ' ' + String(data.getDate()).padStart(2, '0') + '/' + String(data.getMonth() + 1).padStart(2, '0');
  }

  /* ---- formatos de aposta ------------------------------------------------- */

  /** Tamanhos de aposta que valem sugerir em cada modalidade. */
  function formatos(lot) {
    var out = [];
    if (lot.tipo === 'colunas') {
      out.push({ lens: [1, 1, 1, 1, 1, 1, 1] });
      return out;
    }
    if (lot.tipo !== 'dezenas') return out;
    var teto = Math.min(lot.escolhaMax, lot.base + 4);
    for (var k = lot.escolhaMin; k <= teto; k++) {
      if (lot.extra && lot.extra.tipo === 'dezenas') {
        for (var kt = lot.extra.escolhaMin; kt <= Math.min(lot.extra.escolhaMax, 4); kt++) out.push({ k: k, kt: kt });
      } else {
        out.push({ k: k, kt: 0 });
      }
    }
    return out;
  }

  function custoFormato(lot, f) {
    if (lot.tipo === 'colunas') return f.lens.reduce(function (a, b) { return a * b; }, 1) * lot.preco;
    return LC.custoPrevisto(lot, f.k, f.kt);
  }

  function ehSimples(lot, f) {
    if (lot.tipo === 'colunas') return f.lens.every(function (x) { return x === 1; });
    return f.k === lot.escolhaMin && (!f.kt || f.kt === lot.extra.escolhaMin);
  }

  function rotuloFormato(lot, f, qtd) {
    var q = qtd || 1;
    var jogos = q + (q === 1 ? ' jogo' : ' jogos');
    if (lot.tipo === 'colunas') return jogos + ' de 1 algarismo por coluna';
    var t = jogos + ' de ' + f.k + ' dezenas';
    if (f.kt) t += ' + ' + f.kt + ' trevos';
    return t;
  }

  /** Chance de levar a faixa principal com um jogo neste formato. */
  function chanceTopo(lot, f) {
    var est = LC.valor.estrutura(lot);
    if (!est.length) return 0;
    if (lot.tipo === 'colunas') return f.lens.reduce(function (a, L) { return a * L / 10; }, 1);
    var N = lot.max - lot.min + 1;
    var p = LC.valor.hiper(N, lot.sorteadas, f.k, est[0].h);
    if (est[0].t) {
      var ex = lot.extra;
      p *= LC.valor.hiper(ex.max - ex.min + 1, ex.sorteadas, f.kt, 2);
    }
    if (lot.sorteios === 2) p = 1 - (1 - p) * (1 - p);
    return p;
  }

  /* ---- avaliação de uma modalidade --------------------------------------- */

  /**
   * dados = { ultimo, amostra }  (formato de LC.resultados)
   * conf  = { dividir, ir, limiteIR, amostra }
   */
  function avaliar(lot, dados, conf, hoje) {
    hoje = hoje || new Date();
    var u = dados && dados.ultimo;
    var a = {
      lot: lot,
      ultimo: u || null,
      suporta: LC.valor.suporta(lot),
      estimativa: (u && u.proximo && u.proximo.estimativa) || 0,
      acumulado: (u && u.proximo && u.proximo.acumulado) || 0,
      acumulou: !!(u && u.acumulou),
      concurso: u && u.proximo ? u.proximo.concurso : null,
      data: null,
      dias: null
    };
    if (u && u.proximo) {
      a.data = lerData(u.proximo.data);
      a.dias = diasAte(a.data, hoje);
    }
    a.quando = quando(a.dias, a.data);
    if (!u || !a.suporta) return a;

    var amostra = (dados.amostra && dados.amostra.length ? dados.amostra : [u]).slice(0, conf.amostra || 20);
    var ev = LC.valor.valorEsperado(lot, {
      ultimo: u, amostra: amostra,
      dividir: conf.dividir, ir: conf.ir, limiteIR: conf.limiteIR
    });
    a.ev = ev;
    a.retorno = ev.retorno;
    a.retornoTopo = ev.linhas[0].contribuicao / lot.preco;
    a.premioLiquido = ev.linhas[0].liquido;
    a.formatos = formatos(lot).map(function (f) {
      var custo = custoFormato(lot, f);
      var simples = custo / lot.preco;
      return Object.assign({}, f, {
        custo: custo,
        simples: simples,
        ev: ev.ev * simples,
        chanceAlgum: LC.valor.chanceAlgumPremio(lot, f) || 0,
        chanceTopo: chanceTopo(lot, f),
        ehSimples: ehSimples(lot, f)
      });
    }).sort(function (x, y) { return x.custo - y.custo; });
    a.simples = a.formatos[0];
    return a;
  }

  /* ---- fechamentos com garantia ------------------------------------------ */

  var FECHAMENTOS = [
    { lotId: 'lotofacil', pool: 18, k: 15, se: 15, acertos: 13 },
    { lotId: 'lotofacil', pool: 19, k: 15, se: 15, acertos: 13 },
    { lotId: 'megasena', pool: 10, k: 6, se: 6, acertos: 4 },
    { lotId: 'quina', pool: 10, k: 5, se: 5, acertos: 3 },
    { lotId: 'duplasena', pool: 10, k: 6, se: 6, acertos: 4 },
    { lotId: 'diadesorte', pool: 11, k: 7, se: 7, acertos: 5 }
  ];
  var tamanhosFechamento = {};

  /** Quantos jogos o fechamento precisa — a cobertura não depende de quais dezenas estão no pool. */
  function jogosDoFechamento(fe) {
    var chave = [fe.lotId, fe.pool, fe.k, fe.se, fe.acertos].join(':');
    if (tamanhosFechamento[chave] != null) return tamanhosFechamento[chave];
    var lot = LC.lot(fe.lotId), pool = [];
    for (var i = 0; i < fe.pool; i++) pool.push(lot.min + i);
    var n = 0;
    try {
      var r = LC.gerar({
        lotId: fe.lotId, qtd: 400, dezenas: fe.k, fixas: pool, excluidas: [],
        estrategia: 'fechamento', seed: 'fechamento-' + chave,
        fechamento: { modo: 'reduzido', garantirSe: fe.se, garantirAcertos: fe.acertos }
      });
      var completo = r.avisos.some(function (a) { return /Garantia fechada/.test(a); });
      n = completo ? r.jogos.length : 0;
    } catch (e) { n = 0; }
    tamanhosFechamento[chave] = n;
    return n;
  }

  /* ---- cestas ------------------------------------------------------------- */

  function item(a, f, qtd, extra) {
    qtd = Math.max(0, Math.min(MAX_JOGOS_ITEM, qtd));
    return Object.assign({
      lotId: a.lot.id,
      lot: a.lot,
      aval: a,
      formato: f,
      qtd: qtd,
      custo: f.custo * qtd,
      ev: f.ev * qtd,
      chanceAlgum: 1 - Math.pow(1 - f.chanceAlgum, qtd),
      chanceTopo: 1 - Math.pow(1 - f.chanceTopo, qtd),
      rotulo: rotuloFormato(a.lot, f, qtd),
      estrategia: null
    }, extra || {});
  }

  /** Compra numa modalidade até gastar a verba: 'simples', 'caca' (múltipla com ≥ 2 jogos) ou 'maior'. */
  function comprar(a, verba, modo, multiplas) {
    var cabem = a.formatos.filter(function (f) { return f.custo <= verba + 1e-9; });
    if (!cabem.length) return [];
    var f = cabem[0];
    if (multiplas && modo === 'caca') {
      var metade = cabem.filter(function (x) { return x.custo <= verba / 2 + 1e-9; });
      if (metade.length) f = metade[metade.length - 1];
    } else if (multiplas && modo === 'maior') {
      f = cabem[cabem.length - 1];
    }
    var q = Math.floor(verba / f.custo + 1e-9);
    var out = [item(a, f, q)];
    var sobra = verba - q * f.custo;
    if (f !== a.simples && sobra >= a.simples.custo - 1e-9) {
      out.push(item(a, a.simples, Math.floor(sobra / a.simples.custo + 1e-9)));
    }
    return out;
  }

  function totais(itens, orcamento) {
    var t = { custo: 0, ev: 0, nenhum: 1, semTopo: 1, jogos: 0, maiorPremio: 0 };
    itens.forEach(function (it) {
      t.custo += it.custo;
      t.ev += it.ev;
      t.jogos += it.qtd;
      t.nenhum *= 1 - it.chanceAlgum;
      t.semTopo *= 1 - it.chanceTopo;
      t.maiorPremio = Math.max(t.maiorPremio, it.aval.estimativa || 0);
    });
    t.chanceAlgum = 1 - t.nenhum;
    t.chanceTopo = 1 - t.semTopo;
    t.retorno = t.custo ? t.ev / t.custo : 0;
    t.perda = t.custo - t.ev;
    t.sobra = Math.max(0, orcamento - t.custo);
    return t;
  }

  /** Junta itens repetidos (mesma modalidade e formato). */
  function consolidar(itens) {
    var mapa = {}, ordem = [];
    itens.forEach(function (it) {
      if (!it.qtd) return;
      var ch = it.lotId + '|' + JSON.stringify([it.formato.k, it.formato.kt, it.formato.lens]) + '|' + (it.fechamento ? 'f' : '');
      if (mapa[ch]) {
        var m = mapa[ch];
        mapa[ch] = item(m.aval, m.formato, m.qtd + it.qtd, { estrategia: m.estrategia, motivo: m.motivo });
        ordem[ordem.indexOf(m)] = mapa[ch];
      } else {
        mapa[ch] = it;
        ordem.push(it);
      }
    });
    return ordem;
  }

  function nomes(lista) {
    var n = lista.map(function (a) { return a.lot.nome; });
    if (n.length <= 1) return n.join('');
    return n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1];
  }

  /**
   * prefs = {
   *   orcamento, perfil (0 ganhar algo … 1 prêmio grande),
   *   horizonte ('hoje' | 'amanha' | 'semana'),
   *   estilos { simples, multiplas, fechamentos },
   *   modalidades { id: false } (fora das sugestões)
   * }
   */
  function montarCestas(avals, prefs, fmtos) {
    var fmt = fmtos.moeda, curto = fmtos.curto || fmtos.moeda;
    var B = Math.max(0, prefs.orcamento || 0);
    var estilos = prefs.estilos || {};
    var multiplas = estilos.multiplas !== false;
    var perfil = prefs.perfil == null ? 0.5 : prefs.perfil;
    var limite = { hoje: 0, amanha: 1, semana: 7 }[prefs.horizonte] != null ? { hoje: 0, amanha: 1, semana: 7 }[prefs.horizonte] : 1;

    var validas = avals.filter(function (a) {
      return a.suporta && a.retorno != null && (prefs.modalidades || {})[a.lot.id] !== false;
    });
    var futuras = validas.filter(function (a) { return a.dias != null && a.dias >= 0; });
    var noPrazo = futuras.filter(function (a) { return a.dias <= limite; });
    var aviso = null;

    if (!noPrazo.length && futuras.length) {
      var prox = Math.min.apply(null, futuras.map(function (a) { return a.dias; }));
      noPrazo = futuras.filter(function (a) { return a.dias === prox; });
      aviso = 'Nenhum sorteio das modalidades escolhidas no prazo — as sugestões usam os sorteios de ' + noPrazo[0].quando + '.';
    }
    if (!noPrazo.length) noPrazo = validas.slice();

    var barata = Math.min.apply(null, noPrazo.map(function (a) { return a.simples.custo; }).concat([Infinity]));
    if (!noPrazo.length || B < barata) {
      return {
        cestas: [],
        aviso: noPrazo.length
          ? 'Com ' + fmt(B) + ' não dá para nenhuma aposta — a mais barata no prazo custa ' + fmt(barata) + '.'
          : 'Ainda não há dados das modalidades escolhidas.',
        noPrazo: noPrazo
      };
    }

    var cestas = [];
    function porRetorno(x, y) { return y.retorno - x.retorno; }
    function pct(x) { return fmt(x * 100); }
    var periodo = limite === 0 ? 'de hoje' : limite === 1 ? 'de hoje e amanhã' : 'da semana';

    /* 1. Mix do seu perfil ------------------------------------------------ */
    (function () {
      var maxChance = Math.max.apply(null, noPrazo.map(function (a) { return a.simples.chanceAlgum / a.simples.custo; }));
      var maxTopo = Math.max.apply(null, noPrazo.map(function (a) { return a.retornoTopo; })) || 1;
      var pontuadas = noPrazo.map(function (a) {
        var sonho = a.retornoTopo / maxTopo;
        var freq = (a.simples.chanceAlgum / a.simples.custo) / (maxChance || 1);
        return { a: a, s: (0.35 + a.retorno) * (perfil * sonho + (1 - perfil) * freq) + 0.02 };
      }).sort(function (x, y) { return y.s - x.s; }).slice(0, 5);

      var usarMulti = multiplas && perfil >= 0.66;
      var itens = [], resta = B, compradas = {};
      var guarda = 0;
      while (guarda++ < 2000) {
        var melhor = null, melhorS = -1;
        pontuadas.forEach(function (p) {
          var f = p.a.simples;
          if (usarMulti && (compradas[p.a.lot.id] || 0) === 0) {
            var multi = p.a.formatos.filter(function (x) { return !x.ehSimples && x.custo <= Math.min(resta, B * 0.5) + 1e-9; });
            if (multi.length) f = multi[0];
          }
          if (f.custo > resta + 1e-9) return;
          var s = p.s / (1 + (compradas[p.a.lot.id] || 0) * 0.9);
          if (s > melhorS) { melhorS = s; melhor = { a: p.a, f: f }; }
        });
        if (!melhor) break;
        itens.push(item(melhor.a, melhor.f, 1));
        compradas[melhor.a.lot.id] = (compradas[melhor.a.lot.id] || 0) + 1;
        resta -= melhor.f.custo;
        if (itens.length >= MAX_JOGOS_ITEM) break;
      }
      itens = consolidar(itens);
      var alvo = perfil >= 0.66 ? 'no prêmio grande' : perfil <= 0.34 ? 'em ganhar alguma coisa' : 'num meio-termo entre prêmio grande e prêmio frequente';
      var unicas = [];
      itens.forEach(function (i) { if (unicas.indexOf(i.aval) === -1) unicas.push(i.aval); });
      cestas.push({
        id: 'mix',
        titulo: 'Mix do seu perfil',
        tag: 'Feita para você',
        afinidade: perfil,
        porque: 'Distribui o orçamento entre ' + nomes(unicas) +
          ', pesando o retorno de cada uma e o seu foco ' + alvo + '.',
        itens: itens
      });
    })();

    /* 2. Melhor retorno por real ------------------------------------------- */
    (function () {
      var ord = noPrazo.slice().sort(porRetorno);
      var top = ord[0];
      var dividir = ord[1] && B >= 20 * top.simples.custo;
      var itens = comprar(top, dividir ? B * 0.7 : B, 'simples', false);
      var sobra = B - itens.reduce(function (s, i) { return s + i.custo; }, 0);
      if (ord[1] && sobra >= ord[1].simples.custo) itens = itens.concat(comprar(ord[1], sobra, 'simples', false));
      cestas.push({
        id: 'retorno',
        titulo: 'Onde o real rende mais',
        tag: 'Maior valor esperado',
        afinidade: 0.5,
        porque: top.lot.nome + ' devolve em média ' + pct(top.retorno) + ' de cada R$ 100 apostados' +
          (top.acumulou ? ', acumulada em ' + curto(top.estimativa) : '') +
          ' — o melhor retorno entre os sorteios ' + periodo + '.' +
          (dividir ? ' Uma parte vai para a ' + ord[1].lot.nome + ', a segunda colocada.' : ''),
        itens: consolidar(itens)
      });
    })();

    /* 3. Caça ao prêmio máximo --------------------------------------------- */
    (function () {
      var maxEst = Math.max.apply(null, noPrazo.map(function (a) { return a.estimativa; })) || 1;
      var nota = function (a) { return a.retornoTopo * (a.estimativa / maxEst); };
      var ord = noPrazo.slice().sort(function (x, y) { return nota(y) - nota(x); });
      var escolhidas = ord.slice(0, 2).filter(function (a, i) { return i === 0 || B * 0.35 >= a.simples.custo; });
      var itens = [];
      if (escolhidas.length === 2) {
        itens = comprar(escolhidas[0], B * 0.65, 'caca', multiplas);
        var gasto = itens.reduce(function (s, i) { return s + i.custo; }, 0);
        itens = itens.concat(comprar(escolhidas[1], B - gasto, 'caca', multiplas));
      } else {
        itens = comprar(escolhidas[0], B, 'caca', multiplas);
      }
      cestas.push({
        id: 'jackpot',
        titulo: 'Caça ao prêmio máximo',
        tag: 'Prêmio grande',
        afinidade: 1,
        porque: escolhidas.map(function (a) { return a.lot.nome + ' (' + curto(a.estimativa) + ')'; }).join(' e ') +
          ': os maiores prêmios em jogo, pesados pelo que cada aposta custa. ' +
          (multiplas ? 'Apostas com mais dezenas concentram as chances em poucos jogos.' : ''),
        itens: consolidar(itens)
      });
    })();

    /* 4. Ganhar alguma coisa ----------------------------------------------- */
    (function () {
      var ord = noPrazo.slice().sort(function (x, y) {
        return (y.simples.chanceAlgum / y.simples.custo) - (x.simples.chanceAlgum / x.simples.custo);
      });
      var n = Math.max(1, Math.min(3, ord.length, Math.floor(B / Math.max(ord[0].simples.custo, 1))));
      var escolhidas = ord.slice(0, n);
      var itens = [], resta = B;
      escolhidas.forEach(function (a, i) {
        var verba = i === escolhidas.length - 1 ? resta : B / escolhidas.length;
        var comp = comprar(a, verba, 'simples', false);
        comp.forEach(function (c) { resta -= c.custo; });
        itens = itens.concat(comp);
      });
      cestas.push({
        id: 'frequente',
        titulo: 'Ganhar alguma coisa',
        tag: 'Prêmio frequente',
        afinidade: 0,
        porque: 'Muitas apostas simples onde as faixas de baixo saem com mais frequência: ' +
          escolhidas.map(function (a) {
            return a.lot.nome + ' (1 em ' + Math.round(1 / a.simples.chanceAlgum).toLocaleString('pt-BR') + ' por jogo)';
          }).join(', ') + '.',
        itens: consolidar(itens)
      });
    })();

    /* 5. Uma múltipla turbinada -------------------------------------------- */
    if (multiplas) (function () {
      var ord = noPrazo.slice().sort(function (x, y) { return y.retornoTopo - x.retornoTopo; });
      for (var i = 0; i < ord.length; i++) {
        var a = ord[i];
        var multi = a.formatos.filter(function (f) { return !f.ehSimples && f.custo <= B + 1e-9; });
        if (!multi.length) continue;
        var f = multi[multi.length - 1];
        var itens = [item(a, f, 1)];
        var sobra = B - f.custo;
        if (sobra >= a.simples.custo) itens.push(item(a, a.simples, Math.floor(sobra / a.simples.custo + 1e-9)));
        cestas.push({
          id: 'turbinada',
          titulo: 'Uma aposta turbinada',
          tag: 'Múltipla',
          afinidade: 0.85,
          porque: 'Um jogo de ' + (a.lot.tipo === 'colunas' ? 'várias colunas' : f.k + ' dezenas' + (f.kt ? ' + ' + f.kt + ' trevos' : '')) +
            ' na ' + a.lot.nome + ' vale ' + Math.round(f.simples).toLocaleString('pt-BR') + ' apostas simples: a chance do prêmio máximo sobe de 1 em ' +
            Math.round(1 / a.simples.chanceTopo).toLocaleString('pt-BR') + ' para 1 em ' + Math.round(1 / f.chanceTopo).toLocaleString('pt-BR') + '.',
          itens: consolidar(itens)
        });
        return;
      }
    })();

    /* 6. Fechamento com garantia ------------------------------------------- */
    if (estilos.fechamentos !== false) (function () {
      // por modalidade, o maior pool que cabe no orçamento
      var porLot = {};
      FECHAMENTOS.forEach(function (fe) {
        var a = noPrazo.filter(function (x) { return x.lot.id === fe.lotId; })[0];
        if (!a) return;
        var f = a.formatos.filter(function (x) { return x.k === fe.k && !x.kt; })[0];
        if (!f) return;
        var n = jogosDoFechamento(fe);
        if (!n || n * f.custo > B + 1e-9) return;
        var atual = porLot[fe.lotId];
        if (!atual || fe.pool > atual.fe.pool) porLot[fe.lotId] = { a: a, fe: fe, f: f, n: n, copias: 0 };
      });
      var opcoes = Object.keys(porLot).map(function (k) { return porLot[k]; })
        .sort(function (x, y) { return y.a.retorno - x.a.retorno; });
      if (!opcoes.length) return;

      // cópias com pools diferentes, alternando entre modalidades
      var resta = B, comprou = true;
      while (comprou) {
        comprou = false;
        opcoes.forEach(function (o) {
          var custo = o.n * o.f.custo;
          if (o.copias < 3 && custo <= resta + 1e-9) { o.copias++; resta -= custo; comprou = true; }
        });
      }
      var usadas = opcoes.filter(function (o) { return o.copias; });
      var itens = usadas.map(function (o) {
        var it = item(o.a, o.f, o.n * o.copias, { estrategia: 'fechamento', fechamento: o.fe, copias: o.copias, jogosPorFechamento: o.n });
        // jogos distintos do mesmo pool: as chances do principal se somam
        it.chanceTopo = Math.min(1, o.n * o.copias * o.f.chanceTopo);
        it.rotulo = (o.copias > 1 ? o.copias + ' fechamentos de ' : '') + o.n + ' jogos com ' + o.fe.pool + ' dezenas' +
          (o.copias > 1 ? ' (' + o.n * o.copias + ' jogos)' : '');
        return it;
      });
      var melhor = noPrazo.slice().sort(porRetorno)[0];
      if (resta >= melhor.simples.custo) itens.push(item(melhor, melhor.simples, Math.floor(resta / melhor.simples.custo + 1e-9)));
      var o = usadas[0];
      cestas.push({
        id: 'fechamento',
        titulo: 'Fechamento com garantia',
        tag: 'Fechamento',
        afinidade: 0.3,
        porque: 'Escolhe ' + o.fe.pool + ' dezenas na ' + o.a.lot.nome + ' e fecha em ' + o.n + ' jogos: se as ' + o.fe.se +
          ' sorteadas estiverem entre elas, pelo menos um jogo faz ' + o.fe.acertos + ' acertos.' +
          (usadas.length > 1 ? ' O mesmo raciocínio vale para ' + nomes(usadas.slice(1).map(function (u) { return u.a; })) + '.' : ''),
        itens: itens
      });
    })();

    /* 7. Uma em cada sorteio ----------------------------------------------- */
    if (estilos.simples !== false && noPrazo.length > 1) (function () {
      var ord = noPrazo.slice().sort(function (x, y) { return x.dias - y.dias || porRetorno(x, y); });
      var itens = [], resta = B, rodadas = 0, comprou = true;
      while (comprou && rodadas < 50) {
        comprou = false;
        ord.forEach(function (a) {
          if (a.simples.custo <= resta + 1e-9) {
            itens.push(item(a, a.simples, 1));
            resta -= a.simples.custo;
            comprou = true;
          }
        });
        if (comprou) rodadas++;
      }
      itens = consolidar(itens);
      if (itens.length < 2) return;
      cestas.push({
        id: 'volta',
        titulo: 'Uma em cada sorteio',
        tag: 'Surpresinha',
        afinidade: 0.2,
        porque: 'Apostas simples em todos os ' + itens.length + ' sorteios ' + periodo +
          (rodadas > 1 ? ', repetindo a rodada enquanto o orçamento deixa' : '') +
          ' — ninguém fica de fora quando o prêmio sai.',
        itens: itens
      });
    })();

    // totais, assinatura e ordem pelo perfil
    var vistas = {};
    cestas = cestas.filter(function (c) {
      c.itens = c.itens.filter(function (i) { return i.qtd > 0; });
      if (!c.itens.length) return false;
      var ass = c.itens.map(function (i) { return i.lotId + i.qtd + JSON.stringify([i.formato.k, i.formato.kt]); }).sort().join('|');
      if (vistas[ass]) return false;
      vistas[ass] = 1;
      c.totais = totais(c.itens, B);
      return true;
    });
    var mix = cestas.filter(function (c) { return c.id === 'mix'; });
    var resto = cestas.filter(function (c) { return c.id !== 'mix'; })
      .sort(function (x, y) { return Math.abs(x.afinidade - perfil) - Math.abs(y.afinidade - perfil); });
    cestas = mix.concat(resto);
    if (cestas[0]) cestas[0].recomendada = true;

    return { cestas: cestas, aviso: aviso, noPrazo: noPrazo };
  }

  LC.assistente = {
    avaliar: avaliar,
    montarCestas: montarCestas,
    formatos: formatos,
    chanceTopo: chanceTopo,
    lerData: lerData,
    quando: quando,
    jogosDoFechamento: jogosDoFechamento,
    rotuloFormato: rotuloFormato
  };

})(this);
