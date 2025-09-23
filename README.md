# MCP_CLIENT
Cliente hecho con anthropic para poder hacer uso de MCP's

### dependencias
npm install


### Local MCP
node build/index.js "Ruta a donde se clono el server"

### Ejemplo

node build/index.js ../MCP_SERVER/build/index.js

https://mkt-api.vercel.app/api/karts/Skill/Mini-turbo%20Plus/Rarity/Normal


node build/index.js ../MCP-historical-local-server-main/HistoricalLocalServer/historical_mcp.py
Caída del Muro de Berlín


node build/index.js ../trainer-mcp/server.py

Query: utiliza la tool compute_metrics usando datos para un hombre de sexo masculino(male), edad de 30 años, altura de 150 cm y 78kg

### External MCP

node build/index.js https://mcp-server-918538880326.us-central1.run.app/sse


### Probar proxy
node build/index.js http://localhost:8080/sse
node proxy-debug.js

# Para filesystem + github
node build/index.js --multi

## Ejemplo de prueba

1. github_create_repository - Crear un repositorio público vacío en GitHub llamado git_test
2. filesystem_create_directory - Crear carpeta una carpetea local llamada repo1 en el directorio permitido
3. filesystem_write_file - Dentro de 'repo1', crea un archivo README.md con contenido '# Hola Mundo'
4. Sube el archivo README.md al repositorio 'git_test' en la raíz"