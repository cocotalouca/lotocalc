/* ============================================================================
 * LOTOCALC — Catálogo de modalidades das Loterias CAIXA
 * ----------------------------------------------------------------------------
 * Cada modalidade descreve o universo de dezenas, os limites de aposta,
 * o modo de cálculo do preço e as faixas de premiação usadas pelo conferidor.
 *
 * ATENÇÃO: os preços são valores de REFERÊNCIA. A CAIXA reajusta as apostas
 * periodicamente — todos eles são editáveis no painel "Preços" do app.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});

  /* ---- combinatória ------------------------------------------------------ */

  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    k = Math.min(k, n - k);
    var r = 1;
    for (var i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  }

  /* ---- times do coração (Timemania) -------------------------------------- */

  var TIMES = [
    'ABC/RN', 'AMÉRICA/MG', 'AMÉRICA/RJ', 'AMÉRICA/RN', 'AMÉRICA/SP',
    'ANAPOLINA/GO', 'ATLÉTICO/GO', 'ATLÉTICO/MG', 'ATLÉTICO/PR', 'AVAÍ/SC',
    'BAHIA/BA', 'BANGU/RJ', 'BOTAFOGO/PB', 'BOTAFOGO/RJ', 'BOTAFOGO/SP',
    'BRAGANTINO/SP', 'BRASILIENSE/DF', 'CAMPINENSE/PB', 'CAXIAS/RS', 'CEARÁ/CE',
    'CENTRAL/PE', 'CHAPECOENSE/SC', 'CIANORTE/PR', 'CORINTHIANS/SP', 'CORITIBA/PR',
    'CRB/AL', 'CRICIÚMA/SC', 'CRUZEIRO/MG', 'CSA/AL', 'CUIABÁ/MT',
    'DESPORTIVA/ES', 'FIGUEIRENSE/SC', 'FLAMENGO/RJ', 'FLUMINENSE/RJ', 'FORTALEZA/CE',
    'GAMA/DF', 'GOIÁS/GO', 'GRÊMIO/RS', 'GUARANI/SP', 'INTERNACIONAL/RS',
    'IPATINGA/MG', 'ITABAIANA/SE', 'ITUANO/SP', 'JUVENTUDE/RS', 'JUVENTUS/SP',
    'LONDRINA/PR', 'MARÍLIA/SP', 'MIXTO/MT', 'MOTO CLUBE/MA', 'NÁUTICO/PE',
    'NACIONAL/AM', 'NOVOHORIZONTINO/SP', 'OPERÁRIO/MS', 'PARANÁ/PR', 'PAYSANDU/PA',
    'PONTE PRETA/SP', 'PORTUGUESA/SP', 'REMO/PA', 'RIO BRANCO/AC', 'RIVER/PI',
    'SAMPAIO CORRÊA/MA', 'SANTA CRUZ/PE', 'SANTO ANDRÉ/SP', 'SANTOS/SP', 'SÃO CAETANO/SP',
    'SÃO PAULO/SP', 'SÃO RAIMUNDO/AM', 'SERGIPE/SE', 'SERTÃOZINHO/SP', 'SPORT/PE',
    'TREZE/PB', 'TUNA LUSO/PA', 'UBERLÂNDIA/MG', 'UNIÃO SÃO JOÃO/SP', 'VASCO DA GAMA/RJ',
    'VILA NOVA/GO', 'VITÓRIA/BA', 'VOLTA REDONDA/RJ', 'XV NOV. PIRACICABA/SP', 'YPIRANGA/AP'
  ];

  var MESES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  /* ---- modalidades ------------------------------------------------------- */

  var LOTERIAS = [
    {
      id: 'megasena',
      nome: 'Mega-Sena',
      curto: 'Mega',
      tipo: 'dezenas',
      brand: '#209869',
      brandRgb: '32 152 105',
      min: 1, max: 60, grade: 10,
      escolhaMin: 6, escolhaMax: 20, padrao: 6,
      base: 6, sorteadas: 6,
      preco: 6.00, precoModo: 'comb',
      faixas: [
        { n: 6, nome: 'Sena' },
        { n: 5, nome: 'Quina' },
        { n: 4, nome: 'Quadra' }
      ],
      sorteio: 'Ter, Qui e Sáb',
      resumo: 'De 6 a 20 dezenas entre 01 e 60. Seis dezenas sorteadas.'
    },
    {
      id: 'lotofacil',
      nome: 'Lotofácil',
      curto: 'Lotofácil',
      tipo: 'dezenas',
      brand: '#930089',
      brandRgb: '147 0 137',
      min: 1, max: 25, grade: 5,
      escolhaMin: 15, escolhaMax: 20, padrao: 15,
      base: 15, sorteadas: 15,
      preco: 3.50, precoModo: 'comb',
      faixas: [
        { n: 15, nome: '15 acertos' },
        { n: 14, nome: '14 acertos' },
        { n: 13, nome: '13 acertos' },
        { n: 12, nome: '12 acertos' },
        { n: 11, nome: '11 acertos' }
      ],
      sorteio: 'Seg a Sáb',
      resumo: 'De 15 a 20 dezenas entre 01 e 25. Quinze dezenas sorteadas.',
      moldura: true
    },
    {
      id: 'quina',
      nome: 'Quina',
      curto: 'Quina',
      tipo: 'dezenas',
      brand: '#260085',
      brandRgb: '38 0 133',
      min: 1, max: 80, grade: 10,
      escolhaMin: 5, escolhaMax: 15, padrao: 5,
      base: 5, sorteadas: 5,
      preco: 3.00, precoModo: 'comb',
      faixas: [
        { n: 5, nome: 'Quina' },
        { n: 4, nome: 'Quadra' },
        { n: 3, nome: 'Terno' },
        { n: 2, nome: 'Duque' }
      ],
      sorteio: 'Seg a Sáb',
      resumo: 'De 5 a 15 dezenas entre 01 e 80. Cinco dezenas sorteadas.'
    },
    {
      id: 'lotomania',
      nome: 'Lotomania',
      curto: 'Lotomania',
      tipo: 'dezenas',
      brand: '#F78100',
      brandRgb: '247 129 0',
      min: 0, max: 99, grade: 10,
      escolhaMin: 50, escolhaMax: 50, padrao: 50,
      base: 50, sorteadas: 20,
      preco: 3.50, precoModo: 'fixo',
      faixas: [
        { n: 20, nome: '20 acertos' },
        { n: 19, nome: '19 acertos' },
        { n: 18, nome: '18 acertos' },
        { n: 17, nome: '17 acertos' },
        { n: 16, nome: '16 acertos' },
        { n: 15, nome: '15 acertos' },
        { n: 0, nome: 'Nenhum acerto' }
      ],
      sorteio: 'Seg, Qua e Sex',
      resumo: '50 dezenas entre 00 e 99. Vinte dezenas sorteadas — zero acertos também premia.'
    },
    {
      id: 'duplasena',
      nome: 'Dupla Sena',
      curto: 'Dupla',
      tipo: 'dezenas',
      brand: '#A61324',
      brandRgb: '166 19 36',
      min: 1, max: 50, grade: 10,
      escolhaMin: 6, escolhaMax: 15, padrao: 6,
      base: 6, sorteadas: 6,
      sorteios: 2,
      preco: 3.00, precoModo: 'comb',
      faixas: [
        { n: 6, nome: 'Sena' },
        { n: 5, nome: 'Quina' },
        { n: 4, nome: 'Quadra' },
        { n: 3, nome: 'Terno' }
      ],
      sorteio: 'Seg, Qua e Sex',
      resumo: 'De 6 a 15 dezenas entre 01 e 50. Dois sorteios por concurso.'
    },
    {
      id: 'timemania',
      nome: 'Timemania',
      curto: 'Timemania',
      tipo: 'dezenas',
      brand: '#00A94F',
      brandRgb: '0 169 79',
      min: 1, max: 80, grade: 10,
      escolhaMin: 10, escolhaMax: 10, padrao: 10,
      base: 10, sorteadas: 7,
      preco: 4.00, precoModo: 'fixo',
      faixas: [
        { n: 7, nome: '7 acertos' },
        { n: 6, nome: '6 acertos' },
        { n: 5, nome: '5 acertos' },
        { n: 4, nome: '4 acertos' },
        { n: 3, nome: '3 acertos' }
      ],
      extra: { id: 'time', nome: 'Time do Coração', tipo: 'lista', opcoes: TIMES },
      sorteio: 'Ter, Qui e Sáb',
      resumo: '10 dezenas entre 01 e 80 + Time do Coração. Sete dezenas sorteadas.'
    },
    {
      id: 'diadesorte',
      nome: 'Dia de Sorte',
      curto: 'Dia de Sorte',
      tipo: 'dezenas',
      brand: '#CB852B',
      brandRgb: '203 133 43',
      min: 1, max: 31, grade: 7,
      escolhaMin: 7, escolhaMax: 15, padrao: 7,
      base: 7, sorteadas: 7,
      preco: 3.00, precoModo: 'comb',
      faixas: [
        { n: 7, nome: '7 acertos' },
        { n: 6, nome: '6 acertos' },
        { n: 5, nome: '5 acertos' },
        { n: 4, nome: '4 acertos' }
      ],
      extra: { id: 'mes', nome: 'Mês da Sorte', tipo: 'lista', opcoes: MESES },
      sorteio: 'Ter, Qui e Sáb',
      resumo: 'De 7 a 15 dezenas entre 01 e 31 + Mês da Sorte.'
    },
    {
      id: 'supersete',
      nome: 'Super Sete',
      curto: 'Super Sete',
      tipo: 'colunas',
      brand: '#A8CF45',
      brandRgb: '168 207 69',
      colunas: 7, digMin: 0, digMax: 9,
      escolhaMin: 1, escolhaMax: 3, padrao: 1,
      sorteadas: 7,
      preco: 3.00, precoModo: 'colunas',
      faixas: [
        { n: 7, nome: '7 colunas' },
        { n: 6, nome: '6 colunas' },
        { n: 5, nome: '5 colunas' },
        { n: 4, nome: '4 colunas' },
        { n: 3, nome: '3 colunas' }
      ],
      sorteio: 'Seg, Qua e Sex',
      resumo: '7 colunas, de 1 a 3 algarismos (0 a 9) em cada uma.'
    },
    {
      id: 'maismilionaria',
      nome: '+Milionária',
      curto: '+Milionária',
      tipo: 'dezenas',
      brand: '#8E2E86',
      brandRgb: '142 46 134',
      min: 1, max: 50, grade: 10,
      escolhaMin: 6, escolhaMax: 12, padrao: 6,
      base: 6, sorteadas: 6,
      preco: 6.00, precoModo: 'milionaria',
      faixas: [
        { n: 6, t: 2, nome: '6 + 2 trevos' },
        { n: 6, t: 0, nome: '6 + 1 ou nenhum trevo' },
        { n: 5, t: 2, nome: '5 + 2 trevos' },
        { n: 5, t: 0, nome: '5 + 1 ou nenhum trevo' },
        { n: 4, t: 2, nome: '4 + 2 trevos' },
        { n: 4, t: 0, nome: '4 + 1 ou nenhum trevo' },
        { n: 3, t: 2, nome: '3 + 2 trevos' },
        { n: 3, t: 1, nome: '3 + 1 trevo' },
        { n: 2, t: 2, nome: '2 + 2 trevos' },
        { n: 2, t: 1, nome: '2 + 1 trevo' }
      ],
      extra: {
        id: 'trevos', nome: 'Trevos', tipo: 'dezenas',
        min: 1, max: 6, grade: 6,
        escolhaMin: 2, escolhaMax: 6, padrao: 2, base: 2, sorteadas: 2
      },
      sorteio: 'Qua e Sáb',
      resumo: 'De 6 a 12 dezenas entre 01 e 50 + de 2 a 6 trevos entre 1 e 6.'
    },
    {
      id: 'loteca',
      nome: 'Loteca',
      curto: 'Loteca',
      tipo: 'placares',
      brand: '#E4051D',
      brandRgb: '228 5 29',
      jogos: 14,
      simbolos: ['1', 'X', '2'],
      preco: 2.00, precoModo: 'placares',
      faixas: [
        { n: 14, nome: '14 acertos' },
        { n: 13, nome: '13 acertos' }
      ],
      sorteio: 'Semanal',
      resumo: '14 partidas. Marque coluna 1 (mandante), X (empate) ou 2 (visitante).'
    },
    {
      id: 'federal',
      nome: 'Loteria Federal',
      curto: 'Federal',
      tipo: 'bilhete',
      brand: '#0B3E91',
      brandRgb: '11 62 145',
      digitos: 5,
      preco: 5.00, precoModo: 'fixo',
      faixas: [
        { n: 5, nome: 'Bilhete exato' },
        { n: 4, nome: '4 algarismos finais' },
        { n: 3, nome: '3 algarismos finais' }
      ],
      sorteio: 'Qua e Sáb',
      resumo: 'Palpites de bilhete com 5 algarismos, de 00000 a 99999.'
    }
  ];

  var PORID = {};
  LOTERIAS.forEach(function (l) { PORID[l.id] = l; });

  /* ---- helpers de modalidade -------------------------------------------- */

  function universo(lot) {
    var arr = [];
    for (var i = lot.min; i <= lot.max; i++) arr.push(i);
    return arr;
  }

  function fmt(lot, n) {
    if (lot.max > 99) return String(n);
    return n < 10 ? '0' + n : String(n);
  }

  /** Custo de UM jogo, conforme o modo de preço da modalidade. */
  function custoJogo(lot, jogo) {
    var p = lot.preco;
    switch (lot.precoModo) {
      case 'fixo':
        return p;
      case 'comb':
        return comb(jogo.dezenas.length, lot.base) * p;
      case 'milionaria':
        return comb(jogo.dezenas.length, 6) * comb((jogo.trevos || []).length, 2) * p;
      case 'colunas':
        return jogo.colunas.reduce(function (a, c) { return a * c.length; }, 1) * p;
      case 'placares':
        return jogo.placares.reduce(function (a, c) { return a * c.length; }, 1) * p;
      default:
        return p;
    }
  }

  /** Custo previsto para uma aposta com N dezenas (usado no resumo, antes de gerar). */
  function custoPrevisto(lot, nDezenas, nTrevos, colunas, placares) {
    return custoJogo(lot, {
      dezenas: new Array(nDezenas),
      trevos: new Array(nTrevos || 0),
      colunas: colunas || [],
      placares: placares || []
    });
  }

  LC.comb = comb;
  LC.LOTERIAS = LOTERIAS;
  LC.lot = function (id) { return PORID[id]; };
  LC.universo = universo;
  LC.fmt = fmt;
  LC.custoJogo = custoJogo;
  LC.custoPrevisto = custoPrevisto;
  LC.TIMES = TIMES;
  LC.MESES = MESES;

})(this);
