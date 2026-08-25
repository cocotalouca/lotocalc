/* ============================================================================
 * LOTOCALC — Formatação e exportação dos jogos
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});

  function moeda(v) {
    return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Um jogo em texto, no formato próprio da modalidade. */
  function jogoTexto(lot, jogo, sep) {
    sep = sep || ' ';
    if (lot.tipo === 'colunas') {
      return jogo.colunas.map(function (c) { return c.join(''); }).join(sep);
    }
    if (lot.tipo === 'placares') {
      return jogo.placares.map(function (m) { return m.join(''); }).join(sep);
    }
    if (lot.tipo === 'bilhete') {
      return jogo.bilhete;
    }
    var txt = jogo.dezenas.map(function (n) { return LC.fmt(lot, n); }).join(sep);
    if (jogo.trevos && jogo.trevos.length) txt += '  |  trevos ' + jogo.trevos.join(sep);
    if (jogo.extra) txt += '  |  ' + jogo.extra;
    return txt;
  }

  function cabecalho(lot, res, cfg) {
    var linhas = [];
    linhas.push('LOTOCALC — ' + lot.nome);
    linhas.push('Jogos: ' + res.jogos.length + '   Custo total: ' + moeda(res.custo));
    linhas.push('Semente: ' + res.semente + (cfg && cfg.estrategiaNome ? '   Estratégia: ' + cfg.estrategiaNome : ''));
    linhas.push('Gerado em: ' + new Date().toLocaleString('pt-BR'));
    linhas.push('-'.repeat(56));
    return linhas.join('\n');
  }

  function comoTxt(lot, res, cfg) {
    var corpo = res.jogos.map(function (j) {
      var num = String(j.n).padStart(3, ' ');
      return num + '  ' + jogoTexto(lot, j, ' ');
    }).join('\n');
    return cabecalho(lot, res, cfg) + '\n' + corpo + '\n';
  }

  function comoCsv(lot, res) {
    var linhas = [];
    var maxD = 0;
    res.jogos.forEach(function (j) {
      if (j.dezenas) maxD = Math.max(maxD, j.dezenas.length);
      if (j.colunas) maxD = Math.max(maxD, j.colunas.length);
      if (j.placares) maxD = Math.max(maxD, j.placares.length);
    });

    var cab = ['jogo'];
    for (var i = 1; i <= maxD; i++) cab.push('d' + i);
    if (lot.tipo === 'bilhete') cab = ['jogo', 'bilhete'];
    if (lot.extra) cab.push(lot.extra.nome.toLowerCase().replace(/\s+/g, '_'));
    cab.push('soma', 'pares', 'custo');
    linhas.push(cab.join(';'));

    res.jogos.forEach(function (j) {
      var cel = [j.n];
      if (lot.tipo === 'bilhete') {
        cel.push(j.bilhete);
      } else if (lot.tipo === 'colunas') {
        j.colunas.forEach(function (c) { cel.push(c.join('')); });
      } else if (lot.tipo === 'placares') {
        j.placares.forEach(function (m) { cel.push(m.join('')); });
      } else {
        j.dezenas.forEach(function (n) { cel.push(LC.fmt(lot, n)); });
        for (var k = j.dezenas.length; k < maxD; k++) cel.push('');
      }
      if (lot.extra) cel.push(j.trevos ? j.trevos.join(' ') : (j.extra || ''));
      cel.push(j.metricas ? j.metricas.soma : '');
      cel.push(j.metricas ? j.metricas.pares : '');
      cel.push(String((j.custo || 0).toFixed(2)).replace('.', ','));
      linhas.push(cel.join(';'));
    });
    return linhas.join('\n');
  }

  function comoJson(lot, res, cfg) {
    return JSON.stringify({
      app: 'LOTOCALC',
      modalidade: { id: lot.id, nome: lot.nome },
      geradoEm: new Date().toISOString(),
      semente: res.semente,
      estrategia: cfg && cfg.estrategiaNome,
      custoTotal: Number(res.custo.toFixed(2)),
      jogos: res.jogos.map(function (j) {
        var o = { n: j.n, custo: Number((j.custo || 0).toFixed(2)) };
        if (j.dezenas) o.dezenas = j.dezenas;
        if (j.trevos) o.trevos = j.trevos;
        if (j.extra) o.extra = j.extra;
        if (j.colunas) o.colunas = j.colunas;
        if (j.placares) o.placares = j.placares;
        if (j.bilhete) o.bilhete = j.bilhete;
        if (j.metricas) o.metricas = j.metricas;
        return o;
      })
    }, null, 2);
  }

  /** Só as dezenas, uma linha por jogo — formato de colar em planilha/volante. */
  function comoSimples(lot, res) {
    return res.jogos.map(function (j) { return jogoTexto(lot, j, ' '); }).join('\n');
  }

  function conteudo(formato, lot, res, cfg) {
    switch (formato) {
      case 'csv': return { texto: comoCsv(lot, res), mime: 'text/csv;charset=utf-8', ext: 'csv' };
      case 'json': return { texto: comoJson(lot, res, cfg), mime: 'application/json', ext: 'json' };
      case 'simples': return { texto: comoSimples(lot, res), mime: 'text/plain;charset=utf-8', ext: 'txt' };
      default: return { texto: comoTxt(lot, res, cfg), mime: 'text/plain;charset=utf-8', ext: 'txt' };
    }
  }

  function nomeArquivo(lot, res, ext) {
    var d = new Date();
    var p = function (x) { return String(x).padStart(2, '0'); };
    return 'lotocalc-' + lot.id + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + '.' + ext;
  }

  function baixar(nome, texto, mime) {
    try {
      var blob = new Blob([texto], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 400);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Entrega o arquivo ao usuário pelo caminho que existir: a API de download
   * do visualizador hospedado, ou um blob local quando a página é a janela.
   * Resolve com 'salvo', 'salvo-txt', 'recusado' ou 'indisponivel'.
   */
  function salvarArquivo(nome, texto, mime) {
    function local() {
      if (global.self !== global.top) return 'indisponivel';
      return baixar(nome, texto, mime) ? 'salvo' : 'indisponivel';
    }

    var claude = global.claude;
    if (!claude || typeof claude.use !== 'function') {
      return Promise.resolve(local());
    }

    return claude.use('downloads').then(function (dl) {
      if (!dl) return local();
      return dl.save({ filename: nome, data: texto }).then(function () {
        return 'salvo';
      }, function (erro) {
        var codigo = erro && erro.code;
        if (codigo === 'declined') return 'recusado';
        // .csv depende de um conjunto estendido que nem toda visualização libera
        if (codigo === 'extension_not_enabled' || codigo === 'rejected_extension') {
          return dl.save({ filename: nome.replace(/\.[^.]+$/, '.txt'), data: texto })
            .then(function () { return 'salvo-txt'; }, function () { return 'indisponivel'; });
        }
        return local();
      });
    }, function () { return local(); });
  }

  function copiar(texto) {
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('cópia bloqueada'));
      } catch (e) { reject(e); }
    });
  }

  LC.moeda = moeda;
  LC.jogoTexto = jogoTexto;
  LC.exportConteudo = conteudo;
  LC.nomeArquivo = nomeArquivo;
  LC.baixar = baixar;
  LC.salvarArquivo = salvarArquivo;
  LC.copiar = copiar;

})(this);
