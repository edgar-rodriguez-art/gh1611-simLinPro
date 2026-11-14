// @ts-check
// Iconos SVG compartidos por el lobby, el HUD y las insignias de la escena 3D.
export const ICON_PATHS = {
  human: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7.5 9a7.5 7.5 0 0 1 15 0z',
  bot: 'M11 1.5h2v3h-2zM5 5.5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2zM9 9.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zm6 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM8 15.5h8v1.6H8z',
  host: 'M12 2 4 7v2h16V7zM6 10h2v8H6zm5 0h2v8h-2zm5 0h2v8h-2zM3 19h18v3H3z',
  warning: 'M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z',
};

/** SVG en línea para el DOM. */
export function iconSvg(name, size = 18, color = 'currentColor') {
  const rule = name === 'bot' ? ' fill-rule="evenodd"' : '';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path${rule} fill="${color}" d="${ICON_PATHS[name]}"/></svg>`;
}
