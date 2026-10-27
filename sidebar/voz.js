// Leitura em voz alta (alto-falante no rodapé do sidebar): fala o texto que
// o claude da conversa na tela acabou de escrever, offline e sem custo, com a
// voz natural (Piper, ver sidebar/fala.js) ou, enquanto ela não está baixada,
// com a voz pt-br do sistema (`say` no macOS, `espeak-ng` no Linux).
// O texto vem do transcript da conversa (o .jsonl que o Claude Code grava,
// um bloco por linha assim que ele fica pronto); o caminho chega pelos hooks
// em @transcript (ver sidebar/status.js). Só o que aparece depois de ligar é
// lido: ao ligar ou trocar de conversa, a leitura começa do fim do arquivo.
import {execFile, spawn} from 'node:child_process';
import {closeSync, existsSync, openSync, readSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {baixar, cache, tem} from './baixar.js';
import {tmux} from './conversas.js';

const linux = process.platform !== 'darwin';

// A voz natural é baixada na primeira vez que a leitura é ligada (~67 MB),
// para o cache do usuário (ver sidebar/baixar.js). O sherpa-onnx-node traz o
// binário pronto para macOS e Linux (x64 e arm64); em outra plataforma, fica
// a voz do sistema.
const nome = 'vits-piper-pt_BR-faber-medium';
const pastaNatural = join(cache, nome);
const modelo = 'pt_BR-faber-medium.onnx';
const arquivos = [modelo, 'tokens.txt', 'espeak-ng-data'];
const url = process.env.CLAUDE_UI_VOZ_URL || `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${nome}.tar.bz2`;

// Sem carregar o binário no sidebar: só confere que o npm instalou o da
// plataforma, ao lado do sherpa-onnx-node.
export const suportaNatural = (() => {
	try {
		const pacote = dirname(createRequire(import.meta.url).resolve('sherpa-onnx-node'));
		return existsSync(join(pacote, '..', `sherpa-onnx-${process.platform}-${process.arch}`, 'sherpa-onnx.node'));
	} catch {
		return false;
	}
})();

const vozNatural = () => ({comando: process.execPath, args: [fileURLToPath(new URL('fala.js', import.meta.url)), pastaNatural], natural: true});
export const temNatural = () => suportaNatural && tem(pastaNatural, arquivos);

// Resolve com a voz natural, ou nada se o download falhou.
export const baixarNatural = () => baixar({nome, url, arquivos}).then(ok => (ok && suportaNatural ? vozNatural() : undefined));

// Voz pt-br, como comando que lê o texto da entrada: a natural, se já
// baixada; senão, a do sistema.
export function procurarVoz() {
	return temNatural() ? Promise.resolve(vozNatural()) : procurarSistema();
}

// Voz pt-br do sistema. Sem ela, nada: falar com a voz de outra língua sairia
// com sotaque errado. No macOS, as vozes melhores (Premium, Enhanced)
// primeiro, depois as comuns (Luciana, Felipe) antes das de efeito (Eddy,
// Grandma...), que vêm com parênteses.
export function procurarSistema() {
	return new Promise(resolve => {
		const [comando, args] = linux ? ['espeak-ng', ['--voices=pt']] : ['say', ['-v', '?']];
		execFile(comando, args, {timeout: 5000}, (erro, saida) => {
			if (erro) return resolve();
			if (linux) {
				const voz = saida.match(/\s(pt-br)\s/i)?.[1];
				return resolve(voz && {comando, args: ['-v', voz, '--stdin']});
			}
			const vozes = saida.split('\n').map(linha => linha.match(/^(.+?)\s+pt_BR\s+#/)?.[1]).filter(Boolean);
			const voz = vozes.find(v => /Premium/.test(v)) ?? vozes.find(v => /Enhanced/.test(v)) ?? vozes.find(v => !v.includes('(')) ?? vozes[0];
			resolve(voz && {comando, args: ['-v', voz]});
		});
	});
}

export const comoInstalar = linux
	? ['Sem voz em português do Brasil.', 'Instale o espeak-ng (ex: sudo apt install espeak-ng) e clique no alto-falante de novo.']
	: ['Sem voz em português do Brasil.', 'Instale em Ajustes do Sistema > Acessibilidade > Conteúdo Falado > Voz do Sistema > Gerenciar Vozes > Português (Brasil) e clique no alto-falante de novo.'];

// Só o texto corrido: sem blocos de código (diffs e saídas de comando vêm
// neles), tabelas e marcações do markdown. Cada linha vira uma frase, para a
// voz pausar entre os itens de uma lista.
export function limpar(texto) {
	let bloco = false;
	const linhas = [];
	for (const linha of texto.split('\n')) {
		if (/^\s*(```|~~~)/.test(linha)) {
			bloco = !bloco;
			continue;
		}
		if (bloco || /^\s*\|/.test(linha) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(linha)) continue;
		const limpa = linha
			.replace(/^\s*(#+|>+|[-*+]|\d+[.)])\s+/, '')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/https?:\/\/\S+/g, '')
			.replace(/`+/g, '')
			.replace(/(\*\*|__|~~)/g, '')
			.replace(/(^|\s)\*(\S[^*]*)\*/g, '$1$2')
			.trim();
		if (limpa) linhas.push(/[.!?:;,]$/.test(limpa) ? limpa : `${limpa}.`);
	}
	return linhas.join(' ');
}

const tamanho = caminho => {
	try {
		return statSync(caminho).size;
	} catch {
		return 0;
	}
};

// Segue o transcript de uma conversa e fala cada texto novo do claude. Um
// texto novo cala o anterior: sempre o que está sendo escrito agora. O pid
// da fala fica em @fala, para o Esc (tmux.conf) e uma mensagem nova (hook
// UserPromptSubmit) a interromperem. A voz natural que sai com erro (cache
// estragado, sem tocador no Linux) chama aoFalhar com o texto que não leu.
export class Leitor {
	constructor(voz, aoFalar, aoFalhar) {
		this.voz = voz;
		this.aoFalar = aoFalar;
		this.aoFalhar = aoFalhar;
		this.fala = null;
	}

	seguir(caminho) {
		if (caminho === this.caminho) return;
		this.calar();
		this.caminho = caminho;
		this.pos = caminho ? tamanho(caminho) : 0;
		this.resto = Buffer.alloc(0);
	}

	ler() {
		if (!this.caminho) return;
		const fim = tamanho(this.caminho);
		// Arquivo recriado (menor que antes): recomeça do fim dele.
		if (fim < this.pos) {
			this.pos = fim;
			this.resto = Buffer.alloc(0);
		}
		if (fim === this.pos) return;
		const novo = Buffer.alloc(fim - this.pos);
		try {
			const fd = openSync(this.caminho, 'r');
			try {
				readSync(fd, novo, 0, novo.length, this.pos);
			} finally {
				closeSync(fd);
			}
		} catch {
			return;
		}
		this.pos = fim;
		// Só linhas completas; o pedaço final espera o resto chegar.
		const dados = Buffer.concat([this.resto, novo]);
		const quebra = dados.lastIndexOf(10);
		this.resto = dados.subarray(quebra + 1);
		if (quebra < 0) return;
		const textos = [];
		for (const linha of dados.subarray(0, quebra).toString('utf8').split('\n')) {
			let item;
			try {
				item = JSON.parse(linha);
			} catch {
				continue;
			}
			// Subagentes e as mensagens que o próprio Claude Code inventa
			// (ex: "No response requested.") não contam.
			if (item.type !== 'assistant' || item.isSidechain || item.message?.model === '<synthetic>') continue;
			for (const bloco of item.message?.content ?? []) {
				if (bloco.type === 'text') textos.push(limpar(bloco.text));
			}
		}
		const texto = textos.filter(Boolean).join(' ');
		if (texto) this.falar(texto);
	}

	falar(texto) {
		this.calar();
		// Ligada só à espera da voz natural (sem voz do sistema), ou muda
		// enquanto o microfone ouve (ver sidebar/ditado.js): em silêncio.
		if (!this.voz || this.mudo) return;
		const voz = this.voz;
		const fala = spawn(voz.comando, voz.args, {stdio: ['pipe', 'ignore', 'ignore']});
		this.fala = fala;
		const fim = codigo => {
			if (this.fala !== fala) return;
			this.fala = null;
			marcar();
			this.aoFalar(false);
			if (voz.natural && codigo !== 0) this.aoFalhar?.(texto);
		};
		fala.on('exit', fim);
		fala.on('error', fim);
		fala.stdin.on('error', () => {});
		fala.stdin.end(texto);
		if (fala.pid) marcar(fala.pid);
		this.aoFalar(true);
	}

	calar() {
		const fala = this.fala;
		if (!fala) return;
		this.fala = null;
		fala.kill();
		marcar();
		this.aoFalar(false);
	}
}

export function marcar(pid) {
	try {
		if (pid) tmux('set', '-q', '@fala', String(pid));
		else tmux('set', '-qu', '@fala');
	} catch {}
}
