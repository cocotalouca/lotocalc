/* ============================================================================
 * LOTOCALC — Motor de geração de jogos
 * ----------------------------------------------------------------------------
 * Estratégias para modalidades de dezenas:
 *   aleatorio    sorteio uniforme
 *   equilibrado  aplica as faixas estatísticas sugeridas por cima dos filtros
 *   ponderado    peso por frequência do histórico (quentes ↔ frios / atrasadas)
 *   cobertura    distribui o uso das dezenas por igual entre todos os jogos
 *   fechamento   combinações de um pool — completo ou reduzido com garantia
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});

  /* ---- utilidades de bitmask -------------------------------------------- */

  function popcount(x) {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    x = (x + (x >> 4)) & 0x0f0f0f0f;
    return (x * 0x01010101) >> 24;
  }

  /**
   * Máscaras de todos os k-subconjuntos de p elementos.
   * Acima do limite, devolve uma amostra aleatória distinta desse tamanho.
   */
  function masks(p, k, limite, rng) {
    var total = LC.comb(p, k);
    if (total <= limite) {
      var out = [], idx = [], i, j, q;
      for (i = 0; i < k; i++) idx.push(i);
      while (true) {
        var m = 0;
        for (j = 0; j < k; j++) m |= (1 << idx[j]);
        out.push(m >>> 0);
        var pos = k - 1;
        while (pos >= 0 && idx[pos] === p - k + pos) pos--;
        if (pos < 0) break;
        idx[pos]++;
        for (q = pos + 1; q < k; q++) idx[q] = idx[q - 1] + 1;
      }
      return { lista: out, completo: true, total: total };
    }
    var vistos = {}, amostra = [], base = [];
    for (var b = 0; b < p; b++) base.push(b);
    var tentativas = 0;
    while (amostra.length < limite && tentativas < limite * 12) {
      tentativas++;
      var sel = rng.amostra(base, k), mm = 0;
      for (var s = 0; s < sel.length; s++) mm |= (1 << sel[s]);
      mm = mm >>> 0;
      if (!vistos[mm]) { vistos[mm] = 1; amostra.push(mm); }
    }
    return { lista: amostra, completo: false, total: total };
  }

  /* ---- pesos por histórico ---------------------------------------------- */

  /**
   * Converte o histórico em pesos por dezena.
   * vies  >0 favorece as mais sorteadas, <0 as menos sorteadas.
   * atraso=true usa o tempo desde a última aparição no lugar da frequência.
   */
  function pesos(lot, historico, vies, atraso) {
    var uni = LC.universo(lot), freq = {}, ultima = {}, i, j;
    uni.forEach(function (n) { freq[n] = 0; ultima[n] = historico.length; });
    for (i = 0; i < historico.length; i++) {
      var sorteio = historico[i];
      for (j = 0; j < sorteio.length; j++) {
        var n = sorteio[j];
        if (freq[n] === undefined) continue;
        freq[n]++;
        if (ultima[n] === historico.length) ultima[n] = i; // histórico do mais recente ao mais antigo
      }
    }
    var bruto = uni.map(function (n) { return atraso ? ultima[n] : freq[n]; });
    var min = Math.min.apply(null, bruto), max = Math.max.apply(null, bruto);
    var span = (max - min) || 1;
    var forca = Math.abs(vies);
    return bruto.map(function (v) {
      var norm = (v - min) / span;              // 0..1
      var alvo = vies >= 0 ? norm : 1 - norm;   // inverte quando o viés é negativo
      return 1 + alvo * forca * 4;              // peso entre 1 e 5
    });
  }

  /* ---- geração das dezenas ---------------------------------------------- */

  function ordenar(a) { return a.slice().sort(function (x, y) { return x - y; }); }

  function excedeDiversidade(dezenas, anteriores, maxComum) {
    var set = {};
    dezenas.forEach(function (n) { set[n] = 1; });
    for (var i = 0; i < anteriores.length; i++) {
      var c = 0, arr = anteriores[i];
      for (var j = 0; j < arr.length; j++) if (set[arr[j]]) c++;
      if (c > maxComum) return true;
    }
    return false;
  }

  function gerarDezenas(cfg, lot, rng, aviso) {
    var k = cfg.dezenas;
    var excl = {};
    (cfg.excluidas || []).forEach(function (n) { excl[n] = 1; });
    var fixas = ordenar((cfg.fixas || []).filter(function (n) { return !excl[n]; }));
    var disponiveis = LC.universo(lot).filter(function (n) {
      return !excl[n] && fixas.indexOf(n) === -1;
    });

    var ctx = { anterior: cfg.anterior || [] };

    /* ---- fechamento: combinações de um pool ---- */
    if (cfg.estrategia === 'fechamento') {
      return fechamento(cfg, lot, rng, aviso, fixas, ctx);
    }

    /* ---- cadeia: hash encadeado projetado em parâmetros ---- */
    if (cfg.estrategia === 'cadeia') {
      if (fixas.length > k) {
        throw new Error('Você fixou ' + fixas.length + ' dezenas, mas o jogo tem só ' + k + '.');
      }
      return viaCadeia(cfg, lot, rng, aviso, fixas, disponiveis, ctx);
    }

    if (fixas.length > k) {
      throw new Error('Você fixou ' + fixas.length + ' dezenas, mas o jogo tem só ' + k + '. Reduza as fixas ou aumente o tamanho do jogo.');
    }
    if (fixas.length + disponiveis.length < k) {
      throw new Error('Sobram dezenas de menos para um jogo de ' + k + '. Exclua menos números no volante.');
    }

    var filtros = cfg.filtros || {};
    var restam = k - fixas.length;
    var jogos = [], vistos = {}, tentativas = 0;
    var limite = Math.max(20000, cfg.qtd * 400);
    var relaxado = false;

    /* cobertura: sacola que reabastece — uso uniforme das dezenas */
    var sacola = [];
    function puxarSacola(n) {
      var out = [];
      var guarda = 0;
      while (out.length < n && guarda++ < 1000) {
        if (!sacola.length) sacola = rng.embaralhar(disponiveis);
        var c = sacola.pop();
        if (out.indexOf(c) === -1) out.push(c);
      }
      if (out.length < n) {
        var falta = disponiveis.filter(function (x) { return out.indexOf(x) === -1; });
        out = out.concat(rng.amostra(falta, n - out.length));
      }
      return out;
    }

    var w = null;
    if (cfg.estrategia === 'ponderado') {
      var hist = cfg.historico || [];
      if (!hist.length) {
        aviso('Sem histórico importado — a geração ponderada caiu para sorteio uniforme.');
      } else {
        var todos = pesos(lot, hist, cfg.vies || 0, !!cfg.usarAtraso);
        var uni = LC.universo(lot);
        w = disponiveis.map(function (n) { return todos[uni.indexOf(n)]; });
      }
    }

    while (jogos.length < cfg.qtd && tentativas < limite) {
      tentativas++;
      var sorteadas;
      if (cfg.estrategia === 'cobertura') sorteadas = puxarSacola(restam);
      else if (w) sorteadas = rng.amostraPonderada(disponiveis, w, restam);
      else sorteadas = rng.amostra(disponiveis, restam);

      var jogo = ordenar(fixas.concat(sorteadas));
      var chave = jogo.join('-');
      if (cfg.evitarRepetidos !== false && vistos[chave]) continue;

      if (!relaxado) {
        var m = LC.metricas(lot, jogo, ctx);
        if (LC.reprovaEm(m, filtros)) continue;
        if (cfg.diversidadeMax != null && excedeDiversidade(jogo, jogos, cfg.diversidadeMax)) continue;
      }

      vistos[chave] = 1;
      jogos.push(jogo);
    }

    // Não deu para fechar a quantidade dentro do orçamento? Completa sem filtros.
    if (jogos.length < cfg.qtd) {
      var faltam = cfg.qtd - jogos.length;
      var extra = 0;
      while (jogos.length < cfg.qtd && extra < faltam * 500 + 2000) {
        extra++;
        var j2 = ordenar(fixas.concat(rng.amostra(disponiveis, restam)));
        var c2 = j2.join('-');
        if (cfg.evitarRepetidos !== false && vistos[c2]) continue;
        vistos[c2] = 1;
        j2.relaxado = true;
        jogos.push(j2);
        relaxado = true;
      }
      if (relaxado) {
        aviso('Os filtros ficaram apertados demais: ' + faltam + ' ' + (faltam === 1 ? 'jogo foi gerado' : 'jogos foram gerados') + ' sem eles. Alargue as faixas para todos passarem no crivo.');
      } else {
        aviso('Só foi possível montar ' + jogos.length + ' de ' + cfg.qtd + ' jogos distintos com essas restrições.');
      }
    }
    return jogos;
  }

  /* ---- cadeia ------------------------------------------------------------ */

  /**
   * Cada jogo nasce dos parâmetros extraídos do estado da cadeia, e é depois
   * reabsorvido por ela — o jogo N é o elo que gera o jogo N+1.
   */
  function viaCadeia(cfg, lot, rng, aviso, fixas, disponiveis, ctx) {
    var conf = cfg.cadeia || {};
    var rodadas = Math.max(1, conf.rodadas == null ? 12 : conf.rodadas);
    var deriva = Math.max(0, conf.deriva == null ? 3 : conf.deriva);
    var temp = conf.temperatura == null ? 0.6 : conf.temperatura;
    var restam = cfg.dezenas - fixas.length;

    var cadeia = cfg._cadeia || new LC.Cadeia(rng.semente);
    cadeia.reiniciar(rng.semente);
    cadeia.rodar(rodadas);

    var jogos = [], vistos = {}, tentativas = 0, relaxados = 0;
    var limite = Math.max(6000, cfg.qtd * 150);

    while (jogos.length < cfg.qtd && tentativas < limite) {
      tentativas++;
      var p = cadeia.parametros();
      var jogo = ordenar(fixas.concat(cadeia.sortear(disponiveis, restam, lot, temp, p)));
      var chave = jogo.join('-');

      if (cfg.evitarRepetidos !== false && vistos[chave]) { cadeia.volta(); continue; }

      var forcar = tentativas > limite * 0.75;
      if (!forcar) {
        if (LC.reprovaEm(LC.metricas(lot, jogo, ctx), cfg.filtros || {})) { cadeia.volta(); continue; }
        if (cfg.diversidadeMax != null && excedeDiversidade(jogo, jogos, cfg.diversidadeMax)) { cadeia.volta(); continue; }
      } else {
        jogo.relaxado = true;
        relaxados++;
      }

      jogo.elo = cadeia.fecharElo(jogo, deriva);
      vistos[chave] = 1;
      jogos.push(jogo);
    }

    if (relaxados) {
      aviso(relaxados + ' ' + (relaxados === 1 ? 'jogo saiu' : 'jogos saíram') + ' da cadeia sem passar pelos filtros — as faixas estão apertadas para a temperatura escolhida.');
    }
    if (jogos.length < cfg.qtd) {
      aviso('A cadeia entregou ' + jogos.length + ' de ' + cfg.qtd + ' jogos distintos. Reduza a temperatura ou alargue os filtros.');
    }
    aviso('Cadeia: ' + cadeia.voltas.toLocaleString('pt-BR') + ' voltas, avalanche média de ' +
      cadeia.avalanche().toFixed(1) + ' bits por volta (ideal 64,0).');

    return jogos;
  }

  /* ---- fechamentos ------------------------------------------------------- */

  function fechamento(cfg, lot, rng, aviso, pool, ctx) {
    var k = cfg.dezenas;
    var fe = cfg.fechamento || {};
    pool = ordenar(pool);

    if (pool.length < k + 1) {
      throw new Error('Marque no volante pelo menos ' + (k + 1) + ' dezenas para fechar jogos de ' + k + '. Você marcou ' + pool.length + '.');
    }
    if (pool.length > 30) {
      throw new Error('O fechamento aceita no máximo 30 dezenas no pool. Você marcou ' + pool.length + '.');
    }

    var p = pool.length;
    var TETO = 60000;
    var cand = masks(p, k, TETO, rng);
    if (!cand.completo) {
      aviso('O pool gera ' + cand.total.toLocaleString('pt-BR') + ' combinações. Foi usada uma amostra de ' + cand.lista.length.toLocaleString('pt-BR') + '.');
    }

    function paraJogo(mask) {
      var out = [];
      for (var i = 0; i < p; i++) if (mask & (1 << i)) out.push(pool[i]);
      return out;
    }

    /* Fechamento completo: todas as combinações, respeitando os filtros. */
    if (fe.modo !== 'reduzido') {
      var lista = fe.embaralhar ? rng.embaralhar(cand.lista) : cand.lista.slice();
      var out = [], i;
      for (i = 0; i < lista.length && out.length < cfg.qtd; i++) {
        var jogo = paraJogo(lista[i]);
        if (LC.reprovaEm(LC.metricas(lot, jogo, ctx), cfg.filtros || {})) continue;
        out.push(jogo);
      }
      if (!out.length) throw new Error('Nenhuma combinação do pool passou pelos filtros. Desative alguns e tente de novo.');
      if (out.length < cfg.qtd && cand.completo) {
        aviso('O pool de ' + p + ' dezenas produz ' + out.length + ' ' + (out.length === 1 ? 'combinação' : 'combinações') + ' — menos que os ' + cfg.qtd + ' jogos pedidos.');
      }
      return out;
    }

    /* Fechamento reduzido: cobertura gulosa com garantia. */
    var se = Math.min(fe.garantirSe || Math.min(lot.sorteadas, p), p);
    var acertos = Math.min(fe.garantirAcertos || Math.max(3, lot.sorteadas - 2), Math.min(se, k));

    var alvos = masks(p, se, TETO, rng);
    if (!alvos.completo) {
      aviso('A garantia foi conferida por amostragem (' + alvos.lista.length.toLocaleString('pt-BR') + ' de ' + alvos.total.toLocaleString('pt-BR') + ' cenários).');
    }

    var restantes = alvos.lista.slice();
    var candidatos = cand.lista;
    var escolhidos = [];
    var orcamento = 40e6, gasto = 0, estourou = false;

    while (restantes.length && escolhidos.length < cfg.qtd) {
      var melhor = -1, melhorCobre = -1;
      for (var c = 0; c < candidatos.length; c++) {
        var cm = candidatos[c], cobre = 0;
        for (var t = 0; t < restantes.length; t++) {
          if (popcount(cm & restantes[t]) >= acertos) cobre++;
        }
        gasto += restantes.length;
        if (cobre > melhorCobre) { melhorCobre = cobre; melhor = cm; }
        if (melhorCobre === restantes.length) break;
      }
      if (melhorCobre <= 0) break;
      escolhidos.push(melhor);
      var sobra = [];
      for (var r = 0; r < restantes.length; r++) {
        if (popcount(melhor & restantes[r]) < acertos) sobra.push(restantes[r]);
      }
      restantes = sobra;
      if (gasto > orcamento) { estourou = true; break; }
    }

    if (!escolhidos.length) {
      throw new Error('Não foi possível montar o fechamento com essa garantia. Reduza os acertos garantidos ou aumente o pool.');
    }
    if (estourou) {
      aviso('O cálculo parou no limite de processamento — a cobertura pode estar incompleta.');
    }
    if (restantes.length) {
      aviso('Cobertura parcial: ' + restantes.length.toLocaleString('pt-BR') + ' cenários ficaram sem garantia com ' + escolhidos.length + ' jogos. Aumente a quantidade de jogos.');
    } else {
      aviso('Garantia fechada: ' + escolhidos.length + ' ' + (escolhidos.length === 1 ? 'jogo cobre' : 'jogos cobrem') + ' 100% dos cenários de ' + se + ' dezenas certas dentro do pool, com pelo menos ' + acertos + ' acertos.');
    }
    return escolhidos.map(paraJogo);
  }

  /* ---- extras (trevos, time, mês) --------------------------------------- */

  function gerarTrevos(cfg, extra, rng) {
    var ex = cfg.extras || {};
    var qtd = ex.trevosQtd || extra.padrao;
    var fixas = ordenar(ex.trevosFixas || []);
    var disp = [];
    for (var i = extra.min; i <= extra.max; i++) if (fixas.indexOf(i) === -1) disp.push(i);
    if (fixas.length >= qtd) return fixas.slice(0, qtd);
    return ordenar(fixas.concat(rng.amostra(disp, qtd - fixas.length)));
  }

  /* ---- Super Sete -------------------------------------------------------- */

  function gerarColunas(cfg, lot, rng) {
    var conf = cfg.supersete || {};
    var porColuna = conf.porColuna || [];
    var fixas = conf.fixas || [];
    var jogos = [], vistos = {}, tentativas = 0;
    var limite = cfg.qtd * 200 + 2000;

    while (jogos.length < cfg.qtd && tentativas < limite) {
      tentativas++;
      var jogo = [];
      for (var c = 0; c < lot.colunas; c++) {
        var alvo = Math.max(1, Math.min(lot.escolhaMax, porColuna[c] || 1));
        var fix = (fixas[c] || []).slice(0, alvo);
        var disp = [];
        for (var d = lot.digMin; d <= lot.digMax; d++) if (fix.indexOf(d) === -1) disp.push(d);
        var col = fix.concat(rng.amostra(disp, Math.max(0, alvo - fix.length)));
        jogo.push(col.sort(function (a, b) { return a - b; }));
      }
      var chave = jogo.map(function (x) { return x.join(''); }).join('|');
      if (cfg.evitarRepetidos !== false && vistos[chave]) continue;
      vistos[chave] = 1;
      jogos.push(jogo);
    }
    return jogos;
  }

  /* ---- Loteca ------------------------------------------------------------ */

  function gerarPlacares(cfg, lot, rng) {
    var conf = cfg.loteca || {};
    var duplos = Math.max(0, Math.min(lot.jogos, conf.duplos || 0));
    var triplos = Math.max(0, Math.min(lot.jogos - duplos, conf.triplos || 0));
    var fixos = conf.fixos || [];
    var jogos = [], vistos = {}, tentativas = 0;
    var limite = cfg.qtd * 200 + 2000;
    var indices = [];
    for (var i = 0; i < lot.jogos; i++) indices.push(i);

    while (jogos.length < cfg.qtd && tentativas < limite) {
      tentativas++;
      var ordem = rng.embaralhar(indices);
      var tamanho = {};
      ordem.forEach(function (idx, pos) {
        tamanho[idx] = pos < triplos ? 3 : (pos < triplos + duplos ? 2 : 1);
      });
      var jogo = [];
      for (var p = 0; p < lot.jogos; p++) {
        var travado = (fixos[p] && fixos[p].length) ? fixos[p].slice() : [];
        var alvo = Math.max(travado.length, tamanho[p]);
        var disp = lot.simbolos.filter(function (s) { return travado.indexOf(s) === -1; });
        var marcas = travado.concat(rng.amostra(disp, Math.max(0, Math.min(alvo - travado.length, disp.length))));
        marcas.sort(function (a, b) { return lot.simbolos.indexOf(a) - lot.simbolos.indexOf(b); });
        jogo.push(marcas);
      }
      var chave = jogo.map(function (m) { return m.join(''); }).join('|');
      if (cfg.evitarRepetidos !== false && vistos[chave]) continue;
      vistos[chave] = 1;
      jogos.push(jogo);
    }
    return jogos;
  }

  /* ---- Federal ----------------------------------------------------------- */

  function gerarBilhetes(cfg, lot, rng) {
    var jogos = [], vistos = {}, tentativas = 0;
    var teto = Math.pow(10, lot.digitos);
    while (jogos.length < cfg.qtd && tentativas < cfg.qtd * 100 + 500) {
      tentativas++;
      var s = String(rng.int(0, teto - 1));
      while (s.length < lot.digitos) s = '0' + s;
      if (vistos[s]) continue;
      vistos[s] = 1;
      jogos.push(s);
    }
    return jogos;
  }

  /* ---- fachada ----------------------------------------------------------- */

  /**
   * Gera o conjunto de jogos.
   * @returns {{lotId:string, jogos:Array, semente:string, avisos:string[], custo:number, ms:number}}
   */
  function gerar(cfg) {
    var lot = LC.lot(cfg.lotId);
    if (!lot) throw new Error('Modalidade desconhecida: ' + cfg.lotId);

    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    var rng = new LC.Rng(cfg.seed);
    var avisos = [];
    function aviso(msg) { if (avisos.indexOf(msg) === -1) avisos.push(msg); }

    var brutos, jogos;

    if (lot.tipo === 'colunas') {
      brutos = gerarColunas(cfg, lot, rng);
      jogos = brutos.map(function (colunas, i) {
        return { n: i + 1, colunas: colunas, custo: LC.custoJogo(lot, { colunas: colunas }) };
      });
    } else if (lot.tipo === 'placares') {
      brutos = gerarPlacares(cfg, lot, rng);
      jogos = brutos.map(function (placares, i) {
        return { n: i + 1, placares: placares, custo: LC.custoJogo(lot, { placares: placares }) };
      });
    } else if (lot.tipo === 'bilhete') {
      brutos = gerarBilhetes(cfg, lot, rng);
      jogos = brutos.map(function (bilhete, i) {
        return { n: i + 1, bilhete: bilhete, custo: lot.preco };
      });
    } else {
      if (cfg.estrategia === 'cadeia' && LC.Cadeia) cfg._cadeia = new LC.Cadeia(rng.semente);
      brutos = gerarDezenas(cfg, lot, rng, aviso);
      var ctx = { anterior: cfg.anterior || [] };
      jogos = brutos.map(function (dezenas, i) {
        var jogo = {
          n: i + 1,
          dezenas: dezenas,
          relaxado: !!dezenas.relaxado,
          elo: dezenas.elo || null,
          metricas: LC.metricas(lot, dezenas, ctx)
        };
        if (lot.extra && lot.extra.tipo === 'dezenas') jogo.trevos = gerarTrevos(cfg, lot.extra, rng);
        if (lot.extra && lot.extra.tipo === 'lista') {
          var escolha = (cfg.extras || {})[lot.extra.id];
          jogo.extra = (escolha && escolha !== '__aleatorio__') ? escolha : rng.escolher(lot.extra.opcoes);
        }
        jogo.custo = LC.custoJogo(lot, jogo);
        return jogo;
      });
    }

    var custo = jogos.reduce(function (a, j) { return a + j.custo; }, 0);
    var t1 = (global.performance && performance.now) ? performance.now() : Date.now();

    return {
      lotId: lot.id,
      jogos: jogos,
      semente: rng.semente,
      avisos: avisos,
      custo: custo,
      cadeia: cfg._cadeia || null,
      ms: Math.max(1, Math.round(t1 - t0))
    };
  }

  LC.gerar = gerar;
  LC.popcount = popcount;
  LC.pesosHistorico = pesos;

})(this);
