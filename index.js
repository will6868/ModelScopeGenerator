// 【最终版 - 服务器端】
const { registerExtensionEndpoint } = require('../../../../script.js');
const { loadYaml } = require('../../../utils.js');
const path = require('path');
const fs = require('fs').promises;

const EXTENSION_NAME = "ModelScopePicCommand";

(async () => {
    try {
        console.log(`[${EXTENSION_NAME}] 开始加载服务器端脚本...`);
        const config = await loadYaml(path.join(__dirname, 'config.yaml'));

        registerExtensionEndpoint(EXTENSION_NAME, async (req, res) => {
            try {
                const { prompt } = req.body;
                if (!prompt) return res.status(400).json({ error: "请求缺少 prompt 参数。" });

                console.log(`[${EXTENSION_NAME}] 正在为提示词发送云端API请求: "${prompt.substring(0, 80)}..."`);
                const payload = { model: config.model_id, prompt: prompt };
                const headers = { 'Authorization': config.api_key, 'Content-Type': 'application/json' };
                
                const apiResponse = await fetch(config.api_url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });

                if (!apiResponse.ok) throw new Error(`ModelScope API 请求失败: ${await apiResponse.text()}`);

                const responseData = await apiResponse.json();
                const imageUrl = responseData.images[0].url;

                console.log(`[${EXTENSION_NAME}] API 返回图片URL，正在下载...`);
                const imageResponse = await fetch(imageUrl);
                if (!imageResponse.ok) throw new Error(`从URL下载图片失败: ${imageUrl}`);

                const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                const publicImagePath = path.join(process.cwd(), 'public', 'extensions', 'ModelScopeGenerator', 'generated_image.png');
                await fs.writeFile(publicImagePath, imageBuffer);
                console.log(`[${EXTENSION_NAME}] 图片已成功保存。`);

                const publicUrl = `/extensions/ModelScopeGenerator/generated_image.png?v=${new Date().getTime()}`;
                res.status(200).json({ imageUrl: publicUrl });

            } catch (error) {
                console.error(`[${EXTENSION_NAME}] 处理图片生成时出错:`, error);
                res.status(500).json({ error: error.message });
            }
        });

        console.log(`\n[${EXTENSION_NAME}] 插件已成功加载，/pic 命令的前置API已就绪。\n`);
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] 插件加载失败:`, error);
    }
})();```

##### 📄 `script.js` (最终版 · 客户端)
这个脚本负责在浏览器中创建 `/pic` 命令。
```javascript
// 【最终版 - 客户端】
import { addOneMessage } from '../../../../script.js';

const EXTENSION_NAME = "ModelScopePicCommand";

$(document).ready(function () {
    const cmd = "/pic";
    const CMD_DESC = "使用模型范围（ModelScope）API生成一张图片。用法: /pic <你的提示词>";

    SlashCommandParser.addCommand(cmd, false, true, (args) => {
        const prompt = args.trim();
        if (!prompt) {
            toastr.warning("请在 /pic 命令后提供提示词。");
            return;
        }

        addOneMessage({ name: "生成器", is_user: false, is_name: true, mes: `> *正在为以下内容生成图片: "${prompt}"*` });

        fetch(`/api/extensions/${EXTENSION_NAME}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt }),
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => Promise.reject(err));
            }
            return response.json();
        })
        .then(data => {
            if (data.imageUrl) {
                const imageHtml = `<div class_name="image-container"><img src="${data.imageUrl}" alt="${prompt}" /></div>`;
                addOneMessage({ name: "生成器", is_user: false, is_name: true, mes: imageHtml });
            } else {
                throw new Error('API返回的数据中缺少imageUrl。');
            }
        })
        .catch(error => {
            console.error(`[${EXTENSION_NAME}] 错误:`, error);
            const errorMessage = error.error || error.message || '未知错误';
            toastr.error(`图片生成失败: ${errorMessage}`, "错误");
            addOneMessage({ name: "生成器", is_user: false, is_name: true, mes: `> *抱歉，生成图片失败。*` });
        });
    }, CMD_DESC);

    console.log(`[ModelScope /pic Command] /pic 命令已成功注册。`);

    this.unload = () => {
        SlashCommandParser.removeCommand(cmd);
    };
});
