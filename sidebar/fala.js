// Fala com a voz natural (Piper pt_BR faber, via sherpa-onnx): lê o texto da
// entrada e gera o áudio frase a frase, tocando cada uma assim que fica
// pronta enquanto a seguinte é gerada, para começar a falar logo. Uso:
// node fala.js <pasta da voz>. Morto (Esc, texto novo), cala o tocador e
// apaga os áudios temporários.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sherpa = createRequire(import.meta.url)('sherpa-onnx-node');
const pasta = process.argv[2];

let tocando = null;
const arquivos = new Set();
const sair = () => {
	tocando?.kill();
	for (const arquivo of arquivos) rmSync(arquivo, {force: true});
	process.exit();
};
for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sinal, sair);
// Qualquer erro (modelo estragado, disco cheio, sem tocador) também cala e
// limpa, saindo com código de erro: o sidebar passa para a voz do sistema.
const falhar = () => {
	process.exitCode = 1;
	sair();
};
process.on('uncaughtException', falhar);
process.on('unhandledRejection', falhar);

// No Linux, o primeiro tocador que existir (PulseAudio, PipeWire, ALSA).
const tocadores = process.platform === 'darwin' ? [['afplay']] : [['paplay'], ['pw-play'], ['aplay', '-q']];
function tocar(arquivo, i = 0) {
	return new Promise((resolve, reject) => {
		if (i >= tocadores.length) return reject(new Error('sem tocador de áudio'));
		const [comando, ...args] = tocadores[i];
		tocando = spawn(comando, [...args, arquivo], {stdio: 'ignore'});
		tocando.on('exit', resolve);
		tocando.on('error', () => tocar(arquivo, i + 1).then(resolve, reject));
	});
}

let texto = '';
for await (const pedaco of process.stdin) texto += pedaco;
const frases = texto.split(/(?<=[.!?…;:])\s+/).filter(frase => frase.trim());

try {
	const tts = await sherpa.OfflineTts.createAsync({
		model: {
			vits: {
				model: join(pasta, 'pt_BR-faber-medium.onnx'),
				tokens: join(pasta, 'tokens.txt'),
				dataDir: join(pasta, 'espeak-ng-data'),
			},
			numThreads: 2,
		},
	});

	let fila = Promise.resolve();
	for (const [i, frase] of frases.entries()) {
		const audio = await tts.generateAsync({text: frase, sid: 0, speed: 1});
		const arquivo = join(tmpdir(), `claude-ui-fala-${process.pid}-${i}.wav`);
		arquivos.add(arquivo);
		sherpa.writeWave(arquivo, {samples: audio.samples, sampleRate: audio.sampleRate});
		fila = fila.then(() => tocar(arquivo)).then(() => {
			rmSync(arquivo, {force: true});
			arquivos.delete(arquivo);
		});
	}
	await fila;
} catch {
	falhar();
}
