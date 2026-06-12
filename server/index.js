import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const app = express();
const port = Number(process.env.PORT || 5174);

app.use(express.json({ limit: "50mb" }));

const providers = [
  {
    id: "qwen",
    name: "千问",
    badge: "默认",
    tone: "默认模型",
    model: process.env.QWEN_MODEL || "qwen3.7-plus",
    baseUrl: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: process.env.QWEN_API_KEY,
    temperature: 0.7,
  },
  {
    id: "glm",
    name: "GLM",
    badge: "视觉",
    tone: "视觉理解",
    model: process.env.GLM_MODEL || "glm-5v-turbo",
    baseUrl: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
    apiKey: process.env.GLM_API_KEY,
    temperature: 0.7,
  },
  {
    id: "kimi",
    name: "Kimi",
    badge: "长文",
    tone: "长上下文",
    model: process.env.KIMI_MODEL || "kimi-k2.6",
    baseUrl: process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1",
    apiKey: process.env.KIMI_API_KEY,
    temperature: 1,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    badge: "推理",
    tone: "推理模型",
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
    temperature: 0.7,
    extraBody: {
      thinking: { type: "enabled" },
      reasoning_effort: "medium",
    },
  },
];

const publicProviders = providers.map(({ id, name, badge, tone, model }) => ({
  id,
  name,
  badge,
  tone,
  model,
  ready: Boolean(providers.find((provider) => provider.id === id)?.apiKey),
}));

app.get("/api/models", (_req, res) => {
  res.json({ defaultModel: "qwen", models: publicProviders });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ai-command-deck" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { modelId = "qwen", messages = [] } = req.body || {};
    const provider = providers.find((item) => item.id === modelId) || providers[0];
    if (!provider.apiKey) {
      res.status(400).json({ error: `${provider.name} API Key 未配置` });
      return;
    }

    const apiMessages = await toOpenAiMessages(messages);
    const response = await fetch(chatCompletionsUrl(provider.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: apiMessages,
        temperature: provider.temperature,
        stream: true,
        ...(provider.extraBody || {}),
      }),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      res.writeHead(response.status || 502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: errorText || "上游模型没有返回内容" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "服务端出错了" });
      return;
    }
    res.write(`data: ${JSON.stringify({ error: error.message || "服务端出错了" })}\n\n`);
    res.end();
  }
});

async function toOpenAiMessages(messages) {
  const recent = messages
    .filter((message) => ["user", "assistant", "system"].includes(message.role))
    .slice(-18);

  const converted = [
    {
      role: "system",
      content:
        "你是一个亲切、可靠、表达清楚的私人 AI 助手。优先使用中文回答；如果用户上传了文件或图片，请结合附件内容回答。",
    },
  ];

  for (const message of recent) {
    if (message.role !== "user") {
      converted.push({ role: message.role, content: String(message.content || "") });
      continue;
    }

    const attachments = await Promise.all((message.attachments || []).map(extractAttachment));
    const textBlocks = attachments.filter((item) => item.kind === "text");
    const imageBlocks = attachments.filter((item) => item.kind === "image");
    const attachmentText = textBlocks
      .map((item) => `\n\n[附件：${item.name}]\n${item.text}`)
      .join("");
    const text = `${message.content || ""}${attachmentText}`.trim() || "请帮我分析附件。";

    if (imageBlocks.length) {
      converted.push({
        role: "user",
        content: [
          { type: "text", text },
          ...imageBlocks.map((image) => ({
            type: "image_url",
            image_url: { url: image.dataUrl },
          })),
        ],
      });
      continue;
    }

    converted.push({ role: "user", content: text });
  }

  return converted;
}

async function extractAttachment(attachment) {
  const name = attachment.name || "未命名附件";
  const type = attachment.type || "";

  if (attachment.text) {
    return { kind: "text", name, text: limitText(attachment.text) };
  }

  if (type.startsWith("image/") && attachment.dataUrl) {
    return { kind: "image", name, dataUrl: attachment.dataUrl };
  }

  if (!attachment.dataUrl) {
    return { kind: "text", name, text: "无法读取这个附件。" };
  }

  const buffer = dataUrlToBuffer(attachment.dataUrl);
  const lowerName = name.toLowerCase();

  try {
    if (type === "application/pdf" || lowerName.endsWith(".pdf")) {
      const pdfParse = await import("pdf-parse");
      const parse = pdfParse.default || pdfParse;
      const parsed = await parse(buffer);
      return { kind: "text", name, text: limitText(parsed.text || "") };
    }

    if (
      type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lowerName.endsWith(".docx")
    ) {
      const parsed = await mammoth.extractRawText({ buffer });
      return { kind: "text", name, text: limitText(parsed.value || "") };
    }

    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || type.includes("spreadsheet")) {
      return {
        kind: "text",
        name,
        text: "当前为避免不安全的表格解析依赖，暂不直接解析 Excel。请另存为 CSV 后上传。",
      };
    }

    return { kind: "text", name, text: limitText(buffer.toString("utf8")) };
  } catch (error) {
    return {
      kind: "text",
      name,
      text: `附件解析失败：${error.message || "未知错误"}。如果这是扫描件或复杂格式，请改传图片或复制文字。`,
    };
  }
}

function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() : dataUrl;
  return Buffer.from(base64, "base64");
}

function limitText(text) {
  const cleaned = String(text || "").replace(/\u0000/g, "").trim();
  return cleaned.length > 28000 ? `${cleaned.slice(0, 28000)}\n\n[内容过长，已截断]` : cleaned;
}

function chatCompletionsUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.use((_req, res) => {
    res.sendFile(path.join(root, "dist", "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Momo AI is ready: http://localhost:${port}`);
});
