// @ts-check
// Paleta de la escena (CLAUDE.md §9). No cambiar sin revisar docs/diagrama-simulacion.png.
export const PALETTE = {
  ground: 0xf0a04b,
  edgeA: 0xd9822f,
  edgeB: 0xb8661f,
  water: 0x3b8fe0,
  tree: 0x3d7fd6,
  mountainOrange: 0xe68a3e,
  mountainLilac: 0xc9c6de,
  snow: 0xffffff,
  bakery: 0xd2553a,
  textile: 0x8e6fd1,
  electronics: 0x2f80d1,
  distributorRoof: 0x4e6bd6,
  distributorWall: 0xf6d06b,
  host: 0x5b3fb8,
  material: 0x1f9d55,
  money: 0xd99a00,
  network: 0x7b4fd6,
  // auxiliares
  road: 0x5e5873,
  roadLine: 0xf3ecdf,
  white: 0xf4f1ec,
  lightGray: 0xd9d6e0,
  wheat: 0xf2c94c,
  cotton: 0x6fcf73,
  dark: 0x3a3550,
  coin: 0xf2b705,
  danger: 0xe0403a,
};

export const SECTOR_COLOR = { bakery: PALETTE.bakery, textile: PALETTE.textile, electronics: PALETTE.electronics };

export const CSS = {
  bgTop: '#d9d2f3',
  bgBottom: '#fbf3e4',
};
