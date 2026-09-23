/* ============================================================================
 * LOTOCALC — interface
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC;
  var CHAVE = 'lotocalc:v1';

  function $(sel, raiz) { return (raiz || document).querySelector(sel); }
  function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function num(v, padrao) {
    var n = parseFloat(v);
    return isNaN(n) ? padrao : n;
  }

  function limpar(no) { while (no.firstChild) no.removeChild(no.firstChild); }

  /* ======================================================================
     ESTADO
     ==================================================================== */

  var estado = {
    lotId: 'megasena',
    dezenas: {},          // por modalidade
    modoLote: 'qtd',      // 'qtd' | 'orcamento'
    qtd: 10,
    orcamento: 60,
    marcas: {},           // por modalidade: { dezena: 'fixa' | 'exclui' }
    ssFixas: {},          // super sete: { coluna: [digitos] }
    loteca: { duplos: 0, triplos: 0, fixos: {} },
    extras: {},           // { trevosQtd, trevosFixas[], time, mes }
    estrategia: 'aleatorio',
    filtros: {},          // por modalidade: { idFiltro: {ativo,min,max} }
    fechamento: { modo: 'total', garantirSe: null, garantirAcertos: null, embaralhar: false },
    cadeia: { rodadas: 12, deriva: 3, temperatura: 0.6 },
    vies: 0.6,
    usarAtraso: false,
    evitarRepetidos: true,
    diversidade: false,
    diversidadeMax: 4,
    semente: '',
    historicoTexto: {},   // por modalidade
    premios: { amostra: 20, dividir: true, ir: true, limiteIR: 2428.80 },
    tema: null
  };

  var resultado = null;      // último lote gerado
  var historico = [];        // concursos lidos, da modalidade atual
  var conferencia = null;
  var abaAtual = 'jogos';

  var oficial = {};          // por modalidade: { ultimo, amostra, carregando, progresso, erro }
  var ajustesEV = { manual: {}, principal: null, apostas: null };   // valores digitados na aba Prêmios
  var oficialConferido = null;   // concurso buscado no conferidor (traz o rateio)

  function salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado));
    } catch (e) { /* modo privado / cota — segue sem persistir */ }
  }

  function carregar() {
    try {
      var bruto = localStorage.getItem(CHAVE);
      if (!bruto) return;
      var lido = JSON.parse(bruto);
      var padraoPremios = estado.premios;
      Object.keys(lido).forEach(function (k) {
        if (k in estado) estado[k] = lido[k];
      });
      estado.premios = Object.assign({}, padraoPremios, estado.premios || {});
    } catch (e) { /* dado corrompido — ignora */ }
  }

  function lot() { return LC.lot(estado.lotId); }

  /* ---- contraste da cor da modalidade ------------------------------------ */

  function paraRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function paraHex(rgb) {
    return '#' + rgb.map(function (c) {
      var v = Math.max(0, Math.min(255, Math.round(c))).toString(16);
      return v.length < 2 ? '0' + v : v;
    }).join('');
  }

  /** Luminância relativa da WCAG. */
  function luminancia(rgb) {
    var c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contraste(a, b) {
    var la = luminancia(a), lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /**
   * Marcas como o lima do Super Sete ou o laranja da Lotomania não sustentam
   * texto branco por cima nem servem de texto sobre fundo claro. Aqui saem as
   * três variantes que resolvem isso sem abandonar a identidade da modalidade.
   */
  function variantesDaMarca(hex) {
    var base = paraRgb(hex);
    var branco = [255, 255, 255], quaseNegro = [18, 20, 26];

    var sobre = contraste(base, branco) >= contraste(base, quaseNegro)
      ? paraHex(branco) : paraHex(quaseNegro);

    // escurece até destacar sobre papel branco
    var escuro = base.slice(), k = 1;
    while (contraste(escuro, branco) < 4.5 && k > 0.16) {
      k -= 0.04;
      escuro = base.map(function (c) { return c * k; });
    }

    // clareia até destacar sobre a mesa escura
    var mesa = [23, 26, 33], claro = base.slice(), t = 0;
    while (contraste(claro, mesa) < 4.5 && t < 0.9) {
      t += 0.05;
      claro = base.map(function (c) { return c + (255 - c) * t; });
    }

    return { sobre: sobre, escuro: paraHex(escuro), claro: paraHex(claro) };
  }

  /** O tema em vigor, resolvendo "seguir o sistema". */
  function temaEfetivo() {
    if (estado.tema) return estado.tema;
    return (global.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  /**
   * Publica a cor da modalidade nas variáveis CSS. --brand-texto é resolvido
   * aqui (e não por var() encadeado) para que o canvas também possa lê-lo.
   */
  function aplicarCoresMarca() {
    var l = lot();
    var v = variantesDaMarca(l.brand);
    var raiz = document.documentElement;
    raiz.style.setProperty('--brand', l.brand);
    raiz.style.setProperty('--brand-rgb', l.brandRgb);
    raiz.style.setProperty('--sobre-brand', v.sobre);
    raiz.style.setProperty('--brand-escuro', v.escuro);
    raiz.style.setProperty('--brand-claro', v.claro);
    raiz.style.setProperty('--brand-texto', temaEfetivo() === 'dark' ? v.claro : v.escuro);
  }

  /** Tokens de cor atuais, lidos do CSS — acompanham tema e modalidade. */
  function paleta() {
    var cs = getComputedStyle(document.documentElement);
    function t(nome, padrao) { return cs.getPropertyValue(nome).trim() || padrao; }
    return {
      brand: t('--brand', '#209869'),
      brandRgb: t('--brand-rgb', '32 152 105'),
      brandTexto: t('--brand-texto', '#15774F'),
      linha: t('--line', '#ddd'),
      linhaForte: t('--line-forte', '#bbb'),
      superficie: t('--surface', '#fff'),
      superficie2: t('--surface-2', '#f4f4f4'),
      superficie3: t('--surface-3', '#e6e6e6'),
      tinta: t('--ink', '#111'),
      tinta2: t('--ink-2', '#555'),
      tinta3: t('--ink-3', '#888'),
      ok: t('--ok', '#12704a')
    };
  }

  function marcas() {
    if (!estado.marcas[estado.lotId]) estado.marcas[estado.lotId] = {};
    return estado.marcas[estado.lotId];
  }

  function porEstado(tipo) {
    var m = marcas(), out = [];
    Object.keys(m).forEach(function (k) { if (m[k] === tipo) out.push(Number(k)); });
    return out.sort(function (a, b) { return a - b; });
  }

  function dezenasAtual() {
    var l = lot();
    if (estado.dezenas[l.id] == null) estado.dezenas[l.id] = l.padrao;
    return Math.max(l.escolhaMin, Math.min(l.escolhaMax, estado.dezenas[l.id]));
  }

  function filtros() {
    if (!estado.filtros[estado.lotId]) estado.filtros[estado.lotId] = {};
    return estado.filtros[estado.lotId];
  }

  /* ======================================================================
     TOASTS / MODAL
     ==================================================================== */

  function toast(msg, tipo) {
    var caixa = $('#toasts');
    var t = el('div', 'toast' + (tipo ? ' toast--' + tipo : ''), msg);
    caixa.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s ease, transform .3s ease';
      t.style.opacity = '0';
      t.style.transform = 'translateX(14px)';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, tipo === 'erro' ? 6200 : 3600);
  }

  function abrirModal(titulo, montarCorpo, montarPe) {
    $('#modalTitulo').textContent = titulo;
    var corpo = $('#modalCorpo'), pe = $('#modalPe');
    limpar(corpo); limpar(pe);
    montarCorpo(corpo);
    if (montarPe) montarPe(pe);
    $('#modal').hidden = false;
  }

  function fecharModal() { $('#modal').hidden = true; }

  /* ======================================================================
     MODALIDADES
     ==================================================================== */

  function renderModalidades() {
    var nav = $('#navModalidades');
    limpar(nav);
    LC.LOTERIAS.forEach(function (l) {
      var b = el('button', 'tile' + (l.id === estado.lotId ? ' is-ativa' : ''));
      b.type = 'button';
      b.style.setProperty('--t', l.brand);
      b.setAttribute('aria-pressed', l.id === estado.lotId ? 'true' : 'false');
      b.appendChild(el('span', 'tile__nome', l.nome));
      b.appendChild(el('span', 'tile__meta', l.sorteio));
      b.addEventListener('click', function () {
        if (estado.lotId === l.id) return;
        estado.lotId = l.id;
        conferencia = null;
        resultado = null;
        aplicarModalidade();
        renderJogos();
        salvar();
      });
      nav.appendChild(b);
    });
  }

  function aplicarModalidade() {
    aplicarCoresMarca();
    var l = lot();

    $$('.tile').forEach(function (t, i) {
      var alvo = LC.LOTERIAS[i].id === estado.lotId;
      t.classList.toggle('is-ativa', alvo);
      t.setAttribute('aria-pressed', alvo ? 'true' : 'false');
    });

    $('#resumoModalidade').textContent = l.resumo;

    lerHistoricoSalvo();
    renderCamposAposta();
    renderVolante();
    renderEstrategias();
    renderFiltros();
    renderEntradaResultado();
    renderResumoHistorico();
    $('#inHistorico').value = estado.historicoTexto[l.id] || '';
    $('#baixarHistorico').hidden = l.tipo !== 'dezenas';
    ajustesEV = { manual: {}, principal: null, apostas: null };
    if (abaAtual === 'premios') abrirPremios();
    forja.reiniciar();
    aplicarModoLote();
    atualizarCusto();
    atualizarImpressao();
  }

  /* ======================================================================
     CAMPOS DA APOSTA
     ==================================================================== */

  function pintarRange(input) {
    var min = num(input.min, 0), max = num(input.max, 100), v = num(input.value, 0);
    var pct = max === min ? 0 : ((v - min) / (max - min)) * 100;
    input.style.setProperty('--preenchido', pct + '%');
  }

  function renderCamposAposta() {
    var l = lot();
    var campo = $('#campoDezenas');
    var inD = $('#inDezenas');
    var especiais = $('#camposEspeciais');
    limpar(especiais);

    if (l.tipo === 'bilhete' || l.tipo === 'placares') {
      campo.hidden = true;
    } else if (l.tipo === 'colunas') {
      campo.hidden = false;
      $('#rotDezenas').textContent = 'Algarismos por coluna';
      inD.min = l.escolhaMin; inD.max = l.escolhaMax;
      inD.value = dezenasAtual();
      $('#dezMin').textContent = l.escolhaMin;
      $('#dezMax').textContent = l.escolhaMax;
      $('#outDezenas').textContent = inD.value;
    } else if (l.escolhaMin === l.escolhaMax) {
      campo.hidden = true;
      var n = el('p', 'bloco__resumo');
      n.innerHTML = 'Aposta de tamanho fixo: <b>' + l.escolhaMin + ' dezenas</b> por jogo.';
      especiais.appendChild(n);
    } else {
      campo.hidden = false;
      $('#rotDezenas').textContent = 'Dezenas por jogo';
      inD.min = l.escolhaMin; inD.max = l.escolhaMax;
      inD.value = dezenasAtual();
      $('#dezMin').textContent = l.escolhaMin;
      $('#dezMax').textContent = l.escolhaMax;
      $('#outDezenas').textContent = inD.value;
    }
    pintarRange(inD);

    // Loteca: quantos duplos e triplos
    if (l.tipo === 'placares') {
      var cx = el('div', 'dupla');
      [['duplos', 'Partidas em duplo'], ['triplos', 'Partidas em triplo']].forEach(function (par) {
        var c = el('div', 'campo');
        var topo = el('div', 'campo__topo');
        var rot = el('label', 'campo__rotulo', par[1]);
        rot.setAttribute('for', 'in-' + par[0]);
        topo.appendChild(rot);
        c.appendChild(topo);
        var i = el('input');
        i.type = 'number'; i.id = 'in-' + par[0]; i.min = 0; i.max = 14;
        i.value = estado.loteca[par[0]] || 0;
        i.addEventListener('input', function () {
          estado.loteca[par[0]] = Math.max(0, Math.min(14, num(i.value, 0)));
          atualizarCusto(); salvar();
        });
        c.appendChild(i);
        cx.appendChild(c);
      });
      especiais.appendChild(cx);
      var aviso = el('p', 'bloco__resumo');
      aviso.innerHTML = 'Cada duplo multiplica o preço por 2 e cada triplo por 3. As demais partidas saem com um palpite só.';
      especiais.appendChild(aviso);
    }

    // Extras de lista (time / mês) e trevos
    if (l.extra && l.extra.tipo === 'lista') {
      var c2 = el('div', 'campo');
      var topo2 = el('div', 'campo__topo');
      var rot2 = el('label', 'campo__rotulo', l.extra.nome);
      rot2.setAttribute('for', 'inExtraLista');
      topo2.appendChild(rot2);
      c2.appendChild(topo2);
      var sel = el('select');
      sel.id = 'inExtraLista';
      var opAle = el('option', null, 'Sortear a cada jogo');
      opAle.value = '__aleatorio__';
      sel.appendChild(opAle);
      l.extra.opcoes.forEach(function (o) {
        var op = el('option', null, o);
        op.value = o;
        sel.appendChild(op);
      });
      sel.value = estado.extras[l.extra.id] || '__aleatorio__';
      sel.addEventListener('change', function () {
        estado.extras[l.extra.id] = sel.value;
        salvar();
      });
      c2.appendChild(sel);
      especiais.appendChild(c2);
    }

    if (l.extra && l.extra.tipo === 'dezenas') {
      var e = l.extra;
      if (estado.extras.trevosQtd == null) estado.extras.trevosQtd = e.padrao;
      var c3 = el('div', 'campo');
      var topo3 = el('div', 'campo__topo');
      var rot3 = el('label', 'campo__rotulo', 'Trevos por jogo');
      rot3.setAttribute('for', 'inTrevosQtd');
      var out3 = el('output', 'campo__valor', String(estado.extras.trevosQtd));
      out3.id = 'outTrevosQtd';
      topo3.appendChild(rot3); topo3.appendChild(out3);
      c3.appendChild(topo3);
      var i3 = el('input');
      i3.type = 'range'; i3.id = 'inTrevosQtd';
      i3.min = e.escolhaMin; i3.max = e.escolhaMax; i3.step = 1;
      i3.value = estado.extras.trevosQtd;
      i3.addEventListener('input', function () {
        estado.extras.trevosQtd = num(i3.value, e.padrao);
        out3.textContent = i3.value;
        pintarRange(i3);
        atualizarCusto(); salvar();
      });
      c3.appendChild(i3);
      especiais.appendChild(c3);
      pintarRange(i3);
    }
  }

  /* ======================================================================
     VOLANTE
     ==================================================================== */

  function cicloMarca(n) {
    var m = marcas();
    var atual = m[n];
    if (!atual) m[n] = 'fixa';
    else if (atual === 'fixa') m[n] = 'exclui';
    else delete m[n];
  }

  function renderVolante() {
    var l = lot();
    var bloco = $('#blocoVolante');
    var grade = $('#volante');
    var extra = $('#volanteExtra');
    limpar(grade); limpar(extra);

    if (l.tipo === 'bilhete') {
      bloco.hidden = true;
      return;
    }
    bloco.hidden = false;

    if (l.tipo === 'colunas') return renderVolanteColunas(l, grade, extra);
    if (l.tipo === 'placares') return renderVolanteLoteca(l, grade, extra);

    grade.style.setProperty('--grade', l.grade);
    var m = marcas();
    LC.universo(l).forEach(function (n) {
      var b = el('button', 'dez', LC.fmt(l, n));
      b.type = 'button';
      if (m[n] === 'fixa') b.classList.add('is-fixa');
      if (m[n] === 'exclui') b.classList.add('is-exclui');
      b.setAttribute('aria-label', 'Dezena ' + LC.fmt(l, n) + (m[n] ? ' — ' + m[n] : ''));
      b.addEventListener('click', function () {
        cicloMarca(n);
        renderVolante();
        atualizarCusto();
        salvar();
      });
      grade.appendChild(b);
    });

    // trevos da +Milionária
    if (l.extra && l.extra.tipo === 'dezenas') {
      var e = l.extra;
      if (!estado.extras.trevosFixas) estado.extras.trevosFixas = [];
      var caixa = el('div', 'extra-bloco');
      caixa.appendChild(el('div', 'extra-bloco__titulo', e.nome + ' — fixe os que quiser'));
      var gt = el('div', 'trevos');
      for (var t = e.min; t <= e.max; t++) {
        (function (v) {
          var b = el('button', 'dez', String(v));
          b.type = 'button';
          if (estado.extras.trevosFixas.indexOf(v) !== -1) b.classList.add('is-fixa');
          b.addEventListener('click', function () {
            var i = estado.extras.trevosFixas.indexOf(v);
            if (i === -1) estado.extras.trevosFixas.push(v);
            else estado.extras.trevosFixas.splice(i, 1);
            renderVolante(); atualizarCusto(); salvar();
          });
          gt.appendChild(b);
        })(t);
      }
      caixa.appendChild(gt);
      extra.appendChild(caixa);
    }

    atualizarLegenda();
  }

  function renderVolanteColunas(l, grade, extra) {
    grade.style.removeProperty('--grade');
    var caixa = el('div', 'colunas-ss');
    for (var c = 0; c < l.colunas; c++) {
      (function (col) {
        if (!estado.ssFixas[col]) estado.ssFixas[col] = [];
        var wrap = el('div', 'coluna-ss');
        wrap.appendChild(el('div', 'coluna-ss__rot', 'C' + (col + 1)));
        for (var d = l.digMin; d <= l.digMax; d++) {
          (function (dig) {
            var b = el('button', 'dez', String(dig));
            b.type = 'button';
            if (estado.ssFixas[col].indexOf(dig) !== -1) b.classList.add('is-fixa');
            b.addEventListener('click', function () {
              var arr = estado.ssFixas[col];
              var i = arr.indexOf(dig);
              if (i === -1) {
                if (arr.length >= l.escolhaMax) {
                  toast('No máximo ' + l.escolhaMax + ' algarismos por coluna.', 'erro');
                  return;
                }
                arr.push(dig);
              } else arr.splice(i, 1);
              renderVolante(); atualizarCusto(); salvar();
            });
            wrap.appendChild(b);
          })(d);
        }
        caixa.appendChild(wrap);
      })(c);
    }
    grade.appendChild(caixa);
    $('#ajudaVolante').innerHTML = 'Marque os algarismos que devem <b>aparecer sempre</b> em cada coluna. As colunas vazias saem sorteadas.';
    atualizarLegenda();
  }

  function renderVolanteLoteca(l, grade, extra) {
    grade.style.removeProperty('--grade');
    var lista = el('div', 'loteca-lista');
    for (var j = 0; j < l.jogos; j++) {
      (function (idx) {
        if (!estado.loteca.fixos[idx]) estado.loteca.fixos[idx] = [];
        var linha = el('div', 'loteca-linha');
        linha.appendChild(el('span', 'loteca-linha__n', String(idx + 1).padStart(2, '0')));
        var marcas = el('div', 'loteca-marcas');
        l.simbolos.forEach(function (s) {
          var b = el('button', 'dez', s);
          b.type = 'button';
          if (estado.loteca.fixos[idx].indexOf(s) !== -1) b.classList.add('is-fixa');
          b.addEventListener('click', function () {
            var arr = estado.loteca.fixos[idx];
            var i = arr.indexOf(s);
            if (i === -1) arr.push(s); else arr.splice(i, 1);
            renderVolante(); atualizarCusto(); salvar();
          });
          marcas.appendChild(b);
        });
        linha.appendChild(marcas);
        lista.appendChild(linha);
      })(j);
    }
    grade.appendChild(lista);
    $('#ajudaVolante').innerHTML = 'Trave o palpite de uma partida clicando em <b>1</b>, <b>X</b> ou <b>2</b>. O que ficar solto é sorteado.';
    atualizarLegenda();
  }

  function atualizarLegenda() {
    var l = lot();
    var cont = $('#contVolante');
    var rot = $('#rotuloFixa');

    if (l.tipo === 'colunas' || l.tipo === 'placares') {
      var total = 0;
      if (l.tipo === 'colunas') {
        Object.keys(estado.ssFixas).forEach(function (k) { total += estado.ssFixas[k].length; });
      } else {
        Object.keys(estado.loteca.fixos).forEach(function (k) { total += estado.loteca.fixos[k].length; });
      }
      cont.textContent = total + ' marcações';
      rot.textContent = 'travado';
      return;
    }

    var f = porEstado('fixa').length, x = porEstado('exclui').length;
    cont.textContent = f + ' fixas · ' + x + ' fora · ' + (LC.universo(l).length - x) + ' no bolo';

    if (estado.estrategia === 'fechamento') {
      rot.textContent = 'dezena do fechamento';
      $('#ajudaVolante').innerHTML = 'No fechamento, as dezenas marcadas em <b>verde</b> formam o pool que será combinado. Marque mais do que o tamanho do jogo.';
    } else {
      rot.textContent = 'fixa em todo jogo';
      $('#ajudaVolante').innerHTML = 'Clique numa dezena para <b>fixar</b>, de novo para <b>excluir</b>, de novo para limpar.';
    }
  }

  /* ======================================================================
     ESTRATÉGIAS
     ==================================================================== */

  var ESTRATEGIAS = [
    {
      id: 'aleatorio', nome: 'Sorteio limpo',
      desc: 'Uniforme, como a surpresinha da lotérica. Toda dezena com a mesma chance.'
    },
    {
      id: 'equilibrado', nome: 'Equilibrado',
      desc: 'Aplica por cima as faixas estatísticas sugeridas — soma, paridade e espalhamento no ponto mais provável.'
    },
    {
      id: 'cadeia', nome: 'Cadeia de hash',
      desc: 'O estado de 128 bits gira, vira parâmetro de uma curva, e cada jogo realimenta o próximo. Ajuste na aba Cadeia.'
    },
    {
      id: 'ponderado', nome: 'Ponderada por histórico',
      desc: 'Puxa para as dezenas mais sorteadas, menos sorteadas ou mais atrasadas. Exige histórico carregado.'
    },
    {
      id: 'cobertura', nome: 'Cobertura uniforme',
      desc: 'Espalha o uso das dezenas por igual entre os jogos: ninguém aparece muito mais que os outros.'
    },
    {
      id: 'fechamento', nome: 'Fechamento',
      desc: 'Combina as dezenas marcadas no volante. Completo, ou reduzido com garantia mínima de acertos.'
    }
  ];

  function renderEstrategias() {
    var l = lot();
    var caixa = $('#listaEstrategias');
    limpar(caixa);

    var simples = (l.tipo !== 'dezenas');
    if (simples) {
      var n = el('div', 'nota');
      n.appendChild(document.createTextNode(
        'O ' + l.nome + ' usa o sorteio direto sobre as marcações do volante — as estratégias de dezenas não se aplicam aqui.'
      ));
      caixa.appendChild(n);
      limpar($('#opcoesEstrategia'));
      return;
    }

    ESTRATEGIAS.forEach(function (e) {
      var b = el('button', 'estrategia' + (estado.estrategia === e.id ? ' is-ativa' : ''));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', estado.estrategia === e.id ? 'true' : 'false');
      b.appendChild(el('span', 'estrategia__marca'));
      var txt = el('span');
      txt.appendChild(el('span', 'estrategia__nome', e.nome));
      txt.appendChild(el('span', 'estrategia__desc', e.desc));
      b.appendChild(txt);
      b.addEventListener('click', function () {
        estado.estrategia = e.id;
        renderEstrategias();
        atualizarLegenda();
        atualizarCusto();
        salvar();
      });
      caixa.appendChild(b);
    });

    renderOpcoesEstrategia();
  }

  function renderOpcoesEstrategia() {
    var alvo = $('#opcoesEstrategia');
    limpar(alvo);
    var l = lot();

    if (estado.estrategia === 'ponderado') {
      var cx = el('div', 'opcoes-caixa');
      cx.appendChild(el('div', 'opcoes-caixa__titulo', 'Peso do histórico'));

      var campo = el('div', 'campo');
      var topo = el('div', 'campo__topo');
      var rot = el('label', 'campo__rotulo', 'Viés');
      rot.setAttribute('for', 'inVies');
      var out = el('output', 'campo__valor', formatarVies(estado.vies));
      out.id = 'outVies';
      topo.appendChild(rot); topo.appendChild(out);
      campo.appendChild(topo);
      var i = el('input');
      i.type = 'range'; i.id = 'inVies'; i.min = -1; i.max = 1; i.step = 0.05;
      i.value = estado.vies;
      i.addEventListener('input', function () {
        estado.vies = num(i.value, 0);
        out.textContent = formatarVies(estado.vies);
        pintarRange(i); salvar();
      });
      campo.appendChild(i);
      var esc = el('div', 'vies-escala');
      esc.appendChild(el('span', null, estado.usarAtraso ? 'recém-sorteadas' : 'menos sorteadas'));
      esc.appendChild(el('span', null, estado.usarAtraso ? 'mais atrasadas' : 'mais sorteadas'));
      campo.appendChild(esc);
      cx.appendChild(campo);
      pintarRange(i);

      var alt = el('label', 'alternador');
      var chk = el('input'); chk.type = 'checkbox'; chk.checked = estado.usarAtraso;
      chk.addEventListener('change', function () {
        estado.usarAtraso = chk.checked;
        renderOpcoesEstrategia(); salvar();
      });
      alt.appendChild(chk);
      alt.appendChild(el('span', null, 'Usar atraso em vez de frequência'));
      cx.appendChild(alt);

      var nota = el('div', 'opcoes-caixa__nota');
      nota.textContent = historico.length
        ? historico.length + ' concursos carregados para ' + l.nome + '.'
        : 'Nenhum histórico carregado — abra a aba Histórico e cole os resultados.';
      cx.appendChild(nota);
      alvo.appendChild(cx);
      return;
    }

    if (estado.estrategia === 'fechamento') {
      var pool = porEstado('fixa');
      var k = dezenasAtual();
      var cxf = el('div', 'opcoes-caixa');
      cxf.appendChild(el('div', 'opcoes-caixa__titulo', 'Fechamento'));

      var linha = el('div', 'linha-acoes');
      [['total', 'Completo'], ['reduzido', 'Reduzido com garantia']].forEach(function (par) {
        var b = el('button', 'btn btn--fino' + (estado.fechamento.modo === par[0] ? ' btn--principal' : ''), par[1]);
        b.type = 'button';
        b.addEventListener('click', function () {
          estado.fechamento.modo = par[0];
          renderOpcoesEstrategia(); atualizarCusto(); salvar();
        });
        linha.appendChild(b);
      });
      cxf.appendChild(linha);

      if (estado.fechamento.modo === 'reduzido') {
        var dupla = el('div', 'dupla');
        var maxSe = Math.max(2, Math.min(pool.length || l.sorteadas, l.sorteadas));
        if (estado.fechamento.garantirSe == null) estado.fechamento.garantirSe = maxSe;
        if (estado.fechamento.garantirAcertos == null) estado.fechamento.garantirAcertos = Math.max(3, l.sorteadas - 2);

        dupla.appendChild(campoNumero('Se eu acertar', 'inGarantirSe', estado.fechamento.garantirSe, 2, Math.max(2, pool.length || l.sorteadas), function (v) {
          estado.fechamento.garantirSe = v; atualizarCusto(); salvar();
        }));
        dupla.appendChild(campoNumero('Garanto ao menos', 'inGarantirAcertos', estado.fechamento.garantirAcertos, 2, Math.min(k, l.sorteadas), function (v) {
          estado.fechamento.garantirAcertos = v; atualizarCusto(); salvar();
        }));
        cxf.appendChild(dupla);
        cxf.appendChild(el('div', 'opcoes-caixa__nota',
          'O motor escolhe o menor conjunto de jogos que cobre todos os cenários. Cálculo pesado: use pools de até ~20 dezenas.'));
      } else {
        var altF = el('label', 'alternador');
        var chkF = el('input'); chkF.type = 'checkbox'; chkF.checked = !!estado.fechamento.embaralhar;
        chkF.addEventListener('change', function () { estado.fechamento.embaralhar = chkF.checked; salvar(); });
        altF.appendChild(chkF);
        altF.appendChild(el('span', null, 'Embaralhar as combinações'));
        cxf.appendChild(altF);
      }

      var total = pool.length >= k ? LC.comb(pool.length, k) : 0;
      var notaF = el('div', 'opcoes-caixa__nota');
      notaF.textContent = pool.length < k + 1
        ? 'Marque pelo menos ' + (k + 1) + ' dezenas no volante (você marcou ' + pool.length + ').'
        : 'Pool de ' + pool.length + ' dezenas → ' + total.toLocaleString('pt-BR') + ' combinações possíveis de ' + k + '.';
      cxf.appendChild(notaF);
      alvo.appendChild(cxf);
      return;
    }

    if (estado.estrategia === 'cadeia') {
      var cxc = el('div', 'opcoes-caixa');
      cxc.appendChild(el('div', 'opcoes-caixa__titulo', 'Cadeia de hash'));
      var res = el('div', 'opcoes-caixa__nota');
      res.textContent = 'Temperatura ' + estado.cadeia.temperatura.toFixed(2).replace('.', ',') +
        ' · ' + estado.cadeia.rodadas + ' voltas por elo · deriva ' + estado.cadeia.deriva + '.';
      cxc.appendChild(res);
      var b = el('button', 'btn btn--fino', 'Abrir a forja →');
      b.type = 'button';
      b.addEventListener('click', function () { trocarAba('cadeia'); });
      var linhaB = el('div', 'linha-acoes');
      linhaB.appendChild(b);
      cxc.appendChild(linhaB);
      alvo.appendChild(cxc);
      return;
    }

    if (estado.estrategia === 'equilibrado') {
      var cxe = el('div', 'opcoes-caixa');
      cxe.appendChild(el('div', 'opcoes-caixa__titulo', 'Equilíbrio automático'));
      cxe.appendChild(el('div', 'opcoes-caixa__nota',
        'Além dos filtros que você ligou, os jogos passam pelas faixas sugeridas de soma, paridade e espalhamento. ' +
        'Se as faixas ficarem impossíveis, o motor avisa e afrouxa no fim.'));
      alvo.appendChild(cxe);
    }
  }

  function formatarVies(v) {
    if (Math.abs(v) < 0.05) return 'neutro';
    return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',');
  }

  function campoNumero(rotulo, id, valor, min, max, aoMudar) {
    var c = el('div', 'campo');
    var topo = el('div', 'campo__topo');
    var r = el('label', 'campo__rotulo', rotulo);
    r.setAttribute('for', id);
    topo.appendChild(r);
    c.appendChild(topo);
    var i = el('input');
    i.type = 'number'; i.id = id; i.min = min; i.max = max; i.value = valor;
    i.addEventListener('input', function () {
      aoMudar(Math.max(min, Math.min(max, num(i.value, min))));
    });
    c.appendChild(i);
    return c;
  }

  /* ======================================================================
     FILTROS
     ==================================================================== */

  function renderFiltros() {
    var l = lot();
    var caixa = $('#listaFiltros');
    limpar(caixa);
    var bloco = $('#blocoFiltros');

    if (l.tipo !== 'dezenas') {
      bloco.hidden = true;
      return;
    }
    bloco.hidden = false;

    var k = dezenasAtual();
    var sug = LC.sugerirFiltros(l, k);
    var conf = filtros();
    var ativos = 0;

    LC.FILTROS_DEFS.forEach(function (def) {
      if (def.somente && def.somente.indexOf(l.id) === -1) return;
      if (!conf[def.id]) conf[def.id] = { ativo: false };
      var f = conf[def.id];
      var s = sug[def.id] || {};
      if (f.min == null) f.min = s.min != null ? s.min : 0;
      if (f.max == null) f.max = s.max != null ? s.max : k;

      var indisponivel = def.requerAnterior && !historico.length;
      if (f.ativo && !indisponivel) ativos++;

      var box = el('div', 'filtro' + (f.ativo && !indisponivel ? ' is-ativo' : ''));
      var cab = el('label', 'filtro__cabeca');
      var chk = el('input');
      chk.type = 'checkbox';
      chk.checked = f.ativo && !indisponivel;
      chk.disabled = indisponivel;
      chk.addEventListener('change', function () {
        f.ativo = chk.checked;
        renderFiltros(); salvar();
      });
      cab.appendChild(chk);
      cab.appendChild(el('span', 'filtro__nome', def.rotulo));
      cab.appendChild(el('span', 'filtro__valor', resumoFiltro(def, f)));
      box.appendChild(cab);

      if (f.ativo && !indisponivel) {
        var corpo = el('div', 'filtro__corpo');
        var pares = el('div', 'filtro__pares');
        if (def.tipo === 'faixa' || def.tipo === 'min') {
          pares.appendChild(entradaFiltro('mín.', f, 'min', def, box));
        }
        if (def.tipo === 'faixa' || def.tipo === 'max') {
          pares.appendChild(entradaFiltro('máx.', f, 'max', def, box));
        }
        var reset = el('button', 'btn btn--fino', 'sugerido');
        reset.type = 'button';
        reset.addEventListener('click', function () {
          if (s.min != null) f.min = s.min;
          if (s.max != null) f.max = s.max;
          renderFiltros(); salvar();
        });
        pares.appendChild(reset);
        corpo.appendChild(pares);
        corpo.appendChild(el('div', 'filtro__dica', def.dica));
        box.appendChild(corpo);
      }

      if (indisponivel) {
        var d = el('div', 'filtro__corpo');
        d.appendChild(el('div', 'filtro__dica', 'Carregue o histórico na aba Histórico para usar este filtro.'));
        box.appendChild(d);
      }

      caixa.appendChild(box);
    });

    $('#contFiltros').textContent = ativos + (ativos === 1 ? ' ativo' : ' ativos');
    $('#inEvitarRepetidos').checked = estado.evitarRepetidos;
    $('#inDiversidade').checked = estado.diversidade;
    $('#subDiversidade').hidden = !estado.diversidade;
    $('#inDiversidadeMax').value = estado.diversidadeMax;
    $('#inDiversidadeMax').max = Math.max(1, k - 1);
  }

  function entradaFiltro(rotulo, f, campo, def, box) {
    var w = el('span', 'filtro__pares');
    w.appendChild(el('label', null, rotulo));
    var i = el('input');
    i.type = 'number';
    i.value = f[campo];
    i.addEventListener('input', function () {
      f[campo] = num(i.value, f[campo]);
      var v = $('.filtro__valor', box);
      if (v) v.textContent = resumoFiltro(def, f);
      salvar();
    });
    w.appendChild(i);
    return w;
  }

  function resumoFiltro(def, f) {
    if (!f.ativo) return 'desligado';
    if (def.tipo === 'faixa') return f.min + '–' + f.max;
    if (def.tipo === 'max') return '≤ ' + f.max;
    return '≥ ' + f.min;
  }

  function aplicarSugeridos() {
    var l = lot(), k = dezenasAtual();
    var sug = LC.sugerirFiltros(l, k);
    var conf = filtros();
    ['soma', 'pares', 'consecutivos', 'maxTerminacao'].forEach(function (id) {
      if (!conf[id]) conf[id] = {};
      conf[id].ativo = true;
      if (sug[id]) {
        if (sug[id].min != null) conf[id].min = sug[id].min;
        if (sug[id].max != null) conf[id].max = sug[id].max;
      }
    });
    renderFiltros();
    salvar();
    toast('Faixas sugeridas aplicadas a soma, pares, sequência e terminações.', 'ok');
  }

  /* ======================================================================
     CUSTO
     ==================================================================== */

  function custoUnitario() {
    var l = lot();
    if (l.tipo === 'colunas') {
      var alvo = dezenasAtual(), prod = 1;
      for (var c = 0; c < l.colunas; c++) {
        var fix = (estado.ssFixas[c] || []).length;
        prod *= Math.max(alvo, fix, 1);
      }
      return prod * l.preco;
    }
    if (l.tipo === 'placares') {
      return l.preco * Math.pow(3, estado.loteca.triplos || 0) * Math.pow(2, estado.loteca.duplos || 0);
    }
    if (l.tipo === 'bilhete') return l.preco;
    var trevos = (l.extra && l.extra.tipo === 'dezenas') ? (estado.extras.trevosQtd || l.extra.padrao) : 0;
    return LC.custoPrevisto(l, dezenasAtual(), trevos);
  }

  /** Quantos jogos o usuário pediu — direto, ou o que couber no orçamento. */
  function qtdAlvo() {
    if (estado.modoLote !== 'orcamento') return estado.qtd;
    var unit = custoUnitario();
    if (!(unit > 0)) return 1;
    return Math.min(2000, Math.floor((estado.orcamento || 0) / unit));
  }

  function qtdEfetiva() {
    var l = lot();
    var q = qtdAlvo();
    if (l.tipo === 'dezenas' && estado.estrategia === 'fechamento' && estado.fechamento.modo === 'total') {
      var pool = porEstado('fixa').length, k = dezenasAtual();
      if (pool > k) return Math.min(q, LC.comb(pool, k));
    }
    return q;
  }

  /** Tamanhos de aposta alternativos, para mostrar o que cabe no orçamento. */
  function opcoesTamanho() {
    var l = lot(), out = [];
    if (l.tipo === 'colunas') {
      for (var a = l.escolhaMin; a <= l.escolhaMax; a++) {
        out.push({ valor: a, rotulo: a + (a === 1 ? ' algarismo/coluna' : ' algarismos/coluna') });
      }
    } else if (l.tipo === 'dezenas' && l.escolhaMin < l.escolhaMax) {
      for (var k = l.escolhaMin; k <= l.escolhaMax; k++) {
        out.push({ valor: k, rotulo: k + ' dezenas' });
      }
    }
    return out;
  }

  function custoDeTamanho(k) {
    var l = lot();
    if (l.tipo === 'colunas') {
      var prod = 1;
      for (var c = 0; c < l.colunas; c++) {
        prod *= Math.max(k, (estado.ssFixas[c] || []).length, 1);
      }
      return prod * l.preco;
    }
    var trevos = (l.extra && l.extra.tipo === 'dezenas') ? (estado.extras.trevosQtd || l.extra.padrao) : 0;
    return LC.custoPrevisto(l, k, trevos);
  }

  function renderOrcamento() {
    var alvo = $('#orcamentoResumo');
    limpar(alvo);
    if (estado.modoLote !== 'orcamento') return;

    var unit = custoUnitario();
    var q = qtdEfetiva();
    var usado = q * unit;
    var teto = estado.orcamento || 0;
    var sobra = Math.max(0, teto - usado);
    var pct = teto > 0 ? Math.min(100, (usado / teto) * 100) : 0;

    var trilho = el('div', 'orcamento__trilho');
    var uso = el('div', 'orcamento__uso', pct > 22 ? LC.moeda(usado) : '');
    uso.style.width = pct + '%';
    trilho.appendChild(uso);
    var resto = el('div', 'orcamento__sobra', sobra > 0 && pct < 92 ? 'sobra ' + LC.moeda(sobra) : '');
    trilho.appendChild(resto);
    alvo.appendChild(trilho);

    var linha = el('div', 'orcamento__linha');
    if (q < 1) {
      linha.appendChild(el('span', null, 'Não dá nem para um jogo: a aposta mínima aqui custa ' + LC.moeda(unit) + '.'));
    } else {
      var forte = el('strong', 'orcamento__forte', String(q));
      linha.appendChild(forte);
      linha.appendChild(el('span', null, (q === 1 ? 'jogo' : 'jogos') + ' de ' + LC.moeda(unit) + ' · sobram ' + LC.moeda(sobra)));
    }
    alvo.appendChild(linha);

    var opcoes = opcoesTamanho();
    if (opcoes.length > 1) {
      var lista = el('div', 'orcamento__opcoes');
      var atual = dezenasAtual();
      var mostradas = 0;
      opcoes.forEach(function (o) {
        var custo = custoDeTamanho(o.valor);
        var cabem = Math.floor(teto / custo);
        if (cabem < 1 && o.valor !== atual) return;
        if (mostradas >= 6 && o.valor !== atual) return;
        mostradas++;
        var b = el('button', 'orcamento__opcao' + (o.valor === atual ? ' is-ativa' : ''));
        b.type = 'button';
        b.appendChild(el('b', null, cabem + '×'));
        b.appendChild(el('span', null, o.rotulo + ' · ' + LC.moeda(custo) + ' cada'));
        b.appendChild(el('span', null, 'sobra ' + LC.moeda(Math.max(0, teto - cabem * custo))));
        b.addEventListener('click', function () {
          estado.dezenas[estado.lotId] = o.valor;
          $('#inDezenas').value = o.valor;
          $('#outDezenas').textContent = o.valor;
          pintarRange($('#inDezenas'));
          renderFiltros();
          atualizarCusto();
          salvar();
        });
        lista.appendChild(b);
      });
      if (mostradas > 1) {
        alvo.appendChild(el('div', 'orcamento__linha', 'O que cabe em ' + LC.moeda(teto) + ':'));
        alvo.appendChild(lista);
      }
    }
  }

  function atualizarCusto() {
    var l = lot();
    var unit = custoUnitario();
    var q = qtdEfetiva();
    $('#custoPrevisto').textContent = LC.moeda(unit * q);

    var partes = [];
    partes.push(q + (q === 1 ? ' jogo' : ' jogos') + ' × ' + LC.moeda(unit));
    if (l.tipo === 'dezenas' && l.precoModo !== 'fixo') {
      var k = dezenasAtual();
      if (k > l.base) {
        partes.push(LC.comb(k, l.base).toLocaleString('pt-BR') + ' apostas simples por jogo');
      }
    }
    if (l.tipo === 'placares') partes.push('estimativa: duplos e triplos multiplicam o bilhete');
    $('#detalhePrevisto').textContent = partes.join('  ·  ');
    if (abaAtual === 'premios' && oficial[l.id] && oficial[l.id].ultimo) renderPremios();

    if (estado.estrategia === 'fechamento') renderOpcoesEstrategia();
    renderOrcamento();
    atualizarLegenda();
  }

  function aplicarModoLote() {
    var orcamento = estado.modoLote === 'orcamento';
    $('#campoQtd').hidden = orcamento;
    $('#campoOrcamento').hidden = !orcamento;
    $$('#segModo button').forEach(function (b) {
      b.classList.toggle('is-ativa', b.dataset.modo === estado.modoLote);
    });
    $('#inOrcamento').value = estado.orcamento;
    $('#outOrcamento').textContent = LC.moeda(estado.orcamento);
    $$('#atalhosOrcamento button').forEach(function (b) {
      b.classList.toggle('is-ativa', Number(b.dataset.valor) === estado.orcamento);
    });
  }

  /* ======================================================================
     GERAÇÃO
     ==================================================================== */

  function montarConfig() {
    var l = lot();
    var cfg = {
      lotId: l.id,
      qtd: qtdEfetiva(),
      dezenas: dezenasAtual(),
      fixas: porEstado('fixa'),
      excluidas: porEstado('exclui'),
      estrategia: l.tipo === 'dezenas' ? estado.estrategia : 'aleatorio',
      filtros: {},
      seed: estado.semente || undefined,
      historico: historico,
      anterior: historico[0] || [],
      vies: estado.vies,
      usarAtraso: estado.usarAtraso,
      evitarRepetidos: estado.evitarRepetidos,
      diversidadeMax: estado.diversidade ? estado.diversidadeMax : null,
      fechamento: estado.fechamento,
      cadeia: estado.cadeia,
      extras: {
        trevosQtd: estado.extras.trevosQtd,
        trevosFixas: estado.extras.trevosFixas || []
      },
      supersete: null,
      loteca: null
    };

    if (l.extra && l.extra.tipo === 'lista') {
      cfg.extras[l.extra.id] = estado.extras[l.extra.id] || '__aleatorio__';
    }

    // filtros ativos
    var conf = filtros();
    Object.keys(conf).forEach(function (id) {
      if (conf[id] && conf[id].ativo) cfg.filtros[id] = conf[id];
    });

    // estratégia equilibrada: soma as faixas sugeridas por cima
    if (cfg.estrategia === 'equilibrado') {
      var sug = LC.sugerirFiltros(l, cfg.dezenas);
      ['soma', 'pares', 'consecutivos', 'maxTerminacao', 'colunas'].forEach(function (id) {
        if (cfg.filtros[id]) return;
        if (!sug[id]) return;
        cfg.filtros[id] = { ativo: true, min: sug[id].min, max: sug[id].max };
      });
    }

    if (l.tipo === 'colunas') {
      var alvo = dezenasAtual();
      cfg.supersete = { porColuna: [], fixas: [] };
      for (var c = 0; c < l.colunas; c++) {
        var fix = (estado.ssFixas[c] || []).slice();
        cfg.supersete.fixas.push(fix);
        cfg.supersete.porColuna.push(Math.max(alvo, fix.length, 1));
      }
    }

    if (l.tipo === 'placares') {
      cfg.loteca = {
        duplos: estado.loteca.duplos || 0,
        triplos: estado.loteca.triplos || 0,
        fixos: []
      };
      for (var j = 0; j < l.jogos; j++) {
        cfg.loteca.fixos.push((estado.loteca.fixos[j] || []).slice());
      }
    }

    return cfg;
  }

  function gerar() {
    if (qtdEfetiva() < 1) {
      toast('O orçamento de ' + LC.moeda(estado.orcamento) + ' não paga nem uma aposta de ' +
        LC.moeda(custoUnitario()) + '. Aumente o valor ou diminua o tamanho do jogo.', 'erro');
      return;
    }
    var btn = $('#btnGerar');
    btn.disabled = true;
    $('#btnGerar').querySelector('span').textContent = 'Gerando…';

    setTimeout(function () {
      try {
        var cfg = montarConfig();
        resultado = LC.gerar(cfg);
        resultado.estrategiaNome = nomeEstrategia();
        conferencia = null;
        if (!estado.semente) {
          $('#inSemente').value = resultado.semente;
          atualizarImpressao();
        }
        renderJogos();
        renderEstatisticas();
        if (resultado.cadeia) forja.adotar(resultado.cadeia);
        trocarAba('jogos');
        toast(resultado.jogos.length + ' jogos prontos em ' + resultado.ms + ' ms.', 'ok');
      } catch (erro) {
        toast(erro.message || 'Não foi possível gerar os jogos.', 'erro');
      } finally {
        btn.disabled = false;
        $('#btnGerar').querySelector('span').textContent = 'Gerar jogos';
      }
    }, 16);
  }

  function nomeEstrategia() {
    var e = ESTRATEGIAS.filter(function (x) { return x.id === estado.estrategia; })[0];
    return e ? e.nome : 'Sorteio limpo';
  }

  /* ======================================================================
     RENDER DOS JOGOS
     ==================================================================== */

  function renderJogos() {
    var lista = $('#listaJogos');
    var vazio = $('#vazioJogos');
    var barra = $('#barraJogos');
    var avisos = $('#avisos');
    limpar(lista); limpar(avisos);

    if (!resultado || !resultado.jogos.length) {
      vazio.hidden = false;
      barra.hidden = true;
      return;
    }

    var l = LC.lot(resultado.lotId);
    vazio.hidden = true;
    barra.hidden = false;

    $('#infoQtd').textContent = resultado.jogos.length + (resultado.jogos.length === 1 ? ' jogo' : ' jogos');
    $('#infoCusto').textContent = LC.moeda(resultado.custo);
    $('#infoSemente').textContent = 'semente ' + resultado.semente;

    resultado.avisos.forEach(function (a) {
      var tipo = /Garantia fechada|avalanche/.test(a) ? 'ok' : 'alerta';
      avisos.appendChild(el('div', 'nota nota--' + tipo, a));
    });

    var frag = document.createDocumentFragment();
    resultado.jogos.forEach(function (j, i) {
      frag.appendChild(cupom(l, j, i));
    });
    lista.appendChild(frag);
  }

  function cupom(l, j, i) {
    var c = el('div', 'cupom');
    c.style.setProperty('--i', Math.min(i, 60));
    if (j.relaxado) c.classList.add('is-relaxado');

    var conf = conferencia && conferencia.linhas[i];
    var valorPremio = conf && conf.premio ? conf.premio.total : 0;
    if (conf && (conf.faixa || valorPremio > 0)) c.classList.add('is-premiado');

    c.appendChild(el('div', 'cupom__n', String(j.n).padStart(3, '0')));
    var corpo = el('div', 'cupom__corpo');

    if (l.tipo === 'bilhete') {
      corpo.appendChild(el('div', 'bilhete', j.bilhete));
    } else if (l.tipo === 'colunas') {
      var g = el('div', 'cupom-colunas');
      j.colunas.forEach(function (col, idx) {
        var w = el('div', 'cupom-coluna');
        w.appendChild(el('div', 'cupom-coluna__r', 'C' + (idx + 1)));
        col.forEach(function (d) {
          var n = el('div', 'cupom-coluna__d', String(d));
          if (conf && conf.marcados[idx]) n.style.color = 'var(--ok)';
          w.appendChild(n);
        });
        g.appendChild(w);
      });
      corpo.appendChild(g);
    } else if (l.tipo === 'placares') {
      var gl = el('div', 'cupom-loteca');
      j.placares.forEach(function (m, idx) {
        var w = el('div', 'cupom-loteca__j');
        w.appendChild(el('div', 'cupom-loteca__n', String(idx + 1)));
        var mm = el('div', 'cupom-loteca__m', m.join(''));
        if (conf && conf.marcados[idx]) mm.style.color = 'var(--ok)';
        w.appendChild(mm);
        gl.appendChild(w);
      });
      corpo.appendChild(gl);
    } else {
      var bolas = el('div', 'bolas');
      var fix = porEstado('fixa');
      j.dezenas.forEach(function (n, idx) {
        var b = el('div', 'bola', LC.fmt(l, n));
        b.style.setProperty('--j', Math.min(idx, 24));
        if (fix.indexOf(n) !== -1) b.classList.add('bola--fixa');
        if (conferencia) {
          var acerto = (conferencia.resultado.dezenas || []).indexOf(n) !== -1;
          b.classList.add(acerto ? 'bola--acerto' : 'bola--erro');
        }
        bolas.appendChild(b);
      });
      if (j.trevos) {
        j.trevos.forEach(function (t, idx) {
          var b = el('div', 'bola bola--trevo', String(t));
          b.style.setProperty('--j', Math.min(j.dezenas.length + idx, 24));
          bolas.appendChild(b);
        });
      }
      corpo.appendChild(bolas);
      if (j.extra) corpo.appendChild(el('div', 'cupom__extra', j.extra));
    }

    var pe = el('div', 'cupom__rodape');
    if (j.metricas) {
      pe.appendChild(tag('soma', j.metricas.soma));
      pe.appendChild(tag('par/ímp', j.metricas.pares + '·' + j.metricas.impares));
      if (j.metricas.consecutivos > 1) pe.appendChild(tag('seq', j.metricas.consecutivos));
    }
    if (j.elo) {
      var e = el('span', 'cupom__elo', '⛓ ' + j.elo);
      pe.appendChild(e);
    }
    if (conf) {
      var texto = conf.faixa ? conf.faixa.nome
        : valorPremio > 0 ? conf.premio.itens[0].nome
        : conf.acertos + ' acerto' + (conf.acertos === 1 ? '' : 's');
      if (valorPremio > 0) texto += ' · ' + LC.moeda(valorPremio);
      var fp = el('span', 'faixa-premio', texto);
      if (!conf.faixa && !(valorPremio > 0)) { fp.style.background = 'var(--surface-2)'; fp.style.color = 'var(--ink-3)'; }
      pe.appendChild(fp);
    }
    pe.appendChild(el('span', 'cupom__custo', LC.moeda(j.custo)));
    corpo.appendChild(pe);

    c.appendChild(corpo);
    return c;
  }

  function tag(rot, val) {
    var s = el('span', 'cupom__tag');
    s.appendChild(document.createTextNode(rot + ' '));
    s.appendChild(el('b', null, String(val)));
    return s;
  }

  /* ======================================================================
     ESTATÍSTICAS
     ==================================================================== */

  function renderEstatisticas() {
    var alvo = $('#conteudoEstatisticas');
    limpar(alvo);

    if (!resultado || !resultado.jogos.length) {
      var v = el('div', 'vazio');
      v.appendChild(el('p', 'vazio__texto', 'Gere alguns jogos para ver a distribuição das dezenas, das somas e do equilíbrio par/ímpar.'));
      alvo.appendChild(v);
      return;
    }

    var l = LC.lot(resultado.lotId);
    var st = LC.estatisticasGeradas(l, resultado.jogos);

    var cartao1 = el('div', 'cartao');
    cartao1.appendChild(el('h3', 'cartao__titulo', 'Panorama do lote'));
    var grade = el('div', 'metricas-grade');
    grade.appendChild(metrica('Jogos', st.total, LC.moeda(st.custo) + ' no total'));
    if (st.jogosComDezenas) {
      grade.appendChild(metrica('Dezenas usadas', st.usadas + '/' + st.universo,
        Math.round(st.usadas / st.universo * 100) + '% do volante'));
      grade.appendChild(metrica('Soma média', Math.round(st.soma.media),
        'de ' + st.soma.min + ' a ' + st.soma.max));
      grade.appendChild(metrica('Mais repetida', maisRepetida(st), 'dezena mais frequente'));
    }
    cartao1.appendChild(grade);
    alvo.appendChild(cartao1);

    if (!st.jogosComDezenas) return;

    // mapa de calor
    var cartao2 = el('div', 'cartao');
    cartao2.appendChild(el('h3', 'cartao__titulo', 'Frequência no lote gerado'));
    var mapa = el('div', 'mapa-calor');
    mapa.style.setProperty('--grade', l.grade);
    st.frequencia.forEach(function (f) {
      var razao = st.maxFreq ? f.c / st.maxFreq : 0;
      var cel = el('div', 'calor' + (razao > 0.62 ? ' is-forte' : ''), LC.fmt(l, f.n));
      cel.style.setProperty('--a', (0.06 + razao * 0.94).toFixed(3));
      cel.title = LC.fmt(l, f.n) + ' — ' + f.c + (f.c === 1 ? ' vez' : ' vezes');
      mapa.appendChild(cel);
    });
    cartao2.appendChild(mapa);
    var esc = el('div', 'escala');
    esc.appendChild(el('span', null, '0'));
    esc.appendChild(el('span', 'escala__fita'));
    esc.appendChild(el('span', null, String(st.maxFreq)));
    cartao2.appendChild(esc);
    alvo.appendChild(cartao2);

    // distribuição de somas
    var cartao3 = el('div', 'cartao');
    cartao3.appendChild(el('h3', 'cartao__titulo', 'Distribuição das somas'));
    cartao3.appendChild(histograma(st.soma.valores, 10));
    alvo.appendChild(cartao3);

    // par / ímpar
    var totalPares = 0, totalDezenas = 0;
    resultado.jogos.forEach(function (j) {
      if (!j.metricas) return;
      totalPares += j.metricas.pares;
      totalDezenas += j.dezenas.length;
    });

    var cartao4 = el('div', 'cartao');
    cartao4.appendChild(el('h3', 'cartao__titulo', 'Equilíbrio par / ímpar'));
    cartao4.appendChild(rosca([
      { rotulo: 'Pares', valor: totalPares, alfa: 1 },
      { rotulo: 'Ímpares', valor: totalDezenas - totalPares, alfa: 0.38 }
    ]));
    cartao4.appendChild(el('div', 'cartao__texto', 'Quantos jogos com cada quantidade de pares:'));
    cartao4.appendChild(barrasMapa(st.pares, st.jogosComDezenas, function (k) {
      return k + ' par' + (Number(k) === 1 ? '' : 'es');
    }));
    alvo.appendChild(cartao4);
  }

  /** Rosca em canvas + legenda, tingida na cor da modalidade. */
  function rosca(fatias) {
    var cores = paleta();
    var caixa = el('div', 'rosca-caixa');
    var cv = el('canvas', 'rosca');
    caixa.appendChild(cv);

    var total = fatias.reduce(function (a, f) { return a + f.valor; }, 0) || 1;

    function tom(alfa) {
      return alfa >= 1 ? cores.brand : 'rgba(' + cores.brandRgb.replace(/\s+/g, ',') + ',' + alfa + ')';
    }

    // o canvas só tem tamanho depois de entrar no DOM
    setTimeout(function () {
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var lado = cv.clientWidth || 132;
      cv.width = Math.round(lado * dpr);
      cv.height = Math.round(lado * dpr);
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, lado, lado);

      var cx = lado / 2, cy = lado / 2;
      var raio = lado / 2 - 4, espessura = lado * 0.19;
      var ang = -Math.PI / 2;

      fatias.forEach(function (f) {
        var arco = (f.valor / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.strokeStyle = tom(f.alfa);
        ctx.lineWidth = espessura;
        ctx.arc(cx, cy, raio - espessura / 2, ang, ang + arco);
        ctx.stroke();
        ang += arco;
      });

      ctx.fillStyle = cores.tinta;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = "700 19px 'Martian Mono', ui-monospace, monospace";
      ctx.fillText(Math.round((fatias[0].valor / total) * 100) + '%', cx, cy - 5);
      ctx.fillStyle = cores.tinta3;
      ctx.font = "400 9px 'Instrument Sans', system-ui, sans-serif";
      ctx.fillText('pares', cx, cy + 13);
    }, 20);

    var legenda = el('div', 'rosca-legenda');
    fatias.forEach(function (f) {
      var item = el('div', 'rosca-item');
      var i = el('i');
      i.style.background = tom(f.alfa);
      item.appendChild(i);
      item.appendChild(el('span', null, f.rotulo));
      item.appendChild(el('b', null, f.valor + ' (' + Math.round((f.valor / total) * 100) + '%)'));
      legenda.appendChild(item);
    });
    caixa.appendChild(legenda);
    return caixa;
  }

  function maisRepetida(st) {
    var melhor = st.frequencia[0];
    st.frequencia.forEach(function (f) { if (f.c > melhor.c) melhor = f; });
    var l = LC.lot(resultado.lotId);
    return LC.fmt(l, melhor.n) + ' (' + melhor.c + '×)';
  }

  function metrica(rot, val, sub) {
    var m = el('div', 'metrica');
    m.appendChild(el('span', 'metrica__rot', rot));
    m.appendChild(el('strong', 'metrica__val', String(val)));
    if (sub) m.appendChild(el('span', 'metrica__sub', sub));
    return m;
  }

  function histograma(valores, faixas) {
    if (!valores.length) return el('div');
    var min = valores[0], max = valores[valores.length - 1];
    var largura = Math.max(1, Math.ceil((max - min + 1) / faixas));
    var baldes = {};
    valores.forEach(function (v) {
      var b = Math.floor((v - min) / largura);
      baldes[b] = (baldes[b] || 0) + 1;
    });
    var maxC = 0;
    Object.keys(baldes).forEach(function (k) { if (baldes[k] > maxC) maxC = baldes[k]; });

    var caixa = el('div', 'barras');
    for (var b = 0; b <= Math.floor((max - min) / largura); b++) {
      var ini = min + b * largura;
      var fim = Math.min(max, ini + largura - 1);
      var c = baldes[b] || 0;
      caixa.appendChild(linhaBarra(ini === fim ? String(ini) : ini + '–' + fim, c, maxC, b));
    }
    return caixa;
  }

  function barrasMapa(mapa, total, rotulo) {
    var chaves = Object.keys(mapa).sort(function (a, b) { return Number(a) - Number(b); });
    var maxC = 0;
    chaves.forEach(function (k) { if (mapa[k] > maxC) maxC = mapa[k]; });
    var caixa = el('div', 'barras');
    chaves.forEach(function (k, i) {
      caixa.appendChild(linhaBarra(rotulo(k), mapa[k], maxC, i));
    });
    return caixa;
  }

  function linhaBarra(rot, valor, max, i) {
    var linha = el('div', 'barra-linha');
    linha.appendChild(el('span', 'barra-linha__rot', rot));
    var trilho = el('div', 'barra-linha__trilho');
    var preen = el('div', 'barra-linha__preen');
    preen.style.width = (max ? (valor / max) * 100 : 0) + '%';
    preen.style.animationDelay = (i * 26) + 'ms';
    trilho.appendChild(preen);
    linha.appendChild(trilho);
    linha.appendChild(el('span', 'barra-linha__val', String(valor)));
    return linha;
  }

  /* ======================================================================
     CONFERIDOR
     ==================================================================== */

  function renderEntradaResultado() {
    var l = lot();
    var alvo = $('#entradaResultado');
    limpar(alvo);
    var caixa = el('div', 'entrada-res');

    if (l.tipo === 'bilhete') {
      caixa.appendChild(campoTexto('Bilhete sorteado', 'resBilhete', 'ex.: 04812'));
      $('#ajudaConferidor').textContent = 'Informe o número do bilhete premiado. O conferidor mostra quantos algarismos finais batem.';
    } else if (l.tipo === 'colunas') {
      caixa.appendChild(campoTexto('Algarismo de cada coluna', 'resColunas', 'ex.: 3 7 0 1 9 4 2'));
      $('#ajudaConferidor').textContent = 'Informe os 7 algarismos sorteados, um por coluna, na ordem.';
    } else if (l.tipo === 'placares') {
      $('#ajudaConferidor').textContent = 'Marque o resultado de cada uma das 14 partidas.';
      var lista = el('div', 'loteca-lista');
      for (var j = 0; j < l.jogos; j++) {
        (function (idx) {
          var linha = el('div', 'loteca-linha');
          linha.appendChild(el('span', 'loteca-linha__n', String(idx + 1).padStart(2, '0')));
          var marcas = el('div', 'loteca-marcas');
          l.simbolos.forEach(function (s) {
            var b = el('button', 'dez', s);
            b.type = 'button';
            b.dataset.jogo = idx;
            b.dataset.simbolo = s;
            b.addEventListener('click', function () {
              $$('[data-jogo="' + idx + '"]', alvo).forEach(function (o) { o.classList.remove('is-fixa'); });
              b.classList.add('is-fixa');
            });
            marcas.appendChild(b);
          });
          linha.appendChild(marcas);
          lista.appendChild(linha);
        })(j);
      }
      caixa.appendChild(lista);
    } else {
      caixa.appendChild(campoTexto('Dezenas sorteadas', 'resDezenas',
        'ex.: ' + exemploDezenas(l)));
      $('#ajudaConferidor').textContent = 'Cole ou digite as ' + l.sorteadas +
        ' dezenas sorteadas, separadas por espaço, vírgula ou traço.';
      if (l.sorteios === 2) {
        caixa.appendChild(campoTexto('Dezenas do 2º sorteio', 'resDezenas2',
          'opcional · ex.: ' + exemploDezenas(l)));
      }
      if (l.extra && l.extra.tipo === 'dezenas') {
        caixa.appendChild(campoTexto('Trevos sorteados', 'resTrevos', 'ex.: 2 5'));
      }
      if (l.extra && l.extra.tipo === 'lista') {
        var c = el('div', 'entrada-res__campo');
        c.appendChild(el('span', 'entrada-res__rot', l.extra.nome));
        var sel = el('select');
        sel.id = 'resExtra';
        sel.appendChild(el('option', null, '— não conferir —'));
        l.extra.opcoes.forEach(function (o) {
          var op = el('option', null, o);
          op.value = o;
          sel.appendChild(op);
        });
        c.appendChild(sel);
        caixa.appendChild(c);
      }
    }

    alvo.appendChild(caixa);
    oficialConferido = null;
    limpar($('#notaOficial'));
  }

  function exemploDezenas(l) {
    var out = [], passo = Math.max(1, Math.floor((l.max - l.min) / (l.sorteadas + 1)));
    for (var i = 0; i < Math.min(l.sorteadas, 8); i++) out.push(LC.fmt(l, l.min + passo * (i + 1)));
    return out.join(' ');
  }

  function campoTexto(rotulo, id, ph) {
    var c = el('div', 'entrada-res__campo');
    var r = el('label', 'entrada-res__rot', rotulo);
    r.setAttribute('for', id);
    c.appendChild(r);
    var i = el('input');
    i.type = 'text'; i.id = id; i.placeholder = ph; i.autocomplete = 'off'; i.spellcheck = false;
    c.appendChild(i);
    return c;
  }

  function conferir() {
    if (!resultado || !resultado.jogos.length) {
      toast('Gere alguns jogos antes de conferir.', 'erro');
      return;
    }
    var l = LC.lot(resultado.lotId);
    if (l.id !== estado.lotId) {
      toast('Os jogos gerados são de outra modalidade. Gere de novo antes de conferir.', 'erro');
      return;
    }

    var res = {};
    if (l.tipo === 'bilhete') {
      res.bilhete = ($('#resBilhete') || {}).value || '';
      if (!res.bilhete.trim()) return toast('Informe o bilhete sorteado.', 'erro');
    } else if (l.tipo === 'colunas') {
      var ns = LC.numerosDoTexto(($('#resColunas') || {}).value || '');
      var digitos = (($('#resColunas') || {}).value || '').replace(/\D/g, '').split('').map(Number);
      res.colunas = ns.length === l.colunas ? ns : digitos.slice(0, l.colunas);
      if (res.colunas.length !== l.colunas) {
        return toast('Informe os ' + l.colunas + ' algarismos sorteados.', 'erro');
      }
    } else if (l.tipo === 'placares') {
      res.placares = [];
      for (var j = 0; j < l.jogos; j++) {
        var marcado = $('[data-jogo="' + j + '"].is-fixa', $('#entradaResultado'));
        res.placares.push(marcado ? marcado.dataset.simbolo : null);
      }
      if (res.placares.filter(Boolean).length === 0) {
        return toast('Marque ao menos um resultado.', 'erro');
      }
    } else {
      res.dezenas = LC.numerosDoTexto(($('#resDezenas') || {}).value || '')
        .filter(function (n) { return n >= l.min && n <= l.max; });
      if (!res.dezenas.length) return toast('Informe as dezenas sorteadas.', 'erro');
      if (res.dezenas.length !== l.sorteadas) {
        toast('Você informou ' + res.dezenas.length + ' dezenas; o ' + l.nome + ' sorteia ' + l.sorteadas + '.', 'alerta');
      }
      if ($('#resDezenas2')) {
        var d2 = LC.numerosDoTexto($('#resDezenas2').value || '')
          .filter(function (n) { return n >= l.min && n <= l.max; });
        if (d2.length) res.dezenas2 = d2;
      }
      if ($('#resTrevos')) {
        res.trevos = LC.numerosDoTexto($('#resTrevos').value || '');
      }
      if ($('#resExtra') && $('#resExtra').value) res.extra = $('#resExtra').value;
    }

    conferencia = LC.conferir(l, resultado.jogos, res);
    conferencia.resultado = res;
    aplicarRateio(l, res);
    renderConferencia(l);
    renderJogos();
    toast('Conferência pronta: ' + conferencia.premiados + ' ' +
      (conferencia.premiados === 1 ? 'jogo premiado' : 'jogos premiados') + '.',
      conferencia.premiados ? 'ok' : null);
  }

  function renderConferencia(l) {
    var alvo = $('#resultadoConferencia');
    limpar(alvo);
    if (!conferencia) return;

    var cartao = el('div', 'cartao');
    cartao.appendChild(el('h3', 'cartao__titulo', 'Resultado da conferência'));

    var grade = el('div', 'metricas-grade');
    grade.appendChild(metrica('Jogos conferidos', conferencia.totalJogos));
    grade.appendChild(metrica('Premiados', conferencia.premiados,
      conferencia.premiados ? 'dentro de alguma faixa' : 'nenhuma faixa atingida'));
    grade.appendChild(metrica('Melhor jogo', conferencia.melhor + ' acertos'));
    if (conferencia.totalPremios != null) {
      grade.appendChild(metrica('Prêmios', LC.moeda(conferencia.totalPremios), 'valor bruto, antes do IR'));
      var saldo = conferencia.totalPremios - conferencia.custoLote;
      grade.appendChild(metrica('Saldo do lote', (saldo >= 0 ? '+' : '−') + LC.moeda(Math.abs(saldo)),
        'prêmios menos ' + LC.moeda(conferencia.custoLote) + ' de custo'));
    }
    cartao.appendChild(grade);
    if (conferencia.oficial) {
      cartao.appendChild(el('div', 'cartao__texto',
        'Rateio oficial do concurso ' + conferencia.oficial.concurso + ' (' + conferencia.oficial.data + '). ' +
        'Apostas com mais dezenas recebem por todas as apostas simples que contêm.'));
    }

    var nomes = Object.keys(conferencia.porFaixa);
    if (nomes.length) {
      var tab = el('table', 'tabela');
      var thead = el('thead');
      var tr = el('tr');
      tr.appendChild(el('th', null, 'Faixa'));
      tr.appendChild(el('th', null, 'Jogos'));
      thead.appendChild(tr);
      tab.appendChild(thead);
      var tb = el('tbody');
      nomes.forEach(function (n) {
        var linha = el('tr');
        linha.appendChild(el('td', null, n));
        linha.appendChild(el('td', null, String(conferencia.porFaixa[n])));
        tb.appendChild(linha);
      });
      tab.appendChild(tb);
      var rolagem = el('div', 'tabela-rolagem');
      rolagem.appendChild(tab);
      cartao.appendChild(rolagem);
    } else if (!conferencia.totalPremios) {
      cartao.appendChild(el('div', 'nota', 'Nenhum jogo atingiu faixa de premiação neste concurso.'));
    }

    var itens = {};
    conferencia.linhas.forEach(function (linha) {
      ((linha.premio && linha.premio.itens) || []).forEach(function (it) {
        var a = itens[it.nome] || (itens[it.nome] = { qtd: 0, unitario: it.unitario, valor: 0 });
        a.qtd += it.qtd;
        a.valor += it.valor;
      });
    });
    var nomesPremio = Object.keys(itens);
    if (nomesPremio.length) {
      var tabP = el('table', 'tabela');
      var thP = el('tr');
      ['Prêmio', 'Apostas simples', 'Valor unitário', 'Total'].forEach(function (t) { thP.appendChild(el('th', null, t)); });
      var theadP = el('thead');
      theadP.appendChild(thP);
      tabP.appendChild(theadP);
      var tbP = el('tbody');
      nomesPremio.forEach(function (n) {
        var trP = el('tr');
        trP.appendChild(el('td', null, n));
        trP.appendChild(el('td', 'num', String(itens[n].qtd)));
        trP.appendChild(el('td', 'num', itens[n].unitario ? LC.moeda(itens[n].unitario) : 'acumulou — sem rateio'));
        trP.appendChild(el('td', 'num', LC.moeda(itens[n].valor)));
        tbP.appendChild(trP);
      });
      tabP.appendChild(tbP);
      var rolP = el('div', 'tabela-rolagem');
      rolP.appendChild(tabP);
      cartao.appendChild(rolP);
    }

    if (conferencia.resultado.dezenas) {
      var linhaD = el('div', 'lista-dezenas');
      conferencia.resultado.dezenas.slice().sort(function (a, b) { return a - b; }).forEach(function (n) {
        var p = el('span', 'pill');
        p.appendChild(el('b', null, LC.fmt(l, n)));
        linhaD.appendChild(p);
      });
      cartao.appendChild(el('div', 'cartao__texto', 'Dezenas conferidas:'));
      cartao.appendChild(linhaD);
    }

    alvo.appendChild(cartao);
  }

  /* ---- resultado oficial no conferidor ----------------------------------- */

  /** Com o rateio do concurso, calcula quanto cada jogo recebe em reais. */
  function aplicarRateio(l, res) {
    if (!oficialConferido || oficialConferido.lotId !== l.id) return;
    var comRateio = Object.assign({}, res, { rateio: oficialConferido.rateio });
    var total = 0, premiados = 0, algum = false;
    conferencia.linhas.forEach(function (linha) {
      linha.premio = LC.valor.premioDoJogo(l, linha.jogo, comRateio);
      if (linha.premio) {
        algum = true;
        total += linha.premio.total;
      }
      if (linha.faixa || (linha.premio && linha.premio.total > 0)) premiados++;
    });
    if (!algum) return;
    conferencia.premiados = premiados;
    conferencia.totalPremios = total;
    conferencia.custoLote = resultado.custo;
    conferencia.oficial = { concurso: oficialConferido.concurso, data: oficialConferido.data };
  }

  function buscarResultadoOficial() {
    var l = lot();
    var numero = parseInt(($('#inConcurso') || {}).value, 10) || null;
    var btn = $('#btnBuscarResultado');
    btn.disabled = true;
    btn.textContent = 'Buscando…';

    LC.resultados.buscarConcurso(l, numero).then(function (r) {
      if (estado.lotId !== l.id) return;
      preencherResultado(l, r);
      oficialConferido = r;
      var nota = $('#notaOficial');
      limpar(nota);
      var texto = 'Concurso ' + r.concurso + ' · ' + r.data + ' — ' + fonteTexto(r) + '. ';
      texto += l.tipo === 'bilhete'
        ? 'O conferidor compara seus palpites com o 1º prêmio; os cinco bilhetes premiados estão abaixo.'
        : 'Com o rateio oficial, a conferência mostra quanto cada jogo recebe.';
      nota.appendChild(el('div', 'nota nota--ok', texto));
      if (l.tipo === 'bilhete' && r.bilhetes) {
        var lista = el('div', 'lista-dezenas');
        r.bilhetes.forEach(function (b, i) {
          var p = el('span', 'pill');
          p.appendChild(document.createTextNode((i + 1) + 'º '));
          p.appendChild(el('b', null, b));
          lista.appendChild(p);
        });
        nota.appendChild(lista);
      }
      if (resultado && resultado.jogos.length && resultado.lotId === l.id) conferir();
      else toast('Resultado do concurso ' + r.concurso + ' carregado.', 'ok');
    }, function () {
      toast('Não consegui buscar o resultado' + (numero ? ' do concurso ' + numero : '') +
        '. Confira a conexão ou digite o resultado à mão.', 'erro');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Buscar resultado oficial';
    });
  }

  function preencherResultado(l, r) {
    var alvo = $('#entradaResultado');
    if (l.tipo === 'bilhete') {
      $('#resBilhete').value = (r.bilhetes || [])[0] || '';
    } else if (l.tipo === 'colunas') {
      $('#resColunas').value = (r.colunas || []).join(' ');
    } else if (l.tipo === 'placares') {
      $$('.dez', alvo).forEach(function (b) { b.classList.remove('is-fixa'); });
      (r.placares || []).forEach(function (s, i) {
        var b = s && $('[data-jogo="' + i + '"][data-simbolo="' + s + '"]', alvo);
        if (b) b.classList.add('is-fixa');
      });
    } else {
      $('#resDezenas').value = (r.dezenas || []).map(function (n) { return LC.fmt(l, n); }).join(' ');
      if ($('#resDezenas2')) $('#resDezenas2').value = (r.dezenas2 || []).map(function (n) { return LC.fmt(l, n); }).join(' ');
      if ($('#resTrevos')) $('#resTrevos').value = (r.trevos || []).join(' ');
      if ($('#resExtra')) {
        var sel = $('#resExtra');
        sel.value = r.extra || '';
        if (sel.value !== (r.extra || '')) sel.selectedIndex = 0;
      }
    }
  }

  /** Se a pessoa mexe no resultado depois de buscar, o rateio deixa de valer. */
  function invalidarOficial() {
    if (!oficialConferido) return;
    oficialConferido = null;
    limpar($('#notaOficial'));
    $('#notaOficial').appendChild(el('div', 'nota nota--alerta',
      'Resultado editado à mão: a conferência volta a mostrar só as faixas, sem valores.'));
  }

  function fonteTexto(r) {
    if (r.fonte === 'cache') {
      if (!r.cacheEm) return 'guardado neste navegador';
      return (r.offline ? 'sem conexão — ' : '') + 'consultado às ' +
        new Date(r.cacheEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    return 'fonte: ' + LC.resultados.nomeFonte(r.fonte);
  }

  /* ======================================================================
     PRÊMIOS — concurso atual e valor esperado
     ==================================================================== */

  function fmtChance(p) {
    if (!p) return '—';
    var inv = 1 / p;
    return '1 em ' + inv.toLocaleString('pt-BR', { maximumFractionDigits: inv < 10 ? 1 : 0 });
  }

  function fmtPct(x) {
    return (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  function fmtInteiro(x) {
    return Math.round(x).toLocaleString('pt-BR');
  }

  /** Moeda sem centavos a partir de mil reais — para os cartões de destaque. */
  function reais(v) {
    return v >= 1000 ? 'R$ ' + fmtInteiro(v) : LC.moeda(v);
  }

  /** "38.000.000", "1.234,56" ou "1234.56" → número. Vazio → null. */
  function lerValorBR(txt) {
    txt = String(txt || '').replace(/[R$\s]/g, '');
    if (!txt) return null;
    if (txt.indexOf(',') !== -1) txt = txt.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(txt)) txt = txt.replace(/\./g, '');
    var n = parseFloat(txt);
    return isNaN(n) || n < 0 ? null : n;
  }

  function abrirPremios() {
    var l = lot();
    var o = oficial[l.id];
    var alvo = LC.valor.suporta(l) ? estado.premios.amostra : 1;
    if (!o || (!o.carregando && (!o.ultimo || o.n < alvo))) carregarOficial(false);
    else renderPremios();
  }

  function carregarOficial(forcar) {
    var l = lot();
    var o = oficial[l.id] || (oficial[l.id] = {});
    if (o.carregando) return;
    var n = LC.valor.suporta(l) ? estado.premios.amostra : 1;
    o.carregando = true;
    o.erro = null;
    renderPremios();

    LC.resultados.buscarRecentes(l, n, function (feitos, total) {
      var p = $('#progPremios');
      if (p) p.textContent = 'Buscando concursos… ' + feitos + ' de ' + total;
    }, { forcar: forcar }).then(function (lista) {
      o.ultimo = lista.ultimo;
      o.amostra = lista;
      o.n = n;
      o.falhas = lista.falhas;
    }, function () {
      o.erro = 'Não consegui falar com a CAIXA nem com o espelho comunitário. Verifique a conexão e tente de novo.';
    }).then(function () {
      o.carregando = false;
      if (estado.lotId === l.id && abaAtual === 'premios') renderPremios();
    });
  }

  function renderPremios() {
    var alvo = $('#conteudoPremios');
    if (!alvo) return;
    limpar(alvo);
    var l = lot();
    var o = oficial[l.id] || {};

    if (!o.ultimo) {
      var c = el('div', 'cartao');
      c.appendChild(el('h3', 'cartao__titulo', 'Prêmios da ' + l.nome));
      if (o.erro) {
        c.appendChild(el('div', 'nota nota--erro', o.erro));
        var b = el('button', 'btn btn--principal', 'Tentar de novo');
        b.type = 'button';
        b.dataset.acao = 'atualizar-premios';
        c.appendChild(b);
      } else {
        var p = el('p', 'cartao__texto', 'Buscando concursos…');
        p.id = 'progPremios';
        c.appendChild(p);
      }
      alvo.appendChild(c);
      return;
    }

    var u = o.ultimo;
    alvo.appendChild(cartaoUltimo(l, u, o));
    if (u.proximo && u.proximo.estimativa) alvo.appendChild(cartaoProximo(l, u));

    if (!LC.valor.suporta(l)) {
      alvo.appendChild(el('div', 'nota',
        l.tipo === 'placares'
          ? 'Valor esperado não se aplica à Loteca: as chances dependem de partidas reais, não de um sorteio equiprovável. O conferidor já calcula quanto cada aposta recebe com o rateio oficial.'
          : 'Valor esperado não se aplica à Loteria Federal: os bilhetes são vendidos em frações, com prêmios fixos por extração e sem rateio entre apostadores.'));
      return;
    }

    var ev = LC.valor.valorEsperado(l, {
      ultimo: u,
      amostra: o.amostra,
      dividir: estado.premios.dividir,
      ir: estado.premios.ir,
      limiteIR: estado.premios.limiteIR,
      apostas: ajustesEV.apostas,
      principal: ajustesEV.principal,
      manual: ajustesEV.manual
    });
    alvo.appendChild(cartaoValorEsperado(l, ev, o));
    var lote = cartaoLote(l, ev);
    if (lote) alvo.appendChild(lote);
    alvo.appendChild(cartaoRecentes(o.amostra));
  }

  function numerosDoConcurso(l, u) {
    var caixa = el('div', 'res-numeros');
    function linha(rot, itens) {
      if (!itens || !itens.length) return;
      var w = el('div', 'res-numeros__linha');
      if (rot) w.appendChild(el('span', 'res-numeros__rot', rot));
      var bolas = el('div', 'bolas');
      itens.forEach(function (t, i) {
        var b = el('div', 'bola', t);
        b.style.setProperty('--j', Math.min(i, 24));
        bolas.appendChild(b);
      });
      w.appendChild(bolas);
      caixa.appendChild(w);
    }
    var fmt = function (n) { return LC.fmt(l, n); };

    if (l.tipo === 'colunas') {
      linha(null, (u.colunas || []).map(String));
    } else if (l.tipo === 'placares') {
      var lista = el('div', 'res-partidas');
      (u.partidas || []).forEach(function (p, i) {
        var li = el('div', 'res-partidas__item');
        li.appendChild(el('b', null, String(i + 1).padStart(2, '0') + ' · ' + (u.placares[i] || '?')));
        li.appendChild(document.createTextNode(' ' + p));
        lista.appendChild(li);
      });
      caixa.appendChild(lista);
    } else if (l.tipo === 'bilhete') {
      var bl = el('div', 'lista-dezenas');
      (u.bilhetes || []).forEach(function (b, i) {
        var p = el('span', 'pill');
        p.appendChild(document.createTextNode((i + 1) + 'º prêmio '));
        p.appendChild(el('b', null, b));
        bl.appendChild(p);
      });
      caixa.appendChild(bl);
    } else {
      linha(u.dezenas2 ? '1º sorteio' : null, (u.dezenas || []).map(fmt));
      linha('2º sorteio', (u.dezenas2 || []).map(fmt));
      linha('trevos', (u.trevos || []).map(String));
      if (u.extra) {
        var ex = el('div', 'res-numeros__linha');
        ex.appendChild(el('span', 'res-numeros__rot', l.extra.nome));
        ex.appendChild(el('span', 'cupom__extra', u.extra));
        caixa.appendChild(ex);
      }
    }
    return caixa;
  }

  function cartaoUltimo(l, u, o) {
    var c = el('div', 'cartao');
    var topo = el('div', 'cartao__topo');
    topo.appendChild(el('h3', 'cartao__titulo', 'Concurso ' + u.concurso + ' · ' + u.data));
    if (l.tipo !== 'bilhete') {
      topo.appendChild(el('span', 'selo ' + (u.acumulou ? 'selo--alerta' : 'selo--ok'),
        u.acumulou ? 'acumulou' : 'saiu o prêmio principal'));
    }
    c.appendChild(topo);
    c.appendChild(numerosDoConcurso(l, u));

    var probs = LC.valor.suporta(l) ? LC.valor.probSimples(l) : null;
    var apostas = probs && u.arrecadado ? u.arrecadado / l.preco : 0;

    var tab = el('table', 'tabela');
    var th = el('tr');
    ['Faixa', 'Ganhadores', 'Prêmio'].forEach(function (t) { th.appendChild(el('th', null, t)); });
    if (apostas) {
      var thE = el('th', null, 'Esperados');
      thE.title = 'Ganhadores que a matemática prevê para a arrecadação deste concurso — um jeito de conferir as chances.';
      th.appendChild(thE);
    }
    var thead = el('thead');
    thead.appendChild(th);
    tab.appendChild(thead);
    var tb = el('tbody');
    // nomes do app quando casam com o rateio (a API repete "6 acertos" nos dois sorteios da Dupla)
    var est = LC.valor.estrutura(l);
    var nomes = est.length === (u.rateio || []).length ? est.map(function (f) { return f.nome; }) : [];
    (u.rateio || []).forEach(function (r, i) {
      var tr = el('tr');
      tr.appendChild(el('td', null, nomes[i] || r.descricao));
      tr.appendChild(el('td', 'num', fmtInteiro(r.ganhadores)));
      tr.appendChild(el('td', 'num', r.ganhadores ? LC.moeda(r.valor) : '—'));
      if (apostas) tr.appendChild(el('td', 'num fraco', probs[i] != null ? fmtInteiro(apostas * probs[i]) : ''));
      tb.appendChild(tr);
    });
    tab.appendChild(tb);
    var rol = el('div', 'tabela-rolagem');
    rol.appendChild(tab);
    c.appendChild(rol);

    var rodape = el('div', 'cartao__rodape');
    var info = fonteTexto(u);
    if (u.arrecadado) info += ' · arrecadação ' + LC.moeda(u.arrecadado);
    if (o.falhas) info += ' · ' + o.falhas + ' concursos da amostra não responderam';
    rodape.appendChild(el('span', null, info));
    var b = el('button', 'btn btn--fino', o.carregando ? 'Atualizando…' : 'Atualizar');
    b.type = 'button';
    b.dataset.acao = 'atualizar-premios';
    b.disabled = !!o.carregando;
    rodape.appendChild(b);
    c.appendChild(rodape);
    return c;
  }

  function cartaoProximo(l, u) {
    var c = el('div', 'cartao cartao--destaque');
    c.appendChild(el('h3', 'cartao__titulo', 'Próximo concurso'));
    var g = el('div', 'metricas-grade');
    g.appendChild(metrica('Concurso', u.proximo.concurso, u.proximo.data || 'data a confirmar'));
    g.appendChild(metrica('Prêmio estimado', reais(u.proximo.estimativa), 'faixa principal'));
    if (u.proximo.acumulado) {
      g.appendChild(metrica('Já acumulado', reais(u.proximo.acumulado), 'entra no prêmio principal'));
    }
    if (u.especial) {
      g.appendChild(metrica('Reserva para concurso especial', reais(u.especial)));
    }
    c.appendChild(g);
    return c;
  }

  function cartaoValorEsperado(l, ev, o) {
    var c = el('div', 'cartao');
    c.appendChild(el('h3', 'cartao__titulo', 'Valor esperado no concurso ' + o.ultimo.proximo.concurso));

    // a aposta montada no passo 1
    var formato = l.tipo === 'colunas'
      ? { lens: formatoSuperSete(l) }
      : { k: dezenasAtual(), kt: l.extra && l.extra.tipo === 'dezenas' ? ((estado.extras || {}).trevosQtd || l.extra.padrao) : 0 };
    var custoAposta = l.tipo === 'colunas'
      ? formato.lens.reduce(function (a, b) { return a * b; }, 1) * l.preco
      : LC.custoPrevisto(l, formato.k, formato.kt);
    var simples = custoAposta / l.preco;
    var chance = LC.valor.chanceAlgumPremio(l, formato);

    var g = el('div', 'metricas-grade');
    g.appendChild(metrica('Retorno esperado', fmtPct(ev.retorno),
      'de cada R$ 100 apostados, voltam ' + LC.moeda(ev.retorno * 100)));
    g.appendChild(metrica('Sua aposta vale', LC.moeda(ev.ev * simples),
      'custa ' + LC.moeda(custoAposta) + ' · ' + descricaoAposta(l, formato)));
    g.appendChild(metrica('Chance de algum prêmio', fmtChance(chance), 'com ' + descricaoAposta(l, formato)));
    if (ev.empate) {
      g.appendChild(metrica('Prêmio que empataria', reais(ev.empate),
        estado.premios.dividir ? 'contando a divisão: ' + reais(ev.empateComDivisao) : 'sem contar divisão'));
    }
    c.appendChild(g);

    c.appendChild(barraRetorno(ev));

    // ajustes
    var aj = el('div', 'ev-ajustes');
    aj.appendChild(alternadorEV('Considerar que o prêmio principal pode ser dividido', 'dividir'));

    var irLinha = el('div', 'ev-ajustes__linha');
    irLinha.appendChild(alternadorEV('Descontar 30% de IR dos prêmios acima de', 'ir'));
    var inIR = inputEV(estado.premios.limiteIR.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 'Limite de isenção do IR');
    inIR.addEventListener('change', function () {
      var v = lerValorBR(inIR.value);
      if (v != null) estado.premios.limiteIR = v;
      salvar();
      renderPremios();
    });
    irLinha.appendChild(inIR);
    aj.appendChild(irLinha);

    var apLinha = el('label', 'ev-ajustes__linha');
    apLinha.appendChild(el('span', null, 'Apostas simples no próximo concurso'));
    var inAp = inputEV(ajustesEV.apostas ? fmtInteiro(ajustesEV.apostas) : '', 'Apostas simples no próximo concurso');
    inAp.placeholder = fmtInteiro(LC.valor.apostasEstimadas(l, o.ultimo));
    inAp.title = 'Estimado pelos ganhadores da faixa mais baixa do último concurso. Concursos acumulados costumam vender mais.';
    inAp.addEventListener('change', function () {
      ajustesEV.apostas = lerValorBR(inAp.value);
      renderPremios();
    });
    apLinha.appendChild(inAp);
    aj.appendChild(apLinha);

    var amLinha = el('label', 'ev-ajustes__linha');
    amLinha.appendChild(el('span', null, 'Média das outras faixas sobre'));
    var sel = el('select', 'ev-input');
    [10, 20, 50, 100].forEach(function (n) {
      var op = el('option', null, 'últimos ' + n + ' concursos');
      op.value = n;
      if (n === estado.premios.amostra) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', function () {
      estado.premios.amostra = Number(sel.value);
      salvar();
      carregarOficial(false);
    });
    amLinha.appendChild(sel);
    aj.appendChild(amLinha);
    c.appendChild(aj);

    // faixa a faixa
    var tab = el('table', 'tabela');
    var th = el('tr');
    [['Faixa'], ['Chance', 'numa aposta simples'], ['Prêmio considerado', 'valor bruto — edite para simular'],
     ['Origem'], ['Você recebe', 'depois da divisão esperada e do IR'], ['Vale por aposta', 'chance × o que você recebe']]
      .forEach(function (t) {
        var h = el('th', null, t[0]);
        if (t[1]) h.title = t[1];
        th.appendChild(h);
      });
    var thead = el('thead');
    thead.appendChild(th);
    tab.appendChild(thead);
    var tb = el('tbody');
    ev.linhas.forEach(function (lin) {
      var tr = el('tr');
      if (lin.base === 'sem-dados') tr.className = 'fraco';
      tr.appendChild(el('td', null, lin.nome));
      tr.appendChild(el('td', 'num', fmtChance(lin.p)));

      var td = el('td', 'num');
      var inp = inputEV(lin.bruto ? lin.bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
        'Prêmio considerado para ' + lin.nome);
      inp.classList.add('ev-input--premio');
      inp.placeholder = 'informe';
      inp.addEventListener('change', function () {
        var v = lerValorBR(inp.value);
        if (lin.i === 0) ajustesEV.principal = v;
        else if (v == null) delete ajustesEV.manual[lin.i];
        else ajustesEV.manual[lin.i] = v;
        renderPremios();
      });
      td.appendChild(inp);
      tr.appendChild(td);

      tr.appendChild(el('td', 'fraco', {
        estimativa: 'estimativa CAIXA',
        media: 'média de ' + lin.amostraPagos + ' concurso' + (lin.amostraPagos === 1 ? '' : 's'),
        fixo: 'valor fixo',
        manual: 'digitado',
        'sem-dados': 'sem ganhadores recentes'
      }[lin.base]));

      var notas = [];
      if (lin.divisor < 0.995) notas.push('divisão ×' + lin.divisor.toFixed(2).replace('.', ','));
      if (lin.taxado) notas.push('IR');
      var tdR = el('td', 'num', LC.moeda(lin.liquido));
      if (notas.length) tdR.appendChild(el('span', 'ev-nota', notas.join(' · ')));
      tr.appendChild(tdR);
      tr.appendChild(el('td', 'num', LC.moeda(lin.contribuicao)));
      tb.appendChild(tr);
    });
    var tot = el('tr', 'tabela__total');
    tot.appendChild(el('td', null, 'Total'));
    var tdTot = el('td', 'num fraco', 'uma aposta simples custa ' + LC.moeda(l.preco));
    tdTot.colSpan = 4;
    tot.appendChild(tdTot);
    tot.appendChild(el('td', 'num', LC.moeda(ev.ev)));
    tb.appendChild(tot);
    tab.appendChild(tb);
    var rol = el('div', 'tabela-rolagem');
    rol.appendChild(tab);
    c.appendChild(rol);

    c.appendChild(el('p', 'cartao__texto',
      'O prêmio principal usa a estimativa divulgada para o próximo concurso; as outras faixas, a média paga por ganhador ' +
      'nos concursos recentes. Apostar mais dezenas não muda o retorno por real: uma aposta que vale 7 simples custa 7 vezes mais e rende 7 vezes mais. ' +
      'São valores de referência — o rateio real só sai depois do sorteio.'));
    return c;
  }

  function inputEV(valor, rotulo) {
    var i = el('input', 'ev-input');
    i.type = 'text';
    i.inputMode = 'decimal';
    i.value = valor;
    i.setAttribute('aria-label', rotulo);
    return i;
  }

  function formatoSuperSete(l) {
    var fix = estado.ssFixas || {};
    var k = dezenasAtual();
    var lens = [];
    for (var c = 0; c < l.colunas; c++) lens.push(Math.max((fix[c] || []).length, Math.min(k, l.escolhaMax)));
    return lens;
  }

  function descricaoAposta(l, f) {
    if (l.tipo === 'colunas') return f.lens.join('·') + ' algarismos por coluna';
    var t = f.k + ' dezenas';
    if (f.kt) t += ' + ' + f.kt + ' trevos';
    return t;
  }

  function alternadorEV(rot, chave) {
    var lab = el('label', 'alternador');
    var cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!estado.premios[chave];
    cb.addEventListener('change', function () {
      estado.premios[chave] = cb.checked;
      salvar();
      renderPremios();
    });
    lab.appendChild(cb);
    lab.appendChild(el('span', null, rot));
    return lab;
  }

  /** O preço da aposta como uma barra: a parte colorida é o que volta, faixa a faixa. */
  function barraRetorno(ev) {
    var caixa = el('div', 'ev-barra');
    var trilho = el('div', 'ev-barra__trilho');
    trilho.setAttribute('role', 'img');
    trilho.setAttribute('aria-label', 'Do preço da aposta, ' + fmtPct(ev.retorno) + ' volta em prêmios esperados');
    var positivas = ev.linhas.filter(function (x) { return x.contribuicao > 0; });
    var tom = function (i) { return (1 - i / Math.max(positivas.length, 1) * 0.7).toFixed(2); };
    positivas.forEach(function (lin, i) {
      var s = el('div', 'ev-barra__seg');
      s.style.width = Math.min(100, lin.contribuicao / ev.preco * 100) + '%';
      s.style.setProperty('--a', tom(i));
      s.title = lin.nome + ': ' + LC.moeda(lin.contribuicao / ev.preco * 100) + ' a cada R$ 100';
      trilho.appendChild(s);
    });
    caixa.appendChild(trilho);

    var leg = el('div', 'ev-barra__legenda');
    positivas.forEach(function (lin, i) {
      var item = el('span', 'ev-barra__item');
      var cor = el('i');
      cor.style.setProperty('--a', tom(i));
      item.appendChild(cor);
      item.appendChild(document.createTextNode(lin.nome + ' ' + LC.moeda(lin.contribuicao / ev.preco * 100)));
      leg.appendChild(item);
    });
    var resto = el('span', 'ev-barra__item ev-barra__item--resto');
    resto.appendChild(el('i'));
    resto.appendChild(document.createTextNode('não volta ' + LC.moeda(Math.max(0, 100 - ev.retorno * 100))));
    leg.appendChild(resto);
    caixa.appendChild(el('span', 'ev-barra__rot', 'Para onde vão R$ 100 apostados'));
    caixa.appendChild(leg);
    return caixa;
  }

  function cartaoLote(l, ev) {
    if (!resultado || !resultado.jogos.length || resultado.lotId !== l.id) return null;
    var nenhum = 1, memo = {};
    resultado.jogos.forEach(function (j) {
      var f = LC.valor.formatoDoJogo(l, j);
      var chave = JSON.stringify(f);
      if (!(chave in memo)) memo[chave] = LC.valor.chanceAlgumPremio(l, f) || 0;
      nenhum *= 1 - memo[chave];
    });
    var volta = resultado.custo * ev.retorno;

    var c = el('div', 'cartao');
    c.appendChild(el('h3', 'cartao__titulo', 'Seu lote de ' + resultado.jogos.length + (resultado.jogos.length === 1 ? ' jogo' : ' jogos')));
    var g = el('div', 'metricas-grade');
    g.appendChild(metrica('Custo', LC.moeda(resultado.custo)));
    g.appendChild(metrica('Volta em média', LC.moeda(volta)));
    g.appendChild(metrica('Perda esperada', LC.moeda(resultado.custo - volta)));
    g.appendChild(metrica('Chance de algum prêmio', '≈ ' + fmtPct(1 - nenhum), 'tratando os jogos como independentes'));
    c.appendChild(g);
    c.appendChild(el('p', 'cartao__texto',
      'Filtros, estratégias e fechamentos mudam como os acertos se espalham entre os jogos, mas não o valor esperado: ele depende só de quanto se aposta.'));
    return c;
  }

  function cartaoRecentes(amostra) {
    var c = el('div', 'cartao');
    c.appendChild(el('h3', 'cartao__titulo', 'Concursos recentes'));
    var tab = el('table', 'tabela');
    var th = el('tr');
    ['Concurso', 'Data', 'Ganhadores', 'Prêmio principal', 'Arrecadação'].forEach(function (t) { th.appendChild(el('th', null, t)); });
    var thead = el('thead');
    thead.appendChild(th);
    tab.appendChild(thead);
    var tb = el('tbody');
    amostra.slice(0, 15).forEach(function (r) {
      var f1 = (r.rateio || [])[0] || { ganhadores: 0, valor: 0 };
      var tr = el('tr');
      tr.appendChild(el('td', 'num', String(r.concurso)));
      tr.appendChild(el('td', null, r.data));
      tr.appendChild(el('td', 'num', f1.ganhadores ? fmtInteiro(f1.ganhadores) : 'acumulou'));
      tr.appendChild(el('td', 'num', f1.ganhadores ? LC.moeda(f1.valor) : '—'));
      tr.appendChild(el('td', 'num fraco', r.arrecadado ? LC.moeda(r.arrecadado) : '—'));
      tb.appendChild(tr);
    });
    tab.appendChild(tb);
    var rol = el('div', 'tabela-rolagem');
    rol.appendChild(tab);
    c.appendChild(rol);
    return c;
  }

  /* ---- histórico direto da CAIXA ---------------------------------------- */

  function baixarHistorico() {
    var l = lot();
    var n = Number($('#inQtdHistorico').value) || 100;
    var btn = $('#btnBaixarHistorico');
    btn.disabled = true;
    btn.textContent = 'Baixando…';
    LC.resultados.buscarRecentes(l, n, function (feitos, total) {
      btn.textContent = 'Baixando ' + feitos + ' de ' + total + '…';
    }).then(function (lista) {
      if (estado.lotId !== l.id) return;
      $('#inHistorico').value = lista.map(function (r) { return LC.resultados.linhaHistorico(l, r); })
        .filter(Boolean).join('\n');
      carregarHistorico();
      if (lista.falhas) toast(lista.falhas + ' concursos não responderam — baixe de novo para completar.', 'alerta');
    }, function () {
      toast('Não consegui baixar os concursos. Confira a conexão ou cole o histórico à mão.', 'erro');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Baixar concursos';
    });
  }

  /* ======================================================================
     HISTÓRICO
     ==================================================================== */

  function lerHistoricoSalvo() {
    var txt = estado.historicoTexto[estado.lotId] || '';
    historico = txt ? LC.lerHistorico(txt, lot()) : [];
  }

  function carregarHistorico() {
    var txt = $('#inHistorico').value;
    var l = lot();
    var lido = LC.lerHistorico(txt, l);
    if (!lido.length) {
      toast('Não encontrei nenhum concurso válido no texto colado.', 'erro');
      return;
    }
    estado.historicoTexto[l.id] = txt;
    historico = lido;
    salvar();
    renderResumoHistorico();
    renderFiltros();
    renderOpcoesEstrategia();
    toast(lido.length + ' concursos carregados.', 'ok');
  }

  function renderResumoHistorico() {
    var alvo = $('#resumoHistorico');
    limpar(alvo);
    if (!historico.length) return;

    var l = lot();
    var st = LC.estatisticasHistorico(l, historico);

    var cartao = el('div', 'cartao');
    cartao.appendChild(el('h3', 'cartao__titulo', 'O que o histórico mostra'));
    var grade = el('div', 'metricas-grade');
    grade.appendChild(metrica('Concursos', st.concursos));
    grade.appendChild(metrica('Mais sorteada', LC.fmt(l, st.quentes[0].n), st.quentes[0].freq + ' vezes'));
    grade.appendChild(metrica('Menos sorteada', LC.fmt(l, st.frios[0].n), st.frios[0].freq + ' vezes'));
    grade.appendChild(metrica('Maior atraso', LC.fmt(l, st.atrasadas[0].n), st.atrasadas[0].atraso + ' concursos'));
    cartao.appendChild(grade);

    var mapa = el('div', 'mapa-calor');
    mapa.style.setProperty('--grade', l.grade);
    var maxF = st.quentes[0].freq || 1;
    st.lista.forEach(function (d) {
      var razao = d.freq / maxF;
      var cel = el('div', 'calor' + (razao > 0.62 ? ' is-forte' : ''), LC.fmt(l, d.n));
      cel.style.setProperty('--a', (0.06 + razao * 0.94).toFixed(3));
      cel.title = LC.fmt(l, d.n) + ' — ' + d.freq + ' vezes · atraso ' + d.atraso;
      mapa.appendChild(cel);
    });
    cartao.appendChild(el('div', 'cartao__texto', 'Frequência por dezena (passe o mouse para ver atraso):'));
    cartao.appendChild(mapa);
    alvo.appendChild(cartao);

    var cartao2 = el('div', 'cartao');
    cartao2.appendChild(el('h3', 'cartao__titulo', 'Extremos'));
    ['quentes', 'frios', 'atrasadas'].forEach(function (chave) {
      var rot = { quentes: 'Mais sorteadas', frios: 'Menos sorteadas', atrasadas: 'Mais atrasadas' }[chave];
      cartao2.appendChild(el('div', 'cartao__texto', rot));
      var linha = el('div', 'lista-dezenas');
      st[chave].slice(0, 12).forEach(function (d) {
        var p = el('span', 'pill');
        p.appendChild(el('b', null, LC.fmt(l, d.n)));
        p.appendChild(document.createTextNode(' ' + (chave === 'atrasadas' ? d.atraso + 'c' : d.freq + '×')));
        linha.appendChild(p);
      });
      cartao2.appendChild(linha);
    });
    alvo.appendChild(cartao2);
  }

  /* ======================================================================
     FORJA — visualização da cadeia
     ==================================================================== */

  var forja = (function () {
    var cadeia = null;
    var rodando = false;
    var ultimoTempo = 0;
    var acumulado = 0;
    var quadro = null;
    var bits = new Uint8Array(128);
    var virados = new Uint8Array(128);
    var cores = {};
    var ultimoElo = null;
    var visivel = false;

    function lerCores() { cores = paleta(); }

    function rgba(alfa) { return 'rgba(' + cores.brandRgb.replace(/\s+/g, ',') + ',' + alfa + ')'; }

    function prepararTela(cv) {
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var w = cv.clientWidth || 600;
      var h = cv.clientHeight || 120;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      return { ctx: ctx, w: w, h: h };
    }

    function desenharBits() {
      var cv = $('#cvBits');
      if (!cv) return;
      var t = prepararTela(cv), ctx = t.ctx;
      var margemEsq = 20, colunas = 32, linhas = 4;
      var gap = 2;
      var cw = (t.w - margemEsq - gap * (colunas - 1)) / colunas;
      var ch = Math.min(cw, (t.h - 14 - gap * (linhas - 1)) / linhas);
      var topo = (t.h - (ch * linhas + gap * (linhas - 1))) / 2;

      cadeia.bits(bits);
      cadeia.bitsVirados(virados);

      var rotulos = ['A', 'B', 'C', 'D'];
      ctx.font = '600 9px ' + monoFamilia();
      ctx.textBaseline = 'middle';

      for (var r = 0; r < linhas; r++) {
        var y = topo + r * (ch + gap);
        ctx.fillStyle = cores.tinta3;
        ctx.fillText(rotulos[r], 2, y + ch / 2);
        for (var i = 0; i < colunas; i++) {
          var idx = r * 32 + i;
          var x = margemEsq + i * (cw + gap);
          var ligado = bits[idx] === 1;
          var mudou = virados[idx] === 1;
          ctx.fillStyle = ligado ? (mudou ? cores.brand : rgba(0.62)) : (mudou ? rgba(0.18) : cores.superficie3);
          arredondado(ctx, x, y, cw, ch, Math.min(2.5, cw / 3));
          ctx.fill();
          if (mudou) {
            ctx.strokeStyle = ligado ? cores.tinta : rgba(0.75);
            ctx.lineWidth = 1;
            arredondado(ctx, x + 0.5, y + 0.5, cw - 1, ch - 1, Math.min(2.5, cw / 3));
            ctx.stroke();
          }
        }
      }
    }

    function desenharAvalanche() {
      var cv = $('#cvAval');
      if (!cv) return;
      var t = prepararTela(cv), ctx = t.ctx;
      var hist = cadeia.hist;
      var padTopo = 8, padBase = 12, altura = t.h - padTopo - padBase;
      var maxBits = 128;

      function yDe(v) { return padTopo + altura * (1 - v / maxBits); }

      // zona de boa mistura (48–80 bits)
      ctx.fillStyle = rgba(0.09);
      ctx.fillRect(0, yDe(80), t.w, yDe(48) - yDe(80));

      // linha do ideal
      ctx.strokeStyle = cores.linhaForte;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, yDe(64));
      ctx.lineTo(t.w, yDe(64));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = cores.tinta3;
      ctx.font = '600 8px ' + monoFamilia();
      ctx.textBaseline = 'bottom';
      ctx.fillText('64', 2, yDe(64) - 2);

      if (!hist.length) return;

      // as barras crescem da direita para a esquerda: a volta mais nova fica na borda
      var n = hist.length;
      var janela = Math.max(n, 48);
      var larg = t.w / janela;
      var corpo = Math.max(1, larg - 1);
      function xDe(i) { return t.w - (n - i) * larg; }

      for (var i = 0; i < n; i++) {
        var y = yDe(hist[i]);
        ctx.fillStyle = (i === n - 1) ? cores.brand : rgba(0.3 + 0.45 * (i / n));
        ctx.fillRect(xDe(i), y, corpo, t.h - padBase - y);
      }

      ctx.strokeStyle = rgba(0.85);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var j = 0; j < n; j++) {
        var xx = xDe(j) + corpo / 2, yy = yDe(hist[j]);
        if (j === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }

    function desenharDistribuicao() {
      var cv = $('#cvDist');
      if (!cv) return;
      var t = prepararTela(cv), ctx = t.ctx;
      var l = lot();

      if (l.tipo !== 'dezenas') {
        ctx.fillStyle = cores.tinta3;
        ctx.font = '400 12px ' + corpoFamilia();
        ctx.textBaseline = 'middle';
        ctx.fillText('A curva vale para modalidades de dezenas.', 10, t.h / 2);
        $('#vizCurvaNota').textContent = '';
        return;
      }

      var uni = LC.universo(l);
      var p = cadeia.parametros();
      var pesos = cadeia.curva(uni, l, estado.cadeia.temperatura, p);
      var soma = pesos.reduce(function (a, b) { return a + b; }, 0);
      var maxP = Math.max.apply(null, pesos);

      var padBase = 14, padTopo = 8;
      var altura = t.h - padBase - padTopo;
      var larg = t.w / uni.length;
      var media = soma / uni.length;

      // linha da média (curva plana)
      var yMedia = padTopo + altura * (1 - media / maxP);
      ctx.strokeStyle = cores.linhaForte;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, yMedia);
      ctx.lineTo(t.w, yMedia);
      ctx.stroke();
      ctx.setLineDash([]);

      var destaque = {};
      if (ultimoElo) ultimoElo.dezenas.forEach(function (n) { destaque[n] = 1; });

      for (var i = 0; i < uni.length; i++) {
        var h = altura * (pesos[i] / maxP);
        var x = i * larg;
        var y = padTopo + altura - h;
        ctx.fillStyle = destaque[uni[i]] ? cores.brand : rgba(0.3);
        ctx.fillRect(x, y, Math.max(1, larg - 1), h);
        if (destaque[uni[i]]) {
          ctx.fillStyle = cores.brand;
          ctx.beginPath();
          ctx.arc(x + Math.max(1, larg - 1) / 2, y - 4, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // eixo
      ctx.fillStyle = cores.tinta3;
      ctx.font = '600 8px ' + monoFamilia();
      ctx.textBaseline = 'top';
      ctx.fillText(LC.fmt(l, l.min), 0, t.h - padBase + 3);
      var rotFim = LC.fmt(l, l.max);
      ctx.fillText(rotFim, t.w - ctx.measureText(rotFim).width, t.h - padBase + 3);

      $('#vizCurvaNota').textContent = ultimoElo
        ? 'as barras cheias são o último elo forjado'
        : 'a linha tracejada é a curva plana — temperatura zero';

      renderParams(p);
    }

    function renderParams(p) {
      var alvo = $('#forjaParams');
      if (!alvo) return;
      limpar(alvo);
      var l = lot();
      var itens = [
        ['centro', LC.fmt(l, Math.round(l.min + p.centro * (l.max - l.min)))],
        ['largura', p.largura.toFixed(2).replace('.', ',')],
        ['paridade', (p.paridade > 0 ? '+' : '') + p.paridade.toFixed(2).replace('.', ',')],
        ['ritmo', p.ritmo.toFixed(2).replace('.', ',')]
      ];
      itens.forEach(function (par) {
        var s = el('span', 'pill');
        s.appendChild(document.createTextNode(par[0] + ' '));
        s.appendChild(el('b', null, par[1]));
        alvo.appendChild(s);
      });
    }

    function arredondado(ctx, x, y, w, h, r) {
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function monoFamilia() { return "'Martian Mono', ui-monospace, Consolas, monospace"; }
    function corpoFamilia() { return "'Instrument Sans', system-ui, sans-serif"; }

    function atualizarMedidores() {
      $('#forjaHex').textContent = cadeia.hex().replace(/(.{8})/g, '$1 ').trim();
      $('#medVoltas').textContent = cadeia.voltas.toLocaleString('pt-BR');
      $('#medVirados').innerHTML = cadeia.virados + '<span class="medidor__de">/128</span>';
      var av = cadeia.avalanche();
      $('#medAval').textContent = av.toFixed(1).replace('.', ',');
      $('#medidorAvalanche').classList.toggle('is-bom', av >= 48 && av <= 80);
      $('#medElos').textContent = cadeia.elos.length;
    }

    function desenharTudo() {
      if (!cadeia) return;
      lerCores();
      desenharBits();
      desenharAvalanche();
      desenharDistribuicao();
      atualizarMedidores();
    }

    function laco(agora) {
      if (!rodando) return;
      quadro = requestAnimationFrame(laco);
      if (!ultimoTempo) ultimoTempo = agora;
      var dt = agora - ultimoTempo;
      ultimoTempo = agora;
      acumulado += dt;
      var passo = 60; // ms por volta
      var voltas = 0;
      while (acumulado >= passo && voltas < 8) {
        cadeia.volta();
        acumulado -= passo;
        voltas++;
      }
      if (voltas) desenharTudo();
    }

    function alternarRodar() {
      rodando = !rodando;
      $('#btnForjaRodar').textContent = rodando ? '⏸ Pausar' : '▶ Rodar cadeia';
      if (rodando) {
        ultimoTempo = 0; acumulado = 0;
        quadro = requestAnimationFrame(laco);
      } else if (quadro) {
        cancelAnimationFrame(quadro);
      }
    }

    function parar() {
      if (rodando) alternarRodar();
    }

    function renderElos() {
      var alvo = $('#forjaElos');
      limpar(alvo);
      var l = lot();
      cadeia.elos.slice(-14).reverse().forEach(function (e, i) {
        var chip = el('span', 'elo' + (i === 0 ? ' is-nova' : ''));
        chip.style.setProperty('--i', i);
        chip.appendChild(el('span', 'elo__n', '#' + e.n));
        chip.appendChild(el('span', 'elo__hex', e.hex));
        chip.appendChild(el('span', 'elo__dez', e.dezenas.map(function (n) { return LC.fmt(l, n); }).join(' ')));
        alvo.appendChild(chip);
      });
    }

    return {
      reiniciar: function () {
        parar();
        cadeia = new LC.Cadeia(estado.semente || 'lotocalc');
        cadeia.rodar(estado.cadeia.rodadas);
        ultimoElo = null;
        if (visivel) desenharTudo();
        if (cadeia) renderElos();
      },
      adotar: function (c) {
        parar();
        cadeia = c;
        ultimoElo = c.elos.length ? c.elos[c.elos.length - 1] : null;
        if (visivel) { desenharTudo(); renderElos(); }
      },
      mostrar: function () {
        visivel = true;
        if (!cadeia) this.reiniciar();
        desenharTudo();
        renderElos();
      },
      esconder: function () { visivel = false; parar(); },
      redesenhar: function () { if (visivel) desenharTudo(); },
      passo: function () {
        cadeia.volta();
        desenharTudo();
      },
      alternarRodar: alternarRodar,
      extrair: function () {
        var l = lot();
        if (l.tipo !== 'dezenas') {
          toast('A forja sorteia dezenas — escolha uma modalidade de dezenas.', 'erro');
          return;
        }
        var excl = porEstado('exclui');
        var disp = LC.universo(l).filter(function (n) { return excl.indexOf(n) === -1; });
        var k = dezenasAtual();
        var p = cadeia.parametros();
        var jogo = cadeia.sortear(disp, k, l, estado.cadeia.temperatura, p);
        cadeia.fecharElo(jogo, estado.cadeia.deriva);
        ultimoElo = cadeia.elos[cadeia.elos.length - 1];
        desenharTudo();
        renderElos();
        toast('Elo #' + ultimoElo.n + ' forjado: ' + jogo.map(function (n) { return LC.fmt(l, n); }).join(' '), 'ok');
      }
    };
  })();

  /* ======================================================================
     ABAS
     ==================================================================== */

  function trocarAba(nome) {
    $$('.aba').forEach(function (a) {
      var ativa = a.dataset.aba === nome;
      a.classList.toggle('is-ativa', ativa);
      a.setAttribute('aria-selected', ativa ? 'true' : 'false');
    });
    $$('.painel').forEach(function (p) {
      var ativa = p.id === 'painel-' + nome;
      p.classList.toggle('is-ativo', ativa);
      p.hidden = !ativa;
    });
    abaAtual = nome;
    if (nome === 'cadeia') forja.mostrar();
    else forja.esconder();
    if (nome === 'premios') abrirPremios();
  }

  /* ======================================================================
     EXPORTAÇÃO
     ==================================================================== */

  function exportar(formato) {
    if (!resultado || !resultado.jogos.length) {
      toast('Não há jogos para exportar.', 'erro');
      return;
    }
    var l = LC.lot(resultado.lotId);
    var c = LC.exportConteudo(formato, l, resultado, resultado);

    if (formato === 'simples') {
      LC.copiar(c.texto).then(function () {
        toast(resultado.jogos.length + ' jogos copiados para a área de transferência.', 'ok');
      }, function () {
        mostrarPrevia('Copiar jogos', c);
      });
      return;
    }
    mostrarPrevia(formato.toUpperCase(), c);
  }

  function mostrarPrevia(titulo, c) {
    var l = LC.lot(resultado.lotId);
    abrirModal(titulo + ' — ' + l.nome, function (corpo) {
      var ta = el('textarea', 'previa');
      ta.value = c.texto;
      ta.readOnly = true;
      ta.spellcheck = false;
      corpo.appendChild(ta);
      setTimeout(function () { ta.focus(); ta.setSelectionRange(0, 0); }, 30);
    }, function (pe) {
      var copiar = el('button', 'btn btn--principal', 'Copiar tudo');
      copiar.type = 'button';
      copiar.addEventListener('click', function () {
        LC.copiar(c.texto).then(function () { toast('Copiado.', 'ok'); },
          function () { toast('O navegador bloqueou a cópia — selecione o texto e use Ctrl+C.', 'erro'); });
      });
      var fechar = el('button', 'btn btn--fantasma', 'Fechar');
      fechar.type = 'button';
      fechar.addEventListener('click', fecharModal);
      pe.appendChild(fechar);

      var baixar = el('button', 'btn', 'Baixar arquivo');
      baixar.type = 'button';
      baixar.addEventListener('click', function () {
        var nome = LC.nomeArquivo(l, resultado, c.ext);
        baixar.disabled = true;
        LC.salvarArquivo(nome, c.texto, c.mime).then(function (estado) {
          baixar.disabled = false;
          if (estado === 'salvo') toast('Arquivo ' + nome + ' salvo.', 'ok');
          else if (estado === 'salvo-txt') toast('Salvo como .txt — esta visualização não libera o formato ' + c.ext.toUpperCase() + '.', 'ok');
          else if (estado === 'recusado') toast('Download cancelado.');
          else toast('Não foi possível salvar aqui — use "Copiar tudo".', 'erro');
        });
      });
      pe.appendChild(baixar);

      pe.appendChild(copiar);
    });
  }

  /* ======================================================================
     AJUDA
     ==================================================================== */

  function mostrarAjuda() {
    abrirModal('Como o Lotocalc funciona', function (corpo) {
      function h(t) { corpo.appendChild(el('h3', null, t)); }
      function p(t) {
        var n = el('p');
        n.innerHTML = t;
        corpo.appendChild(n);
      }
      function ul(itens) {
        var u = el('ul');
        itens.forEach(function (i) {
          var li = el('li');
          li.innerHTML = i;
          u.appendChild(li);
        });
        corpo.appendChild(u);
      }

      h('O caminho');
      p('Escolha a modalidade na faixa do topo, ajuste o tamanho da aposta, marque o que quiser no volante, escolha a estratégia e aperte <b>Gerar jogos</b> (ou a tecla <code>G</code>).');

      h('O volante');
      p('Cada clique numa dezena avança um estado: <b>fixa</b> (entra em todos os jogos) → <b>excluída</b> (nunca entra) → limpa. No fechamento, as dezenas verdes viram o <i>pool</i> que será combinado.');

      h('As estratégias');
      ul([
        '<b>Sorteio limpo</b> — uniforme, igual à surpresinha.',
        '<b>Equilibrado</b> — força soma, paridade e espalhamento para a faixa mais provável.',
        '<b>Cadeia de hash</b> — 128 bits de estado giram a cada volta; o digest vira parâmetro de uma curva de probabilidade, e cada jogo realimenta o próximo. A aba <b>Cadeia</b> mostra a matemática acontecendo.',
        '<b>Ponderada</b> — usa o histórico colado para puxar às quentes, frias ou atrasadas.',
        '<b>Cobertura</b> — reparte o uso das dezenas por igual entre os jogos.',
        '<b>Fechamento</b> — combina o pool marcado; no modo reduzido, calcula o menor conjunto de jogos que garante um mínimo de acertos.'
      ]);

      h('Prêmios e valor esperado');
      p('A aba <b>Prêmios</b> busca os concursos direto da API pública da CAIXA (com um espelho comunitário de reserva), sem cadastro e sem custo. Ela mostra o último resultado com o rateio, a estimativa do próximo concurso e o <b>valor esperado</b>: quanto, em média, volta de cada real apostado.');
      ul([
        'A chance de cada faixa é exata (combinatória). O prêmio principal usa a estimativa divulgada; as outras faixas, a média paga nos concursos recentes.',
        'Com muitas apostas, o prêmio principal pode ser dividido: o app estima quantos ganhadores dividiriam com você.',
        'Prêmios acima do limite de isenção pagam 30% de IR. O limite é editável.',
        'Todo prêmio da tabela pode ser editado para simular outro cenário.'
      ]);
      p('No <b>Conferidor</b>, <b>Buscar resultado oficial</b> preenche as dezenas e traz o rateio: cada jogo passa a mostrar quanto recebe em reais, contando todas as apostas simples de um jogo com mais dezenas. No <b>Histórico</b>, dá para baixar os últimos concursos em vez de colar.');

      h('Semente');
      p('A semente comanda todo o sorteio. Guardando a semente e os mesmos ajustes, você reproduz exatamente os mesmos jogos — útil para conferir depois ou dividir um bolão.');

      h('O que isto não faz');
      p('Não prevê resultado. Loteria é sorteio independente: nenhum filtro, peso ou fechamento muda a chance de uma dezena sair. O que muda é a <b>forma da sua aposta</b> — quantas combinações você cobre e quanto isso custa.');
    }, function (pe) {
      var b = el('button', 'btn btn--principal', 'Entendi');
      b.type = 'button';
      b.addEventListener('click', fecharModal);
      pe.appendChild(b);
    });
  }

  /* ======================================================================
     SEMENTE — impressão digital e origem
     ==================================================================== */

  function atualizarImpressao() {
    var v = ($('#inSemente').value || '').trim() || 'lotocalc';
    LC.impressaoDigital($('#impressaoSemente'), v, paleta());
  }

  function definirSemente(valor) {
    estado.semente = valor;
    $('#inSemente').value = valor;
    atualizarImpressao();
    forja.reiniciar();
    salvar();
  }

  function abrirOrigemSemente() {
    var origem = 'texto';
    var achado = null;
    var urlPrevia = null;
    var btnUsar = null;
    var painel = null;
    var saida = null;

    function trocarOrigem(nova, abas) {
      origem = nova;
      $$('button', abas).forEach(function (b) {
        b.classList.toggle('is-ativa', b.dataset.origem === nova);
      });
      montarPainel();
    }

    function anunciar(r) {
      achado = r;
      limpar(saida);
      if (!r) { if (btnUsar) btnUsar.disabled = true; return; }

      var caixa = el('div', 'resultado-semente');
      var cv = el('canvas', 'impressao impressao--grande');
      caixa.appendChild(cv);
      var lado = el('div');
      lado.appendChild(el('div', 'resultado-semente__rot', 'semente gerada'));
      lado.appendChild(el('div', 'resultado-semente__valor', r.semente));
      lado.appendChild(el('div', 'resultado-semente__hex', 'estado ' + r.hex));
      caixa.appendChild(lado);
      saida.appendChild(caixa);
      LC.impressaoDigital(cv, r.semente, paleta());
      if (btnUsar) btnUsar.disabled = false;
    }

    function montarPainel() {
      limpar(painel);
      limpar(saida);
      achado = null;
      if (btnUsar) btnUsar.disabled = true;

      if (origem === 'texto') return painelTexto();
      if (origem === 'arquivo') return painelArquivo();
      return painelGesto();
    }

    /* --- texto --- */
    function painelTexto() {
      var p = el('p');
      p.innerHTML = 'Escreva qualquer coisa — um verso, o nome de quem você ama, a data de ontem. ' +
        'O texto inteiro é absorvido pela cadeia e vira uma semente.';
      painel.appendChild(p);
      var ta = el('textarea');
      ta.rows = 4;
      ta.placeholder = 'ex.: para a vó Neide, que sempre jogou no 13';
      ta.spellcheck = false;
      painel.appendChild(ta);
      ta.addEventListener('input', function () {
        var t = ta.value.trim();
        anunciar(t ? LC.sementeDeTexto(t) : null);
      });
      setTimeout(function () { ta.focus(); }, 40);
    }

    /* --- arquivo --- */
    function painelArquivo() {
      var p = el('p');
      p.innerHTML = 'Solte uma <b>foto</b>, um <b>áudio</b>, um vídeo ou qualquer arquivo. ' +
        'Os bytes viram semente aqui mesmo — nada é enviado para lugar nenhum.';
      painel.appendChild(p);

      var entrada = el('input');
      entrada.type = 'file';
      entrada.accept = 'image/*,audio/*,video/*,text/*,.pdf,.zip';
      entrada.style.display = 'none';
      painel.appendChild(entrada);

      var zona = el('div', 'zona-solta');
      zona.tabIndex = 0;
      zona.setAttribute('role', 'button');
      var glifo = el('div', 'zona-solta__glifo', '↑');
      zona.appendChild(glifo);
      zona.appendChild(el('div', 'zona-solta__titulo', 'Solte o arquivo aqui'));
      zona.appendChild(el('div', 'zona-solta__texto', 'ou clique para escolher — imagem, áudio, vídeo, PDF, o que for'));
      painel.appendChild(zona);

      var previa = el('div');
      painel.appendChild(previa);

      function abrir() { entrada.click(); }
      zona.addEventListener('click', abrir);
      zona.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); }
      });
      ['dragenter', 'dragover'].forEach(function (n) {
        zona.addEventListener(n, function (ev) { ev.preventDefault(); zona.classList.add('is-sobre'); });
      });
      ['dragleave', 'drop'].forEach(function (n) {
        zona.addEventListener(n, function (ev) { ev.preventDefault(); zona.classList.remove('is-sobre'); });
      });
      zona.addEventListener('drop', function (ev) {
        var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (f) processar(f);
      });
      entrada.addEventListener('change', function () {
        if (entrada.files && entrada.files[0]) processar(entrada.files[0]);
      });

      function processar(file) {
        limpar(previa);
        previa.appendChild(el('div', 'nota', 'Lendo ' + file.name + '…'));
        LC.sementeDeArquivo(file).then(function (r) {
          limpar(previa);
          previa.appendChild(cartaoArquivo(r));
          anunciar(r);
        }, function (erro) {
          limpar(previa);
          previa.appendChild(el('div', 'nota nota--erro', erro.message));
          anunciar(null);
        });
      }

      function cartaoArquivo(r) {
        var c = el('div', 'previa-arquivo');
        if (urlPrevia) { URL.revokeObjectURL(urlPrevia); urlPrevia = null; }

        if (r.tipo === 'imagem') {
          urlPrevia = URL.createObjectURL(r.arquivo);
          var img = el('img');
          img.src = urlPrevia;
          img.alt = 'Prévia de ' + r.nome;
          c.appendChild(img);
        } else {
          var rot = { audio: 'ÁUDIO', video: 'VÍDEO', texto: 'TEXTO' }[r.tipo] || 'ARQUIVO';
          c.appendChild(el('div', 'previa-arquivo__icone', rot));
        }

        var info = el('div');
        info.appendChild(el('div', 'previa-arquivo__nome', r.nome));
        info.appendChild(el('div', 'previa-arquivo__meta',
          r.tamanho + (r.amostrado ? ' · amostrado em 3 trechos' : ' · lido por inteiro')));
        if (r.tipo === 'audio') {
          urlPrevia = URL.createObjectURL(r.arquivo);
          var a = el('audio');
          a.controls = true;
          a.src = urlPrevia;
          info.appendChild(a);
        }
        c.appendChild(info);
        return c;
      }
    }

    /* --- gesto --- */
    function painelGesto() {
      var p = el('p');
      p.innerHTML = 'Mexa o ponteiro dentro do quadro (ou arraste o dedo). ' +
        'A irregularidade do seu gesto — posição e ritmo — é a fonte de entropia.';
      painel.appendChild(p);

      var cv = el('canvas', 'gesto__tela');
      painel.appendChild(cv);

      var coletor = new LC.ColetorGesto(120);
      var cores = paleta();
      var pronto = false;

      function desenhar() {
        if (!cv.isConnected) return;
        var dpr = Math.min(global.devicePixelRatio || 1, 2);
        var w = cv.clientWidth, h = cv.clientHeight;
        if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        var ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        var t = coletor.trilha;
        if (t.length > 1) {
          for (var i = 1; i < t.length; i++) {
            var a = i / t.length;
            ctx.strokeStyle = 'rgba(' + cores.brandRgb.replace(/\s+/g, ',') + ',' + (a * 0.9).toFixed(3) + ')';
            ctx.lineWidth = 1 + a * 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(t[i - 1].x, t[i - 1].y);
            ctx.lineTo(t[i].x, t[i].y);
            ctx.stroke();
          }
          var ultimo = t[t.length - 1];
          ctx.fillStyle = cores.brandTexto;
          ctx.beginPath();
          ctx.arc(ultimo.x, ultimo.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // anel de progresso no centro
        var cx = w / 2, cy = h / 2, raio = 30;
        var prog = coletor.progresso();
        ctx.strokeStyle = cores.linhaForte;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, raio, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = cores.brandTexto;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, raio, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = cores.tinta;
        ctx.font = "700 15px 'Martian Mono', ui-monospace, monospace";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(prog * 100) + '%', cx, cy);
      }

      cv.addEventListener('pointermove', function (ev) {
        if (pronto) return;
        var r = cv.getBoundingClientRect();
        coletor.alimentar(ev.clientX - r.left, ev.clientY - r.top, ev.timeStamp || Date.now());
        desenhar();
        if (coletor.pronto()) {
          pronto = true;
          anunciar(coletor.semente());
        }
      });

      desenhar();
    }

    abrirModal('De onde vem a semente', function (corpo) {
      var abas = el('div', 'origem-abas');
      [['texto', 'Texto'], ['arquivo', 'Foto, áudio, arquivo'], ['gesto', 'Movimento']].forEach(function (par) {
        var b = el('button', par[0] === origem ? 'is-ativa' : '', par[1]);
        b.type = 'button';
        b.dataset.origem = par[0];
        b.addEventListener('click', function () { trocarOrigem(par[0], abas); });
        abas.appendChild(b);
      });
      corpo.appendChild(abas);

      painel = el('div', 'entrada-res');
      corpo.appendChild(painel);
      saida = el('div');
      corpo.appendChild(saida);
      montarPainel();
    }, function (pe) {
      var fechar = el('button', 'btn btn--fantasma', 'Cancelar');
      fechar.type = 'button';
      fechar.addEventListener('click', function () {
        if (urlPrevia) URL.revokeObjectURL(urlPrevia);
        fecharModal();
      });
      btnUsar = el('button', 'btn btn--principal', 'Usar esta semente');
      btnUsar.type = 'button';
      btnUsar.disabled = true;
      btnUsar.addEventListener('click', function () {
        if (!achado) return;
        definirSemente(achado.semente);
        if (urlPrevia) URL.revokeObjectURL(urlPrevia);
        fecharModal();
        toast('Semente ' + achado.semente + ' no lugar. Gere os jogos.', 'ok');
      });
      pe.appendChild(fechar);
      pe.appendChild(btnUsar);
    });
  }

  /* ======================================================================
     TEMA
     ==================================================================== */

  function aplicarTema() {
    if (estado.tema) document.documentElement.setAttribute('data-theme', estado.tema);
    else document.documentElement.removeAttribute('data-theme');
    aplicarCoresMarca();
    forja.redesenhar();
    atualizarImpressao();
  }

  function alternarTema() {
    var atual = estado.tema;
    if (!atual) {
      var escuro = global.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
      atual = escuro ? 'dark' : 'light';
    }
    estado.tema = atual === 'dark' ? 'light' : 'dark';
    aplicarTema();
    salvar();
  }

  /* ======================================================================
     EVENTOS
     ==================================================================== */

  function ligarEventos() {
    var inD = $('#inDezenas');
    inD.addEventListener('input', function () {
      estado.dezenas[estado.lotId] = num(inD.value, lot().padrao);
      $('#outDezenas').textContent = inD.value;
      pintarRange(inD);
      renderFiltros();
      atualizarCusto();
      salvar();
    });

    var inQ = $('#inQtd');
    inQ.value = estado.qtd;
    inQ.addEventListener('input', function () {
      estado.qtd = num(inQ.value, 10);
      $('#outQtd').textContent = inQ.value;
      pintarRange(inQ);
      marcarAtalhoQtd();
      atualizarCusto();
      salvar();
    });

    $$('#atalhosQtd button').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.qtd = Number(b.dataset.qtd);
        inQ.value = estado.qtd;
        $('#outQtd').textContent = estado.qtd;
        pintarRange(inQ);
        marcarAtalhoQtd();
        atualizarCusto();
        salvar();
      });
    });

    $('#inSemente').addEventListener('input', function () {
      estado.semente = $('#inSemente').value.trim();
      atualizarImpressao();
      salvar();
    });

    $$('#segModo button').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.modoLote = b.dataset.modo;
        aplicarModoLote();
        atualizarCusto();
        salvar();
      });
    });

    $('#inOrcamento').addEventListener('input', function () {
      estado.orcamento = Math.max(0, num(this.value, 0));
      $('#outOrcamento').textContent = LC.moeda(estado.orcamento);
      $$('#atalhosOrcamento button').forEach(function (b) {
        b.classList.toggle('is-ativa', Number(b.dataset.valor) === estado.orcamento);
      });
      atualizarCusto();
      salvar();
    });

    $$('#atalhosOrcamento button').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.orcamento = Number(b.dataset.valor);
        aplicarModoLote();
        atualizarCusto();
        salvar();
      });
    });

    $('#inEvitarRepetidos').addEventListener('change', function () {
      estado.evitarRepetidos = this.checked; salvar();
    });

    $('#inDiversidade').addEventListener('change', function () {
      estado.diversidade = this.checked;
      $('#subDiversidade').hidden = !this.checked;
      salvar();
    });

    $('#inDiversidadeMax').addEventListener('input', function () {
      estado.diversidadeMax = Math.max(1, num(this.value, 4));
      salvar();
    });

    $('#btnGerar').addEventListener('click', gerar);

    // resultado editado à mão depois de buscado: o rateio oficial deixa de valer
    $('#entradaResultado').addEventListener('input', invalidarOficial);
    $('#entradaResultado').addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('.dez')) invalidarOficial();
    });
    $('#inConcurso').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') buscarResultadoOficial();
    });
    $('#btnTema').addEventListener('click', alternarTema);
    $('#btnAjuda').addEventListener('click', mostrarAjuda);

    $$('.aba').forEach(function (a) {
      a.addEventListener('click', function () { trocarAba(a.dataset.aba); });
    });

    // controles da forja
    [['inTemperatura', 'temperatura', 'outTemperatura', 2],
     ['inRodadas', 'rodadas', 'outRodadas', 0],
     ['inDeriva', 'deriva', 'outDeriva', 0]].forEach(function (par) {
      var i = $('#' + par[0]);
      if (!i) return;
      i.value = estado.cadeia[par[1]];
      $('#' + par[2]).textContent = par[3] ? Number(i.value).toFixed(par[3]).replace('.', ',') : i.value;
      pintarRange(i);
      i.addEventListener('input', function () {
        estado.cadeia[par[1]] = num(i.value, estado.cadeia[par[1]]);
        $('#' + par[2]).textContent = par[3] ? Number(i.value).toFixed(par[3]).replace('.', ',') : i.value;
        pintarRange(i);
        forja.redesenhar();
        if (estado.estrategia === 'cadeia') renderOpcoesEstrategia();
        salvar();
      });
    });

    document.addEventListener('click', function (ev) {
      var alvo = ev.target.closest ? ev.target.closest('[data-acao], [data-exp]') : null;
      if (!alvo) return;
      var acao = alvo.dataset.acao;
      var exp = alvo.dataset.exp;

      if (exp) return exportar(exp);

      switch (acao) {
        case 'fechar-modal': fecharModal(); break;
        case 'limpar-volante':
          estado.marcas[estado.lotId] = {};
          estado.ssFixas = {};
          estado.loteca.fixos = {};
          estado.extras.trevosFixas = [];
          renderVolante(); atualizarCusto(); salvar();
          break;
        case 'sortear-fixas': sortearMarcacoes(); break;
        case 'filtros-sugeridos': aplicarSugeridos(); break;
        case 'filtros-limpar':
          var c = filtros();
          Object.keys(c).forEach(function (k) { c[k].ativo = false; });
          renderFiltros(); salvar();
          break;
        case 'nova-semente': definirSemente(LC.novaSemente()); break;
        case 'abrir-semente': abrirOrigemSemente(); break;
        case 'imprimir': global.print(); break;
        case 'limpar-jogos':
          resultado = null; conferencia = null;
          renderJogos(); renderEstatisticas();
          break;
        case 'conferir': conferir(); break;
        case 'buscar-resultado': buscarResultadoOficial(); break;
        case 'atualizar-premios': carregarOficial(true); break;
        case 'baixar-historico': baixarHistorico(); break;
        case 'limpar-conferencia':
          conferencia = null;
          limpar($('#resultadoConferencia'));
          renderEntradaResultado();
          renderJogos();
          break;
        case 'carregar-historico': carregarHistorico(); break;
        case 'limpar-historico':
          delete estado.historicoTexto[estado.lotId];
          historico = [];
          $('#inHistorico').value = '';
          limpar($('#resumoHistorico'));
          renderFiltros(); renderOpcoesEstrategia(); salvar();
          toast('Histórico descartado.');
          break;
        case 'forja-rodar': forja.alternarRodar(); break;
        case 'forja-passo': forja.passo(); break;
        case 'forja-extrair': forja.extrair(); break;
        case 'forja-reiniciar': forja.reiniciar(); break;
        case 'forja-usar':
          estado.estrategia = 'cadeia';
          renderEstrategias();
          trocarAba('jogos');
          toast('Estratégia trocada para Cadeia de hash. É só gerar.', 'ok');
          salvar();
          break;
      }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') fecharModal();
      var dentroDeCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (dentroDeCampo || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'g' || ev.key === 'G') { ev.preventDefault(); gerar(); }
    });

    var redimensionar;
    global.addEventListener('resize', function () {
      clearTimeout(redimensionar);
      redimensionar = setTimeout(function () { forja.redesenhar(); }, 140);
    });

    if (global.matchMedia) {
      var mq = matchMedia('(prefers-color-scheme: dark)');
      var aoMudar = function () { aplicarCoresMarca(); forja.redesenhar(); atualizarImpressao(); };
      if (mq.addEventListener) mq.addEventListener('change', aoMudar);
      else if (mq.addListener) mq.addListener(aoMudar);
    }
  }

  function marcarAtalhoQtd() {
    $$('#atalhosQtd button').forEach(function (b) {
      b.classList.toggle('is-ativa', Number(b.dataset.qtd) === estado.qtd);
    });
  }

  function sortearMarcacoes() {
    var l = lot();
    var rng = new LC.Rng(LC.novaSemente());

    if (l.tipo === 'colunas') {
      estado.ssFixas = {};
      for (var c = 0; c < l.colunas; c++) {
        estado.ssFixas[c] = [rng.int(l.digMin, l.digMax)];
      }
    } else if (l.tipo === 'placares') {
      estado.loteca.fixos = {};
      for (var j = 0; j < l.jogos; j++) {
        estado.loteca.fixos[j] = [rng.escolher(l.simbolos)];
      }
    } else {
      var k = dezenasAtual();
      var alvo = estado.estrategia === 'fechamento'
        ? Math.min(l.escolhaMax, Math.max(k + 2, Math.round(k * 1.5)))
        : Math.max(1, Math.round(k / 3));
      var sorteadas = rng.amostra(LC.universo(l), alvo);
      var m = {};
      sorteadas.forEach(function (n) { m[n] = 'fixa'; });
      estado.marcas[estado.lotId] = m;
    }
    renderVolante();
    atualizarCusto();
    salvar();
    toast('Marcações sorteadas.');
  }

  /* ======================================================================
     BOOT
     ==================================================================== */

  function iniciar() {
    carregar();
    if (!LC.lot(estado.lotId)) estado.lotId = 'megasena';
    if (!estado.loteca.fixos) estado.loteca.fixos = {};
    if (!estado.ssFixas) estado.ssFixas = {};

    aplicarTema();
    renderModalidades();
    ligarEventos();

    $('#inSemente').value = estado.semente || '';
    $('#inQtd').value = estado.qtd;
    $('#outQtd').textContent = estado.qtd;
    pintarRange($('#inQtd'));
    marcarAtalhoQtd();
    aplicarModoLote();

    aplicarModalidade();
    renderJogos();
    trocarAba('jogos');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

})(this);
