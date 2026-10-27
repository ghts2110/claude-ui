// Cabeçalho fixo acima da conversa (pane criado em bin/main-pane). Quando o
// logo que o Claude Code desenha no início da conversa que está na tela
// (mascote, versão, modelo · plano, pasta) rola para fora, aparece com uma
// cópia dele.
// Se o logo não estiver mais no histórico, mostra versão, plano e pasta.
import React, {useEffect, useState} from 'react';
import {render, Box, Text, useStdout} from 'ink';
import {execFileSync} from 'node:child_process';
import {naTela, tmux} from './conversas.js';

const h = React.createElement;
const semCor = linha => linha.replace(/\x1b\[[0-9;:]*m/g, '');
const apagado = '#6b7280';

const claude = (...args) => execFileSync(process.env.CLAUDE_UI_CLAUDE, args, {encoding: 'utf8', stdio: 'pipe', timeout: 10000});
// Como no logo: plano da assinatura, cobrança por API ou o provedor (Bedrock,
// Vertex, ...); o que não se souber fica de fora.
const planos = {pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise'};
const provedores = {bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI', foundry: 'Microsoft Foundry'};
let versao, plano;
try {
	versao = claude('--version').match(/\d+\.\d+\.\d+\S*/)?.[0];
} catch {}
try {
	const {authMethod, apiProvider, subscriptionType} = JSON.parse(claude('auth', 'status'));
	if (apiProvider && apiProvider !== 'firstParty') plano = provedores[apiProvider];
	else if (authMethod === 'api_key' || authMethod === 'api_key_helper') plano = 'API Usage Billing';
	else plano = planos[subscriptionType];
} catch {}

// O logo fica no topo do histórico do pane; guardado por conversa para
// continuar aparecendo se um redesenho do claude o tirar de lá.
const logos = new Map();
const vistos = new Set();
function ler() {
	const sidebar = tmux('show', '-qv', '@sidebar');
	const id = naTela(sidebar);
	const [historico, pasta] = tmux('display', '-p', '-t', id, '#{history_size}\t#{pane_current_path}').split('\t');
	const inicio = -Number(historico);
	// Sem o trim do tmux(): o espaço no começo da primeira linha alinha o mascote.
	const linhas = execFileSync('tmux', ['capture-pane', '-p', '-e', '-t', id, '-S', String(inicio), '-E', String(inicio + 15)], {encoding: 'utf8'}).split('\n');
	const i = linhas.findIndex(linha => /Claude Code v\d/.test(semCor(linha)));
	// A caixa grande de boas-vindas (╭─ Claude Code vX ─╮) não cabe em 3 linhas.
	const logo = linhas.slice(i, i + 3);
	if (i >= 0 && !logo.some(linha => /^\s*[╭│]/.test(semCor(linha)))) logos.set(id, logo);
	if (i >= 0) vistos.add(id);
	// O original ainda na tela (a linha i não foi para o histórico): sem
	// cabeçalho. Na tela alternativa do claude não há histórico; lá, logo já
	// visto ou prompt desenhado sem logo (ex: `claude -c` aberto no fim da
	// conversa) quer dizer que ele rolou para fora. Sem nada disso, a conversa
	// acabou de abrir.
	const visivel = i >= 0 && i >= Number(historico);
	const aparecer = !visivel && (vistos.has(id) || Number(historico) > 0 || tmux('capture-pane', '-p', '-t', id).includes('❯'));
	posicionar(sidebar, id, aparecer);
	const home = process.env.HOME;
	return {logo: logos.get(id), pasta: home && pasta.startsWith(home) ? '~' + pasta.slice(home.length) : pasta};
}

// Aparecer é entrar acima da conversa na janela do sidebar; sumir é voltar
// para uma janela própria, como as conversas guardadas. Com o sidebar
// escondido (zoom) não mexe: o join tiraria o zoom.
const cabecalho = process.env.TMUX_PANE;
function posicionar(sidebar, conversa, aparecer) {
	const [janela, zoom] = tmux('display', '-p', '-t', sidebar, '#{window_id} #{window_zoomed_flag}').split(' ');
	const aqui = tmux('display', '-p', '-t', cabecalho, '#{window_id}') === janela;
	if (zoom === '1' || aparecer === aqui) return;
	if (aparecer) tmux('join-pane', '-d', '-v', '-b', '-l', '3', '-s', cabecalho, '-t', conversa);
	else tmux('break-pane', '-d', '-s', cabecalho);
}

function Cabecalho() {
	const {stdout} = useStdout();
	const [estado, setEstado] = useState({});
	useEffect(() => {
		// Só redesenha quando muda: o Ink reescreve o pane inteiro a cada render.
		let anterior;
		const atualizar = () => {
			try {
				const novo = ler();
				const chave = JSON.stringify(novo);
				if (chave !== anterior) {
					anterior = chave;
					setEstado(novo);
				}
			} catch {}
		};
		atualizar();
		// A troca de conversa avisa (sidebar/conversas.js, bin/conversa); o
		// intervalo cobre a rolagem.
		process.on('SIGUSR2', atualizar);
		const intervalo = setInterval(atualizar, 500);
		stdout.on('resize', atualizar);
		return () => {
			clearInterval(intervalo);
			process.off('SIGUSR2', atualizar);
			stdout.off('resize', atualizar);
		};
	}, []);

	const linha = (key, ...filhos) => h(Text, {key, wrap: 'truncate-end'}, ...filhos);
	const linhas = estado.logo
		? estado.logo.map((texto, i) => linha(i, texto))
		: [
			linha(1, h(Text, {bold: true}, ' Claude Code'), versao ? h(Text, {color: apagado}, ` v${versao}`) : ''),
			linha(2, h(Text, {color: apagado}, plano ? ` ${plano}` : '')),
			linha(3, h(Text, {color: apagado}, estado.pasta ? ` ${estado.pasta}` : '')),
		];
	return h(Box, {flexDirection: 'column', height: 3, overflow: 'hidden'}, linhas);
}

// O cabeçalho não recebe teclas: ao ganhar o foco (clique, Ctrl-\), o passa
// para a conversa. O tmux avisa o foco com \e[I quando o pane o pede.
process.stdin.setRawMode?.(true);
process.stdin.on('data', dados => {
	if (dados.includes('\x1b[I')) {
		try {
			tmux('select-pane', '-t', naTela(tmux('show', '-qv', '@sidebar')));
		} catch {}
	}
});
process.stdout.write('\x1b[?1004h\x1b[?25l');
process.on('exit', () => process.stdout.write('\x1b[?1004l\x1b[?25h'));

render(h(Cabecalho), {exitOnCtrlC: false, patchConsole: false});
