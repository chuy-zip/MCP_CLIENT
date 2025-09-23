// proxy-debug.js
import http from 'http';
import https from 'https';

const TARGET_HOST = 'mcp-server-918538880326.us-central1.run.app';
const TARGET_PORT = 443;

const server = http.createServer((clientReq, clientRes) => {
    console.log('Received request:', clientReq.method, clientReq.url);
    
    // Manejar preflight CORS
    if (clientReq.method === 'OPTIONS') {
        clientRes.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        clientRes.end();
        return;
    }

    const options = {
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: clientReq.url,
        method: clientReq.method,
        headers: {
            ...clientReq.headers,
            host: TARGET_HOST  // Important for Cloud Run
        }
    };

    console.log('\nForwarding to:', options.hostname + options.path);

    const proxyReq = https.request(options, (proxyRes) => {
        console.log(' Response received:', proxyRes.statusCode);
        
        // Forward headers
        clientRes.writeHead(proxyRes.statusCode, {
            ...proxyRes.headers,
            'Access-Control-Allow-Origin': '*'
        });

        // Pipe the response
        proxyRes.pipe(clientRes);
        
        proxyRes.on('data', (chunk) => {
            console.log(' Data chunk:', chunk.toString().substring(0, 100) + '...');
        });
    });

    proxyReq.on('error', (error) => {
        console.error(' Proxy request error:', error.message);
        clientRes.writeHead(500);
        clientRes.end('Proxy error: ' + error.message);
    });

    // Pipe the request body
    clientReq.pipe(proxyReq);

    clientReq.on('data', (chunk) => {
        console.log(' Request body:', chunk.toString());
    });
});

server.on('error', (error) => {
    console.error(' Server error:', error);
});

server.listen(8080, () => {
    console.log(' SSE Debug proxy listening on http://localhost:8080');
    console.log(' Forwarding to: https://' + TARGET_HOST);
    console.log(' Use: node build/index.js http://localhost:8080/sse');
});