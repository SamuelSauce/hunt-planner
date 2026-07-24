import { onRequest } from "firebase-functions/v2/https";
import {
  proxyCommunityRequest,
  sendProxyResponse,
} from "./proxy.js";

export const communityApiProxy = onRequest(
  {
    invoker: "public",
    maxInstances: 10,
    region: "us-central1",
    timeoutSeconds: 15,
  },
  async (request, response) => {
    const proxied = await proxyCommunityRequest(request);
    sendProxyResponse(response, proxied);
  },
);
