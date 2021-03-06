import http from 'http';
import urlUtils from './utils/url';
import { respond404, respond500, respondWithJSON, fetchBody } from './utils/http';
import { ie9FileReaderShim } from './upload';
import { runPipeline } from './pipeline';
import read from './utils/read-file-relative';
import Router from './router';

// Const
const CLIENT_SCRIPT = read('./client/hammerhead.js');


// Static
function parseServiceMsg (body) {
    body = body.toString();

    try {
        return JSON.parse(body);
    }
    catch (err) {
        return null;
    }
}

function createServerInfo (hostname, port, crossDomainPort) {
    return {
        hostname:        hostname,
        port:            port,
        crossDomainPort: crossDomainPort,
        domain:          `http://${hostname}:${port}`
    };
}


// Proxy
export default class Proxy extends Router {
    constructor (hostname, port1, port2) {
        super();

        this.openSessions = {};

        this.server1Info = createServerInfo(hostname, port1, port2);
        this.server2Info = createServerInfo(hostname, port2, port1);
        this.server1     = http.createServer((req, res) => this._onRequest(req, res, this.server1Info));
        this.server2     = http.createServer((req, res) => this._onRequest(req, res, this.server2Info));

        this.server1.listen(port1);
        this.server2.listen(port2);

        this._registerServiceRoutes();
    }

    _registerServiceRoutes () {
        this.GET('/hammerhead.js', {
            contentType: 'application/x-javascript',
            content:     CLIENT_SCRIPT
        });

        this.POST('/ie9-file-reader-shim', ie9FileReaderShim);
        this.POST('/messaging', (req, res, serverInfo) => this._onServiceMessage(req, res, serverInfo));
        this.GET('/task.js', (req, res, serverInfo) => this._onTaskScriptRequest(req, res, serverInfo, false));
        this.GET('/iframe-task.js', (req, res, serverInfo) => this._onTaskScriptRequest(req, res, serverInfo, true));
    }

    async _onServiceMessage (req, res, serverInfo) {
        var body    = await fetchBody(req);
        var msg     = parseServiceMsg(body);
        var session = msg && this.openSessions[msg.jobUid];

        /*eslint-disable indent*/
        if (session) {
            try {
                var result = await session.handleServiceMessage(msg, serverInfo);

                respondWithJSON(res, result || '');
            }
            catch (err) {
                respond500(res, err.toString());
            }
        }
        else
            respond500(res, 'Session is not opened in proxy');
        /*eslint-enable indent*/
    }

    _onTaskScriptRequest (req, res, serverInfo, isIFrame) {
        var referer     = req.headers['referer'];
        var refererDest = referer && urlUtils.parseProxyUrl(referer);
        var session     = refererDest && this.openSessions[refererDest.jobInfo.uid];

        /*eslint-disable indent*/
        if (session) {
            res.setHeader('content-type', 'application/x-javascript');
            res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
            res.setHeader('pragma', 'no-cache');
            res.end(session.getTaskScript(referer, refererDest.originUrl, serverInfo, isIFrame, true));
        }
        else
            respond500(res);
        /*eslint-enable indent*/
    }

    _onRequest (req, res, serverInfo) {
        //NOTE: skip browsers favicon requests which we can't process
        if (req.url === '/favicon.ico')
            respond404(res);

        // NOTE: not a service request, execute proxy pipeline
        else if (!this._route(req, res, serverInfo))
            runPipeline(req, res, serverInfo, this.openSessions);
    }

    // API
    close () {
        this.server1.close();
        this.server2.close();
    }

    openSession (url, session) {
        session.proxy                 = this;
        this.openSessions[session.id] = session;

        url = urlUtils.convertHostToLowerCase(url);

        return urlUtils.getProxyUrl(url, this.server1Info.hostname, this.server1Info.port, session.id);
    }

    closeSession (session) {
        session.proxy = null;
        delete this.openSessions[session.id];
    }
}
