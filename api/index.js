import { dispatchApiRequest, resolveEndpointFromUrl } from '../server/apiHandler.js';

export default async function handler(req, res) {
  const endpoint = resolveEndpointFromUrl(req.url);
  await dispatchApiRequest(req, res, endpoint);
}
