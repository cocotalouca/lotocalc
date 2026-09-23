/* ============================================================================
 * LOTOCALC — Resultados oficiais
 * ----------------------------------------------------------------------------
 * Busca concursos direto do navegador, sem servidor e sem chave:
 *
 *   1. API pública do Portal de Loterias da CAIXA (fonte oficial);
 *   2. loteriascaixa-api (espelho comunitário gratuito), se a primeira falhar.
 *
 * As duas respondem com Access-Control-Allow-Origin: *, então funcionam até
 * com o index.html aberto direto do disco. Tudo é normalizado para um formato
 * único e guardado no localStorage: concurso já apurado não muda, então só o
 * "último" é buscado de novo, e mesmo assim no máximo a cada poucos minutos.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});

  var FONTES = {
    caixa: 'https://servicebus2.caixa.gov.br/portaldeloterias/api/',
    comunidade: 'https://loteriascaixa-api.herokuapp.com/api/'
  };
  var NOME_FONTE = { caixa: 'CAIXA', comunidade: 'loteriascaixa-api', cache: 'cache local' };

  var PREFIXO_CACHE = 'lotocalc:res:v1:';
  var VALIDADE_ULTIMO = 10 * 60 * 1000;   // 10 min
  var LIMITE_CACHE = 250;                 // concursos guardados por modalidade
  var TEMPO_LIMITE = 12000;

  /* ---- rede -------------------------------------------------------------- */

  function buscarJson(url) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TEMPO_LIMITE);
    return fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }, function (e) {
        clearTimeout(timer);
        throw e;
      });
  }

  /* ---- normalização ------------------------------------------------------ */

  function inteiros(lista) {
    return (lista || []).map(function (x) { return parseInt(x, 10); })
      .filter(function (n) { return !isNaN(n); });
  }

  function limparTexto(s) {
    if (!s) return null;
    s = String(s).replace(/\u0000/g, '').replace(/\s+\//g, '/').replace(/\s+/g, ' ').trim();
    return s || null;
  }

  /** Casa o texto da API com a opção do catálogo (ex.: "VOLTA REDONDA    /RJ"). */
  function casarOpcao(lot, texto) {
    if (!texto || !lot.extra || lot.extra.tipo !== 'lista') return texto;
    var chave = function (s) {
      // NFD separa os acentos, que a limpeza seguinte descarta junto com espaços e barras
      return String(s).normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    };
    var alvo = chave(texto);
    for (var i = 0; i < lot.extra.opcoes.length; i++) {
      if (chave(lot.extra.opcoes[i]) === alvo) return lot.extra.opcoes[i];
    }
    return texto;
  }

  function placarDe(e) {
    var a = e.nuGolEquipeUm, b = e.nuGolEquipeDois;
    if (a == null || b == null) return null;
    return a > b ? '1' : a < b ? '2' : 'X';
  }

  function daCaixa(lot, j) {
    var r = {
      lotId: lot.id,
      concurso: j.numero,
      data: j.dataApuracao || '',
      acumulou: !!j.acumulado,
      arrecadado: j.valorArrecadado || 0,
      rateio: (j.listaRateioPremio || []).map(function (f) {
        return { faixa: f.faixa, descricao: f.descricaoFaixa, ganhadores: f.numeroDeGanhadores || 0, valor: f.valorPremio || 0 };
      }),
      proximo: {
        concurso: j.numeroConcursoProximo || (j.numero + 1),
        data: j.dataProximoConcurso || '',
        estimativa: j.valorEstimadoProximoConcurso || 0,
        acumulado: j.valorAcumuladoProximoConcurso || 0
      },
      especial: j.valorAcumuladoConcursoEspecial || 0,
      local: limparTexto([j.localSorteio, j.nomeMunicipioUFSorteio].filter(Boolean).join(' · '))
    };

    if (lot.tipo === 'colunas') {
      r.colunas = inteiros(j.dezenasSorteadasOrdemSorteio || j.listaDezenas);
    } else if (lot.tipo === 'placares') {
      r.placares = (j.listaResultadoEquipeEsportiva || [])
        .slice().sort(function (a, b) { return a.nuSequencial - b.nuSequencial; })
        .map(placarDe);
      r.partidas = (j.listaResultadoEquipeEsportiva || [])
        .slice().sort(function (a, b) { return a.nuSequencial - b.nuSequencial; })
        .map(function (e) {
          return limparTexto(e.nomeEquipeUm) + ' ' + e.nuGolEquipeUm + '×' + e.nuGolEquipeDois + ' ' + limparTexto(e.nomeEquipeDois);
        });
    } else if (lot.tipo === 'bilhete') {
      r.bilhetes = (j.listaDezenas || []).map(function (b) { return String(b).slice(-lot.digitos); });
    } else {
      r.dezenas = inteiros(j.listaDezenas).sort(function (a, b) { return a - b; });
      if (j.listaDezenasSegundoSorteio) {
        r.dezenas2 = inteiros(j.listaDezenasSegundoSorteio).sort(function (a, b) { return a - b; });
      }
      if (j.trevosSorteados) r.trevos = inteiros(j.trevosSorteados);
      if (lot.extra && lot.extra.tipo === 'lista') {
        r.extra = casarOpcao(lot, limparTexto(j.nomeTimeCoracaoMesSorte));
      }
    }
    return r;
  }

  function daComunidade(lot, j) {
    var r = {
      lotId: lot.id,
      concurso: j.concurso,
      data: j.data || '',
      acumulou: !!j.acumulou,
      arrecadado: j.valorArrecadado || 0,
      rateio: (j.premiacoes || []).map(function (f) {
        return { faixa: f.faixa, descricao: f.descricao, ganhadores: f.ganhadores || 0, valor: f.valorPremio || 0 };
      }),
      proximo: {
        concurso: j.proximoConcurso || (j.concurso + 1),
        data: j.dataProximoConcurso || '',
        estimativa: j.valorEstimadoProximoConcurso || 0,
        acumulado: j.valorAcumuladoProximoConcurso || 0
      },
      especial: j.valorAcumuladoConcursoEspecial || 0,
      local: limparTexto(j.local)
    };

    if (lot.tipo === 'colunas') {
      r.colunas = inteiros(j.dezenasOrdemSorteio || j.dezenas);
    } else if (lot.tipo === 'bilhete') {
      r.bilhetes = (j.dezenas || []).map(function (b) { return String(b).slice(-lot.digitos); });
    } else {
      var todas = inteiros(j.dezenas);
      if (lot.sorteios === 2 && todas.length >= lot.sorteadas * 2) {
        r.dezenas = todas.slice(0, lot.sorteadas).sort(function (a, b) { return a - b; });
        r.dezenas2 = todas.slice(lot.sorteadas, lot.sorteadas * 2).sort(function (a, b) { return a - b; });
      } else {
        r.dezenas = todas.sort(function (a, b) { return a - b; });
      }
      if (j.trevos && j.trevos.length) r.trevos = inteiros(j.trevos);
      if (lot.extra && lot.extra.tipo === 'lista') {
        r.extra = casarOpcao(lot, limparTexto(j.timeCoracao || j.mesSorte));
      }
    }
    return r;
  }

  /** Ajustes comuns às duas fontes. */
  function finalizar(lot, r) {
    if (lot.tipo === 'bilhete') {
      r.rateio.forEach(function (f) { f.descricao = f.faixa + 'º prêmio'; });
    }
    return r;
  }

  /* ---- cache ------------------------------------------------------------- */

  function lerCache(lotId) {
    try {
      var c = JSON.parse(localStorage.getItem(PREFIXO_CACHE + lotId) || 'null');
      if (c && c.concursos) return c;
    } catch (e) { /* ignora */ }
    return { ultimo: null, t: 0, concursos: {} };
  }

  function gravarCache(lotId, c) {
    // guarda só o dado do concurso, sem as marcas de origem desta leitura
    Object.keys(c.concursos).forEach(function (k) {
      var r = c.concursos[k];
      if (r.fonte || r.cacheEm || r.offline) {
        r = c.concursos[k] = Object.assign({}, r);
        delete r.fonte; delete r.cacheEm; delete r.offline;
      }
    });
    var nums = Object.keys(c.concursos).map(Number).sort(function (a, b) { return b - a; });
    nums.slice(LIMITE_CACHE).forEach(function (n) { delete c.concursos[n]; });
    try {
      localStorage.setItem(PREFIXO_CACHE + lotId, JSON.stringify(c));
    } catch (e) { /* cota cheia — segue sem cache */ }
  }

  function guardar(lot, r, ehUltimo) {
    var c = lerCache(lot.id);
    c.concursos[r.concurso] = r;
    if (ehUltimo) { c.ultimo = r.concurso; c.t = Date.now(); }
    gravarCache(lot.id, c);
  }

  /* ---- API pública ------------------------------------------------------- */

  function caminho(lot, numero) {
    return lot.id + (numero ? '/' + numero : '');
  }

  function esperar(ms) {
    return new Promise(function (ok) { setTimeout(ok, ms); });
  }

  /** Tenta a CAIXA (duas vezes: ela recusa rajadas) e, se falhar, o espelho comunitário. */
  function buscarRemoto(lot, numero) {
    var url = FONTES.caixa + caminho(lot, numero);
    return buscarJson(url)
      .catch(function () { return esperar(700).then(function () { return buscarJson(url); }); })
      .then(function (j) {
        if (!j || !j.numero) throw new Error('resposta vazia');
        var r = finalizar(lot, daCaixa(lot, j));
        r.fonte = 'caixa';
        return r;
      })
      .catch(function (erroCaixa) {
        if (lot.tipo === 'placares') throw erroCaixa;   // o espelho não tem Loteca
        return buscarJson(FONTES.comunidade + lot.id + '/' + (numero || 'latest'))
          .then(function (j) {
            if (!j || !j.concurso) throw new Error('resposta vazia');
            var r = finalizar(lot, daComunidade(lot, j));
            r.fonte = 'comunidade';
            return r;
          });
      });
  }

  /**
   * Um concurso. Sem número, o último apurado.
   * opcoes.forcar ignora o cache do "último".
   */
  function buscarConcurso(lot, numero, opcoes) {
    opcoes = opcoes || {};
    var c = lerCache(lot.id);

    if (numero && c.concursos[numero]) {
      return Promise.resolve(Object.assign({}, c.concursos[numero], { fonte: 'cache' }));
    }
    if (!numero && !opcoes.forcar && c.ultimo && Date.now() - c.t < VALIDADE_ULTIMO && c.concursos[c.ultimo]) {
      return Promise.resolve(Object.assign({}, c.concursos[c.ultimo], { fonte: 'cache', cacheEm: c.t }));
    }

    return buscarRemoto(lot, numero).then(function (r) {
      guardar(lot, r, !numero);
      return r;
    }).catch(function (e) {
      // sem rede: devolve o que houver guardado, avisando
      var guardado = numero ? c.concursos[numero] : (c.ultimo && c.concursos[c.ultimo]);
      if (guardado) return Object.assign({}, guardado, { fonte: 'cache', cacheEm: c.t, offline: true });
      throw e;
    });
  }

  /**
   * Os N concursos mais recentes, do mais novo para o mais antigo.
   * aoProgredir(feitos, total) é chamado a cada concurso obtido.
   */
  function buscarRecentes(lot, n, aoProgredir, opcoes) {
    return buscarConcurso(lot, null, opcoes).then(function (ultimo) {
      var alvo = [];
      for (var k = ultimo.concurso; k > ultimo.concurso - n && k >= 1; k--) alvo.push(k);

      var c = lerCache(lot.id);
      var achados = {};
      achados[ultimo.concurso] = ultimo;
      var faltam = alvo.filter(function (k) {
        if (achados[k]) return false;
        if (c.concursos[k]) { achados[k] = c.concursos[k]; return false; }
        return true;
      });

      var feitos = alvo.length - faltam.length;
      if (aoProgredir) aoProgredir(feitos, alvo.length);

      var fila = faltam.slice();
      var falhas = 0;
      function trabalhador() {
        var k = fila.shift();
        if (k === undefined) return Promise.resolve();
        return buscarRemoto(lot, k).then(function (r) {
          achados[k] = r;
        }, function () { falhas++; }).then(function () {
          feitos++;
          if (aoProgredir) aoProgredir(feitos, alvo.length);
          return trabalhador();
        });
      }

      var paralelos = [];
      for (var i = 0; i < Math.min(3, fila.length); i++) paralelos.push(trabalhador());

      return Promise.all(paralelos).then(function () {
        var cache = lerCache(lot.id);
        alvo.forEach(function (k) { if (achados[k]) cache.concursos[k] = achados[k]; });
        gravarCache(lot.id, cache);
        var lista = alvo.map(function (k) { return achados[k]; }).filter(Boolean);
        lista.falhas = falhas;
        lista.ultimo = ultimo;
        return lista;
      });
    });
  }

  /** Concursos já guardados, sem rede (do mais novo para o mais antigo). */
  function guardados(lot) {
    var c = lerCache(lot.id);
    return Object.keys(c.concursos).map(Number).sort(function (a, b) { return b - a; })
      .map(function (k) { return c.concursos[k]; });
  }

  /** Linha de histórico no formato aceito pelo leitor ("3061 24 25 28 37 47 55"). */
  function linhaHistorico(lot, r) {
    if (!r.dezenas) return '';
    return r.concurso + ' ' + r.dezenas.map(function (n) { return LC.fmt(lot, n); }).join(' ');
  }

  LC.resultados = {
    buscarConcurso: buscarConcurso,
    buscarRecentes: buscarRecentes,
    guardados: guardados,
    linhaHistorico: linhaHistorico,
    nomeFonte: function (f) { return NOME_FONTE[f] || f; }
  };

})(this);
