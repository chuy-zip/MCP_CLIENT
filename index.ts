import { Anthropic } from "@anthropic-ai/sdk";
import {
    MessageParam,
    Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
}

class MCPClient {
    private mcp: Client;
    private anthropic: Anthropic;
    private transport: StdioClientTransport | null = null;
    private tools: Tool[] = [];
    private conversationHistory: MessageParam[] = [];

    constructor() {
        this.anthropic = new Anthropic({
            apiKey: ANTHROPIC_API_KEY,
        });
        this.mcp = new Client({
            name: "mcp-client-cli",
            version: "1.0.0"
        });
    }

    async connectToServer(serverScriptPath: string) {
        try {
            const isJs = serverScriptPath.endsWith(".js");
            const isPy = serverScriptPath.endsWith(".py");
            if (!isJs && !isPy) {
                throw new Error("Server script must be a .js or .py file");
            }

            const command = isPy
                ? process.platform === "win32" ? "python" : "python3"
                : "node";

            this.transport = new StdioClientTransport({
                command,
                args: [serverScriptPath],
            });

            await this.mcp.connect(this.transport);

            const toolsResult = await this.mcp.listTools();
            this.tools = toolsResult.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
            } as Tool));

            console.log(
                "Connected to server with tools:",
                this.tools.map((tool) => tool.name)
            );

        } catch (error) {
            console.log("Failed to connect to MCP server: ", error);
            throw error;
        }
    }

    async processQuery(query: string) {
        try {
            // Add user message to history
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
                    tools: this.tools.length > 0 ? this.tools : undefined,
                });

                let toolUseDetected = false;

                for (const content of response.content) {
                    if (content.type === "text") {
                        finalResponse += content.text + "\n";

                        // Add assistant response to history
                        this.conversationHistory.push({
                            role: "assistant",
                            content: content.text,
                        });
                    }
                    else if (content.type === "tool_use") {
                        toolUseDetected = true;
                        const toolName = content.name;
                        const toolArgs = content.input;

                        console.log(`Calling tool: ${toolName}`);

                        // Add tool call to history
                        this.conversationHistory.push({
                            role: "assistant",
                            content: [{ type: "tool_use", ...content }],
                        });

                        // Call the tool
                        // Call the tool
                        const result = await this.mcp.callTool({
                            name: toolName,
                            arguments: toolArgs as { [key: string]: unknown }, // casteo porque sino typescript se pone arisco
                        });

                        // Add tool result to history 
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

                        finalResponse += `[Used tool: ${toolName}]\n`;
                    }
                }

                // If no tools were used, break the loop
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
            console.log("MCP Client Started!");
            console.log("Type your queries or 'quit' to exit.");
            console.log("Type 'clear' to reset conversation history.");

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
            await this.mcp.close();
        } catch (error) {
            console.error("Error during cleanup:", error);
        }
    }
}

async function main() {
    if (process.argv.length < 3) {
        console.log("Usage: node client.js <path_to_server_script>");
        process.exit(1);
    }

    const serverScriptPath = process.argv[2];
    const mcpClient = new MCPClient();

    try {
        await mcpClient.connectToServer(serverScriptPath);
        await mcpClient.chatLoop();
    } catch (error) {
        console.error("Fatal error:", error);
    } finally {
        await mcpClient.cleanup();
    }
}

main();