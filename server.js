import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dispatchApiRequest } from './server/apiHandler.js';

const app = express();
const port = Number(process.env.PORT || 9999);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const envLocalPath = path.join(__dirname, '.env.local');
const envPath = path.join(__dirname, '.env');

dotenv.config({ path: envLocalPath });
dotenv.config({ path: envPath, override: false });

app.use(express.json({ limit: '2mb' }));

app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    res.status(400).json({
      error: {
        message: '请求体不是有效的 JSON。',
      },
    });
    return;
  }

  next(error);
});

app.get('/api/models', async (req, res) => {
  await dispatchApiRequest(req, res, 'models');
});

app.post('/api/fortune', async (req, res) => {
  await dispatchApiRequest(req, res, 'fortune');
});

app.use('/api/responses', (_req, res) => {
  res.status(410).json({
    error: {
      message: '通用 OpenAI 代理接口已禁用，请使用业务测算接口。',
    },
  });
});

app.use('/api', (_req, res) => {
  res.status(404).json({
    error: {
      message: '接口不存在。',
    },
  });
});

app.use(express.static(distDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
