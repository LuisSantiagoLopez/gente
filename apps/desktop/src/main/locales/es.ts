// Modified by DeskHead Inc. in 2026 for Gente (fork of Rakazo, Apache-2.0).
export const ES_MESSAGES: Record<string, string> = {
  // Menus
  "About {name}": "Acerca de {name}",
  "Check for Updates…": "Buscar actualizaciones…",
  "Computer Access…": "Acceso a la computadora…",
  "Revoke Local Computer Access": "Revocar el acceso a la computadora local",
  "Change Your AI Server…": "Cambiar servidor de Your AI…",
  "Hide {name}": "Ocultar {name}",
  "Hide Others": "Ocultar otros",
  "Show All": "Mostrar todo",
  "Quit {name}": "Salir de {name}",
  "Quit and Stop Bots": "Salir y detener bots",
  File: "Archivo",
  Exit: "Salir",
  Quit: "Salir",
  Edit: "Edición",
  Undo: "Deshacer",
  Redo: "Rehacer",
  Cut: "Cortar",
  Copy: "Copiar",
  Paste: "Pegar",
  "Paste and Match Style": "Pegar y adaptar estilo",
  Delete: "Eliminar",
  "Select All": "Seleccionar todo",
  Speech: "Voz",
  "Start Speaking": "Iniciar locución",
  "Stop Speaking": "Detener locución",
  View: "Visualización",
  "Actual Size": "Tamaño real",
  "Zoom In": "Ampliar",
  "Zoom Out": "Reducir",
  "Toggle Full Screen": "Pantalla completa",
  Window: "Ventana",
  Minimize: "Minimizar",
  Zoom: "Zoom",
  Close: "Cerrar",
  "Close Window": "Cerrar ventana",
  "Bring All to Front": "Traer todo al frente",

  // Updates
  "Checking for Updates…": "Buscando actualizaciones…",
  "Downloading Update…": "Descargando actualización…",
  "Restart to Update…": "Reiniciar para actualizar…",
  "Downloading Your AI {version}…": "Descargando Your AI {version}…",
  "Your AI {version} is ready to install.": "Your AI {version} está listo para instalarse.",
  Restart: "Reiniciar",
  Later: "Más tarde",
  "Could not install the update.": "No se pudo instalar la actualización.",
  "Could not check for updates.": "No se pudieron buscar actualizaciones.",
  "Your AI is up to date.": "Your AI está actualizado.",
  "Version {version}": "Versión {version}",
  "Automatic updates are turned off for this install.":
    "Las actualizaciones automáticas están desactivadas en esta instalación.",
  "Automatic updates only run in an installed build.":
    "Las actualizaciones automáticas solo funcionan en una versión instalada.",
  "No desktop releases are published for this build yet.":
    "Todavía no hay versiones de escritorio publicadas para esta compilación.",
  "Move Your AI to Applications to install updates.":
    "Mueve Your AI a Aplicaciones para instalar actualizaciones.",
  "Free up disk space to install updates.":
    "Libera espacio en el disco para instalar actualizaciones.",
  "This update could not be verified. Reinstall Your AI from a trusted download.":
    "No se pudo verificar esta actualización. Vuelve a instalar Your AI desde una descarga de confianza.",
  "The update could not be completed. Try again later.":
    "No se pudo completar la actualización. Inténtalo de nuevo más tarde.",
  "Could not reach the update server.": "No se pudo conectar con el servidor de actualizaciones.",

  // Computer access
  "Allow local computer access?": "¿Permitir el acceso a la computadora local?",
  "Allow bots to use this computer?": "¿Permitir que los bots usen esta computadora?",
  Cancel: "Cancelar",
  Allow: "Permitir",
  "Bots on {host} can run commands, read and change files, and launch apps with your account’s permissions. You can revoke access in Settings.":
    "Los bots de {host} pueden ejecutar comandos, leer y cambiar archivos y abrir apps con los permisos de tu cuenta. Puedes revocar el acceso en Configuración.",
  "Bots on this local instance can run commands, read and change files, and launch apps with your account’s permissions. You can revoke access from the app menu.":
    "Los bots de esta instancia local pueden ejecutar comandos, leer y cambiar archivos y abrir apps con los permisos de tu cuenta. Puedes revocar el acceso desde el menú de la app.",
  "Local computer access requires an app-managed local instance.":
    "El acceso a la computadora local requiere una instancia local administrada por la app.",
  "Local server is unavailable": "El servidor local no está disponible",

  // Browser sign-in
  "A sign-in attempt is already active. Cancel it and retry.":
    "Ya hay un inicio de sesión en curso. Cancélalo y vuelve a intentarlo.",
  "Could not open browser sign-in. Close other sign-in attempts and retry.":
    "No se pudo abrir el inicio de sesión en el navegador. Cierra los otros intentos de inicio de sesión y vuelve a intentarlo.",
  "Sign-in callback rejected. Return to Your AI to retry.":
    "Se rechazó la respuesta del inicio de sesión. Vuelve a Your AI para intentarlo de nuevo.",
  "You can close this tab and return to Your AI.": "Puedes cerrar esta pestaña y volver a Your AI.",

  // Setup window
  "Quit Your AI": "Salir de Your AI",
  "Welcome to Your AI": "Te damos la bienvenida a Your AI",
  Instance: "Instancia",
  "Technical details": "Detalles técnicos",
  "Setup progress": "Progreso de la configuración",
  "Server address": "Dirección del servidor",
  Headers: "Encabezados",
  "Name: value": "Nombre: valor",
  "Check connection": "Comprobar conexión",
  Continue: "Continuar",
  "Getting ready…": "Preparando…",
  "Almost ready…": "Casi listo…",
  "{size} downloaded": "{size} descargados",
  "Connecting…": "Conectando…",
  "Checking…": "Comprobando…",
  "Your AI answered at {url}.": "Your AI respondió en {url}.",
  "Enter a server address first.": "Primero introduce la dirección de un servidor.",
  "Could not save that address.": "No se pudo guardar esa dirección.",
  "Could not save that address. Try again.":
    "No se pudo guardar esa dirección. Inténtalo de nuevo.",
  "Could not run the connection check. Try again.":
    "No se pudo comprobar la conexión. Inténtalo de nuevo.",
  "Setup bridge unavailable.": "El puente de configuración no está disponible.",
  "Setup could not start. Quit Your AI and try again.":
    "No se pudo iniciar la configuración. Sal de Your AI e inténtalo de nuevo.",

  // Connecting to a server
  "Enter a server address.": "Introduce la dirección de un servidor.",
  "Enter a valid http:// or https:// address.":
    "Introduce una dirección http:// o https:// válida.",
  "Enter a valid server address. Public servers require HTTPS; a new local instance must use localhost.":
    "Introduce una dirección de servidor válida. Los servidores públicos requieren HTTPS; una nueva instancia local debe usar localhost.",
  "Invalid custom headers": "Encabezados personalizados no válidos",
  "That address redirects elsewhere. Enter the final Your AI server address.":
    "Esa dirección redirige a otro lugar. Introduce la dirección final del servidor de Your AI.",
  "That address did not respond like a Your AI server.":
    "Esa dirección no respondió como un servidor de Your AI.",
  "Timed out reaching that address.": "Se agotó el tiempo al intentar acceder a esa dirección.",
  "Nothing is listening at that address yet.": "Todavía no hay nada escuchando en esa dirección.",
  "That host could not be found.": "No se encontró ese host.",
  "The server's HTTPS certificate was rejected.": "Se rechazó el certificado HTTPS del servidor.",
  "Could not reach that address.": "No se pudo acceder a esa dirección.",
  "A connection attempt is already running.": "Ya hay un intento de conexión en curso.",
  "Could not open that server. {detail}": "No se pudo abrir ese servidor. {detail}",
  "Could not reconnect to the saved server. {detail}":
    "No se pudo volver a conectar con el servidor guardado. {detail}",
  "The server page did not become ready.": "La página del servidor no llegó a estar lista.",
  "Page failed to load.": "No se pudo cargar la página.",
  "Renderer stopped ({reason}).": "El renderizador se detuvo ({reason}).",
  "Renderer stopped after load.": "El renderizador se detuvo después de cargar.",
  "Could not open that server. Renderer stopped.":
    "No se pudo abrir ese servidor. El renderizador se detuvo.",
  "Could not open that server. Renderer stopped. The previous instance was restored for the next launch.":
    "No se pudo abrir ese servidor. El renderizador se detuvo. Se restauró la instancia anterior para el próximo inicio.",
  "Could not open that server. The previous instance was left unchanged.":
    "No se pudo abrir ese servidor. La instancia anterior no se modificó.",
  "Could not save setup. The previous instance was restored.":
    "No se pudo guardar la configuración. Se restauró la instancia anterior.",
  "Connected, but could not save setup for the next launch. Try Continue again.":
    "Se conectó, pero no se pudo guardar la configuración para el próximo inicio. Vuelve a pulsar Continuar.",
  "The app-managed Your AI services are not ready. Retry setup.":
    "Los servicios de Your AI que administra la app no están listos. Vuelve a intentar la configuración.",

  // Docker
  "Docker is installed, but Docker Compose is missing. Install Docker Desktop or the docker-compose-plugin.":
    "Docker está instalado, pero falta Docker Compose. Instala Docker Desktop o docker-compose-plugin.",
  "Could not check Docker Compose. Check the output below, then retry.":
    "No se pudo comprobar Docker Compose. Revisa la salida de abajo y vuelve a intentarlo.",
  "This user cannot access Docker. Add it to the docker group (sudo usermod -aG docker $USER), then sign out and back in.":
    "Este usuario no puede acceder a Docker. Agrégalo al grupo docker (sudo usermod -aG docker $USER) y luego cierra sesión y vuelve a iniciarla.",
  "The start was interrupted. Retry to continue.":
    "Se interrumpió el inicio. Vuelve a intentarlo para continuar.",
  "Images for {tag} are not published yet. Try again in a few minutes.":
    "Las imágenes de {tag} aún no están publicadas. Inténtalo de nuevo en unos minutos.",
  "Could not bind a local port after retrying. Retry to choose another port.":
    "No se pudo usar un puerto local tras varios intentos. Vuelve a intentarlo para elegir otro puerto.",
  "Docker has no free network address pools. Remove unused Docker networks or expand Docker’s address pools, then retry.":
    "Docker no tiene grupos de direcciones de red libres. Elimina las redes de Docker que no uses o amplía sus grupos de direcciones y vuelve a intentarlo.",
  "Could not reach the image registry. Check the internet connection, then retry.":
    "No se pudo acceder al registro de imágenes. Revisa la conexión a internet y vuelve a intentarlo.",
  "Docker stopped answering. Start Docker, then retry.":
    "Docker dejó de responder. Inicia Docker y vuelve a intentarlo.",
  "Docker Compose is missing. Install Docker Desktop or the docker-compose-plugin, then retry.":
    "Falta Docker Compose. Instala Docker Desktop o docker-compose-plugin y vuelve a intentarlo.",
  "Downloading Your AI images failed. Check the output below, then retry.":
    "No se pudieron descargar las imágenes de Your AI. Revisa la salida de abajo y vuelve a intentarlo.",
  "Your AI services did not start. Check the output below, then retry.":
    "Los servicios de Your AI no se iniciaron. Revisa la salida de abajo y vuelve a intentarlo.",
  "The stack started but the web app did not answer. Retry, and check the output below.":
    "El stack se inició, pero la app web no respondió. Vuelve a intentarlo y revisa la salida de abajo.",
  "Could not prepare the local stack. Retry.":
    "No se pudo preparar el stack local. Vuelve a intentarlo.",
  "Could not stop the local stack. Check that Docker is running, then try again.":
    "No se pudo detener el stack local. Comprueba que Docker esté en funcionamiento e inténtalo de nuevo.",
  "Settings…": "Configuración…",
  "New…": "Nuevo…",
  Go: "Ir",
  Back: "Atrás",
  Forward: "Adelante",
  "Next Bot": "Bot siguiente",
  "Previous Bot": "Bot anterior",
  "Command Menu…": "Menú de comandos…",
  "Toggle Sidebar": "Mostrar u ocultar la barra lateral",
  "Find…": "Buscar…",
  "Search Bots…": "Buscar bots…",
  "The window closed before the app loaded.": "La ventana se cerró antes de que cargara la app.",
  "New Group Chat": "Nuevo chat grupal",
  "Connect Apps…": "Conectar apps…",
  "Chat Details": "Detalles del chat",
  Help: "Ayuda",
  "Keyboard Shortcuts": "Atajos de teclado",
  "Your AI Support…": "Soporte de Your AI…",
  "Downloading Your AI failed. Check the internet connection, then retry.":
    "No se pudo descargar Your AI. Revisa la conexión a internet y vuelve a intentarlo.",
  "Could not move your data from Docker. Check the output below, then retry.":
    "No se pudieron mover tus datos desde Docker. Revisa la salida de abajo y vuelve a intentarlo.",
  "The computer runtime already running is too old. Update or quit it, then retry.":
    "El entorno de ejecución de computadoras que ya está en marcha es demasiado antiguo. Actualízalo o ciérralo y vuelve a intentarlo.",
  "Your Your AI data is in a different computer runtime. Quit the one running, then retry.":
    "Tus datos de Your AI están en otro entorno de ejecución de computadoras. Cierra el que está en marcha y vuelve a intentarlo.",
  "Run Your AI without Docker?": "¿Usar Your AI sin Docker?",
  "Your bots and data move over. Docker is stopped, not removed.":
    "Tus bots y datos se trasladan. Docker se detiene, no se elimina.",
  Move: "Mover",
  "Keep Docker": "Mantener Docker",
  "Your AI needs Docker Desktop to run on this computer.":
    "Your AI necesita Docker Desktop para ejecutarse en esta computadora.",
  "Your AI needs Docker to run on this computer.":
    "Your AI necesita Docker para ejecutarse en esta computadora.",
  "Install Docker Engine and start it.": "Instala Docker Engine e inícialo.",
  "Download Docker Desktop": "Descargar Docker Desktop",
  "Install Docker": "Instalar Docker",
  "Docker is installed but not running. Open it to continue.":
    "Docker está instalado pero no se está ejecutando. Ábrelo para continuar.",
  "Starting {app}…": "Iniciando {app}…",
  "Docker is installed but not running. Start the Docker service to continue.":
    "Docker está instalado pero no se está ejecutando. Inicia el servicio de Docker para continuar.",
  "Your AI stopped unexpectedly.": "Your AI se detuvo de forma inesperada.",
  Reload: "Recargar",
  "Mac app control": "Control de apps del Mac",
  "Set up Mac app control": "Configurar el control de apps del Mac",
  "Commands already work. To use apps, allow Accessibility and Screen Recording for Your AI in System Settings, then restart Your AI.":
    "Los comandos ya funcionan. Para usar apps, permite a Your AI acceder a Accesibilidad y Grabación de pantalla en Ajustes del Sistema y reinicia Your AI.",
  "Open System Settings": "Abrir Ajustes del Sistema",
  "Restart Your AI": "Reiniciar Your AI",
  "Not Now": "Ahora no",
  "Restart Your AI to finish setup": "Reinicia Your AI para finalizar la configuración",
  // Setup
  "Based on Rakazo by Elie Steinbock (Apache-2.0). Swift by UkisAI.":
    "Basado en Rakazo de Elie Steinbock (Apache-2.0). Swift de UkisAI.",
  "Bots, chats, files, routines": "Bots, chats, archivos, rutinas",
  "Checking this Mac…": "Revisando esta Mac…",
  "Choose a different model": "Elegir otro modelo",
  "Connect Telegram…": "Conectar Telegram…",
  "Connect to a server instead": "Conectarse a un servidor",
  "Downloading the workspace…": "Descargando el espacio de trabajo…",
  "Downloads once, then works offline.": "Se descarga una vez y luego funciona sin internet.",
  "Your AI couldn't finish getting ready. Press Try again.":
    "Your AI no pudo terminar de prepararse. Pulsa Intentar de nuevo.",
  "Your AI is getting things ready. This takes a moment.":
    "Your AI está preparando todo. Tarda un momento.",
  "Get started": "Empezar",
  "Getting Your AI ready, about a minute left": "Preparando Your AI, falta un minuto",
  "Getting Your AI ready, about {n} min left": "Preparando Your AI, faltan unos {n} min",
  "Getting Your AI ready…": "Preparando Your AI…",
  "Model choices": "Opciones de modelo",
  "Model download": "Descarga del modelo",
  "No ads. Ever.": "Sin anuncios. Nunca.",
  "Nobody reads your data, trains on it, or sells it. Not us, not anyone.":
    "Nadie lee tus datos, entrena con ellos ni los vende. Ni nosotros ni nadie.",
  "On this Mac, Your AI needs Docker Desktop (a free app) for its workspace. Install it and open it once.":
    "En esta Mac, Your AI necesita Docker Desktop (una app gratuita) para su espacio de trabajo. Instálala y ábrela una vez.",
  "Run on this Mac instead": "Usar en esta Mac",
  "Runs privately in the background on this Mac.":
    "Funciona en privado, en segundo plano, en esta Mac.",
  "Something went wrong.": "Algo salió mal.",
  "Starting the workspace…": "Iniciando el espacio de trabajo…",
  "Switched to {name} for your computer ({from} could not run here).":
    "Cambiamos a {name} para tu computadora ({from} no podía funcionar aquí).",
  "That address didn't answer like a Your AI server. Check it, then try again.":
    "Esa dirección no respondió como un servidor de Your AI. Revísala y vuelve a intentarlo.",
  "The AI of the people.": "La IA de la gente.",
  "The first start can take a minute.": "El primer inicio puede tardar un minuto.",
  "Try again": "Intentar de nuevo",
  "When Your AI works online for you (searching, browsing, apps), only what that task needs goes out.":
    "Cuando Your AI trabaja en internet por ti (buscar, navegar, apps), solo sale lo que esa tarea necesita.",
  Workspace: "Espacio de trabajo",
  "Workspace ready.": "Espacio de trabajo listo.",
  "Your AI is ready.": "Tu IA está lista.",
  "Your AI lives on your computer. Your chats never leave it.":
    "Tu IA vive en tu computadora. Tus chats nunca salen de ella.",
  "Sign In to Your AI…": "Iniciar sesión en Your AI…",
  "Sign Out of Your AI": "Cerrar sesión de Your AI",
  // Computer use pill
  "Your AI is using your computer": "Your AI está usando tu computadora",
  "Press {key} to stop": "Presiona {key} para detener",
  Stop: "Detener",
  Stopped: "Detenido",
  "Take Meeting Notes…": "Tomar notas de la reunión…",
  "Stop Meeting Notes": "Detener notas de la reunión",
};
