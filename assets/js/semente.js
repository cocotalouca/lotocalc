/* ============================================================================
 * LOTOCALC — Sementes a partir de qualquer coisa
 * ----------------------------------------------------------------------------
 * Texto, imagem, áudio, vídeo, arquivo qualquer ou o movimento do ponteiro:
 * tudo vira bytes, os bytes são absorvidos pela mesma cadeia de hash usada na
 * geração, e do estado final sai uma semente curta e legível.
 *
 * A impressão digital desenhada ao lado da semente é o próprio estado da
 * cadeia: sementes diferentes produzem desenhos diferentes.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LC = global.LC || (global.LC = {});

  var ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var LIMITE_BYTES = 6 * 1024 * 1024;   // acima disso, amostra em vez de ler tudo

  /* ---- bytes → semente --------------------------------------------------- */

  /** Fatia arquivos grandes: começo, meio e fim. O conteúdo distingue, não o tamanho. */
  function amostrar(u8) {
    if (u8.length <= LIMITE_BYTES) return u8;
    var pedaco = Math.floor(LIMITE_BYTES / 3);
    var meio = Math.floor(u8.length / 2 - pedaco / 2);
    var out = new Uint8Array(pedaco * 3);
    out.set(u8.subarray(0, pedaco), 0);
    out.set(u8.subarray(meio, meio + pedaco), pedaco);
    out.set(u8.subarray(u8.length - pedaco), pedaco * 2);
    return out;
  }

  /**
   * Absorve bytes na cadeia e devolve a semente.
   * Empacota 4 bytes por palavra de 32 bits para não dar uma volta por byte.
   */
  function digestDeBytes(u8, rotulo) {
    var cadeia = new LC.Cadeia('lotocalc/' + (rotulo || '') + '/' + u8.length);
    var dados = amostrar(u8);
    var palavras = [];
    for (var i = 0; i < dados.length; i += 4) {
      palavras.push(
        ((dados[i] << 24) | ((dados[i + 1] || 0) << 16) | ((dados[i + 2] || 0) << 8) | (dados[i + 3] || 0)) >>> 0
      );
      if (palavras.length >= 4096) { cadeia.absorver(palavras); palavras.length = 0; }
    }
    if (palavras.length) cadeia.absorver(palavras);
    cadeia.rodar(32);
    return { semente: sementeDaCadeia(cadeia), hex: cadeia.hex(), cadeia: cadeia };
  }

  function sementeDaCadeia(cadeia) {
    var s = '';
    for (var i = 0; i < 12; i++) {
      if (i === 4 || i === 8) s += '-';
      s += ALFABETO[Math.floor(cadeia.proximo() * ALFABETO.length)];
    }
    return s;
  }

  function sementeDeTexto(txt) {
    var s = String(txt || '');
    var u8 = new Uint8Array(s.length * 2);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      u8[i * 2] = c & 255;
      u8[i * 2 + 1] = (c >>> 8) & 255;
    }
    return digestDeBytes(u8, 'texto');
  }

  /* ---- arquivos ---------------------------------------------------------- */

  function classificar(file) {
    var t = (file.type || '').toLowerCase();
    if (t.indexOf('image/') === 0) return 'imagem';
    if (t.indexOf('audio/') === 0) return 'audio';
    if (t.indexOf('video/') === 0) return 'video';
    if (t.indexOf('text/') === 0 || /\.(txt|csv|json|md)$/i.test(file.name)) return 'texto';
    return 'arquivo';
  }

  function tamanhoLegivel(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace('.', ',') + ' KB';
    return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  }

  /** Lê o arquivo e devolve a semente + dados para a prévia na tela. */
  function sementeDeArquivo(file) {
    return new Promise(function (resolve, reject) {
      var leitor = new FileReader();
      leitor.onerror = function () {
        reject(new Error('Não consegui ler ' + file.name + '. Tente outro arquivo.'));
      };
      leitor.onload = function () {
        try {
          var u8 = new Uint8Array(leitor.result);
          var d = digestDeBytes(u8, file.name + '|' + file.size + '|' + file.type);
          resolve({
            semente: d.semente,
            hex: d.hex,
            tipo: classificar(file),
            nome: file.name,
            tamanho: tamanhoLegivel(file.size),
            bytes: file.size,
            amostrado: file.size > LIMITE_BYTES,
            arquivo: file
          });
        } catch (e) {
          reject(new Error('Falhou ao processar o arquivo: ' + e.message));
        }
      };
      leitor.readAsArrayBuffer(file);
    });
  }

  /* ---- movimento do ponteiro --------------------------------------------- */

  /**
   * Coletor de entropia por gesto: cada amostra mistura posição e o intervalo
   * desde a anterior — a irregularidade humana é a fonte de aleatoriedade.
   */
  function Coletor(alvo) {
    this.alvo = alvo || 120;
    this.amostras = 0;
    this.ultimo = 0;
    this.trilha = [];
    this.cadeia = new LC.Cadeia('lotocalc/gesto');
  }

  Coletor.prototype.alimentar = function (x, y, t) {
    var dt = this.ultimo ? Math.min(4000, t - this.ultimo) : 7;
    this.ultimo = t;
    if (dt <= 0) dt = 1;
    this.cadeia.absorver([
      (Math.round(x * 8) ^ 0x9E3779B9) >>> 0,
      (Math.round(y * 8) ^ 0x85EBCA6B) >>> 0,
      (Math.round(dt * 1000) ^ 0xC2B2AE35) >>> 0
    ]);
    this.amostras++;
    this.trilha.push({ x: x, y: y });
    if (this.trilha.length > 90) this.trilha.shift();
    return this.progresso();
  };

  Coletor.prototype.progresso = function () {
    return Math.min(1, this.amostras / this.alvo);
  };

  Coletor.prototype.pronto = function () { return this.amostras >= this.alvo; };

  Coletor.prototype.semente = function () {
    var c = new LC.Cadeia(this.cadeia.hex());
    c.rodar(48);
    return { semente: sementeDaCadeia(c), hex: c.hex() };
  };

  /* ---- impressão digital -------------------------------------------------- */

  /**
   * Desenha a assinatura visual da semente: uma grade espelhada de 8×8
   * derivada dos bits do estado da cadeia depois de 24 voltas.
   */
  function impressaoDigital(cv, semente, cores) {
    if (!cv) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var lado = cv.clientWidth || 64;
    var altura = cv.clientHeight || lado;
    if (cv.width !== Math.round(lado * dpr) || cv.height !== Math.round(altura * dpr)) {
      cv.width = Math.round(lado * dpr);
      cv.height = Math.round(altura * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, lado, altura);

    var c = new LC.Cadeia(semente || '');
    c.rodar(24);
    var bits = c.bits();

    var cols = 8, linhas = 8;
    var meio = cols / 2;
    var cel = Math.min(lado / cols, altura / linhas);
    var offX = (lado - cel * cols) / 2;
    var offY = (altura - cel * linhas) / 2;

    var brand = (cores && (cores.brandTexto || cores.brand)) || '#209869';
    var rgb = (cores && cores.brandRgb) || '32 152 105';
    var fundo = (cores && cores.superficie2) || 'transparent';

    ctx.fillStyle = fundo;
    ctx.fillRect(0, 0, lado, altura);

    for (var l = 0; l < linhas; l++) {
      for (var q = 0; q < meio; q++) {
        var idx = (l * meio + q) % 128;
        var aceso = bits[idx] === 1;
        if (!aceso) continue;
        var forte = bits[(idx + 64) % 128] === 1;
        ctx.fillStyle = forte ? brand : 'rgba(' + rgb.replace(/\s+/g, ',') + ',0.42)';
        var x1 = offX + q * cel;
        var x2 = offX + (cols - 1 - q) * cel;
        var y = offY + l * cel;
        ctx.fillRect(x1, y, cel - 0.5, cel - 0.5);
        ctx.fillRect(x2, y, cel - 0.5, cel - 0.5);
      }
    }
  }

  LC.digestDeBytes = digestDeBytes;
  LC.sementeDeTexto = sementeDeTexto;
  LC.sementeDeArquivo = sementeDeArquivo;
  LC.ColetorGesto = Coletor;
  LC.impressaoDigital = impressaoDigital;
  LC.tamanhoLegivel = tamanhoLegivel;

})(this);
