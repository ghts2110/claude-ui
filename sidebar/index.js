import React, {useEffect, useState} from 'react';
import {execFileSync} from 'node:child_process';
import {render, Box, Text, useInput, useStdout} from 'ink';

const h = React.createElement;
const sidebar = process.env.TMUX_PANE;

const tmux = (...args) => execFileSync('tmux', args, {encoding: 'utf8', stdio: 'pipe'}).trim();
const naTela = () => tmux('list-panes', '-t', sidebar, '-F', '#{pane_id} #{@conversa}')
	.split('\n').map(linha => linha.split(' ')).find(([, n]) => n)?.[0];

// Conversas são os panes marcados com @conversa (ver bin/conversa). A que
// divide a janela com o sidebar é a que está na tela; as outras ficam
// guardadas, cada uma na sua janela.
function ler() {
	const janela = tmux('display', '-p', '-t', sidebar, '#{window_id}');
	const conversas = tmux('list-panes', '-s', '-F', '#{pane_id}\t#{@conversa}\t#{window_id}')
		.split('\n')
		.map(linha => linha.split('\t'))
		.filter(([, n]) => n)
		.map(([id, n, w]) => ({id, n: Number(n), naTela: w === janela}))
		.sort((a, b) => a.n - b.n);
	const focado = tmux('display', '-p', '-t', sidebar, '#{pane_active}') === '1';
	return {conversas, focado};
}

function criar() {
	return tmux('new-window', '-d', '-P', '-F', '#{pane_id}', '--',
		`${process.env.CLAUDE_UI_ROOT}/bin/conversa`);
}

// Traz a conversa para a área principal; a que estava lá vai para a janela dela.
// A janela guardada assume antes o tamanho da área principal, para o claude
// não ser redimensionado a cada troca.
function mostrar(id) {
	const atual = naTela();
	if (!atual || atual === id) return;
	const [largura, altura] = tmux('display', '-p', '-t', atual, '#{pane_width} #{pane_height}').split(' ');
	tmux('resize-window', '-t', id, '-x', largura, '-y', altura);
	tmux('swap-pane', '-d', '-s', id, '-t', atual);
}

function fechar(id, conversas) {
	const i = conversas.findIndex(c => c.id === id);
	if (naTela() === id) {
		const vizinha = conversas[i + 1] ?? conversas[i - 1];
		mostrar(vizinha ? vizinha.id : criar());
	}
	tmux('kill-pane', '-t', id);
}

function Conversa({conversa, sobCursor}) {
	const cor = sobCursor ? 'cyan' : conversa.naTela ? undefined : 'gray';
	return h(
		Box,
		{borderStyle: 'round', borderColor: cor ?? 'white', paddingX: 1, flexShrink: 0},
		h(Text, {color: conversa.naTela ? undefined : 'gray'}, conversa.naTela ? '● ' : '○ '),
		h(Text, {bold: conversa.naTela, color: cor}, `conversa ${conversa.n}`),
	);
}

function Sidebar() {
	const {stdout} = useStdout();
	const [linhas, setLinhas] = useState(stdout.rows);
	const [estado, setEstado] = useState(ler);
	const [cursor, setCursor] = useState(null);
	// Id da conversa a fechar, enquanto espera o "s".
	const [confirmar, setConfirmar] = useState(null);
	const atualizar = () => {
		try {
			setEstado(ler());
		} catch {}
	};

	useEffect(() => {
		const redimensionar = () => setLinhas(stdout.rows);
		stdout.on('resize', redimensionar);
		// Hooks do tmux avisam quando o foco muda ou uma conversa sai; o
		// intervalo cobre o resto (ex: conversa nova ainda sem @conversa).
		process.on('SIGUSR2', atualizar);
		const aviso = `run-shell -b 'kill -USR2 ${process.pid}'`;
		tmux('set-hook', '-g', 'pane-focus-in', aviso);
		tmux('set-hook', '-g', 'pane-exited', aviso);
		const intervalo = setInterval(atualizar, 1000);
		// Pede ao tmux os cliques e a rodinha do mouse, no formato SGR.
		stdout.write('\x1b[?1000h\x1b[?1006h');
		process.on('exit', () => {
			stdout.write('\x1b[?1000l\x1b[?1006l');
			try {
				tmux('set-hook', '-gu', 'pane-focus-in');
				tmux('set-hook', '-gu', 'pane-exited');
			} catch {}
		});
		return () => {
			stdout.off('resize', redimensionar);
			process.off('SIGUSR2', atualizar);
			clearInterval(intervalo);
		};
	}, []);

	const {conversas, focado} = estado;
	// O cursor segue a conversa pelo id; sem cursor, fica na que está na tela.
	let i = conversas.findIndex(c => c.id === cursor);
	if (i < 0) i = Math.max(0, conversas.findIndex(c => c.naTela));
	const sob = conversas[i];

	// Ao ganhar o foco, o cursor volta para a conversa na tela: assim
	// Ctrl-\ x sempre mira a conversa que se está vendo.
	useEffect(() => {
		setConfirmar(null);
		if (focado) setCursor(null);
	}, [focado]);

	// A conversa a fechar saiu sozinha enquanto esperava o "s": desiste.
	const alvo = conversas.find(c => c.id === confirmar);
	useEffect(() => {
		if (confirmar && !alvo) setConfirmar(null);
	}, [confirmar, alvo]);

	// Um pane pode sumir entre a leitura e a ação (até 1s); o comando do tmux
	// falha e a lista é relida, sem derrubar o sidebar.
	const agir = acao => {
		try {
			acao();
		} catch {}
		atualizar();
	};

	const abrir = id =>
		agir(() => {
			mostrar(id);
			tmux('select-pane', '-t', id);
		});

	// Só cabem algumas conversas: mostra a fatia em volta do cursor.
	const cabem = Math.max(1, Math.floor((linhas - 5) / 3));
	const inicio = Math.min(Math.max(0, i - Math.floor(cabem / 2)), Math.max(0, conversas.length - cabem));
	const visiveis = conversas.slice(inicio, inicio + cabem);

	// Clique (botão 0) abre a conversa; a rodinha (64/65) move o cursor. Os
	// botões começam na linha 3 e têm 3 linhas cada.
	function mouse(botao, linha) {
		if (botao === 64) setCursor(conversas[Math.max(0, i - 1)]?.id);
		else if (botao === 65) setCursor(conversas[Math.min(conversas.length - 1, i + 1)]?.id);
		else if (botao === 0 && linha >= 3) {
			const conversa = visiveis[Math.floor((linha - 3) / 3)];
			if (conversa) {
				setConfirmar(null);
				setCursor(conversa.id);
				abrir(conversa.id);
			}
		}
	}

	useInput((input, key) => {
		const eventos = [...input.matchAll(/\[<(\d+);\d+;(\d+)([Mm])/g)];
		if (eventos.length) {
			for (const [, botao, linha, tipo] of eventos) {
				if (tipo === 'M') mouse(Number(botao), Number(linha));
			}
			return;
		}

		if (confirmar) {
			setConfirmar(null);
			if (input === 's' && alvo) {
				// Fechada, o foco volta para a conversa que ficou na tela.
				agir(() => {
					fechar(alvo.id, conversas);
					tmux('select-pane', '-t', naTela());
				});
			}
			return;
		}

		if (key.upArrow || input === 'k') setCursor(conversas[Math.max(0, i - 1)]?.id);
		else if (key.downArrow || input === 'j') setCursor(conversas[Math.min(conversas.length - 1, i + 1)]?.id);
		else if (key.return && sob) abrir(sob.id);
		else if (input === 'n') {
			agir(() => {
				const id = criar();
				mostrar(id);
				tmux('select-pane', '-t', id);
				setCursor(id);
			});
		} else if (input === 'x' && sob) setConfirmar(sob.id);
		else if (key.escape) agir(() => tmux('select-pane', '-t', naTela()));
	});

	let rodape;
	if (confirmar) rodape = [h(Text, {key: 1, color: 'yellow'}, `fechar conversa ${alvo?.n}?`), h(Text, {key: 2, dimColor: true}, 's sim · n não')];
	else if (focado) rodape = [h(Text, {key: 1, dimColor: true}, '↑↓ enter  abrir'), h(Text, {key: 2, dimColor: true}, 'n nova · x fechar'), h(Text, {key: 3, dimColor: true}, 'esc  voltar')];
	else rodape = [h(Text, {key: 1, dimColor: true}, 'ctrl+\\ n  nova'), h(Text, {key: 2, dimColor: true}, 'ctrl+\\ x  fechar')];

	return h(
		Box,
		{flexDirection: 'column', paddingX: 1, height: linhas},
		h(Text, {bold: true}, 'Conversas'),
		h(
			Box,
			{flexDirection: 'column', marginTop: 1, flexGrow: 1, overflow: 'hidden'},
			visiveis.map(c =>
				h(Conversa, {key: c.id, conversa: c, sobCursor: focado && c === sob}),
			),
		),
		h(Box, {flexDirection: 'column', height: 3, flexShrink: 0, justifyContent: 'flex-end'}, rodape),
	);
}

render(h(Sidebar), {exitOnCtrlC: false});
