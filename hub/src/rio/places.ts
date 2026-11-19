// Esme's Rio: the map's place keys, on their own so the farm's data layer (farmRepo: sync,
// backup, restore, on every page) can check a visited area without loading the game's map data
// (assets.ts and its JSON stay in the game's lazily loaded chunk). places.test.ts keeps this list
// equal to day1/map/map.json's places.

export const RIO_PLACE_KEYS: readonly string[] = [
  "christ-the-redeemer", "parque-lage", "jardim-botanico", "dois-irmaos", "rocinha", "tijuca-park", "os-esquilos",
  "flamengo-match", "santa-teresa", "museum", "lagoa-house", "clothing-store", "sult", "copacabana-palace",
  "ipanema-beach", "barraca", "zona-sul", "boteco", "quilo", "ipanema-penthouse", "fazenda",
];
