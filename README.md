# 玄门命理

一个基于 React + Vite 的命理测算 Web 应用，支持 Vercel 一键部署，也支持传统 Node/Express 自托管。项目提供八字排盘、八字合盘、大六壬、小六壬、六爻等功能，并支持 AI 流式推演展示、运势图表和结果分享。

## 功能概览

- 八字排盘
  - 基础命盘解析
  - 五行强弱与喜忌分析
  - 性格、健康、财运、事业、情感、家庭总评
  - 大运流年深入推演
  - 流日运势查询
  - 走势图与评分面板
- 八字合盘
  - 双方八字契合度分析
  - 情感模式、未来走向、建议输出
- 大六壬
  - 四课、三传、天盘与断语
- 小六壬
  - 宫位排布、整体断语与建议
- 六爻
  - 时间起卦
  - 铜钱起卦
  - 本卦、变卦、爻辞、详细分析
- 通用能力
  - AI 流式逐字回显
  - 多模型切换
  - 图片导出与分享
  - 服务端代理，避免前端暴露 API Key

## 注意事项

默认模型优先使用 gpt-5.4，如模型列表中不存在则自动回退到 gpt-5.2  
大家可以根据自己的需求选择模型  
测试时发现使用同一个模型的情况下自己搭建的中转站与公益站的结果会有明显差异  
因此确信模型质量会影响输出结果，大家也可以根据自己的理解和实际情况进行调优  
该项目主要为提示词优化和前端显示结合的工程  
该项目方向由于法规等因素不适合上架小程序/App，所以建议保留网页端玩法即可  

## 技术栈

- 前端
  - React 19
  - Vite
  - TypeScript
  - Motion
  - Recharts
  - Lucide React
- 服务端
  - Vercel Serverless Function
  - Node.js 22
  - Express（仅用于传统自托管模式）
  - dotenv
- 命理计算
  - lunar-javascript

## 项目结构

```text
.
├─ api/
│  └─ index.js              # 统一 Serverless 接口入口
├─ server/
│  └─ fortuneRequests.js    # 业务请求组装、白名单校验、schema 定义
├─ src/
│  ├─ components/
│  ├─ services/
│  │  ├─ fortuneService.ts
│  │  └─ shenshaRules.ts
│  ├─ utils/
│  │  └─ shareUtils.ts
│  ├─ types/
│  │  └─ toneMode.ts
│  └─ App.tsx
├─ server.js                # 传统 Node/Express 自托管入口
├─ vercel.json              # Vercel 部署配置
├─ .vercelignore            # Vercel 上传忽略规则
├─ package.json
└─ README.md
```

## 环境要求

- Node.js 22
- npm

建议统一使用 Node 22，以保证原生 `fetch`、流式响应、ESM 与 Vercel 运行时行为一致。

## 环境变量

本地开发可在项目根目录创建 `.env.local` 或 `.env`。

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxxx
OPENAI_DEFAULT_MODEL=gpt-5.4
PORT=9999
```

说明：

- `OPENAI_BASE_URL`
  - OpenAI 兼容网关根地址，必须带 `/v1`
- `OPENAI_API_KEY`
  - 服务端代理使用的密钥
- `OPENAI_DEFAULT_MODEL`
  - 默认模型名称
- `PORT`
  - 仅传统 Node/Express 自托管模式使用

## 推荐部署方式：Vercel 一键部署

当前项目已适配 Vercel，一键部署时无需手动运行 Express。

### 部署步骤

1. 将仓库导入 Vercel
2. Framework Preset 选择 `Vite`
3. Build Command 使用：

```bash
npm run vercel-build
```

4. Output Directory 使用：

```text
dist
```

5. 在 Vercel 项目环境变量中配置：

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxxx
OPENAI_DEFAULT_MODEL=gpt-5.4
```

6. 点击 Deploy

### 当前 Vercel 适配内容

- 前端静态资源由 Vite 构建到 `dist`
- 所有线上接口统一收口到 [api/index.js](./api/index.js)
- 对外仍保留：
  - `/api/models`
  - `/api/fortune`
- 业务 prompt、schema、白名单校验统一复用 [server/fortuneRequests.js](./server/fortuneRequests.js)
- `vercel.json` 中已配置：
  - `framework: vite`
  - Node.js 22 runtime
  - 函数最大执行时长
  - 函数区域
  - API 重写到统一入口
  - SPA 路由回退
- `.vercelignore` 已忽略本地无关文件，减小上传体积

### 统一接口入口说明

Vercel 线上目前使用单一函数入口：

- [api/index.js](./api/index.js)

对外路径不变：

- `GET /api/models`
- `POST /api/fortune`

内部通过 `vercel.json` 重写为：

- `/api/models` -> `/api?endpoint=models`
- `/api/fortune` -> `/api?endpoint=fortune`

这样做的好处：

- 接口层统一收口，便于后续继续扩展
- 公共鉴权、环境变量校验、错误处理更容易复用
- Vercel 函数配置只需要维护一个入口

### Vercel 函数配置说明

当前默认配置：

- `api/index.js`
  - runtime: `nodejs22.x`
  - `maxDuration: 60`
  - `regions: ["hkg1"]`

如果你的上游网关在其他区域延迟更低，可以按需调整 `regions`。

### Vercel 部署后检查项

部署完成后建议先验证：

- `GET /api/models`
- `POST /api/fortune`

如果首页能打开，但 `/api/fortune` 返回 404，通常说明：

- 仓库还没包含 `api/index.js`
- Vercel 部署的不是最新提交
- 项目根目录设置错误
- `vercel.json` 未生效

## 本地开发

1. 安装依赖

```bash
npm install
```

2. 启动前端开发服务器

```bash
npm run dev
```

## 传统 Node/Express 自托管

如果你不是部署到 Vercel，而是部署到自己的服务器、Docker 或 VPS，可以继续使用原有 Express 模式。

1. 安装依赖

```bash
npm install
```

2. 构建前端

```bash
npm run build
```

3. 启动 Node 服务

```bash
npm run start
```

## Docker 部署

本项目提供开箱即用的 Docker 部署文件：

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`

### 环境变量

在项目根目录创建 `.env`：

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxxx
OPENAI_DEFAULT_MODEL=gpt-5.4
PORT=9999
```

### 启动方式

```bash
docker compose up -d --build
```

## 可用脚本

```bash
npm run dev
npm run build
npm run vercel-build
npm run preview
npm run start
npm run typecheck
npm run lint
npm run clean
```

## AI 请求架构

当前项目已统一切换为 OpenAI 兼容的 `Responses API`。

### 前端调用链

前端不会直接请求外部模型接口，而是请求同源代理：

- `GET /api/models`
- `POST /api/fortune`

### 服务端业务链

前端提交测算参数后，统一进入 [api/index.js](./api/index.js)，再分发到对应处理逻辑。

服务端校验白名单后，在服务器内组装 prompt、schema 与模型请求，再转发到：

- `${OPENAI_BASE_URL}/models`
- `${OPENAI_BASE_URL}/responses`

这样做的目的：

- 避免前端暴露 API Key
- 避免接口被当作通用代理滥用
- 统一管理接口层
- 结构化输出 schema 固定由服务端生成
- 规避跨域与混合内容问题

## 结构化输出

项目通过 `json_schema` 约束模型输出，并在前端解析 `Responses API` 的返回结构。

```text
output[0].content[0].text
```

当使用流式请求时，前端会解析 `response.output_text.delta` 等 SSE 事件，实现逐字回显。

## Serverless 兼容性说明

当前项目已针对 Vercel Serverless 做过一轮清理与约束：

- 已移除 `better-sqlite3` 依赖，避免原生模块编译与 Serverless 兼容问题
- 不依赖本地持久化磁盘
- API 逻辑为无状态请求处理
- 接口层已统一收口到单一函数入口
- 长时间任务主要集中在 `fortune` 分支，已为统一入口配置较高超时

## 调试建议

如果遇到“解析失败”或流式异常，优先检查：

1. `OPENAI_BASE_URL` 是否正确，且是否带 `/v1`
2. 目标网关是否真实支持 `Responses API`
3. Vercel Function Logs 是否出现上游 HTML 错误页或断流
4. `GET /api/models` 与 `POST /api/fortune` 是否都能命中统一入口

## 适合二次开发的入口

- 应用主流程
  - [src/App.tsx](./src/App.tsx)
- AI 请求与命理服务
  - [src/services/fortuneService.ts](./src/services/fortuneService.ts)
- 统一接口入口
  - [api/index.js](./api/index.js)
- 业务请求组装
  - [server/fortuneRequests.js](./server/fortuneRequests.js)
- 传统自托管入口
  - [server.js](./server.js)

## 界面预览

### 主界面

![界面预览](./photo/界面预览.png)

### 导出效果

![导出预览](./photo/导出预览.png)

## 免责声明

本项目用于传统命理文化展示、交互体验与娱乐参考，不构成医学、法律、投资、婚恋或其他现实决策建议。任何重要决定请结合现实情况自行判断。

## 开源协议

本项目采用 [MIT License](./LICENSE) 开源。
