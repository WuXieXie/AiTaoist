import { Readable } from 'stream';
import { buildFortuneRequest } from './fortuneRequests.js';

function getBaseUrl() {
  return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || '';
}

function getAccessKey() {
  return process.env.KEY || '';
}

function getClientAccessKey(req) {
  const value = req.headers?.['x-access-key'];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function getRequestBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new Error('请求体不是有效的 JSON。');
    }
  }

  return req.body;
}

function setHeaderIfPresent(res, headerName, headerValue) {
  if (headerValue) {
    res.setHeader(headerName, headerValue);
  }
}

function sendJsonError(res, statusCode, message, allowMethod) {
  if (allowMethod) {
    res.setHeader('Allow', allowMethod);
  }

  res.status(statusCode).json({
    error: {
      message,
    },
  });
}

function ensureAccessKey(req, res) {
  const accessKey = getAccessKey();
  if (!accessKey) {
    return true;
  }

  if (getClientAccessKey(req) === accessKey) {
    return true;
  }

  sendJsonError(res, 401, '访问密钥不正确。');
  return false;
}

async function handleModels(req, res) {
  if (req.method !== 'GET') {
    sendJsonError(res, 405, 'Method Not Allowed', 'GET');
    return;
  }

  if (!ensureAccessKey(req, res)) {
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    sendJsonError(res, 500, 'OPENAI_API_KEY is missing on the server.');
    return;
  }

  try {
    const upstreamResponse = await fetch(new URL(`${getBaseUrl().replace(/\/$/, '')}/models`), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    setHeaderIfPresent(res, 'Content-Type', upstreamResponse.headers.get('content-type'));
    const payload = await upstreamResponse.text();
    res.status(upstreamResponse.status).send(payload);
  } catch (error) {
    console.error('Proxy model list request failed:', error);
    sendJsonError(res, 502, 'Upstream model list request failed.');
  }
}

async function handleFortune(req, res) {
  if (req.method !== 'POST') {
    sendJsonError(res, 405, 'Method Not Allowed', 'POST');
    return;
  }

  if (!ensureAccessKey(req, res)) {
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    sendJsonError(res, 500, 'OPENAI_API_KEY is missing on the server.');
    return;
  }

  let upstreamBody;
  try {
    upstreamBody = buildFortuneRequest(getRequestBody(req));
  } catch (error) {
    sendJsonError(res, 400, error instanceof Error ? error.message : '请求参数不正确。');
    return;
  }

  try {
    const upstreamResponse = await fetch(new URL(`${getBaseUrl().replace(/\/$/, '')}/responses`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    setHeaderIfPresent(res, 'Content-Type', upstreamResponse.headers.get('content-type'));
    setHeaderIfPresent(res, 'Cache-Control', upstreamResponse.headers.get('cache-control'));
    setHeaderIfPresent(res, 'Connection', upstreamResponse.headers.get('connection'));
    res.setHeader('X-Accel-Buffering', 'no');
    res.status(upstreamResponse.status);

    if (upstreamResponse.body) {
      Readable.fromWeb(upstreamResponse.body).pipe(res);
      return;
    }

    const payload = await upstreamResponse.text();
    res.send(payload);
  } catch (error) {
    console.error('Fortune request failed:', error);
    sendJsonError(res, 502, 'Upstream fortune request failed.');
  }
}

export async function dispatchApiRequest(req, res, endpoint) {
  if (endpoint === 'models') {
    await handleModels(req, res);
    return;
  }

  if (endpoint === 'fortune') {
    await handleFortune(req, res);
    return;
  }

  sendJsonError(res, 404, 'API endpoint not found.');
}

export function resolveEndpointFromUrl(url) {
  const parsedUrl = new URL(url || '/api', 'https://placeholder.local');
  return parsedUrl.searchParams.get('endpoint') || '';
}
