# Bitácoras de partida

Esta carpeta guarda las bitácoras JSON que descargan los jugadores y el anfitrión al terminar una partida.
Claude Code las analiza para mejorar el juego (ver `CLAUDE.md` §10).

## Cómo subir una bitácora

1. En el juego, pulsa **«Descargar bitácora»** (está en el HUD de cada jugador y en el panel del anfitrión).
   El anfitrión puede pulsar **«Pedir bitácoras a todos»** para que cada dispositivo descargue la suya.
2. El archivo se llama `AAAA-MM-DD_SALA_rol-sector_alias.json`
   (por ejemplo, `2026-11-20_K7P2QX_productor-textil_ana.json`). El del anfitrión: `..._anfitrion_alias.json`.
3. En GitHub, entra en esta carpeta `logs/`, pulsa **Add file → Upload files**, arrastra los `.json` y confirma
   el commit (en `main` o en una rama con PR).
4. En la próxima sesión, Claude Code detecta las bitácoras nuevas (las que no están en `analisis/indice.json`),
   las valida, escribe un informe en `analisis/` y, si hace falta, abre un PR con mejoras.

## Reglas

- **No edites ni borres** bitácoras subidas: las inválidas se listan en el informe, pero se conservan.
- **Privacidad:** no se guardan nombres reales, correos ni IP. Usa un alias.
- La bitácora del anfitrión incluye el registro completo de cambios para reproducir la partida (semilla + cambios).

## Análisis manual

```bash
node scripts/analyze-logs.mjs            # bitácoras nuevas
node scripts/analyze-logs.mjs --all      # todas
node scripts/analyze-logs.mjs --report --update-index
```
