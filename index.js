// 【V4 · 探针调试版】
console.log("\n\n##################################################\n[ModelScope Proxy] 探针：index.js 文件开始被读取...\n##################################################\n\n");

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { loadYaml } = require('../../../utils.js');

const EXTENSION_NAME = "ModelScope ComfyUI Proxy";
const LATEST_IMAGE_FILENAME = "modelscope-latest.png";
let server;
let config;
let GLOBAL_HISTORY = {};

async function generateImageViaApi(prompt) {
    try {
        console.log(`[${EXTENSION_NAME}] 正在为提示词发送云端API请求: "${prompt.substring(0, 80)}..."`);
        const payload = { model: config.model_id, prompt: prompt };
        const headers = { 'Authorization': config.api_key, 'Content-Type': 'application/json' };
        
        const apiResponse = await fetch(config.api_url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            throw new Error(`ModelScope API 请求失败，状态码 ${apiResponse.status}: ${errorText}`);
        }

        const responseData = await apiResponse.json();
        const imageUrl = responseData.images[0].url;
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error(`从URL下载图片失败: ${imageUrl}`);
        
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const publicImagePath = path.join(process.cwd(), 'public', LATEST_IMAGE_FILENAME);
        await fs.writeFile(publicImagePath, imageBuffer);
        
        console.log(`[${EXTENSION_NAME}] 图片已成功下载并保存为 ${publicImagePath}`);
        return true;
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] 云端API调用失败:`, error);
        return false;
    }
}

async function processGeneration(promptId, positivePrompt) {
    await generateImageViaApi(positivePrompt);
    GLOBAL_HISTORY[promptId] = {
        "status": { "status_str": "success", "completed": true },
        "outputs": {
            "9": { "images": [{ "filename": LATEST_IMAGE_FILENAME, "subfolder": "", "type": "output" }] }
        }
    };
    console.log(`[${EXTENSION_NAME}] 任务 ${promptId} 已完成并记录历史。`);
}

async function startProxyServer() {
    config = await loadYaml(path.join(__dirname, 'config.yaml'));
    const PORT = config.listen_port || 18188;

    server = http.createServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/prompt') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const promptWorkflow = data.prompt;
                    let positivePrompt = '';
                    
                    for (const node of Object.values(promptWorkflow)) {
                        if (node.class_type === "KSampler" && node.inputs.positive) {
                            const positiveNodeId = node.inputs.positive[0];
                            positivePrompt = promptWorkflow[positiveNodeId].inputs.text.trim(); 
                            break;
                        }
                    }

                    if (positivePrompt && positivePrompt !== "...") {
                        const promptId = data.prompt_id || crypto.randomUUID();
                        console.log(`[${EXTENSION_NAME}] 拦截到 /prompt 请求，ID: ${promptId}，提示词: ${positivePrompt}`);
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ "prompt_id": promptId }));

                        processGeneration(promptId, positivePrompt);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ "error": "No valid prompt found" }));
                    }
                } catch (e) {
                    console.error(`[${EXTENSION_NAME}] 解析 /prompt 请求体失败:`, e);
                    res.writeHead(500).end();
                }
            });
        } else if (req.method === 'GET' && req.url.startsWith('/history/')) {
            const promptId = req.url.split('/')[2];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ [promptId]: GLOBAL_HISTORY[promptId] || {} }));
        } else if (req.method === 'GET' && req.url.startsWith('/view')) {
            const imagePath = path.join(process.cwd(), 'public', LATEST_IMAGE_FILENAME);
            try {
                const imageStream = require('fs').createReadStream(imagePath);
                res.writeHead(200, { 'Content-Type': 'image/png' });
                imageStream.pipe(res);
            } catch (e) { res.writeHead(404).end(); }
        } else if (req.url === '/ws') {
            res.writeHead(101).end();
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: "ok", message: `ModelScopeProxy is running.` }));
        }
    });

    server.listen(PORT, '127.0.0.1', () => {
        console.log(`\n\n[${EXTENSION_NAME}] ComfyUI 代理服务器已启动，正在监听 http://127.0.0.1:${PORT}\n\n`);
    });
}

(async () => {
    try {
        await startProxyServer();
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] 插件启动失败:`, error);
    }
})();

this.unload = () => {
    if (server) {
        server.close(() => {
            console.log(`[${EXTENSION_NAME}] ComfyUI 代理服务器已关闭。`);
        });
    }
};
