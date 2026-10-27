// Ouve o microfone e transcreve com o Whisper turbo (via sherpa-onnx), no
// próprio computador. Uso: node ouvir.js <pasta do modelo>. O VAD (Silero)
// separa as falas pelas pausas; cada uma é transcrita assim que acaba e sai
// como uma linha JSON na saída, para o sidebar digitar (ver sidebar/ditado.js):
//   {"evento":"ouvindo"}            modelo carregado, microfone aberto
//   {"evento":"voz","falando":true} começou (ou parou) a captar fala
//   {"evento":"texto","texto":"…"}  uma fala transcrita
//   {"evento":"silencio"}           muito tempo sem fala: para sozinho
//   {"evento":"permissao"}          o microfone só dá silêncio absoluto ou
//                                   recusa abrir: acesso negado
//   {"evento":"gravador"}           nenhum gravador instalado
// Morto (SIGTERM), fecha o microfone, transcreve o que já ouviu e sai.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {join} from 'node:path';

const sherpa = createRequire(import.meta.url)('sherpa-onnx-node');
const pasta = process.argv[2];
const taxa = 16000;
// Sem fala por esse tempo, para de ouvir.
const silencio = Number(process.env.CLAUDE_UI_DITADO_SILENCIO) || 20;

const avisar = evento => {
	try {
		process.stdout.write(`${JSON.stringify(evento)}\n`);
	} catch {}
};
// Sidebar morto: a saída fecha, e não há para quem digitar.
process.stdout.on('error', () => process.exit());
process.on('uncaughtException', () => {
	gravador?.kill();
	process.exit(1);
});

// O primeiro gravador que existir, todos em PCM 16 bits mono a 16 kHz na
// saída. No macOS o sistema não traz um de linha de comando: ffmpeg ou sox
// (brew install ffmpeg). No Linux, PulseAudio, PipeWire, ALSA.
const pcm = ['-ac', '1', '-ar', String(taxa), '-f', 's16le', '-'];
const sox = ['rec', '-q', '-t', 'raw', '-b', '16', '-e', 'signed-integer', '-c', '1', '-r', String(taxa), '-'];
const gravadores = process.platform === 'darwin'
	? [['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'avfoundation', '-i', 'none:default', ...pcm], sox]
	: [
		['parec', '--format=s16le', `--rate=${taxa}`, '--channels=1'],
		['pw-record', '--format', 's16', '--rate', String(taxa), '--channels', '1', '-'],
		['arecord', '-q', '-f', 'S16_LE', '-r', String(taxa), '-c', '1', '-t', 'raw'],
		['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'pulse', '-i', 'default', ...pcm],
		sox,
	];

let gravador = null;
let encerrando = false;

const reconhecedor = await sherpa.OfflineRecognizer.createAsync({
	featConfig: {sampleRate: taxa, featureDim: 80},
	modelConfig: {
		whisper: {
			encoder: join(pasta, 'turbo-encoder.int8.onnx'),
			decoder: join(pasta, 'turbo-decoder.int8.onnx'),
			language: 'pt',
			task: 'transcribe',
		},
		tokens: join(pasta, 'turbo-tokens.txt'),
		numThreads: 4,
	},
});
// Uma fala acaba depois de meio segundo de pausa; o Whisper só aceita 30s,
// então uma fala longa sem pausa é cortada antes.
const vad = new sherpa.Vad({
	sileroVad: {
		model: join(pasta, 'silero_vad.onnx'),
		threshold: 0.5,
		minSilenceDuration: 0.5,
		minSpeechDuration: 0.25,
		maxSpeechDuration: 20,
		windowSize: 512,
	},
	sampleRate: taxa,
	numThreads: 1,
}, 60);

// O Whisper inventa frases em ruído e silêncio (vícios das legendas com que
// foi treinado): essas nunca são o que foi dito.
const inventadas = /amara\.org|legendas? (pela|por)|inscreva-se|obrigad[oa] por assistir|^\W*$/i;

// Uma transcrição por vez, na ordem das falas.
let fila = Promise.resolve();
function transcrever(amostras) {
	fila = fila.then(async () => {
		const stream = reconhecedor.createStream();
		stream.acceptWaveform({sampleRate: taxa, samples: amostras});
		await reconhecedor.decodeAsync(stream);
		const texto = reconhecedor.getResult(stream).text.trim();
		if (texto && !inventadas.test(texto)) avisar({evento: 'texto', texto});
	}).catch(() => {});
}
// O VAD só marca o começo da fala uns décimos depois dele: a primeira
// palavra curta ("oi") se perderia. Guarda o áudio recente para devolver à
// fala o meio segundo antes do começo marcado.
const margem = taxa / 2;
const recentes = [];
function lembrar(amostras, inicio) {
	recentes.push({amostras, inicio});
	while (recentes[0].inicio < inicio - 40 * taxa) recentes.shift();
}
function trecho(de, ate) {
	const saida = new Float32Array(Math.max(0, ate - de));
	for (const {amostras, inicio} of recentes) {
		const a = Math.max(de, inicio);
		const b = Math.min(ate, inicio + amostras.length);
		if (a < b) saida.set(amostras.subarray(a - inicio, b - inicio), a - de);
	}
	return saida;
}
function colher() {
	while (!vad.isEmpty()) {
		const {samples, start} = vad.front(false);
		const antes = trecho(Math.max(0, start - margem), start);
		const fala = new Float32Array(antes.length + samples.length);
		fala.set(antes);
		fala.set(samples, antes.length);
		transcrever(fala);
		vad.pop();
	}
}

async function encerrar(evento) {
	if (encerrando) return;
	encerrando = true;
	gravador?.kill();
	if (evento) avisar({evento});
	vad.flush();
	colher();
	await fila;
	process.exit();
}
for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sinal, () => encerrar());

const janela = 512;
let resto = Buffer.alloc(0);
let pendente = new Float32Array(0);
let recebido = 0;
// Amostras já passadas ao VAD: a posição que ele usa no começo das falas.
let enviado = 0;
let somAlgum = false;
let falando = false;
let ultimaFala = 0;

function ouvir(dados) {
	if (encerrando) return;
	const bytes = Buffer.concat([resto, dados]);
	const n = Math.floor(bytes.length / 2);
	resto = bytes.subarray(n * 2);
	const amostras = new Float32Array(pendente.length + n);
	amostras.set(pendente);
	for (let i = 0; i < n; i++) {
		const valor = bytes.readInt16LE(i * 2);
		if (valor) somAlgum = true;
		amostras[pendente.length + i] = valor / 32768;
	}
	recebido += n;
	// Acesso negado no macOS: o microfone abre, mas só manda zeros.
	if (!somAlgum && recebido >= 2 * taxa) return encerrar('permissao');
	let i = 0;
	for (; i + janela <= amostras.length; i += janela) {
		const pedaco = amostras.slice(i, i + janela);
		lembrar(pedaco, enviado);
		enviado += janela;
		vad.acceptWaveform(pedaco);
		const agora = vad.isDetected();
		if (agora !== falando) {
			falando = agora;
			avisar({evento: 'voz', falando});
		}
		if (agora) ultimaFala = recebido;
	}
	pendente = amostras.slice(i);
	colher();
	if (recebido - ultimaFala > silencio * taxa) encerrar('silencio');
}

function abrir(i = 0) {
	if (i >= gravadores.length) return encerrar('gravador');
	const [comando, ...args] = gravadores[i];
	const proximo = spawn(comando, args, {stdio: ['ignore', 'pipe', 'ignore']});
	gravador = proximo;
	let chegou = false;
	proximo.stdout.on('data', dados => {
		chegou = true;
		ouvir(dados);
	});
	proximo.on('error', () => abrir(i + 1));
	// Saiu sem mandar nada: o microfone não abriu (acesso negado ou sem
	// microfone). Saiu depois: o microfone sumiu (ex: fone desconectado).
	proximo.on('exit', () => {
		if (gravador === proximo && !encerrando) encerrar(chegou ? undefined : 'permissao');
	});
}

avisar({evento: 'ouvindo'});
abrir();
