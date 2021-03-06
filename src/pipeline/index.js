import { process as processResource } from '../processing/resources';
import * as ERR from '../errs';
import DestinationRequest from './destination-request';
import PipelineContext from './pipeline-context';
import * as headerTransforms from './header-transforms';
import { handle as handleConnectionReset } from './connection-reset';
import { check as checkSameOriginPolicy } from './same-origin-policy';
import { fetchBody, respond404 } from '../utils/http';
import { inject as injectUpload } from '../upload';


// Stages
var stages = {
    0: async function fetchProxyRequestBody (ctx, next) {
        ctx.reqBody = await fetchBody(ctx.req);
        next();
    },

    1: function sendDestinationRequest (ctx, next) {
        var opts = createReqOpts(ctx);
        var req  = new DestinationRequest(opts);

        req.on('response', (res) => {
            ctx.destRes = res;
            next();
        });

        req.on('error', () => ctx.hasDestReqErr = true);
        req.on('fatalError', (err) => error(ctx, err));
    },

    2: function checkSameOriginPolicyCompliance (ctx, next) {
        if (ctx.isXhr && !checkSameOriginPolicy(ctx)) {
            ctx.closeWithError(0);
            return;
        }

        next();
    },

    3: function decideOnProcessingStrategy (ctx, next) {
        ctx.buildContentInfo();

        //NOTE: just pipe body to browser if we don't need to process content body
        if (!ctx.contentInfo.requireProcessing) {
            sendResponseHeaders(ctx);
            ctx.destRes.pipe(ctx.res);
            return;
        }

        next();
    },

    4: async function fetchContent (ctx, next) {
        ctx.destResBody = await fetchBody(ctx.destRes);

        // NOTE: sometimes underlying socket emits error event.
        // But if we have response body we can still process
        // such requests. (See: B234324)
        if (ctx.hasDestReqErr && isDestResBodyMalformed(ctx)) {
            error({
                code:    ERR.PROXY_ORIGIN_SERVER_CONNECTION_TERMINATED,
                destUrl: ctx.dest.url
            });

            return;
        }

        next();
    },

    5: async function processContent (ctx, next) {
        try {
            ctx.destResBody = await processResource(ctx);
            next();
        }
        catch (err) {
            error(ctx, err);
        }
    },

    6: function sendProxyResponse (ctx) {
        sendResponseHeaders(ctx);

        handleConnectionReset(() => {
            ctx.res.write(ctx.destResBody);
            ctx.res.end();
        });
    }
};


// Utils
function createReqOpts (ctx) {
    var bodyWithUploads = injectUpload(ctx.req.headers['content-type'], ctx.reqBody);

    return {
        url:         ctx.dest.url,
        protocol:    ctx.dest.protocol,
        hostname:    ctx.dest.hostname,
        host:        ctx.dest.host,
        port:        ctx.dest.port,
        path:        ctx.dest.partAfterHost,
        method:      ctx.req.method,
        headers:     headerTransforms.forRequest(ctx, this),
        credentials: ctx.session.getAuthCredentials(),
        body:        bodyWithUploads || ctx.reqBody
    };
}

function sendResponseHeaders (ctx) {
    var headers = headerTransforms.forResponse(ctx);

    ctx.res.writeHead(ctx.destRes.statusCode, headers);
    ctx.res.addTrailers(ctx.destRes.trailers);
}

function error (ctx, err) {
    if (ctx.isPage && !ctx.isIFrame)
        ctx.session.handlePageError(ctx, err);
    else
        ctx.closeWithError(500, err.toString());
}

function isDestResBodyMalformed (ctx) {
    return !ctx.destResBody || ctx.destResBody.length !== ctx.destRes.headers['content-length'];
}


// API
export function runPipeline (req, res, serverInfo, openSessions) {
    var ctx = new PipelineContext(req, res, serverInfo);

    /*eslint-disable indent*/
    if (ctx.dispatch(openSessions)) {
        var stageIdx = 0;
        var next     = () => stages[++stageIdx](ctx, next);

        stages[0](ctx, next);
    }
    else
        respond404(res);
    /*eslint-enable indent*/
}
