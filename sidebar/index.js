import React, {useEffect, useState} from 'react';
import {execFileSync} from 'node:child_process';
import {render, Box, Text, useInput, useStdout} from 'ink';

const h = React.createElement;
const sidebar = process.env.TMUX_PANE;

const tmux = (...args) => execFileSync('tmux', args, {encoding: 'utf8'}).trim();

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
function mostrar(id, conversas) {
	const atual = conversas.find(c => c.naTela);
	if (atual && atual.id !== id) tmux('swap-pane', '-d', '-s', id, '-t', atual.id);
}

function fechar(id, conversas) {
	const i = conversas.findIndex(c => c.id === id);
	if (conversas[i].naTela) {
		const vizinha = conversas[i + 1] ?? conversas[i - 1];
		tmux('swap-pane', '-d', '-s', vizinha ? vizinha.id : criar(), '-t', id);
	}
	tmux('kill-pane', '-t', id);
}

function Conversa({conversa, sobCursor}) {
	const cor = sobCursor ? 'cyan' : conversa.naTela ? undefined : 'gray';
	return h(
		Box,
		{borderStyle: 'round', borderColor: cor ?? 'white', paddingX: 1},
		h(Text, {color: conversa.naTela ? undefined : 'gray'}, conversa.naTela ? '● ' : '○ '),
		h(Text, {bold: conversa.naTela, color: cor}, `conversa ${conversa.n}`),
	);
}

function Sidebar() {
	const {stdout} = useStdout();
	const [linhas, setLinhas] = useState(stdout.rows);
	const [estado, setEstado] = useState(ler);
	const [cursor, setCursor] = useState(null);
	const [confirmar, setConfirmar] = useState(false);
	const atualizar = () => setEstado(ler());

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

	useEffect(() => {
		if (!focado) setConfirmar(false);
	}, [focado]);

	useInput((input, key) => {
		if (confirmar) {
			setConfirmar(false);
			if (input === 's' && sob) {
				fechar(sob.id, conversas);
				setCursor((conversas[i + 1] ?? conversas[i - 1])?.id ?? null);
				atualizar();
			}
			return;
		}

		if (key.upArrow || input === 'k') setCursor(conversas[Math.max(0, i - 1)]?.id);
		else if (key.downArrow || input === 'j') setCursor(conversas[Math.min(conversas.length - 1, i + 1)]?.id);
		else if (key.return && sob) {
			mostrar(sob.id, conversas);
			tmux('select-pane', '-t', sob.id);
		} else if (input === 'n') {
			const id = criar();
			mostrar(id, conversas);
			tmux('select-pane', '-t', id);
			setCursor(id);
		} else if (input === 'x' && sob) setConfirmar(true);
		else if (key.escape) {
			const naTela = conversas.find(c => c.naTela);
			if (naTela) tmux('select-pane', '-t', naTela.id);
		}
	});

	let rodape;
	if (confirmar) rodape = [h(Text, {key: 1, color: 'yellow'}, `fechar conversa ${sob.n}?`), h(Text, {key: 2, dimColor: true}, 's sim · n não')];
	else if (focado) rodape = [h(Text, {key: 1, dimColor: true}, '↑↓ enter  abrir'), h(Text, {key: 2, dimColor: true}, 'n nova · x fechar'), h(Text, {key: 3, dimColor: true}, 'esc  voltar')];
	else rodape = [h(Text, {key: 1, dimColor: true}, 'ctrl+\\ navegar')];

	return h(
		Box,
		{flexDirection: 'column', paddingX: 1, height: linhas},
		h(Text, {bold: true}, 'Conversas'),
		h(
			Box,
			{flexDirection: 'column', marginTop: 1, flexGrow: 1, overflow: 'hidden'},
			conversas.map((c, j) =>
				h(Conversa, {key: c.id, conversa: c, sobCursor: focado && j === i}),
			),
		),
		h(Box, {flexDirection: 'column'}, rodape),
	);
}

render(h(Sidebar), {exitOnCtrlC: false});
