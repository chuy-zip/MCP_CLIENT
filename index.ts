import { Anthropic } from "@anthropic-ai/sdk";
import { Tool, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
}

class MCPClient {
    private mcpClients: Map<string, Client> = new Map();
    private anthropic: Anthropic;
    private transports: Map<string, any> = new Map();
    private allTools: Tool[] = [];
    private conversationHistory: MessageParam[] = [];
    private mode: 'single' | 'multi' = 'single';

    constructor() {
        this.anthropic = new Anthropic({
            apiKey: ANTHROPIC_API_KEY,
        });
    }

    // Método para encontrar herramientas por nombre
    private findToolByName(baseName: string): string | undefined {
        // Coincidencia exacta
        const exactMatch = this.allTools.find(tool => tool.name === baseName);
        if (exactMatch) return exactMatch.name;

        // Buscar por sufijo (sin el prefijo)
        const suffixMatch = this.allTools.find(tool => {
            const parts = tool.name.split('_');
            return parts[parts.length - 1] === baseName;
        });
        if (suffixMatch) return suffixMatch.name;

        // Búsqueda flexible
        const flexibleMatch = this.allTools.find(tool =>
            tool.name.toLowerCase().includes(baseName.toLowerCase()) ||
            baseName.toLowerCase().includes(tool.name.split('_').pop()!.toLowerCase())
        );
        if (flexibleMatch) return flexibleMatch.name;

        console.error(`Tool not found: ${baseName}. Available tools:`, this.allTools.map(t => t.name));
        return undefined;
    }
    private showHistorySummary() {
        console.log("\nConversation History (Summary):");
        if (this.conversationHistory.length === 0) {
            console.log("No history yet.");
            return;
        }

        this.conversationHistory.forEach((msg, index) => {
            const role = msg.role === "user" ? "User" : "Assistant";
            let contentPreview = "";

            if (typeof msg.content === "string") {
                contentPreview = msg.content.substring(0, 50) +
                    (msg.content.length > 50 ? "..." : "");
            } else if (Array.isArray(msg.content)) {
                const firstItem = msg.content[0];
                if (firstItem.type === "tool_use") {
                    contentPreview = `Tool Call: ${firstItem.name}`;
                } else if (firstItem.type === "tool_result") {
                    contentPreview = "Tool Result";
                } else if (firstItem.type === "text") {
                    contentPreview = firstItem.text.substring(0, 50) +
                        (firstItem.text.length > 50 ? "..." : "");
                } else {
                    contentPreview = "Complex content";
                }
            }

            console.log(`${index + 1}. ${role}: ${contentPreview}`);
        });
    }

    private showCompleteHistory() {
        console.log("\nConversation History (Complete):");
        if (this.conversationHistory.length === 0) {
            console.log("No history yet.");
            return;
        }

        this.conversationHistory.forEach((msg, index) => {
            const role = msg.role === "user" ? "User" : "Assistant";
            console.log(`\n--- ${index + 1}. ${role} ---`);

            if (typeof msg.content === "string") {
                console.log(msg.content);
            } else if (Array.isArray(msg.content)) {
                msg.content.forEach((item, itemIndex) => {
                    if (item.type === "text") {
                        console.log(`Text: ${item.text}`);
                    } else if (item.type === "tool_use") {
                        console.log(`Tool Call: ${item.name}`);
                        console.log(`Arguments: ${JSON.stringify(item.input, null, 2)}`);
                    } else if (item.type === "tool_result") {
                        console.log(`Tool Result: ${item.content}`);
                        if (item.is_error) {
                            console.log("(Error)");
                        }
                    }
                });
            }
            console.log("---");
        });
    }

    async connectToServer(target: string) {
        this.mode = 'single';
        const client = new Client({
            name: "mcp-client-cli",
            version: "1.0.0"
        });

        let transport;

        if (target.startsWith('http://') || target.startsWith('https://')) {
            const baseUrl = new URL(target);
            console.log(`Connecting to REMOTE MCP server: ${target}`);
            transport = new SSEClientTransport(baseUrl);
        } else {
            console.log(`Connecting to LOCAL MCP server: ${target}`);

            const isJs = target.endsWith(".js");
            const isPy = target.endsWith(".py");

            if (!isJs && !isPy) {
                throw new Error("Server must be .js or .py file for local mode");
            }

            const command = isPy ? (process.platform === "win32" ? "python" : "python3") : "node";
            transport = new StdioClientTransport({
                command,
                args: [target],
            });
        }

        await client.connect(transport);

        const toolsResult = await client.listTools();
        this.allTools = toolsResult.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
        } as Tool));

        this.mcpClients.set('default', client);
        this.transports.set('default', transport);

        console.log(
            "Connected with tools:",
            this.allTools.map((tool) => tool.name)
        );
    }

    async connectToMultipleServers(serverType: string, target?: string) {
        this.mode = 'multi';
        try {
            const client = new Client({
                name: `mcp-client-${serverType}`,
                version: "1.0.0"
            });

            let transport;

            if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
                const baseUrl = new URL(target);
                console.log(`Connecting to REMOTE ${serverType} server: ${target}`);
                transport = new SSEClientTransport(baseUrl);
            } else {
                console.log(`Connecting to LOCAL ${serverType} server`);

                let command;
                let args = [];
                let env = {};

                if (serverType === 'filesystem') {
                    command = 'npx';
                    const allowedPaths = process.env.FILESYSTEM_ALLOWED_PATHS ||
                        'C:\\Users\\andre\\Desktop\\MCP_PROYECT\\tests';
                    args = ['@modelcontextprotocol/server-filesystem', ...allowedPaths.split(';')];
                } else if (serverType === 'github') {
                    command = 'npx';
                    args = ['@modelcontextprotocol/server-github'];

                    // ← AÑADIR VARIABLES DE ENTORNO PARA GITHUB
                    const githubToken = process.env.GITHUB_TOKEN;
                    if (!githubToken) {
                        throw new Error("GITHUB_TOKEN environment variable is required for GitHub server");
                    }
                    env = {
                        GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
                    };
                    console.log("GitHub token configured");
                } else if (target) {
                    const isJs = target.endsWith(".js");
                    const isPy = target.endsWith(".py");

                    if (!isJs && !isPy) {
                        throw new Error("Server must be .js or .py file for custom servers");
                    }

                    command = isPy ? (process.platform === "win32" ? "python" : "python3") : "node";
                    args = [target];
                } else {
                    throw new Error(`No target specified for server type: ${serverType}`);
                }

                transport = new StdioClientTransport({
                    command,
                    args: args,
                    env: { ...process.env, ...env } // variables env
                });
            }

            await client.connect(transport);

            const toolsResult = await client.listTools();
            const tools = toolsResult.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
            } as Tool));

            const prefixedTools = tools.map(tool => ({
                ...tool,
                name: `${serverType}_${tool.name}`
            }));

            this.allTools = [...this.allTools, ...prefixedTools];
            this.mcpClients.set(serverType, client);
            this.transports.set(serverType, transport);

            console.log(
                `Connected to ${serverType} with tools:`,
                tools.map((tool) => tool.name)
            );

        } catch (error) {
            console.log(`Failed to connect to ${serverType}:`, error);
            throw error;
        }
    }

    async callTool(toolName: string, args: any) {

        console.log(`- CALLTOOL - Tool: ${toolName}`);
        console.log(`- CALLTOOL - Args recibidos:`, JSON.stringify(args, null, 2));
        console.log(`- CALLTOOL - Mode: ${this.mode}`);

        if (this.mode === 'single') {
            const client = this.mcpClients.get('default');
            if (!client) {
                throw new Error("No client connected");
            }

            console.log(`Calling tool: ${toolName} with args:`, JSON.stringify(args, null, 2));

            // Esto era un fixx pra un servidor mcp, perooo al final no era necesario
            // const target = process.argv[2];
            // const isLocalPython = target && target.endsWith('.py') && !target.startsWith('http');
            // if (isLocalPython) {
            //     toolArgs = { params: args };
            //     console.log(`Adapting for local Python FastMCP server`);
            // }

            return await client.callTool({
                name: toolName,
                arguments: args  // Enviar los argumentos directamente
            });
        } else {
            // Dividir solo en la primera ocurrencia de '_', sino el nombre se queda mal
            const firstUnderscoreIndex = toolName.indexOf('_');
            if (firstUnderscoreIndex === -1) {
                throw new Error(`Invalid tool name format: ${toolName}`);
            }

            const serverType = toolName.substring(0, firstUnderscoreIndex);
            const actualToolName = toolName.substring(firstUnderscoreIndex + 1);

            const client = this.mcpClients.get(serverType);
            if (!client) {
                throw new Error(`No client found for server type: ${serverType}`);
            }

            console.log(`Calling tool: ${actualToolName} on ${serverType}`);
            return await client.callTool({
                name: actualToolName,
                arguments: args
            });
        }
    }

    async processQuery(query: string) {
        try {
            this.conversationHistory.push({
                role: "user",
                content: query,
            });

            let finalResponse = "";
            let maxIterations = 3;
            let iteration = 0;

            while (iteration < maxIterations) {
                iteration++;

                const response = await this.anthropic.messages.create({
                    model: "claude-sonnet-4-20250514",
                    max_tokens: 1000,
                    messages: this.conversationHistory,
                    tools: this.allTools.length > 0 ? this.allTools : undefined,
                });

                let toolUseDetected = false;

                for (const content of response.content) {
                    if (content.type === "text") {
                        finalResponse += content.text + "\n";
                        this.conversationHistory.push({
                            role: "assistant",
                            content: content.text,
                        });
                    }
                    else if (content.type === "tool_use") {
                        toolUseDetected = true;
                        const toolName = content.name;
                        const toolArgs = content.input;

                        console.log(`Claude quiere usar tool: ${toolName}`);

                        const fullToolName = this.findToolByName(toolName);
                        if (!fullToolName) {
                            console.error(`Tool not found: ${toolName}`);
                            finalResponse += `[Error: Tool ${toolName} not found]\n`;

                            // Añadir error al historial
                            this.conversationHistory.push({
                                role: "user",
                                content: [
                                    {
                                        type: "tool_result",
                                        tool_use_id: content.id,
                                        content: `Error: Tool ${toolName} not found`,
                                        is_error: true
                                    }
                                ],
                            });
                            continue;
                        }

                        console.log(`Calling tool with full name: ${fullToolName}`);

                        this.conversationHistory.push({
                            role: "assistant",
                            content: [{ type: "tool_use", ...content }],
                        });

                        try {
                            const result = await this.callTool(fullToolName, toolArgs);

                            const toolResultContent = typeof result.content === 'string'
                                ? result.content
                                : JSON.stringify(result.content);

                            this.conversationHistory.push({
                                role: "user",
                                content: [
                                    {
                                        type: "tool_result",
                                        tool_use_id: content.id,
                                        content: toolResultContent
                                    }
                                ],
                            });

                            finalResponse += `[Used tool: ${fullToolName}]\n`;
                        } catch (error) {
                            console.error(`Tool error: ${error}`);
                            finalResponse += `[Tool error: ${error.message}]\n`;

                            this.conversationHistory.push({
                                role: "user",
                                content: [
                                    {
                                        type: "tool_result",
                                        tool_use_id: content.id,
                                        content: `Error: ${error.message}`,
                                        is_error: true
                                    }
                                ],
                            });
                        }
                    }
                }

                if (!toolUseDetected) {
                    break;
                }

                if (iteration === maxIterations) {
                    finalResponse += "Maximum tool iterations reached.";
                }
            }

            return finalResponse;

        } catch (error) {
            console.error("Error processing query:", error);
            return `Sorry, I encountered an error: ${error.message}`;
        }
    }

    async chatLoop() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        try {
            // En chatLoop(), actualiza el mensaje inicial:
            console.log("MCP Client Started!");
            console.log("Mode:", this.mode);
            console.log("Commands: 'quit', 'clear', 'tools', 'mode', 'history', 'history_full'");
            console.log("Available tools:", this.allTools.map(t => t.name));

            while (true) {
                const message = await rl.question("Query: ");

                if (message.toLowerCase() === "quit") {
                    break;
                }

                if (message.toLowerCase() === "clear") {
                    this.conversationHistory = [];
                    console.log("Conversation history cleared.");
                    continue;
                }

                if (message.toLowerCase() === "tools") {
                    console.log("\nAvailable Tools:");
                    this.allTools.forEach((tool, index) => {
                        console.log(`${index + 1}. ${tool.name}: ${tool.description}`);
                    });
                    continue;
                }

                if (message.toLowerCase() === "mode") {
                    console.log("Current mode:", this.mode);
                    continue;
                }

                // NUEVOS COMANDOS DE HISTORIAL
                if (message.toLowerCase() === "history") {
                    this.showHistorySummary();
                    continue;
                }

                if (message.toLowerCase() === "history_full") {
                    this.showCompleteHistory();
                    continue;
                }

                console.log("Assistant:");
                const response = await this.processQuery(message);
                console.log(response);
            }
        } catch (error) {
            console.error("Error in chat loop:", error);
        } finally {
            rl.close();
        }
    }

    async cleanup() {
        try {
            for (const [serverType, client] of this.mcpClients.entries()) {
                await client.close();
                console.log(`Closed connection to ${serverType}`);
            }
        } catch (error) {
            console.error("Error during cleanup:", error);
        }
    }
}

async function main() {
    if (process.argv.length < 3) {
        console.log("Usage: node client.js <server_target>");
        console.log("For multiple servers: node client.js --multi");
        process.exit(1);
    }

    const mcpClient = new MCPClient();

    try {
        if (process.argv[2] === '--multi') {
            console.log("Multi-server mode");
            await mcpClient.connectToMultipleServers('filesystem');
            await mcpClient.connectToMultipleServers('github');
        } else {
            const serverTarget = process.argv[2];
            await mcpClient.connectToServer(serverTarget);
        }

        await mcpClient.chatLoop();

    } catch (error) {
        console.error("Fatal error:", error);
    } finally {
        await mcpClient.cleanup();
    }
}

main();