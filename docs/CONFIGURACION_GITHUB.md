# Configuración manual de GitHub

Pasos que debe hacer el propietario del repositorio (Claude no cambia la configuración del repositorio ni crea secretos).

1. **Rama `main`**: si el repositorio estaba vacío, crea `main` (o fusiona el primer PR) para que exista la rama de despliegue.
2. **GitHub Pages**: *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
3. **Permisos de Actions**: *Settings → Actions → General → Workflow permissions → **Read and write permissions*** (lo necesita `metrics.yml` para hacer commit de `data/metrics.json`).
4. **Fusionar el PR** hacia `main`. El workflow `deploy.yml` ejecuta pruebas, compila y publica en
   https://edgar-rodriguez-art.github.io/gh1611-simLinPro/
5. **Métricas**: en *Actions → Actualizar métricas de España → Run workflow* lanza la primera descarga real de Eurostat (luego corre cada día a las 05:17 UTC).
6. (Opcional) Protege `main` exigiendo que pase el workflow **CI**.

## Probar una partida con 2 dispositivos

1. En el portátil: abre la URL de Pages → «Crear sala». Aparecen el código y el QR.
2. En el móvil: escanea el QR (o «Unirse con código»), escribe un alias y elige un puesto.
3. En el portátil: «Iniciar partida». Cambia un parámetro en el móvil y comprueba que se mueve la animación y el KPI.
4. En el panel del anfitrión: elige el puesto del móvil → «Analizar» → «Enviar» en una propuesta. Acéptala en el móvil y comprueba que el parámetro cambia.
5. Descarga las bitácoras y súbelas a `logs/`.

Si no conecta: usa la misma red para todos o el punto de acceso de un móvil (algunas redes escolares bloquean UDP/WebRTC).
