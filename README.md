# AI Chat

私有部署的多模型 AI 聊天 Web 应用，桌面与移动端自适应，支持 PWA 安装到主屏幕。

React 19 + Vite 前端，Express 5 后端；密钥只放在服务端环境变量，浏览器不接触任何 API Key。

## 功能

- **多模型切换**：内置 Qwen（通义）、GLM（智谱）、Kimi（月之暗面）、DeepSeek 四个供应商预设，均走 OpenAI 兼容协议，模型名与 Base URL 可在 `.env` 自由覆盖。
- **流式输出**：服务端以 SSE（`text/event-stream`）转发上游 token，回答逐字渲染。
- **文件问答**：上传 PDF（`pdf-parse`）与 Word 文档（`mammoth`）提取正文后随消息发送，单文件上限 18 MB。
- **会话管理**：本地保存多会话历史、消息附件清单；刷新后状态保留。
- **PWA**：`manifest.webmanifest` + Service Worker，可安装到手机主屏离线打开界面。
- **健康检查**：`GET /api/health` 供部署平台探活。

## 快速开始

```bash
npm install
cp .env.example .env   # 填入至少一个供应商的 API Key
npm run dev            # http://localhost:5174
```

生产构建与启动：

```bash
npm run build          # Vite 产物
npm start              # Express 托管前端与 API（NODE_ENV=production）
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `PORT` | 服务端口，默认 `5174` |
| `QWEN_API_KEY` / `QWEN_MODEL` / `QWEN_BASE_URL` | 通义 DashScope 兼容模式 |
| `GLM_API_KEY` / `GLM_MODEL` / `GLM_BASE_URL` | 智谱开放平台 |
| `KIMI_API_KEY` / `KIMI_MODEL` / `KIMI_BASE_URL` | 月之暗面 Moonshot |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL` | DeepSeek 开放平台 |

只配置你实际使用的供应商即可；未配置的模型在界面上不可选。

## 部署

- **Docker**：仓库根目录提供 `Dockerfile`，`docker build -t ai-chat . && docker run -p 5174:5174 --env-file .env ai-chat`。
- **Railway**：`railway.json` 已就绪，导入仓库后补环境变量即可。

## 接口一览

| 接口 | 方法 | 用途 |
|---|---|---|
| `/api/health` | GET | 服务与模型配置状态 |
| `/api/models` | GET | 当前可用的模型列表 |
| `/api/chat` | POST | 对话补全（SSE 流式响应） |

## 安全说明

本项目定位为**个人私有部署**：没有多用户登录与配额控制，请勿将实例直接暴露公网；部署平台侧请开启访问鉴权，或仅绑定内网/VPN 使用。
