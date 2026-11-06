import { getStealthSettings } from '../data/stealth-settings.ts';
import { validateSession } from '../session.js';
import { cookieRequestAllowed, extractSessionToken } from '../session-cookie.ts';
import { gatePage, notFound, privateHeaders, submitGate } from './gate.ts';
import { errorResponse, v1ErrorResponse } from '../utils.js';

function privateResponse(response: Response) {
  // WebSocket 101
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(privateHeaders)) headers.set(key, value);
  for (const key of ['Server', 'X-Powered-By', 'ETag', 'Last-Modified', 'Link', 'Content-Length']) headers.delete(key);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function assets(request: Request, env, settings, authenticated?: boolean) {
  if (!env.ASSETS) return notFound();

  const url = new URL(request.url);
  const path = url.pathname;

  // Public share link redirect: /s/:shareId -> /flaredraw/s/:shareId
  if (path.startsWith('/s/')) {
    const shareId = path.slice(3);
    return Response.redirect(`${url.origin}/flaredraw/s/${shareId}`, 302);
  }

  // FlareDraw SPA sub-app routing
  if (path === '/flaredraw') {
    return Response.redirect(`${url.origin}/flaredraw/`, 301);
  }

  if (path.startsWith('/flaredraw/')) {
    const lastSlash = path.lastIndexOf('/');
    const filePart = path.slice(lastSlash + 1);
    if (filePart.includes('.')) {
      const fileRes = await env.ASSETS.fetch(request);
      return privateResponse(fileRes);
    }
    if (path === '/flaredraw/') {
      const indexRes = await env.ASSETS.fetch(request);
      return privateResponse(indexRes);
    }
    const subAppReq = new Request(`${url.origin}/flaredraw/`, request);
    const subRes = await env.ASSETS.fetch(subAppReq);
    return privateResponse(subRes);
  }

  const response = await env.ASSETS.fetch(request);
  if (!response.headers.get('content-type')?.includes('text/html')) {
    return privateResponse(response);
  }
  if (authenticated === undefined) {
    const token = extractSessionToken(request);
    authenticated = token ? (await validateSession(env, token)).ok : false;
  }
  if (!authenticated) return privateResponse(response);
  const html = await response.text();
  const metadata = `<meta name="app-session" content="1"><meta name="app-path" content="${settings?.enabled ? settings.apiPrefix : '/api'}">`;
  return privateResponse(new Response(html.replace('</head>', `${metadata}</head>`), {
    status: response.status, headers: response.headers,
  }));
}

async function integration(request: Request, env, ctx, dispatch) {
  if (request.method !== 'POST') return null;
  const path = new URL(request.url).pathname;
  const telegram = path === '/api/integrations/telegram/webhook'
    && request.headers.has('X-Telegram-Bot-Api-Secret-Token');
  const bridge = path === '/api/integrations/instance-bridge/v1'
    && request.headers.has('x-edgechat-signature');
  if (!telegram && !bridge) return null;
  const response = await dispatch(request, env, ctx);
  if (response.ok || (bridge && response.headers.has('x-edgechat-signature'))) return privateResponse(response);
  return notFound();
}

export function createSiteEntry(dispatch) {
  return async (request: Request, env, ctx) => {
    try {
      const settings = await getStealthSettings(env.DB);
      const url = new URL(request.url);
      const path = url.pathname;
      if (!settings?.enabled) {
        if (
          path.startsWith('/api/') ||
          path.startsWith('/files/') ||
          path.startsWith('/oauth/') ||
          path.startsWith('/.well-known/')
        ) {
          const response = await dispatch(request, env, ctx);
          return path.startsWith('/api/auth/') ? privateResponse(response) : response;
        }
        return await assets(request, env, settings);
      }

      if (path === settings.loginPath && request.method === 'POST') return await submitGate(request, env, settings);
      const callback = await integration(request, env, ctx, dispatch);
      if (callback) return callback;
      const token = extractSessionToken(request);
      const validation = token ? await validateSession(env, token) : { ok: false };
      if (!validation.ok) {
        if ((path === '/' || path === settings.loginPath) && ['GET', 'HEAD'].includes(request.method)) {
          const response = gatePage(settings);
          return request.method === 'HEAD' ? new Response(null, response) : response;
        }
        return notFound();
      }
      if (!cookieRequestAllowed(request)) return notFound();
      if (path === settings.loginPath) {
        return new Response(null, { status: 303, headers: { ...privateHeaders, Location: '/' } });
      }
      if (path.startsWith(`${settings.apiPrefix}/`)) {
        url.pathname = `/api${path.slice(settings.apiPrefix.length)}`;
        return privateResponse(await dispatch(new Request(url, request), env, ctx));
      }
      if (
        path.startsWith('/api/') ||
        path.startsWith('/files/') ||
        path.startsWith('/oauth/') ||
        path.startsWith('/.well-known/')
      ) {
        return privateResponse(await dispatch(request, env, ctx));
      }
      return await assets(request, env, settings, true);
    } catch (error) {
      console.error('Request failed', error);
      const path = new URL(request.url).pathname;
      if (path.startsWith('/api/v1/')) return privateResponse(v1ErrorResponse('temporarily_unavailable', 'service unavailable', 503));
      if (path.startsWith('/api/')) return privateResponse(errorResponse('service unavailable', 503));
      return new Response('Service Unavailable', { status: 503, headers: privateHeaders });
    }
  };
}
