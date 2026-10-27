// Anel de progresso em braille: cada caractere é uma grade de 2x4 pontos, e
// no terminal os pontos ficam quase quadrados, então 6 colunas x 3 linhas
// formam um círculo de 12x12 pontos com um buraco no meio. O anel enche a
// partir do topo, em sentido horário; cada caractere tem uma cor só, e conta
// como cheio se o ângulo médio dos seus pontos já foi alcançado.
export const colunas = 6;
export const linhas = 3;

const pontos = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];

// Linhas do anel, cada uma como trechos {texto, cheio} para colorir.
export function anel(fracao) {
	const largura = colunas * 2, altura = linhas * 4;
	const cx = (largura - 1) / 2, cy = (altura - 1) / 2;
	const fora = Math.min(largura, altura) / 2, dentro = fora - 2.5;
	const saida = [];
	for (let l = 0; l < linhas; l++) {
		const trechos = [];
		for (let c = 0; c < colunas; c++) {
			let codigo = 0, angulos = 0, n = 0;
			for (let dy = 0; dy < 4; dy++) {
				for (let dx = 0; dx < 2; dx++) {
					const x = c * 2 + dx - cx, y = l * 4 + dy - cy;
					const raio = Math.hypot(x, y);
					if (raio > fora || raio < dentro) continue;
					codigo |= pontos[dy][dx];
					// 0 no topo, 0.5 embaixo, crescendo no sentido horário.
					angulos += (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1;
					n++;
				}
			}
			const texto = String.fromCharCode(0x2800 + codigo);
			const cheio = n > 0 && (fracao >= 1 || angulos / n < fracao);
			const ultimo = trechos.at(-1);
			if (ultimo?.cheio === cheio) ultimo.texto += texto;
			else trechos.push({texto, cheio});
		}
		saida.push(trechos);
	}
	return saida;
}

// Uso guardado pela statusline (ver sidebar/uso.js) em @uso: "% reinício".
// Sem o dado, ou com a janela de 5h já reiniciada, não se sabe o uso.
export function ler(valor, agora = Date.now() / 1000) {
	const [usado, reinicia] = String(valor ?? '').split(' ').map(Number);
	if (!Number.isFinite(usado) || !(reinicia > agora)) return;
	return {usado: Math.min(100, Math.max(0, usado)), reinicia};
}
