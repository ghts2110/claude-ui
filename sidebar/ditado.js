// Ditado por voz (microfone no rodapé do sidebar, acima do alto-falante):
// ouve o microfone e digita o que foi dito no campo de mensagem da conversa
// na tela, uma frase de cada vez, sem apertar Enter: a mensagem só vai quando
// você enviar. Offline e sem custo: o Whisper turbo roda no próprio
// computador pelo sherpa-onnx (ver sidebar/ouvir.js), o mesmo da voz natural.
// O modelo (~540 MB) é baixado para o cache na primeira vez que o microfone
// é ligado (ver sidebar/baixar.js).
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {baixar, cache, tem} from './baixar.js';
import {tmux} from './conversas.js';
import {suportaNatural} from './voz.js';

const nome = 'sherpa-onnx-whisper-turbo';
const pasta = join(cache, nome);
const arquivos = ['turbo-encoder.int8.onnx', 'turbo-decoder.int8.onnx', 'turbo-tokens.txt', 'silero_vad.onnx'];
const modelos = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
const url = process.env.CLAUDE_UI_DITADO_URL || `${modelos}/${nome}.tar.bz2`;
const urlVad = process.env.CLAUDE_UI_VAD_URL || `${modelos}/silero_vad.onnx`;
// Nos testes, um ouvinte falso no lugar do ouvir.js.
const ouvinte = process.env.CLAUDE_UI_OUVIR
	? [process.env.CLAUDE_UI_OUVIR]
	: [process.execPath, fileURLToPath(new URL('ouvir.js', import.meta.url))];

export const temModelo = () => suportaNatural && tem(pasta, arquivos);

const linux = process.platform !== 'darwin';
export const comoResolver = {
	suporte: ['Sem ditado nesta plataforma.', 'O reconhecimento de voz roda no macOS e no Linux (Intel e ARM).'],
	gravador: linux
		? ['Sem gravador de áudio.', 'Instale o pulseaudio-utils, o pipewire ou o alsa-utils (ex: sudo apt install pulseaudio-utils) e clique no microfone de novo.']
		: ['Sem gravador de áudio.', 'Instale o ffmpeg (brew install ffmpeg) e clique no microfone de novo.'],
	permissao: linux
		? ['Sem acesso ao microfone.', 'Confira se há um microfone conectado e se ele não está mudo no controle de som, e clique no microfone de novo.']
		: ['Sem acesso ao microfone.', 'Libere o Terminal em Ajustes do Sistema > Privacidade e Segurança > Microfone, reabra o Terminal e clique no microfone de novo.', 'Se já está liberado, confira o volume de entrada em Ajustes do Sistema > Som > Entrada.'],
};

// Fases: desligado, baixando (o modelo, com a fração em `progresso`),
// carregando (o modelo na memória) e ouvindo (`falando` enquanto capta fala).
// aoMudar recebe o estado a cada mudança e, quando algo dá errado ou o
// ditado para sozinho, `aviso`: suporte, gravador, permissao (ver
// comoResolver), silencio, baixar (o download falhou) ou falhou (o modelo
// não abriu). `alvo()` diz o pane onde digitar: a conversa na tela.
export class Ditado {
	constructor(alvo, aoMudar) {
		this.alvo = alvo;
		this.aoMudar = aoMudar;
		this.fase = 'desligado';
		this.falando = false;
		this.progresso = null;
		this.ouvinte = null;
		// Cada ligar conta uma vez: religado durante o download, só o último
		// pedido abre o microfone quando ele acabar.
		this.vez = 0;
		// Frases ditas enquanto a conversa espera uma escolha (permissão,
		// pergunta): lá, uma tecla solta escolheria uma opção. Ficam para
		// quando ela voltar a aceitar texto.
		this.guardadas = [];
		// Ouvintes até esta vez não digitam mais: a mensagem já foi enviada.
		this.descartados = 0;
	}

	mudar(campos, aviso) {
		Object.assign(this, campos);
		this.aoMudar({fase: this.fase, falando: this.falando, progresso: this.progresso, aviso});
	}

	alternar() {
		if (this.fase === 'desligado') this.ligar();
		else this.desligar();
	}

	ligar() {
		if (!suportaNatural) return this.mudar({}, 'suporte');
		if (temModelo()) return this.ouvir();
		const vez = ++this.vez;
		this.mudar({fase: 'baixando', progresso: null});
		baixar({nome, url, arquivos, extras: {'silero_vad.onnx': urlVad}, aoProgredir: progresso => {
			if (this.fase === 'baixando') this.mudar({progresso});
		}}).then(ok => {
			// Desligado enquanto baixava: o download termina, mas não ouve.
			if (this.fase !== 'baixando' || vez !== this.vez) return;
			if (ok) this.ouvir();
			else this.mudar({fase: 'desligado'}, 'baixar');
		});
	}

	ouvir() {
		this.vez++;
		this.mudar({fase: 'carregando', falando: false});
		const processo = spawn(ouvinte[0], [...ouvinte.slice(1), pasta], {stdio: ['ignore', 'pipe', 'ignore']});
		processo.vez = this.vez;
		this.ouvinte = processo;
		// Só o ouvinte atual muda o estado; um desligado ainda digita o que
		// estava transcrevendo quando foi parado.
		const atual = () => this.ouvinte === processo;
		let primeira = true;
		let resto = '';
		let aviso;
		// A frase vai para a conversa que estava na tela quando ela começou,
		// mesmo que outra tenha entrado enquanto era transcrita.
		let destino = this.alvo();
		processo.stdout.on('data', dados => {
			const linhas = (resto + dados).split('\n');
			resto = linhas.pop();
			for (const linha of linhas) {
				let evento;
				try {
					evento = JSON.parse(linha);
				} catch {
					continue;
				}
				if (evento.evento === 'texto') {
					if (processo.vez <= this.descartados) continue;
					this.digitar(destino, primeira ? evento.texto : ` ${evento.texto}`);
					primeira = false;
				} else if (!atual()) continue;
				else if (evento.evento === 'ouvindo') this.mudar({fase: 'ouvindo'});
				else if (evento.evento === 'voz') {
					if (evento.falando) destino = this.alvo() ?? destino;
					this.mudar({falando: evento.falando});
				}
				else aviso = evento.evento;
			}
		});
		const fim = codigo => {
			if (!atual()) return;
			this.ouvinte = null;
			this.mudar({fase: 'desligado', falando: false}, aviso ?? (codigo ? 'falhou' : undefined));
		};
		processo.on('exit', fim);
		processo.on('error', () => fim(1));
	}

	digitar(pane, texto) {
		if (!pane) return;
		this.guardadas.push({pane, texto});
		this.descarregar();
	}

	// Digita as frases guardadas das conversas que aceitam texto. Uma
	// conversa rolada para trás (copy-mode do tmux) leria as teclas como
	// comandos: volta ao fim antes.
	descarregar() {
		this.guardadas = this.guardadas.filter(({pane, texto}) => {
			try {
				const [status, modo] = tmux('display', '-p', '-t', pane, '#{@status}\t#{pane_in_mode}').split('\t');
				if (status === 'esperando') return true;
				if (modo === '1') tmux('send-keys', '-t', pane, '-X', 'cancel');
				tmux('send-keys', '-t', pane, '-l', '--', texto);
			} catch {}
			return false;
		});
	}

	// Para de ouvir na hora; o que já foi dito ainda é transcrito e digitado,
	// a menos que a mensagem já tenha sido enviada (descartar).
	desligar(descartar) {
		const processo = this.ouvinte;
		this.ouvinte = null;
		if (descartar) {
			// Inclusive o de um ditado já desligado que ainda transcrevia.
			this.descartados = this.vez;
			this.guardadas = [];
		}
		this.vez++;
		processo?.kill();
		if (this.fase !== 'desligado') this.mudar({fase: 'desligado', falando: false});
	}
}
