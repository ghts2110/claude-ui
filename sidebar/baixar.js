// Modelos baixados na primeira vez que são usados: a voz natural da leitura
// (sidebar/voz.js) e o reconhecimento do ditado (sidebar/ditado.js). Ficam
// no cache do usuário: a única coisa que o claude-ui guarda em disco.
import {spawn} from 'node:child_process';
import {createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'claude-ui');

// Modelo completo: todos os arquivos na pasta dele.
export const tem = (pasta, arquivos) => arquivos.every(f => existsSync(join(pasta, f)));

const vivo = pid => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (erro) {
		return erro.code === 'EPERM';
	}
};

// Traz uma URL para um stream; parado por um minuto sem chegar nada, desiste.
// aoChegar recebe a fração já baixada, quando o servidor diz o tamanho.
function trazer(url, destino, aoChegar) {
	const parar = new AbortController();
	let prazo;
	const esperar = () => {
		clearTimeout(prazo);
		prazo = setTimeout(() => parar.abort(), 60 * 1000);
	};
	esperar();
	return fetch(url, {signal: parar.signal})
		.then(resposta => {
			if (!resposta.ok) throw new Error(String(resposta.status));
			const total = Number(resposta.headers.get('content-length')) || 0;
			let chegou = 0;
			return pipeline(Readable.fromWeb(resposta.body), async function* (pedacos) {
				for await (const pedaco of pedacos) {
					esperar();
					chegou += pedaco.length;
					if (total) aoChegar?.(chegou / total);
					yield pedaco;
				}
			}, destino);
		})
		.finally(() => clearTimeout(prazo));
}

// Baixa o .tar.bz2 em `url` e extrai numa pasta temporária, renomeada só no
// fim: um download interrompido nunca vira modelo pela metade. `nome` é a
// pasta de dentro do pacote e vira <cache>/<nome>; `extras` ({arquivo: url})
// entram nela antes do rename. Resolve com true se o modelo ficou completo
// (com os `arquivos`), false se falhou (sem internet, por exemplo). Um
// download por modelo; quem pedir de novo enquanto ele baixa recebe o mesmo,
// e aoProgredir passa a receber a fração baixada do pacote.
const baixando = new Map();
export function baixar({nome, url, arquivos, extras = {}, aoProgredir}) {
	const pasta = join(cache, nome);
	let atual = baixando.get(nome);
	if (atual) {
		if (aoProgredir) atual.ouvintes.add(aoProgredir);
		return atual.promessa;
	}
	atual = {ouvintes: new Set(aoProgredir ? [aoProgredir] : [])};
	baixando.set(nome, atual);
	atual.promessa = new Promise(resolve => {
		const temp = `${pasta}.baixando-${process.pid}`;
		// Sobras de downloads de sidebars mortos (kill -9, crash).
		try {
			for (const sobra of readdirSync(cache)) {
				const pid = Number(sobra.match(/\.baixando-(\d+)$/)?.[1]);
				if (pid && pid !== process.pid && !vivo(pid)) rmSync(join(cache, sobra), {recursive: true, force: true});
			}
		} catch {}
		const limpar = () => rmSync(temp, {recursive: true, force: true});
		let pronto = false;
		const fim = ok => {
			if (pronto) return;
			pronto = true;
			if (ok) {
				try {
					// Um modelo incompleto no lugar (ex: arquivo apagado à mão)
					// impediria o rename.
					if (!tem(pasta, arquivos)) rmSync(pasta, {recursive: true, force: true});
					renameSync(join(temp, nome), pasta);
				} catch {}
			}
			limpar();
			process.off('exit', limpar);
			baixando.delete(nome);
			resolve(tem(pasta, arquivos));
		};
		try {
			limpar();
			mkdirSync(temp, {recursive: true});
		} catch {
			return fim(false);
		}
		process.on('exit', limpar);
		const progredir = fracao => {
			for (const ouvinte of atual.ouvintes) ouvinte(fracao);
		};
		const tar = spawn('tar', ['xjf', '-', '-C', temp], {stdio: ['pipe', 'ignore', 'ignore']});
		const extraido = new Promise(ok => {
			tar.on('error', () => ok(false));
			tar.on('exit', codigo => ok(codigo === 0));
		});
		tar.stdin.on('error', () => {});
		trazer(url, tar.stdin, progredir).catch(() => tar.kill());
		extraido
			.then(async ok => {
				if (!ok) return false;
				for (const [arquivo, endereco] of Object.entries(extras)) await trazer(endereco, createWriteStream(join(temp, nome, arquivo)));
				return tem(join(temp, nome), arquivos);
			})
			.then(fim, () => fim(false));
	});
	return atual.promessa;
}
