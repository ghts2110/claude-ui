// Statusline do Claude Code (ver sidebar/hooks.json): o JSON que ela recebe
// traz o uso do plano (rate_limits, só para assinantes Pro/Max, depois da
// primeira resposta). A % da janela de 5h e quando ela reinicia vão para @uso,
// que o sidebar desenha como um anel (ver sidebar/anel.js).
// O --settings do claude-ui toma o lugar da statusline do usuário: se ele
// tiver uma, ela roda com a mesma entrada e a saída dela é a que aparece.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {tmux} from './conversas.js';

let entrada = '';
try {
	entrada = readFileSync(0, 'utf8');
} catch {}
let dados = {};
try {
	dados = JSON.parse(entrada);
} catch {}

// Só grava quando há dado: uma conversa que ainda não teve resposta não apaga
// o que outra já sabe. O uso é da conta, então vale para todas.
const janela = dados.rate_limits?.five_hour;
if (Number.isFinite(janela?.used_percentage) && Number.isFinite(janela?.resets_at)) {
	try {
		const uso = `${janela.used_percentage} ${janela.resets_at}`;
		if (tmux('show', '-qv', '@uso') !== uso) {
			tmux('set', '-q', '@uso', uso);
			process.kill(Number(tmux('display', '-p', '-t', tmux('show', '-qv', '@sidebar'), '#{pane_pid}')), 'SIGUSR2');
		}
	} catch {}
}

// A statusline que valeria sem o claude-ui, na ordem de precedência do Claude
// Code: a local e a do projeto, depois a do usuário.
const projeto = dados.workspace?.project_dir ?? dados.cwd ?? process.cwd();
const configuracoes = [
	join(projeto, '.claude', 'settings.local.json'),
	join(projeto, '.claude', 'settings.json'),
	join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json'),
];
for (const arquivo of configuracoes) {
	let comando;
	try {
		comando = JSON.parse(readFileSync(arquivo, 'utf8')).statusLine?.command;
	} catch {}
	if (!comando) continue;
	spawnSync(comando, {shell: true, input: entrada, stdio: ['pipe', 'inherit', 'ignore'], timeout: 5000});
	break;
}
